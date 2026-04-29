import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, requireRole } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'
import {
  validateRequired,
  validateLength,
  validateOptional,
  validateISODate,
  validatePositiveNumber,
  validateRange,
  respondWithError,
} from '../validators'
import {
  buildInvoiceEmailGST,
  sendInvoiceViaSmtp,
  parseEmailList,
  type InvoiceEmailEnv,
} from '../utils/invoice-email'

function sum(items: any[], pick: (item: any) => number) {
  return items.reduce((total, item) => total + pick(item), 0)
}

function calcAmounts(amount: number, taxPct: number) {
  const tax_amount = Number(((amount * taxPct) / 100).toFixed(2))
  const total_amount = Number((amount + tax_amount).toFixed(2))
  return { tax_amount, total_amount }
}

function nextInvoiceNumber() {
  const year = new Date().getFullYear()
  return `INV-${year}-${String(Date.now()).slice(-4)}`
}

export function createInvoicesRouter(models: MongoModels, jwtSecret: string, runtimeEnv: InvoiceEmailEnv = {}) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  router.get('/', async (req, res) => {
    try {
      const invoices = await models.invoices.find({}) as any[]
      const projects = await models.projects.find({}) as any[]
      const clients = await models.clients.find({}) as any[]
      const projById = new Map(projects.map((p) => [String(p.id), p]))
      const cliById = new Map(clients.map((c) => [String(c.id), c]))
      const enriched = invoices
        .map((invoice) => {
          const proj = projById.get(String(invoice.project_id))
          const cli = cliById.get(String(invoice.client_id))
          return {
            ...invoice,
            project_name: proj?.name,
            project_code: proj?.code,
            company_name: cli?.company_name,
            contact_name: cli?.contact_name,
            client_email: cli?.email,
            client_phone: cli?.phone,
            client_gstin: cli?.gstin,
            client_address: cli?.address_line,
            client_city: cli?.city,
            client_state: cli?.state,
            client_state_code: cli?.state_code,
            client_pincode: cli?.pincode,
            client_country: cli?.country,
            client_color: cli?.avatar_color,
          }
        })
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      const summary = {
        total_invoices: enriched.length,
        total_value: sum(enriched, (invoice) => Number(invoice.total_amount || 0)),
        total_paid: sum(enriched, (invoice) => Number(invoice.paid_amount || 0)),
        total_overdue: sum(enriched.filter((invoice) => invoice.status === 'overdue'), (invoice) => Number(invoice.total_amount || 0)),
        overdue_count: enriched.filter((invoice) => invoice.status === 'overdue').length,
      }
      return res.json({ invoices: enriched, summary, data: enriched })
    } catch {
      return res.json({
        invoices: [],
        data: [],
        summary: {
          total_invoices: 0,
          total_value: 0,
          total_paid: 0,
          total_overdue: 0,
          overdue_count: 0,
        },
      })
    }
  })

  router.get('/:id', async (req, res) => {
    try {
      const id = String(req.params.id)
      const invoice = await models.invoices.findById(id) as any
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' })
      const [project, client] = await Promise.all([
        invoice.project_id ? models.projects.findById(String(invoice.project_id)) : null,
        invoice.client_id ? models.clients.findById(String(invoice.client_id)) : null,
      ]) as any[]
      const enriched = {
        ...invoice,
        project_name: project?.name,
        project_code: project?.code,
        company_name: client?.company_name,
        contact_name: client?.contact_name,
        client_email: client?.email,
        client_phone: client?.phone,
        client_gstin: client?.gstin,
        client_address: client?.address_line,
        client_city: client?.city,
        client_state: client?.state,
        client_state_code: client?.state_code,
        client_pincode: client?.pincode,
        client_country: client?.country,
        client_color: client?.avatar_color,
      }
      return res.json({ invoice: enriched, data: enriched })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.post('/', requireRole('admin'), async (req, res) => {
    try {
      const user = req.user as any
      const body = req.body || {}
      const project_id = validateRequired(body.project_id, 'project_id')
      const client_id = validateRequired(body.client_id, 'client_id')
      const title = validateLength(String(body.title || '').trim(), 2, 200, 'Title')
      const description = validateOptional(body.description, (v) => validateLength(String(v), 0, 2000, 'Description'))
      const amount = validatePositiveNumber(body.amount, 'Amount')
      const tax_pct = body.tax_pct !== undefined ? validateRange(body.tax_pct, 0, 100, 'Tax %') : 18
      const issue_date = validateISODate(body.issue_date, 'Issue date')
      const due_date = validateISODate(body.due_date, 'Due date')
      if (issue_date > due_date) {
        return res.status(400).json({ error: 'Due date must be on or after issue date' })
      }
      const milestone_id = body.milestone_id || null
      const payment_terms = validateOptional(body.payment_terms, (v) => validateLength(String(v).trim(), 1, 200, 'Payment terms'))
      const notes = validateOptional(body.notes, (v) => validateLength(String(v).trim(), 0, 2000, 'Notes'))
      const currency = String(body.currency || 'INR').toUpperCase().slice(0, 8)

      const [project, client] = await Promise.all([
        models.projects.findById(String(project_id)),
        models.clients.findById(String(client_id)),
      ])
      if (!project) return res.status(400).json({ error: 'Invalid project_id' })
      if (!client) return res.status(400).json({ error: 'Invalid client_id' })

      const id = generateId('inv')
      const invoice_number = nextInvoiceNumber()
      const { tax_amount, total_amount } = calcAmounts(amount, tax_pct)
      const now = new Date().toISOString()

      const invoice = {
        id,
        invoice_number,
        project_id,
        client_id,
        milestone_id,
        title,
        description,
        amount,
        currency,
        tax_pct,
        tax_amount,
        total_amount,
        paid_amount: 0,
        paid_date: null,
        transaction_ref: null,
        file_url: null,
        status: 'pending',
        issue_date,
        due_date,
        notes,
        payment_terms,
        created_by: user?.sub || null,
        created_at: now,
        updated_at: now,
      }
      await models.invoices.insertOne(invoice)

      try {
        await models.activityLogs.insertOne({
          id: generateId('al'),
          project_id,
          entity_type: 'invoice',
          entity_id: id,
          action: 'created',
          actor_user_id: user?.sub || null,
          actor_name: user?.name || null,
          actor_role: user?.role || null,
          new_value: invoice_number,
          created_at: now,
        })
        await models.notifications.insertOne({
          id: generateId('cn'),
          client_id,
          project_id,
          type: 'invoice',
          title: `New Invoice: ${invoice_number}`,
          message: `Invoice of ${currency} ${total_amount.toLocaleString('en-IN')} has been raised. Due: ${due_date}`,
          is_read: 0,
          created_at: now,
        })
      } catch {}

      return res.status(201).json({ invoice, data: invoice, message: 'Invoice created successfully' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.put('/:id', requireRole('admin'), async (req, res) => {
    try {
      const id = String(req.params.id)
      const body = req.body || {}
      const invoice = await models.invoices.findById(id) as any
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' })

      const patch: any = { updated_at: new Date().toISOString() }
      if ('title' in body) patch.title = validateLength(String(body.title || '').trim(), 2, 200, 'Title')
      if ('description' in body) patch.description = body.description ? validateLength(String(body.description), 0, 2000, 'Description') : null
      if ('status' in body) {
        const next = String(body.status).toLowerCase()
        const allowed = ['pending', 'sent', 'paid', 'overdue', 'cancelled']
        if (!allowed.includes(next)) return res.status(400).json({ error: 'Invalid status' })
        patch.status = next
      }
      if ('issue_date' in body && body.issue_date) patch.issue_date = validateISODate(body.issue_date, 'Issue date')
      if ('due_date' in body && body.due_date) patch.due_date = validateISODate(body.due_date, 'Due date')
      if ('paid_date' in body) patch.paid_date = body.paid_date ? validateISODate(body.paid_date, 'Paid date') : null
      if ('paid_amount' in body) patch.paid_amount = validatePositiveNumber(body.paid_amount, 'Paid amount')
      if ('transaction_ref' in body) patch.transaction_ref = body.transaction_ref || null
      if ('file_url' in body) patch.file_url = body.file_url || null
      if ('notes' in body) patch.notes = body.notes || null
      if ('payment_terms' in body) patch.payment_terms = body.payment_terms || null
      if ('amount' in body || 'tax_pct' in body) {
        const amount = 'amount' in body ? validatePositiveNumber(body.amount, 'Amount') : Number(invoice.amount || 0)
        const tax_pct = 'tax_pct' in body ? validateRange(body.tax_pct, 0, 100, 'Tax %') : Number(invoice.tax_pct || 0)
        const { tax_amount, total_amount } = calcAmounts(amount, tax_pct)
        patch.amount = amount
        patch.tax_pct = tax_pct
        patch.tax_amount = tax_amount
        patch.total_amount = total_amount
      }

      await models.invoices.updateById(id, { $set: patch })
      const updated = await models.invoices.findById(id)
      return res.json({ invoice: updated, data: updated, message: 'Invoice updated' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.patch('/:id/mark-paid', requireRole('admin'), async (req, res) => {
    try {
      const id = String(req.params.id)
      const invoice = await models.invoices.findById(id) as any
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' })
      const body = req.body || {}
      const paidAmount = body.paid_amount !== undefined
        ? validatePositiveNumber(body.paid_amount, 'Paid amount')
        : Number(invoice.total_amount || 0)
      const paidDate = body.paid_date
        ? validateISODate(body.paid_date, 'Paid date')
        : new Date().toISOString().slice(0, 10)
      const now = new Date().toISOString()
      const totalAmount = Number(invoice.total_amount || 0)
      const status = paidAmount >= totalAmount ? 'paid' : invoice.status

      await models.invoices.updateById(id, {
        $set: {
          paid_amount: paidAmount,
          paid_date: paidDate,
          transaction_ref: body.transaction_ref || invoice.transaction_ref || null,
          status,
          updated_at: now,
        },
      })
      const updated = await models.invoices.findById(id)
      return res.json({ invoice: updated, message: 'Payment recorded' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.delete('/:id', requireRole('admin'), async (req, res) => {
    try {
      const id = String(req.params.id)
      await models.invoices.deleteById(id)
      return res.json({ message: 'Invoice deleted' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.post('/:id/send-email', requireRole('admin'), async (req, res) => {
    try {
      const id = String(req.params.id)
      const invoice = await models.invoices.findById(id) as any
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' })

      const [project, client] = await Promise.all([
        invoice.project_id ? models.projects.findById(String(invoice.project_id)) : null,
        invoice.client_id ? models.clients.findById(String(invoice.client_id)) : null,
      ]) as any[]

      const body = req.body || {}
      const to = parseEmailList(body.to || client?.email)
      const cc = parseEmailList(body.cc)
      if (!to.length) return res.status(400).json({ error: 'Client email is required' })

      const subject = String(body.subject || `Invoice ${invoice.invoice_number} from ${runtimeEnv.COMPANY_NAME || 'Mariox Software'}`).trim()
      const { html, text } = buildInvoiceEmailGST({ inv: invoice, client, project, env: runtimeEnv })

      await sendInvoiceViaSmtp({ env: runtimeEnv, to, cc, subject, html, text })

      const nextStatus = ['paid', 'partially_paid', 'cancelled'].includes(invoice.status) ? invoice.status : 'sent'
      const now = new Date().toISOString()
      if (invoice.status !== nextStatus) {
        await models.invoices.updateById(id, { $set: { status: nextStatus, updated_at: now } })
      }

      try {
        const user = req.user as any
        await models.activityLogs.insertOne({
          id: generateId('al'),
          project_id: invoice.project_id || null,
          entity_type: 'invoice',
          entity_id: id,
          action: 'sent',
          actor_user_id: user?.sub || null,
          actor_name: user?.name || null,
          actor_role: user?.role || null,
          new_value: invoice.invoice_number,
          metadata: JSON.stringify({ to, cc }),
          created_at: now,
        })
      } catch {}

      return res.json({ message: 'Invoice sent', to, cc })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  return router
}
