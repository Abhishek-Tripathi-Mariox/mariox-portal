import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, requireAnyPermission, userHasAnyPermission } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'
import {
  validateLength,
  validateOptional,
  validateRange,
  respondWithError,
} from '../validators'
import { createUserNotification } from './notifications'

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function createSalarySlipsRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  router.get('/', async (req, res) => {
    try {
      const user = req.user as any
      const isManager = await userHasAnyPermission(models, user, 'hr.salary_slips.manage')
      const userId = typeof req.query.user_id === 'string' ? req.query.user_id : undefined
      const month = typeof req.query.month === 'string' ? req.query.month : undefined
      const filter: any = {}
      if (!isManager) filter.user_id = user.sub
      else if (userId) filter.user_id = userId
      if (month) filter.month = month

      const [rows, users] = await Promise.all([
        models.salarySlips.find(filter) as Promise<any[]>,
        models.users.find({}) as Promise<any[]>,
      ])
      const usersById = new Map(users.map((u) => [String(u.id), u]))
      const enriched = rows.map((s) => ({
        ...s,
        full_name: usersById.get(String(s.user_id))?.full_name || null,
        email: usersById.get(String(s.user_id))?.email || null,
        designation: usersById.get(String(s.user_id))?.designation || null,
        avatar_color: usersById.get(String(s.user_id))?.avatar_color || null,
      })).sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')))
      return res.json({ data: enriched, salary_slips: enriched })
    } catch {
      return res.json({ data: [], salary_slips: [] })
    }
  })

  router.post('/', requireAnyPermission(models, 'hr.salary_slips.manage'), async (req, res) => {
    try {
      const user = req.user as any
      const body = req.body || {}
      const targetUserId = String(body.user_id || '').trim()
      if (!targetUserId) return res.status(400).json({ error: 'Employee is required' })
      const targetUser = await models.users.findById(targetUserId) as any
      if (!targetUser) return res.status(400).json({ error: 'Employee not found' })

      const month = validateLength(String(body.month || '').trim(), 7, 7, 'Month')
      if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Month must be in YYYY-MM format' })

      const basic = validateRange(toNumber(body.basic), 0, 100000000, 'Basic')
      const hra = validateRange(toNumber(body.hra), 0, 100000000, 'HRA')
      const allowances = validateRange(toNumber(body.allowances), 0, 100000000, 'Allowances')
      const bonus = validateRange(toNumber(body.bonus), 0, 100000000, 'Bonus')
      const deductions = validateRange(toNumber(body.deductions), 0, 100000000, 'Deductions')
      const tax = validateRange(toNumber(body.tax), 0, 100000000, 'Tax')
      const workingDays = validateRange(toNumber(body.working_days, 0), 0, 31, 'Working days')
      const paidDays = validateRange(toNumber(body.paid_days, 0), 0, 31, 'Paid days')
      const notes = validateOptional(body.notes, (v) => validateLength(String(v).trim(), 1, 2000, 'Notes'))

      const gross = basic + hra + allowances + bonus
      const netPay = gross - deductions - tax

      // One slip per (user_id, month) — replace existing.
      const existing = await models.salarySlips.findOne({ user_id: targetUserId, month }) as any
      const now = new Date().toISOString()
      const payload = {
        user_id: targetUserId,
        month,
        basic,
        hra,
        allowances,
        bonus,
        deductions,
        tax,
        working_days: workingDays,
        paid_days: paidDays,
        gross,
        net_pay: netPay,
        notes,
        generated_by: user?.sub || null,
        updated_at: now,
      }
      if (existing) {
        await models.salarySlips.updateById(existing.id, { $set: payload })
        return res.json({ message: 'Salary slip updated', data: { id: existing.id } })
      }
      const id = generateId('sal')
      await models.salarySlips.insertOne({ id, ...payload, created_at: now })

      // Notify employee that a slip is ready
      const issuer = await models.users.findById(user.sub) as any
      await createUserNotification(models, {
        user_id: targetUserId,
        type: 'hr_salary_slip',
        title: `Your ${month} salary slip is ready`,
        body: `Net pay: ${netPay}`,
        link: `salary:${id}`,
        actor_id: user.sub,
        actor_name: issuer?.full_name || 'HR',
        meta: { salary_slip_id: id, month, net_pay: netPay },
      })

      return res.status(201).json({ message: 'Salary slip generated', data: { id } })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // Bulk-generate for a whole month. Pass a list of {user_id, basic, hra,
  // allowances, bonus, deductions, tax}; everything else is computed (gross,
  // net) and one slip per (user_id, month) is upserted. Useful when payroll
  // is largely the same numbers month-over-month — UI duplicates last
  // month's structure and just submits the diff.
  router.post('/bulk', requireAnyPermission(models, 'hr.salary_slips.manage'), async (req, res) => {
    try {
      const user = req.user as any
      const body = req.body || {}
      const month = validateLength(String(body.month || '').trim(), 7, 7, 'Month')
      if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Month must be in YYYY-MM format' })
      const entries: any[] = Array.isArray(body.entries) ? body.entries : []
      if (entries.length === 0) return res.status(400).json({ error: 'At least one entry is required' })
      if (entries.length > 500) return res.status(400).json({ error: 'Too many entries in one request' })

      const now = new Date().toISOString()
      let inserted = 0
      let updated = 0
      const errors: any[] = []

      for (const e of entries) {
        try {
          const targetUserId = String(e.user_id || '').trim()
          if (!targetUserId) { errors.push({ user_id: null, error: 'Missing user_id' }); continue }
          const targetUser = await models.users.findById(targetUserId) as any
          if (!targetUser) { errors.push({ user_id: targetUserId, error: 'Employee not found' }); continue }

          const basic = validateRange(toNumber(e.basic), 0, 100000000, 'Basic')
          const hra = validateRange(toNumber(e.hra), 0, 100000000, 'HRA')
          const allowances = validateRange(toNumber(e.allowances), 0, 100000000, 'Allowances')
          const bonus = validateRange(toNumber(e.bonus), 0, 100000000, 'Bonus')
          const deductions = validateRange(toNumber(e.deductions), 0, 100000000, 'Deductions')
          const tax = validateRange(toNumber(e.tax), 0, 100000000, 'Tax')
          const workingDays = validateRange(toNumber(e.working_days, 0), 0, 31, 'Working days')
          const paidDays = validateRange(toNumber(e.paid_days, 0), 0, 31, 'Paid days')
          const gross = basic + hra + allowances + bonus
          const netPay = gross - deductions - tax

          const existing = await models.salarySlips.findOne({ user_id: targetUserId, month }) as any
          const payload = {
            user_id: targetUserId,
            month,
            basic, hra, allowances, bonus, deductions, tax,
            working_days: workingDays,
            paid_days: paidDays,
            gross,
            net_pay: netPay,
            notes: e.notes ? String(e.notes).trim().slice(0, 2000) : null,
            generated_by: user?.sub || null,
            updated_at: now,
          }
          if (existing) {
            await models.salarySlips.updateById(existing.id, { $set: payload })
            updated += 1
          } else {
            await models.salarySlips.insertOne({ id: generateId('sal'), ...payload, created_at: now })
            inserted += 1
          }
        } catch (err: any) {
          errors.push({ user_id: e.user_id || null, error: err?.message || 'Failed' })
        }
      }
      return res.json({
        message: `Bulk salary slips processed (${inserted + updated} ok, ${errors.length} failed)`,
        data: { inserted, updated, errors },
      })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.delete('/:id', requireAnyPermission(models, 'hr.salary_slips.manage'), async (req, res) => {
    try {
      await models.salarySlips.deleteById(String(req.params.id))
      return res.json({ message: 'Salary slip deleted' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to delete' })
    }
  })

  return router
}
