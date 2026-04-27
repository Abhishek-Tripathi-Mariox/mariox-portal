import { Router } from 'express'
import multer from 'multer'
import { createAuthMiddleware } from '../express-middleware/auth'
import {
  uploadFileToS3,
  isMimeAllowed,
  MAX_UPLOAD_BYTES,
  type S3Env,
} from '../utils/s3-upload'
import { respondWithError } from '../validators'

export function createUploadsRouter(jwtSecret: string, runtimeEnv: S3Env = {}) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (!isMimeAllowed(file.mimetype)) {
        cb(new Error(`File type "${file.mimetype}" is not allowed`))
        return
      }
      cb(null, true)
    },
  })

  router.post('/', (req, res) => {
    upload.single('file')(req, res, async (err) => {
      if (err) {
        if ((err as any).code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: `File exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit` })
        }
        return res.status(400).json({ error: err.message || 'Upload failed' })
      }
      if (!req.file) return res.status(400).json({ error: 'No file received' })

      try {
        const user = req.user as any
        const role = String(user?.role || '').toLowerCase()
        const result = await uploadFileToS3(runtimeEnv, {
          buffer: req.file.buffer,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          ownerKind: role || 'staff',
          ownerId: String(user?.sub || 'unknown'),
        })
        return res.status(201).json({
          ...result,
          message: result.was_compressed ? 'Uploaded (image compressed)' : 'Uploaded',
        })
      } catch (error: any) {
        return respondWithError(res, error, 500)
      }
    })
  })

  return router
}
