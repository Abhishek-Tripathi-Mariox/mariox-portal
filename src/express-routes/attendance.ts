import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, requireAnyPermission, userHasAnyPermission } from '../express-middleware/auth'
import { mergeCustomValues } from './entity-columns'
import { generateId } from '../utils/helpers'
import {
  validateEnum,
  validateISODate,
  validateLength,
  validateOptional,
  respondWithError,
} from '../validators'

const ATTENDANCE_STATUSES = ['present', 'absent', 'half_day', 'late', 'on_leave', 'holiday'] as const
const APPROVAL_DECISIONS = ['approved', 'rejected'] as const
// Break categories the UI surfaces in the Start Break dialog. The list is
// intentionally small + opinionated — admins who want custom break kinds
// can extend later via the catalogue. Stored on each break entry so HR can
// audit time-off-task patterns (e.g. who's taking long lunches).
const BREAK_KINDS = ['tea', 'lunch', 'personal', 'meeting', 'other'] as const

// All attendance dates/times are in IST (Asia/Kolkata). The server may run in
// UTC, so we shift "now" by +5:30 and read the UTC components — IST has no DST,
// so a fixed offset is exact. This fixes punch times showing 5:30 behind.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000
function istNow() {
  return new Date(Date.now() + IST_OFFSET_MS)
}

