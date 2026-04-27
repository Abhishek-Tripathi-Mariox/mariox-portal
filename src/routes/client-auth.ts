import { Hono } from 'hono'
import { sign, verify } from 'hono/jwt'
import type { MongoModels } from '../models/mongo-models'

type Bindings = { DB: D1Database; MODELS: MongoModels; JWT_SECRET: string; PASSWORD_SALT: string }
const clientAuth = new Hono<{ Bindings: Bindings }>()

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

// Client signup
clientAuth.post('/signup', async (c) => {
  try {
    const { email, password, company_name, contact_name, phone, website, industry } = await c.req.json()
    if (!email || !password || !company_name || !contact_name) {
      return c.json({ error: 'Email, password, company name and contact name are required' }, 400)
    }
    const existing = await c.env.MODELS.clients.findByEmail(email)
    if (existing) return c.json({ error: 'Email already registered' }, 409)

    const id = 'client-' + Date.now()
    const password_hash = await hashPassword(password, c.env.PASSWORD_SALT)
    const colors = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ec4899','#8b5cf6','#f97316']
    const avatar_color = colors[Math.floor(Math.random() * colors.length)]

    const clientRecord = await c.env.MODELS.clients.createClient({
      id,
      email,
      password_hash,
      company_name,
      contact_name,
      phone: phone || null,
      website: website || null,
      industry: industry || null,
      avatar_color,
      is_active: 1,
      email_verified: 1,
    })

    const payload = { sub: clientRecord.id, email: clientRecord.email, role: 'client', name: contact_name, company: company_name, exp: Math.floor(Date.now()/1000) + 86400*7 }
    const token = await sign(payload, c.env.JWT_SECRET, 'HS256')
    return c.json({ token, client: { id: clientRecord.id, email: clientRecord.email, company_name, contact_name, avatar_color: clientRecord.avatar_color, role: 'client' } }, 201)
  } catch(e: any) {
    return c.json({ error: 'Signup failed: ' + e.message }, 500)
  }
})

// Client login
clientAuth.post('/login', async (c) => {
  try {
    const { email, password } = await c.req.json()
    if (!email || !password) return c.json({ error: 'Email and password required' }, 400)
    const client = await c.env.MODELS.clients.findActiveByEmail(email) as any
    if (!client) return c.json({ error: 'Invalid credentials' }, 401)
    const valid = await verifyPassword(password, client.password_hash, c.env.PASSWORD_SALT)
    if (!valid) return c.json({ error: 'Invalid credentials' }, 401)
    const payload = { sub: client.id, email: client.email, role: 'client', name: client.contact_name, company: client.company_name, exp: Math.floor(Date.now()/1000) + 86400*7 }
    const token = await sign(payload, c.env.JWT_SECRET, 'HS256')
    return c.json({ token, client: { id: client.id, email: client.email, company_name: client.company_name, contact_name: client.contact_name, avatar_color: client.avatar_color, role: 'client' } })
  } catch(e: any) {
    return c.json({ error: 'Login failed' }, 500)
  }
})

// Client profile
clientAuth.get('/me', async (c) => {
  try {
    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401)
    const payload = await verify(authHeader.slice(7), c.env.JWT_SECRET, 'HS256') as any
    const client = await c.env.MODELS.clients.findById(
      payload.sub,
      { projection: { id: 1, email: 1, company_name: 1, contact_name: 1, phone: 1, website: 1, industry: 1, avatar_color: 1 } },
    )
    if (!client) return c.json({ error: 'Not found' }, 404)
    return c.json({ client })
  } catch { return c.json({ error: 'Unauthorized' }, 401) }
})

export default clientAuth
