import type { Router } from 'express'
import { Router as createRouter } from 'express'
import { SignJWT, jwtVerify } from 'jose'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware } from '../express-middleware/auth'
import {
  validateLoginInput,
  validateNewPassword,
  validateRequired,
  respondWithError,
} from '../validators'

const encoder = new TextEncoder()

function normalizeRole(role: string) {
  // Lowercase + trim only. Earlier this function aliased pc→pm and team→developer
  // for legacy reasons; that broke the new role-based permission system because
  // a user whose DB role was "team" came back from /login and /verify as
  // "developer", so the frontend never saw the team-only sidebar/access rules.
  return String(role || '').toLowerCase().trim()
}

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

export function createAuthRouter(models: MongoModels, jwtSecret: string, passwordSalt: string): Router {
  const router = createRouter()
  const authMiddleware = createAuthMiddleware(jwtSecret)

  router.post('/login', async (req, res) => {
    try {
      const { email, password } = validateLoginInput(req.body?.email, req.body?.password)

      const user = await models.users.findActiveByEmail(email) as any
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' })
      }

      const valid = await verifyPassword(password, user.password_hash, passwordSalt)
      if (!valid) {
        return res.status(401).json({ error: 'Invalid credentials' })
      }

      const payload = {
        sub: user.id,
        email: user.email,
        role: normalizeRole(user.role),
        name: user.full_name,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
      }
      const token = await signToken(payload, jwtSecret)

      return res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: normalizeRole(user.role),
          designation: user.designation,
          avatar_color: user.avatar_color,
        },
      })
    } catch (error) {
      console.error('Login error:', error)
      return respondWithError(res, error, 500)
    }
  })

  router.post('/verify', async (req, res) => {
    try {
      const { token } = req.body || {}
      if (!token) return res.status(400).json({ valid: false })
      const payload = (await jwtVerify(token, encoder.encode(jwtSecret))).payload as any
      const user = await models.users.findActiveById(payload.sub, {
        projection: { id: 1, email: 1, full_name: 1, role: 1, designation: 1, avatar_color: 1 },
      }) as any
      if (!user) return res.status(401).json({ valid: false })
      // Cache-busting so a stale 200 can't sit in any proxy/browser cache —
      // role/designation changes need to take effect on the next reload.
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
      res.setHeader('Pragma', 'no-cache')
      return res.json({
        valid: true,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: normalizeRole(user.role),
          designation: user.designation,
          avatar_color: user.avatar_color,
        },
      })
    } catch {
      return res.status(401).json({ valid: false })
    }
  })

  router.post('/change-password', authMiddleware, async (req, res) => {
    try {
      const userCtx = req.user as any
      const currentPassword = validateRequired(req.body?.current_password, 'Current password')
      const newPassword = validateNewPassword(req.body?.new_password, 'New password')
      if (currentPassword === newPassword) {
        return res.status(400).json({ error: 'New password must differ from current password' })
      }
      const user = await models.users.findById(userCtx.sub) as any
      if (!user) return res.status(404).json({ error: 'User not found' })
      const valid = await verifyPassword(currentPassword, user.password_hash, passwordSalt)
      if (!valid) return res.status(400).json({ error: 'Current password is incorrect' })
      const newHash = await hashPassword(newPassword, passwordSalt)
      await models.users.updatePassword(userCtx.sub, newHash)
      return res.json({ message: 'Password changed successfully' })
    } catch (error) {
      return respondWithError(res, error, 500)
    }
  })

  return router
}
