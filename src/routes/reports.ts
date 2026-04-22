import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'

type Bindings = { DB: D1Database }
type Variables = { user: any }

const reports = new Hono<{ Bindings: Bindings; Variables: Variables }>()
reports.use('*', authMiddleware)

// Developer report
reports.get('/developer/:id', async (c) => {
  try {
    const userId = c.req.param('id')
    const month = c.req.query('month') || new Date().toISOString().slice(0, 7)
    const [year, mon] = month.split('-').map(Number)
    const startDate = `${month}-01`
    const lastDay = new Date(year, mon, 0).getDate()
    const endDate = `${month}-${String(lastDay).padStart(2, '0')}`

    const [user, dailyHours, projectBreakdown, weeklyData, billableData] = await Promise.all([
      c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first(),
      c.env.DB.prepare(`
        SELECT date, SUM(hours_consumed) as hours, 
          SUM(CASE WHEN is_billable=1 THEN hours_consumed ELSE 0 END) as billable
        FROM timesheets WHERE user_id=? AND date>=? AND date<=? AND approval_status!='rejected'
        GROUP BY date ORDER BY date
      `).bind(userId, startDate, endDate).all(),
      c.env.DB.prepare(`
        SELECT p.id, p.name, p.code, SUM(t.hours_consumed) as hours,
          SUM(CASE WHEN t.is_billable=1 THEN t.hours_consumed ELSE 0 END) as billable,
          pa.allocated_hours, pa.role
        FROM timesheets t JOIN projects p ON t.project_id = p.id
        JOIN project_assignments pa ON pa.project_id = p.id AND pa.user_id = ?
        WHERE t.user_id=? AND t.date>=? AND t.date<=? AND t.approval_status!='rejected'
        GROUP BY p.id ORDER BY hours DESC
      `).bind(userId, userId, startDate, endDate).all(),
      c.env.DB.prepare(`
        SELECT strftime('%W', date) as week, SUM(hours_consumed) as hours
        FROM timesheets WHERE user_id=? AND date>=? AND date<=? AND approval_status!='rejected'
        GROUP BY week ORDER BY week
      `).bind(userId, startDate, endDate).all(),
      c.env.DB.prepare(`
        SELECT SUM(CASE WHEN is_billable=1 THEN hours_consumed ELSE 0 END) as billable,
          SUM(CASE WHEN is_billable=0 THEN hours_consumed ELSE 0 END) as non_billable,
          SUM(hours_consumed) as total
        FROM timesheets WHERE user_id=? AND date>=? AND date<=? AND approval_status!='rejected'
      `).bind(userId, startDate, endDate).first()
    ])

    return c.json({
      data: { user, month, daily_hours: dailyHours.results, project_breakdown: projectBreakdown.results, weekly_data: weeklyData.results, billable_summary: billableData }
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Project report
reports.get('/project/:id', async (c) => {
  try {
    const projectId = c.req.param('id')
    const [project, developerContrib, dailyBurn, weeklyBurn] = await Promise.all([
      c.env.DB.prepare(`
        SELECT p.*, 
          ROUND(CAST(julianday('now') - julianday(p.start_date) AS REAL) / NULLIF(CAST(julianday(p.expected_end_date) - julianday(p.start_date) AS REAL), 0) * 100, 1) as timeline_pct,
          CASE WHEN p.total_allocated_hours > 0 THEN ROUND(p.consumed_hours * 100.0 / p.total_allocated_hours, 1) ELSE 0 END as burn_pct
        FROM projects p WHERE p.id = ?
      `).bind(projectId).first(),
      c.env.DB.prepare(`
        SELECT u.id, u.full_name, u.designation, u.avatar_color, pa.allocated_hours, pa.consumed_hours, pa.role,
          SUM(t.hours_consumed) as logged_hours,
          SUM(CASE WHEN t.is_billable=1 THEN t.hours_consumed ELSE 0 END) as billable
        FROM project_assignments pa
        JOIN users u ON pa.user_id = u.id
        LEFT JOIN timesheets t ON t.user_id = pa.user_id AND t.project_id = pa.project_id AND t.approval_status != 'rejected'
        WHERE pa.project_id = ? AND pa.is_active = 1
        GROUP BY u.id ORDER BY logged_hours DESC
      `).bind(projectId).all(),
      c.env.DB.prepare(`
        SELECT date, SUM(hours_consumed) as hours, SUM(CASE WHEN is_billable=1 THEN hours_consumed ELSE 0 END) as billable
        FROM timesheets WHERE project_id=? AND approval_status!='rejected'
        GROUP BY date ORDER BY date
      `).bind(projectId).all(),
      c.env.DB.prepare(`
        SELECT strftime('%Y-%m', date) as month, SUM(hours_consumed) as hours
        FROM timesheets WHERE project_id=? AND approval_status!='rejected'
        GROUP BY month ORDER BY month
      `).bind(projectId).all()
    ])

    return c.json({ data: { project, developer_contributions: developerContrib.results, daily_burn: dailyBurn.results, weekly_burn: weeklyBurn.results } })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Team utilization report
reports.get('/team', async (c) => {
  try {
    const month = c.req.query('month') || new Date().toISOString().slice(0, 7)
    const [year, mon] = month.split('-').map(Number)
    const startDate = `${month}-01`
    const lastDay = new Date(year, mon, 0).getDate()
    const endDate = `${month}-${String(lastDay).padStart(2, '0')}`

    const result = await c.env.DB.prepare(`
      SELECT u.id, u.full_name, u.designation, u.avatar_color, u.monthly_available_hours, u.hourly_cost,
        COALESCE(SUM(t.hours_consumed), 0) as logged_hours,
        COALESCE(SUM(CASE WHEN t.is_billable=1 THEN t.hours_consumed ELSE 0 END), 0) as billable_hours,
        COALESCE((SELECT SUM(pa.allocated_hours) FROM project_assignments pa WHERE pa.user_id = u.id AND pa.is_active=1), 0) as allocated_hours,
        COUNT(DISTINCT t.project_id) as projects_worked,
        CASE WHEN u.monthly_available_hours > 0 THEN ROUND(COALESCE(SUM(t.hours_consumed),0) * 100.0 / u.monthly_available_hours, 1) ELSE 0 END as utilization_pct
      FROM users u
      LEFT JOIN timesheets t ON t.user_id = u.id AND t.date >= ? AND t.date <= ? AND t.approval_status != 'rejected'
      WHERE u.role = 'developer' AND u.is_active = 1
      GROUP BY u.id ORDER BY utilization_pct DESC
    `).bind(startDate, endDate).all()

    return c.json({ data: result.results, month })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Export data (CSV format)
reports.get('/export/timesheets', async (c) => {
  try {
    const month = c.req.query('month') || new Date().toISOString().slice(0, 7)
    const userId = c.req.query('user_id')
    const projectId = c.req.query('project_id')
    const [year, mon] = month.split('-').map(Number)
    const startDate = `${month}-01`
    const lastDay = new Date(year, mon, 0).getDate()
    const endDate = `${month}-${String(lastDay).padStart(2, '0')}`

    let query = `
      SELECT t.date, u.full_name as developer, p.name as project, p.code, 
        t.module_name, t.task_description, t.hours_consumed, 
        CASE WHEN t.is_billable=1 THEN 'Yes' ELSE 'No' END as billable,
        t.status, t.approval_status
      FROM timesheets t JOIN users u ON t.user_id=u.id JOIN projects p ON t.project_id=p.id
      WHERE t.date>=? AND t.date<=?
    `
    const params: any[] = [startDate, endDate]
    if (userId) { query += ' AND t.user_id=?'; params.push(userId) }
    if (projectId) { query += ' AND t.project_id=?'; params.push(projectId) }
    query += ' ORDER BY t.date, u.full_name'

    const result = await c.env.DB.prepare(query).bind(...params).all()
    const rows = result.results as any[]

    let csv = 'Date,Developer,Project,Project Code,Module,Task Description,Hours,Billable,Status,Approval\n'
    for (const row of rows) {
      csv += `"${row.date}","${row.developer}","${row.project}","${row.code}","${row.module_name || ''}","${(row.task_description || '').replace(/"/g, '""')}","${row.hours_consumed}","${row.billable}","${row.status}","${row.approval_status}"\n`
    }

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="timesheets-${month}.csv"`
      }
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Alias: team-utilization (calls same logic as /team)
reports.get('/team-utilization', async (c) => {
  try {
    const month = c.req.query('month') || new Date().toISOString().slice(0, 7)
    const [year, mon] = month.split('-').map(Number)
    const startDate = `${month}-01`
    const lastDay = new Date(year, mon, 0).getDate()
    const endDate = `${month}-${String(lastDay).padStart(2, '0')}`

    const result = await c.env.DB.prepare(`
      SELECT u.id, u.full_name, u.designation, u.avatar_color, u.monthly_available_hours, u.hourly_cost, u.email, u.role,
        COALESCE(SUM(t.hours_consumed), 0) as monthly_consumed,
        COALESCE(SUM(CASE WHEN t.is_billable=1 THEN t.hours_consumed ELSE 0 END), 0) as billable_hours,
        COUNT(DISTINCT t.project_id) as project_count,
        CASE WHEN u.monthly_available_hours > 0 THEN ROUND(COALESCE(SUM(t.hours_consumed),0) * 100.0 / u.monthly_available_hours, 1) ELSE 0 END as utilization_pct
      FROM users u
      LEFT JOIN timesheets t ON t.user_id = u.id AND t.date >= ? AND t.date <= ? AND t.approval_status != 'rejected'
      WHERE u.role IN ('developer','pm') AND u.is_active = 1
      GROUP BY u.id ORDER BY utilization_pct DESC
    `).bind(startDate, endDate).all()

    return c.json({ utilization: result.results, data: result.results, month })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Alias: project-summary
reports.get('/project-summary', async (c) => {
  try {
    const result = await c.env.DB.prepare(`
      SELECT p.*, 
        cl.company_name as client_name,
        u.full_name as pm_name
      FROM projects p
      LEFT JOIN clients cl ON cl.id = p.client_id
      LEFT JOIN users u ON u.id = p.pm_id
      ORDER BY p.created_at DESC
    `).all()
    return c.json({ projects: result.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Alias: summary (for client portal)
reports.get('/summary', async (c) => {
  try {
    const [projectCount, devCount, hoursData] = await Promise.all([
      c.env.DB.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active FROM projects").first(),
      c.env.DB.prepare("SELECT COUNT(*) as total FROM users WHERE role='developer' AND is_active=1").first(),
      c.env.DB.prepare("SELECT COALESCE(SUM(total_allocated_hours),0) as allocated, COALESCE(SUM(consumed_hours),0) as consumed FROM projects").first()
    ])
    return c.json({ projects: projectCount, developers: devCount, hours: hoursData })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

export default reports
