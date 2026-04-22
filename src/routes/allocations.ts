import { Hono } from 'hono'
import { authMiddleware, requireRole } from '../middleware/auth'

type Bindings = { DB: D1Database }
type Variables = { user: any }

const allocations = new Hono<{ Bindings: Bindings; Variables: Variables }>()
allocations.use('*', authMiddleware)

allocations.get('/', async (c) => {
  try {
    const projectId = c.req.query('project_id')
    const userId = c.req.query('user_id')
    let query = `
      SELECT pa.*, u.full_name, u.designation, u.avatar_color, u.monthly_available_hours,
        p.name as project_name, p.code as project_code, p.total_allocated_hours,
        (SELECT COALESCE(SUM(t.hours_consumed),0) FROM timesheets t WHERE t.user_id=pa.user_id AND t.project_id=pa.project_id AND t.approval_status!='rejected') as logged_hours,
        (SELECT COALESCE(SUM(pa2.allocated_hours),0) FROM project_assignments pa2 WHERE pa2.user_id=pa.user_id AND pa2.is_active=1) as total_allocated_for_dev
      FROM project_assignments pa
      JOIN users u ON pa.user_id = u.id
      JOIN projects p ON pa.project_id = p.id
      WHERE pa.is_active = 1
    `
    const params: any[] = []
    if (projectId) { query += ' AND pa.project_id=?'; params.push(projectId) }
    if (userId) { query += ' AND pa.user_id=?'; params.push(userId) }
    query += ' ORDER BY p.name, u.full_name'
    const result = await c.env.DB.prepare(query).bind(...params).all()
    return c.json({ data: result.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

allocations.get('/summary', async (c) => {
  try {
    const result = await c.env.DB.prepare(`
      SELECT u.id, u.full_name, u.designation, u.monthly_available_hours, u.avatar_color,
        COALESCE(SUM(pa.allocated_hours), 0) as total_allocated,
        COALESCE(SUM(pa.consumed_hours), 0) as total_consumed,
        COUNT(pa.project_id) as project_count,
        CASE WHEN COALESCE(SUM(pa.allocated_hours), 0) > u.monthly_available_hours THEN 1 ELSE 0 END as is_overallocated,
        COALESCE(u.monthly_available_hours - SUM(pa.allocated_hours), u.monthly_available_hours) as idle_hours
      FROM users u
      LEFT JOIN project_assignments pa ON pa.user_id = u.id AND pa.is_active = 1
      WHERE u.role = 'developer' AND u.is_active = 1
      GROUP BY u.id ORDER BY total_allocated DESC
    `).all()
    return c.json({ data: result.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

export default allocations
