import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware } from '../express-middleware/auth'
import {
  validateEmail,
  validateNewPassword,
  validateName,
  validateOptional,
  validatePhone,
  validateUrl,
  validateLength,
  validateHexColor,
  respondWithError,
} from '../validators'

const encoder = new TextEncoder()

async function hashPassword(password: string, salt: string): Promise<string> {
  const data = encoder.encode(password + salt)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

function sum(items: any[], pick: (item: any) => number) {
  return items.reduce((total, item) => total + pick(item), 0)
}

export function createClientsRouter(models: MongoModels, jwtSecret: string, passwordSalt = '') {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  router.post('/', async (req, res) => {
    try {
      const user = req.user as any
      const role = String(user?.role || '').toLowerCase()
      if (!['admin', 'pm', 'pc'].includes(role)) {
        return res.status(403).json({ error: 'Forbidden' })
      }

      const body = req.body || {}
      const email = validateEmail(body.email)
      const password = validateNewPassword(body.password)
      const company_name = validateName(body.company_name, 'Company name', 2, 120)
      const contact_name = validateName(body.contact_name, 'Contact name', 2, 100)
      const phone = validateOptional(body.phone, (v) => validatePhone(v, 'Phone'))
      const website = body.website ? String(body.website).trim().slice(0, 200) : null
      const industry = validateOptional(body.industry, (v) => validateLength(String(v).trim(), 2, 80, 'Industry'))
      const gstin = body.gstin ? String(body.gstin).trim().toUpperCase().slice(0, 20) : null
      const address_line = body.address_line ? String(body.address_line).trim().slice(0, 300) : null
      const city = body.city ? String(body.city).trim().slice(0, 80) : null
      const state = body.state ? String(body.state).trim().slice(0, 80) : null
      const state_code = body.state_code ? String(body.state_code).trim().toUpperCase().slice(0, 8) : null
      const pincode = body.pincode ? String(body.pincode).trim().slice(0, 16) : null
      const country = body.country ? String(body.country).trim().slice(0, 80) : null
      const avatar_color = body.avatar_color
        ? validateHexColor(body.avatar_color, 'Avatar color')
        : '#6366f1'

      const [existingClient, existingUser] = await Promise.all([
        models.clients.findByEmail(email),
        models.users.findByEmail(email),
      ])
      if (existingClient || existingUser) {
        return res.status(409).json({ error: 'Email already registered' })
      }

      const password_hash = await hashPassword(password, passwordSalt)
      const created = await models.clients.createClient({
        email,
        password_hash,
        company_name,
        contact_name,
        phone,
        website,
        industry,
        gstin,
        address_line,
        city,
        state,
        state_code,
        pincode,
        country,
        avatar_color,
        is_active: 1,
        email_verified: 1,
      })

      return res.status(201).json({ client: created, data: created, message: 'Client created successfully' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.put('/:id', async (req, res) => {
    try {
      const user = req.user as any
      const role = String(user?.role || '').toLowerCase()
      const id = String(req.params.id)
      if (!['admin', 'pm', 'pc'].includes(role) && !(role === 'client' && user?.sub === id)) {
        return res.status(403).json({ error: 'Forbidden' })
      }

      const body = req.body || {}
      const patch: any = { updated_at: new Date().toISOString() }
      if ('company_name' in body) patch.company_name = validateName(body.company_name, 'Company name', 2, 120)
      if ('contact_name' in body) patch.contact_name = validateName(body.contact_name, 'Contact name', 2, 100)
      if ('phone' in body) patch.phone = validateOptional(body.phone, (v) => validatePhone(v, 'Phone'))
      if ('website' in body) patch.website = body.website ? String(body.website).trim().slice(0, 200) : null
      if ('industry' in body) patch.industry = validateOptional(body.industry, (v) => validateLength(String(v).trim(), 2, 80, 'Industry'))
      if ('gstin' in body) patch.gstin = body.gstin ? String(body.gstin).trim().toUpperCase().slice(0, 20) : null
      if ('address_line' in body) patch.address_line = body.address_line ? String(body.address_line).trim().slice(0, 300) : null
      if ('city' in body) patch.city = body.city ? String(body.city).trim().slice(0, 80) : null
      if ('state' in body) patch.state = body.state ? String(body.state).trim().slice(0, 80) : null
      if ('state_code' in body) patch.state_code = body.state_code ? String(body.state_code).trim().toUpperCase().slice(0, 8) : null
      if ('pincode' in body) patch.pincode = body.pincode ? String(body.pincode).trim().slice(0, 16) : null
      if ('country' in body) patch.country = body.country ? String(body.country).trim().slice(0, 80) : null
      if ('avatar_color' in body && body.avatar_color) patch.avatar_color = validateHexColor(body.avatar_color, 'Avatar color')
      if ('is_active' in body) patch.is_active = body.is_active ? 1 : 0

      await models.clients.updateById(id, { $set: patch })
      const updated = await models.clients.findById(id)
      return res.json({ client: updated, data: updated, message: 'Client updated successfully' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.delete('/:id', async (req, res) => {
    try {
      const user = req.user as any
      const role = String(user?.role || '').toLowerCase()
      if (role !== 'admin') return res.status(403).json({ error: 'Forbidden' })
      await models.clients.deleteById(String(req.params.id))
      return res.json({ message: 'Client deleted successfully' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // Admin-only: reset a client's password. The chosen plaintext is returned
  // ONCE in the response so the admin can share it manually — there's no
  // way to recover it later (we only persist a SHA-256 hash). Setting
  // `must_change_password=1` would be ideal but the client schema doesn't
  // carry that flag yet, so the client can keep using the temp password
  // until they change it from their profile.
  router.post('/:id/reset-password', async (req, res) => {
    try {
      const user = req.user as any
      const role = String(user?.role || '').toLowerCase()
      if (role !== 'admin') return res.status(403).json({ error: 'Forbidden' })
      const id = String(req.params.id)
      const newPassword = validateNewPassword(req.body?.new_password, 'New password')
      const target = await models.clients.findById(id) as any
      if (!target) return res.status(404).json({ error: 'Client not found' })
      const password_hash = await hashPassword(newPassword, passwordSalt)
      await models.clients.updateById(id, {
        $set: { password_hash, updated_at: new Date().toISOString() },
      })
      return res.json({
        message: 'Client password reset',
        client_id: id,
        email: target.email,
      })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.get('/', async (req, res) => {
    try {
      const user = req.user as any
      if (!['admin', 'pm'].includes(String(user.role || '').toLowerCase())) {
        return res.status(403).json({ error: 'Forbidden' })
      }

      const clients = await models.clients.find({}) as any[]
      const projects = await models.projects.find({}) as any[]
      const invoices = await models.invoices.find({}) as any[]

      const rows = clients.map((client) => {
        const clientProjects = projects.filter((project) => project.client_id === client.id)
        const clientInvoices = invoices.filter((invoice) => invoice.client_id === client.id)
        return {
          ...client,
          project_count: clientProjects.length,
          active_projects: clientProjects.filter((project) => project.status === 'active').length,
          total_billed: sum(clientInvoices, (invoice) => Number(invoice.total_amount || 0)),
          total_paid: sum(clientInvoices, (invoice) => Number(invoice.paid_amount || 0)),
        }
      }).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))

      return res.json({ clients: rows })
    } catch (error: any) {
      return res.json({ clients: [] })
    }
  })

  router.get('/:id', async (req, res) => {
    try {
      const user = req.user as any
      const id = req.params.id
      if (String(user.role || '').toLowerCase() === 'client' && String(user.sub) !== id) {
        return res.status(403).json({ error: 'Forbidden' })
      }

      const client = await models.clients.findById(id)
      if (!client) return res.status(404).json({ error: 'Client not found' })

      const projects = (await models.projects.find({ client_id: id }) as any[]).map((project) => ({
        ...project,
        pm_name: undefined,
        team_size: 0,
        task_count: 0,
        done_tasks: 0,
      }))
      const invoices = await models.invoices.find({ client_id: id }) as any[]
      const notifications = await models.notifications.find({ client_id: id }) as any[]
      return res.json({ client, projects, invoices, notifications })
    } catch (error: any) {
      return res.json({ client: null, projects: [], invoices: [], notifications: [] })
    }
  })

  router.get('/:id/dashboard', async (req, res) => {
    try {
      const id = req.params.id
      const client = await models.clients.findById(id)
      if (!client) return res.status(404).json({ error: 'Client not found' })
      const projects = await models.projects.find({ client_id: id }) as any[]
      const billingInvoices = await models.invoices.find({ client_id: id }) as any[]
      const milestones = await models.milestones.find({}) as any[]
      const notifications = await models.notifications.find({ client_id: id }) as any[]
      const updates = await models.activityLogs.find({ project_id: { $in: projects.map((p) => p.id) } }) as any[]

      return res.json({
        projects,
        billing: {
          total_invoices: billingInvoices.length,
          total_billed: sum(billingInvoices, (invoice) => Number(invoice.total_amount || 0)),
          total_paid: sum(billingInvoices, (invoice) => Number(invoice.paid_amount || 0)),
          pending_amount: sum(billingInvoices.filter((invoice) => ['pending', 'sent'].includes(invoice.status)), (invoice) => Number(invoice.total_amount || 0)),
          overdue_amount: sum(billingInvoices.filter((invoice) => invoice.status === 'overdue'), (invoice) => Number(invoice.total_amount || 0)),
          overdue_count: billingInvoices.filter((invoice) => invoice.status === 'overdue').length,
        },
        recent_activity: updates,
        milestones: milestones.filter((milestone) => milestone.client_visible === 1),
        notifications: notifications.filter((notification) => !notification.is_read),
        updates: [],
      })
    } catch (error: any) {
      return res.json({
        projects: [],
        billing: {
          total_invoices: 0,
          total_billed: 0,
          total_paid: 0,
          pending_amount: 0,
          overdue_amount: 0,
          overdue_count: 0,
        },
        recent_activity: [],
        milestones: [],
        notifications: [],
        updates: [],
      })
    }
  })

  // ── BULK IMPORT (CSV) ──────────────────────────────────────
  router.get('/import/template.csv', (_req, res) => {
    const sample = [
      'company_name,contact_name,email,phone,website,industry,gstin,address_line,city,state,state_code,pincode,country,avatar_color,password',
      'Acme Corp,Anita Joshi,anita@acme.com,+91-9876543210,https://acme.com,SaaS,27AABCA1234F1Z5,12 MG Road,Mumbai,MAHARASHTRA,27,400001,India,#FF7A45,Welcome@123',
      'Globex Ltd,Karthik Iyer,karthik@globex.com,+91-9876500001,https://globex.com,Fintech,29AABCG5678H1Z9,Plot 4 Sector 3,Bengaluru,KARNATAKA,29,560001,India,#FFB347,Welcome@123',
    ].join('\n')
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', 'attachment; filename="clients_import_template.csv"')
    return res.send(sample)
  })

  router.post('/import', async (req, res) => {
    try {
      const user = req.user as any
      const role = String(user?.role || '').toLowerCase()
      if (!['admin', 'pm', 'pc'].includes(role)) {
        return res.status(403).json({ error: 'Forbidden' })
      }

      const body = req.body || {}
      const csvText = String(body.csv || '').trim()
      if (!csvText) return res.status(400).json({ error: 'csv is required' })

      const rows = parseCsv(csvText)
      if (rows.length < 2) return res.status(400).json({ error: 'CSV must contain header + data rows' })

      const headers = rows[0].map((h) => String(h || '').trim().toLowerCase())
      for (const r of ['company_name', 'contact_name', 'email']) {
        if (!headers.includes(r)) return res.status(400).json({ error: `Missing required column: ${r}` })
      }

      const created: any[] = []
      const errors: { row: number; email?: string; error: string }[] = []
      const encoder = new TextEncoder()

      for (let i = 1; i < rows.length; i++) {
        const cells = rows[i]
        if (!cells || cells.every((c) => !c?.trim())) continue
        const record: Record<string, string> = {}
        headers.forEach((h, idx) => { record[h] = String(cells[idx] || '').trim() })

        try {
          const email = validateEmail(record.email)
          const company = validateName(record.company_name, 'Company name', 2, 120)
          const contact = validateName(record.contact_name, 'Contact name', 2, 100)
          const password = record.password ? String(record.password) : 'Welcome@123'
          validateNewPassword(password)

          const [exClient, exUser] = await Promise.all([
            models.clients.findByEmail(email),
            models.users.findByEmail(email),
          ])
          if (exClient || exUser) {
            errors.push({ row: i + 1, email, error: 'Email already exists' })
            continue
          }

          const data = encoder.encode(password + passwordSalt)
          const hashBuffer = await crypto.subtle.digest('SHA-256', data)
          const passwordHash = Array.from(new Uint8Array(hashBuffer))
            .map((b) => b.toString(16).padStart(2, '0')).join('')

          const gstin = record.gstin ? String(record.gstin).trim().toUpperCase().slice(0, 20) : null
          if (gstin && !/^[0-9A-Z]{15}$/.test(gstin)) {
            errors.push({ row: i + 1, email, error: 'GSTIN must be 15 alphanumeric characters' })
            continue
          }
          const pincode = record.pincode ? String(record.pincode).trim().slice(0, 16) : null
          if (pincode && !/^[0-9]{4,8}$/.test(pincode)) {
            errors.push({ row: i + 1, email, error: 'PIN code must be numeric (4–8 digits)' })
            continue
          }
          const cl = await models.clients.createClient({
            email,
            password_hash: passwordHash,
            company_name: company,
            contact_name: contact,
            phone: record.phone || null,
            website: record.website || null,
            industry: record.industry || null,
            gstin,
            address_line: record.address_line ? String(record.address_line).trim().slice(0, 300) : null,
            city: record.city ? String(record.city).trim().slice(0, 80) : null,
            state: record.state ? String(record.state).trim().slice(0, 80) : null,
            state_code: record.state_code ? String(record.state_code).trim().toUpperCase().slice(0, 8) : null,
            pincode,
            country: record.country ? String(record.country).trim().slice(0, 80) : null,
            avatar_color: record.avatar_color && /^#[0-9a-fA-F]{6}$/.test(record.avatar_color)
              ? record.avatar_color
              : '#FF7A45',
            is_active: 1,
            email_verified: 1,
          })
          created.push({ id: (cl as any)?.id, email, company_name: company })
        } catch (e: any) {
          errors.push({ row: i + 1, email: record.email, error: e?.message || 'Failed' })
        }
      }

      return res.json({
        created_count: created.length,
        error_count: errors.length,
        created,
        errors,
      })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  return router
}

// ── Tiny CSV parser (handles quoted fields with commas / escaped quotes)
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') { inQuotes = false }
      else field += ch
    } else {
      if (ch === '"') inQuotes = true
      else if (ch === ',') { cur.push(field); field = '' }
      else if (ch === '\n') { cur.push(field); rows.push(cur); cur = []; field = '' }
      else if (ch === '\r') { /* skip */ }
      else field += ch
    }
  }
  if (field || cur.length) { cur.push(field); rows.push(cur) }
  return rows
}
