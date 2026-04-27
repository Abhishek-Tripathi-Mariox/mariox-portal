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
      const website = validateOptional(body.website, (v) => validateUrl(v, 'Website'))
      const industry = validateOptional(body.industry, (v) => validateLength(String(v).trim(), 2, 80, 'Industry'))
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
      if ('website' in body) patch.website = validateOptional(body.website, (v) => validateUrl(v, 'Website'))
      if ('industry' in body) patch.industry = validateOptional(body.industry, (v) => validateLength(String(v).trim(), 2, 80, 'Industry'))
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

  return router
}
