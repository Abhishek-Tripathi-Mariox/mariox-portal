import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'
import { validateEnum, validateLength, respondWithError } from '../validators'
import { createUserNotification } from './notifications'

const BUILTIN_STATUSES = ['todo', 'in_progress', 'done'] as const
const BUILTIN_STATUS_LABELS: Record<string, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
}
const PRIORITIES = ['low', 'medium', 'high'] as const

// Resolve the union of built-in + admin-defined statuses for personal tasks.
// Returns just the slugs so callers can run them through validateEnum.
async function loadAllStatuses(models: MongoModels): Promise<string[]> {
  try {
    const custom = await models.personalTaskStatuses.find({}) as any[]
    const customSlugs = custom.map((c) => String(c.value || '').toLowerCase()).filter(Boolean)
    return Array.from(new Set([...BUILTIN_STATUSES, ...customSlugs]))
  } catch {
    return [...BUILTIN_STATUSES]
  }
}

// Tasks — standalone tasks not tied to any project. Anyone can
// create one and assign it to a user; the assignee plus their upper
// hierarchy can see it. Admin / PM / PC / HR see everything.
//
// Hierarchy rules (sales-only — other roles only see assignee==self or
// creator==self):
//   sales_manager → sees tasks of TLs reporting to them + agents under
//                    those TLs
//   sales_tl      → sees tasks of agents whose tl_id is them
async function buildVisibilityFilter(_models: MongoModels, user: any) {
  // Personal/independent tasks are strictly private: a task is visible ONLY to
  // the person it's assigned to and the person who created it. No admin/PM
  // bypass, no hierarchy lookup — those used to leak personal todo items to
  // managers, which the team flagged as unwanted.
  const uid = String(user?.sub || '')
  if (!uid) return { id: '__none__' }
  return {
    $or: [
      { assigned_to: uid },
      { created_by: uid },
    ],
  }
}

