import { Hono } from 'hono'
import { verify } from 'hono/jwt'

type Bindings = { DB: D1Database; JWT_SECRET: string }
type Variables = { user: any }

const invoices = new Hono<{ Bindings: Bindings; Variables: Variables }>()

invoices.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const payload = await verify(authHeader.slice(7), c.env.JWT_SECRET, 'HS256') as any
    c.set('user', payload); await next()
  } catch { return c.json({ error: 'Invalid token' }, 401) }
})

const invoiceQuery = `
  SELECT i.*, 
    p.name as project_name, p.code as project_code,
    cl.company_name, cl.contact_name, cl.avatar_color as client_color,
    m.title as milestone_title,
    u.full_name as created_by_name
  FROM invoices i
  LEFT JOIN projects p ON i.project_id=p.id
  LEFT JOIN clients cl ON i.client_id=cl.id
  LEFT JOIN milestones m ON i.milestone_id=m.id
  LEFT JOIN users u ON i.created_by=u.id
`

// GET /api/invoices?project_id=&client_id=&status=
invoices.get('/', async (c) => {
  try {
    const { project_id, client_id, status } = c.req.query()
    const user = c.get('user')
    let sql = invoiceQuery + ' WHERE 1=1'
    const params: any[] = []
    if (project_id) { sql += ' AND i.project_id=?'; params.push(project_id) }
    if (client_id) { sql += ' AND i.client_id=?'; params.push(client_id) }
    if (status) { sql += ' AND i.status=?'; params.push(status) }
    // Developers get no invoices
    if (user.role === 'developer') return c.json({ invoices: [], summary: {} })
    sql += ' ORDER BY i.issue_date DESC'
    const result = await c.env.DB.prepare(sql).bind(...params).all()

    // Summary stats
    const stats = await c.env.DB.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(total_amount) as total_value,
        SUM(CASE WHEN status='paid' THEN paid_amount ELSE 0 END) as total_paid,
        SUM(CASE WHEN status IN ('pending','sent') THEN total_amount ELSE 0 END) as total_pending,
        SUM(CASE WHEN status='overdue' THEN total_amount ELSE 0 END) as total_overdue,
        COUNT(CASE WHEN status='overdue' THEN 1 END) as overdue_count
      FROM invoices WHERE 1=1
    `).first()
    return c.json({ invoices: result.results, summary: stats })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// GET /api/invoices/:id
invoices.get('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    const inv = await c.env.DB.prepare(invoiceQuery + ' WHERE i.id=?').bind(id).first()
    if (!inv) return c.json({ error: 'Invoice not found' }, 404)
    return c.json({ invoice: inv })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// POST /api/invoices — Super Admin only
invoices.post('/', async (c) => {
  try {
    const user = c.get('user')
    if (user.role !== 'admin') return c.json({ error: 'Only Super Admin can create invoices' }, 403)
    const { project_id, client_id, milestone_id, title, description, amount, tax_pct=18, due_date, issue_date, notes, payment_terms, currency='INR' } = await c.req.json()
    if (!project_id || !client_id || !title || !amount || !due_date || !issue_date) return c.json({ error: 'Required fields missing' }, 400)

    const tax_amount = parseFloat(((amount * tax_pct) / 100).toFixed(2))
    const total_amount = parseFloat((amount + tax_amount).toFixed(2))
    const id = 'inv-'+Date.now()
    const invoice_number = 'INV-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-4)

    await c.env.DB.prepare(`
      INSERT INTO invoices (id,invoice_number,project_id,client_id,milestone_id,title,description,amount,currency,tax_pct,tax_amount,total_amount,status,due_date,issue_date,notes,payment_terms,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(id, invoice_number, project_id, client_id, milestone_id||null, title, description||null, amount, currency, tax_pct, tax_amount, total_amount, 'pending', due_date, issue_date, notes||null, payment_terms||null, user.sub).run()

    await c.env.DB.prepare(`INSERT INTO activity_logs (id,project_id,entity_type,entity_id,action,actor_user_id,actor_name,actor_role,new_value) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind('al-'+Date.now(), project_id,'invoice',id,'created',user.sub,user.name,user.role,invoice_number).run()

    // Notify client
    await c.env.DB.prepare(`INSERT INTO client_notifications (id,client_id,project_id,type,title,message) VALUES (?,?,?,?,?,?)`)
      .bind('cn-'+Date.now(), client_id, project_id, 'invoice', `New Invoice: ${invoice_number}`, `Invoice of ₹${total_amount.toLocaleString('en-IN')} has been raised. Due: ${due_date}`).run()

    const inv = await c.env.DB.prepare(invoiceQuery + ' WHERE i.id=?').bind(id).first()
    return c.json({ invoice: inv }, 201)
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// PUT /api/invoices/:id — Admin only
invoices.put('/:id', async (c) => {
  try {
    const user = c.get('user')
    if (user.role !== 'admin') return c.json({ error: 'Only Super Admin can update invoices' }, 403)
    const id = c.req.param('id')
    const body = await c.req.json()
    const fields: string[] = []; const vals: any[] = []
    for (const key of ['title','description','status','due_date','paid_date','paid_amount','transaction_ref','file_url','notes','payment_terms']) {
      if (key in body) { fields.push(`${key}=?`); vals.push(body[key]) }
    }
    fields.push('updated_at=?'); vals.push(new Date().toISOString()); vals.push(id)
    await c.env.DB.prepare(`UPDATE invoices SET ${fields.join(',')} WHERE id=?`).bind(...vals).run()

    await c.env.DB.prepare(`INSERT INTO activity_logs (id,entity_type,entity_id,action,actor_user_id,actor_name,actor_role,new_value) VALUES (?,?,?,?,?,?,?,?)`)
      .bind('al-'+Date.now(),'invoice',id,'updated',user.sub,user.name,user.role, body.status||'updated').run()

    const inv = await c.env.DB.prepare(invoiceQuery + ' WHERE i.id=?').bind(id).first()
    return c.json({ invoice: inv })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

// PATCH /api/invoices/:id/mark-paid
invoices.patch('/:id/mark-paid', async (c) => {
  try {
    const user = c.get('user')
    if (user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403)
    const id = c.req.param('id')
    const { paid_amount, transaction_ref, paid_date } = await c.req.json()
    const inv = await c.env.DB.prepare('SELECT * FROM invoices WHERE id=?').bind(id).first() as any
    if (!inv) return c.json({ error: 'Not found' }, 404)
    const status = paid_amount >= inv.total_amount ? 'paid' : 'partially_paid'
    await c.env.DB.prepare('UPDATE invoices SET status=?, paid_amount=?, transaction_ref=?, paid_date=?, updated_at=? WHERE id=?')
      .bind(status, paid_amount, transaction_ref||null, paid_date||new Date().toISOString().split('T')[0], new Date().toISOString(), id).run()
    await c.env.DB.prepare(`INSERT INTO client_notifications (id,client_id,project_id,type,title,message) VALUES (?,?,?,?,?,?)`)
      .bind('cn-'+Date.now(), inv.client_id, inv.project_id,'invoice',`Payment Confirmed: ${inv.invoice_number}`,`Payment of ₹${paid_amount.toLocaleString('en-IN')} received. Status: ${status}`).run()
    const updated = await c.env.DB.prepare(invoiceQuery + ' WHERE i.id=?').bind(id).first()
    return c.json({ invoice: updated })
  } catch(e: any) { return c.json({ error: e.message }, 500) }
})

export default invoices
