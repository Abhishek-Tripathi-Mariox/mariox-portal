import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, userHasAnyPermission } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'
import {
  validateEnum,
  validateISODate,
  validateLength,
  validateOptional,
  respondWithError,
} from '../validators'

const EVENT_TYPES = ['meeting', 'holiday', 'birthday', 'anniversary', 'training', 'event', 'other'] as const
const VISIBILITIES = ['personal', 'company'] as const

// HH:MM (24-hour). Empty string is allowed and means "no specific time" /
// all-day. We keep the format string + start_date separate so the same
// event can span a date range with only a time-of-day note.
function validateTimeOfDay(value: any, fieldName: string): string | null {
  if (value === undefined || value === null || value === '') return null
  const trimmed = String(value).trim()
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(trimmed)) {
    throw new Error(`${fieldName} must be in HH:MM (24-hour) format`)
  }
  return trimmed
}

export function createCalendarRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  // Every authenticated user sees:
  //   - all company-visibility events (holidays, all-hands, etc.), AND
  //   - their own personal events (client meetings, reminders, etc.)
  //
  // Older rows that pre-date the visibility field are treated as `company`
  // so existing data doesn't disappear.
  router.get('/', async (req, res) => {
    try {
      const user = req.user as any
      const events = await models.calendarEvents.find({
        $or: [
          { visibility: 'company' },
          { visibility: { $exists: false } },
          { visibility: 'personal', created_by: user.sub },
        ],
      }) as any[]
      const sorted = events.sort((a, b) =>
        String(a.start_date || '').localeCompare(String(b.start_date || '')),
      )
      return res.json({ data: sorted, events: sorted })
    } catch {
      return res.json({ data: [], events: [] })
    }
  })

  // Anyone authenticated can create a PERSONAL event for themselves.
  // Company events still require hr.calendar.manage — they're public so
  // we can't let any user fill the team calendar with global noise.
  router.post('/', async (req, res) => {
    try {
      const user = req.user as any
      const body = req.body || {}
      const visibility = validateEnum(body.visibility || 'personal', VISIBILITIES, 'Visibility')
      if (visibility === 'company') {
        const ok = await userHasAnyPermission(models, user, 'hr.calendar.manage')
        if (!ok) return res.status(403).json({ error: 'Forbidden: company events need hr.calendar.manage' })
      }
      const title = validateLength(String(body.title || '').trim(), 1, 200, 'Title')
      const eventType = validateEnum(body.event_type, EVENT_TYPES, 'Event type')
      const startDate = validateISODate(body.start_date, 'Start date')
      const endDate = body.end_date ? validateISODate(body.end_date, 'End date') : startDate
      if (startDate > endDate) {
        return res.status(400).json({ error: 'End date must be on or after start date' })
      }
      const startTime = validateTimeOfDay(body.start_time, 'Start time')
      const endTime = validateTimeOfDay(body.end_time, 'End time')
      const description = validateOptional(body.description, (v) => validateLength(String(v).trim(), 1, 2000, 'Description'))
      const color = validateOptional(body.color, (v) => validateLength(String(v).trim(), 1, 32, 'Color'))
      const id = generateId('cal')
      const now = new Date().toISOString()
      await models.calendarEvents.insertOne({
        id,
        title,
        event_type: eventType,
        visibility,
        start_date: startDate,
        end_date: endDate,
        start_time: startTime,
        end_time: endTime,
        description,
        color: color || (visibility === 'personal' ? '#A8C8FF' : '#FF7A45'),
        created_by: user?.sub || null,
        created_at: now,
        updated_at: now,
      })
      return res.status(201).json({ message: 'Event created', data: { id } })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // Owner can always delete their own personal event. Company events require
  // hr.calendar.manage. Anything else is forbidden so users can't nuke each
  // others' personal events even if they guess the id.
  router.delete('/:id', async (req, res) => {
    try {
      const user = req.user as any
      const event = await models.calendarEvents.findById(String(req.params.id)) as any
      if (!event) return res.status(404).json({ error: 'Event not found' })
      const visibility = event.visibility || 'company'
      if (visibility === 'personal') {
        if (event.created_by !== user.sub) {
          return res.status(403).json({ error: 'Forbidden: not your event' })
        }
      } else {
        const ok = await userHasAnyPermission(models, user, 'hr.calendar.manage')
        if (!ok) return res.status(403).json({ error: 'Forbidden' })
      }
      await models.calendarEvents.deleteById(event.id)
      return res.json({ message: 'Event deleted' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to delete' })
    }
  })

  return router
}
