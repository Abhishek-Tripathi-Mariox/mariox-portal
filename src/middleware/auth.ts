import { verify } from 'hono/jwt'

export async function authMiddleware(c: any, next: any) {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  try {
    const token = authHeader.slice(7)
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256') as any
    c.set('user', payload)
    await next()
  } catch {
    return c.json({ error: 'Invalid token' }, 401)
  }
}

export function requireRole(...roles: string[]) {
  return async (c: any, next: any) => {
    const user = c.get('user')
    if (!user || !roles.includes(user.role)) {
      return c.json({ error: 'Forbidden: Insufficient permissions' }, 403)
    }
    await next()
  }
}
