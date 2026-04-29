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
import { createUserNotification, createUserNotifications } from './notifications'

const PROJECT_TYPES = ['development', 'maintenance', 'support', 'consulting', 'bidding'] as const
const PROJECT_STATUSES = ['active', 'on_hold', 'completed', 'archived', 'cancelled'] as const
const PROJECT_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const
const ASSIGNMENT_TYPES = ['in_house', 'external'] as const
const ASSIGNEE_TYPES = ['team', 'user'] as const
const PROJECT_CODE_PATTERN = /^[A-Za-z0-9_-]{2,40}$/
const BID_AWARD_STATUSES = ['open', 'awarded', 'cancelled'] as const

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

      const enriched = projects.map((p) => {
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
      }).sort((a, b) => {
        const priorityOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }
        const pa = priorityOrder[a.priority || 'medium'] || 2
        const pb = priorityOrder[b.priority || 'medium'] || 2
        if (pa !== pb) return pb - pa
        return String(b.created_at || '').localeCompare(String(a.created_at || ''))
      })

      return res.json({
        projects: enriched,
        data: { projects: enriched, data: enriched },
      })
    } catch {
      return res.json({ projects: [], data: { projects: [], data: [] } })
    }
  })

  router.get('/:id', async (req, res) => {
    try {
      const id = req.params.id
      const project = await models.projects.findById(id) as any
      if (!project) return res.status(404).json({ error: 'Project not found' })

      const [users, assignments, timesheets] = await Promise.all([
        models.users.find({}) as Promise<any[]>,
        models.projectAssignments.find({ project_id: id, is_active: 1 }) as Promise<any[]>,
        models.timesheets.find({ project_id: id }) as Promise<any[]>,
      ])
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
      const user = req.user as any
      const body = req.body || {}
      const name = validateName(body.name, 'Project name', 2, 120)
      const code = validateLength(String(body.code || '').trim(), 2, 40, 'Project code')
      if (!PROJECT_CODE_PATTERN.test(code)) {
        return res.status(400).json({ error: 'Project code may only contain letters, numbers, underscore or hyphen' })
      }
      const projectType = validateEnum(body.project_type || 'development', PROJECT_TYPES, 'Project type')
      const status = validateEnum(body.status || 'active', PROJECT_STATUSES, 'Status')
      const priority = validateEnum(body.priority || 'medium', PROJECT_PRIORITIES, 'Priority')
      const isBidding = projectType === 'bidding'
      // Bidding projects don't have a fixed start date — the awarded bidder sets it later.
      const startDate = isBidding
        ? (body.start_date ? validateISODate(body.start_date, 'Start date') : null)
        : validateISODate(body.start_date, 'Start date')
      const endDate = validateOptional(body.expected_end_date, (v) => validateISODate(v, 'End date'))
      if (startDate && endDate && startDate > endDate) {
        return res.status(400).json({ error: 'End date must be after start date' })
      }
      const assignmentType = isBidding
        ? 'in_house'
        : validateEnum(body.assignment_type || 'in_house', ASSIGNMENT_TYPES, 'Assignment type')
      const externalAssigneeType = (!isBidding && assignmentType === 'external')
        ? validateEnum(body.external_assignee_type || 'team', ASSIGNEE_TYPES, 'External assignee type')
        : null
      if (!isBidding && assignmentType === 'external' && !body.external_team_id) {
        return res.status(400).json({ error: 'External team is required when assignment type is external' })
      }
      // Bidding projects must declare a deadline so the countdown timer can run.
      let bidDeadline: string | null = null
      if (isBidding) {
        if (!body.bid_deadline) {
          return res.status(400).json({ error: 'Bid deadline is required for bidding projects' })
        }
        const parsed = new Date(String(body.bid_deadline))
        if (isNaN(parsed.getTime())) {
          return res.status(400).json({ error: 'Invalid bid deadline' })
        }
        if (parsed.getTime() <= Date.now()) {
          return res.status(400).json({ error: 'Bid deadline must be in the future' })
        }
        bidDeadline = parsed.toISOString()
        // A brief is mandatory so bidders understand what they're signing up for —
        // but no length cap, the brief can be as long as the PM needs.
        if (!body.description || !String(body.description).trim()) {
          return res.status(400).json({ error: 'Project brief is required for bidding projects' })
        }
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
        // Bidding briefs can be arbitrarily long; other projects keep the 5000-char cap.
        description: body.description
          ? (isBidding ? String(body.description) : validateLength(String(body.description), 0, 5000, 'Description'))
          : null,
        project_type: projectType,
        start_date: startDate,
        expected_end_date: endDate,
        priority,
        status,
        total_allocated_hours: totalAllocatedHours,
        estimated_budget_hours: estimatedBudgetHours,
        team_lead_id: isBidding ? null : (body.team_lead_id || null),
        pm_id: isBidding ? null : (body.pm_id || null),
        pc_id: isBidding ? null : (body.pc_id || null),
        assignment_type: isBidding ? null : assignmentType,
        external_team_id: (!isBidding && assignmentType === 'external') ? (body.external_team_id || null) : null,
        external_assignee_type: (!isBidding && assignmentType === 'external') ? externalAssigneeType : null,
        billable: body.billable !== undefined ? (body.billable ? 1 : 0) : 1,
        revenue,
        remarks: body.remarks ? validateLength(String(body.remarks), 0, 2000, 'Remarks') : null,
        consumed_hours: 0,
        bid_deadline: bidDeadline,
        bid_status: isBidding ? 'open' : null,
        awarded_bid_id: null,
        awarded_to_user_id: null,
        created_at: now,
        updated_at: now,
      }
      await models.projects.insertOne(project)

      // Notify every active staff member as soon as a bidding project opens —
      // teams, developers, PMs, PCs, and admins. The creator is excluded via actor_id.
      if (isBidding) {
        try {
          const recipients = await models.users.find({
            role: { $in: ['admin', 'pm', 'pc', 'developer', 'team'] },
            is_active: 1,
          }) as any[]
          const creator = await models.users.findById(user?.sub) as any
          const creatorName = creator?.full_name || creator?.email || 'Admin'
          const briefPreview = project.description
            ? String(project.description).replace(/\s+/g, ' ').slice(0, 200)
            : ''
          const deadlineLocal = new Date(bidDeadline as string).toLocaleString()
          const bodyParts = [
            `Bids open until ${deadlineLocal}`,
            project.revenue ? `Reference budget ₹${Number(project.revenue).toLocaleString()}` : '',
            briefPreview ? `Brief: ${briefPreview}${project.description && project.description.length > 200 ? '…' : ''}` : '',
          ].filter(Boolean)
          await createUserNotifications(
            models,
            recipients.map((u) => u.id),
            {
              type: 'bid_opened',
              title: `New bidding project: ${name} (${code})`,
              body: bodyParts.join(' · '),
              link: `bid:${id}`,
              actor_id: user?.sub || null,
              actor_name: creatorName,
              meta: { project_id: id, bid_deadline: bidDeadline, project_code: code },
            },
          )
          console.log(`[projects] bid_opened notifications sent to ${recipients.length} users for project ${id}`)
        } catch (e) {
          console.warn('[projects] failed to notify bidders:', e)
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

  router.put('/:id', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
      const id = String(req.params.id)
      const body = req.body || {}
      const name = validateName(body.name, 'Project name', 2, 120)
      const projectType = validateEnum(body.project_type || 'development', PROJECT_TYPES, 'Project type')
      const status = validateEnum(body.status || 'active', PROJECT_STATUSES, 'Status')
      const priority = validateEnum(body.priority || 'medium', PROJECT_PRIORITIES, 'Priority')
      const isBidding = projectType === 'bidding'
      const startDate = isBidding
        ? (body.start_date ? validateISODate(body.start_date, 'Start date') : null)
        : validateISODate(body.start_date, 'Start date')
      const endDate = validateOptional(body.expected_end_date, (v) => validateISODate(v, 'End date'))
      if (startDate && endDate && startDate > endDate) {
        return res.status(400).json({ error: 'End date must be after start date' })
      }
      const assignmentType = isBidding
        ? null
        : validateEnum(body.assignment_type || 'in_house', ASSIGNMENT_TYPES, 'Assignment type')
      const externalAssigneeType = (!isBidding && assignmentType === 'external')
        ? validateEnum(body.external_assignee_type || 'team', ASSIGNEE_TYPES, 'External assignee type')
        : null
      if (!isBidding && assignmentType === 'external' && !body.external_team_id) {
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
        description: body.description
          ? (isBidding ? String(body.description) : validateLength(String(body.description), 0, 5000, 'Description'))
          : null,
        project_type: projectType,
        start_date: startDate,
        expected_end_date: endDate,
        priority,
        status,
        total_allocated_hours: totalAllocatedHours,
        estimated_budget_hours: estimatedBudgetHours,
        team_lead_id: isBidding ? null : (body.team_lead_id || null),
        pm_id: isBidding ? null : (body.pm_id || null),
        pc_id: isBidding ? null : (body.pc_id || null),
        assignment_type: assignmentType,
        external_team_id: (!isBidding && assignmentType === 'external') ? (body.external_team_id || null) : null,
        external_assignee_type: (!isBidding && assignmentType === 'external') ? externalAssigneeType : null,
        billable: body.billable ? 1 : 0,
        revenue,
        remarks: body.remarks ? validateLength(String(body.remarks), 0, 2000, 'Remarks') : null,
        updated_at: new Date().toISOString(),
      }
      if (isBidding && body.bid_deadline) {
        const parsed = new Date(String(body.bid_deadline))
        if (!isNaN(parsed.getTime())) $set.bid_deadline = parsed.toISOString()
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

  // ── Bidding endpoints ────────────────────────────────────────
  // Aggregated view of all bidding projects + their bids — drives the
  // "Bidding" page and its countdown timers on the frontend.
  router.get('/bids/all', async (req, res) => {
    try {
      const [projects, bids, users] = await Promise.all([
        models.projects.find({ project_type: 'bidding' }) as Promise<any[]>,
        models.projectBids.find({}) as Promise<any[]>,
        models.users.find({}) as Promise<any[]>,
      ])
      const usersById = new Map(users.map((u) => [String(u.id), u]))
      const bidsByProject = new Map<string, any[]>()
      for (const b of bids) {
        const key = String(b.project_id)
        const list = bidsByProject.get(key) || []
        list.push({
          ...b,
          bidder_name: usersById.get(String(b.user_id))?.full_name || null,
          bidder_role: usersById.get(String(b.user_id))?.role || null,
          avatar_color: usersById.get(String(b.user_id))?.avatar_color || null,
        })
        bidsByProject.set(key, list)
      }
      const enriched = projects.map((p) => {
        const projectBids = (bidsByProject.get(String(p.id)) || [])
          .sort((a, b) => Number(a.amount || 0) - Number(b.amount || 0))
        const lowest = projectBids[0] || null
        const deadlineMs = p.bid_deadline ? new Date(p.bid_deadline).getTime() : null
        return {
          ...p,
          bids: projectBids,
          bid_count: projectBids.length,
          lowest_bid: lowest ? lowest.amount : null,
          lowest_bidder_name: lowest ? lowest.bidder_name : null,
          time_left_ms: deadlineMs ? Math.max(0, deadlineMs - Date.now()) : null,
          is_closed: deadlineMs ? Date.now() > deadlineMs : false,
        }
      }).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      return res.json({ data: enriched, projects: enriched })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load bids' })
    }
  })

  router.post('/:id/bids', async (req, res) => {
    try {
      const user = req.user as any
      if (!user?.sub) return res.status(401).json({ error: 'Unauthenticated' })
      const projectId = String(req.params.id)
      const project = await models.projects.findById(projectId) as any
      if (!project) return res.status(404).json({ error: 'Project not found' })
      if (project.project_type !== 'bidding') return res.status(400).json({ error: 'Project is not open for bidding' })
      if (project.bid_status && project.bid_status !== 'open') {
        return res.status(400).json({ error: 'Bidding is closed for this project' })
      }
      if (project.bid_deadline && new Date(project.bid_deadline).getTime() < Date.now()) {
        return res.status(400).json({ error: 'Bid deadline has passed' })
      }
      const amount = validatePositiveNumber(req.body?.amount, 'Bid amount')
      const deliveryDays = req.body?.delivery_days !== undefined
        ? validatePositiveNumber(req.body.delivery_days, 'Delivery days')
        : null
      const note = req.body?.note ? validateLength(String(req.body.note), 0, 1000, 'Note') : null

      // One open bid per user per project — newest replaces older one.
      const existing = await models.projectBids.findOne({ project_id: projectId, user_id: user.sub }) as any
      const now = new Date().toISOString()
      const bidId = existing?.id || generateId('bid')
      const bidder = await models.users.findById(user.sub) as any
      const bidderName = bidder?.full_name || bidder?.email || 'Bidder'
      if (existing) {
        await models.projectBids.updateById(existing.id, {
          $set: { amount, delivery_days: deliveryDays, note, updated_at: now },
        })
      } else {
        await models.projectBids.insertOne({
          id: bidId,
          project_id: projectId,
          user_id: user.sub,
          amount,
          delivery_days: deliveryDays,
          note,
          status: 'submitted',
          created_at: now,
          updated_at: now,
        })
      }

      // Notify all other eligible bidders + the admins/PMs.
      try {
        const subscribers = await models.users.find({
          role: { $in: ['admin', 'developer', 'team', 'pm', 'pc'] },
          is_active: 1,
        }) as any[]
        await createUserNotifications(
          models,
          subscribers.map((u) => u.id),
          {
            type: 'bid_placed',
            title: `${bidderName} bid ₹${amount} on ${project.name}`,
            body: deliveryDays
              ? `Delivery in ${deliveryDays} day${deliveryDays === 1 ? '' : 's'}${note ? ' — ' + note : ''}`
              : (note || 'New bid placed'),
            link: `bid:${projectId}`,
            actor_id: user.sub,
            actor_name: bidderName,
            meta: { project_id: projectId, bid_id: bidId, amount },
          },
        )
      } catch (e) {
        console.warn('[projects] failed to notify on bid:', e)
      }

      return res.status(201).json({ message: 'Bid placed', data: { id: bidId } })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.post('/:id/bids/:bidId/award', requireRole('admin', 'pm'), async (req, res) => {
    try {
      const user = req.user as any
      const projectId = String(req.params.id)
      const bidId = String(req.params.bidId)
      const project = await models.projects.findById(projectId) as any
      if (!project) return res.status(404).json({ error: 'Project not found' })
      const bid = await models.projectBids.findById(bidId) as any
      if (!bid || bid.project_id !== projectId) return res.status(404).json({ error: 'Bid not found' })
      const now = new Date().toISOString()
      await models.projects.updateById(projectId, {
        $set: {
          bid_status: 'awarded',
          awarded_bid_id: bidId,
          awarded_to_user_id: bid.user_id,
          updated_at: now,
        },
      })
      await models.projectBids.updateById(bidId, { $set: { status: 'awarded', updated_at: now } })

      const winner = await models.users.findById(bid.user_id) as any
      const winnerName = winner?.full_name || 'Winner'
      // Notify the winner + all other bidders.
      const otherBids = await models.projectBids.find({ project_id: projectId }) as any[]
      const notifyIds = Array.from(new Set(otherBids.map((b) => b.user_id)))
      await createUserNotifications(models, notifyIds, {
        type: 'bid_awarded',
        title: `Bid awarded for ${project.name}`,
        body: `${winnerName} won the bid at ₹${bid.amount}`,
        link: `bid:${projectId}`,
        actor_id: user?.sub || null,
        meta: { project_id: projectId, bid_id: bidId, winner_id: bid.user_id },
      })
      if (bid.user_id) {
        await createUserNotification(models, {
          user_id: bid.user_id,
          type: 'bid_awarded',
          title: `You won the bid on ${project.name}`,
          body: `Awarded at ₹${bid.amount}`,
          link: `bid:${projectId}`,
          actor_id: user?.sub || null,
          meta: { project_id: projectId, bid_id: bidId },
        })
      }
      return res.json({ message: 'Bid awarded' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
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
