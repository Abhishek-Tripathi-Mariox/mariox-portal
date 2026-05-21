import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, userHasAnyPermission } from '../express-middleware/auth'
import { DEFAULT_KANBAN_COLUMNS } from '../constants'
import { generateId } from '../utils/helpers'
import {
  validateLength,
  validateName,
  validateEnum,
  validateOptional,
  validateISODate,
  validatePositiveNumber,
  validateRequired,
  respondWithError,
} from '../validators'
import { createUserNotifications } from './notifications'

const TASK_TYPES = ['task', 'bug', 'feature', 'epic', 'story', 'subtask'] as const
const TASK_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const

// Resolve the set of user ids that should be notified about activity on a
// given project: everyone with an active assignment + the project's PM, PC,
// reporter, and the current assignee/reporter on the task itself. De-duped
// by createUserNotifications.
async function gatherProjectAudience(models: MongoModels, projectId: string, extras: Array<string | null | undefined> = []) {
  const audience = new Set<string>()
  for (const id of extras) if (id) audience.add(String(id))
  try {
    const project = await models.projects.findById(projectId) as any
    if (project) {
      for (const k of ['pm_id', 'pc_id', 'created_by', 'reporter_id', 'manager_id']) {
        if (project[k]) audience.add(String(project[k]))
      }
    }
    const assignments = await models.projectAssignments.find({ project_id: projectId, is_active: 1 }) as any[]
    for (const a of assignments) {
      if (a.user_id) audience.add(String(a.user_id))
    }
  } catch {
    // best-effort — the caller wraps this in createUserNotifications which
    // also swallows individual insert failures.
  }
  return Array.from(audience)
}

async function ensureColumns(models: MongoModels, projectId: string) {
  const count = await models.kanbanColumns.countDocuments({ project_id: projectId })
  if (count > 0) return
  await models.kanbanColumns.insertMany(DEFAULT_KANBAN_COLUMNS.map((col) => ({
    id: generateId('kc'),
    project_id: projectId,
    name: col.name,
    status_key: col.status_key,
    color: col.color,
    position: col.position,
    wip_limit: col.wip_limit,
    is_done_column: col.is_done_column,
  })))
}

async function checkKanbanPerm(
  models: MongoModels,
  projectId: string,
  userRole: string,
  userId: string,
  requiredPerm: string,
  taskAssigneeId?: string
): Promise<{ allowed: boolean; reason?: string }> {
  if (userRole === 'admin' || userRole === 'pm' || userRole === 'pc') return { allowed: true }

  if ((userRole === 'developer' || userRole === 'team') && requiredPerm !== 'can_comment') {
    const a = await models.projectAssignments.findOne({
      project_id: projectId, user_id: userId, is_active: 1,
    })
    if (!a) {
      // External team users sit on the project itself (external_team_id /
      // awarded_to_user_id) — they don't have a project_assignments row, so
      // the assignment lookup misses them. Treat ownership of the project as
      // equivalent assignment for the bidding/team flow.
      const project = await models.projects.findById(projectId) as any
      const ownsExternally = project && (
        String(project.external_team_id || '') === String(userId) ||
        String(project.awarded_to_user_id || '') === String(userId) ||
        String(project.pm_id || '') === String(userId) ||
        String(project.pc_id || '') === String(userId)
      )
      if (!ownsExternally) return { allowed: false, reason: 'not_assigned_to_project' }
    }
  }

  const row = await models.kanbanPermissions.findOne({
    project_id: projectId, role: userRole,
  }) as any

  const defaults: Record<string, any> = {
    developer: { can_view: 1, can_create_task: 1, can_edit_any_task: 0, can_edit_own_task: 1, can_move_task: 1, can_delete_task: 0, can_manage_columns: 0, can_comment: 1 },
    team: { can_view: 1, can_create_task: 1, can_edit_any_task: 0, can_edit_own_task: 1, can_move_task: 1, can_delete_task: 0, can_manage_columns: 0, can_comment: 1 },
    client: { can_view: 1, can_create_task: 0, can_edit_any_task: 0, can_edit_own_task: 0, can_move_task: 0, can_delete_task: 0, can_manage_columns: 0, can_comment: 1 },
  }
  const perm = row || defaults[userRole] || defaults.client

  if (requiredPerm === 'can_edit_own_task' && taskAssigneeId && taskAssigneeId !== userId) {
    return { allowed: !!perm.can_edit_any_task, reason: perm.can_edit_any_task ? undefined : 'not_task_owner' }
  }

  return { allowed: !!perm[requiredPerm], reason: perm[requiredPerm] ? undefined : 'forbidden' }
}

