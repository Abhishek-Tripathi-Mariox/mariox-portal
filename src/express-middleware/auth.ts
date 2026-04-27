import type { NextFunction, Request, Response } from 'express'
import { jwtVerify } from 'jose'

const encoder = new TextEncoder()

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
