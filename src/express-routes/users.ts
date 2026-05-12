import { Router as createRouter } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, requireRole } from '../express-middleware/auth'
import { ROLES, STAFF_CREATE_ROLES } from '../constants'
import { generateId } from '../utils/helpers'
import { sendSmtpEmail, type SmtpEnv } from '../utils/smtp'
import {
  validateEmail,
  validateNewPassword,
  validateName,
  validateEnum,
  validateOptional,
  validatePhone,
  validateLength,
  validateRange,
  validatePositiveNumber,
  validateISODate,
  validateHexColor,
  respondWithError,
} from '../validators'

function normalizeRole(role: any): string {
  return String(role || '').toLowerCase().trim()
}

// Validate the manager/tl pointer the caller supplied for a sales-role user.
// Returns { manager_id, tl_id } that should be persisted, or throws an Error.
async function resolveSalesHierarchy(
  models: MongoModels,
  role: string,
  body: any,
  existing?: any,
): Promise<{ manager_id: string | null; tl_id: string | null }> {
  const r = normalizeRole(role)
  let manager_id: string | null = body?.manager_id ? String(body.manager_id).trim() : null
  let tl_id: string | null = body?.tl_id ? String(body.tl_id).trim() : null
  // Preserve existing values if the request didn't include the field at all.
  if (existing) {
    if (!('manager_id' in (body || {}))) manager_id = existing.manager_id ?? null
    if (!('tl_id' in (body || {}))) tl_id = existing.tl_id ?? null
  }

  if (r === ROLES.SALES_TL) {
    if (!manager_id) throw new Error('Manager is required for a Sales TL')
    const mgr = await models.users.findById(manager_id) as any
    if (!mgr || normalizeRole(mgr.role) !== ROLES.SALES_MANAGER) {
      throw new Error('Selected manager must be an active Sales Manager')
    }
    return { manager_id, tl_id: null }
  }

  if (r === ROLES.SALES_AGENT) {
    if (!tl_id) throw new Error('Team Lead is required for a Sales Agent')
    const tl = await models.users.findById(tl_id) as any
    if (!tl || normalizeRole(tl.role) !== ROLES.SALES_TL) {
      throw new Error('Selected TL must be an active Sales TL')
    }
    // Cascade the manager from the TL so manager-level visibility works
    // without an extra hop at query time.
    return { manager_id: tl.manager_id ?? null, tl_id }
  }

  // Non-sales roles never carry hierarchy pointers.
  return { manager_id: null, tl_id: null }
}

function getRoleFilter(role: string) {
  const normalized = normalizeRole(role)
  if (normalized === 'pm') return ['pm', 'pc']
  if (normalized === 'developer') return ['developer', 'team']
  if (normalized === 'admin') return ['admin']
  if (normalized === 'client') return ['client']
  if (normalized === 'pc' || normalized === 'team') return [normalized]
  return null
}

function sumBy<T>(items: T[], getter: (item: T) => number) {
  return items.reduce((total, item) => total + getter(item), 0)
}

function monthStart(yearMonth = new Date().toISOString().slice(0, 7)) {
  return `${yearMonth}-01`
}

function monthEnd(yearMonth = new Date().toISOString().slice(0, 7)) {
  const [year, month] = yearMonth.split('-').map(Number)
  const lastDay = new Date(year, month, 0).getDate()
  return `${yearMonth}-${String(lastDay).padStart(2, '0')}`
}

export interface UsersRouterEnv extends SmtpEnv {
  LOGIN_URL?: string
  APP_URL?: string
  PUBLIC_BASE_URL?: string
}

