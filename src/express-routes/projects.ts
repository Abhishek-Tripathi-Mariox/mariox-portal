import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, requireRole } from '../express-middleware/auth'
import { DEFAULT_KANBAN_COLUMNS } from '../constants'
import { generateId } from '../utils/helpers'
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

export function createProjectsRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  router.get('/', async (req, res) => {
    try {
      const user = req.user as any
      const role = String(user?.role || '').toLowerCase()
      const status = typeof req.query.status === 'string' ? req.query.status : undefined
      const pmId = typeof req.query.pm_id === 'string' ? req.query.pm_id : undefined
      const filter: any = {}
      if (status) filter.status = status
      if (pmId) filter.pm_id = pmId

      const [projects, users, assignments] = await Promise.all([
        models.projects.find(filter) as Promise<any[]>,
        models.users.find({}) as Promise<any[]>,
        models.projectAssignments.find({ is_active: 1 }) as Promise<any[]>,
      ])

      const usersById = new Map(users.map((u) => [String(u.id), u]))
      const assignmentsByProject = new Map<string, any[]>()
      for (const a of assignments) {
        const key = String(a.project_id)
        const list = assignmentsByProject.get(key) || []
        list.push(a)
        assignmentsByProject.set(key, list)
      }

      // Role-scope: team accounts only see projects directly assigned to them
      // (external assignment) or projects auto-created from a bid they won.
      // Without this scope, every team head saw the whole company's project
      // list — fix for "kyu dusre team ke project mere par dikh rahe hain".
      // Developers see projects they're allocated to; admin/pm/pc see everything.
      const myAssignmentProjectIds = new Set(
        assignments.filter((a) => String(a.user_id) === String(user?.sub)).map((a) => String(a.project_id)),
      )
      const visibleProjects = projects.filter((p) => {
        if (role === 'team') {
          return p.external_team_id === user?.sub || p.awarded_to_user_id === user?.sub
        }
        if (role === 'developer') {
          // Developers see projects they're assigned to + ones they're PM/PC/lead on (rare).
          if (myAssignmentProjectIds.has(String(p.id))) return true
          if (p.pm_id === user?.sub || p.pc_id === user?.sub || p.team_lead_id === user?.sub) return true
          return false
        }
        return true
      })

      const enriched = visibleProjects.map((p) => {
        const tl = usersById.get(String(p.team_lead_id)) as any
        const pm = usersById.get(String(p.pm_id)) as any
        const pc = usersById.get(String(p.pc_id)) as any
        const devs = assignmentsByProject.get(String(p.id)) || []
        return {
          ...p,
          team_lead_name: tl?.full_name || null,
          pm_name: pm?.full_name || null,
          pc_name: pc?.full_name || null,
          developer_count: devs.length,
          ...computeProjectMetrics(p),
        }
      }).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))

      return res.json({
        projects: enriched,
        data: { projects: enriched, data: enriched },
      })
    } catch {
      return res.json({ projects: [], data: { projects: [], data: [] } })
    }
  })

  // Suggest the next sequential project code for a given delivery kind so
  // the frontend can prefill the code field. Examples:
  //   app  → APP001 (or APP004 if APP001/2/3 already exist)
  //   web  → WB001
  //   both → BTH001
  // IMPORTANT: must be registered BEFORE `/:id` so Express doesn't match
  // "next-code" as a project id and 404 with "Project not found".
  router.get('/next-code', async (req, res) => {
    try {
      const kind = String(req.query.kind || '').toLowerCase()
      const prefix = kind === 'app' ? 'APP' : kind === 'web' ? 'WB' : kind === 'both' ? 'BTH' : null
      if (!prefix) return res.status(400).json({ error: 'kind must be one of: app, web, both' })
      const projects = await models.projects.find({}) as any[]
      let max = 0
      const re = new RegExp('^' + prefix + '(\\d{1,6})$', 'i')
      for (const p of projects) {
        const m = re.exec(String(p.code || ''))
        if (m) {
          const n = parseInt(m[1], 10)
          if (Number.isFinite(n) && n > max) max = n
        }
      }
      const next = String(max + 1).padStart(3, '0')
      return res.json({ code: prefix + next, prefix })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.get('/:id', async (req, res) => {
    try {
      const user = req.user as any
      const role = String(user?.role || '').toLowerCase()
      const id = req.params.id
      const project = await models.projects.findById(id) as any
      if (!project) return res.status(404).json({ error: 'Project not found' })

      const [users, assignments, timesheets] = await Promise.all([
        models.users.find({}) as Promise<any[]>,
        models.projectAssignments.find({ project_id: id, is_active: 1 }) as Promise<any[]>,
        models.timesheets.find({ project_id: id }) as Promise<any[]>,
      ])

      // Same scope as the list endpoint: a team account must be linked to the
      // project (external assignee or bid winner). Otherwise 403 — keeps the
      // detail URL from leaking siblings' projects.
      if (role === 'team' &&
          project.external_team_id !== user?.sub &&
          project.awarded_to_user_id !== user?.sub) {
        return res.status(403).json({ error: 'You do not have access to this project' })
      }
      if (role === 'developer') {
        const isAllocated = assignments.some((a: any) => String(a.user_id) === String(user?.sub))
        const isLead = project.pm_id === user?.sub || project.pc_id === user?.sub || project.team_lead_id === user?.sub
        if (!isAllocated && !isLead) {
          return res.status(403).json({ error: 'You do not have access to this project' })
        }
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

      const data = {
        ...project,
        team_lead_name: (tl as any)?.full_name || null,
        pm_name: (pm as any)?.full_name || null,
        pc_name: (pc as any)?.full_name || null,
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

  router.post('/', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
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
        pm_id: body.pm_id || null,
        pc_id: body.pc_id || null,
        assignment_type: assignmentType,
        external_team_id: assignmentType === 'external' ? (body.external_team_id || null) : null,
        external_assignee_type: assignmentType === 'external' ? externalAssigneeType : null,
        billable: body.billable !== undefined ? (body.billable ? 1 : 0) : 1,
        revenue,
        remarks: body.remarks ? validateLength(String(body.remarks), 0, 2000, 'Remarks') : null,
        consumed_hours: 0,
        // Set when this project was auto-created from an awarded bid auction.
        source_bid_id: body.source_bid_id || null,
        created_at: now,
        updated_at: now,
      }
      await models.projects.insertOne(project)

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
              uploaded_by_role: 'staff',
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

  router.post('/import', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
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

  router.put('/:id', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
      const id = String(req.params.id)
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
        pm_id: body.pm_id || null,
        pc_id: body.pc_id || null,
        assignment_type: assignmentType,
        external_team_id: assignmentType === 'external' ? (body.external_team_id || null) : null,
        external_assignee_type: assignmentType === 'external' ? externalAssigneeType : null,
        billable: body.billable ? 1 : 0,
        revenue,
        remarks: body.remarks ? validateLength(String(body.remarks), 0, 2000, 'Remarks') : null,
        updated_at: new Date().toISOString(),
      }
      await models.projects.updateById(id, { $set })
      return res.json({ message: 'Project updated successfully' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.delete('/:id', requireRole('admin'), async (req, res) => {
    try {
      await models.projects.updateById(String(req.params.id), {
        $set: { status: 'archived', updated_at: new Date().toISOString() },
      })
      return res.json({ message: 'Project archived successfully' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to archive project' })
    }
  })

  router.post('/:id/assign', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
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

  router.delete('/:id/assign/:userId', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
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

  router.patch('/:id/assign/:userId', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
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

  router.post('/:id/assign-bulk', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
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
