import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, userHasAnyPermission } from '../express-middleware/auth'
import { DEFAULT_KANBAN_COLUMNS } from '../constants'
import { generateId } from '../utils/helpers'
import { createUserNotifications } from './notifications'
import { isElasticEnabled, deleteDoc as esDeleteDoc } from '../utils/elastic'
import { moveToTrash } from './trash'
import {
  validateName,
  validateLength,
  validateEnum,
  validateOptional,
  validateISODate,
  validatePositiveNumber,
  respondWithError,
} from '../validators'

const PROJECT_TYPES = ['development', 'maintenance', 'support', 'consulting'] as const
const PROJECT_STATUSES = ['active', 'on_hold', 'completed', 'archived', 'cancelled'] as const
const PROJECT_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const
const ASSIGNMENT_TYPES = ['in_house', 'external'] as const
const ASSIGNEE_TYPES = ['team', 'user'] as const
const DELIVERY_KINDS = ['app', 'web', 'both'] as const
const PROJECT_CODE_PATTERN = /^[A-Za-z0-9_-]{2,40}$/

function sum(items: any[], pick: (item: any) => number) {
  return items.reduce((acc, item) => acc + pick(item), 0)
}

function daysBetween(from: string, to: string) {
  if (!from || !to) return 0
  return (new Date(to).getTime() - new Date(from).getTime()) / (1000 * 60 * 60 * 24)
}

// Auto-calculated delivery progress: share of top-level tasks that are done.
// Subtasks are excluded so a parent with many subtasks doesn't skew the bar.
async function computeTaskProgressByProject(models: MongoModels): Promise<Map<string, number>> {
  const rows = await models.tasks.aggregate<{ _id: string; total: number; done: number }>([
    { $match: { $or: [{ parent_task_id: null }, { parent_task_id: { $exists: false } }] } },
    {
      $group: {
        _id: '$project_id',
        total: { $sum: 1 },
        done: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } },
      },
    },
  ])
  const map = new Map<string, number>()
  for (const r of rows) {
    map.set(String(r._id), r.total > 0 ? Math.round((r.done / r.total) * 100) : 0)
  }
  return map
}

function computeProjectMetrics(project: any) {
  const start = String(project.start_date || '')
  const end = String(project.expected_end_date || '')
  const totalDays = daysBetween(start, end)
  const elapsedDays = daysBetween(start, new Date().toISOString().slice(0, 10))
  const remainingDays = daysBetween(new Date().toISOString().slice(0, 10), end)
  const timelineProgress = totalDays > 0 ? Math.round((elapsedDays / totalDays) * 1000) / 10 : 0
  const daysRemainingPct = totalDays > 0 ? Math.round((remainingDays / totalDays) * 1000) / 10 : 0
  return { timeline_progress: timelineProgress, days_remaining_pct: daysRemainingPct }
}

// Strip commercial fields (sold_by, project_amount) from the payload unless
// the requesting role is admin or appears in the project's commercial_visible_to list.
function applyCommercialVisibility<T extends Record<string, any>>(project: T, role: string): T {
  if (role === 'admin') return project
  const allowed = Array.isArray(project.commercial_visible_to) ? project.commercial_visible_to : []
  if (allowed.map((r: any) => String(r).toLowerCase()).includes(role)) return project
  const { sold_by, project_amount, commercial_visible_to, ...rest } = project as any
  return rest as T
}

export function isProjectLinkedToUser(project: any, user: any, assignments: any[]) {
  const userId = String(user?.sub || '')
  if (!userId) return false
  return assignments.some((a) => String(a.user_id || '') === userId) ||
    String(project.pm_id || '') === userId ||
    String(project.pc_id || '') === userId ||
    String(project.team_lead_id || '') === userId ||
    String(project.external_team_id || '') === userId ||
    String(project.awarded_to_user_id || '') === userId
}

