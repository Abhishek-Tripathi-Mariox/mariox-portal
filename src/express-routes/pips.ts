import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, requireAnyPermission, userHasAnyPermission } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'
import {
  validateEnum,
  validateISODate,
  validateLength,
  validateOptional,
  respondWithError,
} from '../validators'
import { createUserNotification } from './notifications'

const PIP_STATUSES = ['draft', 'active', 'completed', 'extended', 'failed', 'cancelled'] as const

export function createPipsRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  router.get('/', async (req, res) => {
    try {
      const user = req.user as any
      const isManager = await userHasAnyPermission(models, user, 'hr.pips.manage')
      const userId = typeof req.query.user_id === 'string' ? req.query.user_id : undefined
      const filter: any = {}
      if (!isManager) filter.user_id = user.sub
      else if (userId) filter.user_id = userId

      const [rows, users] = await Promise.all([
        models.pips.find(filter) as Promise<any[]>,
        models.users.find({}) as Promise<any[]>,
      ])
      const usersById = new Map(users.map((u) => [String(u.id), u]))
      const enriched = rows.map((p) => ({
        ...p,
        full_name: usersById.get(String(p.user_id))?.full_name || null,
        email: usersById.get(String(p.user_id))?.email || null,
        designation: usersById.get(String(p.user_id))?.designation || null,
        avatar_color: usersById.get(String(p.user_id))?.avatar_color || null,
        manager_name: p.manager_id ? (usersById.get(String(p.manager_id))?.full_name || null) : null,
      })).sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')))
      return res.json({ data: enriched, pips: enriched })
    } catch {
      return res.json({ data: [], pips: [] })
    }
  })

  router.post('/', requireAnyPermission(models, 'hr.pips.manage'), async (req, res) => {
    try {
      const user = req.user as any
      const body = req.body || {}
      const targetUserId = String(body.user_id || '').trim()
      if (!targetUserId) return res.status(400).json({ error: 'Employee is required' })
      const targetUser = await models.users.findById(targetUserId) as any
      if (!targetUser) return res.status(400).json({ error: 'Employee not found' })

      const title = validateLength(String(body.title || '').trim(), 1, 200, 'Title')
      const reason = validateLength(String(body.reason || '').trim(), 1, 4000, 'Reason')
      const expectations = validateLength(String(body.expectations || '').trim(), 1, 4000, 'Expectations')
      const startDate = validateISODate(body.start_date, 'Start date')
      const endDate = validateISODate(body.end_date, 'End date')
      if (startDate > endDate) return res.status(400).json({ error: 'End date must be on or after start date' })
      const status = body.status ? validateEnum(body.status, PIP_STATUSES, 'Status') : 'active'
      const supportPlan = validateOptional(body.support_plan, (v) => validateLength(String(v).trim(), 1, 4000, 'Support plan'))

      const id = generateId('pip')
      const now = new Date().toISOString()
      await models.pips.insertOne({
        id,
        user_id: targetUserId,
        title,
        reason,
        expectations,
        support_plan: supportPlan,
        start_date: startDate,
        end_date: endDate,
        status,
        manager_id: user?.sub || null,
        outcome: null,
        created_at: now,
        updated_at: now,
      })

      const manager = await models.users.findById(user.sub) as any
      await createUserNotification(models, {
        user_id: targetUserId,
        type: 'hr_pip',
        title: `You've been placed on a PIP: ${title}`,
        body: `${startDate} → ${endDate}. Review the plan with ${manager?.full_name || 'your manager'}.`,
        link: `pip:${id}`,
        actor_id: user.sub,
        actor_name: manager?.full_name || 'HR',
        meta: { pip_id: id, status },
      })

      return res.status(201).json({ message: 'PIP created', data: { id } })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.patch('/:id', requireAnyPermission(models, 'hr.pips.manage'), async (req, res) => {
    try {
      const body = req.body || {}
      const pip = await models.pips.findById(String(req.params.id)) as any
      if (!pip) return res.status(404).json({ error: 'PIP not found' })
      const patch: any = { updated_at: new Date().toISOString() }
      if (body.status) patch.status = validateEnum(body.status, PIP_STATUSES, 'Status')
      if (body.outcome !== undefined) {
        patch.outcome = body.outcome === null
          ? null
          : validateLength(String(body.outcome).trim(), 1, 4000, 'Outcome')
      }
      await models.pips.updateById(pip.id, { $set: patch })
      return res.json({ message: 'PIP updated' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.delete('/:id', requireAnyPermission(models, 'hr.pips.manage'), async (req, res) => {
    try {
      await models.pips.deleteById(String(req.params.id))
      return res.json({ message: 'PIP deleted' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to delete' })
    }
  })

  return router
}
