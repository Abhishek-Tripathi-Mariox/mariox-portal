import { Hono } from 'hono'
import { verify } from 'hono/jwt'

type Bindings = { DB: D1Database; JWT_SECRET: string }
type Variables = { user: any }

const documents = new Hono<{ Bindings: Bindings; Variables: Variables }>()

documents.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const payload = await verify(authHeader.slice(7), c.env.JWT_SECRET, 'HS256') as any
    c.set('user', payload); await next()
  } catch { return c.json({ error: 'Invalid token' }, 401) }
})

const CATEGORIES = ['sow','brd','frd','uiux','wireframes','meeting_notes','technical','test_report','release','billing','contract','other']

// GET /api/documents?project_id=&category=
documents.get('/', async (c) => {
  try {
    const { project_id, category, visibility } = c.req.query()
    const user = c.get('user')
    let sql = `
      SELECT d.*, u.full_name as uploaded_by_name, u.avatar_color as uploader_color,
        p.name as project_name
      FROM documents d
      LEFT JOIN users u ON d.uploaded_by=u.id
      LEFT JOIN projects p ON d.project_id=p.id
      WHERE 1=1
    `
    const params: any[] = []
    if (project_id) { sql += ' AND d.project_id=?'; params.push(project_id) }
    if (category) { sql += ' AND d.category=?'; params.push(category) }
    if (visibility) { sql += ' AND d.visibility=?'; params.push(visibility) }
    // Non-admin roles see only client-visible docs for developer
    if (user.role === 'developer') { sql += ' AND d.visibility != ?'; params.push('internal') }
    // Client role only sees client-visible docs
    if (user.role === 'client') { sql += ' AND (d.visibility=? OR d.visibility=?)'; params.push('client', 'all') }
    sql += ' ORDER BY d.created_at DESC'
    const result = await c.env.DB.prepare(sql).bind(...params).all()
    return c.json({ documents: result.results, categories: CATEGORIES })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// POST /api/documents — PM/Admin only (simulate file upload with file_url)
documents.post('/', async (c) => {
  try {
    const user = c.get('user')
    if (!['admin','pm'].includes(user.role)) return c.json({ error: 'Forbidden' }, 403)
    const { project_id, title, description, category='other', file_name, file_url, file_size=0, file_type, version='1.0', visibility='all', is_client_visible=1, tags } = await c.req.json()
    if (!project_id || !title || !file_name || !file_url) return c.json({ error: 'project_id, title, file_name, file_url required' }, 400)
    const id = 'doc-'+Date.now()
    await c.env.DB.prepare(`
      INSERT INTO documents (id,project_id,title,description,category,file_name,file_url,file_size,file_type,version,uploaded_by,visibility,is_client_visible,tags)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(id, project_id, title, description||null, category, file_name, file_url, file_size, file_type||null, version, user.sub, visibility, is_client_visible, tags ? JSON.stringify(tags) : null).run()

    await c.env.DB.prepare(`INSERT INTO activity_logs (id,project_id,entity_type,entity_id,action,actor_user_id,actor_name,actor_role,new_value) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind('al-'+Date.now(), project_id, 'document', id, 'uploaded', user.sub, user.name, user.role, title).run()

    const doc = await c.env.DB.prepare(`SELECT d.*, u.full_name as uploaded_by_name FROM documents d LEFT JOIN users u ON d.uploaded_by=u.id WHERE d.id=?`).bind(id).first()
    return c.json({ document: doc }, 201)
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// PUT /api/documents/:id
documents.put('/:id', async (c) => {
  try {
    const user = c.get('user')
    if (!['admin','pm'].includes(user.role)) return c.json({ error: 'Forbidden' }, 403)
    const id = c.req.param('id')
    const body = await c.req.json()
    const fields: string[] = []; const vals: any[] = []
    for (const key of ['title','description','category','version','visibility','is_client_visible','tags']) {
      if (key in body) { fields.push(`${key}=?`); vals.push(key==='tags' && Array.isArray(body[key]) ? JSON.stringify(body[key]) : body[key]) }
    }
    fields.push('updated_at=?'); vals.push(new Date().toISOString()); vals.push(id)
    await c.env.DB.prepare(`UPDATE documents SET ${fields.join(',')} WHERE id=?`).bind(...vals).run()
    const doc = await c.env.DB.prepare('SELECT * FROM documents WHERE id=?').bind(id).first()
    return c.json({ document: doc })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// DELETE /api/documents/:id
documents.delete('/:id', async (c) => {
  try {
    const user = c.get('user')
    if (!['admin','pm'].includes(user.role)) return c.json({ error: 'Forbidden' }, 403)
    await c.env.DB.prepare('DELETE FROM documents WHERE id=?').bind(c.req.param('id')).run()
    return c.json({ success: true })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// PATCH /api/documents/:id/download — increment download count
documents.patch('/:id/download', async (c) => {
  try {
    const id = c.req.param('id')
    const doc = await c.env.DB.prepare('SELECT * FROM documents WHERE id=?').bind(id).first() as any
    if (!doc) return c.json({ error: 'Not found' }, 404)
    await c.env.DB.prepare('UPDATE documents SET download_count=download_count+1 WHERE id=?').bind(id).run()
    return c.json({ file_url: doc.file_url, file_name: doc.file_name })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

export default documents