function escapeEmailHtml(s: string) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildStaffWelcomeEmail(opts: {
  fullName: string
  email: string
  password: string
  role: string
  loginUrl: string
}) {
  const { fullName, email, password, role, loginUrl } = opts
  const subject = 'Your Mariox Portal account is ready'
  const text = [
    `Hi ${fullName},`,
    '',
    `An account has been created for you on Mariox Portal.`,
    '',
    `Login URL : ${loginUrl}`,
    `Email     : ${email}`,
    `Password  : ${password}`,
    `Role      : ${role}`,
    '',
    `Please log in and change your password as soon as possible.`,
    '',
    `— Mariox Software Pvt Ltd`,
  ].join('\n')

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111827;background:#f3f4f6;padding:24px">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">
        <div style="padding:20px 24px;background:#1A0E08;color:#fff">
          <div style="font-size:18px;font-weight:700">Welcome to Mariox Portal</div>
          <div style="font-size:12px;opacity:.8;margin-top:4px">Your account is ready</div>
        </div>
        <div style="padding:24px">
          <p style="margin:0 0 12px;font-size:14px">Hi <strong>${escapeEmailHtml(fullName)}</strong>,</p>
          <p style="margin:0 0 16px;font-size:14px;line-height:1.55">An account has been created for you. Use the credentials below to sign in:</p>
          <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;margin:8px 0 16px">
            <tr><td style="padding:10px 14px;background:#f9fafb;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb;width:120px">Login URL</td><td style="padding:10px 14px;font-size:13px;border-bottom:1px solid #e5e7eb"><a href="${escapeEmailHtml(loginUrl)}" style="color:#FF7A45">${escapeEmailHtml(loginUrl)}</a></td></tr>
            <tr><td style="padding:10px 14px;background:#f9fafb;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb">Email</td><td style="padding:10px 14px;font-size:13px;border-bottom:1px solid #e5e7eb"><strong>${escapeEmailHtml(email)}</strong></td></tr>
            <tr><td style="padding:10px 14px;background:#f9fafb;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb">Password</td><td style="padding:10px 14px;font-size:13px;border-bottom:1px solid #e5e7eb"><code style="background:#f3f4f6;padding:2px 6px;border-radius:4px">${escapeEmailHtml(password)}</code></td></tr>
            <tr><td style="padding:10px 14px;background:#f9fafb;font-size:12px;color:#6b7280">Role</td><td style="padding:10px 14px;font-size:13px">${escapeEmailHtml(role)}</td></tr>
          </table>
          <p style="margin:0;font-size:12px;color:#6b7280">For security, please change your password after the first login.</p>
        </div>
        <div style="padding:14px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">— Mariox Software Pvt Ltd</div>
      </div>
    </div>`

  return { subject, html, text }
}

export function createUsersRouter(models: MongoModels, jwtSecret: string, runtimeEnv: UsersRouterEnv = {}) {
  const router = createRouter()
  const authMiddleware = createAuthMiddleware(jwtSecret)

  router.use(authMiddleware)

  // Lightweight pickers used by the New User modal so we don't have to fetch
  // every user just to populate manager/TL dropdowns. The /api/users/sales-tls
  // endpoint optionally filters by manager_id (when picking a TL for an agent
  // we want only TLs under that agent's selected manager).
  router.get('/sales-managers', async (_req, res) => {
    try {
      const list = await models.users.find({
        role: ROLES.SALES_MANAGER,
        is_active: 1,
      }) as any[]
      list.sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')))
      return res.json({ data: list, users: list })
    } catch {
      return res.json({ data: [], users: [] })
    }
  })

  router.get('/sales-tls', async (req, res) => {
    try {
      const filter: any = { role: ROLES.SALES_TL, is_active: 1 }
      if (req.query.manager_id) filter.manager_id = String(req.query.manager_id)
      const list = await models.users.find(filter) as any[]
      list.sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')))
      return res.json({ data: list, users: list })
    } catch {
      return res.json({ data: [], users: [] })
    }
  })

  router.get('/', async (req, res) => {
    try {
      const role = req.query.role as string | undefined
      const active = req.query.active as string | undefined
      const allUsers = await models.users.find({})
      const activeAssignments = await models.projectAssignments.find({ is_active: 1 })
      const currentMonthTimesheets = await models.timesheets.find({
        date: { $gte: monthStart() },
      })

      const projectCountByUser = new Map<string, number>()
      const allocatedByUser = new Map<string, number>()
      const monthlyConsumedByUser = new Map<string, number>()

      for (const assignment of activeAssignments as any[]) {
        const userId = String(assignment.user_id)
        projectCountByUser.set(userId, (projectCountByUser.get(userId) || 0) + 1)
        allocatedByUser.set(userId, (allocatedByUser.get(userId) || 0) + Number(assignment.allocated_hours || 0))
      }

      for (const entry of currentMonthTimesheets as any[]) {
        if (entry.approval_status === 'rejected') continue
        const userId = String(entry.user_id)
        monthlyConsumedByUser.set(userId, (monthlyConsumedByUser.get(userId) || 0) + Number(entry.hours_consumed || 0))
      }

      let users = allUsers as any[]
      if (role) {
        const allowedRoles = getRoleFilter(role)
        if (allowedRoles) {
          users = users.filter((user) => allowedRoles.includes(normalizeRole(user.role)))
        } else {
          users = users.filter((user) => normalizeRole(user.role) === normalizeRole(role))
        }
      }
      if (active !== undefined) {
        users = users.filter((user) => Number(user.is_active || 0) === (active === 'true' ? 1 : 0))
      }

      users = users
        .map((user) => ({
          ...user,
          project_count: projectCountByUser.get(String(user.id)) || 0,
          total_allocated: allocatedByUser.get(String(user.id)) || 0,
          monthly_consumed: monthlyConsumedByUser.get(String(user.id)) || 0,
        }))
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))

      return res.json({ users, data: users })
    } catch (error: any) {
      return res.json({ users: [], data: [] })
    }
  })

  router.get('/:id', async (req, res) => {
    try {
      const id = req.params.id
      const user = await models.users.findById(id) as any
      if (!user) return res.json({ data: { assignments: [], leaves: [], recent_logs: [] } })

      const assignments = await models.projectAssignments.find({ user_id: id, is_active: 1 }) as any[]
      const projectIds = [...new Set(assignments.map((assignment) => String(assignment.project_id)))]
      const projects = projectIds.length
        ? await models.projects.find({ id: { $in: projectIds } }) as any[]
        : []
      const projectsById = new Map(projects.map((project) => [String(project.id), project]))

      const userTimesheets = await models.timesheets.find({ user_id: id }) as any[]
      const leaves = await models.leaves.find({ user_id: id }, { sort: { start_date: -1 }, limit: 10 }) as any[]
      const recentTimesheets = [...userTimesheets]
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .slice(0, 20)

      const loggedHoursByProject = new Map<string, number>()
      for (const entry of userTimesheets) {
        if (entry.approval_status === 'rejected') continue
        const projectId = String(entry.project_id)
        loggedHoursByProject.set(projectId, (loggedHoursByProject.get(projectId) || 0) + Number(entry.hours_consumed || 0))
      }

      const enrichedAssignments = assignments.map((assignment) => ({
        ...assignment,
        project_name: projectsById.get(String(assignment.project_id))?.name,
        project_code: projectsById.get(String(assignment.project_id))?.code,
        project_status: projectsById.get(String(assignment.project_id))?.status,
        priority: projectsById.get(String(assignment.project_id))?.priority,
        logged_hours: loggedHoursByProject.get(String(assignment.project_id)) || 0,
      }))

      const recentLogs = recentTimesheets.map((entry) => ({
        ...entry,
        project_name: projectsById.get(String(entry.project_id))?.name,
      }))

      return res.json({
        data: {
          ...user,
          assignments: enrichedAssignments,
          leaves,
          recent_logs: recentLogs,
        },
      })
    } catch (error: any) {
      return res.json({ data: { assignments: [], leaves: [], recent_logs: [] } })
    }
  })

  router.post('/', requireRole('admin'), async (req, res) => {
    try {
      const body = req.body || {}
      const email = validateEmail(body.email)
      const fullName = validateName(body.full_name, 'Full name')
      const password = validateNewPassword(body.password)
      const role = validateEnum(body.role || 'developer', STAFF_CREATE_ROLES, 'Role')

      const phone = validateOptional(body.phone, (v) => validatePhone(v, 'Phone'))
      const designation = validateOptional(body.designation, (v) => validateLength(String(v).trim(), 2, 100, 'Designation'))
      const joiningDate = validateOptional(body.joining_date, (v) => validateISODate(v, 'Joining date'))
      const dailyHours = body.daily_work_hours !== undefined
        ? validateRange(body.daily_work_hours, 0, 24, 'Daily work hours')
        : 8
      const weeklyDays = body.working_days_per_week !== undefined
        ? validateRange(body.working_days_per_week, 0, 7, 'Working days per week')
        : 5
      const hourlyCost = body.hourly_cost !== undefined
        ? validatePositiveNumber(body.hourly_cost, 'Hourly cost')
        : 0
      const monthlyHours = body.monthly_available_hours !== undefined
        ? validateRange(body.monthly_available_hours, 0, 744, 'Monthly available hours')
        : 160
      // Sales-specific: monthly target (any unit — leads count or revenue) and
      // incentive rate (rupees per unit above target). Both default to 0.
      const monthlyTarget = body.monthly_target !== undefined
        ? validatePositiveNumber(body.monthly_target, 'Monthly target')
        : 0
      const incentiveRate = body.incentive_rate !== undefined
        ? validatePositiveNumber(body.incentive_rate, 'Incentive rate')
        : 0
      const avatarColor = body.avatar_color
        ? validateHexColor(body.avatar_color, 'Avatar color')
        : '#6366f1'

      const existing = await models.users.findByEmail(email)
      if (existing) return res.status(409).json({ error: 'Email already registered' })

      const hierarchy = await resolveSalesHierarchy(models, role, body)

      const encoder = new TextEncoder()
      const data = encoder.encode(password + 'devtrack-salt-2025')
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      const passwordHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

      const created = await models.users.createStaff({
        id: generateId('user'),
        email,
        password_hash: passwordHash,
        full_name: fullName,
        role,
        phone,
        designation,
        tech_stack: body.tech_stack ? JSON.stringify(body.tech_stack) : null,
        skill_tags: body.skill_tags ? JSON.stringify(body.skill_tags) : null,
        joining_date: joiningDate,
        daily_work_hours: dailyHours,
        working_days_per_week: weeklyDays,
        hourly_cost: hourlyCost,
        monthly_available_hours: monthlyHours,
        monthly_target: monthlyTarget,
        incentive_rate: incentiveRate,
        reporting_pm_id: body.reporting_pm_id || null,
        manager_id: hierarchy.manager_id,
        tl_id: hierarchy.tl_id,
        avatar_color: avatarColor,
        remarks: body.remarks || null,
      })

      // Best-effort welcome email with account credentials. We don't block the
      // create response on SMTP — bubble the result back so the UI can warn
      // when the email failed to go out.
      let mail: { sent: boolean; error?: string } = { sent: false }
      try {
        const loginUrl =
          String(runtimeEnv.LOGIN_URL || runtimeEnv.APP_URL || runtimeEnv.PUBLIC_BASE_URL || '').trim() ||
          'http://localhost:3000/'
        const { subject, html, text } = buildStaffWelcomeEmail({
          fullName, email, password, role, loginUrl,
        })
        const smtpHost = runtimeEnv.SMTP_HOST || (runtimeEnv.SMTP_USER || runtimeEnv.SENDER_EMAIL ? 'smtp.gmail.com' : '')
        const smtpUser = runtimeEnv.SMTP_USER || runtimeEnv.SENDER_EMAIL || ''
        const smtpPass = String(runtimeEnv.SMTP_PASS || runtimeEnv.APP_PASSWORD || '').replace(/\s+/g, '')
        if (!smtpHost || !smtpUser || !smtpPass) {
          throw new Error('SMTP is not configured on the server')
        }
        await sendSmtpEmail(runtimeEnv, { to: email, subject, html, text })
        mail = { sent: true }
      } catch (err: any) {
        mail = { sent: false, error: err?.message || String(err) }
      }

      return res.status(201).json({
        data: created,
        mail,
        message: mail.sent ? 'User created — credentials emailed' : 'User created (email failed)',
      })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.put('/:id', requireRole('admin', 'pm'), async (req, res) => {
    try {
      const id = String(req.params.id)
      const body = (req.body || {}) as any
      const existing = await models.users.findById(id) as any
      if (!existing) return res.status(404).json({ error: 'User not found' })
      const fullName = validateName(body.full_name, 'Full name')
      const phone = validateOptional(body.phone, (v) => validatePhone(v, 'Phone'))
      const designation = validateOptional(body.designation, (v) => validateLength(String(v).trim(), 2, 100, 'Designation'))
      const dailyHours = body.daily_work_hours !== undefined
        ? validateRange(body.daily_work_hours, 0, 24, 'Daily work hours')
        : 8
      const weeklyDays = body.working_days_per_week !== undefined
        ? validateRange(body.working_days_per_week, 0, 7, 'Working days per week')
        : 5
      const hourlyCost = body.hourly_cost !== undefined
        ? validatePositiveNumber(body.hourly_cost, 'Hourly cost')
        : 0
      const monthlyHours = body.monthly_available_hours !== undefined
        ? validateRange(body.monthly_available_hours, 0, 744, 'Monthly available hours')
        : 160
      const monthlyTarget = body.monthly_target !== undefined
        ? validatePositiveNumber(body.monthly_target, 'Monthly target')
        : (existing.monthly_target ?? 0)
      const incentiveRate = body.incentive_rate !== undefined
        ? validatePositiveNumber(body.incentive_rate, 'Incentive rate')
        : (existing.incentive_rate ?? 0)

      // Allow admin/pm to change role on an existing user (e.g. promote a sales
      // agent to TL). Falls back to the existing role if not supplied.
      const nextRole = body.role
        ? validateEnum(normalizeRole(body.role), STAFF_CREATE_ROLES, 'Role')
        : normalizeRole(existing.role)
      const hierarchy = await resolveSalesHierarchy(models, nextRole, body, existing)
      // If a TL's manager changed, cascade the new manager_id onto every agent
      // sitting under that TL — agents cache manager_id for fast visibility filters.
      if (
        nextRole === ROLES.SALES_TL &&
        normalizeRole(existing.role) === ROLES.SALES_TL &&
        hierarchy.manager_id !== (existing.manager_id ?? null)
      ) {
        await models.users.updateMany(
          { tl_id: id, role: ROLES.SALES_AGENT },
          { $set: { manager_id: hierarchy.manager_id, updated_at: new Date().toISOString() } },
        )
      }

      await models.users.updateById(id, {
        $set: {
          full_name: fullName,
          phone,
          designation,
          role: nextRole,
          tech_stack: body.tech_stack ? JSON.stringify(body.tech_stack) : null,
          skill_tags: body.skill_tags ? JSON.stringify(body.skill_tags) : null,
          daily_work_hours: dailyHours,
          working_days_per_week: weeklyDays,
          hourly_cost: hourlyCost,
          monthly_available_hours: monthlyHours,
          monthly_target: monthlyTarget,
          incentive_rate: incentiveRate,
          reporting_pm_id: body.reporting_pm_id || null,
          manager_id: hierarchy.manager_id,
          tl_id: hierarchy.tl_id,
          remarks: body.remarks || null,
          is_active: body.is_active !== undefined ? (body.is_active ? 1 : 0) : 1,
          updated_at: new Date().toISOString(),
        },
      })
      const updated = await models.users.findById(id)
      return res.json({ data: updated, message: 'User updated successfully' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.patch('/:id/status', requireRole('admin', 'pm'), async (req, res) => {
    try {
      const id = String(req.params.id)
      const { is_active } = (req.body || {}) as any
      await models.users.updateById(id, {
        $set: {
          is_active: is_active ? 1 : 0,
          updated_at: new Date().toISOString(),
        },
      })
      return res.json({ message: `User ${is_active ? 'activated' : 'deactivated'} successfully` })
    } catch (error: any) {
      return res.json({ message: 'User status updated' })
    }
  })

  router.get('/:id/utilization', async (req, res) => {
    try {
      const id = String(req.params.id)
      const month = typeof req.query.month === 'string' ? req.query.month : new Date().toISOString().slice(0, 7)
      const startDate = monthStart(month)
      const endDate = monthEnd(month)

      const user = await models.users.findById(id) as any
      if (!user) {
        return res.json({
          data: {
            user: null,
            monthly_hours: [],
            leaves: [],
            holidays: 0,
            logged: 0,
            allocated: 0,
            total_available: Number(req.query.total_available || 0),
            utilization_pct: 0,
            remaining: 0,
          },
        })
      }

      const leaves = await models.leaves.find({
        user_id: id,
        status: 'approved',
        start_date: { $gte: startDate },
        end_date: { $lte: endDate },
      }) as any[]
      const holidays = await models.holidays.countDocuments({
        date: { $gte: startDate, $lte: endDate },
      })
      const logged = await models.timesheets.find({
        user_id: id,
        date: { $gte: startDate, $lte: endDate },
        approval_status: { $ne: 'rejected' },
      }) as any[]
      const allocated = await models.projectAssignments.find({
        user_id: id,
        is_active: 1,
      }) as any[]

      const workingDays = Number(user.working_days_per_week) === 5 ? 22 : 26
      const leaveDays = sumBy(leaves, (leave) => Number(leave.days_count || 0))
      const holidayCount = Number(holidays || 0)
      const effectiveDays = Math.max(0, workingDays - leaveDays - holidayCount)
      const capacity = effectiveDays * Number(user.daily_work_hours || 8)
      const loggedHours = sumBy(logged, (entry) => Number(entry.hours_consumed || 0))
      const allocatedHours = sumBy(allocated, (entry) => Number(entry.allocated_hours || 0))
      const utilizationPercent = capacity > 0 ? Math.round((loggedHours / capacity) * 100) : 0

      return res.json({
        data: {
          user_id: id,
          month,
          working_days: workingDays,
          leave_days: leaveDays,
          holiday_count: holidayCount,
          effective_days: effectiveDays,
          capacity_hours: capacity,
          allocated_hours: allocatedHours,
          logged_hours: loggedHours,
          remaining_hours: Math.max(0, capacity - loggedHours),
          idle_hours: Math.max(0, capacity - allocatedHours),
          utilization_percent: utilizationPercent,
          status: utilizationPercent >= 100 ? 'overloaded' : utilizationPercent >= 70 ? 'optimal' : utilizationPercent >= 50 ? 'underutilized' : 'idle',
        },
      })
    } catch (error: any) {
      return res.json({
        data: {
          user: null,
          monthly_hours: [],
          leaves: [],
          holidays: 0,
          logged: 0,
          allocated: 0,
          total_available: 0,
          utilization_pct: 0,
          remaining: 0,
        },
      })
    }
  })

  // ── BULK IMPORT (CSV) ───────────────────────────────────
  // Sample template download
  router.get('/import/template.csv', (_req, res) => {
    const sample = [
      'full_name,email,role,designation,phone,daily_work_hours,monthly_available_hours,hourly_cost,joining_date,avatar_color,password',
      'Rahul Sharma,rahul@example.com,developer,Senior Developer,+91-9876543210,8,160,800,2024-01-15,#FF7A45,Welcome@123',
      'Priya Verma,priya@example.com,pm,Project Manager,+91-9876500001,8,160,1200,2023-06-01,#FFB347,Welcome@123',
      'Aman Singh,aman@example.com,team,External Developer,+91-9876500002,8,160,600,,#C56FE6,Welcome@123',
    ].join('\n')
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', 'attachment; filename="users_import_template.csv"')
    return res.send(sample)
  })

  router.post('/import', requireRole('admin'), async (req, res) => {
    try {
      const body = req.body || {}
      const csvText = String(body.csv || '').trim()
      if (!csvText) return res.status(400).json({ error: 'csv is required' })

      const rows = parseCsv(csvText)
      if (rows.length < 2) return res.status(400).json({ error: 'CSV must contain a header row and at least one data row' })

      const headers = rows[0].map((h) => String(h || '').trim().toLowerCase())
      const required = ['full_name', 'email']
      for (const r of required) {
        if (!headers.includes(r)) return res.status(400).json({ error: `Missing required column: ${r}` })
      }

      const created: any[] = []
      const errors: { row: number; email?: string; error: string }[] = []
      const encoder = new TextEncoder()

      for (let i = 1; i < rows.length; i++) {
        const cells = rows[i]
        if (!cells || cells.every((c) => !c?.trim())) continue
        const record: Record<string, string> = {}
        headers.forEach((h, idx) => { record[h] = String(cells[idx] || '').trim() })

        try {
          const email = validateEmail(record.email)
          const fullName = validateName(record.full_name, 'Full name')
          const password = record.password ? String(record.password) : 'Welcome@123'
          validateNewPassword(password)
          const role = validateEnum(
            (record.role || 'developer').toLowerCase(),
            STAFF_CREATE_ROLES,
            'Role',
          )

          const existing = await models.users.findByEmail(email)
          if (existing) {
            errors.push({ row: i + 1, email, error: 'Email already exists' })
            continue
          }

          const data = encoder.encode(password + 'devtrack-salt-2025')
          const hashBuffer = await crypto.subtle.digest('SHA-256', data)
          const passwordHash = Array.from(new Uint8Array(hashBuffer))
            .map((b) => b.toString(16).padStart(2, '0')).join('')

          const user = await models.users.createStaff({
            id: generateId('user'),
            email,
            password_hash: passwordHash,
            full_name: fullName,
            role,
            phone: record.phone || null,
            designation: record.designation || null,
            tech_stack: null,
            skill_tags: null,
            joining_date: record.joining_date || null,
            daily_work_hours: Number(record.daily_work_hours) || 8,
            working_days_per_week: 5,
            hourly_cost: Number(record.hourly_cost) || 0,
            monthly_available_hours: Number(record.monthly_available_hours) || 160,
            reporting_pm_id: null,
            avatar_color: record.avatar_color && /^#[0-9a-fA-F]{6}$/.test(record.avatar_color)
              ? record.avatar_color
              : '#FF7A45',
            remarks: null,
          })
          created.push({ id: user.id, email, full_name: fullName, role })
        } catch (e: any) {
          errors.push({ row: i + 1, email: record.email, error: e?.message || 'Failed' })
        }
      }

      return res.json({
        created_count: created.length,
        error_count: errors.length,
        created,
        errors,
      })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  return router
}

// ── Tiny CSV parser (handles quoted fields with commas / escaped quotes)
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let cur: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') { inQuotes = false }
      else field += ch
    } else {
      if (ch === '"') inQuotes = true
      else if (ch === ',') { cur.push(field); field = '' }
      else if (ch === '\n') { cur.push(field); rows.push(cur); cur = []; field = '' }
      else if (ch === '\r') { /* skip */ }
      else field += ch
    }
  }
  if (field || cur.length) { cur.push(field); rows.push(cur) }
  return rows
}
