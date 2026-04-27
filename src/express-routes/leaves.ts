import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, requireRole } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'
import {
  validateEnum,
  validateISODate,
  validateLength,
  validateOptional,
  validateRange,
  respondWithError,
} from '../validators'

const LEAVE_TYPES = ['casual', 'sick', 'earned', 'unpaid', 'maternity', 'paternity', 'wfh', 'other'] as const
const LEAVE_APPROVAL_STATUSES = ['approved', 'rejected', 'pending'] as const

export function createLeavesRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  router.get('/', async (req, res) => {
    try {
      const user = req.user as any
      const userId = typeof req.query.user_id === 'string' ? req.query.user_id : undefined
      const filter: any = {}
      const role = String(user?.role || '').toLowerCase()
      if (role === 'developer' || role === 'team') filter.user_id = user.sub
      else if (userId) filter.user_id = userId
      const [leaves, users] = await Promise.all([
        models.leaves.find(filter) as Promise<any[]>,
        models.users.find({}) as Promise<any[]>,
      ])
      const usersById = new Map(users.map((u) => [String(u.id), u]))
      const enriched = leaves.map((l) => ({
        ...l,
        full_name: usersById.get(String(l.user_id))?.full_name || null,
        avatar_color: usersById.get(String(l.user_id))?.avatar_color || null,
      })).sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || ''))).slice(0, 100)
      return res.json({ data: enriched, leaves: enriched })
    } catch {
      return res.json({ data: [], leaves: [] })
    }
  })

  router.post('/', async (req, res) => {
    try {
      const user = req.user as any
      const body = req.body || {}
      const role = String(user?.role || '').toLowerCase()
      const leaveType = validateEnum(body.leave_type, LEAVE_TYPES, 'Leave type')
      const startDate = validateISODate(body.start_date, 'Start date')
      const endDate = validateISODate(body.end_date, 'End date')
      if (startDate > endDate) {
        return res.status(400).json({ error: 'End date must be on or after start date' })
      }
      const daysCount = body.days_count !== undefined
        ? validateRange(body.days_count, 0.5, 365, 'Days count')
        : 0
      const reason = validateOptional(body.reason, (v) => validateLength(String(v).trim(), 1, 1000, 'Reason'))
      const targetUserId = (role === 'developer' || role === 'team') ? user.sub : (body.user_id || user.sub)
      const id = generateId('lv')
      const now = new Date().toISOString()
      await models.leaves.insertOne({
        id,
        user_id: targetUserId,
        leave_type: leaveType,
        start_date: startDate,
        end_date: endDate,
        days_count: daysCount,
        reason,
        status: (role === 'developer' || role === 'team') ? 'pending' : 'approved',
        approved_by: (role === 'developer' || role === 'team') ? null : user?.sub,
        created_at: now,
        updated_at: now,
      })
      return res.status(201).json({ message: 'Leave submitted', data: { id } })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.patch('/:id/approve', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
      const user = req.user as any
      const status = validateEnum(req.body?.status, LEAVE_APPROVAL_STATUSES, 'Status')
      await models.leaves.updateById(String(req.params.id), {
        $set: { status, approved_by: user?.sub || null, updated_at: new Date().toISOString() },
      })
      return res.json({ message: `Leave ${status}` })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.delete('/:id', async (req, res) => {
    try {
      await models.leaves.deleteById(String(req.params.id))
      return res.json({ message: 'Leave deleted' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to delete leave' })
    }
  })

  return router
}
