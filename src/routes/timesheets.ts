import { Hono } from 'hono'
import { authMiddleware, requireRole } from '../middleware/auth'
import { generateId } from '../utils/helpers'

type Bindings = { DB: D1Database }
type Variables = { user: any }

const timesheets = new Hono<{ Bindings: Bindings; Variables: Variables }>()
timesheets.use('*', authMiddleware)

timesheets.get('/', async (c) => {
  try {
    const user = c.get('user')
    const userId = c.req.query('user_id')
    const projectId = c.req.query('project_id')
    const dateFrom = c.req.query('date_from') || c.req.query('from')
    const dateTo = c.req.query('date_to') || c.req.query('to')
    const approval = c.req.query('approval_status')
    const date = c.req.query('date')

    let query = `
      SELECT t.*, u.full_name, u.avatar_color, p.name as project_name, p.code as project_code
      FROM timesheets t
      JOIN users u ON t.user_id = u.id
      JOIN projects p ON t.project_id = p.id
      WHERE 1=1
    `
    const params: any[] = []

    // Developers can only see their own logs
    if (user.role === 'developer') {
      query += ' AND t.user_id = ?'; params.push(user.sub)
    } else if (userId) {
      query += ' AND t.user_id = ?'; params.push(userId)
    }

    if (projectId) { query += ' AND t.project_id = ?'; params.push(projectId) }
    if (date) { query += ' AND t.date = ?'; params.push(date) }
    if (dateFrom) { query += ' AND t.date >= ?'; params.push(dateFrom) }
    if (dateTo) { query += ' AND t.date <= ?'; params.push(dateTo) }
    if (approval) { query += ' AND t.approval_status = ?'; params.push(approval) }

    query += ' ORDER BY t.date DESC, t.created_at DESC LIMIT 500'
    const result = await c.env.DB.prepare(query).bind(...params).all()
    return c.json({ timesheets: result.results, data: result.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

timesheets.post('/', async (c) => {
  try {
    const user = c.get('user')
    const body = await c.req.json()
    const targetUserId = user.role === 'developer' ? user.sub : (body.user_id || user.sub)

    // Validate project assignment
    const assignment = await c.env.DB.prepare(
      'SELECT * FROM project_assignments WHERE user_id = ? AND project_id = ? AND is_active = 1'
    ).bind(targetUserId, body.project_id).first()
    
    if (!assignment && user.role === 'developer') {
      return c.json({ error: 'You are not assigned to this project' }, 403)
    }

    // Check for duplicate (same user, project, date - warn but allow)
    const existing = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM timesheets WHERE user_id = ? AND project_id = ? AND date = ?'
    ).bind(targetUserId, body.project_id, body.date).first() as any

    const id = generateId('ts')
    await c.env.DB.prepare(`
      INSERT INTO timesheets (id, user_id, project_id, date, module_name, task_description, hours_consumed, is_billable, extra_hours_reason, status, blocker_remarks, approval_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, targetUserId, body.project_id, body.date,
      body.module_name || null, body.task_description,
      body.hours_consumed, body.is_billable !== false ? 1 : 0,
      body.extra_hours_reason || null, body.status || 'in_progress',
      body.blocker_remarks || null,
      user.role === 'developer' ? 'pending' : 'approved'
    ).run()

    // Always update consumed hours — the SUM query includes pending and approved entries
    // (it filters out only 'rejected' entries)
    await updateConsumedHours(c.env.DB, body.project_id, targetUserId)

    return c.json({ data: { id, duplicate_warning: existing?.count > 0 }, message: 'Timesheet entry created' }, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

timesheets.put('/:id', async (c) => {
  try {
    const user = c.get('user')
    const id = c.req.param('id')
    const body = await c.req.json()
    const entry = await c.env.DB.prepare('SELECT * FROM timesheets WHERE id = ?').bind(id).first() as any
    if (!entry) return c.json({ error: 'Entry not found' }, 404)

    // Permission check
    if (user.role === 'developer' && entry.user_id !== user.sub) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    if (entry.approval_status === 'approved' && user.role === 'developer') {
      return c.json({ error: 'Cannot edit approved entries' }, 403)
    }

    await c.env.DB.prepare(`
      UPDATE timesheets SET module_name=?, task_description=?, hours_consumed=?, is_billable=?,
      extra_hours_reason=?, status=?, blocker_remarks=?, updated_at=datetime('now') WHERE id=?
    `).bind(
      body.module_name || null, body.task_description, body.hours_consumed,
      body.is_billable ? 1 : 0, body.extra_hours_reason || null,
      body.status || 'in_progress', body.blocker_remarks || null, id
    ).run()

    await updateConsumedHours(c.env.DB, entry.project_id, entry.user_id)
    return c.json({ message: 'Timesheet updated successfully' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

timesheets.delete('/:id', async (c) => {
  try {
    const user = c.get('user')
    const id = c.req.param('id')
    const entry = await c.env.DB.prepare('SELECT * FROM timesheets WHERE id = ?').bind(id).first() as any
    if (!entry) return c.json({ error: 'Entry not found' }, 404)
    if (user.role === 'developer' && entry.user_id !== user.sub) return c.json({ error: 'Forbidden' }, 403)
    if (entry.approval_status === 'approved' && user.role === 'developer') return c.json({ error: 'Cannot delete approved entries' }, 403)

    await c.env.DB.prepare('DELETE FROM timesheets WHERE id = ?').bind(id).run()
    await updateConsumedHours(c.env.DB, entry.project_id, entry.user_id)
    return c.json({ message: 'Timesheet entry deleted' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Approve/reject timesheet
timesheets.patch('/:id/approve', requireRole('admin', 'pm'), async (c) => {
  try {
    const user = c.get('user')
    const id = c.req.param('id')
    const { action, pm_notes } = await c.req.json() // action: 'approve'|'approved' | 'reject'|'rejected'
    const status = (action === 'approve' || action === 'approved') ? 'approved' : 'rejected'
    await c.env.DB.prepare(`
      UPDATE timesheets SET approval_status=?, approved_by=?, approved_at=datetime('now'), pm_notes=?, updated_at=datetime('now')
      WHERE id=?
    `).bind(status, user.sub, pm_notes || null, id).run()

    const entry = await c.env.DB.prepare('SELECT * FROM timesheets WHERE id = ?').bind(id).first() as any
    await updateConsumedHours(c.env.DB, entry.project_id, entry.user_id)
    return c.json({ message: `Timesheet ${status} successfully` })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Bulk approve
timesheets.post('/bulk-approve', requireRole('admin', 'pm'), async (c) => {
  try {
    const user = c.get('user')
    const { ids, action, pm_notes } = await c.req.json()
    const status = action === 'approve' ? 'approved' : 'rejected'
    
    for (const id of ids) {
      await c.env.DB.prepare(`
        UPDATE timesheets SET approval_status=?, approved_by=?, approved_at=datetime('now'), pm_notes=?, updated_at=datetime('now')
        WHERE id=?
      `).bind(status, user.sub, pm_notes || null, id).run()
      const entry = await c.env.DB.prepare('SELECT * FROM timesheets WHERE id = ?').bind(id).first() as any
      if (entry) await updateConsumedHours(c.env.DB, entry.project_id, entry.user_id)
    }
    return c.json({ message: `${ids.length} timesheets ${status}` })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Get weekly summary
timesheets.get('/summary/weekly', async (c) => {
  try {
    const user = c.get('user')
    const userId = c.req.query('user_id') || user.sub
    const effectiveUserId = user.role === 'developer' ? user.sub : userId

    const result = await c.env.DB.prepare(`
      SELECT t.date, p.name as project_name, SUM(t.hours_consumed) as hours,
        t.is_billable
      FROM timesheets t JOIN projects p ON t.project_id = p.id
      WHERE t.user_id = ? AND t.date >= date('now', '-7 days') AND t.approval_status != 'rejected'
      GROUP BY t.date, t.project_id
      ORDER BY t.date DESC
    `).bind(effectiveUserId).all()

    return c.json({ data: result.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Suggested logs (based on yesterday's entries)
timesheets.get('/suggestions', async (c) => {
  try {
    const user = c.get('user')
    const suggestions = await c.env.DB.prepare(`
      SELECT DISTINCT t.project_id, p.name as project_name, t.module_name, t.task_description,
        t.hours_consumed, t.is_billable
      FROM timesheets t JOIN projects p ON t.project_id = p.id
      WHERE t.user_id = ? AND t.date >= date('now', '-3 days')
      ORDER BY t.date DESC LIMIT 5
    `).bind(user.sub).all()
    return c.json({ data: suggestions.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

async function updateConsumedHours(db: D1Database, projectId: string, userId: string) {
  // Update project assignment consumed hours
  await db.prepare(`
    UPDATE project_assignments SET consumed_hours = (
      SELECT COALESCE(SUM(hours_consumed), 0) FROM timesheets
      WHERE project_id = ? AND user_id = ? AND approval_status != 'rejected'
    ) WHERE project_id = ? AND user_id = ?
  `).bind(projectId, userId, projectId, userId).run()

  // Update project total consumed hours
  await db.prepare(`
    UPDATE projects SET consumed_hours = (
      SELECT COALESCE(SUM(hours_consumed), 0) FROM timesheets
      WHERE project_id = ? AND approval_status != 'rejected'
    ), updated_at = datetime('now')
    WHERE id = ?
  `).bind(projectId, projectId).run()
}

export default timesheets