// Returns YYYY-MM-DD for today in IST.
function todayISO() {
  const d = istNow()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

// Returns HH:mm in IST.
function nowHHMM() {
  const d = istNow()
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

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
        const set: any = { status, check_in: checkIn, check_out: checkOut, note, updated_at: now }
        // Custom-column values (see /api/attendance-columns), merged so a
        // single-field edit doesn't wipe the others.
        if ('custom_values' in body) set.custom_values = mergeCustomValues(existing.custom_values, body.custom_values)
        await models.attendance.updateById(existing.id, { $set: set })
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
        custom_values: mergeCustomValues({}, body.custom_values),
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
  // tally a 500-row response client-side. Also rolls up worked / break
  // totals so the table can surface a real "productivity" view, not just
  // status counts.
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

      // Build per-user counts + productivity rollups.
      const byUser = new Map<string, any>()
      for (const u of users) {
        byUser.set(String(u.id), {
          user_id: u.id,
          full_name: u.full_name,
          email: u.email,
          designation: u.designation || null,
          role: u.role || null,
          avatar_color: u.avatar_color || null,
          present: 0, absent: 0, half_day: 0, late: 0, on_leave: 0, holiday: 0, total: 0,
          worked_minutes: 0,       // sum of working_minutes across the month
          break_minutes: 0,        // sum of completed break durations
          break_count: 0,          // number of breaks taken in the month
          days_worked: 0,          // days with a check_in (regardless of approval)
          pending_approval: 0,     // attendance rows still awaiting HR decision
        })
      }
      for (const r of rows) {
        const entry = byUser.get(String(r.user_id))
        if (!entry) continue
        const k = String(r.status || '')
        if (entry[k] !== undefined) entry[k] += 1
        entry.total += 1
        entry.worked_minutes += Number(r.working_minutes) || 0
        if (r.check_in) entry.days_worked += 1
        if ((r.approval_status || 'pending') === 'pending') entry.pending_approval += 1
        // Sum break minutes from each completed break entry on this row.
        if (Array.isArray(r.breaks)) {
          for (const b of r.breaks) {
            if (!b?.start || !b?.end) continue
            const [sh, sm] = String(b.start).split(':').map(Number)
            const [eh, em] = String(b.end).split(':').map(Number)
            if ([sh, sm, eh, em].every(Number.isFinite)) {
              entry.break_minutes += Math.max(0, (eh * 60 + em) - (sh * 60 + sm))
              entry.break_count += 1
            }
          }
        }
      }
      const summary = Array.from(byUser.values())
        .map((e) => ({
          ...e,
          avg_daily_minutes: e.days_worked > 0 ? Math.round(e.worked_minutes / e.days_worked) : 0,
        }))
        .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')))
      return res.json({ data: summary, summary, month })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // User-self punch in/out/break. Writes (or upserts) today's attendance row.
  //
  // Schema additions over the legacy row:
  //   check_in_location  / check_out_location  → { lat, lng, accuracy, captured_at } | null
  //   breaks             → [{ start, start_location, end, end_location }]
  //   on_break           → true while a break is open (start without end)
  //   working_minutes    → (check_out - check_in) - sum(completed-break durations).
  //                        Computed on every punch-out and on every break_end.
  //
  // Actions:
  //   'in'           → first punch of the day; rejects double check-in
  //   'out'          → closes the day; auto-ends any open break first
  //   'break_start'  → opens a new break; requires prior check_in + not on_break
  //   'break_end'    → closes the active break; requires on_break === true
  function _coerceLocation(input: any): any | null {
    if (!input || typeof input !== 'object') return null
    const lat = Number(input.lat)
    const lng = Number(input.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    const accuracy = Number(input.accuracy)
    return {
      lat,
      lng,
      accuracy: Number.isFinite(accuracy) ? accuracy : null,
      captured_at: new Date().toISOString(),
    }
  }
  // Returns minutes between two "HH:mm" strings on the same calendar day.
  // Robust to invalid input — returns 0.
  function _minutesBetween(start: string | null | undefined, end: string | null | undefined): number {
    if (!start || !end) return 0
    const [sh, sm] = String(start).split(':').map(Number)
    const [eh, em] = String(end).split(':').map(Number)
    if (![sh, sm, eh, em].every(Number.isFinite)) return 0
    return Math.max(0, (eh * 60 + em) - (sh * 60 + sm))
  }
  function _sumBreakMinutes(breaks: any[]): number {
    if (!Array.isArray(breaks)) return 0
    let total = 0
    for (const b of breaks) {
      if (b?.start && b?.end) total += _minutesBetween(b.start, b.end)
    }
    return total
  }
  // Index of the currently-open session (a punch-in without a punch-out), or -1.
  function _openSessionIdx(sessions: any[]): number {
    if (!Array.isArray(sessions)) return -1
    for (let i = sessions.length - 1; i >= 0; i--) if (sessions[i] && !sessions[i].out) return i
    return -1
  }
  // Total worked minutes across all completed in→out sessions in the day.
  function _sumSessionMinutes(sessions: any[]): number {
    if (!Array.isArray(sessions)) return 0
    let total = 0
    for (const s of sessions) if (s?.in && s?.out) total += _minutesBetween(s.in, s.out)
    return total
  }
  // Back-compat: legacy rows stored a single check_in/check_out and no
  // `sessions` array. Derive one session from them so the multi-session code
  // works on old data too.
  function _sessionsOf(row: any): any[] {
    if (Array.isArray(row?.sessions) && row.sessions.length) return row.sessions.map((s: any) => ({ ...s }))
    if (row?.check_in) return [{ in: row.check_in, in_location: row.check_in_location || null, out: row.check_out || null, out_location: row.check_out_location || null }]
    return []
  }

  router.post('/punch', async (req, res) => {
    try {
      const user = req.user as any
      if (!user?.sub) return res.status(401).json({ error: 'Unauthenticated' })
      const action = String(req.body?.action || '').toLowerCase()
      const VALID = new Set(['in', 'out', 'break_start', 'break_end'])
      if (!VALID.has(action)) {
        return res.status(400).json({ error: 'action must be one of: in, out, break_start, break_end' })
      }
      const location = _coerceLocation(req.body?.location)
      const date = todayISO()
      const time = nowHHMM()
      const now = new Date().toISOString()
      const existing = await models.attendance.findOne({ user_id: user.sub, date }) as any

      // Multiple punch-in / punch-out sessions per day are allowed: each
      // punch-in opens a new session, each punch-out closes the open one.
      // `check_in` = first in of the day, `check_out` = last out (null while a
      // session is open). working_minutes = sum of all completed sessions − breaks.
      const sessions: any[] = existing ? _sessionsOf(existing) : []
      const openIdx = _openSessionIdx(sessions)

      // ── PUNCH IN ────────────────────────────────────────────────
      if (action === 'in') {
        if (openIdx !== -1) {
          return res.status(409).json({ error: 'Already punched in — punch out before punching in again', data: existing })
        }
        sessions.push({ in: time, in_location: location, out: null, out_location: null })
        const firstIn = (existing && existing.check_in) || sessions[0]?.in || time
        const baseFields: Record<string, unknown> = {
          status: 'present',
          sessions,
          check_in: firstIn,
          check_in_location: (existing && existing.check_in_location) || location,
          check_out: null,          // a session is open again → not yet "out"
          check_out_location: null,
          approval_status: 'pending',
          on_break: false,
          working_minutes: Math.max(0, _sumSessionMinutes(sessions) - _sumBreakMinutes(existing?.breaks || [])),
          updated_at: now,
        }
        if (existing) {
          await models.attendance.updateById(existing.id, { $set: baseFields })
          const updated = await models.attendance.findById(existing.id)
          return res.json({ message: 'Punched in', data: updated })
        }
        const id = generateId('att')
        const doc = {
          id,
          user_id: user.sub,
          date,
          note: null,
          breaks: [],
          created_at: now,
          ...baseFields,
        }
        await models.attendance.insertOne(doc)
        return res.status(201).json({ message: 'Punched in', data: doc })
      }

      // ── PUNCH OUT / BREAKS — all require an OPEN session ──────
      if (!existing || openIdx === -1) {
        return res.status(400).json({ error: 'You are not punched in — punch in first' })
      }
      const breaks: any[] = Array.isArray(existing.breaks) ? existing.breaks.map((b: any) => ({ ...b })) : []
      const isOnBreak = !!existing.on_break

      if (action === 'break_start') {
        if (isOnBreak) {
          return res.status(409).json({ error: 'A break is already in progress' })
        }
        // What kind of break + how long the user expects to be away. Both are
        // optional in the request — if missing we default to 'other' / null —
        // but the dialog on the frontend always sends them.
        const rawKind = String(req.body?.kind || 'other').toLowerCase()
        const kind = (BREAK_KINDS as readonly string[]).includes(rawKind) ? rawKind : 'other'
        let plannedMinutes: number | null = null
        if (req.body?.planned_minutes !== undefined && req.body?.planned_minutes !== null && req.body?.planned_minutes !== '') {
          const n = Math.round(Number(req.body.planned_minutes))
          if (!Number.isFinite(n) || n < 1 || n > 240) {
            return res.status(400).json({ error: 'planned_minutes must be between 1 and 240' })
          }
          plannedMinutes = n
        }
        const note = validateOptional(req.body?.note, (v) => validateLength(String(v).trim(), 1, 200, 'Note'))
        breaks.push({
          start: time,
          start_location: location,
          end: null,
          end_location: null,
          kind,
          planned_minutes: plannedMinutes,
          note: note || null,
        })
        await models.attendance.updateById(existing.id, {
          $set: { breaks, on_break: true, approval_status: 'pending', updated_at: now },
        })
        const updated = await models.attendance.findById(existing.id)
        return res.json({ message: 'Break started', data: updated })
      }

      if (action === 'break_end') {
        if (!isOnBreak) {
          return res.status(409).json({ error: 'No active break to end' })
        }
        // Close the latest open break (last entry without an `end`).
        for (let i = breaks.length - 1; i >= 0; i--) {
          if (!breaks[i].end) {
            breaks[i] = { ...breaks[i], end: time, end_location: location }
            break
          }
        }
        // Worked time = all completed sessions − total break time.
        const workingMinutes = Math.max(0, _sumSessionMinutes(sessions) - _sumBreakMinutes(breaks))
        await models.attendance.updateById(existing.id, {
          $set: {
            breaks,
            on_break: false,
            working_minutes: workingMinutes,
            approval_status: 'pending',
            updated_at: now,
          },
        })
        const updated = await models.attendance.findById(existing.id)
        return res.json({ message: 'Break ended', data: updated })
      }

      // ── PUNCH OUT ───────────────────────────────────────────────
      // Auto-close any open break — the user shouldn't end the session still on
      // break. We end the break at the same instant as the punch-out.
      if (isOnBreak) {
        for (let i = breaks.length - 1; i >= 0; i--) {
          if (!breaks[i].end) {
            breaks[i] = { ...breaks[i], end: time, end_location: location }
            break
          }
        }
      }
      // Close the open session.
      sessions[openIdx] = { ...sessions[openIdx], out: time, out_location: location }
      const workingMinutes = Math.max(0, _sumSessionMinutes(sessions) - _sumBreakMinutes(breaks))
      await models.attendance.updateById(existing.id, {
        $set: {
          sessions,
          check_out: time,           // last out of the day
          check_out_location: location,
          breaks,
          on_break: false,
          working_minutes: workingMinutes,
          approval_status: 'pending',
          updated_at: now,
        },
      })
      const updated = await models.attendance.findById(existing.id)
      return res.json({ message: 'Punched out', data: updated })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // Calling user's today record — used by the attendance page header to
  // show current state and toggle the punch-in / punch-out button.
  router.get('/today', async (req, res) => {
    try {
      const user = req.user as any
      if (!user?.sub) return res.status(401).json({ error: 'Unauthenticated' })
      const row = await models.attendance.findOne({ user_id: user.sub, date: todayISO() }) as any
      return res.json({ data: row || null })
    } catch {
      return res.json({ data: null })
    }
  })

  // HR approves / rejects a daily attendance row. Reason is required for
  // rejections so the employee gets context.
  router.patch('/:id/decision', requireAnyPermission(models, 'hr.attendance.manage'), async (req, res) => {
    try {
      const user = req.user as any
      const decision = validateEnum(req.body?.decision, APPROVAL_DECISIONS, 'Decision')
      let reason: string | null = null
      if (req.body?.reason !== undefined && req.body?.reason !== null && String(req.body.reason).trim() !== '') {
        reason = validateLength(String(req.body.reason).trim(), 1, 500, 'Reason')
      }
      if (decision === 'rejected' && !reason) {
        return res.status(400).json({ error: 'Reason is required when rejecting' })
      }
      const row = await models.attendance.findById(String(req.params.id)) as any
      if (!row) return res.status(404).json({ error: 'Attendance row not found' })
      const now = new Date().toISOString()
      await models.attendance.updateById(row.id, {
        $set: {
          approval_status: decision,
          decision_reason: reason,
          decided_by: String(user?.sub || ''),
          decided_at: now,
          updated_at: now,
        },
      })
      const updated = await models.attendance.findById(row.id)
      return res.json({ message: `Attendance ${decision}`, data: updated })
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
