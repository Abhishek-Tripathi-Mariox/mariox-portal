import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { generateId } from './helpers'

export interface S3Env {
  AWS_REGION?: string
  AWS_S3_BUCKET?: string
  AWS_ACCESS_KEY_ID?: string
  AWS_SECRET_ACCESS_KEY?: string
  AWS_S3_PUBLIC_URL?: string
  [key: string]: any
}

let cachedClient: { client: S3Client; bucket: string; region: string; publicBase: string } | null = null

export function getS3Client(env: S3Env) {
  const region = String(env.AWS_REGION || '').trim()
  const bucket = String(env.AWS_S3_BUCKET || '').trim()
  const accessKeyId = String(env.AWS_ACCESS_KEY_ID || '').trim()
  const secretAccessKey = String(env.AWS_SECRET_ACCESS_KEY || '').trim()
  if (!region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('AWS S3 is not configured (need AWS_REGION, AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)')
  }

  if (cachedClient && cachedClient.bucket === bucket && cachedClient.region === region) {
    return cachedClient
  }

  const client = new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  })
  const publicBase = String(env.AWS_S3_PUBLIC_URL || `https://${bucket}.s3.${region}.amazonaws.com`).replace(/\/+$/, '')
  cachedClient = { client, bucket, region, publicBase }
  return cachedClient
}

const IMAGE_MIME_REGEX = /^image\/(jpe?g|png|webp|gif|tiff|heic|heif|avif)$/i
const PDF_MIME = 'application/pdf'
const VIDEO_MIME_REGEX = /^video\//i
const AUDIO_MIME_REGEX = /^audio\//i

const ALLOWED_MIME_PREFIXES = [
  'image/',
  'video/',
  'audio/',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.',
  'application/vnd.ms-',
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream', // Fallback for some browsers
  'text/',
]

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024 // 25 MB

export function isMimeAllowed(mime: string): boolean {
  if (!mime) return false
  const m = mime.toLowerCase()
  return ALLOWED_MIME_PREFIXES.some((prefix) => m.startsWith(prefix))
}

function safeFileName(original: string): string {
  return original.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 200) || 'file'
}

function extFromMime(mime: string, fallbackExt: string): string {
  const m = (mime || '').toLowerCase()
  if (m.includes('jpeg')) return 'jpg'
  if (m.includes('png')) return 'png'
  if (m.includes('webp')) return 'webp'
  if (m.includes('gif')) return 'gif'
  if (m.includes('pdf')) return 'pdf'
  if (m.startsWith('video/mp4')) return 'mp4'
  if (m.startsWith('video/quicktime')) return 'mov'
  if (m.startsWith('video/webm')) return 'webm'
  return fallbackExt || 'bin'
}

interface CompressResult {
  buffer: Buffer
  contentType: string
  extension: string
}

async function compressImage(buffer: Buffer, mime: string): Promise<CompressResult> {
  // Resize down to 1920px on the longest side, then encode based on input format.
  // For broad support and good compression we convert to WebP (lossy q80) for most formats,
  // keeping PNG as PNG (lossless palette) only when input is PNG with transparency.
  try {
    const meta = await sharp(buffer).metadata()
    const pipeline = sharp(buffer).rotate().resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
    const isPngAlpha = (meta.format === 'png') && (meta.hasAlpha === true)
    if (isPngAlpha) {
      const out = await pipeline.png({ quality: 85, compressionLevel: 9, palette: true }).toBuffer()
      return { buffer: out, contentType: 'image/png', extension: 'png' }
    }
    const out = await pipeline.webp({ quality: 80 }).toBuffer()
    return { buffer: out, contentType: 'image/webp', extension: 'webp' }
  } catch {
    // Fallback: leave as-is
    return { buffer, contentType: mime, extension: extFromMime(mime, 'bin') }
  }
}

export interface UploadOpts {
  buffer: Buffer
  originalName: string
  mimeType: string
  ownerKind: string // 'client' | 'staff' | 'admin'
  ownerId: string
}

export interface UploadResult {
  url: string
  key: string
  file_name: string
  file_type: string
  file_size: number
  was_compressed: boolean
}

export async function uploadFileToS3(env: S3Env, opts: UploadOpts): Promise<UploadResult> {
  if (opts.buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error(`File exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit`)
  }
  if (!isMimeAllowed(opts.mimeType)) {
    throw new Error(`File type "${opts.mimeType}" is not allowed`)
  }

  let buffer = opts.buffer
  let contentType = opts.mimeType
  let extension = (opts.originalName.split('.').pop() || '').toLowerCase()
  let wasCompressed = false

  if (IMAGE_MIME_REGEX.test(contentType)) {
    const compressed = await compressImage(buffer, contentType)
    if (compressed.buffer.length < buffer.length) {
      buffer = compressed.buffer
      contentType = compressed.contentType
      extension = compressed.extension
      wasCompressed = true
    } else {
      extension = extFromMime(contentType, extension)
    }
  } else if (contentType === PDF_MIME || VIDEO_MIME_REGEX.test(contentType) || AUDIO_MIME_REGEX.test(contentType)) {
    // PDFs and AV are not server-side compressed (would require ghostscript/ffmpeg).
    // Original file is uploaded as-is — the 25 MB cap keeps things sane.
    extension = extFromMime(contentType, extension)
  } else {
    extension = extFromMime(contentType, extension)
  }

  const { client, bucket, publicBase } = getS3Client(env)
  const today = new Date().toISOString().slice(0, 10)
  const safeName = safeFileName(opts.originalName.replace(/\.[^.]+$/, ''))
  const key = `uploads/${opts.ownerKind}/${opts.ownerId}/${today}/${generateId('file')}-${safeName}.${extension}`

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    ContentDisposition: `inline; filename="${safeName}.${extension}"`,
    CacheControl: 'public, max-age=31536000, immutable',
  }))

  const url = `${publicBase}/${key}`
  return {
    url,
    key,
    file_name: `${safeName}.${extension}`,
    file_type: contentType,
    file_size: buffer.length,
    was_compressed: wasCompressed,
  }
}
