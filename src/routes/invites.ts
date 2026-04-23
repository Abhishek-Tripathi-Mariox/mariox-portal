import { Hono } from 'hono'
import { authMiddleware, requireRole } from '../middleware/auth'
import { generateId } from '../utils/helpers'

type Bindings = { DB: D1Database }
type Variables = { user: any }

const invites = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Generate a cryptographically random token
function generateToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + 'devtrack-salt-2025')
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// POST /api/invites — create an invite (PM/Admin only)
invites.post('/', authMiddleware, requireRole('admin', 'pm'), async (c) => {
  try {
    const user = c.get('user')
    const body = await c.req.json()
    const { email, full_name, role } = body

    if (!email || !full_name) return c.json({ error: 'email and full_name required' }, 400)
    if (!['developer', 'team', 'pm', 'pc'].includes(role)) {
      return c.json({ error: 'role must be developer, team, pm or pc' }, 400)
    }

    // Check if already a user
    const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email.toLowerCase().trim()).first()
    if (existing) return c.json({ error: 'A user with this email already exists' }, 409)

    // Invalidate any previous open invite for this email
    await c.env.DB.prepare(
      "UPDATE user_invites SET expires_at = datetime('now') WHERE email = ? AND accepted_at IS NULL"
    ).bind(email.toLowerCase().trim()).run()

    const id = generateId('inv')
    const token = generateToken()
    // Expires in 7 days
    await c.env.DB.prepare(`
      INSERT INTO user_invites (id, email, full_name, role, token, invited_by, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+7 days'))
    `).bind(id, email.toLowerCase().trim(), full_name, role, token, user.sub).run()

    // In a real app we'd email this link; for now we return it so the PM can share it.
    return c.json({
      data: { id, token, invite_url: `/accept-invite?token=${token}` },
      message: 'Invite created. Share the link with the user.'
    }, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// GET /api/invites — list pending invites (PM/Admin)
invites.get('/', authMiddleware, requireRole('admin', 'pm'), async (c) => {
  try {
    const rows = await c.env.DB.prepare(`
      SELECT i.*, u.full_name as invited_by_name
      FROM user_invites i
      LEFT JOIN users u ON i.invited_by = u.id
      WHERE i.accepted_at IS NULL AND i.expires_at > datetime('now')
      ORDER BY i.created_at DESC
    `).all()
    return c.json({ data: rows.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// DELETE /api/invites/:id — revoke an invite
invites.delete('/:id', authMiddleware, requireRole('admin', 'pm'), async (c) => {
  try {
    await c.env.DB.prepare(
      "UPDATE user_invites SET expires_at = datetime('now') WHERE id = ?"
    ).bind(c.req.param('id')).run()
    return c.json({ message: 'Invite revoked' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// GET /api/invites/validate/:token — check if a token is valid (public, no auth)
invites.get('/validate/:token', async (c) => {
  try {
    const token = c.req.param('token')
    const row = await c.env.DB.prepare(`
      SELECT email, full_name, role, expires_at, accepted_at
      FROM user_invites WHERE token = ?
    `).bind(token).first() as any

    if (!row) return c.json({ valid: false, error: 'Invalid invite token' }, 404)
    if (row.accepted_at) return c.json({ valid: false, error: 'This invite has already been used' }, 410)
    if (new Date(row.expires_at) < new Date()) return c.json({ valid: false, error: 'This invite has expired' }, 410)

    return c.json({
      valid: true,
      data: { email: row.email, full_name: row.full_name, role: row.role }
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// POST /api/invites/accept/:token — accept an invite and create the user (public, no auth)
invites.post('/accept/:token', async (c) => {
  try {
    const token = c.req.param('token')
    const { password } = await c.req.json()

    if (!password || password.length < 8) {
      return c.json({ error: 'Password must be at least 8 characters' }, 400)
    }

    const row = await c.env.DB.prepare(`
      SELECT * FROM user_invites WHERE token = ?
    `).bind(token).first() as any

    if (!row) return c.json({ error: 'Invalid invite' }, 404)
    if (row.accepted_at) return c.json({ error: 'Invite already used' }, 410)
    if (new Date(row.expires_at) < new Date()) return c.json({ error: 'Invite expired' }, 410)

    // Make sure email isn't now taken by another signup path
    const dup = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(row.email).first()
    if (dup) return c.json({ error: 'A user with this email already exists' }, 409)

    const userId = generateId('user')
    const passwordHash = await hashPassword(password)

    await c.env.DB.prepare(`
      INSERT INTO users (id, email, password_hash, full_name, role, avatar_color, is_active, must_change_password)
      VALUES (?, ?, ?, ?, ?, ?, 1, 0)
    `).bind(userId, row.email, passwordHash, row.full_name, row.role, '#6366f1').run()

    await c.env.DB.prepare(`
      UPDATE user_invites SET accepted_at = datetime('now'), user_id = ? WHERE id = ?
    `).bind(userId, row.id).run()

    return c.json({ message: 'Account created. You can now log in.' }, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

export default invites
