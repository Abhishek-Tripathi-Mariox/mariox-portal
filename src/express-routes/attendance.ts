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

const ATTENDANCE_STATUSES = ['present', 'absent', 'half_day', 'late', 'on_leave', 'holiday'] as const

export function createAttendanceRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  // Admins / users with hr.attendance.manage see everything. Everyone else
  // only sees their own rows.
  router.get('/', async (req, res) => {
    try {
      const user = req.user as any
      const isManager = await userHasAnyPermission(models, user, 'hr.attendance.manage')
      const userId = typeof req.query.user_id === 'string' ? req.query.user_id : undefined
      const date = typeof req.query.date === 'string' ? req.query.date : undefined
      const filter: any = {}
      if (!isManager) filter.user_id = user.sub
      else if (userId) filter.user_id = userId
      if (date) filter.date = date

      const [rows, users] = await Promise.all([
        models.attendance.find(filter) as Promise<any[]>,
        models.users.find({}) as Promise<any[]>,
      ])
      const usersById = new Map(users.map((u) => [String(u.id), u]))
      const enriched = rows
        .map((r) => ({
          ...r,
          full_name: usersById.get(String(r.user_id))?.full_name || null,
          email: usersById.get(String(r.user_id))?.email || null,
          designation: usersById.get(String(r.user_id))?.designation || null,
          avatar_color: usersById.get(String(r.user_id))?.avatar_color || null,
        }))
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
        .slice(0, 500)
      return res.json({ data: enriched, attendance: enriched })
    } catch {
      return res.json({ data: [], attendance: [] })
    }
  })

  router.post('/', requireAnyPermission(models, 'hr.attendance.manage'), async (req, res) => {
    try {
      const body = req.body || {}
      const targetUserId = String(body.user_id || '').trim()
      if (!targetUserId) return res.status(400).json({ error: 'Employee is required' })
      const targetUser = await models.users.findById(targetUserId) as any
      if (!targetUser) return res.status(400).json({ error: 'Employee not found' })

      const date = validateISODate(body.date, 'Date')
      const status = validateEnum(body.status, ATTENDANCE_STATUSES, 'Status')
      const checkIn = validateOptional(body.check_in, (v) => validateLength(String(v).trim(), 1, 16, 'Check-in'))
      const checkOut = validateOptional(body.check_out, (v) => validateLength(String(v).trim(), 1, 16, 'Check-out'))
      const note = validateOptional(body.note, (v) => validateLength(String(v).trim(), 1, 500, 'Note'))

      // One row per (user_id, date). If it already exists, update in place.
      const existing = await models.attendance.findOne({ user_id: targetUserId, date }) as any
      const now = new Date().toISOString()
      if (existing) {
        await models.attendance.updateById(existing.id, {
          $set: { status, check_in: checkIn, check_out: checkOut, note, updated_at: now },
        })
        return res.json({ message: 'Attendance updated', data: { id: existing.id } })
      }
      const id = generateId('att')
      await models.attendance.insertOne({
        id,
        user_id: targetUserId,
        date,
        status,
        check_in: checkIn,
        check_out: checkOut,
        note,
        created_at: now,
        updated_at: now,
      })
      return res.status(201).json({ message: 'Attendance recorded', data: { id } })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // Bulk-mark attendance: same date + status for many employees in one go.
  // Upserts per (user_id, date) — re-marking the same day is idempotent.
  router.post('/bulk', requireAnyPermission(models, 'hr.attendance.manage'), async (req, res) => {
    try {
      const body = req.body || {}
      const date = validateISODate(body.date, 'Date')
      const status = validateEnum(body.status, ATTENDANCE_STATUSES, 'Status')
      const userIds: string[] = Array.isArray(body.user_ids) ? body.user_ids.map(String) : []
      if (userIds.length === 0) return res.status(400).json({ error: 'At least one employee is required' })
      if (userIds.length > 500) return res.status(400).json({ error: 'Too many employees in one request' })

      const note = validateOptional(body.note, (v) => validateLength(String(v).trim(), 1, 500, 'Note'))
      const now = new Date().toISOString()
      let inserted = 0
      let updated = 0

      for (const uid of userIds) {
        const targetUser = await models.users.findById(uid) as any
        if (!targetUser) continue
        const existing = await models.attendance.findOne({ user_id: uid, date }) as any
        if (existing) {
          await models.attendance.updateById(existing.id, {
            $set: { status, note, updated_at: now },
          })
          updated += 1
        } else {
          await models.attendance.insertOne({
            id: generateId('att'),
            user_id: uid,
            date,
            status,
            check_in: null,
            check_out: null,
            note,
            created_at: now,
            updated_at: now,
          })
          inserted += 1
        }
      }
      return res.json({ message: 'Bulk attendance saved', data: { inserted, updated, total: inserted + updated } })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // Monthly summary: aggregate counts per employee for a YYYY-MM month. Used
  // by the Attendance "Summary" tab — far cheaper than letting the client
  // tally a 500-row response client-side.
  router.get('/summary', requireAnyPermission(models, 'hr.attendance.manage'), async (req, res) => {
    try {
      const month = typeof req.query.month === 'string' ? req.query.month : ''
      if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month must be in YYYY-MM format' })
      const start = `${month}-01`
      const [y, m] = month.split('-').map(Number)
      const end = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`

      const [rows, users] = await Promise.all([
        models.attendance.find({ date: { $gte: start, $lte: end } }) as Promise<any[]>,
        models.users.find({ is_active: 1 }) as Promise<any[]>,
      ])

      // Build per-user counts.
      const byUser = new Map<string, any>()
      for (const u of users) {
        byUser.set(String(u.id), {
          user_id: u.id,
          full_name: u.full_name,
          email: u.email,
          designation: u.designation || null,
          avatar_color: u.avatar_color || null,
          present: 0, absent: 0, half_day: 0, late: 0, on_leave: 0, holiday: 0, total: 0,
        })
      }
      for (const r of rows) {
        const entry = byUser.get(String(r.user_id))
        if (!entry) continue
        const k = String(r.status || '')
        if (entry[k] !== undefined) entry[k] += 1
        entry.total += 1
      }
      const summary = Array.from(byUser.values()).sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')))
      return res.json({ data: summary, summary, month })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.delete('/:id', requireAnyPermission(models, 'hr.attendance.manage'), async (req, res) => {
    try {
      await models.attendance.deleteById(String(req.params.id))
      return res.json({ message: 'Attendance deleted' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to delete' })
    }
  })

  return router
}
