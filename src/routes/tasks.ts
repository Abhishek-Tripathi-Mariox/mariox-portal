import { Hono } from 'hono'
import { verify } from 'hono/jwt'
import { checkKanbanPerm } from './kanban-permissions'

type Bindings = { DB: D1Database; JWT_SECRET: string }
type Variables = { user: any }

const tasks = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Middleware
tasks.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const payload = await verify(authHeader.slice(7), c.env.JWT_SECRET, 'HS256') as any
    c.set('user', payload)
    await next()
  } catch { return c.json({ error: 'Invalid token' }, 401) }
})

// Default columns seeded for new projects
const DEFAULT_COLUMNS = [
  { name: 'Backlog',      status_key: 'backlog',     color: '#64748b', position: 0, wip_limit: 0, is_done_column: 0 },
  { name: 'To Do',        status_key: 'todo',        color: '#94a3b8', position: 1, wip_limit: 0, is_done_column: 0 },
  { name: 'In Progress',  status_key: 'in_progress', color: '#3b82f6', position: 2, wip_limit: 3, is_done_column: 0 },
  { name: 'In Review',    status_key: 'in_review',   color: '#8b5cf6', position: 3, wip_limit: 0, is_done_column: 0 },
  { name: 'QA',           status_key: 'qa',          color: '#0ea5e9', position: 4, wip_limit: 0, is_done_column: 0 },
  { name: 'Done',         status_key: 'done',        color: '#10b981', position: 5, wip_limit: 0, is_done_column: 1 },
  { name: 'Blocked',      status_key: 'blocked',     color: '#ef4444', position: 6, wip_limit: 0, is_done_column: 0 },
]

