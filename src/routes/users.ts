import { Hono } from 'hono'
import { authMiddleware, requireRole } from '../middleware/auth'
import { generateId } from '../utils/helpers'

type Bindings = { DB: D1Database }
type Variables = { user: any }

const users = new Hono<{ Bindings: Bindings; Variables: Variables }>()

users.use('*', authMiddleware)

// Get all users (developers/PMs)
users.get('/', async (c) => {
  try {
    const role = c.req.query('role')
    const active = c.req.query('active')
    let query = `
      SELECT u.*, 
        (SELECT COUNT(*) FROM project_assignments pa WHERE pa.user_id = u.id AND pa.is_active = 1) as project_count,
        (SELECT COALESCE(SUM(pa.allocated_hours), 0) FROM project_assignments pa WHERE pa.user_id = u.id AND pa.is_active = 1) as total_allocated,
        (SELECT COALESCE(SUM(t.hours_consumed), 0) FROM timesheets t WHERE t.user_id = u.id AND t.approval_status != 'rejected' AND t.date >= date('now', 'start of month')) as monthly_consumed
      FROM users u WHERE 1=1
    `
    const params: any[] = []
    if (role) { query += ' AND u.role = ?'; params.push(role) }
    if (active !== undefined) { query += ' AND u.is_active = ?'; params.push(active === 'true' ? 1 : 0) }
    query += ' ORDER BY u.full_name'

    const result = await c.env.DB.prepare(query).bind(...params).all()
    return c.json({ users: result.results, data: result.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Get single user
users.get('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const user = await c.env.DB.prepare(`
      SELECT u.*,
        pm.full_name as pm_name,
        (SELECT COALESCE(SUM(t.hours_consumed), 0) FROM timesheets t WHERE t.user_id = u.id AND t.approval_status != 'rejected' AND t.date >= date('now', 'start of month')) as monthly_consumed,
        (SELECT COALESCE(SUM(t.hours_consumed), 0) FROM timesheets t WHERE t.user_id = u.id AND t.approval_status != 'rejected') as total_consumed
      FROM users u
      LEFT JOIN users pm ON u.reporting_pm_id = pm.id
      WHERE u.id = ?
    `).bind(id).first()
    if (!user) return c.json({ error: 'User not found' }, 404)

    const assignments = await c.env.DB.prepare(`
      SELECT pa.*, p.name as project_name, p.code as project_code, p.status as project_status, p.priority,
        (SELECT COALESCE(SUM(t.hours_consumed),0) FROM timesheets t WHERE t.user_id = pa.user_id AND t.project_id = pa.project_id AND t.approval_status != 'rejected') as logged_hours
      FROM project_assignments pa
      JOIN projects p ON pa.project_id = p.id
      WHERE pa.user_id = ? AND pa.is_active = 1
    `).bind(id).all()

    const leaves = await c.env.DB.prepare(`
      SELECT * FROM leaves WHERE user_id = ? ORDER BY start_date DESC LIMIT 10
    `).bind(id).all()

    const recentLogs = await c.env.DB.prepare(`
      SELECT t.*, p.name as project_name FROM timesheets t
      JOIN projects p ON t.project_id = p.id
      WHERE t.user_id = ? ORDER BY t.date DESC LIMIT 20
    `).bind(id).all()

    return c.json({ data: { ...user, assignments: assignments.results, leaves: leaves.results, recent_logs: recentLogs.results } })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Create user (PM/Admin only)
users.post('/', requireRole('admin', 'pm'), async (c) => {
  try {
    const body = await c.req.json()
    const id = generateId('user')
    const encoder = new TextEncoder()
    const data = encoder.encode((body.password || 'Password@123') + 'devtrack-salt-2025')
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

    await c.env.DB.prepare(`
      INSERT INTO users (id, email, password_hash, full_name, role, phone, designation, tech_stack, skill_tags, joining_date, daily_work_hours, working_days_per_week, hourly_cost, monthly_available_hours, reporting_pm_id, avatar_color, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, body.email.toLowerCase(), passwordHash, body.full_name, body.role || 'developer',
      body.phone || null, body.designation || null,
      body.tech_stack ? JSON.stringify(body.tech_stack) : null,
      body.skill_tags ? JSON.stringify(body.skill_tags) : null,
      body.joining_date || null,
      body.daily_work_hours || 8, body.working_days_per_week || 5,
      body.hourly_cost || 0,
      body.monthly_available_hours || 160,
      body.reporting_pm_id || null,
      body.avatar_color || '#6366f1',
      body.remarks || null
    ).run()

    const newUser = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first()
    return c.json({ data: newUser, message: 'Developer created successfully' }, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Update user
users.put('/:id', requireRole('admin', 'pm'), async (c) => {
  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    await c.env.DB.prepare(`
      UPDATE users SET full_name=?, phone=?, designation=?, tech_stack=?, skill_tags=?, 
      daily_work_hours=?, working_days_per_week=?, hourly_cost=?, monthly_available_hours=?,
      reporting_pm_id=?, remarks=?, is_active=?, updated_at=datetime('now')
      WHERE id=?
    `).bind(
      body.full_name, body.phone, body.designation,
      body.tech_stack ? JSON.stringify(body.tech_stack) : null,
      body.skill_tags ? JSON.stringify(body.skill_tags) : null,
      body.daily_work_hours || 8, body.working_days_per_week || 5,
      body.hourly_cost || 0, body.monthly_available_hours || 160,
      body.reporting_pm_id || null, body.remarks || null,
      body.is_active !== undefined ? (body.is_active ? 1 : 0) : 1, id
    ).run()
    const updated = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first()
    return c.json({ data: updated, message: 'Developer updated successfully' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Toggle active status
users.patch('/:id/status', requireRole('admin', 'pm'), async (c) => {
  try {
    const id = c.req.param('id')
    const { is_active } = await c.req.json()
    await c.env.DB.prepare('UPDATE users SET is_active=?, updated_at=datetime(\'now\') WHERE id=?').bind(is_active ? 1 : 0, id).run()
    return c.json({ message: `Developer ${is_active ? 'activated' : 'deactivated'} successfully` })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Get developer utilization
users.get('/:id/utilization', async (c) => {
  try {
    const id = c.req.param('id')
    const month = c.req.query('month') || new Date().toISOString().slice(0, 7)
    const [year, mon] = month.split('-').map(Number)
    const startDate = `${month}-01`
    const lastDay = new Date(year, mon, 0).getDate()
    const endDate = `${month}-${String(lastDay).padStart(2, '0')}`

    const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first() as any
    if (!user) return c.json({ error: 'User not found' }, 404)

    // Calculate leaves in month
    const leaves = await c.env.DB.prepare(`
      SELECT SUM(days_count) as total_leave_days FROM leaves 
      WHERE user_id = ? AND status = 'approved' AND start_date >= ? AND end_date <= ?
    `).bind(id, startDate, endDate).first() as any

    // Count holidays
    const holidays = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM holidays WHERE date >= ? AND date <= ?
    `).bind(startDate, endDate).first() as any

    const workingDays = user.working_days_per_week === 5 ? 22 : 26
    const leaveDays = leaves?.total_leave_days || 0
    const holidayCount = holidays?.count || 0
    const effectiveDays = Math.max(0, workingDays - leaveDays - holidayCount)
    const capacity = effectiveDays * (user.daily_work_hours || 8)

    // Logged hours this month
    const logged = await c.env.DB.prepare(`
      SELECT COALESCE(SUM(hours_consumed), 0) as total FROM timesheets
      WHERE user_id = ? AND date >= ? AND date <= ? AND approval_status != 'rejected'
    `).bind(id, startDate, endDate).first() as any

    const allocated = await c.env.DB.prepare(`
      SELECT COALESCE(SUM(allocated_hours), 0) as total FROM project_assignments
      WHERE user_id = ? AND is_active = 1
    `).bind(id).first() as any

    const loggedHours = logged?.total || 0
    const allocatedHours = allocated?.total || 0
    const utilizationPercent = capacity > 0 ? Math.round((loggedHours / capacity) * 100) : 0

    return c.json({
      data: {
        user_id: id,
        month,
        working_days: workingDays,
        leave_days: leaveDays,
        holiday_count: holidayCount,
        effective_days: effectiveDays,
        capacity_hours: capacity,
        allocated_hours: allocatedHours,
        logged_hours: loggedHours,
        remaining_hours: Math.max(0, capacity - loggedHours),
        idle_hours: Math.max(0, capacity - allocatedHours),
        utilization_percent: utilizationPercent,
        status: utilizationPercent >= 100 ? 'overloaded' : utilizationPercent >= 70 ? 'optimal' : utilizationPercent >= 50 ? 'underutilized' : 'idle'
      }
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

export default users
