import { Hono } from 'hono'
import { sign, verify } from 'hono/jwt'

const JWT_ALG = 'HS256'

type Bindings = { DB: D1Database; JWT_SECRET: string; PASSWORD_SALT: string }

const auth = new Hono<{ Bindings: Bindings }>()

// Simple hash function (in production use bcrypt via Workers)
async function hashPassword(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + salt)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const newHash = await hashPassword(password, salt)
  return newHash === hash
}

auth.post('/login', async (c) => {
  try {
    const { email, password } = await c.req.json()
    if (!email || !password) {
      return c.json({ error: 'Email and password are required' }, 400)
    }
    const user = await c.env.DB.prepare(
      'SELECT * FROM users WHERE email = ? AND is_active = 1'
    ).bind(email.toLowerCase().trim()).first() as any

    if (!user) {
      return c.json({ error: 'Invalid credentials' }, 401)
    }
    const valid = await verifyPassword(password, user.password_hash, c.env.PASSWORD_SALT)
    if (!valid) {
      return c.json({ error: 'Invalid credentials' }, 401)
    }
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.full_name,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // 24h
    }
    const token = await sign(payload, c.env.JWT_SECRET, 'HS256')

    return c.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        designation: user.designation,
        avatar_color: user.avatar_color,
      }
    })
  } catch (e: any) {
    console.error('Login error:', e)
    return c.json({ error: 'Authentication failed' }, 500)
  }
})

auth.post('/verify', async (c) => {
  try {
    const { token } = await c.req.json()
    if (!token) return c.json({ valid: false }, 400)
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256') as any
    const user = await c.env.DB.prepare(
      'SELECT id, email, full_name, role, designation, avatar_color FROM users WHERE id = ? AND is_active = 1'
    ).bind(payload.sub).first() as any
    if (!user) return c.json({ valid: false }, 401)
    return c.json({ valid: true, user })
  } catch {
    return c.json({ valid: false }, 401)
  }
})

auth.post('/change-password', async (c) => {
  try {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401)
    const token = authHeader.slice(7)
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256') as any
    const { current_password, new_password } = await c.req.json()
    const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(payload.sub).first() as any
    if (!user) return c.json({ error: 'User not found' }, 404)
    const valid = await verifyPassword(current_password, user.password_hash)
    if (!valid) return c.json({ error: 'Current password is incorrect' }, 400)
    const newHash = await hashPassword(new_password)
    await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(newHash, payload.sub).run()
    return c.json({ message: 'Password changed successfully' })
  } catch (e) {
    return c.json({ error: 'Failed to change password' }, 500)
  }
})

export default auth
