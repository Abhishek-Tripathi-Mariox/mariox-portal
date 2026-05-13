import type { Router } from 'express'
import { Router as createRouter } from 'express'
import { SignJWT, jwtVerify } from 'jose'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, requireRole } from '../express-middleware/auth'
import {
  validateLoginInput,
  validateNewPassword,
  validateRequired,
  respondWithError,
} from '../validators'
import { createUserNotification, createUserNotifications } from './notifications'

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

// Look up the granular permission keys assigned to a role in the roles
// collection. Admins always get an empty array back here — the frontend
// short-circuits "admin sees everything" without consulting this list, so
// we don't need to enumerate every key just to satisfy the catalogue.
async function loadRolePermissions(models: MongoModels, role: string): Promise<string[]> {
  const key = String(role || '').toLowerCase().trim()
  if (!key || key === 'admin') return []
  try {
    const doc = (await models.roles.findOne({ key })) as any
    const perms = Array.isArray(doc?.permissions) ? doc.permissions : []
    return perms.map((p: any) => String(p)).filter(Boolean)
  } catch {
    return []
  }
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
      const permissions = await loadRolePermissions(models, user.role)

      return res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: normalizeRole(user.role),
          designation: user.designation,
          avatar_color: user.avatar_color,
          must_change_password: Number(user.must_change_password) === 1 ? 1 : 0,
          permissions,
          impersonated_by: null,
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
        projection: { id: 1, email: 1, full_name: 1, role: 1, designation: 1, avatar_color: 1, must_change_password: 1 },
      }) as any
      if (!user) return res.status(401).json({ valid: false })
      // Cache-busting so a stale 200 can't sit in any proxy/browser cache —
      // role/designation changes need to take effect on the next reload.
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
      res.setHeader('Pragma', 'no-cache')
      const permissions = await loadRolePermissions(models, user.role)
      // Surface the impersonation context so the frontend can show a
      // "you're acting as X — return to admin" banner. Only present when
      // the token carries imp_sub (set by the /impersonate endpoint).
      const impersonatedBy = payload.imp_sub
        ? { id: String(payload.imp_sub), name: String(payload.imp_name || '') }
        : null
      return res.json({
        valid: true,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: normalizeRole(user.role),
          designation: user.designation,
          avatar_color: user.avatar_color,
          must_change_password: Number(user.must_change_password) === 1 ? 1 : 0,
          permissions,
          impersonated_by: impersonatedBy,
        },
      })
    } catch {
      return res.status(401).json({ valid: false })
    }
  })

  // ─── Impersonation ────────────────────────────────────────────────
  // Lets an admin / PM / PC / sales manager / sales TL log in AS another
  // user without knowing their password. Issues a fresh token whose `sub`
  // is the target user, and carries the original requester's identity in
  // `imp_sub` / `imp_name` so the frontend can show a return banner.
  // Hard-coded guards:
  //   - Can't impersonate yourself (no-op).
  //   - Can't impersonate an admin unless you ARE an admin (privilege
  //     escalation).
  //   - Can't chain impersonation (an already-impersonating token can't
  //     start a new impersonation; they must end the current one first).
  router.post('/impersonate/:userId', authMiddleware, async (req, res) => {
    try {
      const ctx = req.user as any
      if (ctx?.imp_sub) {
        return res.status(409).json({ error: 'Already impersonating — end the current session first' })
      }
      const requesterRole = String(ctx?.role || '').toLowerCase().trim()
      const allowedRoles = ['admin', 'pm', 'pc', 'sales_manager', 'sales_tl']
      if (!allowedRoles.includes(requesterRole)) {
        return res.status(403).json({ error: 'Not allowed to impersonate' })
      }
      const targetId = String(req.params.userId || '').trim()
      if (!targetId) return res.status(400).json({ error: 'Target user is required' })
      if (targetId === String(ctx?.sub || '')) {
        return res.status(400).json({ error: "You're already this user" })
      }
      const target = await models.users.findActiveById(targetId) as any
      if (!target) return res.status(404).json({ error: 'User not found or inactive' })
      const targetRole = String(target.role || '').toLowerCase().trim()
      if (targetRole === 'admin' && requesterRole !== 'admin') {
        return res.status(403).json({ error: 'Only an admin can impersonate another admin' })
      }
      const requester = await models.users.findById(String(ctx?.sub || '')) as any

      const payload = {
        sub: target.id,
        email: target.email,
        role: normalizeRole(target.role),
        name: target.full_name,
        // Audit trail: who actually triggered this session.
        imp_sub: ctx.sub,
        imp_name: requester?.full_name || ctx?.name || '',
        // Short-lived — impersonation shouldn't outlive an admin's attention.
        exp: Math.floor(Date.now() / 1000) + 60 * 60,
      }
      const token = await signToken(payload, jwtSecret)
      const permissions = await loadRolePermissions(models, target.role)

      return res.json({
        token,
        user: {
          id: target.id,
          email: target.email,
          full_name: target.full_name,
          role: normalizeRole(target.role),
          designation: target.designation,
          avatar_color: target.avatar_color,
          must_change_password: Number(target.must_change_password) === 1 ? 1 : 0,
          permissions,
          impersonated_by: { id: String(ctx.sub), name: requester?.full_name || ctx?.name || '' },
        },
      })
    } catch (error: any) {
      console.error('Impersonate error:', error)
      return respondWithError(res, error, 500)
    }
  })

  // End an active impersonation session and re-issue a token for the
  // original requester. Frontend calls this from the "Return to admin"
  // banner so the user doesn't have to log in again.
  router.post('/end-impersonation', authMiddleware, async (req, res) => {
    try {
      const ctx = req.user as any
      if (!ctx?.imp_sub) {
        return res.status(400).json({ error: 'Not currently impersonating' })
      }
      const original = await models.users.findActiveById(String(ctx.imp_sub)) as any
      if (!original) {
        return res.status(404).json({ error: 'Original account is no longer active' })
      }
      const payload = {
        sub: original.id,
        email: original.email,
        role: normalizeRole(original.role),
        name: original.full_name,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
      }
      const token = await signToken(payload, jwtSecret)
      const permissions = await loadRolePermissions(models, original.role)
      return res.json({
        token,
        user: {
          id: original.id,
          email: original.email,
          full_name: original.full_name,
          role: normalizeRole(original.role),
          designation: original.designation,
          avatar_color: original.avatar_color,
          must_change_password: Number(original.must_change_password) === 1 ? 1 : 0,
          permissions,
          impersonated_by: null,
        },
      })
    } catch (error: any) {
      console.error('End-impersonation error:', error)
      return respondWithError(res, error, 500)
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
      // User chose this password themselves — clear the forced-change flag.
      await models.users.updatePassword(userCtx.sub, newHash, false)
      return res.json({ message: 'Password changed successfully' })
    } catch (error) {
      return respondWithError(res, error, 500)
    }
  })

  // Public: a user who forgot their password tells us their email. We don't
  // expose whether the email exists (security), but if it does we drop a
  // notification into every admin's bell so an admin can reset it from the
  // Team page. No SMTP needed for this internal portal.
  router.post('/forgot-password', async (req, res) => {
    try {
      const email = String(req.body?.email || '').toLowerCase().trim()
      if (!email) return res.status(400).json({ error: 'Email is required' })
      const user = await models.users.findByEmail(email) as any
      if (user && Number(user.is_active) === 1) {
        try {
          const admins = await models.users.find({ role: 'admin', is_active: 1 }) as any[]
          await createUserNotifications(models, admins.map((a: any) => a.id), {
            type: 'password_reset_request',
            title: `Password reset requested by ${user.full_name || user.email}`,
            body: `Reset their password from Team → user actions.`,
            link: `user:${user.id}`,
            actor_id: user.id,
            actor_name: user.full_name,
            meta: { user_id: user.id, email: user.email },
          })
        } catch (e) {
          console.warn('[auth/forgot-password] notify failed:', e)
        }
      }
      // Generic response — never reveal which emails are registered.
      return res.json({ message: 'If your account exists, the admin has been notified to reset your password.' })
    } catch (error) {
      return respondWithError(res, error, 500)
    }
  })

  // Admin-only: reset another user's password. Used by the Team page.
  // The affected user gets a notification so they know the password changed.
  router.post('/admin-reset-password', authMiddleware, requireRole('admin'), async (req, res) => {
    try {
      const adminCtx = req.user as any
      const userId = String(req.body?.user_id || '').trim()
      const newPassword = validateNewPassword(req.body?.new_password, 'New password')
      if (!userId) return res.status(400).json({ error: 'user_id is required' })
      const target = await models.users.findById(userId) as any
      if (!target) return res.status(404).json({ error: 'User not found' })
      const newHash = await hashPassword(newPassword, passwordSalt)
      // Admin-issued password — force a change on next login.
      await models.users.updatePassword(userId, newHash, true)
      try {
        const admin = await models.users.findById(adminCtx.sub) as any
        await createUserNotification(models, {
          user_id: userId,
          type: 'password_reset_done',
          title: 'Your password was reset',
          body: `${admin?.full_name || 'An admin'} reset your password. Please sign in with the new one.`,
          link: 'profile:me',
          actor_id: adminCtx.sub,
          actor_name: admin?.full_name || 'Admin',
          meta: { user_id: userId },
        })
      } catch (e) {
        console.warn('[auth/admin-reset] notify failed:', e)
      }
      return res.json({ message: 'Password reset for ' + (target.full_name || target.email) })
    } catch (error) {
      return respondWithError(res, error, 500)
    }
  })

  // Admin-only: issue a session token for any staff user without their
  // password, so admins can troubleshoot a member's view from the team list.
  router.post('/impersonate/:id', authMiddleware, requireRole('admin'), async (req, res) => {
    try {
      const adminCtx = req.user as any
      const userId = String(req.params.id || '').trim()
      if (!userId) return res.status(400).json({ error: 'user_id is required' })
      const target = await models.users.findById(userId) as any
      if (!target) return res.status(404).json({ error: 'User not found' })
      if (Number(target.is_active ?? 1) !== 1) {
        return res.status(400).json({ error: 'User is inactive' })
      }
      const payload = {
        sub: target.id,
        email: target.email,
        role: normalizeRole(target.role),
        name: target.full_name,
        impersonated_by: adminCtx?.sub || null,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }
      const token = await signToken(payload, jwtSecret)
      return res.json({
        token,
        user: {
          id: target.id,
          email: target.email,
          full_name: target.full_name,
          role: normalizeRole(target.role),
          designation: target.designation,
          avatar_color: target.avatar_color,
          must_change_password: 0,
        },
      })
    } catch (error) {
      return respondWithError(res, error, 500)
    }
  })

  return router
}
