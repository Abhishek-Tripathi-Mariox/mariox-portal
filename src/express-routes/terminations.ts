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

const TERMINATION_TYPES = ['resignation', 'dismissal', 'layoff', 'retirement', 'contract_end', 'other'] as const
const TERMINATION_STATUSES = ['initiated', 'notice_period', 'completed', 'cancelled'] as const

export function createTerminationsRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  router.get('/', async (req, res) => {
    try {
      const user = req.user as any
      const isManager = await userHasAnyPermission(models, user, 'hr.terminations.manage')
      if (!isManager) {
        // Employees should only see their own termination record (if it exists).
        const rows = await models.terminations.find({ user_id: user.sub }) as any[]
        return res.json({ data: rows, terminations: rows })
      }
      const userId = typeof req.query.user_id === 'string' ? req.query.user_id : undefined
      const filter: any = {}
      if (userId) filter.user_id = userId

      const [rows, users] = await Promise.all([
        models.terminations.find(filter) as Promise<any[]>,
        models.users.find({}) as Promise<any[]>,
      ])
      const usersById = new Map(users.map((u) => [String(u.id), u]))
      const enriched = rows.map((t) => ({
        ...t,
        full_name: usersById.get(String(t.user_id))?.full_name || null,
        email: usersById.get(String(t.user_id))?.email || null,
        designation: usersById.get(String(t.user_id))?.designation || null,
        avatar_color: usersById.get(String(t.user_id))?.avatar_color || null,
        initiated_by_name: t.initiated_by ? (usersById.get(String(t.initiated_by))?.full_name || null) : null,
      })).sort((a, b) => String(b.termination_date || '').localeCompare(String(a.termination_date || '')))
      return res.json({ data: enriched, terminations: enriched })
    } catch {
      return res.json({ data: [], terminations: [] })
    }
  })

  router.post('/', requireAnyPermission(models, 'hr.terminations.manage'), async (req, res) => {
    try {
      const user = req.user as any
      const body = req.body || {}
      const targetUserId = String(body.user_id || '').trim()
      if (!targetUserId) return res.status(400).json({ error: 'Employee is required' })
      const targetUser = await models.users.findById(targetUserId) as any
      if (!targetUser) return res.status(400).json({ error: 'Employee not found' })

      const terminationType = validateEnum(body.termination_type, TERMINATION_TYPES, 'Termination type')
      const status = body.status ? validateEnum(body.status, TERMINATION_STATUSES, 'Status') : 'initiated'
      const noticeDate = body.notice_date ? validateISODate(body.notice_date, 'Notice date') : null
      const terminationDate = validateISODate(body.termination_date, 'Termination date')
      const reason = validateLength(String(body.reason || '').trim(), 1, 4000, 'Reason')
      const exitNotes = validateOptional(body.exit_notes, (v) => validateLength(String(v).trim(), 1, 4000, 'Exit notes'))
      const handoverNotes = validateOptional(body.handover_notes, (v) => validateLength(String(v).trim(), 1, 4000, 'Handover notes'))

      const id = generateId('term')
      const now = new Date().toISOString()
      await models.terminations.insertOne({
        id,
        user_id: targetUserId,
        termination_type: terminationType,
        status,
        notice_date: noticeDate,
        termination_date: terminationDate,
        reason,
        exit_notes: exitNotes,
        handover_notes: handoverNotes,
        initiated_by: user?.sub || null,
        created_at: now,
        updated_at: now,
      })
      return res.status(201).json({ message: 'Termination recorded', data: { id } })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // Update the offboarding checklist on a termination record. Stored as a
  // free-form JSON map { key: boolean } so the UI can evolve the checklist
  // without a schema change (e.g. add "Knowledge-transfer doc reviewed" later).
  router.patch('/:id/checklist', requireAnyPermission(models, 'hr.terminations.manage'), async (req, res) => {
    try {
      const term = await models.terminations.findById(String(req.params.id)) as any
      if (!term) return res.status(404).json({ error: 'Termination not found' })
      const body = req.body || {}
      if (!body.checklist || typeof body.checklist !== 'object') {
        return res.status(400).json({ error: 'checklist must be an object of {key: boolean}' })
      }
      // Normalize: only accept keys we know about so a hostile client can't
      // stuff arbitrary fields into the document.
      const allowed = ['laptop_returned', 'access_revoked', 'nda_signed', 'dues_cleared', 'handover_done', 'exit_interview_done', 'final_settlement_paid']
      const sanitized: Record<string, boolean> = {}
      for (const key of allowed) {
        if (body.checklist[key] !== undefined) sanitized[key] = Boolean(body.checklist[key])
      }
      await models.terminations.updateById(term.id, {
        $set: { checklist: sanitized, updated_at: new Date().toISOString() },
      })
      return res.json({ message: 'Checklist updated', data: { checklist: sanitized } })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.patch('/:id', requireAnyPermission(models, 'hr.terminations.manage'), async (req, res) => {
    try {
      const body = req.body || {}
      const term = await models.terminations.findById(String(req.params.id)) as any
      if (!term) return res.status(404).json({ error: 'Termination not found' })
      const patch: any = { updated_at: new Date().toISOString() }
      if (body.status) patch.status = validateEnum(body.status, TERMINATION_STATUSES, 'Status')
      if (body.exit_notes !== undefined) {
        patch.exit_notes = body.exit_notes === null
          ? null
          : validateLength(String(body.exit_notes).trim(), 1, 4000, 'Exit notes')
      }
      if (body.handover_notes !== undefined) {
        patch.handover_notes = body.handover_notes === null
          ? null
          : validateLength(String(body.handover_notes).trim(), 1, 4000, 'Handover notes')
      }
      // Completing a termination should deactivate the user — that's the actual
      // point of recording termination in an HR system.
      if (patch.status === 'completed' && term.user_id) {
        await models.users.updateById(String(term.user_id), {
          $set: { is_active: 0, updated_at: new Date().toISOString() },
        })
      }
      await models.terminations.updateById(term.id, { $set: patch })
      return res.json({ message: 'Termination updated' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.delete('/:id', requireAnyPermission(models, 'hr.terminations.manage'), async (req, res) => {
    try {
      await models.terminations.deleteById(String(req.params.id))
      return res.json({ message: 'Termination deleted' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to delete' })
    }
  })

  return router
}
