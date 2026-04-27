import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'
import {
  validateRequired,
  validateLength,
  validateISODate,
  validateOptional,
  respondWithError,
} from '../validators'

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
      const counts = new Map<string, { task_count: number; done_count: number; blocked_count: number }>()
      for (const t of tasks) {
        const key = String(t.sprint_id || '')
        if (!key) continue
        const cur = counts.get(key) || { task_count: 0, done_count: 0, blocked_count: 0 }
        cur.task_count += 1
        if (t.status === 'done') cur.done_count += 1
        if (t.status === 'blocked') cur.blocked_count += 1
        counts.set(key, cur)
      }
      const enriched = sprints.map((s) => ({
        ...s,
        created_by_name: usersById.get(String(s.created_by))?.full_name || null,
        ...(counts.get(String(s.id)) || { task_count: 0, done_count: 0, blocked_count: 0 }),
      })).sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')))
      return res.json({ sprints: enriched, data: enriched })
    } catch {
      return res.json({ sprints: [], data: [] })
    }
  })

  router.post('/', async (req, res) => {
    try {
      const user = req.user as any
      if (!['admin', 'pm', 'pc'].includes(user?.role)) return res.status(403).json({ error: 'Forbidden' })
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
      if (!['admin', 'pm', 'pc'].includes(user?.role)) return res.status(403).json({ error: 'Forbidden' })
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

export function createMilestonesRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

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
      const [milestones, users, projects, invoices] = await Promise.all([
        models.milestones.find(filter) as Promise<any[]>,
        models.users.find({}) as Promise<any[]>,
        models.projects.find({}) as Promise<any[]>,
        models.invoices.find({}) as Promise<any[]>,
      ])
      const usersById = new Map(users.map((u) => [String(u.id), u]))
      const projectsById = new Map(projects.map((p) => [String(p.id), p]))
      const invoiceCounts = new Map<string, number>()
      for (const inv of invoices) {
        if (!inv.milestone_id) continue
        const key = String(inv.milestone_id)
        invoiceCounts.set(key, (invoiceCounts.get(key) || 0) + 1)
      }
      const enriched = milestones.map((m) => ({
        ...m,
        created_by_name: usersById.get(String(m.created_by))?.full_name || null,
        project_name: projectsById.get(String(m.project_id))?.name || null,
        invoice_count: invoiceCounts.get(String(m.id)) || 0,
      })).sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')))
      return res.json({ milestones: enriched, data: enriched })
    } catch {
      return res.json({ milestones: [], data: [] })
    }
  })

  router.post('/', async (req, res) => {
    try {
      const user = req.user as any
      if (!['admin', 'pm', 'pc'].includes(user?.role)) return res.status(403).json({ error: 'Forbidden' })
      const body = req.body || {}
      const { project_id, title, description, due_date, is_billable = 0, invoice_amount = 0, client_visible = 1, deliverables } = body
      if (!project_id || !title || !due_date) return res.status(400).json({ error: 'project_id, title, due_date required' })
      const id = generateId('ms')
      const now = new Date().toISOString()
      const milestone = {
        id,
        project_id,
        title,
        description: description || null,
        due_date,
        completion_pct: 0,
        status: 'pending',
        is_billable: Number(is_billable ? 1 : 0),
        invoice_amount: Number(invoice_amount || 0),
        client_visible: Number(client_visible ? 1 : 0),
        deliverables: deliverables ? JSON.stringify(deliverables) : null,
        created_by: user?.sub || null,
        created_at: now,
        updated_at: now,
      }
      await models.milestones.insertOne(milestone)
      return res.status(201).json({ milestone })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to create milestone' })
    }
  })

  router.put('/:id', async (req, res) => {
    try {
      const user = req.user as any
      if (!['admin', 'pm', 'pc'].includes(user?.role)) return res.status(403).json({ error: 'Forbidden' })
      const id = req.params.id
      const body = req.body || {}
      const patch: any = { updated_at: new Date().toISOString() }
      for (const k of ['title', 'description', 'due_date', 'completion_pct', 'status', 'is_billable', 'invoice_amount', 'client_visible']) {
        if (k in body) patch[k] = body[k]
      }
      await models.milestones.updateById(id, { $set: patch })
      const milestone = await models.milestones.findById(id)
      return res.json({ milestone })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to update milestone' })
    }
  })

  return router
}
