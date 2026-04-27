import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, requireRole } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'
import {
  validateRequired,
  validateLength,
  validateOptional,
  validateISODate,
  validateRange,
  validateEnum,
  respondWithError,
} from '../validators'

function sum(items: any[], pick: (item: any) => number) {
  return items.reduce((total, item) => total + pick(item), 0)
}

async function recomputeConsumedHours(models: MongoModels, projectId: string, userId: string) {
  const entries = await models.timesheets.find({
    project_id: projectId,
    user_id: userId,
    approval_status: { $ne: 'rejected' },
  }) as any[]
  const total = entries.reduce((acc, e) => acc + Number(e.hours_consumed || 0), 0)
  await models.projectAssignments.updateMany(
    { project_id: projectId, user_id: userId, is_active: 1 },
    { $set: { consumed_hours: total, updated_at: new Date().toISOString() } },
  )

  const projectEntries = await models.timesheets.find({
    project_id: projectId,
    approval_status: { $ne: 'rejected' },
  }) as any[]
  const projectTotal = projectEntries.reduce((acc, e) => acc + Number(e.hours_consumed || 0), 0)
  await models.projects.updateById(projectId, {
    $set: { consumed_hours: projectTotal, updated_at: new Date().toISOString() },
  })
}

const TS_STATUSES = ['in_progress', 'completed', 'blocked', 'review'] as const
const TS_APPROVAL_ACTIONS = ['approve', 'approved', 'reject', 'rejected'] as const