export function createTasksRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  router.get('/columns/:project_id', async (req, res) => {
    try {
      const projectId = req.params.project_id
      await ensureColumns(models, projectId)
      const cols = await models.kanbanColumns.find({ project_id: projectId }) as any[]
      cols.sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
      return res.json({ columns: cols, data: cols })
    } catch (error: any) {
      return res.json({ columns: [], data: [] })
    }
  })

  router.post('/columns/:project_id', async (req, res) => {
    try {
      const user = req.user as any
      if (!(await userHasAnyPermission(models, user, 'projects.manage_kanban_perms'))) return res.status(403).json({ error: 'Forbidden' })
      const projectId = req.params.project_id
      const { name, color = '#9D6CFF', wip_limit = 0, is_done_column = 0 } = req.body || {}
      if (!name) return res.status(400).json({ error: 'name required' })
      const status_key = String(name).toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').slice(0, 30) + '_' + Date.now()
      const existing = await models.kanbanColumns.find({ project_id: projectId }) as any[]
      const position = existing.reduce((max, c) => Math.max(max, Number(c.position || 0)), -1) + 1
      const id = generateId('kc')
      const column = { id, project_id: projectId, name, status_key, color, position, wip_limit, is_done_column }
      await models.kanbanColumns.insertOne(column)
      return res.status(201).json({ column })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to add column' })
    }
  })

  router.put('/columns/:id', async (req, res) => {
    try {
      const user = req.user as any
      if (!(await userHasAnyPermission(models, user, 'projects.manage_kanban_perms'))) return res.status(403).json({ error: 'Forbidden' })
      const id = req.params.id
      const body = req.body || {}
      const patch: any = {}
      for (const k of ['name', 'color', 'wip_limit', 'is_done_column', 'position']) {
        if (k in body) patch[k] = body[k]
      }
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' })
      await models.kanbanColumns.updateById(id, { $set: patch })
      const col = await models.kanbanColumns.findById(id)
      return res.json({ column: col })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to update column' })
    }
  })

  router.delete('/columns/:id', async (req, res) => {
    try {
      const user = req.user as any
      if (!(await userHasAnyPermission(models, user, 'projects.manage_kanban_perms'))) return res.status(403).json({ error: 'Forbidden' })
      const id = req.params.id
      const col = await models.kanbanColumns.findById(id) as any
      if (!col) return res.status(404).json({ error: 'Column not found' })
      await models.tasks.updateMany(
        { project_id: col.project_id, status: col.status_key },
        { $set: { status: 'backlog', updated_at: new Date().toISOString() } }
      )
      await models.kanbanColumns.deleteById(id)
      return res.json({ success: true })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to delete column' })
    }
  })

  router.get('/board/:project_id', async (req, res) => {
    try {
      const projectId = req.params.project_id
      const sprintId = typeof req.query.sprint_id === 'string' ? req.query.sprint_id : undefined

      await ensureColumns(models, projectId)
      // tasksList holds the board view (optionally sprint-filtered). projectTasks
      // is the full project task set we need for subtask counts when a sprint
      // filter narrows tasksList. When unfiltered they're the same query — reuse
      // tasksList to avoid a duplicate round-trip.
      const [columnDefs, users, sprints, tasksList, projectTasksMaybe] = await Promise.all([
        models.kanbanColumns.find({ project_id: projectId }) as Promise<any[]>,
        models.users.find({}) as Promise<any[]>,
        models.sprints.find({ project_id: projectId }) as Promise<any[]>,
        models.tasks.find(sprintId
          ? { project_id: projectId, sprint_id: sprintId }
          : { project_id: projectId }) as Promise<any[]>,
        sprintId
          ? (models.tasks.find({ project_id: projectId }) as Promise<any[]>)
          : Promise.resolve(null),
      ])
      const projectTasks = projectTasksMaybe || tasksList
      // Scope the comments query to this project's tasks only — previously we
      // pulled every task comment in the database for a single count map.
      const projectTaskIds = projectTasks.map((t: any) => t.id)
      const comments = projectTaskIds.length
        ? await (models.comments.find({ entity_type: 'task', entity_id: { $in: projectTaskIds } }) as Promise<any[]>)
        : []

      const usersById = new Map(users.map((u) => [String(u.id), u]))
      const sprintsById = new Map(sprints.map((s) => [String(s.id), s]))
      const subtaskCounts = new Map<string, number>()
      for (const t of projectTasks) {
        if (!t.parent_task_id) continue
        subtaskCounts.set(String(t.parent_task_id), (subtaskCounts.get(String(t.parent_task_id)) || 0) + 1)
      }
      const commentCounts = new Map<string, number>()
      for (const c of comments) {
        const key = String(c.entity_id)
        commentCounts.set(key, (commentCounts.get(key) || 0) + 1)
      }

      columnDefs.sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
      const columns: Record<string, any[]> = {}
      for (const col of columnDefs) columns[col.status_key] = []

      const topLevel = tasksList
        .filter((t) => !t.parent_task_id)
        .sort((a, b) => (Number(a.position || 0) - Number(b.position || 0)) || String(a.created_at || '').localeCompare(String(b.created_at || '')))

      // Project-wide client lookup so tasks assigned to a client (instead of a
      // staff user) render with the client's name + colour on the board.
      const clientsForBoard = await models.clients.find({}) as any[]
      const clientsById = new Map(clientsForBoard.map((c: any) => [String(c.id), c]))

      for (const task of topLevel) {
        const assignee = usersById.get(String(task.assignee_id)) as any
        const reporter = usersById.get(String(task.reporter_id)) as any
        const sprint = sprintsById.get(String(task.sprint_id)) as any
        const clientAssignee = task.client_assignee_id ? clientsById.get(String(task.client_assignee_id)) as any : null
        const enriched = {
          ...task,
          assignee_name: clientAssignee ? `${clientAssignee.company_name || clientAssignee.contact_name} (Client)` : (assignee?.full_name || null),
          assignee_color: clientAssignee ? (clientAssignee.avatar_color || '#9D6CFF') : (assignee?.avatar_color || null),
          assignee_designation: clientAssignee ? 'Client' : (assignee?.designation || null),
          assignee_kind: clientAssignee ? 'client' : (assignee ? 'user' : null),
          reporter_name: reporter?.full_name || null,
          reporter_color: reporter?.avatar_color || null,
          sprint_name: sprint?.name || null,
          subtask_count: subtaskCounts.get(String(task.id)) || 0,
          comment_count: commentCounts.get(String(task.id)) || 0,
        }
        if (task.status in columns) columns[task.status].push(enriched)
        else if ('backlog' in columns) columns.backlog.push(enriched)
      }

      return res.json({ columns, column_defs: columnDefs, project_id: projectId })
    } catch (error: any) {
      return res.json({ columns: {}, column_defs: [], project_id: req.params.project_id })
    }
  })

  router.get('/my', async (req, res) => {
    try {
      const user = req.user as any
      const [tasksList, projects, sprints] = await Promise.all([
        models.tasks.find({ assignee_id: user.sub, status: { $ne: 'done' } }) as Promise<any[]>,
        models.projects.find({}) as Promise<any[]>,
        models.sprints.find({}) as Promise<any[]>,
      ])
      const projectsById = new Map(projects.map((p) => [String(p.id), p]))
      const sprintsById = new Map(sprints.map((s) => [String(s.id), s]))
      const enriched = tasksList.map((t) => {
        const p = projectsById.get(String(t.project_id)) as any
        const s = sprintsById.get(String(t.sprint_id)) as any
        return {
          ...t,
          project_name: p?.name || null,
          project_code: p?.code || null,
          sprint_name: s?.name || null,
        }
      }).sort((a, b) => {
        const priorityOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }
        const pa = priorityOrder[a.priority || 'medium'] || 2
        const pb = priorityOrder[b.priority || 'medium'] || 2
        if (pa !== pb) return pb - pa
        return String(a.due_date || '').localeCompare(String(b.due_date || ''))
      })
      return res.json({ tasks: enriched, data: enriched })
    } catch {
      return res.json({ tasks: [], data: [] })
    }
  })

  router.get('/', async (req, res) => {
    try {
      const { project_id, sprint_id, milestone_id, assignee_id, status, priority, type } = req.query as Record<string, string | undefined>
      const filter: any = {}
      if (project_id) filter.project_id = project_id
      if (sprint_id) filter.sprint_id = sprint_id
      if (milestone_id) filter.milestone_id = milestone_id
      if (assignee_id) filter.assignee_id = assignee_id
      if (status) filter.status = status
      if (priority) filter.priority = priority
      if (type) filter.task_type = type

      const hasFilter = Object.keys(filter).length > 0
      const [tasksList, users, projects, sprints, subtasksAllMaybe] = await Promise.all([
        models.tasks.find(filter) as Promise<any[]>,
        models.users.find({}) as Promise<any[]>,
        models.projects.find({}) as Promise<any[]>,
        models.sprints.find({}) as Promise<any[]>,
        hasFilter
          ? (models.tasks.find({}) as Promise<any[]>)
          : Promise.resolve(null),
      ])
      // When no filter, tasksList already contains everything — reuse it for the
      // parent_task_id → subtask count map instead of issuing a second find({}).
      const subtasksAll = subtasksAllMaybe || tasksList
      // Scope comments to the visible task set. Without this we fetch every task
      // comment in the entire database just to build the count map.
      const visibleTaskIds = tasksList.map((t) => t.id)
      const comments = visibleTaskIds.length
        ? await (models.comments.find({ entity_type: 'task', entity_id: { $in: visibleTaskIds } }) as Promise<any[]>)
        : []
      const usersById = new Map(users.map((u) => [String(u.id), u]))
      const projectsById = new Map(projects.map((p) => [String(p.id), p]))
      const sprintsById = new Map(sprints.map((s) => [String(s.id), s]))
      const subtaskCounts = new Map<string, number>()
      for (const t of subtasksAll) {
        if (!t.parent_task_id) continue
        subtaskCounts.set(String(t.parent_task_id), (subtaskCounts.get(String(t.parent_task_id)) || 0) + 1)
      }
      const commentCounts = new Map<string, number>()
      for (const c of comments) {
        const key = String(c.entity_id)
        commentCounts.set(key, (commentCounts.get(key) || 0) + 1)
      }

      const enriched = tasksList
        .filter((t) => !t.parent_task_id)
        .map((t) => {
          const a = usersById.get(String(t.assignee_id)) as any
          const r = usersById.get(String(t.reporter_id)) as any
          const p = projectsById.get(String(t.project_id)) as any
          const s = sprintsById.get(String(t.sprint_id)) as any
          return {
            ...t,
            assignee_name: a?.full_name || null,
            assignee_color: a?.avatar_color || null,
            reporter_name: r?.full_name || null,
            project_name: p?.name || null,
            project_code: p?.code || null,
            sprint_name: s?.name || null,
            subtask_count: subtaskCounts.get(String(t.id)) || 0,
            comment_count: commentCounts.get(String(t.id)) || 0,
          }
        })
        .sort((a, b) => (Number(a.position || 0) - Number(b.position || 0)) || String(b.created_at || '').localeCompare(String(a.created_at || '')))

      return res.json({ tasks: enriched, data: enriched })
    } catch {
      return res.json({ tasks: [], data: [] })
    }
  })

  router.get('/:id', async (req, res) => {
    try {
      const id = req.params.id
      const task = await models.tasks.findById(id) as any
      if (!task) return res.status(404).json({ error: 'Task not found' })
      const [subtasks, comments, users, projects, sprints] = await Promise.all([
        models.tasks.find({ parent_task_id: id }) as Promise<any[]>,
        models.comments.find({ entity_type: 'task', entity_id: id }) as Promise<any[]>,
        models.users.find({}) as Promise<any[]>,
        models.projects.find({}) as Promise<any[]>,
        models.sprints.find({}) as Promise<any[]>,
      ])
      const usersById = new Map(users.map((u) => [String(u.id), u]))
      const project = projects.find((p) => p.id === task.project_id) as any
      const sprint = sprints.find((s) => s.id === task.sprint_id) as any
      const assignee = usersById.get(String(task.assignee_id)) as any
      const reporter = usersById.get(String(task.reporter_id)) as any
      const clientAssignee = task.client_assignee_id
        ? await models.clients.findById(String(task.client_assignee_id)) as any
        : null

      const enrichedTask = {
        ...task,
        assignee_name: clientAssignee ? `${clientAssignee.company_name || clientAssignee.contact_name} (Client)` : (assignee?.full_name || null),
        assignee_color: clientAssignee ? (clientAssignee.avatar_color || '#9D6CFF') : (assignee?.avatar_color || null),
        assignee_designation: clientAssignee ? 'Client' : (assignee?.designation || null),
        assignee_kind: clientAssignee ? 'client' : (assignee ? 'user' : null),
        reporter_name: reporter?.full_name || null,
        reporter_color: reporter?.avatar_color || null,
        project_name: project?.name || null,
        project_code: project?.code || null,
        sprint_name: sprint?.name || null,
        sprint_status: sprint?.status || null,
      }
      const enrichedSubtasks = subtasks.map((s) => ({
        ...s,
        assignee_name: usersById.get(String(s.assignee_id))?.full_name || null,
        assignee_color: usersById.get(String(s.assignee_id))?.avatar_color || null,
      }))
      const enrichedComments = comments.map((c) => ({
        ...c,
        author_name: usersById.get(String(c.author_user_id))?.full_name || null,
        author_color: usersById.get(String(c.author_user_id))?.avatar_color || null,
      }))
      const activity = await models.activityLogs.find({ entity_type: 'task', entity_id: id }) as any[]
      activity.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))

      return res.json({
        task: enrichedTask,
        subtasks: enrichedSubtasks,
        comments: enrichedComments,
        watchers: [],
        activity: activity.slice(0, 20),
      })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load task' })
    }
  })

  router.post('/', async (req, res) => {
    try {
      const user = req.user as any
      const body = req.body || {}
      const project_id = validateRequired(body.project_id, 'project_id')
      const title = validateLength(String(body.title || '').trim(), 2, 200, 'Title')
      const description = body.description ? validateLength(String(body.description), 0, 5000, 'Description') : null
      const task_type = validateEnum(body.task_type || 'task', TASK_TYPES, 'Task type')
      const priority = validateEnum(body.priority || 'medium', TASK_PRIORITIES, 'Priority')
      const status = String(body.status || 'backlog').trim() || 'backlog'
      const storyPoints = body.story_points !== undefined
        ? validatePositiveNumber(body.story_points, 'Story points')
        : 0
      const estimatedHours = body.estimated_hours !== undefined
        ? validatePositiveNumber(body.estimated_hours, 'Estimated hours')
        : 0
      const dueDate = validateOptional(body.due_date, (v) => validateISODate(v, 'Due date'))

      const perm = await checkKanbanPerm(models, project_id, user?.role, user?.sub, 'can_create_task')
      if (!perm.allowed) return res.status(403).json({ error: 'You do not have permission to create tasks on this board', reason: perm.reason })

      const id = generateId('task')
      const now = new Date().toISOString()
      const task = {
        id,
        project_id,
        sprint_id: body.sprint_id || null,
        milestone_id: body.milestone_id || null,
        parent_task_id: body.parent_task_id || null,
        title,
        description,
        task_type,
        status,
        priority,
        assignee_id: body.assignee_id || null,
        client_assignee_id: body.client_assignee_id || null,
        reporter_id: user?.sub,
        story_points: storyPoints,
        estimated_hours: estimatedHours,
        logged_hours: 0,
        due_date: dueDate,
        labels: body.labels ? JSON.stringify(body.labels) : null,
        is_client_visible: Number(body.is_client_visible ? 1 : 0),
        is_billable: Number(body.is_billable ? 1 : 0),
        position: 0,
        created_at: now,
        updated_at: now,
      }
      await models.tasks.insertOne(task)
      await models.activityLogs.insertOne({
        id: generateId('al'),
        project_id,
        entity_type: 'task',
        entity_id: id,
        action: 'created',
        actor_user_id: user?.sub,
        actor_name: user?.name || null,
        actor_role: user?.role || null,
        new_value: title,
        created_at: now,
      })
      // Broadcast a "new task" notification to the project audience so the
      // whole team sees what got added — not just the assignee. Author is
      // skipped automatically (they did the action).
      try {
        const audience = await gatherProjectAudience(models, project_id, [task.assignee_id, task.reporter_id])
        await createUserNotifications(models, audience, {
          type: 'task_created',
          title: `New task: ${title}`,
          body: (description || '').slice(0, 200),
          link: `task:${id}`,
          actor_id: user?.sub || null,
          actor_name: user?.name || user?.full_name || null,
          meta: { task_id: id, project_id },
        })
      } catch (e) {
        console.warn('[tasks] new-task notify failed:', e)
      }
      return res.status(201).json({ task })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.put('/:id', async (req, res) => {
    try {
      const user = req.user as any
      const id = req.params.id
      const oldTask = await models.tasks.findById(id) as any
      if (!oldTask) return res.status(404).json({ error: 'Task not found' })

      const isOwner = oldTask.assignee_id === user?.sub
      const permKey = isOwner ? 'can_edit_own_task' : 'can_edit_any_task'
      const perm = await checkKanbanPerm(models, oldTask.project_id, user?.role, user?.sub, permKey, oldTask.assignee_id)
      if (!perm.allowed) return res.status(403).json({ error: 'You do not have permission to edit this task', reason: perm.reason })

      const body = req.body || {}
      const patch: any = { updated_at: new Date().toISOString() }
      const allowed = ['title', 'description', 'task_type', 'status', 'priority', 'assignee_id', 'client_assignee_id', 'sprint_id', 'milestone_id', 'story_points', 'estimated_hours', 'logged_hours', 'due_date', 'pct_of_milestone', 'labels', 'is_client_visible', 'is_billable', 'position']
      for (const k of allowed) {
        if (k in body) patch[k] = k === 'labels' && Array.isArray(body[k]) ? JSON.stringify(body[k]) : body[k]
      }
      if (body.status === 'done' && oldTask.status !== 'done') {
        patch.completed_at = new Date().toISOString()
      }

      // If the description changed alongside a status change (or on its own),
      // push the previous description into description_history so the UI can
      // show "what it used to say". Skip if old description was empty.
      const descChanged = 'description' in body && String(body.description ?? '') !== String(oldTask.description ?? '')
      if (descChanged && String(oldTask.description || '').trim()) {
        const historyEntry = {
          description: oldTask.description,
          status: oldTask.status,
          changed_at: new Date().toISOString(),
          changed_by: user?.sub || null,
          changed_by_name: user?.name || user?.full_name || null,
        }
        const prevHistory = Array.isArray(oldTask.description_history) ? oldTask.description_history : []
        // Cap history at 50 entries so a chatty task doesn't bloat the doc.
        patch.description_history = [...prevHistory, historyEntry].slice(-50)
      }

      await models.tasks.updateById(id, { $set: patch })

      // Auto-update milestone progress based on completed tasks' percentages.
      // This is the contract: each milestone task carries pct_of_milestone, and
      // the milestone's completion_pct is the sum of pct_of_milestone for tasks
      // currently in 'done'. We recompute on every status change to either side
      // so re-opening a task ('done' → 'in_progress') subtracts that share back.
      const milestoneId = oldTask.milestone_id
      const statusChanged = body.status !== undefined && body.status !== oldTask.status
      const pctChanged = body.pct_of_milestone !== undefined
      if (milestoneId && (statusChanged || pctChanged)) {
        try {
          const allMilestoneTasks = await models.tasks.find({ milestone_id: milestoneId }) as any[]
          let completionPct = 0
          for (const t of allMilestoneTasks) {
            const tStatus = t.id === id && body.status !== undefined ? body.status : t.status
            const tPct = t.id === id && body.pct_of_milestone !== undefined
              ? Number(body.pct_of_milestone)
              : Number(t.pct_of_milestone)
            if (tStatus === 'done' && Number.isFinite(tPct)) completionPct += tPct
          }
          completionPct = Math.max(0, Math.min(100, Math.round(completionPct)))
          const milestoneStatus = completionPct >= 100 ? 'completed' : (completionPct > 0 ? 'in_progress' : 'pending')
          await models.milestones.updateById(milestoneId, {
            $set: {
              completion_pct: completionPct,
              status: milestoneStatus,
              updated_at: new Date().toISOString(),
            },
          })
        } catch (e) {
          console.warn('[tasks] failed to recompute milestone progress:', e)
        }
      }

      if (body.status && body.status !== oldTask.status) {
        await models.activityLogs.insertOne({
          id: generateId('al'),
          project_id: oldTask.project_id,
          entity_type: 'task',
          entity_id: id,
          action: 'status_changed',
          actor_user_id: user?.sub,
          actor_name: user?.name || null,
          actor_role: user?.role || null,
          old_value: oldTask.status,
          new_value: body.status,
          created_at: new Date().toISOString(),
        })
        // Notify the project team about the status change so updates flow
        // through the whole group, not just the assignee.
        try {
          const audience = await gatherProjectAudience(
            models,
            String(oldTask.project_id),
            [oldTask.assignee_id, oldTask.reporter_id, body.assignee_id],
          )
          await createUserNotifications(models, audience, {
            type: 'task_status_changed',
            title: `Task moved → ${String(body.status).replace(/_/g, ' ')}: ${oldTask.title || ''}`,
            body: `${user?.name || 'Someone'} changed status from ${String(oldTask.status || '').replace(/_/g, ' ')} to ${String(body.status).replace(/_/g, ' ')}`,
            link: `task:${id}`,
            actor_id: user?.sub || null,
            actor_name: user?.name || user?.full_name || null,
            meta: { task_id: id, project_id: oldTask.project_id, from: oldTask.status, to: body.status },
          })
        } catch (e) {
          console.warn('[tasks] status-change notify failed:', e)
        }
      }
      const updated = await models.tasks.findById(id)
      return res.json({ task: updated })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to update task' })
    }
  })

  router.delete('/:id', async (req, res) => {
    try {
      const user = req.user as any
      const id = req.params.id
      const task = await models.tasks.findById(id) as any
      if (!task) return res.status(404).json({ error: 'Task not found' })
      const perm = await checkKanbanPerm(models, task.project_id, user?.role, user?.sub, 'can_delete_task')
      if (!perm.allowed) return res.status(403).json({ error: 'You do not have permission to delete tasks', reason: perm.reason })
      await models.tasks.deleteMany({ parent_task_id: id })
      await models.tasks.deleteById(id)
      return res.json({ success: true })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to delete task' })
    }
  })

  router.patch('/:id/move', async (req, res) => {
    try {
      const user = req.user as any
      const id = req.params.id
      const { status, position } = req.body || {}
      const oldTask = await models.tasks.findById(id) as any
      if (!oldTask) return res.status(404).json({ error: 'Task not found' })
      const perm = await checkKanbanPerm(models, oldTask.project_id, user?.role, user?.sub, 'can_move_task')
      if (!perm.allowed) return res.status(403).json({ error: 'You do not have permission to move tasks', reason: perm.reason })
      await models.tasks.updateById(id, {
        $set: { status, position: Number(position || 0), updated_at: new Date().toISOString() },
      })
      if (status !== oldTask.status) {
        await models.activityLogs.insertOne({
          id: generateId('al'),
          project_id: oldTask.project_id,
          entity_type: 'task',
          entity_id: id,
          action: 'status_changed',
          actor_user_id: user?.sub,
          actor_name: user?.name || null,
          actor_role: user?.role || null,
          old_value: oldTask.status,
          new_value: status,
          created_at: new Date().toISOString(),
        })
        // Same broadcast as PUT — drag-drop on the board is the most common
        // way status changes, so this is where the team really expects pings.
        try {
          const audience = await gatherProjectAudience(
            models,
            String(oldTask.project_id),
            [oldTask.assignee_id, oldTask.reporter_id],
          )
          await createUserNotifications(models, audience, {
            type: 'task_status_changed',
            title: `Task moved → ${String(status).replace(/_/g, ' ')}: ${oldTask.title || ''}`,
            body: `${user?.name || 'Someone'} changed status from ${String(oldTask.status || '').replace(/_/g, ' ')} to ${String(status).replace(/_/g, ' ')}`,
            link: `task:${id}`,
            actor_id: user?.sub || null,
            actor_name: user?.name || user?.full_name || null,
            meta: { task_id: id, project_id: oldTask.project_id, from: oldTask.status, to: status },
          })
        } catch (e) {
          console.warn('[tasks] move notify failed:', e)
        }
      }
      return res.json({ success: true, status, position })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to move task' })
    }
  })

  router.post('/:id/comment', async (req, res) => {
    try {
      const user = req.user as any
      const taskId = req.params.id
      const task = await models.tasks.findById(taskId) as any
      if (!task) return res.status(404).json({ error: 'Task not found' })
      const perm = await checkKanbanPerm(models, task.project_id, user?.role, user?.sub, 'can_comment')
      if (!perm.allowed) return res.status(403).json({ error: 'You do not have permission to comment on this board' })
      const { content, is_internal = 0, mention_user_ids, attachments } = req.body || {}
      if (!content && !(Array.isArray(attachments) && attachments.length)) {
        return res.status(400).json({ error: 'content or attachment required' })
      }
      const now = new Date().toISOString()
      const id = generateId('cmt')
      const mentionIds: string[] = Array.isArray(mention_user_ids)
        ? Array.from(new Set(mention_user_ids.map((v: any) => String(v || '').trim()).filter(Boolean)))
        : []
      // Normalise the attachment list. Each entry must have at least `url` +
      // `file_name`; anything else (size/type) is best-effort metadata used
      // for the UI's file-icon + size label.
      const safeAttachments = Array.isArray(attachments)
        ? attachments
            .map((a: any) => ({
              id: generateId('att'),
              url: String(a?.url || '').trim(),
              file_name: String(a?.file_name || a?.name || 'file').trim(),
              file_size: Number(a?.file_size || 0) || 0,
              file_type: String(a?.file_type || a?.mime || '').trim(),
              uploaded_at: now,
            }))
            .filter((a) => a.url)
        : []
      const comment = {
        id,
        entity_type: 'task',
        entity_id: taskId,
        author_user_id: user?.role !== 'client' ? user?.sub : null,
        author_client_id: user?.role === 'client' ? user?.sub : null,
        content: content || '',
        is_internal: Number(is_internal || 0),
        mention_user_ids: mentionIds,
        attachments: safeAttachments,
        created_at: now,
      }
      await models.comments.insertOne(comment)

      // Notify @mentioned users (excluding the author so they don't notify themselves).
      if (mentionIds.length) {
        try {
          const recipients = mentionIds.filter((uid) => uid && uid !== user?.sub)
          if (recipients.length) {
            const author = user?.sub ? await models.users.findById(user.sub) as any : null
            const authorName = author?.full_name || author?.email || 'Someone'
            const preview = String(content).replace(/\s+/g, ' ').slice(0, 160)
            await createUserNotifications(models, recipients, {
              type: 'mention',
              title: `${authorName} mentioned you in a comment`,
              body: preview,
              link: `task:${taskId}`,
              actor_id: user?.sub || null,
              actor_name: authorName,
              meta: { task_id: taskId, comment_id: id },
            })
          }
        } catch (e) {
          console.warn('[tasks] mention notify failed:', e)
        }
      }

      return res.status(201).json({ comment })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to post comment' })
    }
  })

  // Edit a comment. Only the author can edit. Admin/PM with edit_any can also.
  router.put('/comments/:commentId', async (req, res) => {
    try {
      const user = req.user as any
      const commentId = req.params.commentId
      const comment = await models.comments.findById(commentId) as any
      if (!comment || comment.entity_type !== 'task') return res.status(404).json({ error: 'Comment not found' })
      const isAuthor = (comment.author_user_id && String(comment.author_user_id) === String(user?.sub)) ||
        (comment.author_client_id && String(comment.author_client_id) === String(user?.sub))
      const isAdmin = user?.role === 'admin' || user?.role === 'pm'
      if (!isAuthor && !isAdmin) return res.status(403).json({ error: 'Only the author can edit this comment' })
      const { content } = req.body || {}
      if (!content || !String(content).trim()) return res.status(400).json({ error: 'content required' })
      await models.comments.updateById(commentId, {
        $set: {
          content: String(content),
          updated_at: new Date().toISOString(),
          edited: 1,
        },
      })
      const updated = await models.comments.findById(commentId)
      return res.json({ comment: updated })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to edit comment' })
    }
  })

  // ── Task attachments ──────────────────────────────────────
  // Two-step upload flow: the client first POSTs the file to /api/uploads to
  // get back {url, file_name, file_size, file_type}, then calls this endpoint
  // with that metadata to link the attachment to the task. Keeping it in two
  // calls lets us reuse the S3 uploader without coupling routes.
  router.post('/:id/attachments', async (req, res) => {
    try {
      const user = req.user as any
      const id = req.params.id
      const task = await models.tasks.findById(id) as any
      if (!task) return res.status(404).json({ error: 'Task not found' })
      const isOwner = task.assignee_id === user?.sub
      const permKey = isOwner ? 'can_edit_own_task' : 'can_edit_any_task'
      const perm = await checkKanbanPerm(models, task.project_id, user?.role, user?.sub, permKey, task.assignee_id)
      if (!perm.allowed) return res.status(403).json({ error: 'You do not have permission to attach files to this task' })
      const { url, file_name, file_size, file_type } = req.body || {}
      if (!url || !file_name) return res.status(400).json({ error: 'url and file_name required' })
      const attachment = {
        id: generateId('att'),
        url: String(url),
        file_name: String(file_name),
        file_size: Number(file_size || 0),
        file_type: String(file_type || ''),
        uploaded_by_id: user?.sub || null,
        uploaded_by_name: user?.name || null,
        uploaded_at: new Date().toISOString(),
      }
      const existing = Array.isArray(task.attachments) ? task.attachments : []
      await models.tasks.updateById(id, {
        $set: {
          attachments: [...existing, attachment],
          updated_at: new Date().toISOString(),
        },
      })
      return res.status(201).json({ attachment })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to attach file' })
    }
  })

  router.delete('/:id/attachments/:attId', async (req, res) => {
    try {
      const user = req.user as any
      const { id, attId } = req.params
      const task = await models.tasks.findById(id) as any
      if (!task) return res.status(404).json({ error: 'Task not found' })
      const attachments = Array.isArray(task.attachments) ? task.attachments : []
      const att = attachments.find((a: any) => a.id === attId)
      if (!att) return res.status(404).json({ error: 'Attachment not found' })
      const isUploader = att.uploaded_by_id && String(att.uploaded_by_id) === String(user?.sub)
      const isAdmin = user?.role === 'admin' || user?.role === 'pm' || user?.role === 'pc'
      if (!isUploader && !isAdmin) return res.status(403).json({ error: 'Only the uploader or a manager can delete this attachment' })
      const next = attachments.filter((a: any) => a.id !== attId)
      await models.tasks.updateById(id, {
        $set: { attachments: next, updated_at: new Date().toISOString() },
      })
      return res.json({ success: true })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to delete attachment' })
    }
  })

  // Delete a comment. Author or admin/PM only.
  router.delete('/comments/:commentId', async (req, res) => {
    try {
      const user = req.user as any
      const commentId = req.params.commentId
      const comment = await models.comments.findById(commentId) as any
      if (!comment || comment.entity_type !== 'task') return res.status(404).json({ error: 'Comment not found' })
      const isAuthor = (comment.author_user_id && String(comment.author_user_id) === String(user?.sub)) ||
        (comment.author_client_id && String(comment.author_client_id) === String(user?.sub))
      const isAdmin = user?.role === 'admin' || user?.role === 'pm'
      if (!isAuthor && !isAdmin) return res.status(403).json({ error: 'Only the author can delete this comment' })
      await models.comments.deleteById(commentId)
      return res.json({ success: true })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to delete comment' })
    }
  })

  return router
}
