import { Hono } from 'hono'
import { verify } from 'hono/jwt'

type Bindings = { DB: D1Database; JWT_SECRET: string }
type Variables = { user: any }

const sprints = new Hono<{ Bindings: Bindings; Variables: Variables }>()

sprints.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const payload = await verify(authHeader.slice(7), c.env.JWT_SECRET, 'HS256') as any
    c.set('user', payload); await next()
  } catch { return c.json({ error: 'Invalid token' }, 401) }
})

// GET /api/sprints?project_id=
sprints.get('/', async (c) => {
  try {
    const { project_id } = c.req.query()
    let sql = `
      SELECT s.*,
        u.full_name as created_by_name,
        (SELECT COUNT(*) FROM tasks t WHERE t.sprint_id=s.id) as task_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.sprint_id=s.id AND t.status='done') as done_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.sprint_id=s.id AND t.status='blocked') as blocked_count
      FROM sprints s
      LEFT JOIN users u ON s.created_by=u.id WHERE 1=1
    `
    const params: any[] = []
    if (project_id) { sql += ' AND s.project_id=?'; params.push(project_id) }
    sql += ' ORDER BY s.start_date DESC'
    const result = await c.env.DB.prepare(sql).bind(...params).all()
    return c.json({ sprints: result.results })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// POST /api/sprints
sprints.post('/', async (c) => {
  try {
    const user = c.get('user')
    if (!['admin','pm'].includes(user.role)) return c.json({ error: 'Forbidden' }, 403)
    const { project_id, name, goal, start_date, end_date } = await c.req.json()
    if (!project_id || !name || !start_date || !end_date) return c.json({ error: 'Required fields missing' }, 400)
    const id = 'sp-' + Date.now()
    await c.env.DB.prepare(`INSERT INTO sprints (id,project_id,name,goal,start_date,end_date,created_by) VALUES (?,?,?,?,?,?,?)`)
      .bind(id, project_id, name, goal||null, start_date, end_date, user.sub).run()
    const sprint = await c.env.DB.prepare('SELECT * FROM sprints WHERE id=?').bind(id).first()
    return c.json({ sprint }, 201)
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// PUT /api/sprints/:id
sprints.put('/:id', async (c) => {
  try {
    const user = c.get('user')
    if (!['admin','pm'].includes(user.role)) return c.json({ error: 'Forbidden' }, 403)
    const id = c.req.param('id')
    const body = await c.req.json()
    const fields: string[] = []; const vals: any[] = []
    for (const key of ['name','goal','start_date','end_date','status','velocity']) {
      if (key in body) { fields.push(`${key}=?`); vals.push(body[key]) }
    }
    fields.push('updated_at=?'); vals.push(new Date().toISOString()); vals.push(id)
    await c.env.DB.prepare(`UPDATE sprints SET ${fields.join(',')} WHERE id=?`).bind(...vals).run()
    const sprint = await c.env.DB.prepare('SELECT * FROM sprints WHERE id=?').bind(id).first()
    return c.json({ sprint })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

export default sprints

// ─── MILESTONES ─────────────────────────────────────────────────────────────
export const milestonesRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>()

milestonesRouter.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const payload = await verify(authHeader.slice(7), c.env.JWT_SECRET, 'HS256') as any
    c.set('user', payload); await next()
  } catch { return c.json({ error: 'Invalid token' }, 401) }
})

milestonesRouter.get('/', async (c) => {
  try {
    const { project_id, project_ids } = c.req.query()
    let sql = `SELECT m.*, u.full_name as created_by_name, p.name as project_name,
      (SELECT COUNT(*) FROM invoices i WHERE i.milestone_id=m.id) as invoice_count
      FROM milestones m LEFT JOIN users u ON m.created_by=u.id LEFT JOIN projects p ON m.project_id=p.id WHERE 1=1`
    const params: any[] = []
    if (project_id) { sql += ' AND m.project_id=?'; params.push(project_id) }
    else if (project_ids) {
      const ids = project_ids.split(',').filter(Boolean)
      if (ids.length > 0) { sql += ` AND m.project_id IN (${ids.map(() => '?').join(',')})`; params.push(...ids) }
    }
    sql += ' ORDER BY m.due_date ASC'
    const result = await c.env.DB.prepare(sql).bind(...params).all()
    return c.json({ milestones: result.results })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

milestonesRouter.post('/', async (c) => {
  try {
    const user = c.get('user')
    if (!['admin','pm'].includes(user.role)) return c.json({ error: 'Forbidden' }, 403)
    const { project_id, title, description, due_date, is_billable=0, invoice_amount=0, client_visible=1, deliverables } = await c.req.json()
    if (!project_id || !title || !due_date) return c.json({ error: 'project_id, title, due_date required' }, 400)
    const id = 'ms-' + Date.now()
    await c.env.DB.prepare(`INSERT INTO milestones (id,project_id,title,description,due_date,is_billable,invoice_amount,client_visible,deliverables,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, project_id, title, description||null, due_date, is_billable, invoice_amount, client_visible, deliverables ? JSON.stringify(deliverables) : null, user.sub).run()
    const ms = await c.env.DB.prepare('SELECT * FROM milestones WHERE id=?').bind(id).first()
    return c.json({ milestone: ms }, 201)
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

milestonesRouter.put('/:id', async (c) => {
  try {
    const user = c.get('user')
    if (!['admin','pm'].includes(user.role)) return c.json({ error: 'Forbidden' }, 403)
    const id = c.req.param('id')
    const body = await c.req.json()
    const fields: string[] = []; const vals: any[] = []
    for (const key of ['title','description','due_date','completion_pct','status','is_billable','invoice_amount','client_visible']) {
      if (key in body) { fields.push(`${key}=?`); vals.push(body[key]) }
    }
    fields.push('updated_at=?'); vals.push(new Date().toISOString()); vals.push(id)
    await c.env.DB.prepare(`UPDATE milestones SET ${fields.join(',')} WHERE id=?`).bind(...vals).run()

    // Log activity
    await c.env.DB.prepare(`INSERT INTO activity_logs (id,entity_type,entity_id,action,actor_user_id,actor_name,actor_role) VALUES (?,?,?,?,?,?,?)`)
      .bind('al-'+Date.now(),'milestone',id,'updated',user.sub,user.name,user.role).run()

    const ms = await c.env.DB.prepare('SELECT * FROM milestones WHERE id=?').bind(id).first()
    return c.json({ milestone: ms })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})
