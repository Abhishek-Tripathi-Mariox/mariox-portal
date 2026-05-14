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

const SEVERITIES = ['verbal', 'written', 'final'] as const

export function createWarningsRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  router.get('/', async (req, res) => {
    try {
      const user = req.user as any
      const isManager = await userHasAnyPermission(models, user, 'hr.warnings.manage')
      const userId = typeof req.query.user_id === 'string' ? req.query.user_id : undefined
      const filter: any = {}
      if (!isManager) filter.user_id = user.sub
      else if (userId) filter.user_id = userId

      const [rows, users] = await Promise.all([
        models.warnings.find(filter) as Promise<any[]>,
        models.users.find({}) as Promise<any[]>,
      ])
      const usersById = new Map(users.map((u) => [String(u.id), u]))
      const enriched = rows.map((w) => ({
        ...w,
        full_name: usersById.get(String(w.user_id))?.full_name || null,
        email: usersById.get(String(w.user_id))?.email || null,
        designation: usersById.get(String(w.user_id))?.designation || null,
        avatar_color: usersById.get(String(w.user_id))?.avatar_color || null,
        issued_by_name: w.issued_by ? (usersById.get(String(w.issued_by))?.full_name || null) : null,
      })).sort((a, b) => String(b.warning_date || '').localeCompare(String(a.warning_date || '')))
      return res.json({ data: enriched, warnings: enriched })
    } catch {
      return res.json({ data: [], warnings: [] })
    }
  })

  router.post('/', requireAnyPermission(models, 'hr.warnings.manage'), async (req, res) => {
    try {
      const user = req.user as any
      const body = req.body || {}
      const targetUserId = String(body.user_id || '').trim()
      if (!targetUserId) return res.status(400).json({ error: 'Employee is required' })
      const targetUser = await models.users.findById(targetUserId) as any
      if (!targetUser) return res.status(400).json({ error: 'Employee not found' })

      const severity = validateEnum(body.severity, SEVERITIES, 'Severity')
      const warningDate = validateISODate(body.warning_date, 'Warning date')
      const subject = validateLength(String(body.subject || '').trim(), 1, 200, 'Subject')
      const description = validateLength(String(body.description || '').trim(), 1, 4000, 'Description')
      const actionRequired = validateOptional(body.action_required, (v) => validateLength(String(v).trim(), 1, 2000, 'Action required'))

      const id = generateId('warn')
      const now = new Date().toISOString()
      await models.warnings.insertOne({
        id,
        user_id: targetUserId,
        severity,
        warning_date: warningDate,
        subject,
        description,
        action_required: actionRequired,
        issued_by: user?.sub || null,
        acknowledged: 0,
        created_at: now,
        updated_at: now,
      })

      // Tell the employee
      const issuer = await models.users.findById(user.sub) as any
      await createUserNotification(models, {
        user_id: targetUserId,
        type: 'hr_warning',
        title: `${severity[0].toUpperCase() + severity.slice(1)} warning issued`,
        body: subject,
        link: `warning:${id}`,
        actor_id: user.sub,
        actor_name: issuer?.full_name || 'HR',
        meta: { warning_id: id, severity },
      })

      return res.status(201).json({ message: 'Warning issued', data: { id } })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.patch('/:id/acknowledge', async (req, res) => {
    try {
      const user = req.user as any
      const w = await models.warnings.findById(String(req.params.id)) as any
      if (!w) return res.status(404).json({ error: 'Warning not found' })
      // Only the recipient can acknowledge
      if (w.user_id !== user.sub) return res.status(403).json({ error: 'Forbidden' })
      await models.warnings.updateById(w.id, {
        $set: { acknowledged: 1, acknowledged_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      })
      return res.json({ message: 'Acknowledged' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // Employee response: the recipient gets to put their side of the story on
  // record. Stored alongside the warning so the manager / HR see it
  // immediately. Submitting also flips `acknowledged` to 1 because writing
  // a response is a stronger "seen" signal than just clicking ack.
  router.patch('/:id/respond', async (req, res) => {
    try {
      const user = req.user as any
      const w = await models.warnings.findById(String(req.params.id)) as any
      if (!w) return res.status(404).json({ error: 'Warning not found' })
      if (w.user_id !== user.sub) return res.status(403).json({ error: 'Forbidden: not your warning' })

      const response = validateLength(String(req.body?.response || '').trim(), 1, 4000, 'Response')
      const now = new Date().toISOString()
      await models.warnings.updateById(w.id, {
        $set: {
          response,
          responded_at: now,
          // Writing a response counts as acknowledgement — saves a second click.
          acknowledged: 1,
          acknowledged_at: w.acknowledged_at || now,
          updated_at: now,
        },
      })

      // Tell the issuer so they don't have to keep checking the warnings list.
      if (w.issued_by) {
        const responder = await models.users.findById(user.sub) as any
        await createUserNotification(models, {
          user_id: w.issued_by,
          type: 'hr_warning_response',
          title: `${responder?.full_name || 'Employee'} responded to your warning`,
          body: `Subject: ${w.subject}`,
          link: `warning:${w.id}`,
          actor_id: user.sub,
          actor_name: responder?.full_name || 'Employee',
          meta: { warning_id: w.id },
        })
      }
      return res.json({ message: 'Response submitted' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.delete('/:id', requireAnyPermission(models, 'hr.warnings.manage'), async (req, res) => {
    try {
      await models.warnings.deleteById(String(req.params.id))
      return res.json({ message: 'Warning deleted' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to delete' })
    }
  })

  return router
}
