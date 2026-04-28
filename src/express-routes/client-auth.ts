import type { Router } from 'express'
import { Router as createRouter } from 'express'
import { SignJWT, jwtVerify } from 'jose'
import type { MongoModels } from '../models/mongo-models'
import {
  validateEmail,
  validateNewPassword,
  validateRequired,
  validateName,
  validatePhone,
  validateUrl,
  validateOptional,
  validateLength,
  respondWithError,
} from '../validators'

const encoder = new TextEncoder()

async function hashPassword(password: string, salt: string): Promise<string> {
  const data = encoder.encode(password + salt)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  return (await hashPassword(password, salt)) === hash
}

async function signToken(payload: Record<string, any>, secret: string) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .sign(encoder.encode(secret))
}

export function createClientAuthRouter(models: MongoModels, jwtSecret: string, passwordSalt: string): Router {
  const router = createRouter()

  router.post('/signup', async (req, res) => {
    try {
      const body = req.body || {}
      const email = validateEmail(body.email)
      const password = validateNewPassword(body.password)
      const company_name = validateName(body.company_name, 'Company name', 2, 120)
      const contact_name = validateName(body.contact_name, 'Contact name', 2, 100)
      const phone = validateOptional(body.phone, (v) => validatePhone(v, 'Phone'))
      const website = body.website ? String(body.website).trim().slice(0, 200) : null
      const industry = validateOptional(body.industry, (v) => validateLength(String(v).trim(), 2, 80, 'Industry'))

      const existing = await models.clients.findByEmail(email)
      if (existing) return res.status(409).json({ error: 'Email already registered' })

      const password_hash = await hashPassword(password, passwordSalt)
      const colors = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#f97316']
      const avatar_color = colors[Math.floor(Math.random() * colors.length)]

      const clientRecord = await models.clients.createClient({
        email,
        password_hash,
        company_name,
        contact_name,
        phone,
        website,
        industry,
        avatar_color,
        is_active: 1,
        email_verified: 1,
      })

      const payload = {
        sub: clientRecord.id,
        email: clientRecord.email,
        role: 'client',
        name: contact_name,
        company: company_name,
        exp: Math.floor(Date.now() / 1000) + 86400 * 7,
      }
      const token = await signToken(payload, jwtSecret)
      return res.status(201).json({
        token,
        client: {
          id: clientRecord.id,
          email: clientRecord.email,
          company_name,
          contact_name,
          avatar_color: clientRecord.avatar_color,
          role: 'client',
        },
      })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.post('/login', async (req, res) => {
    try {
      const email = validateEmail(req.body?.email)
      const password = validateRequired(req.body?.password, 'Password')
      const client = await models.clients.findActiveByEmail(email) as any
      if (!client) return res.status(401).json({ error: 'Invalid credentials' })
      const valid = await verifyPassword(password, client.password_hash, passwordSalt)
      if (!valid) return res.status(401).json({ error: 'Invalid credentials' })
      const payload = {
        sub: client.id,
        email: client.email,
        role: 'client',
        name: client.contact_name,
        company: client.company_name,
        exp: Math.floor(Date.now() / 1000) + 86400 * 7,
      }
      const token = await signToken(payload, jwtSecret)
      return res.json({
        token,
        client: {
          id: client.id,
          email: client.email,
          company_name: client.company_name,
          contact_name: client.contact_name,
          avatar_color: client.avatar_color,
          role: 'client',
        },
      })
    } catch (error) {
      return respondWithError(res, error, 500)
    }
  })

  router.get('/me', async (req, res) => {
    try {
      const authHeader = req.header('Authorization')
      if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
      const payload = (await jwtVerify(authHeader.slice(7), encoder.encode(jwtSecret))).payload as any
      const client = await models.clients.findById(
        payload.sub,
        { projection: { id: 1, email: 1, company_name: 1, contact_name: 1, phone: 1, website: 1, industry: 1, avatar_color: 1 } },
      )
      if (!client) return res.status(404).json({ error: 'Not found' })
      return res.json({ client })
    } catch {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  })

  return router
}
