import { Hono } from 'hono'
import { authMiddleware, requireRole } from '../middleware/auth'
import { generateId } from '../utils/helpers'

type Bindings = { DB: D1Database }
type Variables = { user: any }

const alerts = new Hono<{ Bindings: Bindings; Variables: Variables }>()
alerts.use('*', authMiddleware)

alerts.get('/', async (c) => {
  try {
    const user = c.get('user')
    let query = `
      SELECT a.*, u.full_name as user_name, p.name as project_name
      FROM alerts a
      LEFT JOIN users u ON a.user_id = u.id
      LEFT JOIN projects p ON a.project_id = p.id
      WHERE a.is_dismissed = 0
    `
    const params: any[] = []
    if (user.role === 'developer') {
      query += ' AND (a.user_id = ? OR a.user_id IS NULL)'
      params.push(user.sub)
    }
    query += ' ORDER BY a.created_at DESC LIMIT 50'
    const result = await c.env.DB.prepare(query).bind(...params).all()
    const unreadCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM alerts WHERE is_read=0 AND is_dismissed=0'
    ).first() as any
    return c.json({ alerts: result.results, data: result.results, unread_count: unreadCount?.count || 0 })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

alerts.patch('/:id/read', async (c) => {
  try {
    await c.env.DB.prepare('UPDATE alerts SET is_read=1 WHERE id=?').bind(c.req.param('id')).run()
    return c.json({ message: 'Alert marked as read' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

alerts.patch('/:id/dismiss', async (c) => {
  try {
    await c.env.DB.prepare('UPDATE alerts SET is_dismissed=1, is_read=1 WHERE id=?').bind(c.req.param('id')).run()
    return c.json({ message: 'Alert dismissed' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

alerts.post('/mark-all-read', async (c) => {
  try {
    await c.env.DB.prepare('UPDATE alerts SET is_read=1 WHERE is_dismissed=0').run()
    return c.json({ message: 'All alerts marked as read' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// PATCH /api/alerts/read-all (alias)
alerts.patch('/read-all', async (c) => {
  try {
    await c.env.DB.prepare('UPDATE alerts SET is_read=1 WHERE is_dismissed=0').run()
    return c.json({ message: 'All alerts marked as read' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Generate alerts (run as a check)
alerts.post('/generate', requireRole('admin', 'pm'), async (c) => {
  try {
    const newAlerts: any[] = []
    // Check for project burn > 80%
    const burnProjects = await c.env.DB.prepare(`
      SELECT * FROM projects WHERE status='active' AND total_allocated_hours > 0
      AND consumed_hours / total_allocated_hours >= 0.8
    `).all()
    for (const p of burnProjects.results as any[]) {
      const pct = Math.round((p.consumed_hours / p.total_allocated_hours) * 100)
      const existing = await c.env.DB.prepare('SELECT id FROM alerts WHERE project_id=? AND type=? AND is_dismissed=0').bind(p.id, 'burn').first()
      if (!existing) {
        const id = generateId('alert')
        newAlerts.push({ id, type: 'burn', severity: pct >= 100 ? 'critical' : 'warning', title: `${p.name} Hours ${pct >= 100 ? 'Exceeded' : 'Near Limit'}`, message: `Project ${p.name} has consumed ${pct}% of allocated hours`, project_id: p.id })
      }
    }
    // Check for missing logs (developers with no log today)
    const today = new Date().toISOString().split('T')[0]
    const devs = await c.env.DB.prepare('SELECT id, full_name FROM users WHERE role=\'developer\' AND is_active=1').all()
    for (const dev of devs.results as any[]) {
      const log = await c.env.DB.prepare('SELECT id FROM timesheets WHERE user_id=? AND date=?').bind(dev.id, today).first()
      if (!log) {
        const existing = await c.env.DB.prepare('SELECT id FROM alerts WHERE user_id=? AND type=\'missing_log\' AND date(created_at)=date(\'now\') AND is_dismissed=0').bind(dev.id).first()
        if (!existing) {
          const id = generateId('alert')
          newAlerts.push({ id, type: 'missing_log', severity: 'info', title: `Missing Log: ${dev.full_name}`, message: `${dev.full_name} has not logged any hours today`, user_id: dev.id })
        }
      }
    }

    for (const alert of newAlerts) {
      await c.env.DB.prepare(`INSERT OR IGNORE INTO alerts (id, type, severity, title, message, user_id, project_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(alert.id, alert.type, alert.severity, alert.title, alert.message, alert.user_id || null, alert.project_id || null).run()
    }

    return c.json({ message: `Generated ${newAlerts.length} new alerts`, count: newAlerts.length })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

export default alerts
