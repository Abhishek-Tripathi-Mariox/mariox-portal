import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, requireRole } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'
import {
  validateLength,
  validateEmail,
  validateNewPassword,
  respondWithError,
} from '../validators'
import { sendSmtpEmail, type SmtpEnv } from '../utils/smtp'

const LEAD_TASK_OFFSET_HOURS = 4

async function hashPasswordSha256(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(password + salt)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

function escapeEmailHtml(s: string) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildClientWelcomeEmail(opts: {
  contactName: string
  companyName: string
  email: string
  password: string
  loginUrl: string
}) {
  const { contactName, companyName, email, password, loginUrl } = opts
  const subject = `Welcome to Mariox Portal — your client account is ready`
  const text = [
    `Hi ${contactName},`,
    '',
    `Your client account for ${companyName} has been created on Mariox Portal.`,
    '',
    `Login URL : ${loginUrl}`,
    `Email     : ${email}`,
    `Password  : ${password}`,
    '',
    `Please log in and change your password as soon as possible.`,
    '',
    `— Mariox Software Pvt Ltd`,
  ].join('\n')

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111827;background:#f3f4f6;padding:24px">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">
        <div style="padding:20px 24px;background:#1A0E08;color:#fff">
          <div style="font-size:18px;font-weight:700">Welcome to Mariox Portal</div>
          <div style="font-size:12px;opacity:.8;margin-top:4px">Your client account is ready</div>
        </div>
        <div style="padding:24px">
          <p style="margin:0 0 12px;font-size:14px">Hi <strong>${escapeEmailHtml(contactName)}</strong>,</p>
          <p style="margin:0 0 16px;font-size:14px;line-height:1.55">Your client account for <strong>${escapeEmailHtml(companyName)}</strong> has been created. Use the credentials below to sign in:</p>
          <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;margin:8px 0 16px">
            <tr><td style="padding:10px 14px;background:#f9fafb;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb;width:120px">Login URL</td><td style="padding:10px 14px;font-size:13px;border-bottom:1px solid #e5e7eb"><a href="${escapeEmailHtml(loginUrl)}" style="color:#FF7A45">${escapeEmailHtml(loginUrl)}</a></td></tr>
            <tr><td style="padding:10px 14px;background:#f9fafb;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb">Email</td><td style="padding:10px 14px;font-size:13px;border-bottom:1px solid #e5e7eb"><strong>${escapeEmailHtml(email)}</strong></td></tr>
            <tr><td style="padding:10px 14px;background:#f9fafb;font-size:12px;color:#6b7280">Password</td><td style="padding:10px 14px;font-size:13px"><code style="background:#f3f4f6;padding:2px 6px;border-radius:4px">${escapeEmailHtml(password)}</code></td></tr>
          </table>
          <p style="margin:0;font-size:12px;color:#6b7280">For security, please change your password after the first login.</p>
        </div>
        <div style="padding:14px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">— Mariox Software Pvt Ltd</div>
      </div>
    </div>`

  return { subject, html, text }
}

const ALLOWED_BADGES = new Set([
  'todo', 'inprogress', 'review', 'done', 'critical', 'medium',
])

function sanitizeStatusKey(input: any): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

async function enrichLeads(models: MongoModels, leads: any[]) {
  if (!leads.length) return []
  const users = await models.users.find({}) as any[]
  const usersById = new Map(users.map((u) => [String(u.id), u]))
  const leadIds = leads.map((l) => String(l.id))
  const tasks = await models.leadTasks.find({ lead_id: { $in: leadIds } }) as any[]
  const tasksByLead = new Map<string, any[]>()
  for (const t of tasks) {
    const list = tasksByLead.get(String(t.lead_id)) || []
    list.push(t)
    tasksByLead.set(String(t.lead_id), list)
  }
  return leads.map((l) => {
    const assignee = usersById.get(String(l.assigned_to)) as any
    const creator = usersById.get(String(l.created_by)) as any
    return {
      ...l,
      assigned_to_name: assignee?.full_name || null,
      assigned_to_email: assignee?.email || null,
      assigned_to_avatar: assignee?.avatar_color || null,
      created_by_name: creator?.full_name || null,
      tasks: (tasksByLead.get(String(l.id)) || []).sort(
        (a, b) => String(a.due_date || '').localeCompare(String(b.due_date || ''))
      ),
    }
  })
}

export interface LeadsRouterEnv extends SmtpEnv {
  PASSWORD_SALT?: string
  CLIENT_LOGIN_URL?: string
  LOGIN_URL?: string
  APP_URL?: string
  PUBLIC_BASE_URL?: string
}

export function createLeadsRouter(
  models: MongoModels,
  jwtSecret: string,
  runtimeEnv: LeadsRouterEnv = {},
  passwordSalt = '',
) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  // ── Status configuration ────────────────────────────────────
  // Five defaults are seeded on boot; admin/pm/pc can add or remove
  // custom statuses. System statuses (is_system=1) cannot be deleted.
  function statusRepo(kind: string) {
    if (kind === 'lead') return models.leadStatuses
    if (kind === 'task') return models.leadTaskStatuses
    return null
  }

  router.get('/statuses', async (_req, res) => {
    try {
      const [leadStatuses, taskStatuses] = await Promise.all([
        models.leadStatuses.find({}) as Promise<any[]>,
        models.leadTaskStatuses.find({}) as Promise<any[]>,
      ])
      const sortFn = (a: any, b: any) => Number(a.position || 0) - Number(b.position || 0)
      leadStatuses.sort(sortFn)
      taskStatuses.sort(sortFn)
      return res.json({
        data: { lead: leadStatuses, task: taskStatuses },
        lead: leadStatuses,
        task: taskStatuses,
      })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load statuses' })
    }
  })

  router.post('/statuses/:kind', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
      const repo = statusRepo(String(req.params.kind))
      if (!repo) return res.status(400).json({ error: 'Invalid status kind' })
      const body = req.body || {}
      const label = validateLength(String(body.label || '').trim(), 2, 40, 'Label')
      const key = sanitizeStatusKey(body.key || body.label)
      if (!key) return res.status(400).json({ error: 'Status key is required' })
      const badge = String(body.badge || 'todo').toLowerCase()
      if (!ALLOWED_BADGES.has(badge)) {
        return res.status(400).json({ error: 'Invalid badge — use one of: ' + [...ALLOWED_BADGES].join(', ') })
      }
      const existing = await repo.findOne({ key }) as any
      if (existing) return res.status(409).json({ error: 'A status with this key already exists' })
      const all = await repo.find({}) as any[]
      const position = all.reduce((max, s) => Math.max(max, Number(s.position || 0)), -1) + 1
      const now = new Date().toISOString()
      const doc = {
        id: generateId('lstatus'),
        key,
        label,
        badge,
        position,
        is_system: 0,
        created_at: now,
        updated_at: now,
      }
      await repo.insertOne(doc)
      return res.status(201).json({ data: doc, status: doc })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.delete('/statuses/:kind/:id', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
      const repo = statusRepo(String(req.params.kind))
      if (!repo) return res.status(400).json({ error: 'Invalid status kind' })
      const id = String(req.params.id)
      const status = await repo.findById(id) as any
      if (!status) return res.status(404).json({ error: 'Status not found' })
      if (status.is_system) return res.status(400).json({ error: 'System statuses cannot be deleted' })
      const inUse = req.params.kind === 'lead'
        ? await models.leads.countDocuments({ status: status.key })
        : await models.leadTasks.countDocuments({ status: status.key })
      if (inUse > 0) {
        return res.status(400).json({
          error: `Status is in use by ${inUse} record${inUse === 1 ? '' : 's'}. Reassign them first.`,
        })
      }
      await repo.deleteById(id)
      return res.json({ message: 'Status deleted' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to delete status' })
    }
  })

  router.get('/', async (req, res) => {
    try {
      const user = req.user as any
      const role = String(user?.role || '').toLowerCase()
      const filter: any = {}
      if (role !== 'admin' && role !== 'pm' && role !== 'pc') {
        filter.assigned_to = user?.sub
      }
      const leads = await models.leads.find(filter) as any[]
      leads.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      const enriched = await enrichLeads(models, leads)
      return res.json({ data: enriched, leads: enriched })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load leads' })
    }
  })

  router.get('/:id', async (req, res) => {
    try {
      const lead = await models.leads.findById(String(req.params.id)) as any
      if (!lead) return res.status(404).json({ error: 'Lead not found' })
      const [enriched] = await enrichLeads(models, [lead])
      return res.json({ data: enriched, lead: enriched })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load lead' })
    }
  })

  router.post('/', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
      const user = req.user as any
      const body = req.body || {}
      const name = validateLength(String(body.name || '').trim(), 2, 120, 'Name')
      const email = validateEmail(body.email, 'Email')
      const phone = validateLength(String(body.phone || '').trim(), 4, 30, 'Phone')
      const requirement = validateLength(String(body.requirement || '').trim(), 1, 5000, 'Requirement')
      const source = validateLength(String(body.source || '').trim(), 1, 80, 'Source')
      const requirementFile = body.requirement_file && typeof body.requirement_file === 'object'
        ? {
            url: String(body.requirement_file.url || ''),
            name: String(body.requirement_file.name || body.requirement_file.original_name || 'attachment'),
            mime: String(body.requirement_file.mime || body.requirement_file.mime_type || ''),
            size: Number(body.requirement_file.size || 0),
          }
        : null
      const assignedTo = String(body.assigned_to || '').trim()
      if (!assignedTo) {
        return res.status(400).json({ error: 'Assignee is required' })
      }
      const assignee = await models.users.findById(assignedTo) as any
      if (!assignee) {
        return res.status(400).json({ error: 'Assigned user not found' })
      }

      const now = new Date()
      const nowIso = now.toISOString()
      const dueDate = new Date(now.getTime() + LEAD_TASK_OFFSET_HOURS * 60 * 60 * 1000).toISOString()
      const leadId = generateId('lead')
      await models.leads.insertOne({
        id: leadId,
        name,
        email,
        phone,
        requirement,
        requirement_file: requirementFile && requirementFile.url ? requirementFile : null,
        source,
        status: 'new',
        assigned_to: assignedTo,
        created_by: user?.sub || null,
        created_at: nowIso,
        updated_at: nowIso,
      })

      const taskId = generateId('ltask')
      await models.leadTasks.insertOne({
        id: taskId,
        lead_id: leadId,
        title: `Follow up with ${name}`,
        description: requirement,
        assigned_to: assignedTo,
        assigned_by: user?.sub || null,
        status: 'pending',
        due_date: dueDate,
        created_at: nowIso,
        updated_at: nowIso,
      })

      return res.status(201).json({
        data: { id: leadId, task_id: taskId, due_date: dueDate },
        message: 'Lead created and follow-up task scheduled',
      })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.put('/:id', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
      const id = String(req.params.id)
      const body = req.body || {}
      const lead = await models.leads.findById(id) as any
      if (!lead) return res.status(404).json({ error: 'Lead not found' })
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if ('name' in body) patch.name = validateLength(String(body.name || '').trim(), 2, 120, 'Name')
      if ('email' in body) patch.email = validateEmail(body.email, 'Email')
      if ('phone' in body) patch.phone = validateLength(String(body.phone || '').trim(), 4, 30, 'Phone')
      if ('requirement' in body) patch.requirement = validateLength(String(body.requirement || '').trim(), 1, 5000, 'Requirement')
      if ('requirement_file' in body) {
        const f = body.requirement_file
        patch.requirement_file = f && typeof f === 'object' && f.url
          ? {
              url: String(f.url),
              name: String(f.name || f.original_name || 'attachment'),
              mime: String(f.mime || f.mime_type || ''),
              size: Number(f.size || 0),
            }
          : null
      }
      if ('source' in body) patch.source = validateLength(String(body.source || '').trim(), 1, 80, 'Source')
      if ('status' in body) {
        const nextStatus = String(body.status || 'new').trim().toLowerCase()
        if (nextStatus === 'closed') {
          return res.status(400).json({
            error: 'Use "Close & Convert to Client" to mark a lead as closed — it requires client details.',
          })
        }
        patch.status = nextStatus
      }
      if ('assigned_to' in body) {
        const assignedTo = String(body.assigned_to || '').trim()
        if (!assignedTo) return res.status(400).json({ error: 'Assignee is required' })
        const assignee = await models.users.findById(assignedTo) as any
        if (!assignee) return res.status(400).json({ error: 'Assigned user not found' })
        patch.assigned_to = assignedTo
        // Cascade ownership change to any open follow-up task on this lead
        await models.leadTasks.updateMany(
          { lead_id: id, status: { $ne: 'done' } },
          { $set: { assigned_to: assignedTo, updated_at: new Date().toISOString() } },
        )
      }
      await models.leads.updateById(id, { $set: patch })
      return res.json({ message: 'Lead updated' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // Close a lead and convert it into a client. Required body fields cover
  // everything on the client model that isn't already on the lead, plus a
  // password. Sends a credentials email so the client can sign in.
  router.post('/:id/close', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
      const id = String(req.params.id)
      const lead = await models.leads.findById(id) as any
      if (!lead) return res.status(404).json({ error: 'Lead not found' })
      if (lead.client_id) {
        return res.status(409).json({ error: 'A client has already been created for this lead' })
      }

      const body = req.body || {}
      const email = validateEmail(body.email || lead.email, 'Client email')
      const password = validateNewPassword(body.password, 'Password')
      const company_name = validateLength(String(body.company_name || '').trim(), 2, 120, 'Company name')
      const contact_name = validateLength(String(body.contact_name || lead.name || '').trim(), 2, 100, 'Contact name')
      const phoneRaw = String(body.phone || lead.phone || '').trim()
      const phone = phoneRaw ? phoneRaw.slice(0, 30) : null
      const website = body.website ? String(body.website).trim().slice(0, 200) : null
      const industry = body.industry ? String(body.industry).trim().slice(0, 80) : null
      const gstin = body.gstin ? String(body.gstin).trim().toUpperCase().slice(0, 20) : null
      const address_line = body.address_line ? String(body.address_line).trim().slice(0, 300) : null
      const city = body.city ? String(body.city).trim().slice(0, 80) : null
      const state = body.state ? String(body.state).trim().slice(0, 80) : null
      const state_code = body.state_code ? String(body.state_code).trim().toUpperCase().slice(0, 8) : null
      const pincode = body.pincode ? String(body.pincode).trim().slice(0, 16) : null
      const country = body.country ? String(body.country).trim().slice(0, 80) : null
      const avatar_color = typeof body.avatar_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.avatar_color.trim())
        ? body.avatar_color.trim()
        : '#6366f1'

      const [existingClient, existingUser] = await Promise.all([
        models.clients.findByEmail(email),
        models.users.findByEmail(email),
      ])
      if (existingClient || existingUser) {
        return res.status(409).json({ error: 'Email already registered as a client or user' })
      }

      const password_hash = await hashPasswordSha256(password, passwordSalt)
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

      const now = new Date().toISOString()
      await models.leads.updateById(id, {
        $set: {
          status: 'closed',
          client_id: created.id,
          closed_at: now,
          closed_by: (req.user as any)?.sub || null,
          updated_at: now,
        },
      })
      // Mark any open follow-up tasks as done so the lead stops nagging.
      await models.leadTasks.updateMany(
        { lead_id: id, status: { $nin: ['done', 'skipped', 'cancelled'] } },
        { $set: { status: 'done', updated_at: now } },
      )

      const rawLoginUrl = String(
        runtimeEnv.CLIENT_LOGIN_URL ||
        runtimeEnv.LOGIN_URL ||
        runtimeEnv.APP_URL ||
        runtimeEnv.PUBLIC_BASE_URL ||
        '',
      ).trim()
      const finalLoginUrl = rawLoginUrl
        ? rawLoginUrl.replace(/\/+$/, '') + '/'
        : '(your portal URL)'
      const mail = buildClientWelcomeEmail({
        contactName: contact_name,
        companyName: company_name,
        email,
        password,
        loginUrl: finalLoginUrl,
      })

      let mailResult: any = { sent: false, error: null }
      try {
        const smtpHost = runtimeEnv.SMTP_HOST || (runtimeEnv.SMTP_USER || runtimeEnv.SENDER_EMAIL ? 'smtp.gmail.com' : '')
        const smtpUser = runtimeEnv.SMTP_USER || runtimeEnv.SENDER_EMAIL || ''
        const smtpPass = String(runtimeEnv.SMTP_PASS || runtimeEnv.APP_PASSWORD || '').replace(/\s+/g, '')
        if (!smtpHost || !smtpUser || !smtpPass) {
          throw new Error(`SMTP not configured (host=${smtpHost ? 'set' : 'missing'}, user=${smtpUser ? 'set' : 'missing'}, pass=${smtpPass ? 'set' : 'missing'})`)
        }
        const sent = await sendSmtpEmail(runtimeEnv, {
          to: email,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
        })
        mailResult = { sent: true, ...sent }
      } catch (err: any) {
        // Don't fail the conversion if email fails — admin can resend manually.
        const message = err?.message || String(err) || 'Failed to send email'
        console.error('[leads] Failed to email client credentials:', message, err)
        mailResult = { sent: false, error: message }
      }

      return res.status(201).json({
        data: { lead_id: id, client_id: created.id },
        client: created,
        mail: mailResult,
        message: mailResult.sent
          ? 'Lead closed and client created — credentials emailed'
          : `Lead closed and client created — email failed: ${mailResult.error}`,
      })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.delete('/:id', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
      const id = String(req.params.id)
      await models.leadTasks.deleteMany({ lead_id: id })
      await models.leads.deleteById(id)
      return res.json({ message: 'Lead deleted' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to delete lead' })
    }
  })

  router.patch('/tasks/:taskId', async (req, res) => {
    try {
      const user = req.user as any
      const role = String(user?.role || '').toLowerCase()
      const taskId = String(req.params.taskId)
      const task = await models.leadTasks.findById(taskId) as any
      if (!task) return res.status(404).json({ error: 'Task not found' })
      const isOwner = String(task.assigned_to) === String(user?.sub)
      const isManager = role === 'admin' || role === 'pm' || role === 'pc'
      if (!isOwner && !isManager) {
        return res.status(403).json({ error: 'Not allowed to update this task' })
      }
      const body = req.body || {}
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if ('status' in body) patch.status = String(body.status || 'pending').trim().toLowerCase()
      if ('notes' in body) patch.notes = String(body.notes || '').trim().slice(0, 2000)
      if ('due_date' in body) patch.due_date = body.due_date ? new Date(body.due_date).toISOString() : null
      await models.leadTasks.updateById(taskId, { $set: patch })
      return res.json({ message: 'Task updated' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  return router
}
