import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, requireRole, requireAnyPermission, userHasAnyPermission } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'
import {
  validateLength,
  validateEmail,
  validateNewPassword,
  respondWithError,
} from '../validators'
import { sendSmtpEmail, type SmtpAttachment, type SmtpEnv } from '../utils/smtp'
import { LEADS_GLOBAL_ROLES, ROLES } from '../constants'
import { createUserNotification, createUserNotifications } from './notifications'
import { mergeCustomValues } from './entity-columns'

const DEFAULT_FOLLOWUP_SNOOZE_MINUTES = 10
const MAX_LEAD_MAIL_ATTACHMENT_BYTES = 10 * 1024 * 1024 // 10 MB per attachment

function lower(value: any): string {
  return String(value || '').toLowerCase().trim()
}

// Build the Mongo filter that limits a lead query to the records this user
// is allowed to see. Returns null if the role has unrestricted access.
async function buildLeadVisibilityFilter(
  models: MongoModels,
  user: any,
): Promise<Record<string, unknown> | null> {
  const role = lower(user?.role)
  const userId = String(user?.sub || user?.id || '')
  if (LEADS_GLOBAL_ROLES.includes(role as any)) return null
  if (role === ROLES.SALES_MANAGER) {
    // Manager sees every lead assigned to themselves, their TLs, or the agents
    // under those TLs. We resolve this through the user table since it caches
    // tl_id/manager_id pointers.
    const subordinates = await models.users.find({
      $or: [
        { manager_id: userId },
        { id: userId },
      ],
    }) as any[]
    const ids = subordinates.map((u) => String(u.id))
    if (!ids.includes(userId)) ids.push(userId)
    return { assigned_to: { $in: ids } }
  }
  if (role === ROLES.SALES_TL) {
    // TL sees own leads and those of agents under them.
    const agents = await models.users.find({ tl_id: userId }) as any[]
    const ids = agents.map((u) => String(u.id))
    if (!ids.includes(userId)) ids.push(userId)
    return { assigned_to: { $in: ids } }
  }
  // Default (sales_agent, developer, team, anyone else): only own leads.
  return { assigned_to: userId }
}

export async function canUserAccessLead(models: MongoModels, user: any, lead: any): Promise<boolean> {
  if (!lead) return false
  // Soft-deleted leads are off-limits to normal endpoints. The Trash module
  // has its own dedicated routes (/trash/list, /:id/restore, /:id/permanent)
  // that fetch deleted leads directly with their own permission gates, so
  // they don't go through this check.
  if (lead.deleted_at) return false
  const filter = await buildLeadVisibilityFilter(models, user)
  if (!filter) return true
  // Re-evaluate the filter against this lead in memory so we don't have to
  // round-trip a second query.
  const set = (filter as any).assigned_to?.$in
  if (Array.isArray(set)) return set.includes(String(lead.assigned_to))
  if ((filter as any).assigned_to) return String(lead.assigned_to) === String((filter as any).assigned_to)
  return false
}

// Render an ISO timestamp as "DD MMM YYYY, HH:mm" in UTC so the timeline
// summary line reads naturally instead of "2026-05-29T10:32:00.000Z".
// UTC keeps server log output stable regardless of host timezone.
function formatHumanDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

