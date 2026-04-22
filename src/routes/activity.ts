import { Hono } from 'hono'
import { verify } from 'hono/jwt'

type Bindings = { DB: D1Database; JWT_SECRET: string }
type Variables = { user: any }

const activity = new Hono<{ Bindings: Bindings; Variables: Variables }>()

activity.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const payload = await verify(authHeader.slice(7), c.env.JWT_SECRET, 'HS256') as any
    c.set('user', payload); await next()
  } catch { return c.json({ error: 'Invalid token' }, 401) }
})

// GET /api/activity?project_id=&entity_type=&limit=&client_id=
activity.get('/', async (c) => {
  try {
    const { project_id, entity_type, limit = '30', client_id } = c.req.query()
    let sql = `SELECT al.*, p.name as project_name FROM activity_logs al LEFT JOIN projects p ON al.project_id=p.id WHERE 1=1`
    const params: any[] = []
    if (project_id) { sql += ' AND al.project_id=?'; params.push(project_id) }
    if (entity_type) { sql += ' AND al.entity_type=?'; params.push(entity_type) }
    if (client_id) { sql += ' AND al.project_id IN (SELECT id FROM projects WHERE client_id=?)'; params.push(client_id) }
    sql += ` ORDER BY al.created_at DESC LIMIT ${Math.min(parseInt(limit), 100)}`
    const result = await c.env.DB.prepare(sql).bind(...params).all()
    return c.json({ logs: result.results, activity: result.results })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// GET /api/activity/project/:project_id/feed
activity.get('/project/:project_id/feed', async (c) => {
  try {
    const project_id = c.req.param('project_id')
    const [activityLogs, comments, updates] = await Promise.all([
      c.env.DB.prepare(`SELECT * FROM activity_logs WHERE project_id=? ORDER BY created_at DESC LIMIT 30`).bind(project_id).all(),
      c.env.DB.prepare(`
        SELECT c.*, u.full_name as author_name, u.avatar_color as author_color, u.role as author_role,
          cl.contact_name as client_name, cl.company_name, cl.avatar_color as client_color
        FROM comments c
        LEFT JOIN users u ON c.author_user_id=u.id
        LEFT JOIN clients cl ON c.author_client_id=cl.id
        WHERE (c.entity_type='project' AND c.entity_id=?) ORDER BY c.created_at DESC LIMIT 20
      `).bind(project_id).all(),
      c.env.DB.prepare(`SELECT pu.*, u.full_name as posted_by_name, u.avatar_color FROM project_updates pu LEFT JOIN users u ON pu.posted_by=u.id WHERE pu.project_id=? ORDER BY pu.created_at DESC LIMIT 10`).bind(project_id).all(),
    ])
    return c.json({ activity: activityLogs.results, comments: comments.results, updates: updates.results })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// POST /api/activity/project/:project_id/update — PM posts project update
activity.post('/project/:project_id/update', async (c) => {
  try {
    const user = c.get('user')
    if (!['admin','pm'].includes(user.role)) return c.json({ error: 'Forbidden' }, 403)
    const project_id = c.req.param('project_id')
    const { title, content, update_type='general', is_client_visible=1 } = await c.req.json()
    if (!title || !content) return c.json({ error: 'title and content required' }, 400)
    const id = 'pu-'+Date.now()
    await c.env.DB.prepare(`INSERT INTO project_updates (id,project_id,title,content,update_type,is_client_visible,posted_by) VALUES (?,?,?,?,?,?,?)`)
      .bind(id, project_id, title, content, update_type, is_client_visible, user.sub).run()
    await c.env.DB.prepare(`INSERT INTO activity_logs (id,project_id,entity_type,entity_id,action,actor_user_id,actor_name,actor_role,new_value) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind('al-'+Date.now(), project_id,'project',project_id,'updated',user.sub,user.name,user.role,title).run()

    if (is_client_visible) {
      const proj = await c.env.DB.prepare('SELECT client_id FROM projects WHERE id=?').bind(project_id).first() as any
      if (proj?.client_id) {
        await c.env.DB.prepare(`INSERT INTO client_notifications (id,client_id,project_id,type,title,message) VALUES (?,?,?,?,?,?)`)
          .bind('cn-'+Date.now(), proj.client_id, project_id,'project_update',title,content.substring(0,200)).run()
      }
    }
    const update = await c.env.DB.prepare(`SELECT pu.*, u.full_name as posted_by_name FROM project_updates pu LEFT JOIN users u ON pu.posted_by=u.id WHERE pu.id=?`).bind(id).first()
    return c.json({ update }, 201)
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

export default activity
