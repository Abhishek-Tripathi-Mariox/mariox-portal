import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'

type Bindings = { DB: D1Database }
type Variables = { user: any }

const dashboard = new Hono<{ Bindings: Bindings; Variables: Variables }>()
dashboard.use('*', authMiddleware)

// PM Dashboard
dashboard.get('/pm', async (c) => {
  try {
    const [
      projectStats, devStats, hoursStats, recentLogs,
      weeklyData, monthlyData, topProjects, utilizationData
    ] = await Promise.all([
      // Project statistics
      c.env.DB.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN status='on_hold' THEN 1 ELSE 0 END) as on_hold,
          SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN consumed_hours > total_allocated_hours THEN 1 ELSE 0 END) as over_budget,
          SUM(CASE WHEN total_allocated_hours > 0 AND consumed_hours/total_allocated_hours >= 0.8 AND consumed_hours <= total_allocated_hours THEN 1 ELSE 0 END) as near_limit,
          SUM(CASE WHEN expected_end_date < date('now') AND status = 'active' THEN 1 ELSE 0 END) as delayed
        FROM projects
      `).first(),
      // Developer statistics
      c.env.DB.prepare(`
        SELECT COUNT(*) as total,
          SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) as active
        FROM users WHERE role='developer'
      `).first(),
      // Hours statistics
      c.env.DB.prepare(`
        SELECT 
          COALESCE(SUM(total_allocated_hours), 0) as total_allocated,
          COALESCE(SUM(consumed_hours), 0) as total_consumed,
          COALESCE(SUM(total_allocated_hours - consumed_hours), 0) as total_remaining
        FROM projects WHERE status='active'
      `).first(),
      // Recent logs
      c.env.DB.prepare(`
        SELECT t.*, u.full_name, u.avatar_color, p.name as project_name
        FROM timesheets t
        JOIN users u ON t.user_id = u.id
        JOIN projects p ON t.project_id = p.id
        WHERE t.date >= date('now', '-3 days')
        ORDER BY t.created_at DESC LIMIT 10
      `).all(),
      // Weekly hours data (last 7 days)
      c.env.DB.prepare(`
        SELECT date, COALESCE(SUM(hours_consumed), 0) as hours
        FROM timesheets
        WHERE date >= date('now', '-6 days') AND approval_status != 'rejected'
        GROUP BY date ORDER BY date
      `).all(),
      // Monthly hours trend (last 6 months)
      c.env.DB.prepare(`
        SELECT strftime('%Y-%m', date) as month, COALESCE(SUM(hours_consumed), 0) as hours,
          SUM(CASE WHEN is_billable=1 THEN hours_consumed ELSE 0 END) as billable_hours
        FROM timesheets WHERE date >= date('now', '-6 months') AND approval_status != 'rejected'
        GROUP BY month ORDER BY month
      `).all(),
      // Top projects by consumption
      c.env.DB.prepare(`
        SELECT p.id, p.name, p.code, p.status, p.priority,
          p.total_allocated_hours, p.consumed_hours,
          CASE WHEN p.total_allocated_hours > 0 
            THEN ROUND(p.consumed_hours * 100.0 / p.total_allocated_hours, 1) 
            ELSE 0 END as burn_pct,
          ROUND(CAST(julianday('now') - julianday(p.start_date) AS REAL) / 
            NULLIF(CAST(julianday(p.expected_end_date) - julianday(p.start_date) AS REAL), 0) * 100, 1) as timeline_pct
        FROM projects p WHERE p.status = 'active'
        ORDER BY burn_pct DESC LIMIT 8
      `).all(),
      // Developer utilization
      c.env.DB.prepare(`
        SELECT u.id, u.full_name, u.designation, u.avatar_color, u.monthly_available_hours,
          COALESCE((SELECT SUM(t.hours_consumed) FROM timesheets t 
            WHERE t.user_id = u.id AND t.date >= date('now', 'start of month') 
            AND t.approval_status != 'rejected'), 0) as monthly_consumed,
          COALESCE((SELECT SUM(pa.allocated_hours) FROM project_assignments pa 
            WHERE pa.user_id = u.id AND pa.is_active = 1), 0) as total_allocated,
          (SELECT COUNT(*) FROM project_assignments pa WHERE pa.user_id = u.id AND pa.is_active = 1) as project_count
        FROM users u WHERE u.role = 'developer' AND u.is_active = 1
        ORDER BY monthly_consumed DESC
      `).all()
    ])

    // Overloaded & underutilized
    const utilizationResults = utilizationData.results as any[]
    const overloaded = utilizationResults.filter((d: any) => {
      const pct = d.monthly_available_hours > 0 ? (d.monthly_consumed / d.monthly_available_hours) * 100 : 0
      return pct > 100
    }).length
    const underutilized = utilizationResults.filter((d: any) => {
      const pct = d.monthly_available_hours > 0 ? (d.monthly_consumed / d.monthly_available_hours) * 100 : 0
      return pct < 50
    }).length

    return c.json({
      data: {
        projects: projectStats,
        developers: { ...devStats, overloaded, underutilized },
        hours: hoursStats,
        recent_logs: recentLogs.results,
        weekly_data: weeklyData.results,
        monthly_data: monthlyData.results,
        top_projects: topProjects.results,
        utilization: utilizationResults.map((d: any) => ({
          ...d,
          utilization_pct: d.monthly_available_hours > 0 
            ? Math.round((d.monthly_consumed / d.monthly_available_hours) * 100) : 0
        }))
      }
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Developer Dashboard
dashboard.get('/developer', async (c) => {
  try {
    const user = c.get('user')
    const userId = user.sub

    const [myProjects, todayLogs, weeklyHours, monthlyHours, pendingApprovals, suggestions] = await Promise.all([
      c.env.DB.prepare(`
        SELECT pa.*, p.name as project_name, p.code, p.status, p.priority, p.expected_end_date,
          p.total_allocated_hours, p.consumed_hours as project_consumed,
          (SELECT COALESCE(SUM(t.hours_consumed),0) FROM timesheets t 
            WHERE t.user_id = pa.user_id AND t.project_id = pa.project_id AND t.approval_status != 'rejected') as my_logged
        FROM project_assignments pa
        JOIN projects p ON pa.project_id = p.id
        WHERE pa.user_id = ? AND pa.is_active = 1 AND p.status != 'archived'
      `).bind(userId).all(),
      c.env.DB.prepare(`
        SELECT t.*, p.name as project_name FROM timesheets t
        JOIN projects p ON t.project_id = p.id
        WHERE t.user_id = ? AND t.date = date('now')
        ORDER BY t.created_at DESC
      `).bind(userId).all(),
      c.env.DB.prepare(`
        SELECT date, SUM(hours_consumed) as hours FROM timesheets
        WHERE user_id = ? AND date >= date('now', '-6 days') AND approval_status != 'rejected'
        GROUP BY date ORDER BY date
      `).bind(userId).all(),
      c.env.DB.prepare(`
        SELECT strftime('%Y-%m', date) as month, SUM(hours_consumed) as hours,
          SUM(CASE WHEN is_billable=1 THEN hours_consumed ELSE 0 END) as billable
        FROM timesheets WHERE user_id = ? AND date >= date('now', '-5 months') AND approval_status != 'rejected'
        GROUP BY month ORDER BY month
      `).bind(userId).all(),
      c.env.DB.prepare(`
        SELECT COUNT(*) as count FROM timesheets WHERE user_id = ? AND approval_status = 'pending'
      `).bind(userId).first(),
      c.env.DB.prepare(`
        SELECT DISTINCT t.project_id, p.name as project_name, t.module_name, t.task_description, t.hours_consumed
        FROM timesheets t JOIN projects p ON t.project_id = p.id
        WHERE t.user_id = ? AND t.date >= date('now', '-3 days')
        ORDER BY t.date DESC LIMIT 5
      `).bind(userId).all()
    ])

    const userInfo = await c.env.DB.prepare(`
      SELECT u.*, 
        COALESCE((SELECT SUM(t.hours_consumed) FROM timesheets t WHERE t.user_id = u.id AND t.date >= date('now', 'start of month') AND t.approval_status != 'rejected'), 0) as monthly_consumed,
        COALESCE((SELECT SUM(pa.allocated_hours) FROM project_assignments pa WHERE pa.user_id = u.id AND pa.is_active = 1), 0) as total_allocated
      FROM users u WHERE u.id = ?
    `).bind(userId).first() as any

    const monthlyConsumed = userInfo?.monthly_consumed || 0
    const capacity = userInfo?.monthly_available_hours || 160
    const utilizationPct = Math.round((monthlyConsumed / capacity) * 100)

    return c.json({
      data: {
        user: userInfo,
        capacity: { total: capacity, consumed: monthlyConsumed, remaining: Math.max(0, capacity - monthlyConsumed), utilization_pct: utilizationPct },
        projects: myProjects.results,
        today_logs: todayLogs.results,
        weekly_hours: weeklyHours.results,
        monthly_hours: monthlyHours.results,
        pending_approvals: pendingApprovals,
        suggestions: suggestions.results,
      }
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Executive Dashboard
dashboard.get('/executive', async (c) => {
  try {
    const [teamCapacity, projectCosts, monthlyTrend, topDevs] = await Promise.all([
      c.env.DB.prepare(`
        SELECT 
          SUM(monthly_available_hours) as total_capacity,
          COUNT(*) as total_devs,
          SUM(CASE WHEN is_active=1 THEN monthly_available_hours ELSE 0 END) as active_capacity
        FROM users WHERE role = 'developer'
      `).first(),
      c.env.DB.prepare(`
        SELECT p.id, p.name, p.revenue,
          COALESCE((SELECT SUM(t.hours_consumed * u.hourly_cost) FROM timesheets t 
            JOIN users u ON t.user_id = u.id 
            WHERE t.project_id = p.id AND t.approval_status != 'rejected'), 0) as effort_cost,
          p.consumed_hours, p.total_allocated_hours
        FROM projects p WHERE p.status IN ('active', 'completed')
        ORDER BY p.revenue DESC LIMIT 10
      `).all(),
      c.env.DB.prepare(`
        SELECT strftime('%Y-%m', t.date) as month,
          SUM(t.hours_consumed) as total_hours,
          SUM(CASE WHEN t.is_billable=1 THEN t.hours_consumed ELSE 0 END) as billable_hours,
          COUNT(DISTINCT t.user_id) as active_devs
        FROM timesheets t WHERE t.date >= date('now', '-11 months') AND t.approval_status != 'rejected'
        GROUP BY month ORDER BY month
      `).all(),
      c.env.DB.prepare(`
        SELECT u.id, u.full_name, u.designation, u.avatar_color, u.hourly_cost,
          COALESCE(SUM(t.hours_consumed), 0) as total_logged,
          COALESCE(SUM(CASE WHEN t.is_billable=1 THEN t.hours_consumed ELSE 0 END), 0) as billable_hours,
          COUNT(DISTINCT t.project_id) as projects_worked
        FROM users u LEFT JOIN timesheets t ON u.id = t.user_id AND t.approval_status != 'rejected'
        WHERE u.role = 'developer' AND u.is_active = 1
        GROUP BY u.id ORDER BY total_logged DESC LIMIT 10
      `).all()
    ])

    return c.json({
      data: {
        team_capacity: teamCapacity,
        project_costs: projectCosts.results,
        monthly_trend: monthlyTrend.results,
        top_developers: topDevs.results,
      }
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

export default dashboard
