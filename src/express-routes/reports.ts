import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware } from '../express-middleware/auth'

function monthRange(monthStr: string) {
  const [year, month] = monthStr.split('-').map(Number)
  const start = `${monthStr}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${monthStr}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

function weekNumber(dateStr: string) {
  const d = new Date(dateStr)
  const first = new Date(d.getFullYear(), 0, 1)
  const days = Math.floor((d.getTime() - first.getTime()) / (1000 * 60 * 60 * 24))
  return String(Math.floor((days + first.getDay()) / 7)).padStart(2, '0')
}

export function createReportsRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  router.get('/developer/:id', async (req, res) => {
    try {
      const userId = req.params.id
      const monthParam = typeof req.query.month === 'string' ? req.query.month : new Date().toISOString().slice(0, 7)
      const { start, end } = monthRange(monthParam)

      const [user, timesheets, assignments, projects] = await Promise.all([
        models.users.findById(userId),
        models.timesheets.find({
          user_id: userId,
          date: { $gte: start, $lte: end },
          approval_status: { $ne: 'rejected' },
        }) as Promise<any[]>,
        models.projectAssignments.find({ user_id: userId, is_active: 1 }) as Promise<any[]>,
        models.projects.find({}) as Promise<any[]>,
      ])
      const projectsById = new Map(projects.map((p) => [String(p.id), p]))
      const dailyMap = new Map<string, { date: string; hours: number; billable: number }>()
      const projectMap = new Map<string, any>()
      const weekMap = new Map<string, number>()
      let totalBillable = 0
      let totalNonBillable = 0

      for (const t of timesheets) {
        const date = String(t.date || '')
        const hours = Number(t.hours_consumed || 0)
        const billable = Number(t.is_billable || 0) === 1 ? hours : 0
        const daily = dailyMap.get(date) || { date, hours: 0, billable: 0 }
        daily.hours += hours
        daily.billable += billable
        dailyMap.set(date, daily)
        const week = weekNumber(date)
        weekMap.set(week, (weekMap.get(week) || 0) + hours)
        totalBillable += billable
        totalNonBillable += hours - billable

        const pid = String(t.project_id)
        const existing = projectMap.get(pid) || {
          id: pid,
          name: projectsById.get(pid)?.name || null,
          code: projectsById.get(pid)?.code || null,
          hours: 0,
          billable: 0,
          allocated_hours: 0,
          role: null,
        }
        existing.hours += hours
        existing.billable += billable
        projectMap.set(pid, existing)
      }
      for (const a of assignments) {
        const existing = projectMap.get(String(a.project_id))
        if (existing) {
          existing.allocated_hours = Number(a.allocated_hours || 0)
          existing.role = a.role || null
        }
      }

      return res.json({
        data: {
          user,
          month: monthParam,
          daily_hours: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
          project_breakdown: [...projectMap.values()].sort((a, b) => b.hours - a.hours),
          weekly_data: [...weekMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, hours]) => ({ week, hours })),
          billable_summary: {
            billable: totalBillable,
            non_billable: totalNonBillable,
            total: totalBillable + totalNonBillable,
          },
        },
      })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load report' })
    }
  })

  router.get('/project/:id', async (req, res) => {
    try {
      const projectId = req.params.id
      const [project, timesheets, assignments, users] = await Promise.all([
        models.projects.findById(projectId),
        models.timesheets.find({
          project_id: projectId,
          approval_status: { $ne: 'rejected' },
        }) as Promise<any[]>,
        models.projectAssignments.find({ project_id: projectId, is_active: 1 }) as Promise<any[]>,
        models.users.find({}) as Promise<any[]>,
      ])
      if (!project) return res.status(404).json({ error: 'Project not found' })
      const usersById = new Map(users.map((u) => [String(u.id), u]))

      const dailyMap = new Map<string, { date: string; hours: number; billable: number }>()
      const monthMap = new Map<string, number>()
      const contribsByUser = new Map<string, { logged_hours: number; billable: number }>()
      for (const t of timesheets) {
        const hours = Number(t.hours_consumed || 0)
        const billable = Number(t.is_billable || 0) === 1 ? hours : 0
        const date = String(t.date || '')
        const daily = dailyMap.get(date) || { date, hours: 0, billable: 0 }
        daily.hours += hours
        daily.billable += billable
        dailyMap.set(date, daily)
        const month = date.slice(0, 7)
        monthMap.set(month, (monthMap.get(month) || 0) + hours)
        const uid = String(t.user_id)
        const existing = contribsByUser.get(uid) || { logged_hours: 0, billable: 0 }
        existing.logged_hours += hours
        existing.billable += billable
        contribsByUser.set(uid, existing)
      }

      const developerContrib = assignments.map((a) => {
        const u = usersById.get(String(a.user_id)) as any
        const t = contribsByUser.get(String(a.user_id)) || { logged_hours: 0, billable: 0 }
        return {
          id: a.user_id,
          full_name: u?.full_name || null,
          designation: u?.designation || null,
          avatar_color: u?.avatar_color || null,
          allocated_hours: Number(a.allocated_hours || 0),
          consumed_hours: Number(a.consumed_hours || 0),
          role: a.role || null,
          logged_hours: t.logged_hours,
          billable: t.billable,
        }
      }).sort((a, b) => b.logged_hours - a.logged_hours)

      return res.json({
        data: {
          project,
          developer_contributions: developerContrib,
          daily_burn: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
          weekly_burn: [...monthMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, hours]) => ({ month, hours })),
        },
      })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load report' })
    }
  })

  async function teamUtilization(monthStr: string, roles: string[]) {
    const { start, end } = monthRange(monthStr)
    const [users, timesheets, assignments] = await Promise.all([
      models.users.find({ role: { $in: roles }, is_active: 1 }) as Promise<any[]>,
      models.timesheets.find({
        date: { $gte: start, $lte: end },
        approval_status: { $ne: 'rejected' },
      }) as Promise<any[]>,
      models.projectAssignments.find({ is_active: 1 }) as Promise<any[]>,
    ])
    return users.map((u) => {
      const mine = timesheets.filter((t) => t.user_id === u.id)
      const loggedHours = mine.reduce((acc, t) => acc + Number(t.hours_consumed || 0), 0)
      const billableHours = mine.reduce((acc, t) => acc + (Number(t.is_billable || 0) === 1 ? Number(t.hours_consumed || 0) : 0), 0)
      const allocated = assignments.filter((a) => a.user_id === u.id).reduce((acc, a) => acc + Number(a.allocated_hours || 0), 0)
      const projects_worked = new Set(mine.map((t) => t.project_id)).size
      const capacity = Number(u.monthly_available_hours || 0)
      const utilization_pct = capacity > 0 ? Math.round((loggedHours / capacity) * 1000) / 10 : 0
      return {
        id: u.id,
        full_name: u.full_name,
        designation: u.designation,
        email: u.email,
        role: u.role,
        avatar_color: u.avatar_color,
        monthly_available_hours: capacity,
        hourly_cost: u.hourly_cost || 0,
        logged_hours: loggedHours,
        monthly_consumed: loggedHours,
        billable_hours: billableHours,
        allocated_hours: allocated,
        project_count: projects_worked,
        projects_worked,
        utilization_pct,
      }
    }).sort((a, b) => b.utilization_pct - a.utilization_pct)
  }

  router.get('/team', async (req, res) => {
    try {
      const month = typeof req.query.month === 'string' ? req.query.month : new Date().toISOString().slice(0, 7)
      const data = await teamUtilization(month, ['developer', 'team'])
      return res.json({ data, month })
    } catch {
      return res.json({ data: [], month: new Date().toISOString().slice(0, 7) })
    }
  })

  router.get('/team-utilization', async (req, res) => {
    try {
      const month = typeof req.query.month === 'string' ? req.query.month : new Date().toISOString().slice(0, 7)
      const data = await teamUtilization(month, ['developer', 'team', 'pm', 'pc'])
      return res.json({ utilization: data, data, month })
    } catch {
      return res.json({ utilization: [], data: [], month: new Date().toISOString().slice(0, 7) })
    }
  })

  router.get('/project-summary', async (_req, res) => {
    try {
      const [projects, clients, users] = await Promise.all([
        models.projects.find({}) as Promise<any[]>,
        models.clients.find({}) as Promise<any[]>,
        models.users.find({}) as Promise<any[]>,
      ])
      const clientsById = new Map(clients.map((c) => [String(c.id), c]))
      const usersById = new Map(users.map((u) => [String(u.id), u]))
      const enriched = projects
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .map((p) => ({
          ...p,
          client_name: clientsById.get(String(p.client_id))?.company_name || p.client_name || null,
          pm_name: usersById.get(String(p.pm_id))?.full_name || null,
        }))
      return res.json({ projects: enriched, data: enriched })
    } catch {
      return res.json({ projects: [], data: [] })
    }
  })

  router.get('/summary', async (_req, res) => {
    try {
      const [projects, devs] = await Promise.all([
        models.projects.find({}) as Promise<any[]>,
        models.users.find({ role: { $in: ['developer', 'team'] }, is_active: 1 }) as Promise<any[]>,
      ])
      const active = projects.filter((p) => p.status === 'active').length
      const allocated = projects.reduce((acc, p) => acc + Number(p.total_allocated_hours || 0), 0)
      const consumed = projects.reduce((acc, p) => acc + Number(p.consumed_hours || 0), 0)
      return res.json({
        projects: { total: projects.length, active },
        developers: { total: devs.length },
        hours: { allocated, consumed },
      })
    } catch {
      return res.json({ projects: { total: 0, active: 0 }, developers: { total: 0 }, hours: { allocated: 0, consumed: 0 } })
    }
  })

  return router
}
