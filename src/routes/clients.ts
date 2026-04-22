import { Hono } from 'hono'
import { verify } from 'hono/jwt'

type Bindings = { DB: D1Database; JWT_SECRET: string }
type Variables = { user: any }

const clients = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Auth middleware (supports both internal users and clients)
clients.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const payload = await verify(authHeader.slice(7), c.env.JWT_SECRET, 'HS256') as any
    c.set('user', payload); await next()
  } catch { return c.json({ error: 'Invalid token' }, 401) }
})

// GET /api/clients
clients.get('/', async (c) => {
  try {
    const user = c.get('user')
    if (!['admin','pm'].includes(user.role)) return c.json({ error: 'Forbidden' }, 403)
    const result = await c.env.DB.prepare(`
      SELECT cl.*, 
        COUNT(DISTINCT p.id) as project_count,
        SUM(CASE WHEN p.status='active' THEN 1 ELSE 0 END) as active_projects,
        COALESCE(SUM(i.total_amount),0) as total_billed,
        COALESCE(SUM(i.paid_amount),0) as total_paid
      FROM clients cl
      LEFT JOIN projects p ON p.client_id=cl.id
      LEFT JOIN invoices i ON i.client_id=cl.id
      GROUP BY cl.id
      ORDER BY cl.created_at DESC
    `).all()
    return c.json({ clients: result.results })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// GET /api/clients/:id
clients.get('/:id', async (c) => {
  try {
    const user = c.get('user')
    const id = c.req.param('id')
    // Client can only view their own profile
    if (user.role === 'client' && user.sub !== id) return c.json({ error: 'Forbidden' }, 403)

    const [client, projects, invoices, notifications] = await Promise.all([
      c.env.DB.prepare('SELECT * FROM clients WHERE id=?').bind(id).first(),
      c.env.DB.prepare(`
        SELECT p.*, 
          u.full_name as pm_name,
          COUNT(DISTINCT pa.user_id) as team_size,
          COUNT(DISTINCT t.id) as task_count,
          COUNT(DISTINCT CASE WHEN t.status='done' THEN t.id END) as done_tasks
        FROM projects p
        LEFT JOIN users u ON p.pm_id=u.id
        LEFT JOIN project_assignments pa ON pa.project_id=p.id
        LEFT JOIN tasks t ON t.project_id=p.id
        WHERE p.client_id=? AND p.client_visible=1
        GROUP BY p.id ORDER BY p.created_at DESC
      `).bind(id).all(),
      c.env.DB.prepare(`
        SELECT * FROM invoices WHERE client_id=? ORDER BY issue_date DESC
      `).bind(id).all(),
      c.env.DB.prepare(`
        SELECT * FROM client_notifications WHERE client_id=? ORDER BY created_at DESC LIMIT 20
      `).bind(id).all(),
    ])
    return c.json({ client, projects: projects.results, invoices: invoices.results, notifications: notifications.results })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// GET /api/clients/:id/dashboard — full client portal dashboard
clients.get('/:id/dashboard', async (c) => {
  try {
    const user = c.get('user')
    const id = c.req.param('id')
    if (user.role === 'client' && user.sub !== id) return c.json({ error: 'Forbidden' }, 403)

    const [projects, billing, recentActivity, milestones, notifications, updates] = await Promise.all([
      c.env.DB.prepare(`
        SELECT p.*,
          u.full_name as pm_name, u.avatar_color as pm_color,
          COUNT(DISTINCT pa.user_id) as team_size,
          COUNT(DISTINCT t.id) as task_count,
          COUNT(DISTINCT CASE WHEN t.status='done' THEN t.id END) as done_tasks,
          COUNT(DISTINCT CASE WHEN t.status='blocked' THEN t.id END) as blocked_tasks
        FROM projects p
        LEFT JOIN users u ON p.pm_id=u.id
        LEFT JOIN project_assignments pa ON pa.project_id=p.id AND pa.is_active=1
        LEFT JOIN tasks t ON t.project_id=p.id AND t.is_client_visible=1
        WHERE p.client_id=? AND p.client_visible=1
        GROUP BY p.id ORDER BY p.updated_at DESC
      `).bind(id).all(),
      c.env.DB.prepare(`
        SELECT 
          COUNT(*) as total_invoices,
          COALESCE(SUM(total_amount),0) as total_billed,
          COALESCE(SUM(paid_amount),0) as total_paid,
          COALESCE(SUM(CASE WHEN status IN ('pending','sent') THEN total_amount ELSE 0 END),0) as pending_amount,
          COALESCE(SUM(CASE WHEN status='overdue' THEN total_amount ELSE 0 END),0) as overdue_amount,
          COUNT(CASE WHEN status='overdue' THEN 1 END) as overdue_count
        FROM invoices WHERE client_id=?
      `).bind(id).first(),
      c.env.DB.prepare(`
        SELECT al.*, p.name as project_name FROM activity_logs al
        LEFT JOIN projects p ON al.project_id=p.id
        WHERE p.client_id=? ORDER BY al.created_at DESC LIMIT 15
      `).bind(id).all(),
      c.env.DB.prepare(`
        SELECT m.*, p.name as project_name FROM milestones m
        JOIN projects p ON m.project_id=p.id
        WHERE p.client_id=? AND m.client_visible=1
        ORDER BY m.due_date ASC LIMIT 10
      `).bind(id).all(),
      c.env.DB.prepare(`SELECT * FROM client_notifications WHERE client_id=? AND is_read=0 ORDER BY created_at DESC`).bind(id).all(),
      c.env.DB.prepare(`
        SELECT pu.*, p.name as project_name FROM project_updates pu
        JOIN projects p ON pu.project_id=p.id
        WHERE p.client_id=? AND pu.is_client_visible=1
        ORDER BY pu.created_at DESC LIMIT 10
      `).bind(id).all(),
    ])
    return c.json({ projects: projects.results, billing, recent_activity: recentActivity.results, milestones: milestones.results, notifications: notifications.results, updates: updates.results })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// GET /api/clients/:id/project/:project_id — detailed project view for client
clients.get('/:id/project/:project_id', async (c) => {
  try {
    const user = c.get('user')
    const { id, project_id } = c.req.param()
    if (user.role === 'client' && user.sub !== id) return c.json({ error: 'Forbidden' }, 403)

    const [project, tasks, milestones, documents, sprints, updates, activity] = await Promise.all([
      c.env.DB.prepare(`
        SELECT p.*, u.full_name as pm_name, u.avatar_color as pm_color, u.phone as pm_phone
        FROM projects p LEFT JOIN users u ON p.pm_id=u.id
        WHERE p.id=? AND p.client_id=?
      `).bind(project_id, id).first(),
      c.env.DB.prepare(`
        SELECT t.*, u.full_name as assignee_name, u.avatar_color as assignee_color
        FROM tasks t LEFT JOIN users u ON t.assignee_id=u.id
        WHERE t.project_id=? AND t.is_client_visible=1 AND t.parent_task_id IS NULL
        ORDER BY t.status, t.priority DESC
      `).bind(project_id).all(),
      c.env.DB.prepare(`SELECT * FROM milestones WHERE project_id=? AND client_visible=1 ORDER BY due_date ASC`).bind(project_id).all(),
      c.env.DB.prepare(`SELECT * FROM documents WHERE project_id=? AND is_client_visible=1 ORDER BY created_at DESC`).bind(project_id).all(),
      c.env.DB.prepare(`SELECT * FROM sprints WHERE project_id=? ORDER BY start_date DESC`).bind(project_id).all(),
      c.env.DB.prepare(`SELECT * FROM project_updates WHERE project_id=? AND is_client_visible=1 ORDER BY created_at DESC LIMIT 10`).bind(project_id).all(),
      c.env.DB.prepare(`SELECT * FROM activity_logs WHERE project_id=? ORDER BY created_at DESC LIMIT 20`).bind(project_id).all(),
    ])
    if (!project) return c.json({ error: 'Project not found or access denied' }, 404)
    return c.json({ project, tasks: tasks.results, milestones: milestones.results, documents: documents.results, sprints: sprints.results, updates: updates.results, activity: activity.results })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// POST /api/clients/:id/project/:project_id/comment
clients.post('/:id/project/:project_id/comment', async (c) => {
  try {
    const user = c.get('user')
    const { id, project_id } = c.req.param()
    if (user.role === 'client' && user.sub !== id) return c.json({ error: 'Forbidden' }, 403)
    const { content, task_id } = await c.req.json()
    if (!content) return c.json({ error: 'Content required' }, 400)
    const cid = 'cmt-'+Date.now()
    const entity_type = task_id ? 'task' : 'project'
    const entity_id = task_id || project_id
    await c.env.DB.prepare(`INSERT INTO comments (id,entity_type,entity_id,author_client_id,content,is_internal) VALUES (?,?,?,?,?,0)`)
      .bind(cid, entity_type, entity_id, id, content).run()
    const client = await c.env.DB.prepare('SELECT contact_name, company_name FROM clients WHERE id=?').bind(id).first() as any
    await c.env.DB.prepare(`INSERT INTO activity_logs (id,project_id,entity_type,entity_id,action,actor_client_id,actor_name,actor_role) VALUES (?,?,?,?,?,?,?,?)`)
      .bind('al-'+Date.now(), project_id, entity_type, entity_id, 'commented', id, `${client?.contact_name} (${client?.company_name})`, 'client').run()
    return c.json({ success: true, comment_id: cid }, 201)
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// PATCH /api/clients/notifications/:notif_id/read
clients.patch('/notifications/:notif_id/read', async (c) => {
  try {
    await c.env.DB.prepare('UPDATE client_notifications SET is_read=1 WHERE id=?').bind(c.req.param('notif_id')).run()
    return c.json({ success: true })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// GET /api/clients/:id/notifications
clients.get('/:id/notifications', async (c) => {
  try {
    const user = c.get('user')
    const id = c.req.param('id')
    if (user.role === 'client' && user.sub !== id) return c.json({ error: 'Forbidden' }, 403)
    const result = await c.env.DB.prepare('SELECT * FROM client_notifications WHERE client_id=? ORDER BY created_at DESC LIMIT 20').bind(id).all()
    return c.json({ notifications: result.results })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// PUT /api/clients/:id — update profile
clients.put('/:id', async (c) => {
  try {
    const user = c.get('user')
    if (user.role === 'client' && user.sub !== c.req.param('id')) return c.json({ error: 'Forbidden' }, 403)
    const id = c.req.param('id')
    const body = await c.req.json()
    const fields: string[] = []; const vals: any[] = []
    for (const key of ['company_name','contact_name','phone','website','industry','address','notes']) {
      if (key in body) { fields.push(`${key}=?`); vals.push(body[key]) }
    }
    if (!fields.length) return c.json({ error: 'No fields to update' }, 400)
    fields.push('updated_at=?'); vals.push(new Date().toISOString()); vals.push(id)
    await c.env.DB.prepare(`UPDATE clients SET ${fields.join(',')} WHERE id=?`).bind(...vals).run()
    const updated = await c.env.DB.prepare('SELECT * FROM clients WHERE id=?').bind(id).first()
    return c.json({ client: updated })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

export default clients
