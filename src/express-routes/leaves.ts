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
import { createUserNotification, createUserNotifications } from './notifications'

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
        email: usersById.get(String(l.user_id))?.email || null,
        designation: usersById.get(String(l.user_id))?.designation || null,
        avatar_color: usersById.get(String(l.user_id))?.avatar_color || null,
        approved_by_name: l.approved_by ? (usersById.get(String(l.approved_by))?.full_name || null) : null,
      })).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 100)
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
      // External team accounts go through their own contracted process — they
      // don't apply for company leave through this portal. Defence-in-depth so
      // even if a stale frontend exposes the form, the API rejects.
      if (role === 'team') {
        return res.status(403).json({ error: 'Team accounts cannot apply for leave through this portal' })
      }
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
      // Manager applying on someone else's behalf is allowed; otherwise self only.
      // Guard: if the client sent the literal string "undefined" (caused by a stale
      // _user object on the frontend), fall back to the JWT's user.sub which is
      // always trustworthy.
      const rawBodyUserId = typeof body.user_id === 'string' ? body.user_id.trim() : ''
      const safeBodyUserId = (rawBodyUserId && rawBodyUserId !== 'undefined' && rawBodyUserId !== 'null') ? rawBodyUserId : ''
      // Non-managers can only file leave for themselves; managers may file on behalf.
      const isManagerRole = role === 'admin' || role === 'pm' || role === 'pc'
      const targetUserId = isManagerRole ? (safeBodyUserId || user.sub) : user.sub
      // Make sure the user_id we're about to attach to the leave actually exists,
      // otherwise the leave list will show "Unknown employee" forever.
      const targetUser = await models.users.findById(targetUserId) as any
      if (!targetUser) {
        return res.status(400).json({ error: 'Could not resolve the employee for this leave' })
      }
      const id = generateId('lv')
      const now = new Date().toISOString()
      // Every leave starts as pending — managers can review/approve their own.
      await models.leaves.insertOne({
        id,
        user_id: targetUserId,
        leave_type: leaveType,
        start_date: startDate,
        end_date: endDate,
        days_count: daysCount,
        reason,
        status: 'pending',
        approved_by: null,
        created_at: now,
        updated_at: now,
      })

      // Leave requests go ONLY to admins — PMs/PCs were getting noise on every leave.
      // The helper auto-excludes the actor so an admin filing their own leave doesn't self-ping.
      const applicantName = targetUser?.full_name || targetUser?.email || 'Someone'
      const admins = await models.users.find({ role: 'admin', is_active: 1 }) as any[]
      await createUserNotifications(
        models,
        admins.map((u) => u.id),
        {
          type: 'leave_request',
          title: `Leave request from ${applicantName}`,
          body: `${leaveType} · ${startDate} → ${endDate} (${daysCount} day${daysCount === 1 ? '' : 's'})${reason ? ' — ' + reason : ''}`,
          link: `leave:${id}`,
          actor_id: user.sub,
          actor_name: applicantName,
          meta: { leave_id: id, user_id: targetUserId },
        },
      )
      // If a manager applied on behalf of someone else, also ping that employee
      if (targetUserId !== user.sub) {
        const actor = await models.users.findById(user.sub) as any
        await createUserNotification(models, {
          user_id: targetUserId,
          type: 'leave_request',
          title: `${actor?.full_name || 'A manager'} filed a leave for you`,
          body: `${leaveType} · ${startDate} → ${endDate} (${daysCount} day${daysCount === 1 ? '' : 's'})`,
          link: `leave:${id}`,
          actor_id: user.sub,
          actor_name: actor?.full_name || 'Manager',
          meta: { leave_id: id, user_id: targetUserId },
        })
      }
      return res.status(201).json({ message: 'Leave submitted', data: { id } })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.patch('/:id/approve', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
      const user = req.user as any
      const status = validateEnum(req.body?.status, LEAVE_APPROVAL_STATUSES, 'Status')
      const rawReason = typeof req.body?.decision_reason === 'string' ? req.body.decision_reason.trim() : ''
      const decisionReason = rawReason
        ? validateLength(rawReason, 1, 1000, 'Decision reason')
        : null
      const leave = await models.leaves.findById(String(req.params.id)) as any
      if (!leave) return res.status(404).json({ error: 'Leave not found' })
      await models.leaves.updateById(leave.id, {
        $set: {
          status,
          approved_by: user?.sub || null,
          decision_reason: decisionReason,
          decided_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      })

      // Notify the applicant about the decision
      const approver = await models.users.findById(user.sub) as any
      const approverName = approver?.full_name || approver?.email || 'Manager'
      if (leave.user_id && leave.user_id !== user.sub) {
        const reasonSuffix = decisionReason ? ` — Reason: ${decisionReason}` : ''
        await createUserNotification(models, {
          user_id: leave.user_id,
          type: status === 'approved' ? 'leave_approved' : 'leave_rejected',
          title: status === 'approved' ? 'Leave approved' : 'Leave rejected',
          body: `${approverName} ${status} your ${leave.leave_type} leave (${leave.start_date} → ${leave.end_date})${reasonSuffix}`,
          link: `leave:${leave.id}`,
          actor_id: user.sub,
          actor_name: approverName,
          meta: { leave_id: leave.id, status, decision_reason: decisionReason },
        })
      }
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