export function createTimesheetsRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  router.get('/', async (req, res) => {
    try {
      const user = req.user as any
      const { user_id, project_id, date_from, from, date_to, to, approval_status, date } = req.query as Record<string, string>
      const start = date_from || from
      const end = date_to || to

      const timesheets = await models.timesheets.find({}) as any[]
      const users = await models.users.find({}) as any[]
      const projects = await models.projects.find({}) as any[]

      let rows = timesheets.map((t) => ({
        ...t,
        full_name: users.find((u) => u.id === t.user_id)?.full_name,
        avatar_color: users.find((u) => u.id === t.user_id)?.avatar_color,
        project_name: projects.find((p) => p.id === t.project_id)?.name,
        project_code: projects.find((p) => p.id === t.project_id)?.code,
      }))

      if (user.role === 'developer') rows = rows.filter((row) => row.user_id === user.sub)
      else if (user_id) rows = rows.filter((row) => row.user_id === user_id)
      if (project_id) rows = rows.filter((row) => row.project_id === project_id)
      if (date) rows = rows.filter((row) => row.date === date)
      if (start) rows = rows.filter((row) => String(row.date || '') >= start)
      if (end) rows = rows.filter((row) => String(row.date || '') <= end)
      if (approval_status) rows = rows.filter((row) => row.approval_status === approval_status)

      rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')))
      rows = rows.slice(0, 500)

      return res.json({ timesheets: rows, data: rows })
    } catch (error: any) {
      return res.json({ timesheets: [], data: [] })
    }
  })

  router.get('/summary/weekly', async (req, res) => {
    try {
      const user = req.user as any
      const userId = typeof req.query.user_id === 'string' ? req.query.user_id : user.sub
      const effectiveUserId = user.role === 'developer' ? user.sub : userId
      const timesheets = await models.timesheets.find({ user_id: effectiveUserId, approval_status: { $ne: 'rejected' } }) as any[]
      const projects = await models.projects.find({}) as any[]
      const last7 = timesheets.filter((t) => {
        const date = new Date(t.date)
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - 7)
        return date >= cutoff
      })
      return res.json({
        data: last7.map((t) => ({
          date: t.date,
          project_name: projects.find((p) => p.id === t.project_id)?.name,
          hours: t.hours_consumed,
          is_billable: t.is_billable,
        })),
      })
    } catch (error: any) {
      return res.json({ data: [] })
    }
  })

  router.get('/suggestions', async (req, res) => {
    try {
      const user = req.user as any
      const timesheets = await models.timesheets.find({ user_id: user.sub }) as any[]
      const projects = await models.projects.find({}) as any[]
      const suggestions = [...timesheets]
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
        .slice(0, 5)
        .map((t) => ({
          project_id: t.project_id,
          project_name: projects.find((p) => p.id === t.project_id)?.name,
          module_name: t.module_name,
          task_description: t.task_description,
          hours_consumed: t.hours_consumed,
          is_billable: t.is_billable,
        }))
      return res.json({ data: suggestions })
    } catch (error: any) {
      return res.json({ data: [] })
    }
  })

  router.post('/', async (req, res) => {
    try {
      const user = req.user as any
      const role = String(user?.role || '').toLowerCase()
      const body = req.body || {}
      const projectId = validateRequired(body.project_id, 'project_id')
      const date = validateISODate(body.date, 'Date')
      const hours = validateRange(body.hours_consumed, 0, 24, 'Hours')
      const taskDescription = validateLength(String(body.task_description || '').trim(), 1, 1000, 'Task description')
      const moduleName = validateOptional(body.module_name, (v) => validateLength(String(v).trim(), 1, 200, 'Module'))
      const status = validateEnum(body.status || 'in_progress', TS_STATUSES, 'Status')
      const blockerRemarks = validateOptional(body.blocker_remarks, (v) => validateLength(String(v).trim(), 1, 1000, 'Blocker remarks'))
      const extraHoursReason = validateOptional(body.extra_hours_reason, (v) => validateLength(String(v).trim(), 1, 1000, 'Extra hours reason'))

      const isStaffPicker = role === 'admin' || role === 'pm' || role === 'pc'
      const targetUserId = isStaffPicker && body.user_id ? String(body.user_id) : user.sub

      if (role === 'developer' || role === 'team') {
        const assignment = await models.projectAssignments.findOne({
          user_id: targetUserId,
          project_id: projectId,
          is_active: 1,
        })
        if (!assignment) {
          return res.status(403).json({ error: 'You are not assigned to this project' })
        }
      }

      const duplicate = await models.timesheets.findOne({
        user_id: targetUserId,
        project_id: projectId,
        date,
      })

      const id = generateId('ts')
      const now = new Date().toISOString()
      const approvalStatus = (role === 'developer' || role === 'team') ? 'pending' : 'approved'
      const approvedBy = approvalStatus === 'approved' ? user.sub : null
      await models.timesheets.insertOne({
        id,
        user_id: targetUserId,
        project_id: projectId,
        date,
        module_name: moduleName,
        task_description: taskDescription,
        hours_consumed: hours,
        is_billable: body.is_billable !== false ? 1 : 0,
        extra_hours_reason: extraHoursReason,
        status,
        blocker_remarks: blockerRemarks,
        approval_status: approvalStatus,
        approved_by: approvedBy,
        approved_at: approvedBy ? now : null,
        pm_notes: null,
        created_at: now,
        updated_at: now,
      })
      await recomputeConsumedHours(models, projectId, targetUserId)
      return res.status(201).json({
        data: { id, duplicate_warning: Boolean(duplicate) },
        message: 'Timesheet entry created',
      })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.put('/:id', async (req, res) => {
    try {
      const user = req.user as any
      const role = String(user?.role || '').toLowerCase()
      const id = String(req.params.id)
      const entry = await models.timesheets.findById(id) as any
      if (!entry) return res.status(404).json({ error: 'Entry not found' })

      const isOwner = String(entry.user_id) === String(user.sub)
      if ((role === 'developer' || role === 'team') && !isOwner) {
        return res.status(403).json({ error: 'Forbidden' })
      }
      if (entry.approval_status === 'approved' && (role === 'developer' || role === 'team')) {
        return res.status(403).json({ error: 'Cannot edit approved entries' })
      }

      const body = req.body || {}
      const patch: any = { updated_at: new Date().toISOString() }
      if ('hours_consumed' in body) patch.hours_consumed = validateRange(body.hours_consumed, 0, 24, 'Hours')
      if ('task_description' in body) patch.task_description = validateLength(String(body.task_description || '').trim(), 1, 1000, 'Task description')
      if ('module_name' in body) patch.module_name = validateOptional(body.module_name, (v) => validateLength(String(v).trim(), 1, 200, 'Module'))
      if ('is_billable' in body) patch.is_billable = body.is_billable ? 1 : 0
      if ('extra_hours_reason' in body) patch.extra_hours_reason = body.extra_hours_reason || null
      if ('status' in body) patch.status = validateEnum(body.status, TS_STATUSES, 'Status')
      if ('blocker_remarks' in body) patch.blocker_remarks = body.blocker_remarks || null

      await models.timesheets.updateById(id, { $set: patch })
      await recomputeConsumedHours(models, String(entry.project_id), String(entry.user_id))
      return res.json({ message: 'Timesheet updated successfully' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.delete('/:id', async (req, res) => {
    try {
      const user = req.user as any
      const role = String(user?.role || '').toLowerCase()
      const id = String(req.params.id)
      const entry = await models.timesheets.findById(id) as any
      if (!entry) return res.status(404).json({ error: 'Entry not found' })
      const isOwner = String(entry.user_id) === String(user.sub)
      if ((role === 'developer' || role === 'team') && !isOwner) {
        return res.status(403).json({ error: 'Forbidden' })
      }
      if (entry.approval_status === 'approved' && (role === 'developer' || role === 'team')) {
        return res.status(403).json({ error: 'Cannot delete approved entries' })
      }
      await models.timesheets.deleteById(id)
      await recomputeConsumedHours(models, String(entry.project_id), String(entry.user_id))
      return res.json({ message: 'Timesheet entry deleted' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.patch('/:id/approve', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
      const user = req.user as any
      const id = String(req.params.id)
      const action = validateEnum(req.body?.action, TS_APPROVAL_ACTIONS, 'Action')
      const newStatus = action === 'approve' || action === 'approved' ? 'approved' : 'rejected'
      const pmNotes = req.body?.pm_notes ? String(req.body.pm_notes).slice(0, 1000) : null

      const entry = await models.timesheets.findById(id) as any
      if (!entry) return res.status(404).json({ error: 'Entry not found' })

      const now = new Date().toISOString()
      await models.timesheets.updateById(id, {
        $set: {
          approval_status: newStatus,
          approved_by: user.sub,
          approved_at: now,
          pm_notes: pmNotes,
          updated_at: now,
        },
      })
      await recomputeConsumedHours(models, String(entry.project_id), String(entry.user_id))
      return res.json({ message: `Timesheet ${newStatus} successfully` })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.post('/bulk-approve', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
      const user = req.user as any
      const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids : []
      if (!ids.length) return res.status(400).json({ error: 'ids array is required' })
      const action = validateEnum(req.body?.action, TS_APPROVAL_ACTIONS, 'Action')
      const newStatus = action === 'approve' || action === 'approved' ? 'approved' : 'rejected'
      const pmNotes = req.body?.pm_notes ? String(req.body.pm_notes).slice(0, 1000) : null
      const now = new Date().toISOString()

      const entries = await models.timesheets.find({ id: { $in: ids } }) as any[]
      await models.timesheets.updateMany(
        { id: { $in: ids } },
        { $set: { approval_status: newStatus, approved_by: user.sub, approved_at: now, pm_notes: pmNotes, updated_at: now } },
      )
      const recomputed = new Set<string>()
      for (const e of entries) {
        const key = `${e.project_id}::${e.user_id}`
        if (recomputed.has(key)) continue
        recomputed.add(key)
        await recomputeConsumedHours(models, String(e.project_id), String(e.user_id))
      }
      return res.json({ message: `${entries.length} timesheets ${newStatus}` })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  return router
}