async function ensureColumnsExist(db: D1Database, project_id: string) {
  const existing = await db.prepare('SELECT COUNT(*) as cnt FROM kanban_columns WHERE project_id=?').bind(project_id).first() as any
  if (existing?.cnt > 0) return
  // Seed defaults
  for (const col of DEFAULT_COLUMNS) {
    await db.prepare(`
      INSERT OR IGNORE INTO kanban_columns (id, project_id, name, status_key, color, position, wip_limit, is_done_column)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(`kc-${project_id}-${col.status_key}`, project_id, col.name, col.status_key, col.color, col.position, col.wip_limit, col.is_done_column).run()
  }
}

// ─── KANBAN COLUMNS MANAGEMENT ───────────────────────────────

// GET /api/tasks/columns/:project_id — get all columns for a project
tasks.get('/columns/:project_id', async (c) => {
  try {
    const project_id = c.req.param('project_id')
    await ensureColumnsExist(c.env.DB, project_id)
    const cols = await c.env.DB.prepare(
      'SELECT * FROM kanban_columns WHERE project_id=? ORDER BY position ASC'
    ).bind(project_id).all()
    return c.json({ columns: cols.results })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// POST /api/tasks/columns/:project_id — add a new column
tasks.post('/columns/:project_id', async (c) => {
  try {
    const user = c.get('user')
    if (!['admin','pm'].includes(user.role)) return c.json({ error: 'Forbidden' }, 403)
    const project_id = c.req.param('project_id')
    const { name, color='#6366f1', wip_limit=0, is_done_column=0 } = await c.req.json()
    if (!name) return c.json({ error: 'name required' }, 400)
    const status_key = name.toLowerCase().replace(/[^a-z0-9]/g,'_').replace(/_+/g,'_').slice(0,30) + '_' + Date.now()
    const maxPos = await c.env.DB.prepare('SELECT MAX(position) as m FROM kanban_columns WHERE project_id=?').bind(project_id).first() as any
    const position = (maxPos?.m ?? -1) + 1
    const id = `kc-${project_id}-${status_key}`
    await c.env.DB.prepare(`
      INSERT INTO kanban_columns (id, project_id, name, status_key, color, position, wip_limit, is_done_column)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, project_id, name, status_key, color, position, wip_limit, is_done_column).run()
    return c.json({ column: { id, project_id, name, status_key, color, position, wip_limit, is_done_column } }, 201)
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// PUT /api/tasks/columns/:id — update a column (name, color, wip_limit)
tasks.put('/columns/:id', async (c) => {
  try {
    const user = c.get('user')
    if (!['admin','pm'].includes(user.role)) return c.json({ error: 'Forbidden' }, 403)
    const id = c.req.param('id')
    const body = await c.req.json()
    const fields: string[] = []
    const vals: any[] = []
    for (const k of ['name','color','wip_limit','is_done_column','position']) {
      if (k in body) { fields.push(`${k}=?`); vals.push(body[k]) }
    }
    if (!fields.length) return c.json({ error: 'Nothing to update' }, 400)
    vals.push(id)
    await c.env.DB.prepare(`UPDATE kanban_columns SET ${fields.join(',')} WHERE id=?`).bind(...vals).run()
    const col = await c.env.DB.prepare('SELECT * FROM kanban_columns WHERE id=?').bind(id).first()
    return c.json({ column: col })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// DELETE /api/tasks/columns/:id — delete a column (moves tasks to backlog)
tasks.delete('/columns/:id', async (c) => {
  try {
    const user = c.get('user')
    if (!['admin','pm'].includes(user.role)) return c.json({ error: 'Forbidden' }, 403)
    const id = c.req.param('id')
    const col = await c.env.DB.prepare('SELECT * FROM kanban_columns WHERE id=?').bind(id).first() as any
    if (!col) return c.json({ error: 'Column not found' }, 404)
    // Move tasks to backlog
    await c.env.DB.prepare(`UPDATE tasks SET status='backlog' WHERE project_id=? AND status=?`).bind(col.project_id, col.status_key).run()
    await c.env.DB.prepare('DELETE FROM kanban_columns WHERE id=?').bind(id).run()
    return c.json({ success: true })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// ─── BOARD ────────────────────────────────────────────────────

// GET /api/tasks/board/:project_id — grouped by status using project's custom columns
tasks.get('/board/:project_id', async (c) => {
  try {
    const project_id = c.req.param('project_id')
    const { sprint_id } = c.req.query()

    // Ensure columns exist
    await ensureColumnsExist(c.env.DB, project_id)

    // Get columns ordered by position
    const colResult = await c.env.DB.prepare(
      'SELECT * FROM kanban_columns WHERE project_id=? ORDER BY position ASC'
    ).bind(project_id).all()
    const columnDefs = colResult.results as any[]

    let sql = `
      SELECT t.*,
        u.full_name as assignee_name, u.avatar_color as assignee_color, u.designation as assignee_designation,
        r.full_name as reporter_name,
        s.name as sprint_name,
        (SELECT COUNT(*) FROM tasks sub WHERE sub.parent_task_id = t.id) as subtask_count,
        (SELECT COUNT(*) FROM comments cm WHERE cm.entity_type='task' AND cm.entity_id=t.id) as comment_count
      FROM tasks t
      LEFT JOIN users u ON t.assignee_id = u.id
      LEFT JOIN users r ON t.reporter_id = r.id
      LEFT JOIN sprints s ON t.sprint_id = s.id
      WHERE t.project_id=? AND t.parent_task_id IS NULL
    `
    const params: any[] = [project_id]
    if (sprint_id) { sql += ' AND t.sprint_id=?'; params.push(sprint_id) }
    sql += ' ORDER BY t.position ASC, t.created_at ASC'

    const result = await c.env.DB.prepare(sql).bind(...params).all()
    
    // Build columns object using project's custom columns
    const columns: Record<string, any[]> = {}
    for (const col of columnDefs) {
      columns[col.status_key] = []
    }
    // Also include any other valid statuses
    for (const task of (result.results as any[])) {
      if (task.status in columns) {
        columns[task.status].push(task)
      } else {
        // Map unknown status to backlog
        if ('backlog' in columns) columns['backlog'].push(task)
      }
    }

    return c.json({ columns, column_defs: columnDefs, project_id })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// ─── TASKS CRUD ───────────────────────────────────────────────

// GET /api/tasks?project_id=&sprint_id=&assignee_id=&status=&priority=&type=
tasks.get('/', async (c) => {
  try {
    const { project_id, sprint_id, assignee_id, status, priority, type } = c.req.query()
    let sql = `
      SELECT t.*,
        u.full_name as assignee_name, u.avatar_color as assignee_color,
        r.full_name as reporter_name,
        p.name as project_name, p.code as project_code,
        s.name as sprint_name,
        pt.title as parent_task_title,
        (SELECT COUNT(*) FROM tasks sub WHERE sub.parent_task_id = t.id) as subtask_count,
        (SELECT COUNT(*) FROM comments c WHERE c.entity_type='task' AND c.entity_id=t.id) as comment_count
      FROM tasks t
      LEFT JOIN users u ON t.assignee_id = u.id
      LEFT JOIN users r ON t.reporter_id = r.id
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN sprints s ON t.sprint_id = s.id
      LEFT JOIN tasks pt ON t.parent_task_id = pt.id
      WHERE 1=1
    `
    const params: any[] = []
    if (project_id) { sql += ' AND t.project_id=?'; params.push(project_id) }
    if (sprint_id) { sql += ' AND t.sprint_id=?'; params.push(sprint_id) }
    if (assignee_id) { sql += ' AND t.assignee_id=?'; params.push(assignee_id) }
    if (status) { sql += ' AND t.status=?'; params.push(status) }
    if (priority) { sql += ' AND t.priority=?'; params.push(priority) }
    if (type) { sql += ' AND t.task_type=?'; params.push(type) }
    sql += ' AND t.parent_task_id IS NULL ORDER BY t.position ASC, t.created_at DESC'
    const result = await c.env.DB.prepare(sql).bind(...params).all()
    return c.json({ tasks: result.results })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// GET /api/tasks/my — tasks for the current user
tasks.get('/my', async (c) => {
  try {
    const user = c.get('user')
    const result = await c.env.DB.prepare(`
      SELECT t.*,
        p.name as project_name, p.code as project_code,
        s.name as sprint_name
      FROM tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN sprints s ON t.sprint_id = s.id
      WHERE t.assignee_id=? AND t.status != 'done'
      ORDER BY t.priority DESC, t.due_date ASC
    `).bind(user.sub).all()
    return c.json({ tasks: result.results })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// GET /api/tasks/:id
tasks.get('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const task = await c.env.DB.prepare(`
      SELECT t.*,
        u.full_name as assignee_name, u.avatar_color as assignee_color, u.designation as assignee_designation,
        r.full_name as reporter_name, r.avatar_color as reporter_color,
        p.name as project_name, p.code as project_code,
        s.name as sprint_name, s.status as sprint_status
      FROM tasks t
      LEFT JOIN users u ON t.assignee_id = u.id
      LEFT JOIN users r ON t.reporter_id = r.id
      LEFT JOIN projects p ON t.project_id = p.id
      LEFT JOIN sprints s ON t.sprint_id = s.id
      WHERE t.id=?
    `).bind(id).first() as any
    if (!task) return c.json({ error: 'Task not found' }, 404)

    const [subtasks, comments, watchers, activity] = await Promise.all([
      c.env.DB.prepare(`
        SELECT t.*, u.full_name as assignee_name, u.avatar_color as assignee_color
        FROM tasks t LEFT JOIN users u ON t.assignee_id=u.id
        WHERE t.parent_task_id=? ORDER BY t.created_at ASC
      `).bind(id).all(),
      c.env.DB.prepare(`
        SELECT c.*,
          u.full_name as author_name, u.avatar_color as author_color,
          cl.contact_name as client_name, cl.avatar_color as client_color, cl.company_name
        FROM comments c
        LEFT JOIN users u ON c.author_user_id=u.id
        LEFT JOIN clients cl ON c.author_client_id=cl.id
        WHERE c.entity_type='task' AND c.entity_id=? ORDER BY c.created_at ASC
      `).bind(id).all(),
      c.env.DB.prepare(`
        SELECT tw.*, u.full_name, u.avatar_color FROM task_watchers tw
        LEFT JOIN users u ON tw.user_id=u.id WHERE tw.task_id=?
      `).bind(id).all(),
      c.env.DB.prepare(`
        SELECT * FROM activity_logs WHERE entity_type='task' AND entity_id=? ORDER BY created_at DESC LIMIT 20
      `).bind(id).all()
    ])
    return c.json({ task, subtasks: subtasks.results, comments: comments.results, watchers: watchers.results, activity: activity.results })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// POST /api/tasks
tasks.post('/', async (c) => {
  try {
    const user = c.get('user')
    const body = await c.req.json()
    const { project_id, sprint_id, parent_task_id, title, description, task_type='task', status='backlog', priority='medium', assignee_id, story_points=0, estimated_hours=0, due_date, labels, is_client_visible=1, is_billable=1 } = body
    if (!project_id || !title) return c.json({ error: 'project_id and title required' }, 400)

    // Permission check
    const perm = await checkKanbanPerm(c.env.DB, project_id, user.role, user.sub, 'can_create_task')
    if (!perm.allowed) return c.json({ error: 'You do not have permission to create tasks on this board', reason: perm.reason }, 403)

    const id = 'task-' + Date.now()
    await c.env.DB.prepare(`
      INSERT INTO tasks (id,project_id,sprint_id,parent_task_id,title,description,task_type,status,priority,assignee_id,reporter_id,story_points,estimated_hours,due_date,labels,is_client_visible,is_billable)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(id, project_id, sprint_id||null, parent_task_id||null, title, description||null, task_type, status, priority, assignee_id||null, user.sub, story_points, estimated_hours, due_date||null, labels ? JSON.stringify(labels) : null, is_client_visible, is_billable).run()

    await c.env.DB.prepare(`INSERT INTO activity_logs (id,project_id,entity_type,entity_id,action,actor_user_id,actor_name,actor_role,new_value) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind('al-'+Date.now(), project_id, 'task', id, 'created', user.sub, user.name, user.role, title).run()

    const task = await c.env.DB.prepare('SELECT * FROM tasks WHERE id=?').bind(id).first()
    return c.json({ task }, 201)
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// PUT /api/tasks/:id
tasks.put('/:id', async (c) => {
  try {
    const user = c.get('user')
    const id = c.req.param('id')
    const old_task = await c.env.DB.prepare('SELECT * FROM tasks WHERE id=?').bind(id).first() as any
    if (!old_task) return c.json({ error: 'Task not found' }, 404)

    // Permission check: can_edit_any_task OR (can_edit_own_task AND is the assignee)
    const isOwner = old_task.assignee_id === user.sub
    const permKey = isOwner ? 'can_edit_own_task' : 'can_edit_any_task'
    const perm = await checkKanbanPerm(c.env.DB, old_task.project_id, user.role, user.sub, permKey, old_task.assignee_id)
    if (!perm.allowed) return c.json({ error: 'You do not have permission to edit this task', reason: perm.reason }, 403)

    const body = await c.req.json()
    const fields: string[] = []
    const vals: any[] = []
    const allowed = ['title','description','task_type','status','priority','assignee_id','sprint_id','story_points','estimated_hours','logged_hours','due_date','labels','is_client_visible','is_billable','position']
    for (const key of allowed) {
      if (key in body) {
        fields.push(`${key}=?`)
        vals.push(key === 'labels' && Array.isArray(body[key]) ? JSON.stringify(body[key]) : body[key])
      }
    }
    if (body.status === 'done' && old_task.status !== 'done') {
      fields.push('completed_at=?'); vals.push(new Date().toISOString())
    }
    fields.push('updated_at=?'); vals.push(new Date().toISOString())
    vals.push(id)
    await c.env.DB.prepare(`UPDATE tasks SET ${fields.join(',')} WHERE id=?`).bind(...vals).run()

    if (body.status && body.status !== old_task.status) {
      await c.env.DB.prepare(`INSERT INTO activity_logs (id,project_id,entity_type,entity_id,action,actor_user_id,actor_name,actor_role,old_value,new_value) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .bind('al-'+Date.now(), old_task.project_id, 'task', id, 'status_changed', user.sub, user.name, user.role, old_task.status, body.status).run()
      if (body.status === 'done') {
        await c.env.DB.prepare(`UPDATE sprints SET completed_story_points = completed_story_points + ? WHERE id=?`).bind(old_task.story_points||0, old_task.sprint_id).run().catch(()=>{})
      }
    }
    const updated = await c.env.DB.prepare('SELECT * FROM tasks WHERE id=?').bind(id).first()
    return c.json({ task: updated })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// DELETE /api/tasks/:id
tasks.delete('/:id', async (c) => {
  try {
    const user = c.get('user')
    const id = c.req.param('id')
    const task = await c.env.DB.prepare('SELECT project_id FROM tasks WHERE id=?').bind(id).first() as any
    if (!task) return c.json({ error: 'Task not found' }, 404)

    const perm = await checkKanbanPerm(c.env.DB, task.project_id, user.role, user.sub, 'can_delete_task')
    if (!perm.allowed) return c.json({ error: 'You do not have permission to delete tasks', reason: perm.reason }, 403)

    await c.env.DB.prepare('DELETE FROM task_watchers WHERE task_id=?').bind(id).run()
    await c.env.DB.prepare('DELETE FROM tasks WHERE parent_task_id=?').bind(id).run()
    await c.env.DB.prepare('DELETE FROM tasks WHERE id=?').bind(id).run()
    return c.json({ success: true })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// POST /api/tasks/:id/comment
tasks.post('/:id/comment', async (c) => {
  try {
    const user = c.get('user')
    const task_id = c.req.param('id')
    const task = await c.env.DB.prepare('SELECT project_id FROM tasks WHERE id=?').bind(task_id).first() as any
    if (!task) return c.json({ error: 'Task not found' }, 404)

    const perm = await checkKanbanPerm(c.env.DB, task.project_id, user.role, user.sub, 'can_comment')
    if (!perm.allowed) return c.json({ error: 'You do not have permission to comment on this board' }, 403)

    const { content, is_internal=0 } = await c.req.json()
    if (!content) return c.json({ error: 'Content required' }, 400)
    const authorUserId = user.role !== 'client' ? user.sub : null
    const authorClientId = user.role === 'client' ? user.sub : null
    const id = 'cmt-'+Date.now()
    await c.env.DB.prepare(`INSERT INTO comments (id,entity_type,entity_id,author_user_id,author_client_id,content,is_internal) VALUES (?,?,?,?,?,?,?)`)
      .bind(id,'task',task_id,authorUserId,authorClientId,content,is_internal).run()
    await c.env.DB.prepare(`INSERT INTO activity_logs (id,project_id,entity_type,entity_id,action,actor_user_id,actor_name,actor_role) VALUES (?,?,?,?,?,?,?,?)`)
      .bind('al-'+Date.now(), task.project_id,'task',task_id,'commented',user.sub,user.name,user.role).run()
    const comment = await c.env.DB.prepare(`
      SELECT c.*, u.full_name as author_name, u.avatar_color as author_color FROM comments c
      LEFT JOIN users u ON c.author_user_id=u.id WHERE c.id=?
    `).bind(id).first()
    return c.json({ comment }, 201)
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

tasks.post('/:id/comments', (c) => {
  // Alias
  return c.req.raw.text().then(body => {
    c.req.raw = new Request(c.req.raw.url.replace('/comments', '/comment'), { ...c.req.raw, body })
    return tasks.fetch(c.req.raw, c.env, c.executionCtx)
  }).catch((e: any) => c.json({ error: e.message }, 500))
})

// PATCH /api/tasks/:id/move — drag & drop status + position
tasks.patch('/:id/move', async (c) => {
  try {
    const user = c.get('user')
    const id = c.req.param('id')
    const { status, position } = await c.req.json()
    const old = await c.env.DB.prepare('SELECT status, project_id, assignee_id FROM tasks WHERE id=?').bind(id).first() as any
    if (!old) return c.json({ error: 'Task not found' }, 404)

    const perm = await checkKanbanPerm(c.env.DB, old.project_id, user.role, user.sub, 'can_move_task')
    if (!perm.allowed) return c.json({ error: 'You do not have permission to move tasks', reason: perm.reason }, 403)

    await c.env.DB.prepare('UPDATE tasks SET status=?, position=?, updated_at=? WHERE id=?')
      .bind(status, position||0, new Date().toISOString(), id).run()
    if (status !== old.status) {
      await c.env.DB.prepare(`INSERT INTO activity_logs (id,project_id,entity_type,entity_id,action,actor_user_id,actor_name,actor_role,old_value,new_value) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .bind('al-'+Date.now(), old.project_id,'task',id,'status_changed',user.sub,user.name,user.role,old.status,status).run()
    }
    return c.json({ success: true, status, position })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

export default tasks
