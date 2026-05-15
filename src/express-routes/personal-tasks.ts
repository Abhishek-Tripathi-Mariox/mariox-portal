import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'
import { validateEnum, validateLength, respondWithError } from '../validators'
import { createUserNotification } from './notifications'

const STATUSES = ['todo', 'in_progress', 'done'] as const
const PRIORITIES = ['low', 'medium', 'high'] as const

// Tasks — standalone tasks not tied to any project. Anyone can
// create one and assign it to a user; the assignee plus their upper
// hierarchy can see it. Admin / PM / PC / HR see everything.
//
// Hierarchy rules (sales-only — other roles only see assignee==self or
// creator==self):
//   sales_manager → sees tasks of TLs reporting to them + agents under
//                    those TLs
//   sales_tl      → sees tasks of agents whose tl_id is them
async function buildVisibilityFilter(models: MongoModels, user: any) {
  const role = String(user?.role || '').toLowerCase()
  const uid = String(user?.sub || '')
  if (!uid) return { id: '__none__' }
  if (['admin', 'pm', 'pc', 'hr'].includes(role)) return {}
  const visibleAssignees = new Set<string>([uid])
  if (role === 'sales_manager') {
    const tls = (await models.users.find({ role: 'sales_tl', manager_id: uid }) as any[]) || []
    const tlIds = tls.map((t) => String(t.id))
    tlIds.forEach((id) => visibleAssignees.add(id))
    if (tlIds.length) {
      const agents = (await models.users.find({ role: 'sales_agent', tl_id: { $in: tlIds } }) as any[]) || []
      agents.forEach((a) => visibleAssignees.add(String(a.id)))
    }
  } else if (role === 'sales_tl') {
    const agents = (await models.users.find({ role: 'sales_agent', tl_id: uid }) as any[]) || []
    agents.forEach((a) => visibleAssignees.add(String(a.id)))
  }
  return {
    $or: [
      { assigned_to: { $in: Array.from(visibleAssignees) } },
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
      if (typeof req.query.status === 'string' && (STATUSES as readonly string[]).includes(req.query.status)) {
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
        return {
          ...t,
          assigned_to_name: a?.full_name || null,
          assigned_to_avatar: a?.avatar_color || null,
          created_by_name: c?.full_name || null,
        }
      }).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      return res.json({ data: enriched, tasks: enriched })
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
      const status = validateEnum(body.status || 'todo', STATUSES, 'Status')
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
      const role = String(user?.role || '').toLowerCase()
      const id = String(req.params.id)
      const task = await models.personalTasks.findById(id) as any
      if (!task) return res.status(404).json({ error: 'Task not found' })
      const isCreator = String(task.created_by) === String(user.sub)
      const isAssignee = String(task.assigned_to) === String(user.sub)
      const isElevated = ['admin', 'pm', 'pc', 'hr'].includes(role)
      if (!isCreator && !isAssignee && !isElevated) {
        return res.status(403).json({ error: 'Not allowed to edit this task' })
      }
      const body = req.body || {}
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if ('title' in body) patch.title = validateLength(String(body.title || '').trim(), 1, 200, 'Title')
      if ('description' in body) patch.description = String(body.description || '').trim().slice(0, 4000)
      if ('priority' in body) patch.priority = validateEnum(body.priority, PRIORITIES, 'Priority')
      if ('due_date' in body) patch.due_date = body.due_date ? String(body.due_date) : null
      if ('status' in body) {
        const nextStatus = validateEnum(body.status, STATUSES, 'Status')
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
      const role = String(user?.role || '').toLowerCase()
      const id = String(req.params.id)
      const task = await models.personalTasks.findById(id) as any
      if (!task) return res.status(404).json({ error: 'Task not found' })
      const isCreator = String(task.created_by) === String(user.sub)
      const isElevated = ['admin', 'pm', 'pc', 'hr'].includes(role)
      if (!isCreator && !isElevated) {
        return res.status(403).json({ error: 'Not allowed to delete this task' })
      }
      await models.personalTasks.deleteById(id)
      return res.json({ success: true, message: 'Task deleted' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  return router
}
