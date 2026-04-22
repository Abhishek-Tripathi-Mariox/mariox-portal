import { Hono } from 'hono'
import { authMiddleware, requireRole } from '../middleware/auth'
import { generateId } from '../utils/helpers'

type Bindings = { DB: D1Database }
type Variables = { user: any }

const projects = new Hono<{ Bindings: Bindings; Variables: Variables }>()

projects.use('*', authMiddleware)

projects.get('/', async (c) => {
  try {
    const status = c.req.query('status')
    const pm_id = c.req.query('pm_id')
    let query = `
      SELECT p.*,
        tl.full_name as team_lead_name, pm.full_name as pm_name,
        (SELECT COUNT(*) FROM project_assignments pa WHERE pa.project_id = p.id AND pa.is_active = 1) as developer_count,
        ROUND(CAST(julianday(p.expected_end_date) - julianday('now') AS REAL) / NULLIF(CAST(julianday(p.expected_end_date) - julianday(p.start_date) AS REAL), 0) * 100, 1) as days_remaining_pct,
        ROUND(CAST(julianday('now') - julianday(p.start_date) AS REAL) / NULLIF(CAST(julianday(p.expected_end_date) - julianday(p.start_date) AS REAL), 0) * 100, 1) as timeline_progress
      FROM projects p
      LEFT JOIN users tl ON p.team_lead_id = tl.id
      LEFT JOIN users pm ON p.pm_id = pm.id
      WHERE 1=1
    `
    const params: any[] = []
    if (status) { query += ' AND p.status = ?'; params.push(status) }
    if (pm_id) { query += ' AND p.pm_id = ?'; params.push(pm_id) }
    query += ' ORDER BY p.priority DESC, p.created_at DESC'
    const result = await c.env.DB.prepare(query).bind(...params).all()
    return c.json({ projects: result.results, data: result.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

projects.get('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const project = await c.env.DB.prepare(`
      SELECT p.*,
        tl.full_name as team_lead_name, pm.full_name as pm_name,
        ROUND(CAST(julianday('now') - julianday(p.start_date) AS REAL) / 
          NULLIF(CAST(julianday(p.expected_end_date) - julianday(p.start_date) AS REAL), 0) * 100, 1) as timeline_progress
      FROM projects p
      LEFT JOIN users tl ON p.team_lead_id = tl.id
      LEFT JOIN users pm ON p.pm_id = pm.id
      WHERE p.id = ?
    `).bind(id).first()
    if (!project) return c.json({ error: 'Project not found' }, 404)

    const assignments = await c.env.DB.prepare(`
      SELECT pa.*, u.full_name, u.designation, u.avatar_color, u.email,
        (SELECT COALESCE(SUM(t.hours_consumed),0) FROM timesheets t WHERE t.user_id = pa.user_id AND t.project_id = pa.project_id AND t.approval_status != 'rejected') as logged_hours
      FROM project_assignments pa
      JOIN users u ON pa.user_id = u.id
      WHERE pa.project_id = ? AND pa.is_active = 1
    `).bind(id).all()

    const recentLogs = await c.env.DB.prepare(`
      SELECT t.*, u.full_name, u.avatar_color FROM timesheets t
      JOIN users u ON t.user_id = u.id
      WHERE t.project_id = ? ORDER BY t.date DESC LIMIT 20
    `).bind(id).all()

    const monthlyBurn = await c.env.DB.prepare(`
      SELECT strftime('%Y-%m', date) as month, SUM(hours_consumed) as hours
      FROM timesheets WHERE project_id = ? AND approval_status != 'rejected'
      GROUP BY month ORDER BY month
    `).bind(id).all()

    const notes = await c.env.DB.prepare(`
      SELECT n.*, u.full_name FROM notes n
      JOIN users u ON n.author_id = u.id
      WHERE n.entity_type = 'project' AND n.entity_id = ?
      ORDER BY n.created_at DESC
    `).bind(id).all()

    return c.json({
      data: {
        ...project,
        assignments: assignments.results,
        recent_logs: recentLogs.results,
        monthly_burn: monthlyBurn.results,
        notes: notes.results,
      }
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

projects.post('/', requireRole('admin', 'pm'), async (c) => {
  try {
    const body = await c.req.json()

    // Tightened validation — deadline, budget, priority are all required
    const errors: string[] = []
    if (!body.name?.trim()) errors.push('Project name is required')
    if (!body.code?.trim()) errors.push('Project code is required')
    if (!body.start_date) errors.push('Start date is required')
    if (!body.expected_end_date) errors.push('Expected end date is required')
    if (body.start_date && body.expected_end_date && body.start_date > body.expected_end_date) {
      errors.push('End date must be after start date')
    }
    if (!body.total_allocated_hours || Number(body.total_allocated_hours) <= 0) {
      errors.push('Total allocated hours must be greater than 0')
    }
    if (errors.length) return c.json({ error: errors.join('; ') }, 400)

    const id = generateId('proj')
    await c.env.DB.prepare(`
      INSERT INTO projects (id, name, code, client_name, description, project_type, start_date, expected_end_date, priority, status, total_allocated_hours, estimated_budget_hours, team_lead_id, pm_id, billable, revenue, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, body.name, body.code, body.client_name || null, body.description || null,
      body.project_type || 'development', body.start_date, body.expected_end_date,
      body.priority || 'medium', body.status || 'active',
      body.total_allocated_hours || 0, body.estimated_budget_hours || 0,
      body.team_lead_id || null, body.pm_id || null,
      body.billable !== undefined ? (body.billable ? 1 : 0) : 1,
      body.revenue || 0, body.remarks || null
    ).run()

    // Auto-seed default kanban permissions for this project
    const defaultPerms = [
      { role: 'admin',     view:1, create:1, editAny:1, editOwn:1, move:1, del:1, cols:1, comm:1 },
      { role: 'pm',        view:1, create:1, editAny:1, editOwn:1, move:1, del:1, cols:1, comm:1 },
      { role: 'developer', view:1, create:1, editAny:0, editOwn:1, move:1, del:0, cols:0, comm:1 },
      { role: 'client',    view:1, create:0, editAny:0, editOwn:0, move:0, del:0, cols:0, comm:1 },
    ]
    for (const p of defaultPerms) {
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO kanban_permissions
          (id, project_id, role, can_view, can_create_task, can_edit_any_task, can_edit_own_task, can_move_task, can_delete_task, can_manage_columns, can_comment)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `).bind(`kp-${p.role}-${id}`, id, p.role, p.view, p.create, p.editAny, p.editOwn, p.move, p.del, p.cols, p.comm).run()
    }

    // Auto-seed default kanban columns
    const defaultCols = [
      { key: 'backlog',     name: 'Backlog',     color: '#64748b', wip: 0, done: 0 },
      { key: 'todo',        name: 'To Do',       color: '#6366f1', wip: 0, done: 0 },
      { key: 'in_progress', name: 'In Progress', color: '#f59e0b', wip: 5, done: 0 },
      { key: 'in_review',   name: 'In Review',   color: '#8b5cf6', wip: 3, done: 0 },
      { key: 'qa',          name: 'QA',          color: '#06b6d4', wip: 3, done: 0 },
      { key: 'done',        name: 'Done',        color: '#10b981', wip: 0, done: 1 },
      { key: 'blocked',     name: 'Blocked',     color: '#ef4444', wip: 0, done: 0 },
    ]
    for (let i = 0; i < defaultCols.length; i++) {
      const col = defaultCols[i]
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO kanban_columns
          (id, project_id, name, status_key, color, position, wip_limit, is_done_column)
        VALUES (?,?,?,?,?,?,?,?)
      `).bind(`kc-${id}-${col.key}`, id, col.name, col.key, col.color, i, col.wip, col.done).run()
    }

    return c.json({ data: { id }, message: 'Project created successfully' }, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

projects.put('/:id', requireRole('admin', 'pm'), async (c) => {
  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    await c.env.DB.prepare(`
      UPDATE projects SET name=?, client_name=?, description=?, project_type=?, start_date=?,
      expected_end_date=?, priority=?, status=?, total_allocated_hours=?, estimated_budget_hours=?,
      team_lead_id=?, pm_id=?, billable=?, revenue=?, remarks=?, updated_at=datetime('now')
      WHERE id=?
    `).bind(
      body.name, body.client_name || null, body.description || null,
      body.project_type || 'development', body.start_date, body.expected_end_date,
      body.priority || 'medium', body.status || 'active',
      body.total_allocated_hours || 0, body.estimated_budget_hours || 0,
      body.team_lead_id || null, body.pm_id || null,
      body.billable ? 1 : 0, body.revenue || 0,
      body.remarks || null, id
    ).run()
    return c.json({ message: 'Project updated successfully' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

projects.delete('/:id', requireRole('admin'), async (c) => {
  try {
    const id = c.req.param('id')
    await c.env.DB.prepare('UPDATE projects SET status=\'archived\' WHERE id=?').bind(id).run()
    return c.json({ message: 'Project archived successfully' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Add developer to project
projects.post('/:id/assign', requireRole('admin', 'pm'), async (c) => {
  try {
    const projectId = c.req.param('id')
    const body = await c.req.json()
    const id = generateId('pa')
    await c.env.DB.prepare(`
      INSERT INTO project_assignments (id, project_id, user_id, allocated_hours, role)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id, user_id) DO UPDATE SET allocated_hours=excluded.allocated_hours, is_active=1
    `).bind(id, projectId, body.user_id, body.allocated_hours || 0, body.role || 'developer').run()
    return c.json({ message: 'Developer assigned to project' }, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Remove developer from project
projects.delete('/:id/assign/:userId', requireRole('admin', 'pm'), async (c) => {
  try {
    const { id: projectId, userId } = c.req.param()
    await c.env.DB.prepare('UPDATE project_assignments SET is_active=0 WHERE project_id=? AND user_id=?').bind(projectId, userId).run()
    return c.json({ message: 'Developer removed from project' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Update allocation
projects.patch('/:id/assign/:userId', requireRole('admin', 'pm'), async (c) => {
  try {
    const { id: projectId, userId } = c.req.param()
    const { allocated_hours, role } = await c.req.json()
    await c.env.DB.prepare('UPDATE project_assignments SET allocated_hours=?, role=? WHERE project_id=? AND user_id=?')
      .bind(allocated_hours, role || 'developer', projectId, userId).run()
    return c.json({ message: 'Allocation updated successfully' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Add note to project
projects.post('/:id/notes', async (c) => {
  try {
    const projectId = c.req.param('id')
    const user = c.get('user')
    const { content } = await c.req.json()
    const id = generateId('note')
    await c.env.DB.prepare(`INSERT INTO notes (id, author_id, entity_type, entity_id, content) VALUES (?, ?, 'project', ?, ?)`)
      .bind(id, user.sub, projectId, content).run()
    return c.json({ message: 'Note added successfully' }, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// GET /:id/developers — get all developers assigned to this project
projects.get('/:id/developers', async (c) => {
  try {
    const projectId = c.req.param('id')
    const result = await c.env.DB.prepare(`
      SELECT pa.*, u.full_name, u.email, u.designation, u.avatar_color, u.role as user_role
      FROM project_assignments pa
      JOIN users u ON pa.user_id = u.id
      WHERE pa.project_id = ? AND pa.is_active = 1
      ORDER BY u.full_name
    `).bind(projectId).all()
    return c.json({ developers: result.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// POST /:id/assign-bulk — assign multiple developers at once (PM feature)
projects.post('/:id/assign-bulk', requireRole('admin', 'pm'), async (c) => {
  try {
    const projectId = c.req.param('id')
    const { developers } = await c.req.json()
    // developers: [{ user_id, allocated_hours, role }]
    if (!Array.isArray(developers)) return c.json({ error: 'developers must be array' }, 400)

    // First, deactivate all current assignments
    await c.env.DB.prepare('UPDATE project_assignments SET is_active=0 WHERE project_id=?').bind(projectId).run()

    // Re-assign
    for (const dev of developers) {
      if (!dev.user_id) continue
      const id = generateId('pa')
      await c.env.DB.prepare(`
        INSERT INTO project_assignments (id, project_id, user_id, allocated_hours, role, is_active)
        VALUES (?, ?, ?, ?, ?, 1)
        ON CONFLICT(project_id, user_id) DO UPDATE SET allocated_hours=excluded.allocated_hours, role=excluded.role, is_active=1
      `).bind(id, projectId, dev.user_id, dev.allocated_hours || 0, dev.role || 'developer').run()
    }
    return c.json({ message: 'Developers updated successfully' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

export default projects
