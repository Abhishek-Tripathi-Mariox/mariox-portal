import { Hono } from 'hono'
import { authMiddleware, requireRole } from '../middleware/auth'
import { generateId } from '../utils/helpers'

type Bindings = { DB: D1Database }
type Variables = { user: any }

const leaves = new Hono<{ Bindings: Bindings; Variables: Variables }>()
leaves.use('*', authMiddleware)

leaves.get('/', async (c) => {
  try {
    const user = c.get('user')
    const userId = c.req.query('user_id')
    let query = `
      SELECT l.*, u.full_name, u.avatar_color FROM leaves l
      JOIN users u ON l.user_id = u.id WHERE 1=1
    `
    const params: any[] = []
    if (user.role === 'developer') { query += ' AND l.user_id=?'; params.push(user.sub) }
    else if (userId) { query += ' AND l.user_id=?'; params.push(userId) }
    query += ' ORDER BY l.start_date DESC LIMIT 100'
    const result = await c.env.DB.prepare(query).bind(...params).all()
    return c.json({ data: result.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

leaves.post('/', async (c) => {
  try {
    const user = c.get('user')
    const body = await c.req.json()
    const targetUserId = user.role === 'developer' ? user.sub : (body.user_id || user.sub)
    const id = generateId('lv')
    await c.env.DB.prepare(`
      INSERT INTO leaves (id, user_id, leave_type, start_date, end_date, days_count, reason, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, targetUserId, body.leave_type, body.start_date, body.end_date, body.days_count, body.reason || null, user.role === 'developer' ? 'pending' : 'approved').run()
    return c.json({ message: 'Leave submitted', data: { id } }, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

leaves.patch('/:id/approve', requireRole('admin', 'pm'), async (c) => {
  try {
    const user = c.get('user')
    const { status } = await c.req.json()
    await c.env.DB.prepare('UPDATE leaves SET status=?, approved_by=? WHERE id=?').bind(status, user.sub, c.req.param('id')).run()
    return c.json({ message: `Leave ${status}` })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

leaves.delete('/:id', async (c) => {
  try {
    await c.env.DB.prepare('DELETE FROM leaves WHERE id=?').bind(c.req.param('id')).run()
    return c.json({ message: 'Leave deleted' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

export default leaves
