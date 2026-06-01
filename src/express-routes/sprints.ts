import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, userHasAnyPermission } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'
import {
  validateRequired,
  validateLength,
  validateISODate,
  validateOptional,
  respondWithError,
} from '../validators'
import { sendInvoiceViaSmtp, parseEmailList, escapeHtml as esc, type InvoiceEmailEnv } from '../utils/invoice-email'

export function createSprintsRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  router.get('/', async (req, res) => {
    try {
      const projectId = typeof req.query.project_id === 'string' ? req.query.project_id : undefined
      const filter: any = {}
      if (projectId) filter.project_id = projectId
      const [sprints, tasks, users] = await Promise.all([
        models.sprints.find(filter) as Promise<any[]>,
        models.tasks.find({}) as Promise<any[]>,
        models.users.find({}) as Promise<any[]>,
      ])
      const usersById = new Map(users.map((u) => [String(u.id), u]))
      type SprintAgg = {
        task_count: number
        done_count: number
        blocked_count: number
        total_story_points: number
        completed_story_points: number
      }
      const empty = (): SprintAgg => ({ task_count: 0, done_count: 0, blocked_count: 0, total_story_points: 0, completed_story_points: 0 })
      const counts = new Map<string, SprintAgg>()
      for (const t of tasks) {
        const key = String(t.sprint_id || '')
        if (!key) continue
        const cur = counts.get(key) || empty()
        cur.task_count += 1
        if (t.status === 'done') cur.done_count += 1
        if (t.status === 'blocked') cur.blocked_count += 1
        const sp = Number(t.story_points || 0)
        if (Number.isFinite(sp)) {
          cur.total_story_points += sp
          if (t.status === 'done') cur.completed_story_points += sp
        }
        counts.set(key, cur)
      }
      const enriched = sprints.map((s) => ({
        ...s,
        created_by_name: usersById.get(String(s.created_by))?.full_name || null,
        ...(counts.get(String(s.id)) || empty()),
      })).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      return res.json({ sprints: enriched, data: enriched })
    } catch {
      return res.json({ sprints: [], data: [] })
    }
  })

  router.post('/', async (req, res) => {
    try {
      const user = req.user as any
      if (!(await userHasAnyPermission(models, user, 'sprints.create'))) return res.status(403).json({ error: 'Forbidden' })
      const body = req.body || {}
      const project_id = validateRequired(body.project_id, 'project_id')
      const name = validateLength(String(body.name || '').trim(), 2, 120, 'Sprint name')
      const start_date = validateISODate(body.start_date, 'Start date')
      const end_date = validateISODate(body.end_date, 'End date')
      if (start_date > end_date) {
        return res.status(400).json({ error: 'End date must be on or after start date' })
      }
      const goal = validateOptional(body.goal, (v) => validateLength(String(v).trim(), 1, 1000, 'Goal'))
      const id = generateId('sp')
      const now = new Date().toISOString()
      const sprint = {
        id,
        project_id,
        name,
        goal,
        start_date,
        end_date,
        status: 'planning',
        completed_story_points: 0,
        velocity: 0,
        created_by: user?.sub || null,
        created_at: now,
        updated_at: now,
      }
      await models.sprints.insertOne(sprint)
      return res.status(201).json({ sprint })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.put('/:id', async (req, res) => {
    try {
      const user = req.user as any
      if (!(await userHasAnyPermission(models, user, 'sprints.edit'))) return res.status(403).json({ error: 'Forbidden' })
      const id = req.params.id
      const body = req.body || {}
      const patch: any = { updated_at: new Date().toISOString() }
      for (const k of ['name', 'goal', 'start_date', 'end_date', 'status', 'velocity']) {
        if (k in body) patch[k] = body[k]
      }
      await models.sprints.updateById(id, { $set: patch })
      const sprint = await models.sprints.findById(id)
      return res.json({ sprint })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to update sprint' })
    }
  })

  return router
}

// Wraps the editable inner content in the email document shell so the outer
// styling (background, container) stays consistent whether the body was
// auto-generated or hand-edited by the sender.
function wrapMilestoneEmail(innerHtml: string) {
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0B0B0D;background:#f8fafc;margin:0;padding:24px">${innerHtml}</body></html>`
}

// Effective completion %: the stored value can lag the live task statuses
// (it's only recalculated when a task's status changes), so we also derive it
// from the live tasks and honour an explicit 'completed' status. Used by the
// email gate so a visibly-100% milestone is never rejected as incomplete.
async function milestoneEffectivePct(models: MongoModels, milestone: any) {
  if (milestone?.status === 'completed') return 100
  let pct = Number(milestone?.completion_pct) || 0
  const live = await models.tasks.find({ milestone_id: String(milestone.id) }) as any[]
  if (live.length) {
    const sum = live
      .filter((t) => t.status === 'done')
      .reduce((s, t) => s + (Number(t.pct_of_milestone) || 0), 0)
    pct = Math.max(pct, Math.min(100, Math.round(sum)))
  }
  return pct
}

// Recompute and PERSIST a milestone's completion_pct + status from its live
// tasks. Call after adding/removing tasks so the stored value never drifts.
async function recomputeMilestoneProgress(models: MongoModels, milestoneId: string) {
  try {
    const tasks = await models.tasks.find({ milestone_id: String(milestoneId) }) as any[]
    let pct = 0
    for (const t of tasks) if (t.status === 'done') pct += Number(t.pct_of_milestone) || 0
    pct = Math.max(0, Math.min(100, Math.round(pct)))
    const status = pct >= 100 ? 'completed' : (pct > 0 ? 'in_progress' : 'pending')
    await models.milestones.updateById(String(milestoneId), {
      $set: { completion_pct: pct, status, updated_at: new Date().toISOString() },
    })
  } catch (e) {
    console.warn('[milestones] recompute progress failed:', e)
  }
}

// Builds the default (auto-generated) inner body for a milestone-completion
// email using LIVE task statuses. Returned separately from the shell so the
// compose modal can show it as an editable preview.
async function buildMilestoneEmailInner(models: MongoModels, milestone: any, project: any, client: any, companyName: string) {
  const liveTasks = await models.tasks.find({ milestone_id: String(milestone.id) }) as any[]
  const usersForEmail = await models.users.find({}) as any[]
  const usersByIdEmail = new Map(usersForEmail.map((u) => [String(u.id), u]))
  const refsByIdEmail = new Map<string, any>()
  if (Array.isArray(milestone.tasks)) {
    for (const ref of milestone.tasks) refsByIdEmail.set(String(ref.id), ref)
  }
  const tasksForEmail = liveTasks.length ? liveTasks : (Array.isArray(milestone.tasks) ? milestone.tasks : [])
  const taskRows = tasksForEmail
    .map((t: any) => {
      const ref = refsByIdEmail.get(String(t.id)) || {}
      const assigneeName = t.assignee_name
        || usersByIdEmail.get(String(t.assignee_id))?.full_name
        || ref.assignee_name
        || '—'
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(t.title)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-transform:capitalize">${esc(String(t.status || '').replace('_', ' '))}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(assigneeName)}</td>
      </tr>`
    }).join('')
  const tasksTable = taskRows
    ? `<table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:13px"><thead><tr><th align="left" style="padding:6px 10px;background:#f1f5f9">Task</th><th align="left" style="padding:6px 10px;background:#f1f5f9">Status</th><th align="left" style="padding:6px 10px;background:#f1f5f9">Assignee</th></tr></thead><tbody>${taskRows}</tbody></table>`
    : ''
  return `<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:24px">
          <h2 style="margin:0 0 8px;color:#0B0B0D">Milestone Completed</h2>
          <p style="color:#5A5A66;margin:0 0 16px">Hi ${esc(client?.name || client?.full_name || client?.contact_name || 'Client')}, we are pleased to inform you that the following milestone has been completed.</p>
          <div style="border:1px solid #e2e8f0;border-radius:8px;padding:14px;background:#f8fafc">
            <div style="font-size:16px;font-weight:600;margin-bottom:6px">${esc(milestone.title)}</div>
            <div style="font-size:13px;color:#7E7E8F">Project: ${esc(project?.name || '—')}</div>
            <div style="font-size:13px;color:#7E7E8F">Due Date: ${esc(milestone.due_date || '—')}</div>
            ${milestone.description ? `<div style="margin-top:8px;font-size:13px;color:#2B2B35">${esc(milestone.description)}</div>` : ''}
            ${milestone.is_billable ? `<div style="margin-top:8px;font-size:13px;color:#0f766e"><strong>Billable Amount:</strong> ₹${Number(milestone.invoice_amount || 0).toLocaleString('en-IN')}</div>` : ''}
          </div>
          ${tasksTable}
          <p style="margin-top:20px;color:#5A5A66;font-size:13px">We would love to hear your feedback. Please log in to the client portal to share your rating.</p>
          <p style="margin-top:20px;color:#0B0B0D;font-size:13px">Regards,<br/>${esc(companyName)}</p>
        </div>`
}

// Inner body for the change-request quotation email — a table of the
// milestone's change requests (description, hours, rate, total) with a grand
// total. CRs live on the milestone doc, so no DB lookup is needed.
function buildChangeRequestEmailInner(milestone: any, project: any, client: any, companyName: string) {
  const inr = (n: any) => `₹${Number(n || 0).toLocaleString('en-IN')}`
  const crs = Array.isArray(milestone.change_requests) ? milestone.change_requests : []
  const grand = crs.reduce((s: number, c: any) => s + (Number(c.total) || 0), 0)
  const rows = crs.map((c: any) => `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #eee">
        ${c.title ? `<strong>${esc(c.title)}</strong><br/>` : ''}
        <span style="color:#5A5A66">${esc(c.description || '')}</span>
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right">${Number(c.hours) || 0}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right">${inr(c.price_per_hour)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right">${inr(c.total)}</td>
    </tr>`).join('')
  return `<div style="max-width:660px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:24px">
          <h2 style="margin:0 0 8px;color:#0B0B0D">Change Request Quotation</h2>
          <p style="color:#5A5A66;margin:0 0 16px">Hi ${esc(client?.name || client?.full_name || client?.contact_name || 'Client')}, please find the proposed change(s) for the milestone <strong>${esc(milestone.title)}</strong>${project?.name ? ` (project: ${esc(project.name)})` : ''}.</p>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr>
              <th align="left" style="padding:8px 10px;background:#f1f5f9">Change</th>
              <th align="right" style="padding:8px 10px;background:#f1f5f9">Hours</th>
              <th align="right" style="padding:8px 10px;background:#f1f5f9">Rate/hr</th>
              <th align="right" style="padding:8px 10px;background:#f1f5f9">Total</th>
            </tr></thead>
            <tbody>${rows || '<tr><td colspan="4" style="padding:10px;color:#5A5A66">No change requests.</td></tr>'}</tbody>
            <tfoot><tr>
              <td colspan="3" style="padding:10px;text-align:right;font-weight:700">Grand Total</td>
              <td style="padding:10px;text-align:right;font-weight:700;color:#0f766e">${inr(grand)}</td>
            </tr></tfoot>
          </table>
          <p style="margin-top:20px;color:#5A5A66;font-size:13px">Please reply to confirm so we can schedule these changes. The hours are estimates and may be refined during implementation.</p>
          <p style="margin-top:20px;color:#0B0B0D;font-size:13px">Regards,<br/>${esc(companyName)}</p>
        </div>`
}

export function createMilestonesRouter(models: MongoModels, jwtSecret: string, runtimeEnv: InvoiceEmailEnv = {}) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  // Returns the editable default subject + body so the compose modal can show
  // a live preview the sender can tweak before sending.
  router.get('/:id/email-preview', async (req, res) => {
    try {
      const user = req.user as any
      if (!(await userHasAnyPermission(models, user, 'milestones.edit'))) return res.status(403).json({ error: 'Forbidden' })
      const milestone = await models.milestones.findById(req.params.id) as any
      if (!milestone) return res.status(404).json({ error: 'Milestone not found' })
      const project = milestone.project_id ? await models.projects.findById(String(milestone.project_id)) as any : null
      const client = project?.client_id ? await models.clients.findById(String(project.client_id)) as any : null
      const companyName = String(runtimeEnv.COMPANY_NAME || 'Mariox Software')
      const inner_html = await buildMilestoneEmailInner(models, milestone, project, client, companyName)
      return res.json({
        subject: `Milestone Completed: ${milestone.title}`,
        to: client?.email || '',
        inner_html,
      })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to build email preview' })
    }
  })

  function normalizeTasks(input: any): any[] {
    if (!Array.isArray(input)) return []
    const now = new Date().toISOString()
    return input.slice(0, 50).map((t: any, idx: number) => {
      const pct = Number(t?.pct_of_milestone)
      return {
        id: String(t?.id || `mt_${Date.now().toString(36)}_${idx}`),
        title: String(t?.title || '').trim().slice(0, 200),
        description: t?.description ? String(t.description).trim().slice(0, 1000) : null,
        assignee_id: t?.assignee_id ? String(t.assignee_id) : null,
        assignee_name: t?.assignee_name ? String(t.assignee_name).slice(0, 200) : null,
        assignee_kind: t?.assignee_kind === 'team' ? 'team' : 'developer',
        pct_of_milestone: Number.isFinite(pct) ? Math.max(0, Math.min(100, Math.round(pct))) : 0,
        status: ['pending', 'in_progress', 'done', 'blocked'].includes(t?.status) ? t.status : 'pending',
        // Per-task references uploaded with the milestone — kept on the
        // milestone tasks snapshot so detail views can surface them without
        // an extra documents query.
        reference_url: t?.reference_url ? String(t.reference_url).trim().slice(0, 500) : null,
        attachment_url: t?.attachment_url ? String(t.attachment_url).slice(0, 1000) : null,
        attachment_name: t?.attachment_name ? String(t.attachment_name).slice(0, 255) : null,
        attachment_type: t?.attachment_type ? String(t.attachment_type).slice(0, 120) : null,
        attachment_size: Number(t?.attachment_size) || 0,
        created_at: t?.created_at || now,
      }
    }).filter((t) => t.title.length >= 1)
  }

  // Client-driven change requests captured against a milestone: a description
  // of what changed, the effort (hours) and rate (price/hour), with the total
  // computed server-side so it can never disagree with hours × rate.
  function normalizeChangeRequests(input: any): any[] {
    if (!Array.isArray(input)) return []
    const now = new Date().toISOString()
    const VALID = ['pending', 'approved', 'rejected', 'done']
    return input.slice(0, 50).map((c: any, idx: number) => {
      const hours = Math.max(0, Number(c?.hours) || 0)
      const rate = Math.max(0, Number(c?.price_per_hour) || 0)
      return {
        id: String(c?.id || `cr_${Date.now().toString(36)}_${idx}`),
        title: String(c?.title || '').trim().slice(0, 200),
        description: String(c?.description || '').trim().slice(0, 4000),
        hours: Math.round(hours * 100) / 100,
        price_per_hour: Math.round(rate * 100) / 100,
        total: Math.round(hours * rate * 100) / 100,
        status: VALID.includes(String(c?.status)) ? c.status : 'pending',
        created_at: c?.created_at || now,
      }
    }).filter((c) => c.description.length >= 1 || c.title.length >= 1)
  }

  function normalizeRating(input: any): any | null {
    if (!input || typeof input !== 'object') return null
    const clamp = (n: any) => {
      const v = Number(n)
      if (!Number.isFinite(v)) return 0
      return Math.max(0, Math.min(10, Math.round(v * 10) / 10))
    }
    const timing = clamp(input.timing)
    const team = clamp(input.team)
    const communication = clamp(input.communication ?? input.behavior)
    const quality = clamp(input.quality)
    const scores = [timing, team, communication, quality].filter((n) => n > 0)
    const overall = scores.length
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
      : 0
    return {
      timing,
      team,
      communication,
      quality,
      overall,
      comment: input.comment ? String(input.comment).slice(0, 1000) : null,
      rated_at: new Date().toISOString(),
      rated_by: input.rated_by ? String(input.rated_by).slice(0, 200) : null,
    }
  }

  router.get('/', async (req, res) => {
    try {
      const projectId = typeof req.query.project_id === 'string' ? req.query.project_id : undefined
      const projectIds = typeof req.query.project_ids === 'string' ? req.query.project_ids : undefined
      const filter: any = {}
      if (projectId) filter.project_id = projectId
      else if (projectIds) {
        const ids = projectIds.split(',').filter(Boolean)
        if (ids.length) filter.project_id = { $in: ids }
      }
      const [milestones, users, projects, invoices, allTasks] = await Promise.all([
        models.milestones.find(filter) as Promise<any[]>,
        models.users.find({}) as Promise<any[]>,
        models.projects.find({}) as Promise<any[]>,
        models.invoices.find({}) as Promise<any[]>,
        models.tasks.find({}) as Promise<any[]>,
      ])
      const usersById = new Map(users.map((u) => [String(u.id), u]))
      const projectsById = new Map(projects.map((p) => [String(p.id), p]))
      const invoiceCounts = new Map<string, number>()
      for (const inv of invoices) {
        if (!inv.milestone_id) continue
        const key = String(inv.milestone_id)
        invoiceCounts.set(key, (invoiceCounts.get(key) || 0) + 1)
      }
      const tasksByMilestone = new Map<string, any[]>()
      for (const t of allTasks) {
        if (!t.milestone_id) continue
        const key = String(t.milestone_id)
        if (!tasksByMilestone.has(key)) tasksByMilestone.set(key, [])
        tasksByMilestone.get(key)!.push(t)
      }
      const enriched = milestones.map((m) => {
        const liveTasks = tasksByMilestone.get(String(m.id)) || []
        const refsByTaskId = new Map<string, any>()
        if (Array.isArray(m.tasks)) {
          for (const ref of m.tasks) refsByTaskId.set(String(ref.id), ref)
        }
        const liveSnap = liveTasks.map((t) => {
          const ref = refsByTaskId.get(String(t.id)) || {}
          return {
            id: t.id,
            title: t.title,
            assignee_id: t.assignee_id || null,
            assignee_name: usersById.get(String(t.assignee_id))?.full_name || null,
            pct_of_milestone: Number(t.pct_of_milestone ?? ref.pct_of_milestone) || 0,
            status: t.status || 'todo',
            reference_url: t.reference_url || ref.reference_url || null,
            attachment_url: t.attachment_url || ref.attachment_url || null,
            attachment_name: t.attachment_name || ref.attachment_name || null,
            attachment_type: t.attachment_type || ref.attachment_type || null,
            attachment_size: Number(t.attachment_size ?? ref.attachment_size) || 0,
          }
        })
        return {
          ...m,
          tasks: liveSnap.length ? liveSnap : (Array.isArray(m.tasks) ? m.tasks : []),
          created_by_name: usersById.get(String(m.created_by))?.full_name || null,
          project_name: projectsById.get(String(m.project_id))?.name || null,
          invoice_count: invoiceCounts.get(String(m.id)) || 0,
        }
      }).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      return res.json({ milestones: enriched, data: enriched })
    } catch {
      return res.json({ milestones: [], data: [] })
    }
  })

  router.post('/', async (req, res) => {
    try {
      const user = req.user as any
      if (!(await userHasAnyPermission(models, user, 'milestones.create'))) return res.status(403).json({ error: 'Forbidden' })
      const body = req.body || {}
      const { project_id, title, description, due_date, is_billable = 0, invoice_amount = 0, client_visible = 1, deliverables, tasks, attachments } = body
      if (!project_id || !title || !due_date) return res.status(400).json({ error: 'project_id, title, due_date required' })

      // Idempotency guard against the double-submit that creates duplicate
      // milestones (rapid button clicks / retried POSTs). If an identical
      // milestone (same project + case-insensitive title) was created in the
      // last 20s, return it instead of inserting a second copy.
      const normTitle = String(title).trim().toLowerCase()
      const cutoff = new Date(Date.now() - 20_000).toISOString()
      const recent = await models.milestones.find({ project_id }) as any[]
      const dup = recent.find((m) =>
        String(m.title || '').trim().toLowerCase() === normTitle &&
        String(m.created_at || '') >= cutoff)
      if (dup) return res.status(200).json({ milestone: dup, deduped: true })

      const id = generateId('ms')
      const now = new Date().toISOString()

      // Create real Task records so they appear in kanban "To-Do" column.
      const inputTasks = normalizeTasks(tasks)
      const createdTaskRefs: any[] = []
      for (const t of inputTasks) {
        const taskId = generateId('task')
        // Honour the status chosen at creation (normalizeTasks restricts it to
        // pending/in_progress/done/blocked); 'pending' maps to the kanban
        // 'todo' column so the card lands in the right place.
        const taskStatus = t.status === 'pending' ? 'todo' : t.status
        const taskRecord = {
          id: taskId,
          project_id,
          milestone_id: id,
          sprint_id: null,
          parent_task_id: null,
          title: t.title,
          description: t.description || null,
          task_type: 'task',
          status: taskStatus,
          completed_at: taskStatus === 'done' ? now : null,
          priority: 'medium',
          assignee_id: t.assignee_id || null,
          reporter_id: user?.sub || null,
          story_points: 0,
          estimated_hours: 0,
          logged_hours: 0,
          due_date: null,
          pct_of_milestone: Number(t.pct_of_milestone) || 0,
          reference_url: t.reference_url || null,
          attachment_url: t.attachment_url || null,
          attachment_name: t.attachment_name || null,
          attachment_type: t.attachment_type || null,
          attachment_size: Number(t.attachment_size) || 0,
          labels: null,
          is_client_visible: 1,
          is_billable: Number(is_billable ? 1 : 0),
          position: 0,
          created_at: now,
          updated_at: now,
        }
        try {
          await models.tasks.insertOne(taskRecord)
          createdTaskRefs.push({
            id: taskId,
            title: t.title,
            assignee_id: t.assignee_id || null,
            assignee_name: t.assignee_name || null,
            assignee_kind: t.assignee_kind || 'developer',
            pct_of_milestone: Number(t.pct_of_milestone) || 0,
            status: taskStatus,
            reference_url: t.reference_url || null,
            attachment_url: t.attachment_url || null,
            attachment_name: t.attachment_name || null,
            attachment_type: t.attachment_type || null,
            attachment_size: Number(t.attachment_size) || 0,
            created_at: now,
          })
          // Surface per-task uploaded files in Documents Center, scoped to
          // the project. Reference URLs (Figma/Drive/etc) stay on the task.
          if (t.attachment_url) {
            try {
              await models.documents.insertOne({
                id: generateId('doc'),
                project_id,
                client_id: null,
                title: `${title} — ${String(t.attachment_name || t.title).slice(0, 180)}`,
                description: `Attached to milestone task "${t.title}"`,
                category: 'other',
                file_name: String(t.attachment_name || 'file').slice(0, 255),
                file_url: String(t.attachment_url),
                file_size: Number(t.attachment_size) || 0,
                file_type: t.attachment_type || null,
                version: '1.0',
                uploaded_by: user?.sub || null,
                uploaded_by_role: 'staff',
                visibility: Number(client_visible) ? 'all' : 'internal',
                is_client_visible: Number(client_visible) ? 1 : 0,
                tags: null,
                download_count: 0,
                source_milestone_id: id,
                source_task_id: taskId,
                created_at: now,
                updated_at: now,
              })
            } catch (e) {
              console.warn('[milestones] task attachment doc failed:', e)
            }
          }
        } catch {}
      }

      // If any tasks were already marked done at creation, reflect that in the
      // milestone completion straight away (same rule as the task-status hook).
      const initialPct = Math.max(0, Math.min(100, Math.round(
        createdTaskRefs.filter((r) => r.status === 'done').reduce((s, r) => s + (Number(r.pct_of_milestone) || 0), 0),
      )))
      const initialStatus = initialPct >= 100 ? 'completed' : (initialPct > 0 ? 'in_progress' : 'pending')

      const milestone = {
        id,
        project_id,
        title,
        description: description || null,
        due_date,
        completion_pct: initialPct,
        status: initialStatus,
        is_billable: Number(is_billable ? 1 : 0),
        invoice_amount: Number(invoice_amount || 0),
        client_visible: Number(client_visible ? 1 : 0),
        deliverables: deliverables ? JSON.stringify(deliverables) : null,
        tasks: createdTaskRefs,
        change_requests: normalizeChangeRequests(body.change_requests),
        rating: null,
        email_sent_at: null,
        email_sent_to: null,
        created_by: user?.sub || null,
        created_at: now,
        updated_at: now,
      }
      await models.milestones.insertOne(milestone)

      // Persist any attached files as project documents so they appear in the
      // Documents center (filtered by project) and stay accessible after the
      // milestone is closed. Failures here are non-fatal — the milestone is
      // already created.
      if (Array.isArray(attachments) && attachments.length) {
        try {
          const docRows = attachments
            .filter((a: any) => a && a.file_url)
            .slice(0, 20)
            .map((a: any) => ({
              id: generateId('doc'),
              project_id,
              client_id: null,
              title: `${title} — ${String(a.file_name || 'attachment').slice(0, 180)}`,
              description: `Attached when creating milestone "${title}"`,
              category: 'other',
              file_name: String(a.file_name || 'file').slice(0, 255),
              file_url: String(a.file_url),
              file_size: Number(a.file_size) || 0,
              file_type: a.file_type ? String(a.file_type).slice(0, 120) : null,
              version: '1.0',
              uploaded_by: user?.sub || null,
              uploaded_by_role: 'staff',
              visibility: Number(client_visible) ? 'all' : 'internal',
              is_client_visible: Number(client_visible) ? 1 : 0,
              tags: null,
              download_count: 0,
              source_milestone_id: id,
              created_at: now,
              updated_at: now,
            }))
          if (docRows.length) await models.documents.insertMany(docRows)
        } catch (e) {
          console.warn('[milestones] failed to create attachment documents:', e)
        }
      }

      return res.status(201).json({ milestone })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to create milestone' })
    }
  })

  router.put('/:id', async (req, res) => {
    try {
      const user = req.user as any
      if (!(await userHasAnyPermission(models, user, 'milestones.edit'))) return res.status(403).json({ error: 'Forbidden' })
      const id = req.params.id
      const body = req.body || {}
      const patch: any = { updated_at: new Date().toISOString() }
      for (const k of ['title', 'description', 'due_date', 'completion_pct', 'status', 'is_billable', 'invoice_amount', 'client_visible']) {
        if (k in body) patch[k] = body[k]
      }
      if ('tasks' in body) patch.tasks = normalizeTasks(body.tasks)
      if ('change_requests' in body) patch.change_requests = normalizeChangeRequests(body.change_requests)
      await models.milestones.updateById(id, { $set: patch })
      const milestone = await models.milestones.findById(id)
      return res.json({ milestone })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to update milestone' })
    }
  })

  // Delete a milestone. Its tasks are unlinked (milestone_id cleared) rather
  // than deleted, so any work already on the kanban board is preserved.
  router.delete('/:id', async (req, res) => {
    try {
      const user = req.user as any
      if (!(await userHasAnyPermission(models, user, 'milestones.delete'))) return res.status(403).json({ error: 'Forbidden' })
      const id = req.params.id
      const milestone = await models.milestones.findById(id) as any
      if (!milestone) return res.status(404).json({ error: 'Milestone not found' })
      await models.tasks.updateMany({ milestone_id: id }, { $set: { milestone_id: null, pct_of_milestone: 0, updated_at: new Date().toISOString() } })
      await models.milestones.deleteById(id)
      return res.json({ message: 'Milestone deleted' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to delete milestone' })
    }
  })

  // Add a task to an existing milestone — creates a real kanban task and
  // appends a ref to the milestone's tasks snapshot.
  router.post('/:id/tasks', async (req, res) => {
    try {
      const user = req.user as any
      if (!(await userHasAnyPermission(models, user, 'milestones.edit'))) return res.status(403).json({ error: 'Forbidden' })
      const id = req.params.id
      const milestone = await models.milestones.findById(id) as any
      if (!milestone) return res.status(404).json({ error: 'Milestone not found' })
      const body = req.body || {}
      const title = String(body.title || '').trim()
      if (!title) return res.status(400).json({ error: 'Task title is required' })
      const now = new Date().toISOString()
      const taskId = generateId('task')
      // Validate status against THIS project's kanban columns (which may be
      // customized), falling back to the defaults / 'todo'.
      let allowedStatuses = ['backlog', 'todo', 'in_progress', 'in_review', 'qa', 'done', 'blocked']
      try {
        const cols = await models.kanbanColumns.find({ project_id: milestone.project_id }) as any[]
        if (cols.length) allowedStatuses = cols.map((c) => String(c.status_key)).filter(Boolean)
      } catch { /* keep defaults */ }
      const status = allowedStatuses.includes(String(body.status)) ? body.status : (allowedStatuses.includes('todo') ? 'todo' : allowedStatuses[0] || 'todo')
      const pct = Math.max(0, Math.min(100, Math.round(Number(body.pct_of_milestone) || 0)))
      await models.tasks.insertOne({
        id: taskId,
        project_id: milestone.project_id,
        milestone_id: id,
        sprint_id: null,
        parent_task_id: null,
        title,
        description: body.description ? String(body.description) : null,
        task_type: 'task',
        status,
        completed_at: status === 'done' ? now : null,
        priority: 'medium',
        assignee_id: body.assignee_id || null,
        reporter_id: user?.sub || null,
        story_points: 0,
        estimated_hours: 0,
        logged_hours: 0,
        due_date: null,
        pct_of_milestone: pct,
        reference_url: body.reference_url || null,
        attachment_url: body.attachment_url || null,
        attachment_name: body.attachment_name || null,
        attachment_type: body.attachment_type || null,
        attachment_size: Number(body.attachment_size) || 0,
        labels: null,
        is_client_visible: 1,
        is_billable: Number(milestone.is_billable ? 1 : 0),
        position: 0,
        created_at: now,
        updated_at: now,
      })
      const ref = {
        id: taskId,
        title,
        assignee_id: body.assignee_id || null,
        assignee_name: body.assignee_name || null,
        assignee_kind: body.assignee_kind || 'developer',
        pct_of_milestone: pct,
        status,
        reference_url: body.reference_url || null,
        attachment_url: body.attachment_url || null,
        attachment_name: body.attachment_name || null,
        attachment_type: body.attachment_type || null,
        attachment_size: Number(body.attachment_size) || 0,
        created_at: now,
      }
      const tasksSnap = Array.isArray(milestone.tasks) ? milestone.tasks : []
      await models.milestones.updateById(id, { $set: { tasks: [...tasksSnap, ref], updated_at: now } })
      // Keep the persisted completion in sync (the new task may already be done).
      await recomputeMilestoneProgress(models, id)
      return res.status(201).json({ task: ref })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to add task' })
    }
  })

  // Remove a task from a milestone — deletes the real task and drops its ref.
  router.delete('/:id/tasks/:taskId', async (req, res) => {
    try {
      const user = req.user as any
      if (!(await userHasAnyPermission(models, user, 'milestones.edit'))) return res.status(403).json({ error: 'Forbidden' })
      const id = req.params.id
      const taskId = req.params.taskId
      const milestone = await models.milestones.findById(id) as any
      if (!milestone) return res.status(404).json({ error: 'Milestone not found' })
      await models.tasks.deleteById(taskId)
      const tasksSnap = (Array.isArray(milestone.tasks) ? milestone.tasks : []).filter((t: any) => String(t.id) !== String(taskId))
      await models.milestones.updateById(id, { $set: { tasks: tasksSnap, updated_at: new Date().toISOString() } })
      // Removing a done task lowers completion — keep the persisted value in sync.
      await recomputeMilestoneProgress(models, id)
      return res.json({ message: 'Task removed', id: taskId })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to remove task' })
    }
  })

  router.post('/:id/send-email', async (req, res) => {
    try {
      const user = req.user as any
      if (!(await userHasAnyPermission(models, user, 'milestones.edit'))) return res.status(403).json({ error: 'Forbidden' })
      const id = req.params.id
      const milestone = await models.milestones.findById(id) as any
      if (!milestone) return res.status(404).json({ error: 'Milestone not found' })
      if (await milestoneEffectivePct(models, milestone) < 100) {
        return res.status(400).json({ error: 'Milestone is not 100% complete yet' })
      }

      const project = milestone.project_id ? await models.projects.findById(String(milestone.project_id)) as any : null
      const client = project?.client_id ? await models.clients.findById(String(project.client_id)) as any : null

      const body = req.body || {}
      const to = parseEmailList(body.to || client?.email)
      const cc = parseEmailList(body.cc)
      if (!to.length) return res.status(400).json({ error: 'Client email is required' })

      const companyName = String(runtimeEnv.COMPANY_NAME || 'Mariox Software')
      const subject = String(body.subject || `Milestone Completed: ${milestone.title}`).trim()
      // Prefer the sender-edited body from the compose modal; fall back to the
      // auto-generated one (with LIVE task statuses) when none was provided.
      const innerHtml = (typeof body.inner_html === 'string' && body.inner_html.trim())
        ? String(body.inner_html)
        : await buildMilestoneEmailInner(models, milestone, project, client, companyName)
      const html = wrapMilestoneEmail(innerHtml)
      const text = `Milestone Completed: ${milestone.title}\nProject: ${project?.name || '—'}\nDue: ${milestone.due_date || '—'}\n\n${milestone.description || ''}`

      try {
        await sendInvoiceViaSmtp({ env: runtimeEnv, to, cc, subject, html, text, brandName: companyName })
      } catch (mailErr: any) {
        return res.status(500).json({ error: mailErr?.message || 'Failed to send milestone email' })
      }

      const now = new Date().toISOString()
      await models.milestones.updateById(id, { $set: { email_sent_at: now, email_sent_to: to.join(', '), updated_at: now } })

      try {
        await models.activityLogs.insertOne({
          id: generateId('al'),
          project_id: milestone.project_id || null,
          entity_type: 'milestone',
          entity_id: id,
          action: 'email_sent',
          actor_user_id: user?.sub || null,
          actor_name: user?.name || null,
          actor_role: user?.role || null,
          new_value: to.join(', '),
          created_at: now,
        })
      } catch {}

      return res.json({ success: true, email_sent_at: now, email_sent_to: to })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to send milestone email' })
    }
  })

  // Editable preview for the change-request quotation email.
  router.get('/:id/change-request-email-preview', async (req, res) => {
    try {
      const user = req.user as any
      if (!(await userHasAnyPermission(models, user, 'milestones.edit'))) return res.status(403).json({ error: 'Forbidden' })
      const milestone = await models.milestones.findById(req.params.id) as any
      if (!milestone) return res.status(404).json({ error: 'Milestone not found' })
      const project = milestone.project_id ? await models.projects.findById(String(milestone.project_id)) as any : null
      const client = project?.client_id ? await models.clients.findById(String(project.client_id)) as any : null
      const companyName = String(runtimeEnv.COMPANY_NAME || 'Mariox Software')
      return res.json({
        subject: `Change Request Quotation: ${milestone.title}`,
        to: client?.email || '',
        inner_html: buildChangeRequestEmailInner(milestone, project, client, companyName),
      })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to build preview' })
    }
  })

  // Send the change-request quotation to the client (editable body from the
  // compose modal, falling back to the auto-generated table). No 100%-complete
  // gate — CRs are raised mid-flight.
  router.post('/:id/send-change-request-email', async (req, res) => {
    try {
      const user = req.user as any
      if (!(await userHasAnyPermission(models, user, 'milestones.edit'))) return res.status(403).json({ error: 'Forbidden' })
      const id = req.params.id
      const milestone = await models.milestones.findById(id) as any
      if (!milestone) return res.status(404).json({ error: 'Milestone not found' })
      if (!Array.isArray(milestone.change_requests) || !milestone.change_requests.length) {
        return res.status(400).json({ error: 'No change requests to send' })
      }
      const project = milestone.project_id ? await models.projects.findById(String(milestone.project_id)) as any : null
      const client = project?.client_id ? await models.clients.findById(String(project.client_id)) as any : null

      const body = req.body || {}
      const to = parseEmailList(body.to || client?.email)
      const cc = parseEmailList(body.cc)
      if (!to.length) return res.status(400).json({ error: 'Client email is required' })

      const companyName = String(runtimeEnv.COMPANY_NAME || 'Mariox Software')
      const subject = String(body.subject || `Change Request Quotation: ${milestone.title}`).trim()
      const innerHtml = (typeof body.inner_html === 'string' && body.inner_html.trim())
        ? String(body.inner_html)
        : buildChangeRequestEmailInner(milestone, project, client, companyName)
      const html = wrapMilestoneEmail(innerHtml)
      const grand = milestone.change_requests.reduce((s: number, c: any) => s + (Number(c.total) || 0), 0)
      const text = `Change Request Quotation: ${milestone.title}\nProject: ${project?.name || '—'}\nGrand Total: ₹${Number(grand).toLocaleString('en-IN')}`

      try {
        await sendInvoiceViaSmtp({ env: runtimeEnv, to, cc, subject, html, text, brandName: companyName })
      } catch (mailErr: any) {
        return res.status(500).json({ error: mailErr?.message || 'Failed to send change-request email' })
      }

      const now = new Date().toISOString()
      await models.milestones.updateById(id, { $set: { cr_email_sent_at: now, cr_email_sent_to: to.join(', '), updated_at: now } })
      try {
        await models.activityLogs.insertOne({
          id: generateId('al'),
          project_id: milestone.project_id || null,
          entity_type: 'milestone',
          entity_id: id,
          action: 'change_request_email_sent',
          actor_user_id: user?.sub || null,
          actor_name: user?.name || null,
          actor_role: user?.role || null,
          new_value: to.join(', '),
          created_at: now,
        })
      } catch {}

      return res.json({ success: true, cr_email_sent_at: now, cr_email_sent_to: to })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to send change-request email' })
    }
  })

  router.post('/:id/rate', async (req, res) => {
    try {
      const user = req.user as any
      // Only the client owning the milestone's project can rate it. Staff
      // can read but not author the rating.
      if (String(user?.role || '').toLowerCase() !== 'client') {
        return res.status(403).json({ error: 'Only the client can rate a milestone' })
      }
      const id = req.params.id
      const milestone = await models.milestones.findById(id) as any
      if (!milestone) return res.status(404).json({ error: 'Milestone not found' })
      // Verify the rating client actually owns the project this milestone is on.
      if (milestone.project_id) {
        const project = await models.projects.findById(String(milestone.project_id)) as any
        if (!project || String(project.client_id) !== String(user.sub)) {
          return res.status(403).json({ error: 'This milestone is not on your project' })
        }
      }
      const isComplete = Number(milestone.completion_pct) >= 100 || milestone.status === 'completed'
      if (!isComplete) {
        return res.status(400).json({ error: 'Rating is available only after milestone is 100% complete' })
      }
      const rating = normalizeRating(req.body || {})
      if (!rating || rating.overall === 0) return res.status(400).json({ error: 'Provide at least one rating between 1 and 10' })
      if (!rating.rated_by) {
        rating.rated_by = user?.name || user?.email || null
      }
      const now = new Date().toISOString()
      await models.milestones.updateById(id, { $set: { rating, updated_at: now } })
      const updated = await models.milestones.findById(id)
      return res.json({ milestone: updated })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to save rating' })
    }
  })

  return router
}
