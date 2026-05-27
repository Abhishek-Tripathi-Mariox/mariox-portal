import type { NextFunction, Request, Response } from 'express'
import { jwtVerify } from 'jose'
import type { MongoModels } from '../models/mongo-models'

const encoder = new TextEncoder()

// Has-permission check used by route handlers that want to gate access on
// granular permission keys (e.g. `clients.view_all`) rather than a fixed
// role list. Admin always passes. A non-admin passes if their role doc in
// the `roles` collection contains AT LEAST ONE of the requested keys.
//
// Use this together with the role allowlist in each route: pass either
// check, that way old role-gated flows keep working AND new permission
// grants take effect immediately when admin toggles them in Settings.
export async function userHasAnyPermission(
  models: MongoModels,
  user: any,
  ...keys: string[]
): Promise<boolean> {
  const role = String(user?.role || '').toLowerCase().trim()
  if (role === 'admin') return true
  if (!role || !keys.length) return false
  try {
    const doc = (await models.roles.findOne({ key: role })) as any
    const perms: string[] = Array.isArray(doc?.permissions) ? doc.permissions : []
    for (const k of keys) if (perms.includes(k)) return true
    return false
  } catch {
    return false
  }
}

async function verifyToken(token: string, secret: string) {
  const { payload } = await jwtVerify(token, encoder.encode(secret))
  return payload
}

export function createAuthMiddleware(jwtSecret: string) {
  return async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    try {
      const token = authHeader.slice(7)
      req.user = await verifyToken(token, jwtSecret)
      next()
    } catch {
      return res.status(401).json({ error: 'Invalid token' })
    }
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as any
    if (!user || !roles.includes(String(user.role || '').toLowerCase())) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' })
    }
    next()
  }
}

// Permission-based gate. Admin always passes; everyone else needs at least
// one of the listed permission keys (looked up from their role doc).
//
// Async because it reads the roles collection. Used by HR routes so admin
// can grant module access to any role (e.g. a new `hr` role) without
// touching code.
export function requireAnyPermission(models: MongoModels, ...keys: string[]) {
  return async function permissionMiddleware(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user as any
      const ok = await userHasAnyPermission(models, user, ...keys)
      if (!ok) return res.status(403).json({ error: 'Forbidden: Insufficient permissions' })
      return next()
    } catch {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' })
    }
  }
}

// Ownership-scoped permission check.
//
// Modules like portfolios / scopes / quotations / meetings expose three tiers:
//   - <module>.<action>_own → only records the user created themselves
//   - <module>.<action>     → full access (legacy "edit any" / "delete any")
//   - <module>.<action>_all → full access (new explicit name)
//
// Pass the action key ("edit", "delete", "view") and the record (which must
// have a `created_by` field). Returns true if the user can perform the action
// on that specific record. Admin always passes.
//
// For meetings the "owner" check is delegated via an optional isOwner override
// because participants are also considered owners for view purposes.
export async function userCanActOn(
  models: MongoModels,
  user: any,
  module: string,
  action: 'view' | 'edit' | 'delete',
  record: any,
  opts: { isOwner?: (r: any) => boolean } = {},
): Promise<boolean> {
  if (!record) return false
  const role = String(user?.role || '').toLowerCase().trim()
  if (role === 'admin') return true
  const userId = String(user?.sub || user?.id || '')
  if (!userId) return false
  // Full-access keys: <module>.<action>_all + legacy <module>.<action>
  // (the latter exists for edit/delete only — view never had a legacy key).
  const fullKeys: string[] = [`${module}.${action}_all`]
  if (action !== 'view') fullKeys.push(`${module}.${action}`)
  if (await userHasAnyPermission(models, user, ...fullKeys)) return true
  // Scoped key: requires the user to own the record.
  const ownKey = `${module}.${action}_own`
  if (!(await userHasAnyPermission(models, user, ownKey))) return false
  if (opts.isOwner) return opts.isOwner(record)
  return String(record.created_by || '') === userId
}

// List-scoping helper. Returns one of:
//   - 'all'   → user can see every record
//   - 'own'   → user only sees records they own
//   - 'none'  → user has no read access at all
//
// Same precedence as userCanActOn.
export async function userViewScope(
  models: MongoModels,
  user: any,
  module: string,
): Promise<'all' | 'own' | 'none'> {
  const role = String(user?.role || '').toLowerCase().trim()
  if (role === 'admin') return 'all'
  const fullKeys = [`${module}.view_all`, `${module}.edit_all`, `${module}.edit`, `${module}.delete_all`, `${module}.delete`]
  if (await userHasAnyPermission(models, user, ...fullKeys)) return 'all'
  if (await userHasAnyPermission(models, user, `${module}.view_own`, `${module}.edit_own`, `${module}.delete_own`)) return 'own'
  return 'none'
}