export function createPersonalTasksRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  router.get('/', async (req, res) => {
    try {
      const user = req.user as any
      const filter = await buildVisibilityFilter(models, user)
      const allStatuses = await loadAllStatuses(models)
      if (typeof req.query.status === 'string' && allStatuses.includes(req.query.status)) {
        (filter as any).status = req.query.status
      }
      const rows = (await models.personalTasks.find(filter) as any[]) || []
      const userIds = new Set<string>()
      rows.forEach((t) => { if (t.assigned_to) userIds.add(String(t.assigned_to)); if (t.created_by) userIds.add(String(t.created_by)) })
      const users = userIds.size
        ? (await models.users.find({ id: { $in: Array.from(userIds) } }) as any[]) || []
        : []
      const usersById = new Map(users.map((u) => [String(u.id), u]))
      const enriched = rows.map((t) => {
        const a = usersById.get(String(t.assigned_to))
        const c = usersById.get(String(t.created_by))
        // Enrich each history entry with the actor's name + avatar so the UI
        // doesn't have to do a second user lookup just to show "Akash changed
        // status from todo → in_progress".
        const history = Array.isArray(t.history) ? t.history.map((h: any) => {
          const actor = usersById.get(String(h.actor_id))
          return {
            ...h,
            actor_name: h.actor_name || actor?.full_name || null,
            actor_color: h.actor_color || actor?.avatar_color || null,
          }
        }) : []
        return {
          ...t,
          assigned_to_name: a?.full_name || null,
          assigned_to_avatar: a?.avatar_color || null,
          assigned_to_color: a?.avatar_color || null,
          created_by_name: c?.full_name || null,
          created_by_color: c?.avatar_color || null,
          history,
        }
      }).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      // Surface the active status palette (built-in + custom) so the page can
      // render the dropdown without a second round-trip.
      const customStatuses = await models.personalTaskStatuses.find({}) as any[]
      const statuses = [
        ...BUILTIN_STATUSES.map((v) => ({ value: v, label: BUILTIN_STATUS_LABELS[v] || v, builtin: true })),
        ...customStatuses.map((c) => ({ value: c.value, label: c.label || c.value, builtin: false, id: c.id, color: c.color || null })),
      ]
      return res.json({ data: enriched, tasks: enriched, statuses, priorities: PRIORITIES })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── Status palette CRUD ─────────────────────────────────────
  // List of available statuses (built-in + custom). Anyone authenticated can
  // read it; only admin / PM / PC can add or remove custom ones.
  router.get('/statuses', async (_req, res) => {
    try {
      const custom = await models.personalTaskStatuses.find({}) as any[]
      custom.sort((a, b) => String(a.label || a.value || '').localeCompare(String(b.label || b.value || '')))
      const statuses = [
        ...BUILTIN_STATUSES.map((v) => ({ value: v, label: BUILTIN_STATUS_LABELS[v] || v, builtin: true })),
        ...custom.map((c) => ({ value: c.value, label: c.label || c.value, builtin: false, id: c.id, color: c.color || null })),
      ]
      return res.json({ statuses, builtin: BUILTIN_STATUSES, custom })
    } catch {
      return res.json({ statuses: BUILTIN_STATUSES.map((v) => ({ value: v, label: BUILTIN_STATUS_LABELS[v] || v, builtin: true })), builtin: BUILTIN_STATUSES, custom: [] })
    }
  })

  router.post('/statuses', async (req, res) => {
    try {
      const user = req.user as any
      const role = String(user?.role || '').toLowerCase()
      if (!['admin', 'pm', 'pc'].includes(role)) {
        return res.status(403).json({ error: 'Only admin / PM / PC can add new statuses' })
      }
      const body = req.body || {}
      const label = validateLength(String(body.label || body.name || '').trim(), 2, 40, 'Status name')
      const explicit = String(body.value || '').trim().toLowerCase()
      const slug = (explicit || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')).slice(0, 32)
      if (!slug) return res.status(400).json({ error: 'Status name must contain letters or numbers' })
      if ((BUILTIN_STATUSES as readonly string[]).includes(slug)) {
        return res.status(409).json({ error: 'A built-in status with this name already exists' })
      }
      const existing = await models.personalTaskStatuses.findOne({ value: slug })
      if (existing) return res.status(409).json({ error: 'This status already exists' })
      const color = body.color && /^#[0-9A-F]{6}$/i.test(String(body.color)) ? String(body.color) : '#a855f7'
      const record = {
        id: generateId('ptstat'),
        value: slug,
        label,
        color,
        created_by: user?.sub || null,
        created_by_name: user?.name || user?.full_name || null,
        created_at: new Date().toISOString(),
      }
      await models.personalTaskStatuses.insertOne(record)
      return res.status(201).json({ status: record, message: 'Status added' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.delete('/statuses/:id', async (req, res) => {
    try {
      const user = req.user as any
      const role = String(user?.role || '').toLowerCase()
      if (!['admin', 'pm', 'pc'].includes(role)) {
        return res.status(403).json({ error: 'Only admin / PM / PC can remove statuses' })
      }
      const id = String(req.params.id)
      const rec = await models.personalTaskStatuses.findById(id) as any
      if (!rec) return res.status(404).json({ error: 'Status not found' })
      // Tasks currently sitting on this status would otherwise become orphans
      // — move them back to "todo" so they stay visible somewhere.
      await models.personalTasks.updateMany({ status: rec.value }, { $set: { status: 'todo', updated_at: new Date().toISOString() } })
      await models.personalTaskStatuses.deleteById(rec.id)
      return res.json({ message: 'Status removed; affected tasks moved to To Do' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.post('/', async (req, res) => {
    try {
      const user = req.user as any
      const body = req.body || {}
      const title = validateLength(String(body.title || '').trim(), 1, 200, 'Title')
      const description = String(body.description || '').trim().slice(0, 4000)
      const assignedTo = String(body.assigned_to || user.sub).trim()
      const assignee = await models.users.findById(assignedTo) as any
      if (!assignee) return res.status(400).json({ error: 'Assignee not found' })
      const priority = validateEnum(body.priority || 'medium', PRIORITIES, 'Priority')
      const allStatuses = await loadAllStatuses(models)
      const status = validateEnum(body.status || 'todo', allStatuses, 'Status')
      const dueDate = body.due_date ? String(body.due_date) : null
      const now = new Date().toISOString()
      const id = generateId('ptask')
      const doc = {
        id,
        title,
        description,
        assigned_to: assignedTo,
        created_by: String(user.sub),
        status,
        priority,
        due_date: dueDate,
        created_at: now,
        updated_at: now,
        completed_at: status === 'done' ? now : null,
      }
      await models.personalTasks.insertOne(doc)
      if (String(assignedTo) !== String(user.sub)) {
        createUserNotification(models, {
          user_id: assignedTo,
          type: 'personal_task_assigned',
          title: `New task: ${title}`,
          body: description.slice(0, 200),
          link: `ptask:${id}`,
          actor_id: user.sub || null,
          actor_name: user?.name || user?.full_name || null,
          meta: { task_id: id },
        }).catch(() => {})
      }
      return res.status(201).json({ data: doc, message: 'Task created' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.patch('/:id', async (req, res) => {
    try {
      const user = req.user as any
      const id = String(req.params.id)
      const task = await models.personalTasks.findById(id) as any
      if (!task) return res.status(404).json({ error: 'Task not found' })
      const isCreator = String(task.created_by) === String(user.sub)
      const isAssignee = String(task.assigned_to) === String(user.sub)
      // Strict access: only the assignee or the original assigner can edit.
      if (!isCreator && !isAssignee) {
        return res.status(403).json({ error: 'Not allowed to edit this task' })
      }
      // Reassignment stays a creator-only action (the assignee can't punt the
      // task to someone else, only flip its status/notes).
      const isElevated = isCreator
      const body = req.body || {}
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      // Append-only history log — every status/assignee/title/description
      // change becomes one entry so the task drawer can show "who did what".
      const now = new Date().toISOString()
      const historyEntries: any[] = []
      const pushHistory = (field: string, fromValue: any, toValue: any) => {
        historyEntries.push({
          id: generateId('pth'),
          field,
          from: fromValue ?? null,
          to: toValue ?? null,
          actor_id: user?.sub || null,
          actor_name: user?.name || user?.full_name || null,
          changed_at: now,
        })
      }
      if ('title' in body) {
        const nextTitle = validateLength(String(body.title || '').trim(), 1, 200, 'Title')
        if (nextTitle !== String(task.title || '')) pushHistory('title', task.title || '', nextTitle)
        patch.title = nextTitle
      }
      if ('description' in body) {
        const nextDesc = String(body.description || '').trim().slice(0, 4000)
        if (nextDesc !== String(task.description || '')) pushHistory('description', task.description || '', nextDesc)
        patch.description = nextDesc
      }
      if ('priority' in body) {
        const nextPriority = validateEnum(body.priority, PRIORITIES, 'Priority')
        if (nextPriority !== task.priority) pushHistory('priority', task.priority, nextPriority)
        patch.priority = nextPriority
      }
      if ('due_date' in body) {
        const nextDue = body.due_date ? String(body.due_date) : null
        if (nextDue !== (task.due_date || null)) pushHistory('due_date', task.due_date || null, nextDue)
        patch.due_date = nextDue
      }
      if ('status' in body) {
        const allStatuses = await loadAllStatuses(models)
        const nextStatus = validateEnum(body.status, allStatuses, 'Status')
        if (nextStatus !== task.status) pushHistory('status', task.status, nextStatus)
        patch.status = nextStatus
        if (nextStatus === 'done' && task.status !== 'done') {
          patch.completed_at = new Date().toISOString()
          if (String(task.created_by) !== String(user.sub)) {
            createUserNotification(models, {
              user_id: String(task.created_by),
              type: 'personal_task_completed',
              title: `Task completed: ${task.title}`,
              body: '',
              link: `ptask:${id}`,
              actor_id: user.sub || null,
              actor_name: user?.name || user?.full_name || null,
              meta: { task_id: id },
            }).catch(() => {})
          }
        } else if (nextStatus !== 'done') {
          patch.completed_at = null
        }
      }
      if ('assigned_to' in body && (isCreator || isElevated)) {
        const next = String(body.assigned_to || '').trim()
        if (!next) return res.status(400).json({ error: 'Assignee required' })
        const assignee = await models.users.findById(next) as any
        if (!assignee) return res.status(400).json({ error: 'Assignee not found' })
        if (String(task.assigned_to || '') !== next) pushHistory('assigned_to', task.assigned_to || null, next)
        patch.assigned_to = next
        if (String(task.assigned_to) !== next && String(next) !== String(user.sub)) {
          createUserNotification(models, {
            user_id: next,
            type: 'personal_task_assigned',
            title: `Task reassigned to you: ${task.title}`,
            body: String(task.description || '').slice(0, 200),
            link: `ptask:${id}`,
            actor_id: user.sub || null,
            actor_name: user?.name || user?.full_name || null,
            meta: { task_id: id },
          }).catch(() => {})
        }
      }
      // Persist the diff in the same update so history is atomic with the
      // change itself. Cap at 100 entries to avoid bloating very chatty tasks.
      if (historyEntries.length) {
        const prev = Array.isArray(task.history) ? task.history : []
        patch.history = [...prev, ...historyEntries].slice(-100)
      }
      await models.personalTasks.updateById(id, { $set: patch })
      const updated = await models.personalTasks.findById(id)
      return res.json({ data: updated, message: 'Task updated' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.delete('/:id', async (req, res) => {
    try {
      const user = req.user as any
      const id = String(req.params.id)
      const task = await models.personalTasks.findById(id) as any
      if (!task) return res.status(404).json({ error: 'Task not found' })
      // Only the creator can delete — assignees can mark done but not nuke
      // a task someone else assigned to them.
      if (String(task.created_by) !== String(user.sub)) {
        return res.status(403).json({ error: 'Only the assigner can delete this task' })
      }
      await models.personalTasks.deleteById(id)
      return res.json({ success: true, message: 'Task deleted' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  return router
}