export function createProjectsRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  router.get('/', async (req, res) => {
    try {
      const user = req.user as any
      const role = String(user?.role || '').toLowerCase()
      const canViewAll = await userHasAnyPermission(models, user, 'projects.view_all')
      const status = typeof req.query.status === 'string' ? req.query.status : undefined
      const pmId = typeof req.query.pm_id === 'string' ? req.query.pm_id : undefined
      const filter: any = {}
      // Hide archived projects from the default list (legacy soft-deletes);
      // still reachable explicitly via ?status=archived.
      if (status) filter.status = status
      else filter.status = { $ne: 'archived' }
      if (pmId) filter.pm_id = pmId

      const [projects, users, assignments, taskProgressByProject] = await Promise.all([
        models.projects.find(filter) as Promise<any[]>,
        models.users.find({}) as Promise<any[]>,
        models.projectAssignments.find({ is_active: 1 }) as Promise<any[]>,
        computeTaskProgressByProject(models),
      ])

      const usersById = new Map(users.map((u) => [String(u.id), u]))
      const assignmentsByProject = new Map<string, any[]>()
      for (const a of assignments) {
        const key = String(a.project_id)
        const list = assignmentsByProject.get(key) || []
        list.push(a)
        assignmentsByProject.set(key, list)
      }

      // Role-scope: users without projects.view_all only see projects they are
      // directly linked to (assignment, PM/PC/lead, or external ownership).
      const myAssignmentProjectIds = new Set(
        assignments.filter((a) => String(a.user_id) === String(user?.sub)).map((a) => String(a.project_id)),
      )
      const visibleProjects = canViewAll ? projects : projects.filter((p) => {
        if (role === 'team') {
          return p.external_team_id === user?.sub || p.awarded_to_user_id === user?.sub
        }
        if (role === 'developer') {
          // Developers see projects they're assigned to + ones they're PM/PC/lead on (rare).
          if (myAssignmentProjectIds.has(String(p.id))) return true
          if (p.pm_id === user?.sub || p.pc_id === user?.sub || p.team_lead_id === user?.sub) return true
          return false
        }
        return isProjectLinkedToUser(p, user, assignments)
      })

      const enriched = visibleProjects.map((p) => {
        const tl = usersById.get(String(p.team_lead_id)) as any
        const pm = usersById.get(String(p.pm_id)) as any
        const pc = usersById.get(String(p.pc_id)) as any
        const devs = assignmentsByProject.get(String(p.id)) || []
        const base = applyCommercialVisibility(p, role)
        return {
          ...base,
          team_lead_name: tl?.full_name || null,
          pm_name: pm?.full_name || null,
          pc_name: pc?.full_name || null,
          developer_count: devs.length,
          task_progress: taskProgressByProject.get(String(p.id)) || 0,
          ...computeProjectMetrics(p),
        }
      }).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))

      return res.json({
        projects: enriched,
        data: { projects: enriched, data: enriched },
      })
    } catch (error: any) {
      // Don't swallow the error as an empty list — the UI then renders a
      // misleading "no projects" empty state for what is actually a 500.
      // Surface the real status so the frontend can show a retry / error UI.
      console.error('[projects] list failed:', error)
      return respondWithError(res, error, 500)
    }
  })

  // Suggest the next sequential project code for a given delivery kind. Format:
  //   {PREFIX}{YYYY}{MM}-{seq}, sequence starting at 1101 and incrementing per
  //   prefix + month. Examples (June 2026):
  //   app  → APP202606-1101  (then -1102, -1103, …)
  //   web  → WB202606-1101
  //   both → BTH202606-1101
  // IMPORTANT: must be registered BEFORE `/:id` so Express doesn't match
  // "next-code" as a project id and 404 with "Project not found".
  router.get('/next-code', async (req, res) => {
    try {
      const kind = String(req.query.kind || '').toLowerCase()
      const prefix = kind === 'app' ? 'APP' : kind === 'web' ? 'WB' : kind === 'both' ? 'BTH' : null
      if (!prefix) return res.status(400).json({ error: 'kind must be one of: app, web, both' })
      const now = new Date()
      const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
      const base = `${prefix}${ym}-`
      const projects = await models.projects.find({}) as any[]
      // Sequence starts at 1101; find the highest used this month for this
      // prefix and add one.
      let max = 1100
      const re = new RegExp('^' + prefix + ym + '-(\\d+)$', 'i')
      for (const p of projects) {
        const m = re.exec(String(p.code || ''))
        if (m) {
          const n = parseInt(m[1], 10)
          if (Number.isFinite(n) && n > max) max = n
        }
      }
      const next = max + 1
      return res.json({ code: `${base}${next}`, prefix })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.get('/:id', async (req, res) => {
    try {
      const user = req.user as any
      const role = String(user?.role || '').toLowerCase()
      const canViewAll = await userHasAnyPermission(models, user, 'projects.view_all')
      const id = req.params.id
      const project = await models.projects.findById(id) as any
      if (!project) return res.status(404).json({ error: 'Project not found' })

      const [users, assignments, timesheets, projectTasks] = await Promise.all([
        models.users.find({}) as Promise<any[]>,
        models.projectAssignments.find({ project_id: id, is_active: 1 }) as Promise<any[]>,
        models.timesheets.find({ project_id: id }) as Promise<any[]>,
        models.tasks.find({ project_id: id }) as Promise<any[]>,
      ])
      // Auto delivery progress = done / total of top-level tasks.
      const topTasks = projectTasks.filter((t: any) => !t.parent_task_id)
      const doneTasks = topTasks.filter((t: any) => t.status === 'done').length
      const taskProgress = topTasks.length ? Math.round((doneTasks / topTasks.length) * 100) : 0

      // Same scope as the list endpoint: users without projects.view_all can
      // only open projects they are linked to.
      if (!canViewAll && !isProjectLinkedToUser(project, user, assignments)) {
        return res.status(403).json({ error: 'You do not have access to this project' })
      }
      const usersById = new Map(users.map((u) => [String(u.id), u]))
      const loggedByUser = new Map<string, number>()
      for (const t of timesheets) {
        if (t.approval_status === 'rejected') continue
        const key = String(t.user_id)
        loggedByUser.set(key, (loggedByUser.get(key) || 0) + Number(t.hours_consumed || 0))
      }

      const enrichedAssignments = assignments.map((a) => {
        const u = usersById.get(String(a.user_id)) as any
        return {
          ...a,
          full_name: u?.full_name || null,
          email: u?.email || null,
          designation: u?.designation || null,
          avatar_color: u?.avatar_color || null,
          logged_hours: loggedByUser.get(String(a.user_id)) || 0,
        }
      })

      const recentLogs = [...timesheets]
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
        .slice(0, 20)
        .map((t) => ({
          ...t,
          full_name: usersById.get(String(t.user_id))?.full_name || null,
          avatar_color: usersById.get(String(t.user_id))?.avatar_color || null,
        }))

      const monthMap = new Map<string, number>()
      for (const t of timesheets) {
        if (t.approval_status === 'rejected') continue
        const key = String(t.date || '').slice(0, 7)
        if (!key) continue
        monthMap.set(key, (monthMap.get(key) || 0) + Number(t.hours_consumed || 0))
      }
      const monthlyBurn = [...monthMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, hours]) => ({ month, hours }))

      const tl = usersById.get(String(project.team_lead_id))
      const pm = usersById.get(String(project.pm_id))
      const pc = usersById.get(String(project.pc_id))

      const scopedProject = applyCommercialVisibility(project, role)
      const data = {
        ...scopedProject,
        team_lead_name: (tl as any)?.full_name || null,
        pm_name: (pm as any)?.full_name || null,
        pc_name: (pc as any)?.full_name || null,
        task_progress: taskProgress,
        ...computeProjectMetrics(project),
        assignments: enrichedAssignments,
        recent_logs: recentLogs,
        monthly_burn: monthlyBurn,
        notes: [],
      }

      return res.json({ data, project: data })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load project' })
    }
  })

  router.get('/:id/developers', async (req, res) => {
    try {
      const id = req.params.id
      const user = req.user as any
      const project = await models.projects.findById(id) as any
      if (!project) return res.status(404).json({ error: 'Project not found' })
      const assignmentsForScope = await models.projectAssignments.find({ project_id: id, is_active: 1 }) as any[]
      if (!(await userHasAnyPermission(models, user, 'projects.view_all')) && !isProjectLinkedToUser(project, user, assignmentsForScope)) {
        return res.status(403).json({ error: 'You do not have access to this project' })
      }
      const [assignments, users] = await Promise.all([
        models.projectAssignments.find({ project_id: id, is_active: 1 }) as Promise<any[]>,
        models.users.find({}) as Promise<any[]>,
      ])
      const usersById = new Map(users.map((u) => [String(u.id), u]))
      const developers = assignments
        .map((a) => {
          const u = usersById.get(String(a.user_id)) as any
          if (!u) return null
          return {
            ...a,
            full_name: u.full_name,
            email: u.email,
            designation: u.designation,
            avatar_color: u.avatar_color,
            user_role: u.role,
          }
        })
        .filter(Boolean)
        .sort((a: any, b: any) => String(a.full_name || '').localeCompare(String(b.full_name || '')))
      return res.json({ developers, data: developers })
    } catch {
      return res.json({ developers: [], data: [] })
    }
  })

  router.post('/', async (req, res) => {
    try {
      const user = req.user as any
      if (!(await userHasAnyPermission(models, user, 'projects.create'))) {
        return res.status(403).json({ error: 'Forbidden: Insufficient permissions' })
      }
      const body = req.body || {}
      const name = validateName(body.name, 'Project name', 2, 120)
      const code = validateLength(String(body.code || '').trim(), 2, 40, 'Project code')
      if (!PROJECT_CODE_PATTERN.test(code)) {
        return res.status(400).json({ error: 'Project code may only contain letters, numbers, underscore or hyphen' })
      }
      const projectType = validateEnum(body.project_type || 'development', PROJECT_TYPES, 'Project type')
      const deliveryKind = body.delivery_kind
        ? validateEnum(body.delivery_kind, DELIVERY_KINDS, 'Delivery kind')
        : null
      const status = validateEnum(body.status || 'active', PROJECT_STATUSES, 'Status')
      const priority = validateEnum(body.priority || 'medium', PROJECT_PRIORITIES, 'Priority')
      const startDate = validateISODate(body.start_date, 'Start date')
      const endDate = validateOptional(body.expected_end_date, (v) => validateISODate(v, 'End date'))
      if (endDate && startDate > endDate) {
        return res.status(400).json({ error: 'End date must be after start date' })
      }
      const assignmentType = validateEnum(body.assignment_type || 'in_house', ASSIGNMENT_TYPES, 'Assignment type')
      const externalAssigneeType = assignmentType === 'external'
        ? validateEnum(body.external_assignee_type || 'team', ASSIGNEE_TYPES, 'External assignee type')
        : null
      if (assignmentType === 'external' && !body.external_team_id) {
        return res.status(400).json({ error: 'External team is required when assignment type is external' })
      }
      const totalAllocatedHours = body.total_allocated_hours !== undefined
        ? validatePositiveNumber(body.total_allocated_hours, 'Total allocated hours')
        : 0
      const estimatedBudgetHours = body.estimated_budget_hours !== undefined
        ? validatePositiveNumber(body.estimated_budget_hours, 'Estimated budget hours')
        : 0
      const revenue = body.revenue !== undefined ? validatePositiveNumber(body.revenue, 'Revenue') : 0
      const projectAmount = body.project_amount !== undefined && body.project_amount !== null && body.project_amount !== ''
        ? validatePositiveNumber(body.project_amount, 'Project amount')
        : null
      const soldBy = body.sold_by ? validateLength(String(body.sold_by).trim(), 1, 200, 'Sold by') : null
      const commercialVisibleTo = Array.isArray(body.commercial_visible_to)
        ? body.commercial_visible_to.map((r: any) => String(r).trim().toLowerCase()).filter(Boolean)
        : []

      // PM / PC are admin-only fields. Non-admin creators get null and a
      // notification is queued to every admin so someone takes ownership of
      // the assignment.
      const creatorRole = String(user?.role || '').toLowerCase()
      const isAdminCreator = creatorRole === 'admin'
      const pmId = isAdminCreator && body.pm_id ? String(body.pm_id) : null
      const pcId = isAdminCreator && body.pc_id ? String(body.pc_id) : null

      const id = generateId('proj')
      const now = new Date().toISOString()
      const project = {
        id,
        name,
        code,
        client_name: body.client_name || null,
        client_id: body.client_id || null,
        description: body.description ? validateLength(String(body.description), 0, 5000, 'Description') : null,
        project_type: projectType,
        delivery_kind: deliveryKind,
        start_date: startDate,
        expected_end_date: endDate,
        priority,
        status,
        total_allocated_hours: totalAllocatedHours,
        estimated_budget_hours: estimatedBudgetHours,
        team_lead_id: body.team_lead_id || null,
        pm_id: pmId,
        pc_id: pcId,
        assignment_type: assignmentType,
        external_team_id: assignmentType === 'external' ? (body.external_team_id || null) : null,
        external_assignee_type: assignmentType === 'external' ? externalAssigneeType : null,
        billable: body.billable !== undefined ? (body.billable ? 1 : 0) : 1,
        revenue,
        sold_by: soldBy,
        project_amount: projectAmount,
        commercial_visible_to: commercialVisibleTo,
        remarks: body.remarks ? validateLength(String(body.remarks), 0, 2000, 'Remarks') : null,
        consumed_hours: 0,
        // Set when this project was auto-created from an awarded bid auction.
        source_bid_id: body.source_bid_id || null,
        created_at: now,
        updated_at: now,
      }
      await models.projects.insertOne(project)

      // If a non-admin created the project, PM/PC were dropped above. Notify
      // every admin so someone takes ownership of the assignment.
      if (!isAdminCreator && (!pmId || !pcId)) {
        try {
          const admins = await models.users.find({ role: 'admin' }) as any[]
          const adminIds = admins
            .filter((u: any) => Number(u.is_active ?? 1) === 1)
            .map((u: any) => String(u.id))
          const missing = [!pmId ? 'PM' : null, !pcId ? 'PC' : null].filter(Boolean).join(' & ')
          await createUserNotifications(models, adminIds, {
            type: 'project_assignment_needed',
            title: `Assign ${missing} for "${name}"`,
            body: `${user?.name || user?.full_name || 'A user'} created project ${code}. Please assign ${missing}.`,
            link: `project:${id}`,
            actor_id: user?.sub || null,
            actor_name: user?.name || user?.full_name || null,
            meta: {
              project_id: id,
              project_code: code,
              missing_pm: !pmId,
              missing_pc: !pcId,
            },
          })
        } catch (notifyErr) {
          console.warn('[projects] admin PM/PC notification failed:', notifyErr)
        }
      }

      // Persist any attachments uploaded with the project as project documents
      // so they appear in Documents Center filtered by this project.
      const attachments = Array.isArray(body.attachments) ? body.attachments : []
      if (attachments.length) {
        try {
          await models.documents.insertMany(attachments
            .filter((a: any) => a && a.file_url)
            .slice(0, 20)
            .map((a: any) => ({
              id: generateId('doc'),
              project_id: id,
              client_id: body.client_id || null,
              title: `${name} — ${String(a.file_name || 'attachment').slice(0, 180)}`,
              description: 'Attached on project creation',
              category: 'other',
              file_name: String(a.file_name || 'file').slice(0, 255),
              file_url: String(a.file_url),
              file_size: Number(a.file_size) || 0,
              file_type: a.file_type ? String(a.file_type).slice(0, 120) : null,
              version: '1.0',
              uploaded_by: (req.user as any)?.sub || null,
              uploaded_by_role: String((req.user as any)?.role || 'staff').toLowerCase(),
              visibility: 'all',
              is_client_visible: 1,
              tags: null,
              download_count: 0,
              created_at: now,
              updated_at: now,
            })))
        } catch (e) {
          console.warn('[projects] failed to persist attachments:', e)
        }
      }

      await models.kanbanPermissions.insertMany([
        { id: generateId('kp'), project_id: id, role: 'admin', can_view: 1, can_create_task: 1, can_edit_any_task: 1, can_edit_own_task: 1, can_move_task: 1, can_delete_task: 1, can_manage_columns: 1, can_comment: 1 },
        { id: generateId('kp'), project_id: id, role: 'pm', can_view: 1, can_create_task: 1, can_edit_any_task: 1, can_edit_own_task: 1, can_move_task: 1, can_delete_task: 1, can_manage_columns: 1, can_comment: 1 },
        { id: generateId('kp'), project_id: id, role: 'pc', can_view: 1, can_create_task: 1, can_edit_any_task: 1, can_edit_own_task: 1, can_move_task: 1, can_delete_task: 0, can_manage_columns: 0, can_comment: 1 },
        { id: generateId('kp'), project_id: id, role: 'developer', can_view: 1, can_create_task: 1, can_edit_any_task: 0, can_edit_own_task: 1, can_move_task: 1, can_delete_task: 0, can_manage_columns: 0, can_comment: 1 },
        { id: generateId('kp'), project_id: id, role: 'team', can_view: 1, can_create_task: 1, can_edit_any_task: 0, can_edit_own_task: 1, can_move_task: 1, can_delete_task: 0, can_manage_columns: 0, can_comment: 1 },
        { id: generateId('kp'), project_id: id, role: 'client', can_view: 1, can_create_task: 0, can_edit_any_task: 0, can_edit_own_task: 0, can_move_task: 0, can_delete_task: 0, can_manage_columns: 0, can_comment: 1 },
      ])

      await models.kanbanColumns.insertMany(DEFAULT_KANBAN_COLUMNS.map((col) => ({
        id: generateId('kc'),
        project_id: id,
        name: col.name,
        status_key: col.status_key,
        color: col.color,
        position: col.position,
        wip_limit: col.wip_limit,
        is_done_column: col.is_done_column,
      })))

      return res.status(201).json({ data: { id }, project, message: 'Project created successfully' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // Bulk import projects from CSV.
  // Required columns: name, code, start_date.
  // Optional columns: client_email (resolves to client_id), description,
  // project_type, status, priority, expected_end_date, total_allocated_hours,
  // estimated_budget_hours, revenue, billable, assignment_type,
  // pm_email, pc_email, team_lead_email, external_team_email, external_assignee_type,
  // remarks.
  router.get('/import/template.csv', (_req, res) => {
    const sample = [
      'name,code,client_email,description,project_type,priority,status,start_date,expected_end_date,total_allocated_hours,estimated_budget_hours,revenue,billable,assignment_type,external_team_email,external_assignee_type,pm_email,pc_email,team_lead_email,remarks',
      'Acme Website Rebuild,ACME-WEB,anita@acme.com,Full marketing-site redesign,development,high,active,2026-05-01,2026-08-30,400,420,500000,1,in_house,,,priya@example.com,,rahul@example.com,Phase 1 only',
      'Globex Mobile App,GLOBEX-APP,karthik@globex.com,iOS + Android client app,development,medium,active,2026-06-15,2026-12-31,800,820,1200000,1,external,vendor-team@example.com,user,priya@example.com,,,Vendor delivery',
    ].join('\n')
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', 'attachment; filename="projects_import_template.csv"')
    return res.send(sample)
  })

  router.post('/import', async (req, res) => {
    try {
      const user = req.user as any
      if (!(await userHasAnyPermission(models, user, 'projects.create'))) {
        return res.status(403).json({ error: 'Forbidden: Insufficient permissions' })
      }
      const csvText = String(req.body?.csv || '').trim()
      if (!csvText) return res.status(400).json({ error: 'csv is required' })
      const rows = parseCsv(csvText)
      if (rows.length < 2) return res.status(400).json({ error: 'CSV must contain header + data rows' })

      const headers = rows[0].map((h) => String(h || '').trim().toLowerCase())
      for (const required of ['name', 'code', 'start_date']) {
        if (!headers.includes(required)) {
          return res.status(400).json({ error: `Missing required column: ${required}` })
        }
      }

      const [allClients, allUsers] = await Promise.all([
        models.clients.find({}) as Promise<any[]>,
        models.users.find({}) as Promise<any[]>,
      ])
      const clientByEmail = new Map(allClients.map((c) => [String(c.email || '').toLowerCase(), c]))
      const userByEmail = new Map(allUsers.map((u) => [String(u.email || '').toLowerCase(), u]))

      const created: any[] = []
      const errors: { row: number; code?: string; error: string }[] = []
      const now = new Date().toISOString()

      for (let i = 1; i < rows.length; i++) {
        const cells = rows[i]
        if (!cells || cells.every((c) => !c?.trim())) continue
        const record: Record<string, string> = {}
        headers.forEach((h, idx) => { record[h] = String(cells[idx] || '').trim() })

        try {
          const name = validateName(record.name, 'Project name', 2, 120)
          const code = validateLength(record.code, 2, 40, 'Project code')
          if (!PROJECT_CODE_PATTERN.test(code)) {
            errors.push({ row: i + 1, code, error: 'Code may only contain letters, numbers, _ or -' })
            continue
          }
          const dup = await models.projects.findOne({ code }) as any
          if (dup) {
            errors.push({ row: i + 1, code, error: 'Project code already exists' })
            continue
          }

          const projectType = validateEnum(record.project_type || 'development', PROJECT_TYPES, 'Project type')
          const status = validateEnum(record.status || 'active', PROJECT_STATUSES, 'Status')
          const priority = validateEnum(record.priority || 'medium', PROJECT_PRIORITIES, 'Priority')
          const startDate = validateISODate(record.start_date, 'Start date')
          const endDate = record.expected_end_date
            ? validateISODate(record.expected_end_date, 'End date')
            : null
          if (endDate && startDate > endDate) {
            errors.push({ row: i + 1, code, error: 'End date must be after start date' })
            continue
          }

          const assignmentType = validateEnum(record.assignment_type || 'in_house', ASSIGNMENT_TYPES, 'Assignment type')
          let externalTeamId: string | null = null
          let externalAssigneeType: string | null = null
          if (assignmentType === 'external') {
            const extEmail = (record.external_team_email || '').toLowerCase()
            const extUser = extEmail ? userByEmail.get(extEmail) : null
            if (!extUser) {
              errors.push({ row: i + 1, code, error: 'external_team_email did not resolve to a user' })
              continue
            }
            externalTeamId = String(extUser.id)
            externalAssigneeType = validateEnum(record.external_assignee_type || 'team', ASSIGNEE_TYPES, 'External assignee type')
          }

          const totalAllocated = record.total_allocated_hours
            ? validatePositiveNumber(record.total_allocated_hours, 'Total allocated hours')
            : 0
          const estimatedBudget = record.estimated_budget_hours
            ? validatePositiveNumber(record.estimated_budget_hours, 'Estimated budget hours')
            : 0
          const revenue = record.revenue ? validatePositiveNumber(record.revenue, 'Revenue') : 0

          const clientEmail = (record.client_email || '').toLowerCase()
          const client = clientEmail ? clientByEmail.get(clientEmail) : null
          const pm = record.pm_email ? userByEmail.get(record.pm_email.toLowerCase()) : null
          const pc = record.pc_email ? userByEmail.get(record.pc_email.toLowerCase()) : null
          const teamLead = record.team_lead_email ? userByEmail.get(record.team_lead_email.toLowerCase()) : null

          const id = generateId('proj')
          const project = {
            id,
            name,
            code,
            client_id: client?.id || null,
            client_name: client?.company_name || null,
            description: record.description ? String(record.description).slice(0, 5000) : null,
            project_type: projectType,
            start_date: startDate,
            expected_end_date: endDate,
            priority,
            status,
            total_allocated_hours: totalAllocated,
            estimated_budget_hours: estimatedBudget,
            team_lead_id: teamLead?.id || null,
            pm_id: pm?.id || null,
            pc_id: pc?.id || null,
            assignment_type: assignmentType,
            external_team_id: externalTeamId,
            external_assignee_type: externalAssigneeType,
            billable: record.billable === '0' || record.billable?.toLowerCase() === 'false' ? 0 : 1,
            revenue,
            remarks: record.remarks ? String(record.remarks).slice(0, 2000) : null,
            consumed_hours: 0,
            source_bid_id: null,
            created_at: now,
            updated_at: now,
          }
          await models.projects.insertOne(project)

          await models.kanbanPermissions.insertMany([
            { id: generateId('kp'), project_id: id, role: 'admin', can_view: 1, can_create_task: 1, can_edit_any_task: 1, can_edit_own_task: 1, can_move_task: 1, can_delete_task: 1, can_manage_columns: 1, can_comment: 1 },
            { id: generateId('kp'), project_id: id, role: 'pm', can_view: 1, can_create_task: 1, can_edit_any_task: 1, can_edit_own_task: 1, can_move_task: 1, can_delete_task: 1, can_manage_columns: 1, can_comment: 1 },
            { id: generateId('kp'), project_id: id, role: 'pc', can_view: 1, can_create_task: 1, can_edit_any_task: 1, can_edit_own_task: 1, can_move_task: 1, can_delete_task: 0, can_manage_columns: 0, can_comment: 1 },
            { id: generateId('kp'), project_id: id, role: 'developer', can_view: 1, can_create_task: 1, can_edit_any_task: 0, can_edit_own_task: 1, can_move_task: 1, can_delete_task: 0, can_manage_columns: 0, can_comment: 1 },
            { id: generateId('kp'), project_id: id, role: 'team', can_view: 1, can_create_task: 1, can_edit_any_task: 0, can_edit_own_task: 1, can_move_task: 1, can_delete_task: 0, can_manage_columns: 0, can_comment: 1 },
            { id: generateId('kp'), project_id: id, role: 'client', can_view: 1, can_create_task: 0, can_edit_any_task: 0, can_edit_own_task: 0, can_move_task: 0, can_delete_task: 0, can_manage_columns: 0, can_comment: 1 },
          ])
          await models.kanbanColumns.insertMany(DEFAULT_KANBAN_COLUMNS.map((col) => ({
            id: generateId('kc'),
            project_id: id,
            name: col.name,
            status_key: col.status_key,
            color: col.color,
            position: col.position,
            wip_limit: col.wip_limit,
            is_done_column: col.is_done_column,
          })))

          created.push({ id, name, code })
        } catch (e: any) {
          errors.push({ row: i + 1, code: record.code, error: e?.message || 'Failed' })
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

  router.put('/:id', async (req, res) => {
    try {
      const user = req.user as any
      const id = String(req.params.id)
      const project = await models.projects.findById(id) as any
      if (!project) return res.status(404).json({ error: 'Project not found' })
      // Permission gate (corrected order): admin always; users with the
      // explicit `projects.edit` grant; OR anyone directly linked to this
      // project (PM / PC / TL / external owner / assigned dev). Previously
      // the global `projects.edit` check ran first and locked out PMs whose
      // role had the permission revoked but who still owned their own
      // project.
      const role = String(user?.role || '').toLowerCase()
      const assignments = await models.projectAssignments.find({ project_id: id, is_active: 1 }) as any[]
      const hasGlobalEdit = role === 'admin'
        || await userHasAnyPermission(models, user, 'projects.edit')
      const isLinked = isProjectLinkedToUser(project, user, assignments)
      if (!hasGlobalEdit && !isLinked) {
        return res.status(403).json({ error: 'You do not have access to edit this project' })
      }
      const body = req.body || {}
      const name = validateName(body.name, 'Project name', 2, 120)
      const projectType = validateEnum(body.project_type || 'development', PROJECT_TYPES, 'Project type')
      const deliveryKind = body.delivery_kind
        ? validateEnum(body.delivery_kind, DELIVERY_KINDS, 'Delivery kind')
        : null
      const status = validateEnum(body.status || 'active', PROJECT_STATUSES, 'Status')
      const priority = validateEnum(body.priority || 'medium', PROJECT_PRIORITIES, 'Priority')
      const startDate = validateISODate(body.start_date, 'Start date')
      const endDate = validateOptional(body.expected_end_date, (v) => validateISODate(v, 'End date'))
      if (endDate && startDate > endDate) {
        return res.status(400).json({ error: 'End date must be after start date' })
      }
      const assignmentType = validateEnum(body.assignment_type || 'in_house', ASSIGNMENT_TYPES, 'Assignment type')
      const externalAssigneeType = assignmentType === 'external'
        ? validateEnum(body.external_assignee_type || 'team', ASSIGNEE_TYPES, 'External assignee type')
        : null
      if (assignmentType === 'external' && !body.external_team_id) {
        return res.status(400).json({ error: 'External team is required when assignment type is external' })
      }
      const totalAllocatedHours = body.total_allocated_hours !== undefined
        ? validatePositiveNumber(body.total_allocated_hours, 'Total allocated hours')
        : 0
      const estimatedBudgetHours = body.estimated_budget_hours !== undefined
        ? validatePositiveNumber(body.estimated_budget_hours, 'Estimated budget hours')
        : 0
      const revenue = body.revenue !== undefined ? validatePositiveNumber(body.revenue, 'Revenue') : 0
      const projectAmount = body.project_amount !== undefined && body.project_amount !== null && body.project_amount !== ''
        ? validatePositiveNumber(body.project_amount, 'Project amount')
        : null
      const soldBy = body.sold_by ? validateLength(String(body.sold_by).trim(), 1, 200, 'Sold by') : null
      const commercialVisibleTo = Array.isArray(body.commercial_visible_to)
        ? body.commercial_visible_to.map((r: any) => String(r).trim().toLowerCase()).filter(Boolean)
        : []

      // (Permission already checked at the top of the handler — `assignments`
      // + `isLinked` carry the result here so we don't re-query.)

      const $set: any = {
        name,
        client_name: body.client_name || null,
        client_id: body.client_id || null,
        description: body.description ? validateLength(String(body.description), 0, 5000, 'Description') : null,
        project_type: projectType,
        delivery_kind: deliveryKind,
        start_date: startDate,
        expected_end_date: endDate,
        priority,
        status,
        total_allocated_hours: totalAllocatedHours,
        estimated_budget_hours: estimatedBudgetHours,
        team_lead_id: body.team_lead_id || null,
        // PM / PC are admin-only. For non-admins keep whatever was already on
        // the project — they have no UI to change it and the request body
        // wouldn't include the field anyway.
        pm_id: String(user?.role || '').toLowerCase() === 'admin'
          ? (body.pm_id || null)
          : (project.pm_id || null),
        pc_id: String(user?.role || '').toLowerCase() === 'admin'
          ? (body.pc_id || null)
          : (project.pc_id || null),
        assignment_type: assignmentType,
        external_team_id: assignmentType === 'external' ? (body.external_team_id || null) : null,
        external_assignee_type: assignmentType === 'external' ? externalAssigneeType : null,
        // Preserve the existing billable flag when the request omits it. The
        // old `body.billable ? 1 : 0` defaulted to 0 on every PUT that didn't
        // explicitly set it — quietly flipping projects out of "billable" the
        // moment anyone edited any other field.
        billable: 'billable' in body
          ? (body.billable ? 1 : 0)
          : (project.billable ?? 1),
        revenue,
        sold_by: soldBy,
        project_amount: projectAmount,
        commercial_visible_to: commercialVisibleTo,
        remarks: body.remarks ? validateLength(String(body.remarks), 0, 2000, 'Remarks') : null,
        updated_at: new Date().toISOString(),
      }
      await models.projects.updateById(id, { $set })

      // Audit log + notify project audience whenever something visible changes.
      // Diff against the pre-edit `project` snapshot so we only log fields
      // that actually moved — avoids spamming the audit trail on no-op saves.
      try {
        const TRACKED_FIELDS: Array<[string, string]> = [
          ['name', 'Name'],
          ['client_id', 'Client'],
          ['status', 'Status'],
          ['priority', 'Priority'],
          ['project_type', 'Project type'],
          ['delivery_kind', 'Delivery kind'],
          ['start_date', 'Start date'],
          ['expected_end_date', 'End date'],
          ['pm_id', 'Project Manager'],
          ['pc_id', 'Product Coordinator'],
          ['team_lead_id', 'Team Lead'],
          ['assignment_type', 'Assignment type'],
          ['external_team_id', 'External team'],
          ['billable', 'Billable'],
          ['project_amount', 'Project amount'],
          ['sold_by', 'Sold by'],
          ['revenue', 'Revenue'],
        ]
        const changes: Array<{ field: string; label: string; from: any; to: any }> = []
        for (const [field, label] of TRACKED_FIELDS) {
          const before = (project as any)[field] ?? null
          const after = ($set as any)[field] ?? null
          if (String(before ?? '') !== String(after ?? '')) {
            changes.push({ field, label, from: before, to: after })
          }
        }
        const nowIso = new Date().toISOString()
        for (const c of changes) {
          await models.activityLogs.insertOne({
            id: generateId('al'),
            project_id: id,
            entity_type: 'project',
            entity_id: id,
            action: `${c.field}_changed`,
            actor_user_id: user?.sub || null,
            actor_name: user?.name || user?.full_name || null,
            actor_role: user?.role || null,
            old_value: c.from == null ? null : String(c.from),
            new_value: c.to == null ? null : String(c.to),
            created_at: nowIso,
          })
        }
        // Notify the project audience (PM, PC, TL, assigned devs, external
        // owner) when anything material moved so they don't miss the change.
        if (changes.length) {
          const audience = new Set<string>()
          const projectAssignments = await models.projectAssignments.find({ project_id: id, is_active: 1 }) as any[]
          for (const a of projectAssignments) if (a.user_id) audience.add(String(a.user_id))
          for (const k of ['pm_id', 'pc_id', 'team_lead_id', 'external_team_id', 'awarded_to_user_id'] as const) {
            const v = ($set as any)[k] ?? (project as any)[k]
            if (v) audience.add(String(v))
          }
          audience.delete(String(user?.sub || ''))
          const summary = changes.length === 1
            ? `${changes[0].label} updated on "${name}"`
            : `${changes.length} fields updated on "${name}"`
          await createUserNotifications(models, Array.from(audience), {
            type: 'project_updated',
            title: summary,
            body: changes.slice(0, 4).map((c) => `${c.label}: ${c.from ?? '—'} → ${c.to ?? '—'}`).join(' • '),
            link: `project:${id}`,
            actor_id: user?.sub || null,
            actor_name: user?.name || user?.full_name || null,
            meta: { project_id: id, project_code: project.code, changed_fields: changes.map((c) => c.field) },
          })
        }
      } catch (logErr) {
        console.warn('[projects] failed to log edit activity:', logErr)
      }

      return res.json({ message: 'Project updated successfully' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.delete('/:id', async (req, res) => {
    try {
      const user = req.user as any
      if (!(await userHasAnyPermission(models, user, 'projects.delete'))) {
        return res.status(403).json({ error: 'Forbidden: Insufficient permissions' })
      }
      const id = String(req.params.id)
      const project = await models.projects.raw().findOne({ id } as any)
      if (!project) return res.status(404).json({ error: 'Project not found' })

      // Snapshot the project + its operational children into Trash (recoverable),
      // then remove them from their collections. Financial/audit records
      // (invoices, documents, activity logs) are left in place.
      const [tasks, milestones, sprints, assignments, kcols, kperms] = await Promise.all([
        models.tasks.raw().find({ project_id: id } as any).toArray(),
        models.milestones.raw().find({ project_id: id } as any).toArray(),
        models.sprints.raw().find({ project_id: id } as any).toArray(),
        models.projectAssignments.raw().find({ project_id: id } as any).toArray(),
        models.kanbanColumns.raw().find({ project_id: id } as any).toArray(),
        models.kanbanPermissions.raw().find({ project_id: id } as any).toArray(),
      ])
      await moveToTrash(models, {
        entityType: 'projects',
        id,
        title: project.name || project.code || id,
        snapshot: project,
        related: {
          tasks, milestones, sprints,
          project_assignments: assignments,
          kanban_columns: kcols,
          kanban_permissions: kperms,
        },
        user,
        reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
      })

      await Promise.all([
        models.tasks.deleteMany({ project_id: id }),
        models.milestones.deleteMany({ project_id: id }),
        models.sprints.deleteMany({ project_id: id }),
        models.projectAssignments.deleteMany({ project_id: id }),
        models.kanbanColumns.deleteMany({ project_id: id }),
        models.kanbanPermissions.deleteMany({ project_id: id }),
      ])
      await models.projects.deleteById(id)

      // Await the project's ES removal so the immediately-following list reload
      // (ES-first) doesn't read the stale, still-present copy.
      if (isElasticEnabled()) {
        try { await esDeleteDoc('projects', id) } catch { /* non-fatal */ }
      }

      return res.json({ message: 'Project moved to Trash' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to delete project' })
    }
  })

  router.post('/:id/assign', async (req, res) => {
    try {
      const user = req.user as any
      if (!(await userHasAnyPermission(models, user, 'projects.manage_team'))) {
        return res.status(403).json({ error: 'Forbidden: Insufficient permissions' })
      }
      const projectId = req.params.id
      const body = req.body || {}
      if (!body.user_id) return res.status(400).json({ error: 'user_id required' })
      const existing = await models.projectAssignments.findOne({
        project_id: projectId, user_id: body.user_id,
      }) as any
      const now = new Date().toISOString()
      if (existing) {
        await models.projectAssignments.updateById(existing.id, {
          $set: {
            allocated_hours: Number(body.allocated_hours || 0),
            role: body.role || 'developer',
            is_active: 1,
            updated_at: now,
          },
        })
      } else {
        await models.projectAssignments.insertOne({
          id: generateId('pa'),
          project_id: projectId,
          user_id: body.user_id,
          allocated_hours: Number(body.allocated_hours || 0),
          consumed_hours: 0,
          role: body.role || 'developer',
          is_active: 1,
          created_at: now,
          updated_at: now,
        })
      }
      return res.status(201).json({ message: 'Developer assigned to project' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to assign developer' })
    }
  })

  router.delete('/:id/assign/:userId', async (req, res) => {
    try {
      const user = req.user as any
      if (!(await userHasAnyPermission(models, user, 'projects.manage_team'))) {
        return res.status(403).json({ error: 'Forbidden: Insufficient permissions' })
      }
      const { id: projectId, userId } = req.params
      await models.projectAssignments.updateMany(
        { project_id: projectId, user_id: userId },
        { $set: { is_active: 0, updated_at: new Date().toISOString() } }
      )
      return res.json({ message: 'Developer removed from project' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to remove developer' })
    }
  })

  router.patch('/:id/assign/:userId', async (req, res) => {
    try {
      const user = req.user as any
      if (!(await userHasAnyPermission(models, user, 'projects.manage_team'))) {
        return res.status(403).json({ error: 'Forbidden: Insufficient permissions' })
      }
      const { id: projectId, userId } = req.params
      const { allocated_hours, role } = req.body || {}
      await models.projectAssignments.updateMany(
        { project_id: projectId, user_id: userId },
        {
          $set: {
            allocated_hours: Number(allocated_hours || 0),
            role: role || 'developer',
            updated_at: new Date().toISOString(),
          },
        }
      )
      return res.json({ message: 'Allocation updated successfully' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to update allocation' })
    }
  })

  router.post('/:id/assign-bulk', async (req, res) => {
    try {
      const user = req.user as any
      if (!(await userHasAnyPermission(models, user, 'projects.manage_team'))) {
        return res.status(403).json({ error: 'Forbidden: Insufficient permissions' })
      }
      const projectId = req.params.id
      const { developers } = req.body || {}
      if (!Array.isArray(developers)) return res.status(400).json({ error: 'developers must be array' })

      await models.projectAssignments.updateMany(
        { project_id: projectId },
        { $set: { is_active: 0, updated_at: new Date().toISOString() } }
      )

      for (const dev of developers) {
        if (!dev?.user_id) continue
        const existing = await models.projectAssignments.findOne({
          project_id: projectId, user_id: dev.user_id,
        }) as any
        const now = new Date().toISOString()
        if (existing) {
          await models.projectAssignments.updateById(existing.id, {
            $set: {
              allocated_hours: Number(dev.allocated_hours || 0),
              role: dev.role || 'developer',
              is_active: 1,
              updated_at: now,
            },
          })
        } else {
          await models.projectAssignments.insertOne({
            id: generateId('pa'),
            project_id: projectId,
            user_id: dev.user_id,
            allocated_hours: Number(dev.allocated_hours || 0),
            consumed_hours: 0,
            role: dev.role || 'developer',
            is_active: 1,
            created_at: now,
            updated_at: now,
          })
        }
      }
      return res.json({ message: 'Developers updated successfully' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to update assignments' })
    }
  })

  router.post('/:id/notes', async (req, res) => {
    try {
      const projectId = req.params.id
      const user = req.user as any
      const { content } = req.body || {}
      if (!content) return res.status(400).json({ error: 'content required' })
      const project = await models.projects.findById(projectId) as any
      if (!project) return res.status(404).json({ error: 'Project not found' })
      const assignments = await models.projectAssignments.find({ project_id: projectId, is_active: 1 }) as any[]
      if (!(await userHasAnyPermission(models, user, 'projects.view_all')) && !isProjectLinkedToUser(project, user, assignments)) {
        return res.status(403).json({ error: 'You do not have access to this project' })
      }
      await models.activityLogs.insertOne({
        id: generateId('note'),
        project_id: projectId,
        entity_type: 'project',
        entity_id: projectId,
        action: 'note',
        actor_user_id: user?.sub || null,
        actor_name: user?.name || null,
        actor_role: user?.role || null,
        new_value: content,
        created_at: new Date().toISOString(),
      })
      return res.status(201).json({ message: 'Note added successfully' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to add note' })
    }
  })

  return router
}

// Tiny CSV parser (handles quoted fields with commas / escaped quotes).
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
