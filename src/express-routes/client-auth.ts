import type { Router } from 'express'
import { Router as createRouter } from 'express'
import { SignJWT, jwtVerify } from 'jose'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, requireRole } from '../express-middleware/auth'
import { createUserNotifications } from './notifications'
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
      const colors = ['#9D6CFF', '#0ea5e9', '#10b981', '#A970FF', '#ec4899', '#8B5CFF', '#f97316']
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

  // Admin-only: issue a client session token without requiring the client's
  // password. Used by the "Login" button on each client card so an admin can
  // open the client portal as that client.
  router.post('/impersonate/:id', createAuthMiddleware(jwtSecret), requireRole('admin'), async (req, res) => {
    try {
      const id = String(req.params.id || '')
      const client = await models.clients.findById(id) as any
      if (!client) return res.status(404).json({ error: 'Client not found' })
      if (Number(client.is_active ?? 1) !== 1) {
        return res.status(400).json({ error: 'Client is inactive' })
      }
      const payload = {
        sub: client.id,
        email: client.email,
        role: 'client',
        name: client.contact_name,
        company: client.company_name,
        impersonated_by: (req.user as any)?.sub || null,
        exp: Math.floor(Date.now() / 1000) + 3600,
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

  // Client self-service password change. The staff /auth/change-password
  // endpoint reads models.users, so a client token there resolves to nothing
  // ("User not found") — this is the client-table equivalent.
  router.post('/change-password', createAuthMiddleware(jwtSecret), async (req, res) => {
    try {
      const ctx = req.user as any
      const currentPassword = validateRequired(req.body?.current_password, 'Current password')
      const newPassword = validateNewPassword(req.body?.new_password, 'New password')
      if (currentPassword === newPassword) {
        return res.status(400).json({ error: 'New password must differ from current password' })
      }
      const client = await models.clients.findById(String(ctx?.sub)) as any
      if (!client) return res.status(404).json({ error: 'Client not found' })
      const valid = await verifyPassword(currentPassword, client.password_hash, passwordSalt)
      if (!valid) return res.status(400).json({ error: 'Current password is incorrect' })
      const password_hash = await hashPassword(newPassword, passwordSalt)
      await models.clients.updateById(client.id, {
        $set: { password_hash, updated_at: new Date().toISOString() },
      })
      return res.json({ message: 'Password changed successfully' })
    } catch (error) {
      return respondWithError(res, error, 500)
    }
  })

  // Client "I forgot my password / please reset it" request. Notifies all
  // admins so the request actually surfaces (admins reset via the client card).
  // Generic response so we never reveal which emails are registered.
  router.post('/request-password-reset', async (req, res) => {
    try {
      const email = String(req.body?.email || '').toLowerCase().trim()
      const note = String(req.body?.note || '').trim().slice(0, 500)
      if (!email) return res.status(400).json({ error: 'Email is required' })
      const client = await models.clients.findActiveByEmail(email) as any
      if (client) {
        try {
          const admins = await models.users.find({ role: 'admin', is_active: 1 }) as any[]
          await createUserNotifications(models, admins.map((a) => a.id), {
            type: 'password_reset_request',
            title: `Password reset requested by client ${client.contact_name || client.company_name || client.email}`,
            body: note
              ? `Client note: ${note} — Reset from Clients → ${client.company_name || client.email}.`
              : `Reset their password from Clients → ${client.company_name || client.email}.`,
            link: `client:${client.id}`,
            actor_id: client.id,
            actor_name: client.contact_name || client.company_name || client.email,
            meta: { client_id: client.id, email: client.email },
          })
        } catch (e) {
          console.warn('[client-auth/request-password-reset] notify failed:', e)
        }
      }
      return res.json({ message: 'If your account exists, the team has been notified to reset your password.' })
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
      // Client-portal tabs are gated by the global `client` role permissions.
      let permissions: string[] = []
      try {
        const roleDoc = (await models.roles.findOne({ key: 'client' })) as any
        if (Array.isArray(roleDoc?.permissions)) permissions = roleDoc.permissions.map((p: unknown) => String(p))
      } catch {}
      return res.json({ client, permissions })
    } catch {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  })

  return router
}