async function logLeadActivity(
  models: MongoModels,
  leadId: string,
  user: any,
  kind: string,
  summary: string,
  meta: Record<string, unknown> = {},
  // Optional explicit timestamp — the import flow uses this to stagger
  // entries by a few ms each so the timeline renders in a stable, logical
  // order instead of an arbitrary insertion order for same-millisecond writes.
  createdAt?: string,
) {
  const now = createdAt || new Date().toISOString()
  await models.leadActivities.insertOne({
    id: generateId('lact'),
    lead_id: leadId,
    kind,
    summary,
    meta,
    actor_id: user?.sub || user?.id || null,
    actor_name: user?.name || user?.full_name || null,
    actor_role: lower(user?.role) || null,
    created_at: now,
  })
}

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
            <tr><td style="padding:10px 14px;background:#f9fafb;font-size:12px;color:#7E7E8F;border-bottom:1px solid #e5e7eb;width:120px">Login URL</td><td style="padding:10px 14px;font-size:13px;border-bottom:1px solid #e5e7eb"><a href="${escapeEmailHtml(loginUrl)}" style="color:#A970FF">${escapeEmailHtml(loginUrl)}</a></td></tr>
            <tr><td style="padding:10px 14px;background:#f9fafb;font-size:12px;color:#7E7E8F;border-bottom:1px solid #e5e7eb">Email</td><td style="padding:10px 14px;font-size:13px;border-bottom:1px solid #e5e7eb"><strong>${escapeEmailHtml(email)}</strong></td></tr>
            <tr><td style="padding:10px 14px;background:#f9fafb;font-size:12px;color:#7E7E8F">Password</td><td style="padding:10px 14px;font-size:13px"><code style="background:#f3f4f6;padding:2px 6px;border-radius:4px">${escapeEmailHtml(password)}</code></td></tr>
          </table>
          <p style="margin:0;font-size:12px;color:#7E7E8F">For security, please change your password after the first login.</p>
        </div>
        <div style="padding:14px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#7E7E8F">— Mariox Software Pvt Ltd</div>
      </div>
    </div>`

  return { subject, html, text }
}

const ALLOWED_BADGES = new Set([
  'todo', 'inprogress', 'review', 'done', 'critical', 'medium',
])

// Optional per-status custom colour. Stored as a #RRGGBB hex string and used
// to tint the status badge on the list view. Returns null when absent (the UI
// then falls back to the badge class colour) and throws on a malformed value.
function sanitizeStatusColor(input: any): string | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  const m = raw.match(/^#?([0-9a-fA-F]{6})$/)
  if (!m) throw new Error('Invalid colour — use a hex value like #A970FF')
  return '#' + m[1].toLowerCase()
}

// Whitelist of activity classifications surfaced in the Schedule / Edit
// follow-up modals AND on the list view chip. Anything outside this set is
// rejected so the chip can't end up showing garbage from a bad import.
const ACTIVITY_TYPES = ['Call', 'Email', 'Meeting', 'Other'] as const
function normalizeActivityType(input: any): string | null {
  const raw = String(input || '').trim()
  if (!raw) return null
  const matched = ACTIVITY_TYPES.find((t) => t.toLowerCase() === raw.toLowerCase())
  return matched || null
}

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
  const [tasks, allNotes, allActivities] = await Promise.all([
    models.leadTasks.find({ lead_id: { $in: leadIds } }) as Promise<any[]>,
    // History notes (POST /:id/notes collection) — used for "latest note" preview.
    models.leadNotes.find({ lead_id: { $in: leadIds } }) as Promise<any[]>,
    // Activity log — used both for "latest_note from inline notes save" fallback
    // and the activity-kinds filter on the list view.
    models.leadActivities.find({ lead_id: { $in: leadIds } }) as Promise<any[]>,
  ])
  const tasksByLead = new Map<string, any[]>()
  for (const t of tasks) {
    const list = tasksByLead.get(String(t.lead_id)) || []
    list.push(t)
    tasksByLead.set(String(t.lead_id), list)
  }
  // Latest note per lead (by created_at desc) — used to surface a one-line
  // preview in the leads list view.
  const latestNoteByLead = new Map<string, any>()
  for (const n of allNotes) {
    const key = String(n.lead_id)
    const cur = latestNoteByLead.get(key)
    if (!cur || String(n.created_at || '') > String(cur.created_at || '')) {
      latestNoteByLead.set(key, n)
    }
  }
  // Distinct activity kinds per lead (e.g. ['note_added','portfolio_sent']).
  const activityKindsByLead = new Map<string, Set<string>>()
  for (const a of allActivities) {
    const key = String(a.lead_id)
    if (!activityKindsByLead.has(key)) activityKindsByLead.set(key, new Set())
    activityKindsByLead.get(key)!.add(String(a.kind || ''))
  }
  return leads.map((l) => {
    const assignee = usersById.get(String(l.assigned_to)) as any
    const creator = usersById.get(String(l.created_by)) as any
    const latestNote = latestNoteByLead.get(String(l.id)) || null
    const kinds = Array.from(activityKindsByLead.get(String(l.id)) || []).filter(Boolean)
    return {
      ...l,
      assigned_to_name: assignee?.full_name || null,
      assigned_to_email: assignee?.email || null,
      assigned_to_avatar: assignee?.avatar_color || null,
      created_by_name: creator?.full_name || null,
      tasks: (tasksByLead.get(String(l.id)) || []).sort(
        (a, b) => String(a.due_date || '').localeCompare(String(b.due_date || ''))
      ),
      latest_note: latestNote ? {
        text: String(latestNote.text || ''),
        author_name: latestNote.author_name || null,
        created_at: latestNote.created_at || null,
      } : null,
      activity_kinds: kinds,
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

  // Permission gate shared by every status / source mutation. admin/pm/pc
  // keep working as legacy defaults; anyone else needs the explicit grant.
  async function gateLeadStatusManage(req: any, res: any): Promise<boolean> {
    const role = lower((req.user as any)?.role)
    if (role === 'admin' || ['pm', 'pc'].includes(role)) return true
    if (await userHasAnyPermission(models, req.user, 'leads.manage_statuses')) return true
    res.status(403).json({ error: 'Not allowed to manage lead statuses' })
    return false
  }
  async function gateLeadSourceManage(req: any, res: any): Promise<boolean> {
    const role = lower((req.user as any)?.role)
    if (role === 'admin' || ['pm', 'pc'].includes(role)) return true
    if (await userHasAnyPermission(models, req.user, 'leads.manage_sources')) return true
    res.status(403).json({ error: 'Not allowed to manage lead sources' })
    return false
  }

  router.post('/statuses/:kind', async (req, res) => {
    try {
      if (!(await gateLeadStatusManage(req, res))) return
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
      const color = sanitizeStatusColor(body.color)
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
        color,
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

  router.delete('/statuses/:kind/:id', async (req, res) => {
    try {
      if (!(await gateLeadStatusManage(req, res))) return
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

  // Edit a status — label + badge (colour). The `key` is immutable so records
  // already using this status don't get orphaned. Works for system statuses
  // too (only their display label/colour changes, never the key).
  router.put('/statuses/:kind/:id', async (req, res) => {
    try {
      if (!(await gateLeadStatusManage(req, res))) return
      const repo = statusRepo(String(req.params.kind))
      if (!repo) return res.status(400).json({ error: 'Invalid status kind' })
      const id = String(req.params.id)
      const status = await repo.findById(id) as any
      if (!status) return res.status(404).json({ error: 'Status not found' })
      const body = req.body || {}
      const patch: any = { updated_at: new Date().toISOString() }
      if ('label' in body) patch.label = validateLength(String(body.label || '').trim(), 2, 40, 'Label')
      if ('badge' in body) {
        const badge = String(body.badge || '').toLowerCase()
        if (!ALLOWED_BADGES.has(badge)) {
          return res.status(400).json({ error: 'Invalid badge — use one of: ' + [...ALLOWED_BADGES].join(', ') })
        }
        patch.badge = badge
      }
      if ('color' in body) patch.color = sanitizeStatusColor(body.color)
      await repo.updateById(id, { $set: patch })
      const updated = await repo.findById(id)
      return res.json({ data: updated, status: updated, message: 'Status updated' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── Lead source configuration ──────────────────────────────
  // Mirror of /statuses, but the catalog feeds the "Source" dropdown on the
  // lead create/edit form. Defaults are seeded on boot; admin/pm/pc can add
  // or remove custom sources. System sources cannot be deleted.
  router.get('/sources', async (_req, res) => {
    try {
      const sources = await models.leadSources.find({}) as any[]
      sources.sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
      return res.json({ data: sources, sources })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load sources' })
    }
  })

  router.post('/sources', async (req, res) => {
    try {
      if (!(await gateLeadSourceManage(req, res))) return
      const body = req.body || {}
      const label = validateLength(String(body.label || '').trim(), 2, 40, 'Label')
      const key = sanitizeStatusKey(body.key || body.label)
      if (!key) return res.status(400).json({ error: 'Source key is required' })
      const existing = await models.leadSources.findOne({ key }) as any
      if (existing) return res.status(409).json({ error: 'A source with this key already exists' })
      const all = await models.leadSources.find({}) as any[]
      const position = all.reduce((max, s) => Math.max(max, Number(s.position || 0)), -1) + 1
      const now = new Date().toISOString()
      const doc = {
        id: generateId('lsource'),
        key,
        label,
        position,
        is_system: 0,
        created_at: now,
        updated_at: now,
      }
      await models.leadSources.insertOne(doc)
      return res.status(201).json({ data: doc, source: doc })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.delete('/sources/:id', async (req, res) => {
    try {
      if (!(await gateLeadSourceManage(req, res))) return
      const id = String(req.params.id)
      const source = await models.leadSources.findById(id) as any
      if (!source) return res.status(404).json({ error: 'Source not found' })
      if (source.is_system) return res.status(400).json({ error: 'System sources cannot be deleted' })
      // Match by either the canonical key or the human label since older leads
      // were created when sources were free-text strings.
      const inUse = await models.leads.countDocuments({
        $or: [{ source: source.key }, { source: source.label }],
      })
      if (inUse > 0) {
        return res.status(400).json({
          error: `Source is in use by ${inUse} lead${inUse === 1 ? '' : 's'}. Reassign them first.`,
        })
      }
      await models.leadSources.deleteById(id)
      return res.json({ message: 'Source deleted' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to delete source' })
    }
  })

  // Edit a source label. Key stays immutable so existing leads keep matching.
  router.put('/sources/:id', async (req, res) => {
    try {
      if (!(await gateLeadSourceManage(req, res))) return
      const id = String(req.params.id)
      const source = await models.leadSources.findById(id) as any
      if (!source) return res.status(404).json({ error: 'Source not found' })
      if (source.is_system) return res.status(400).json({ error: 'System sources cannot be edited' })
      const body = req.body || {}
      const patch: any = { updated_at: new Date().toISOString() }
      if ('label' in body) patch.label = validateLength(String(body.label || '').trim(), 2, 40, 'Label')
      await models.leadSources.updateById(id, { $set: patch })
      const updated = await models.leadSources.findById(id)
      return res.json({ data: updated, source: updated, message: 'Source updated' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.get('/', async (req, res) => {
    try {
      const user = req.user as any
      const filter: Record<string, any> = { ...((await buildLeadVisibilityFilter(models, user)) || {}), deleted_at: null }
      // Server-side text search. Replaces the old client-side row-text filter so
      // the full list no longer has to ship to the browser to be searchable.
      // The match is ANDed with the visibility filter, so results stay scoped
      // to leads the user is already allowed to see.
      const q = String(req.query.q || '').trim()
      if (q) {
        const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
        const or: any[] = [
          { name: rx }, { email: rx }, { phone: rx },
          { requirement: rx }, { source: rx }, { status: rx }, { notes: rx },
        ]
        // The list shows the assignee name, so let users search by it too —
        // resolve matching users to ids and OR them into the lead query.
        try {
          const matchedUsers = await models.users.find({ full_name: rx }) as any[]
          const ids = matchedUsers.map((u) => String(u.id)).filter(Boolean)
          if (ids.length) or.push({ assigned_to: { $in: ids } })
        } catch { /* best-effort assignee match */ }
        filter.$and = [{ $or: or }]
      }
      const leads = await models.leads.find(filter) as any[]
      leads.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      const enriched = await enrichLeads(models, leads)
      return res.json({ data: enriched, leads: enriched })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load leads' })
    }
  })

  // ── Tasks list (cross-lead) ─────────────────────────────────
  // Powers the "Follow-ups" and "Tasks" sidebar pages. MUST be registered
  // before GET /:id — otherwise Express matches `tasks-list` as a lead id
  // and the page renders "Lead not found".
  router.get('/tasks-list', async (req, res) => {
    try {
      const user = req.user as any
      const kind = String(req.query.kind || '').toLowerCase()
      const visFilter = { ...((await buildLeadVisibilityFilter(models, user)) || {}), deleted_at: null }
      const leads = await models.leads.find(visFilter) as any[]
      if (!leads.length) return res.json({ data: [], tasks: [] })
      const leadById = new Map(leads.map((l) => [String(l.id), l]))
      const tasks = await models.leadTasks.find({ lead_id: { $in: leads.map((l) => l.id) } }) as any[]
      const filtered = tasks.filter((t) => {
        const k = String(t.kind || 'followup').toLowerCase()
        if (!kind) return true
        return k === kind
      })
      const assigneeIds = [...new Set(filtered.map((t) => String(t.assigned_to)).filter(Boolean))]
      const users = assigneeIds.length
        ? await models.users.find({ id: { $in: assigneeIds } }) as any[]
        : []
      const userById = new Map(users.map((u) => [String(u.id), u]))
      const enriched = filtered.map((t) => {
        const lead = leadById.get(String(t.lead_id))
        const assignee = userById.get(String(t.assigned_to))
        return {
          ...t,
          kind: t.kind || 'followup',
          lead_name: lead?.name || '',
          lead_email: lead?.email || '',
          lead_phone: lead?.phone || '',
          lead_status: lead?.status || '',
          assignee_name: assignee?.full_name || '',
        }
      })
      enriched.sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')))
      return res.json({ data: enriched, tasks: enriched })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load tasks' })
    }
  })

  router.get('/:id', async (req, res) => {
    try {
      const user = req.user as any
      const lead = await models.leads.findById(String(req.params.id)) as any
      if (!lead) return res.status(404).json({ error: 'Lead not found' })
      if (!(await canUserAccessLead(models, user, lead))) {
        return res.status(403).json({ error: 'Not allowed to view this lead' })
      }
      const [enriched] = await enrichLeads(models, [lead])
      return res.json({ data: enriched, lead: enriched })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load lead' })
    }
  })

  router.post('/', async (req, res) => {
    try {
      const user = req.user as any
      const role = String(user?.role || '').toLowerCase()
      // Built-in lead-managers + anyone admin granted `leads.create` to.
      const allowed = ['admin', 'pm', 'pc', 'sales_manager', 'sales_tl'].includes(role)
        || await userHasAnyPermission(models, user, 'leads.create')
      if (!allowed) return res.status(403).json({ error: 'Forbidden' })
      const body = req.body || {}
      const name = validateLength(String(body.name || '').trim(), 2, 120, 'Name')
      // Email is optional at lead creation — only validate the format when one
      // is actually provided; otherwise store an empty string.
      const email = body.email ? validateEmail(body.email, 'Email') : ''
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
      // Users without leads.assign_to_others can only create leads owned by
      // themselves — the body.assigned_to value is ignored. Admins always have
      // full assignment power. This replaces the older hardcoded role check
      // that locked sales_agent to self-assignment.
      const selfId = String(user?.sub || user?.id || '')
      const canAssignOthers = role === 'admin'
        || await userHasAnyPermission(models, user, 'leads.assign_to_others')
      const assignedTo = canAssignOthers
        ? String(body.assigned_to || '').trim()
        : selfId
      if (!assignedTo) {
        return res.status(400).json({ error: 'Assignee is required' })
      }
      const assignee = await models.users.findById(assignedTo) as any
      if (!assignee) {
        return res.status(400).json({ error: 'Assigned user not found' })
      }

      // Initial status — optional in the create form, defaults to "new". The
      // "closed" status is reserved for the Close & Convert flow (which needs
      // client + project details), so we refuse it here.
      let initialStatus = 'new'
      if (body.status) {
        const requested = String(body.status).trim().toLowerCase()
        if (requested === 'closed') {
          return res.status(400).json({ error: 'Use the Close & Convert flow to create a closed lead' })
        }
        if (requested) initialStatus = requested.slice(0, 60)
      }

      const now = new Date()
      const nowIso = now.toISOString()
      const leadId = generateId('lead')
      await models.leads.insertOne({
        id: leadId,
        name,
        email,
        phone,
        requirement,
        requirement_file: requirementFile && requirementFile.url ? requirementFile : null,
        source,
        status: initialStatus,
        assigned_to: assignedTo,
        created_by: user?.sub || null,
        created_at: nowIso,
        updated_at: nowIso,
      })

      await logLeadActivity(models, leadId, user, 'lead_created', `Lead created and assigned to ${assignee.full_name}`, {
        assigned_to: assignedTo,
      })

      // Ping the assignee — surfaces in their bell icon and plays the
      // notification sound on the frontend (lead_assigned → 'other' category).
      if (String(assignedTo) !== String(user?.sub || '')) {
        createUserNotification(models, {
          user_id: assignedTo,
          type: 'lead_assigned',
          title: `New lead assigned: ${name}`,
          body: requirement.slice(0, 200),
          link: `lead:${leadId}`,
          actor_id: user?.sub || null,
          actor_name: user?.name || user?.full_name || null,
          meta: { lead_id: leadId },
        }).catch(() => { /* best-effort */ })
      }

      return res.status(201).json({
        data: { id: leadId },
        message: 'Lead created',
      })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.put('/:id', async (req, res) => {
    try {
      const id = String(req.params.id)
      const body = req.body || {}
      const lead = await models.leads.findById(id) as any
      if (!lead) return res.status(404).json({ error: 'Lead not found' })
      // Permission-driven gating: `leads.edit` is the override key (edit ANY
      // lead in the system) and bypasses the visibility filter. `leads.edit_own`
      // is the scoped variant — user must also pass canUserAccessLead which
      // honours the manager/TL/agent hierarchy. Admins bypass via userHasAny.
      const canEditAny = await userHasAnyPermission(models, req.user, 'leads.edit')
      if (!canEditAny) {
        const canEditOwn = await userHasAnyPermission(models, req.user, 'leads.edit_own')
        if (!canEditOwn || !(await canUserAccessLead(models, req.user, lead))) {
          return res.status(403).json({ error: 'Not allowed to edit this lead' })
        }
      }
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if ('name' in body) patch.name = validateLength(String(body.name || '').trim(), 2, 120, 'Name')
      // Email stays optional on edit too — validate format only when provided so
      // a lead created without an email can still be saved.
      if ('email' in body) patch.email = body.email ? validateEmail(body.email, 'Email') : ''
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
      // When the inline `notes` field changes, also push the new text onto the
      // leadNotes history collection so the lead detail page's "Notes history"
      // shows every save (not just the latest overwrite). Empty/whitespace
      // changes are skipped — those happen when the user just refocuses the
      // textarea without typing anything new.
      let pushNoteHistoryText: string | null = null
      if ('notes' in body) {
        const next = String(body.notes || '').trim().slice(0, 5000)
        const prev = String(lead.notes || '').trim()
        patch.notes = next
        if (next && next !== prev) pushNoteHistoryText = next
      }
      let nextStatus: string | null = null
      if ('status' in body) {
        nextStatus = String(body.status || 'new').trim().toLowerCase()
        if (nextStatus === 'closed') {
          return res.status(400).json({
            error: 'Use "Close & Convert to Client" to mark a lead as closed — it requires client details.',
          })
        }
        patch.status = nextStatus
      }
      let reassignedToUser: any = null
      if ('assigned_to' in body) {
        const assignedTo = String(body.assigned_to || '').trim()
        if (!assignedTo) return res.status(400).json({ error: 'Assignee is required' })
        const assignee = await models.users.findById(assignedTo) as any
        if (!assignee) return res.status(400).json({ error: 'Assigned user not found' })
        patch.assigned_to = assignedTo
        if (String(lead.assigned_to) !== assignedTo) reassignedToUser = assignee
        // Cascade ownership change to any open follow-up task on this lead
        await models.leadTasks.updateMany(
          { lead_id: id, status: { $ne: 'done' } },
          { $set: { assigned_to: assignedTo, updated_at: new Date().toISOString() } },
        )
      }
      await models.leads.updateById(id, { $set: patch })

      const actor = req.user as any
      if (pushNoteHistoryText) {
        const noteId = generateId('lnote')
        const noteCreatedAt = new Date().toISOString()
        await models.leadNotes.insertOne({
          id: noteId,
          lead_id: id,
          text: pushNoteHistoryText,
          author_id: actor?.sub || actor?.id || null,
          author_name: actor?.name || actor?.full_name || null,
          author_role: lower(actor?.role) || null,
          created_at: noteCreatedAt,
        })
        await logLeadActivity(models, id, actor, 'note_added',
          `Note: ${pushNoteHistoryText.length > 120 ? pushNoteHistoryText.slice(0, 117) + '…' : pushNoteHistoryText}`,
          { note_id: noteId, source: 'inline_notes' })
      }
      if (nextStatus && nextStatus !== lower(lead.status)) {
        await logLeadActivity(models, id, actor, 'status_changed', `Status changed to ${nextStatus}`, {
          from: lead.status,
          to: nextStatus,
        })
      }
      if (reassignedToUser) {
        await logLeadActivity(models, id, actor, 'reassigned', `Reassigned to ${reassignedToUser.full_name}`, {
          from: lead.assigned_to,
          to: reassignedToUser.id,
        })
        if (String(reassignedToUser.id) !== String(actor?.sub || '')) {
          createUserNotification(models, {
            user_id: String(reassignedToUser.id),
            type: 'lead_assigned',
            title: `Lead reassigned to you: ${lead.name}`,
            body: String(lead.requirement || '').slice(0, 200),
            link: `lead:${id}`,
            actor_id: actor?.sub || null,
            actor_name: actor?.name || actor?.full_name || null,
            meta: { lead_id: id },
          }).catch(() => { /* best-effort */ })
        }
      }
      return res.json({ message: 'Lead updated' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── Admin-only revenue-credit handover ───────────────────────
  // Reassigns sales-report / incentive attribution for a lead (and every
  // project it produced) to another user without touching the actual
  // lead.assigned_to or any downstream ownership. Set credit_to=null to
  // clear the handover and revert credit to the original assignee.
  router.post('/:id/handover', requireRole('admin'), async (req, res) => {
    try {
      const id = String(req.params.id)
      const lead = await models.leads.findById(id) as any
      if (!lead) return res.status(404).json({ error: 'Lead not found' })
      const body = req.body || {}
      const rawCreditTo = body.credit_to === null || body.credit_to === ''
        ? null
        : String(body.credit_to || '').trim()
      let creditToUser: any = null
      if (rawCreditTo) {
        creditToUser = await models.users.findById(rawCreditTo) as any
        if (!creditToUser) return res.status(400).json({ error: 'Target user not found' })
      }
      await models.leads.updateById(id, {
        $set: {
          revenue_credit_to: rawCreditTo,
          revenue_credit_to_name: creditToUser?.full_name || null,
          revenue_credit_set_at: new Date().toISOString(),
          revenue_credit_set_by: (req.user as any)?.sub || null,
          updated_at: new Date().toISOString(),
        },
      })
      const summary = creditToUser
        ? `Revenue credit handed over to ${creditToUser.full_name}`
        : `Revenue credit handover cleared — credit returns to original assignee`
      await logLeadActivity(models, id, req.user, 'handover_credit', summary, {
        credit_to: rawCreditTo,
        credit_to_name: creditToUser?.full_name || null,
        previous_credit_to: lead.revenue_credit_to || null,
      })
      return res.json({
        message: summary,
        data: { revenue_credit_to: rawCreditTo, revenue_credit_to_name: creditToUser?.full_name || null },
      })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // Close a lead and convert it into a client. Required body fields cover
  // everything on the client model that isn't already on the lead, plus a
  // password. Sends a credentials email so the client can sign in.
  router.post('/:id/close', async (req, res) => {
    try {
      const user = req.user as any
      const id = String(req.params.id)
      const lead = await models.leads.findById(id) as any
      if (!lead) return res.status(404).json({ error: 'Lead not found' })
      // Anyone with visibility on this lead can close it — mirrors the
      // "if you see the lead, you can act on it" rule used elsewhere
      // (tasks, follow-ups, meetings). Backend stays strict so a
      // sales_agent can only close their own assigned leads.
      if (!(await canUserAccessLead(models, user, lead))) {
        return res.status(403).json({ error: 'Not allowed to close this lead' })
      }
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
      // Tax & address fields are mandatory when closing a lead — they get
      // baked into every invoice / quotation we later generate against this
      // client. State Code is intentionally skipped (auto-derived from the
      // State dropdown on the frontend, can be left blank server-side).
      const gstinRaw = String(body.gstin || '').trim().toUpperCase()
      if (!/^[0-9A-Z]{15}$/.test(gstinRaw)) {
        return res.status(400).json({ error: 'GSTIN must be 15 alphanumeric characters' })
      }
      const gstin = gstinRaw
      const address_line = validateLength(String(body.address_line || '').trim(), 3, 300, 'Address')
      const city = validateLength(String(body.city || '').trim(), 2, 80, 'City')
      const state = validateLength(String(body.state || '').trim(), 2, 80, 'State')
      const state_code = body.state_code ? String(body.state_code).trim().toUpperCase().slice(0, 8) : null
      const pincodeRaw = String(body.pincode || '').trim()
      if (!/^[0-9]{4,8}$/.test(pincodeRaw)) {
        return res.status(400).json({ error: 'PIN code must be numeric (4–8 digits)' })
      }
      const pincode = pincodeRaw
      const country = validateLength(String(body.country || '').trim(), 2, 80, 'Country')
      const avatar_color = typeof body.avatar_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.avatar_color.trim())
        ? body.avatar_color.trim()
        : '#9D6CFF'

      const [existingClient, existingUser] = await Promise.all([
        models.clients.findByEmail(email),
        models.users.findByEmail(email),
      ])
      if (existingClient || existingUser) {
        return res.status(409).json({ error: 'Email already registered as a client or user' })
      }

      // Closing a lead now creates ONLY a client — never a project. Sales
      // agents hand off to delivery, who spin up the project separately. We
      // hard-ignore any `body.project` an older client might still post so no
      // project is ever created from this endpoint. (The downstream code all
      // guards on `if (projectInput)`, so forcing null short-circuits it.)
      const projectInput = null as any
      let projectName: string | null = null
      let projectCode: string | null = null
      let projectStartDate: string | null = null
      let projectExpectedEnd: string | null = null
      let projectAmount: number | null = null
      let projectDescription: string | null = null
      let projectRemarks: string | null = null
      let projectPriority: string = 'medium'
      let projectType: string = 'development'
      let projectStatus: string = 'active'
      let projectDeliveryKind: string | null = null
      let projectBillable: number = 1
      let projectPmId: string | null = null
      let projectPcId: string | null = null
      let projectSoldBy: string | null = null
      let projectCommercialVisibleTo: string[] = []
      let projectAttachments: any[] = []
      if (projectInput) {
        projectName = validateLength(String(projectInput.name || '').trim(), 2, 120, 'Project name')
        projectCode = validateLength(String(projectInput.code || '').trim(), 2, 40, 'Project code')
        if (!/^[A-Za-z0-9_-]{2,40}$/.test(projectCode)) {
          return res.status(400).json({ error: 'Project code may only contain letters, numbers, underscore or hyphen' })
        }
        const dupe = await models.projects.findOne({ code: projectCode })
        if (dupe) {
          return res.status(409).json({ error: `Project code "${projectCode}" already exists` })
        }
        if (!projectInput.start_date) {
          return res.status(400).json({ error: 'Project start date is required' })
        }
        const sd = new Date(projectInput.start_date)
        if (Number.isNaN(sd.getTime())) return res.status(400).json({ error: 'Invalid project start date' })
        projectStartDate = sd.toISOString().slice(0, 10)
        if (projectInput.expected_end_date) {
          const ed = new Date(projectInput.expected_end_date)
          if (Number.isNaN(ed.getTime())) return res.status(400).json({ error: 'Invalid project end date' })
          projectExpectedEnd = ed.toISOString().slice(0, 10)
          if (projectExpectedEnd < projectStartDate) {
            return res.status(400).json({ error: 'Project end date must be after start date' })
          }
        }
        // Project Amount is mandatory when closing a lead with a project —
        // it drives the agent's sales-incentive achievement total. Refuse
        // missing/zero values at the API edge so a stale frontend can't
        // bypass the new requirement.
        if (projectInput.project_amount === undefined || projectInput.project_amount === null || projectInput.project_amount === '') {
          return res.status(400).json({ error: 'Project Amount is required' })
        }
        {
          const amt = Number(projectInput.project_amount)
          if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'Project Amount must be a positive number' })
          projectAmount = amt
        }
        if (projectInput.priority) {
          const p = String(projectInput.priority).toLowerCase()
          if (!['critical','high','medium','low'].includes(p)) return res.status(400).json({ error: 'Invalid project priority' })
          projectPriority = p
        }
        if (projectInput.project_type) {
          const t = String(projectInput.project_type).toLowerCase()
          if (!['development','maintenance','support','consulting'].includes(t)) return res.status(400).json({ error: 'Invalid project type' })
          projectType = t
        }
        if (projectInput.status) {
          const s = String(projectInput.status).toLowerCase()
          if (!['active','on_hold','completed','archived','cancelled'].includes(s)) return res.status(400).json({ error: 'Invalid project status' })
          projectStatus = s
        }
        if (projectInput.delivery_kind) {
          const dk = String(projectInput.delivery_kind).toLowerCase()
          if (!['app','web','both'].includes(dk)) return res.status(400).json({ error: 'Invalid delivery kind' })
          projectDeliveryKind = dk
        }
        if (projectInput.billable !== undefined) {
          projectBillable = projectInput.billable ? 1 : 0
        }
        // PM / PC are admin-only fields. If the closer is not an admin we
        // ignore whatever the request sent (stale frontends, scripted calls)
        // and queue an admin assignment notification after the lead closes.
        if (lower((req.user as any)?.role) === 'admin') {
          if (projectInput.pm_id) {
            const pm = await models.users.findById(String(projectInput.pm_id)) as any
            if (!pm) return res.status(400).json({ error: 'Selected PM not found' })
            projectPmId = String(pm.id)
          }
          if (projectInput.pc_id) {
            const pc = await models.users.findById(String(projectInput.pc_id)) as any
            if (!pc) return res.status(400).json({ error: 'Selected PC not found' })
            projectPcId = String(pc.id)
          }
        }
        if (projectInput.sold_by) {
          projectSoldBy = validateLength(String(projectInput.sold_by).trim(), 1, 200, 'Sold by')
        }
        if (projectInput.description) {
          projectDescription = validateLength(String(projectInput.description), 0, 5000, 'Project description')
        }
        if (projectInput.remarks) {
          projectRemarks = validateLength(String(projectInput.remarks), 0, 2000, 'Remarks')
        }
        if (Array.isArray(projectInput.commercial_visible_to)) {
          const allowed = new Set(['pm','pc','developer','team','client'])
          projectCommercialVisibleTo = projectInput.commercial_visible_to
            .map((r: any) => String(r).trim().toLowerCase())
            .filter((r: string) => allowed.has(r))
        }
        if (Array.isArray(projectInput.attachments)) {
          projectAttachments = projectInput.attachments
            .filter((a: any) => a && a.file_url)
            .slice(0, 20)
            .map((a: any) => ({
              file_name: String(a.file_name || 'file').slice(0, 255),
              file_url: String(a.file_url),
              file_type: a.file_type ? String(a.file_type).slice(0, 120) : null,
              file_size: Number(a.file_size) || 0,
            }))
        }
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
      let createdProject: any = null
      if (projectInput) {
        const projId = generateId('proj')
        const projectDoc: any = {
          id: projId,
          name: projectName,
          code: projectCode,
          client_id: created.id,
          client_name: company_name,
          description: projectDescription,
          project_type: projectType,
          delivery_kind: projectDeliveryKind,
          start_date: projectStartDate,
          expected_end_date: projectExpectedEnd,
          priority: projectPriority,
          status: projectStatus,
          total_allocated_hours: 0,
          estimated_budget_hours: 0,
          team_lead_id: null,
          pm_id: projectPmId,
          pc_id: projectPcId,
          assignment_type: 'in_house',
          external_team_id: null,
          external_assignee_type: null,
          billable: projectBillable,
          revenue: projectAmount ?? 0,
          sold_by: projectSoldBy || (req.user as any)?.name || (req.user as any)?.full_name || null,
          project_amount: projectAmount,
          commercial_visible_to: projectCommercialVisibleTo,
          remarks: projectRemarks || `Auto-created from lead "${lead.name}"`,
          consumed_hours: 0,
          source_lead_id: id,
          created_at: now,
          updated_at: now,
        }
        await models.projects.insertOne(projectDoc)
        createdProject = projectDoc

        // If the lead had a requirement file uploaded, register it as a
        // project document so it shows up in the Documents Center.
        if (lead.requirement_file?.url) {
          await models.documents.insertOne({
            id: generateId('doc'),
            project_id: projId,
            client_id: created.id,
            title: `${projectName} — ${String(lead.requirement_file.name || 'requirement').slice(0, 180)}`,
            description: 'Requirement attached on the originating lead',
            category: 'brd',
            file_name: String(lead.requirement_file.name || 'file').slice(0, 255),
            file_url: String(lead.requirement_file.url),
            file_size: Number(lead.requirement_file.size) || 0,
            file_type: lead.requirement_file.mime ? String(lead.requirement_file.mime).slice(0, 120) : null,
            version: '1.0',
            uploaded_by: (req.user as any)?.sub || null,
            uploaded_by_role: 'staff',
            created_at: now,
            updated_at: now,
          })
        }
        // User-supplied attachments from the close-lead modal — file uploads
        // and pasted links — get registered as project documents too.
        if (projectAttachments.length) {
          await models.documents.insertMany(projectAttachments.map((a) => ({
            id: generateId('doc'),
            project_id: projId,
            client_id: created.id,
            title: `${projectName} — ${String(a.file_name || 'attachment').slice(0, 180)}`,
            description: 'Attached on close-lead conversion',
            category: 'other',
            file_name: a.file_name,
            file_url: a.file_url,
            file_size: a.file_size,
            file_type: a.file_type,
            version: '1.0',
            uploaded_by: (req.user as any)?.sub || null,
            uploaded_by_role: 'staff',
            created_at: now,
            updated_at: now,
          })))
        }
      }

      await models.leads.updateById(id, {
        $set: {
          status: 'closed',
          client_id: created.id,
          project_id: createdProject?.id || null,
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
      await logLeadActivity(models, id, req.user, 'lead_closed',
        createdProject
          ? `Lead closed → client (${created.email}) + project "${createdProject.name}" (${createdProject.code}) created`
          : `Lead closed and converted to client (${created.email})`,
        { client_id: created.id, project_id: createdProject?.id || null, email: created.email })

      // If a non-admin closed the lead and produced a project without PM/PC,
      // notify every admin so someone takes ownership of the assignment.
      if (createdProject && (!createdProject.pm_id || !createdProject.pc_id) && lower((req.user as any)?.role) !== 'admin') {
        try {
          const admins = await models.users.find({ role: 'admin' }) as any[]
          const adminIds = admins
            .filter((u) => Number(u.is_active ?? 1) === 1)
            .map((u) => String(u.id))
          const actor = req.user as any
          const missing = [
            !createdProject.pm_id ? 'PM' : null,
            !createdProject.pc_id ? 'PC' : null,
          ].filter(Boolean).join(' & ')
          await createUserNotifications(models, adminIds, {
            type: 'project_assignment_needed',
            title: `Assign ${missing} for "${createdProject.name}"`,
            body: `${actor?.name || actor?.full_name || 'A user'} closed lead "${lead.name}" and created project ${createdProject.code}. Please assign ${missing}.`,
            link: `project:${createdProject.id}`,
            actor_id: actor?.sub || null,
            actor_name: actor?.name || actor?.full_name || null,
            meta: {
              project_id: createdProject.id,
              project_code: createdProject.code,
              lead_id: id,
              missing_pm: !createdProject.pm_id,
              missing_pc: !createdProject.pc_id,
            },
          })
        } catch (notifyErr) {
          console.warn('[leads/close] admin PM/PC notification failed:', notifyErr)
        }
      }

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

      const baseMsg = createdProject
        ? `Lead closed → client + project "${createdProject.name}" created`
        : 'Lead closed and client created'
      return res.status(201).json({
        data: { lead_id: id, client_id: created.id, project_id: createdProject?.id || null },
        client: created,
        project: createdProject,
        mail: mailResult,
        message: mailResult.sent
          ? `${baseMsg} — credentials emailed`
          : `${baseMsg} — email failed: ${mailResult.error}`,
      })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // Soft delete. Sets deleted_at + reason + actor on the lead so the Trash
  // module can surface "who killed this and why". Related rows (tasks, notes,
  // comments, activities) stay in their collections — every list read joins
  // through leads and the deleted_at filter naturally hides them. Restoring
  // unhides everything in one move; permanent purge hard-deletes everything.
  router.delete('/:id', async (req, res) => {
    try {
      const user = req.user as any
      const role = lower(user?.role)
      const allowed = role === 'admin'
        || ['pm', 'pc'].includes(role)
        || await userHasAnyPermission(models, user, 'leads.delete')
      if (!allowed) return res.status(403).json({ error: 'Not allowed to delete leads' })
      const id = String(req.params.id)
      const lead = await models.leads.findById(id) as any
      if (!lead) return res.status(404).json({ error: 'Lead not found' })
      if (lead.deleted_at) return res.status(409).json({ error: 'Lead is already in Trash' })

      const body = req.body || {}
      const reason = validateLength(String(body.reason || '').trim(), 3, 500, 'Reason')
      const now = new Date().toISOString()
      await models.leads.updateById(id, {
        $set: {
          deleted_at: now,
          deleted_by: user?.sub || null,
          deleted_by_name: user?.name || user?.full_name || null,
          deleted_reason: reason,
          updated_at: now,
        },
      })
      await logLeadActivity(models, id, user, 'lead_deleted',
        `Lead moved to Trash · Reason: ${reason.length > 200 ? reason.slice(0, 197) + '…' : reason}`,
        { reason })
      return res.json({ message: 'Lead moved to Trash', id })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // Trash listing. Permission-gated separately so admins can grant
  // visibility without granting delete/restore power.
  router.get('/trash/list', requireAnyPermission(models, 'leads.trash.view'), async (_req, res) => {
    try {
      const rows = (await models.leads.find({ deleted_at: { $ne: null } }) as any[])
        .filter((l) => !!l.deleted_at)
        .sort((a, b) => String(b.deleted_at || '').localeCompare(String(a.deleted_at || '')))
      return res.json({ data: rows, leads: rows, total: rows.length })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.post('/:id/restore', requireAnyPermission(models, 'leads.trash.restore'), async (req, res) => {
    try {
      const user = req.user as any
      const id = String(req.params.id)
      const lead = await models.leads.findById(id) as any
      if (!lead) return res.status(404).json({ error: 'Lead not found' })
      if (!lead.deleted_at) return res.status(409).json({ error: 'Lead is not in Trash' })
      const now = new Date().toISOString()
      await models.leads.updateById(id, {
        $set: {
          deleted_at: null,
          deleted_by: null,
          deleted_by_name: null,
          deleted_reason: null,
          updated_at: now,
        },
      })
      await logLeadActivity(models, id, user, 'lead_restored', 'Lead restored from Trash')
      return res.json({ message: 'Lead restored', id })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // Permanent purge — hard-deletes the lead AND its dependent rows
  // (tasks, notes, comments, activities). Irreversible.
  router.delete('/:id/permanent', requireAnyPermission(models, 'leads.trash.purge'), async (req, res) => {
    try {
      const id = String(req.params.id)
      const lead = await models.leads.findById(id) as any
      if (!lead) return res.status(404).json({ error: 'Lead not found' })
      if (!lead.deleted_at) {
        return res.status(409).json({ error: 'Only soft-deleted leads can be permanently purged. Move it to Trash first.' })
      }
      await Promise.all([
        models.leadTasks.deleteMany({ lead_id: id }),
        models.leadNotes.deleteMany({ lead_id: id }),
        models.leadComments.deleteMany({ lead_id: id }),
        models.leadActivities.deleteMany({ lead_id: id }),
      ])
      await models.leads.deleteById(id)
      return res.json({ message: 'Lead and all related data permanently deleted', id })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.patch('/tasks/:taskId', async (req, res) => {
    try {
      const user = req.user as any
      const role = lower(user?.role)
      const taskId = String(req.params.taskId)
      const task = await models.leadTasks.findById(taskId) as any
      if (!task) return res.status(404).json({ error: 'Task not found' })
      const isOwner = String(task.assigned_to) === String(user?.sub)
      const isManager = LEADS_GLOBAL_ROLES.includes(role as any)
      // Sales managers/TLs are allowed to update tasks for users they own
      // (lead visibility already covers that — reuse the helper).
      let canEdit = isOwner || isManager
      if (!canEdit) {
        const lead = await models.leads.findById(String(task.lead_id)) as any
        canEdit = await canUserAccessLead(models, user, lead)
      }
      if (!canEdit) {
        return res.status(403).json({ error: 'Not allowed to update this task' })
      }
      const body = req.body || {}
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if ('status' in body) patch.status = String(body.status || 'pending').trim().toLowerCase()
      if ('notes' in body) patch.notes = String(body.notes || '').trim().slice(0, 2000)
      if ('due_date' in body) patch.due_date = body.due_date ? new Date(body.due_date).toISOString() : null
      // Edit support for the row-level Edit modal: title / description /
      // priority. Same length caps as the create routes so the data stays
      // consistent across the two entry points.
      if ('title' in body) {
        const title = String(body.title || '').trim()
        if (title.length < 1 || title.length > 200) {
          return res.status(400).json({ error: 'Title must be 1-200 characters' })
        }
        patch.title = title
      }
      if ('description' in body) patch.description = String(body.description || '').trim().slice(0, 2000)
      if ('priority' in body) {
        const p = String(body.priority || '').trim().toLowerCase()
        if (p && !['low', 'medium', 'high', 'critical'].includes(p)) {
          return res.status(400).json({ error: 'Invalid priority' })
        }
        if (p) patch.priority = p
      }
      if ('snooze_minutes' in body) {
        const m = Math.max(0, Math.min(24 * 60, Math.round(Number(body.snooze_minutes) || 0)))
        patch.snooze_minutes = m
        // Re-arming the snooze should also clear any prior acknowledgement so
        // the alarm fires again at the new lead time.
        patch.acknowledged_at = null
        patch.acknowledged_by = null
      }
      // Activity type change (Call/Email/Meeting/Other) — lets users
      // reclassify a row when an import or quick-create tagged it wrong.
      // Matches the enum on the Schedule + Edit modals exactly so the chip
      // on the list view stays consistent with what users picked.
      if ('activity_type' in body) {
        const t = normalizeActivityType(body.activity_type)
        if (!t) return res.status(400).json({ error: 'Invalid activity type — must be Call, Email, Meeting, or Other' })
        patch.activity_type = t
      }
      // Custom-column values (see /api/lead-task-columns). Merged into the
      // existing map so a single-field edit never wipes the others.
      if ('custom_values' in body) {
        patch.custom_values = mergeCustomValues(task.custom_values, body.custom_values)
      }
      await models.leadTasks.updateById(taskId, { $set: patch })

      const summaryParts: string[] = []
      if (patch.status) summaryParts.push(`status → ${patch.status}`)
      if (patch.due_date !== undefined) {
        // Render the date in a readable "DD MMM YYYY, HH:mm" form instead of
        // the raw ISO timestamp — the timeline shows this string directly.
        const dueLabel = patch.due_date ? formatHumanDateTime(String(patch.due_date)) : 'cleared'
        summaryParts.push(`due → ${dueLabel}`)
      }
      if ('snooze_minutes' in patch) summaryParts.push(`snooze → ${patch.snooze_minutes}min`)
      if (summaryParts.length) {
        await logLeadActivity(models, String(task.lead_id), user, 'followup_updated',
          `Follow-up updated: ${summaryParts.join(', ')}`, { task_id: taskId, ...patch })
      }
      return res.json({ message: 'Task updated' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // Delete a lead task / follow-up. Same access rules as PATCH: owner,
  // manager, or anyone with visibility on the parent lead. We stamp the
  // lead activity timeline so the row's history isn't lost.
  router.delete('/tasks/:taskId', async (req, res) => {
    try {
      const user = req.user as any
      const role = lower(user?.role)
      const taskId = String(req.params.taskId)
      const task = await models.leadTasks.findById(taskId) as any
      if (!task) return res.status(404).json({ error: 'Task not found' })
      const isOwner = String(task.assigned_to) === String(user?.sub)
      const isManager = LEADS_GLOBAL_ROLES.includes(role as any)
      let canEdit = isOwner || isManager
      if (!canEdit) {
        const lead = await models.leads.findById(String(task.lead_id)) as any
        canEdit = await canUserAccessLead(models, user, lead)
      }
      if (!canEdit) {
        return res.status(403).json({ error: 'Not allowed to delete this task' })
      }
      await models.leadTasks.deleteById(taskId)
      const kind = String(task.kind || 'followup') === 'task' ? 'task_deleted' : 'followup_deleted'
      await logLeadActivity(models, String(task.lead_id), user, kind,
        `${kind === 'task_deleted' ? 'Task' : 'Follow-up'} "${task.title || taskId}" deleted`,
        { task_id: taskId })
      return res.json({ message: 'Task deleted' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── Followups: schedule + acknowledge alarms ────────────────
  // Lets agents add additional follow-ups beyond the auto-created one,
  // each with its own snooze interval.
  router.post('/:id/followups', async (req, res) => {
    try {
      const user = req.user as any
      const leadId = String(req.params.id)
      const lead = await models.leads.findById(leadId) as any
      if (!lead) return res.status(404).json({ error: 'Lead not found' })
      if (!(await canUserAccessLead(models, user, lead))) {
        return res.status(403).json({ error: 'Not allowed to add follow-ups for this lead' })
      }
      const body = req.body || {}
      const title = validateLength(String(body.title || `Follow up with ${lead.name}`).trim(), 1, 200, 'Title')
      if (!body.due_date) return res.status(400).json({ error: 'Due date is required' })
      const dueDate = new Date(body.due_date)
      if (Number.isNaN(dueDate.getTime())) return res.status(400).json({ error: 'Invalid due date' })
      const snoozeMinutes = Math.max(0, Math.min(24 * 60, Math.round(Number(body.snooze_minutes) || DEFAULT_FOLLOWUP_SNOOZE_MINUTES)))
      const notes = body.notes ? String(body.notes).trim().slice(0, 2000) : ''
      const assignedTo = String(body.assigned_to || lead.assigned_to || '').trim()
      const activityType = normalizeActivityType(body.activity_type) || 'Other'
      const now = new Date().toISOString()
      const taskId = generateId('ltask')
      await models.leadTasks.insertOne({
        id: taskId,
        lead_id: leadId,
        title,
        // User-facing activity classification (Call/Email/Meeting/Other). The
        // same enum is shown in the Schedule + Edit modals and on the list
        // view chip, so what users pick is what they see everywhere.
        activity_type: activityType,
        description: notes,
        notes,
        assigned_to: assignedTo,
        assigned_by: user?.sub || null,
        status: 'pending',
        due_date: dueDate.toISOString(),
        snooze_minutes: snoozeMinutes,
        acknowledged_at: null,
        acknowledged_by: null,
        custom_values: mergeCustomValues({}, body.custom_values),
        created_at: now,
        updated_at: now,
      })
      await logLeadActivity(models, leadId, user, 'followup_added',
        `Scheduled follow-up "${title}" for ${dueDate.toISOString()}`,
        { task_id: taskId, snooze_minutes: snoozeMinutes })
      return res.status(201).json({ data: { id: taskId }, message: 'Follow-up scheduled' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // The alarm modal calls this when the user dismisses it. We persist the
  // acknowledgement so the modal doesn't re-pop on the next poll, but we
  // intentionally leave the task open so the work item still shows in the
  // follow-up list until the agent completes it.
  router.post('/tasks/:taskId/acknowledge', async (req, res) => {
    try {
      const user = req.user as any
      const taskId = String(req.params.taskId)
      const task = await models.leadTasks.findById(taskId) as any
      if (!task) return res.status(404).json({ error: 'Task not found' })
      const lead = await models.leads.findById(String(task.lead_id)) as any
      if (!(await canUserAccessLead(models, user, lead))) {
        return res.status(403).json({ error: 'Not allowed to acknowledge this task' })
      }
      const now = new Date().toISOString()
      await models.leadTasks.updateById(taskId, {
        $set: {
          acknowledged_at: now,
          acknowledged_by: user?.sub || null,
          updated_at: now,
        },
      })
      await logLeadActivity(models, String(task.lead_id), user, 'followup_acknowledged',
        `Follow-up alarm acknowledged`, { task_id: taskId })
      return res.json({ message: 'Acknowledged' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // Returns the follow-ups whose alarm window has been entered
  // (due_date - snooze_minutes <= now) and which have not already been
  // acknowledged or completed.
  // ⚠ Only the user the task is *assigned to* receives the alarm — managers
  // and TLs can see their team's follow-ups in the lead detail timeline,
  // but the ringing modal is the assignee's responsibility alone.
  router.get('/followups/upcoming', async (req, res) => {
    try {
      const user = req.user as any
      const userId = String(user?.sub || user?.id || '')
      if (!userId) return res.json({ data: [], alarms: [] })
      const tasks = await models.leadTasks.find({
        assigned_to: userId,
        status: { $nin: ['done', 'skipped', 'cancelled'] },
        acknowledged_at: { $in: [null, undefined] },
      }) as any[]
      if (!tasks.length) return res.json({ data: [], alarms: [] })
      const leadIds = [...new Set(tasks.map((t) => String(t.lead_id)))]
      // Skip alarms whose lead has been soft-deleted — the follow-up rows
      // still exist but their parent is in Trash, so they shouldn't ring.
      const leads = await models.leads.find({ id: { $in: leadIds }, deleted_at: null }) as any[]
      const leadById = new Map(leads.map((l) => [String(l.id), l]))
      const now = Date.now()
      const due: any[] = []
      for (const t of tasks) {
        if (!t.due_date) continue
        const dueMs = new Date(t.due_date).getTime()
        if (Number.isNaN(dueMs)) continue
        const snoozeMin = Math.max(0, Number(t.snooze_minutes ?? DEFAULT_FOLLOWUP_SNOOZE_MINUTES))
        const alarmAt = dueMs - snoozeMin * 60 * 1000
        if (alarmAt <= now) {
          const lead = leadById.get(String(t.lead_id))
          // Skip tasks whose parent lead was filtered out (soft-deleted) —
          // ringing an alarm pointing at a Trash lead is just noise.
          if (!lead) continue
          due.push({
            id: t.id,
            lead_id: t.lead_id,
            lead_name: lead.name || '',
            lead_phone: lead.phone || '',
            lead_email: lead.email || '',
            title: t.title,
            due_date: t.due_date,
            snooze_minutes: snoozeMin,
            assigned_to: t.assigned_to,
            overdue: dueMs < now,
          })
        }
      }
      due.sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
      return res.json({ data: due, alarms: due })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load alarms' })
    }
  })

  // ── Comments ─────────────────────────────────────────────────
  router.get('/:id/comments', async (req, res) => {
    try {
      const user = req.user as any
      const leadId = String(req.params.id)
      const lead = await models.leads.findById(leadId) as any
      if (!lead) return res.status(404).json({ error: 'Lead not found' })
      if (!(await canUserAccessLead(models, user, lead))) {
        return res.status(403).json({ error: 'Not allowed' })
      }
      const comments = await models.leadComments.find({ lead_id: leadId }) as any[]
      comments.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
      return res.json({ data: comments, comments })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load comments' })
    }
  })

  router.post('/:id/comments', async (req, res) => {
    try {
      const user = req.user as any
      const leadId = String(req.params.id)
      const lead = await models.leads.findById(leadId) as any
      if (!lead) return res.status(404).json({ error: 'Lead not found' })
      if (!(await canUserAccessLead(models, user, lead))) {
        return res.status(403).json({ error: 'Not allowed to comment on this lead' })
      }
      const body = req.body || {}
      const text = validateLength(String(body.text || '').trim(), 1, 4000, 'Comment')
      const now = new Date().toISOString()
      const id = generateId('lcom')
      await models.leadComments.insertOne({
        id,
        lead_id: leadId,
        text,
        author_id: user?.sub || null,
        author_name: user?.name || user?.full_name || null,
        author_role: lower(user?.role) || null,
        created_at: now,
      })
      await logLeadActivity(models, leadId, user, 'comment_added',
        `Comment: ${text.length > 120 ? text.slice(0, 117) + '…' : text}`,
        { comment_id: id })
      return res.status(201).json({ data: { id }, message: 'Comment added' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── Timeline (combined activity + comments view) ────────────
  router.get('/:id/timeline', async (req, res) => {
    try {
      const user = req.user as any
      const leadId = String(req.params.id)
      const lead = await models.leads.findById(leadId) as any
      if (!lead) return res.status(404).json({ error: 'Lead not found' })
      if (!(await canUserAccessLead(models, user, lead))) {
        return res.status(403).json({ error: 'Not allowed' })
      }
      const activities = await models.leadActivities.find({ lead_id: leadId }) as any[]
      activities.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      // Enrich actor names from the user table for older entries that may
      // have stored just an id.
      const missingIds = activities
        .filter((a) => !a.actor_name && a.actor_id)
        .map((a) => String(a.actor_id))
      if (missingIds.length) {
        const users = await models.users.find({ id: { $in: [...new Set(missingIds)] } }) as any[]
        const map = new Map(users.map((u) => [String(u.id), u.full_name]))
        for (const a of activities) {
          if (!a.actor_name && a.actor_id) a.actor_name = map.get(String(a.actor_id)) || null
        }
      }
      return res.json({ data: activities, timeline: activities })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load timeline' })
    }
  })

  // ── Send Portfolio / Send Mail ──────────────────────────────
  // Both flows share the same SMTP send + activity log scaffolding; the
  // only real difference is the default subject/body that "Send Portfolio"
  // pre-populates on the frontend.
  async function sendLeadMail(req: any, res: any, kind: 'portfolio' | 'mail') {
    const user = req.user as any
    const leadId = String(req.params.id)
    const lead = await models.leads.findById(leadId) as any
    if (!lead) return res.status(404).json({ error: 'Lead not found' })
    if (!(await canUserAccessLead(models, user, lead))) {
      return res.status(403).json({ error: 'Not allowed to send mail for this lead' })
    }
    const body = req.body || {}
    const subject = validateLength(String(body.subject || '').trim(), 1, 300, 'Subject')
    const html = String(body.html || body.body || '').trim()
    const text = String(body.text || body.body_plain || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    if (!html && !text) return res.status(400).json({ error: 'Message body is required' })
    const to = String(body.to || lead.email || '').trim()
    if (!to) return res.status(400).json({ error: 'Recipient email is required' })
    const cc = Array.isArray(body.cc) ? body.cc.filter(Boolean) : []

    const rawAttachments = Array.isArray(body.attachments) ? body.attachments : []
    const attachments: SmtpAttachment[] = []
    for (const att of rawAttachments) {
      if (!att) continue
      // The frontend POSTs base64 strings directly; we cap each one to keep
      // SMTP from choking on multi-MB Gmail uploads.
      const filename = String(att.filename || att.name || 'attachment').slice(0, 200)
      const contentType = String(att.contentType || att.mime || att.mime_type || 'application/octet-stream')
      let bytesLength = 0
      let contentValue: string | Uint8Array
      if (typeof att.content === 'string') {
        const cleaned = att.content.replace(/\r?\n/g, '')
        bytesLength = Math.floor((cleaned.length * 3) / 4)
        contentValue = cleaned
      } else if (att.content && typeof att.content === 'object' && Array.isArray(att.content)) {
        const u8 = new Uint8Array(att.content)
        bytesLength = u8.byteLength
        contentValue = u8
      } else {
        continue
      }
      if (bytesLength > MAX_LEAD_MAIL_ATTACHMENT_BYTES) {
        return res.status(400).json({
          error: `Attachment "${filename}" exceeds ${MAX_LEAD_MAIL_ATTACHMENT_BYTES / (1024 * 1024)} MB limit`,
        })
      }
      attachments.push({ filename, content: contentValue, contentType })
    }

    const finalHtml = html || `<pre style="font-family:Arial,Helvetica,sans-serif;white-space:pre-wrap">${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c])}</pre>`

    let mailResult: any = { sent: false, error: null }
    try {
      const smtpHost = runtimeEnv.SMTP_HOST || (runtimeEnv.SMTP_USER || runtimeEnv.SENDER_EMAIL ? 'smtp.gmail.com' : '')
      const smtpUser = runtimeEnv.SMTP_USER || runtimeEnv.SENDER_EMAIL || ''
      const smtpPass = String(runtimeEnv.SMTP_PASS || runtimeEnv.APP_PASSWORD || '').replace(/\s+/g, '')
      if (!smtpHost || !smtpUser || !smtpPass) {
        throw new Error('SMTP is not configured on the server')
      }
      const sent = await sendSmtpEmail(runtimeEnv, {
        to,
        cc,
        subject,
        html: finalHtml,
        text: text || subject,
        attachments,
      })
      mailResult = { sent: true, ...sent }
    } catch (err: any) {
      mailResult = { sent: false, error: err?.message || String(err) }
    }

    const summary = kind === 'portfolio'
      ? `Portfolio email sent to ${to}${attachments.length ? ` (${attachments.length} attachment${attachments.length === 1 ? '' : 's'})` : ''}`
      : `Email sent to ${to}: ${subject}`
    await logLeadActivity(models, leadId, user, kind === 'portfolio' ? 'portfolio_sent' : 'mail_sent',
      mailResult.sent ? summary : `${summary} — failed: ${mailResult.error}`,
      {
        to, cc, subject,
        attachment_count: attachments.length,
        attachment_names: attachments.map((a) => a.filename),
        sent: !!mailResult.sent,
      })

    if (!mailResult.sent) {
      return res.status(502).json({ mail: mailResult, error: mailResult.error || 'Failed to send mail' })
    }
    return res.status(201).json({ mail: mailResult, message: 'Mail sent' })
  }

  router.post('/:id/send-mail', (req, res) => sendLeadMail(req, res, 'mail').catch((e) => respondWithError(res, e, 500)))
  router.post('/:id/send-portfolio', (req, res) => sendLeadMail(req, res, 'portfolio').catch((e) => respondWithError(res, e, 500)))

  // ── Notes (separate from comments) ──────────────────────────
  router.get('/:id/notes', async (req, res) => {
    try {
      const user = req.user as any
      const leadId = String(req.params.id)
      const lead = await models.leads.findById(leadId) as any
      if (!lead) return res.status(404).json({ error: 'Lead not found' })
      if (!(await canUserAccessLead(models, user, lead))) {
        return res.status(403).json({ error: 'Not allowed' })
      }
      const notes = await models.leadNotes.find({ lead_id: leadId }) as any[]
      notes.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      return res.json({ data: notes, notes })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load notes' })
    }
  })

  router.post('/:id/notes', async (req, res) => {
    try {
      const user = req.user as any
      const leadId = String(req.params.id)
      const lead = await models.leads.findById(leadId) as any
      if (!lead) return res.status(404).json({ error: 'Lead not found' })
      if (!(await canUserAccessLead(models, user, lead))) {
        return res.status(403).json({ error: 'Not allowed to add notes for this lead' })
      }
      const body = req.body || {}
      const text = validateLength(String(body.text || body.content || '').trim(), 1, 5000, 'Note')
      const now = new Date().toISOString()
      const id = generateId('lnote')
      await models.leadNotes.insertOne({
        id,
        lead_id: leadId,
        text,
        author_id: user?.sub || null,
        author_name: user?.name || user?.full_name || null,
        author_role: lower(user?.role) || null,
        created_at: now,
      })
      await logLeadActivity(models, leadId, user, 'note_added',
        `Note: ${text.length > 120 ? text.slice(0, 117) + '…' : text}`,
        { note_id: id })
      return res.status(201).json({ data: { id }, message: 'Note added' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── General tasks (distinct from follow-ups via kind='task') ─
  router.post('/:id/tasks', async (req, res) => {
    try {
      const user = req.user as any
      const leadId = String(req.params.id)
      const lead = await models.leads.findById(leadId) as any
      if (!lead) return res.status(404).json({ error: 'Lead not found' })
      if (!(await canUserAccessLead(models, user, lead))) {
        return res.status(403).json({ error: 'Not allowed to add tasks for this lead' })
      }
      const body = req.body || {}
      const title = validateLength(String(body.title || '').trim(), 1, 200, 'Title')
      const description = String(body.description || '').trim().slice(0, 2000)
      if (!body.due_date) return res.status(400).json({ error: 'Due date is required' })
      const dueDate = new Date(body.due_date)
      if (Number.isNaN(dueDate.getTime())) return res.status(400).json({ error: 'Invalid due date' })
      const priority = ['low', 'medium', 'high', 'critical'].includes(String(body.priority || '').toLowerCase())
        ? String(body.priority).toLowerCase()
        : 'medium'
      const assignedTo = String(body.assigned_to || lead.assigned_to || '').trim()
      const now = new Date().toISOString()
      const taskId = generateId('ltask')
      await models.leadTasks.insertOne({
        id: taskId,
        lead_id: leadId,
        kind: 'task',
        title,
        description,
        notes: description,
        priority,
        assigned_to: assignedTo,
        assigned_by: user?.sub || null,
        status: 'pending',
        due_date: dueDate.toISOString(),
        snooze_minutes: 0,
        acknowledged_at: null,
        acknowledged_by: null,
        custom_values: mergeCustomValues({}, body.custom_values),
        created_at: now,
        updated_at: now,
      })
      await logLeadActivity(models, leadId, user, 'task_added',
        `Task added: "${title}" due ${dueDate.toISOString()}`,
        { task_id: taskId, priority })
      return res.status(201).json({ data: { id: taskId }, message: 'Task created' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── Custom activity log entry ───────────────────────────────
  router.post('/:id/activities', async (req, res) => {
    try {
      const user = req.user as any
      const leadId = String(req.params.id)
      const lead = await models.leads.findById(leadId) as any
      if (!lead) return res.status(404).json({ error: 'Lead not found' })
      if (!(await canUserAccessLead(models, user, lead))) {
        return res.status(403).json({ error: 'Not allowed' })
      }
      const body = req.body || {}
      const kind = String(body.kind || body.type || 'note').toLowerCase().trim().slice(0, 40) || 'note'
      const summary = validateLength(String(body.content || body.summary || '').trim(), 1, 2000, 'Content')
      await logLeadActivity(models, leadId, user, kind, summary, body.meta || {})
      return res.status(201).json({ message: 'Activity logged' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── BULK IMPORT (CSV) ───────────────────────────────────
  // CSV columns:
  //   name, email, phone, source, requirement, assigned_to_name, status
  // assigned_to_name is matched against users.full_name (case-insensitive) —
  // unmatched rows are skipped. If multiple users share a name the first match wins.
  router.get('/import/template.csv', (_req, res) => {
    const sample = [
      'name,email,phone,source,requirement,assigned_to_name,status',
      'Rahul Sharma,rahul@acme.com,+91-9876543210,PPC,Looking for a website rebuild,Priya Verma,new',
      'Priya Verma,priya@globex.com,+91-9876500001,SEO,Needs an iOS + Android app,Priya Verma,contacted',
      'Aman Singh,aman@initech.com,+91-9876500002,Referral,Custom CRM dashboard,Priya Verma,qualified',
    ].join('\n')
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', 'attachment; filename="leads_import_template.csv"')
    return res.send(sample)
  })

  // Plain-text CSV template for bulk lead import. Matches the column shape the
  // import endpoint accepts — admins download this, fill it in Excel/Sheets,
  // and upload it back. We expose 12 Follow Up Remark columns so a single
  // lead can carry up to a year of history in one row.
  router.get('/import/sample', (_req, res) => {
    const header = 'Date,Name,Phone No,Email,Status,Source,RFD Shared,SOW Sent,Office visit,Requirement,Remarks,Follow Up Remark,Last Follow up Date,Next Follow Up date'
    const sample = '25/05/2026,Swarn Singh,91-7589000918,doctorswarnsingh@gmail.com,Under Process,PPC,No,PPC Call,No,Would like to have App portal like Shadi.com,Not answering portfolio shared / Not answering,Had a word with him he\'ll ask his son to consider us,26/05/2026,29/05/2026'
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="leads-import-sample.csv"')
    return res.send(header + '\n' + sample + '\n')
  })

  router.post(
    '/import',
    requireRole('admin', 'pm', 'pc', 'sales_manager', 'sales_tl'),
    async (req, res) => {
      try {
        const user = req.user as any
        const body = req.body || {}
        const csvText = String(body.csv || '').trim()
        if (!csvText) return res.status(400).json({ error: 'csv is required' })

        const rows = parseCsv(csvText)
        if (rows.length < 2) {
          return res.status(400).json({ error: 'CSV must contain a header row and at least one data row' })
        }

        // Header normalization. The user-facing template uses readable labels
        // ("Phone No", "Follow Up Remark"); we map them to internal keys here
        // so the rest of the loop can speak in slugs. Duplicate "follow up
        // remark" columns are tracked by their column index so we don't lose
        // them to map-key collisions.
        const rawHeaders = rows[0].map((h) => String(h || '').trim())
        const headerKey = (raw: string) => {
          const s = raw.toLowerCase().replace(/\s+/g, ' ').trim()
          if (s === 'phone no' || s === 'phone number' || s === 'mobile') return 'phone'
          if (s === 'follow up remark' || s === 'followup remark' || s === 'follow-up remark') return 'follow_up_remark'
          if (s === 'rfd shared')   return 'rfd_shared'
          if (s === 'sow sent')     return 'sow_sent'
          if (s === 'office visit') return 'office_visit'
          if (s === 'last follow up date' || s === 'last followup date' || s === 'last follow-up date') return 'last_followup_date'
          if (s === 'next follow up date' || s === 'next followup date' || s === 'next follow-up date') return 'next_followup_date'
          if (s === 'assigned to name' || s === 'assigned_to_name') return 'assigned_to_name'
          return s.replace(/\s+/g, '_')
        }
        const headers = rawHeaders.map(headerKey)
        const followupColIdxs: number[] = headers
          .map((h, idx) => (h === 'follow_up_remark' ? idx : -1))
          .filter((idx) => idx >= 0)

        const required = ['name', 'email', 'phone', 'source', 'requirement']
        for (const r of required) {
          if (!headers.includes(r)) {
            return res.status(400).json({ error: `Missing required column: ${r}` })
          }
        }

        // Build a lookup of full_name → user once, so per-row assignee
        // overrides via assigned_to_name don't pay a query each. When the
        // column is absent, every row defaults to the importer.
        const allUsers = (await models.users.find({})) as any[]
        const usersByName = new Map<string, any>()
        for (const u of allUsers) {
          if (u && u.full_name) {
            const key = String(u.full_name).toLowerCase().replace(/\s+/g, ' ').trim()
            if (!usersByName.has(key)) usersByName.set(key, u)
          }
        }
        const hasAssignedToColumn = headers.includes('assigned_to_name')
        const importerId = String(user?.sub || user?.id || '')
        const importer = importerId ? await models.users.findById(importerId) as any : null

        // Build a status matcher that accepts whatever the CSV happens to
        // contain — keys ("under_process"), labels ("Under Process"), or
        // free-form text ("under-process"). Every variant maps back to the
        // canonical catalog key. Anything not found falls back to 'new'.
        const statusDocs = (await models.leadStatuses.find({})) as any[]
        const statusByAlias = new Map<string, string>()
        for (const s of statusDocs) {
          const key = String(s.key || '').toLowerCase().trim()
          if (!key) continue
          const label = String(s.label || '').toLowerCase().trim()
          // Register every reasonable lookup form so the CSV cell doesn't
          // need to match the exact storage form.
          statusByAlias.set(key, key)
          statusByAlias.set(sanitizeStatusKey(key), key)
          if (label) {
            statusByAlias.set(label, key)
            statusByAlias.set(sanitizeStatusKey(label), key)
          }
        }
        if (!statusByAlias.size) statusByAlias.set('new', 'new')
        const resolveStatus = (raw: string): string => {
          const v = String(raw || '').toLowerCase().trim()
          if (!v) return 'new'
          return statusByAlias.get(v) || statusByAlias.get(sanitizeStatusKey(v)) || 'new'
        }

        const created: any[] = []
        const errors: { row: number; email?: string; error: string }[] = []
        let followupsCreated = 0

        for (let i = 1; i < rows.length; i++) {
          const cells = rows[i]
          if (!cells || cells.every((c) => !c?.trim())) continue
          // Map all non-followup columns by key. Follow-ups are gathered
          // separately because the same key repeats.
          const record: Record<string, string> = {}
          headers.forEach((h, idx) => {
            if (h === 'follow_up_remark') return
            record[h] = String(cells[idx] || '').trim()
          })
          const followups: string[] = followupColIdxs
            .map((idx) => String(cells[idx] || '').trim())
            .filter((t) => t.length > 0)

          try {
            const name = validateLength(record.name, 2, 120, 'Name')
            const email = validateEmail(record.email, 'Email')
            const phone = validateLength(record.phone, 4, 30, 'Phone')
            const requirement = validateLength(record.requirement, 1, 5000, 'Requirement')
            const source = validateLength(record.source, 1, 80, 'Source')

            // Per-row assignee override (legacy column). When the column is
            // missing OR the cell is empty, the importer owns the lead.
            let assignee: any = importer
            let assignedTo = importerId
            if (hasAssignedToColumn && record.assigned_to_name) {
              const k = record.assigned_to_name.toLowerCase().replace(/\s+/g, ' ').trim()
              const matched = usersByName.get(k)
              if (matched) {
                assignee = matched
                assignedTo = String(matched.id)
              } else {
                errors.push({
                  row: i + 1,
                  email: record.email,
                  error: `Assignee name not found: ${record.assigned_to_name}`,
                })
                continue
              }
            }
            if (!assignedTo) {
              errors.push({ row: i + 1, email: record.email, error: 'No assignee resolved' })
              continue
            }

            const status = resolveStatus(record.status)

            // created_at sourcing, in priority order:
            //   1. "Last Follow up Date" — when present, the importer wants
            //      the lead's timeline to start where the last sales touch was
            //   2. "Date" column — generic created_at fallback
            //   3. importer's clock — last resort so unparseable rows still slot in
            const createdAt = parseCsvDate(record.last_followup_date)
              || parseCsvDate(record.date)
              || new Date()
            const createdAtIso = createdAt.toISOString()
            const nowIso = new Date().toISOString()
            // Single shared due-date pulled from "Next Follow Up date" if the
            // column exists. Applied to every follow-up task on the row so the
            // row's "next action" alarm fires once on the right day.
            const nextFollowupDue = parseCsvDate(record.next_followup_date)
            // "Last Follow up Date" → represents a past contact attempt. We
            // materialize it as a completed (status=done) follow-up so the
            // lead's history shows "last contact was on X" without ringing
            // an alarm (the date is in the past) and the list view can
            // surface the date in a "Last contacted" cell.
            const lastFollowupDue = parseCsvDate(record.last_followup_date)
            const leadId = generateId('lead')
            await models.leads.insertOne({
              id: leadId,
              name,
              email,
              phone,
              requirement,
              requirement_file: null,
              source,
              status,
              assigned_to: assignedTo,
              created_by: user?.sub || null,
              created_at: createdAtIso,
              updated_at: nowIso,
            })

            // Stagger activity timestamps so the timeline renders in the
            // logical order the importer actually performed them, instead of
            // an arbitrary same-instant insertion order. Each call advances
            // the step by ~10 ms — well below human perception but enough
            // for created_at-based sorting to produce a stable sequence.
            const importNow = Date.now()
            let importStep = 0
            const importTs = () => new Date(importNow + (importStep++) * 10).toISOString()

            await logLeadActivity(
              models,
              leadId,
              user,
              'lead_created',
              `Lead imported and assigned to ${assignee?.full_name || assignee?.email || 'self'}`,
              { assigned_to: assignedTo, source_import: true },
              importTs(),
            )

            // Optional "Remarks" + "RFD Shared" / "SOW Sent" / "Office visit"
            // columns are surfaced as a single combined note so the importer's
            // sales context survives the import. Empty cells are skipped.
            // The text lands in BOTH leadNotes (so it shows under Notes and
            // as the lead's latest_note preview in the list) and the timeline
            // activity log (so users see the import event itself).
            const noteFragments: string[] = []
            if (record.remarks)      noteFragments.push(`Remarks: ${record.remarks}`)
            if (record.rfd_shared)   noteFragments.push(`RFD Shared: ${record.rfd_shared}`)
            if (record.sow_sent)     noteFragments.push(`SOW Sent: ${record.sow_sent}`)
            if (record.office_visit) noteFragments.push(`Office Visit: ${record.office_visit}`)
            if (noteFragments.length) {
              const noteText = noteFragments.join(' | ').slice(0, 5000)
              const noteId = generateId('lnote')
              await models.leadNotes.insertOne({
                id: noteId,
                lead_id: leadId,
                text: noteText,
                author_id: user?.sub || null,
                author_name: user?.name || user?.full_name || null,
                author_role: lower(user?.role) || null,
                created_at: nowIso,
              })
              await logLeadActivity(
                models,
                leadId,
                user,
                'note_added',
                noteText.slice(0, 600),
                { source_import: true, note_id: noteId },
                importTs(),
              )
            }

            // Materialize "Last Follow up Date" as a completed task so the
            // lead's history reflects the past contact and the list view's
            // "Last contacted" cell has something to surface.
            if (lastFollowupDue) {
              const lastTaskId = generateId('ltask')
              await models.leadTasks.insertOne({
                id: lastTaskId,
                lead_id: leadId,
                title: 'Other: Last contact (imported)',
                activity_type: 'Other',
                description: 'Imported from CSV — Last Follow up Date column.',
                notes: 'Imported from CSV — Last Follow up Date column.',
                assigned_to: assignedTo,
                assigned_by: user?.sub || null,
                status: 'done',
                due_date: lastFollowupDue.toISOString(),
                snooze_minutes: 0,
                acknowledged_at: lastFollowupDue.toISOString(),
                acknowledged_by: user?.sub || null,
                completed_at: lastFollowupDue.toISOString(),
                created_at: lastFollowupDue.toISOString(),
                updated_at: nowIso,
              })
              await logLeadActivity(
                models,
                leadId,
                user,
                'followup_updated',
                `Imported last contact recorded on ${lastFollowupDue.toISOString().slice(0, 10)}`,
                { task_id: lastTaskId, source_import: true, status: 'done' },
                importTs(),
              )
              followupsCreated++
            }

            // Each non-empty Follow Up Remark cell becomes a lead task.
            // Due date priority:
            //   1. "Next Follow Up date" column (when provided, applies to every
            //      follow-up on the row — this is the most explicit signal)
            //   2. trailing date inside the remark itself (e.g. "...soon / 26 May 2026")
            //   3. staggered fallback (row + 3 days, +6, +9 …) so identical
            //      blank-due remarks don't all alarm together
            for (let fIdx = 0; fIdx < followups.length; fIdx++) {
              const raw = followups[fIdx]
              const { text, due } = splitFollowupRemark(raw)
              const dueDate = nextFollowupDue
                || due
                || new Date(Date.now() + (fIdx + 1) * 3 * 24 * 60 * 60 * 1000)
              const taskId = generateId('ltask')
              // Title shape matches what the Schedule Follow-up modal writes —
              // "<ActivityType>: <note>" — so the list and detail views
              // render imported rows the same way as manually-scheduled ones.
              const titleText = text.slice(0, 80) || `Follow up with ${name}`
              const title = `Other: ${titleText}`
              // Imported follow-ups are tagged activity_type='Other' so they
              // show up with the right chip on the list view and can be
              // reclassified later via the Edit modal if the agent picks up
              // the call/email context after the fact.
              await models.leadTasks.insertOne({
                id: taskId,
                lead_id: leadId,
                title,
                activity_type: 'Other',
                description: text,
                notes: text,
                assigned_to: assignedTo,
                assigned_by: user?.sub || null,
                status: 'pending',
                due_date: dueDate.toISOString(),
                snooze_minutes: DEFAULT_FOLLOWUP_SNOOZE_MINUTES,
                acknowledged_at: null,
                acknowledged_by: null,
                created_at: nowIso,
                updated_at: nowIso,
              })
              await logLeadActivity(
                models,
                leadId,
                user,
                'other',
                `Imported follow-up: "${title}" due ${dueDate.toISOString().slice(0, 10)}`,
                { task_id: taskId, source_import: true },
                importTs(),
              )
              followupsCreated++
            }

            created.push({ id: leadId, email, name, assigned_to: assignedTo, followups: followups.length })
          } catch (e: any) {
            errors.push({ row: i + 1, email: record.email, error: e?.message || 'Failed' })
          }
        }

        return res.json({
          created_count: created.length,
          followups_created: followupsCreated,
          error_count: errors.length,
          created,
          errors,
        })
      } catch (error: any) {
        return respondWithError(res, error, 500)
      }
    },
  )

  return router
}

// Tiny CSV parser — handles quoted fields with commas and escaped quotes ("").
// Best-effort date parser for free-form CSV cells. Accepts dd/mm/yyyy and
// dd-mm-yyyy (Indian convention — what Excel exports there), ISO yyyy-mm-dd,
// and verbose forms like "26 May 2026" or "26 May" (year defaults to current).
// Returns null if no recognised pattern matches so callers can fall back.
function parseCsvDate(input: string | undefined | null): Date | null {
  const s = String(input || '').trim()
  if (!s) return null
  // dd/mm/yyyy or dd-mm-yyyy
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/)
  if (m) {
    const d = Number(m[1])
    const mo = Number(m[2]) - 1
    let y = Number(m[3])
    if (y < 100) y += 2000
    const dt = new Date(Date.UTC(y, mo, d))
    if (!Number.isNaN(dt.getTime())) return dt
  }
  // ISO yyyy-mm-dd
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) {
    const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
    if (!Number.isNaN(dt.getTime())) return dt
  }
  // "26 May 2026" or "26 May"
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  m = s.match(/^(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{2,4}))?$/)
  if (m) {
    const d = Number(m[1])
    const moIdx = months.indexOf(m[2].toLowerCase().slice(0, 3))
    if (moIdx >= 0) {
      let y = m[3] ? Number(m[3]) : new Date().getUTCFullYear()
      if (y < 100) y += 2000
      const dt = new Date(Date.UTC(y, moIdx, d))
      if (!Number.isNaN(dt.getTime())) return dt
    }
  }
  // Last-ditch: let JS try. Reliable for ISO with time, sketchy elsewhere.
  const fallback = new Date(s)
  return Number.isNaN(fallback.getTime()) ? null : fallback
}

// Pulls a trailing date off the end of a follow-up cell so importers can
// jot quick context like "called back / 26 May 2026" and have the system
// schedule the alarm. Supported separators: "/", "-", "|", "•" — the last
// token after one of these is parsed as a date if it matches a known shape.
function splitFollowupRemark(raw: string): { text: string; due: Date | null } {
  const s = String(raw || '').trim()
  if (!s) return { text: '', due: null }
  // Try the segment after the last `/` or `|` or `•` separator.
  const sepIdx = Math.max(s.lastIndexOf('/'), s.lastIndexOf('|'), s.lastIndexOf('•'))
  if (sepIdx > 0 && sepIdx < s.length - 1) {
    const tail = s.slice(sepIdx + 1).trim()
    const dt = parseCsvDate(tail)
    if (dt) return { text: s.slice(0, sepIdx).trim() || s, due: dt }
  }
  return { text: s, due: null }
}

function parseCsv(text: string): string[][] {
  // Strip UTF-8 BOM. Excel "Save As CSV (UTF-8)" prepends ﻿, which would
  // otherwise turn the first header from "Date" into "﻿Date" and make
  // required-column checks fail.
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
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
