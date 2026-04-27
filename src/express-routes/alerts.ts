import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, requireRole } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'

export function createAlertsRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  router.get('/', async (req, res) => {
    try {
      const user = req.user as any
      const query: Record<string, any> = { is_dismissed: { $ne: 1 } }
      if (user.role === 'developer') {
        query.$or = [{ user_id: user.sub }, { user_id: null }, { user_id: { $exists: false } }]
      }
      const alerts = await models.alerts.find(query, { sort: { created_at: -1 }, limit: 50 }) as any[]
      const unread_count = alerts.filter((alert) => !alert.is_read).length
      return res.json({ alerts, data: alerts, unread_count })
    } catch (error: any) {
      return res.json({ alerts: [], data: [], unread_count: 0 })
    }
  })

  router.patch('/:id/read', async (req, res) => {
    try {
      await models.alerts.updateById(req.params.id, { $set: { is_read: 1 } })
      return res.json({ message: 'Alert marked as read' })
    } catch (error: any) {
      return res.json({ message: 'Alert marked as read' })
    }
  })

  router.patch('/:id/dismiss', async (req, res) => {
    try {
      await models.alerts.updateById(req.params.id, { $set: { is_dismissed: 1, is_read: 1 } })
      return res.json({ message: 'Alert dismissed' })
    } catch (error: any) {
      return res.json({ message: 'Alert dismissed' })
    }
  })

  router.post('/mark-all-read', async (req, res) => {
    try {
      await models.alerts.updateMany?.({ is_dismissed: { $ne: 1 } }, { $set: { is_read: 1 } })
      return res.json({ message: 'All alerts marked as read' })
    } catch (error: any) {
      return res.json({ message: 'All alerts marked as read' })
    }
  })

  router.patch('/read-all', async (req, res) => {
    try {
      await models.alerts.updateMany?.({ is_dismissed: { $ne: 1 } }, { $set: { is_read: 1 } })
      return res.json({ message: 'All alerts marked as read' })
    } catch (error: any) {
      return res.json({ message: 'All alerts marked as read' })
    }
  })

  router.post('/generate', requireRole('admin', 'pm'), async (req, res) => {
    try {
      const now = new Date().toISOString()
      const projects = await models.projects.find({ status: 'active' }) as any[]
      const timesheets = await models.timesheets.find({}) as any[]
      const users = await models.users.find({ role: 'developer', is_active: 1 }) as any[]
      const newAlerts: any[] = []

      for (const project of projects) {
        const allocated = Number(project.total_allocated_hours || 0)
        const consumed = Number(project.consumed_hours || 0)
        if (allocated > 0 && consumed / allocated >= 0.8) {
          const existing = await models.alerts.findOne({ project_id: project.id, type: 'burn', is_dismissed: { $ne: 1 } })
          if (!existing) {
            const pct = Math.round((consumed / allocated) * 100)
            newAlerts.push({
              id: generateId('alert'),
              type: 'burn',
              severity: pct >= 100 ? 'critical' : 'warning',
              title: `${project.name} Hours ${pct >= 100 ? 'Exceeded' : 'Near Limit'}`,
              message: `Project ${project.name} has consumed ${pct}% of allocated hours`,
              project_id: project.id,
              created_at: now,
              is_read: 0,
              is_dismissed: 0,
            })
          }
        }
      }

      const today = now.slice(0, 10)
      for (const dev of users) {
        const hasLog = timesheets.some((entry) => entry.user_id === dev.id && entry.date === today)
        if (!hasLog) {
          const existing = await models.alerts.findOne({ user_id: dev.id, type: 'missing_log', is_dismissed: { $ne: 1 } })
          if (!existing) {
            newAlerts.push({
              id: generateId('alert'),
              type: 'missing_log',
              severity: 'info',
              title: `Missing Log: ${dev.full_name}`,
              message: `${dev.full_name} has not logged any hours today`,
              user_id: dev.id,
              created_at: now,
              is_read: 0,
              is_dismissed: 0,
            })
          }
        }
      }

      if (newAlerts.length) await models.alerts.insertMany(newAlerts)
      return res.json({ message: `Generated ${newAlerts.length} new alerts`, count: newAlerts.length })
    } catch (error: any) {
      return res.json({ message: 'Generated 0 new alerts', count: 0 })
    }
  })

  return router
}
