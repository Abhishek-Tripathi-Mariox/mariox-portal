import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware } from '../express-middleware/auth'

function sum(items: any[], pick: (item: any) => number) {
  return items.reduce((total, item) => total + pick(item), 0)
}

function monthKey(date: string) {
  return String(date || '').slice(0, 7)
}

function toPct(consumed: number, total: number) {
  return total > 0 ? Math.round((consumed / total) * 100) : 0
}

export function createDashboardRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  router.get('/pm', async (req, res) => {
    try {
      const projects = await models.projects.find({}) as any[]
      const users = await models.users.find({}) as any[]
      const timesheets = await models.timesheets.find({}) as any[]
      const assignments = await models.projectAssignments.find({}) as any[]
      const recentLogs = [...timesheets]
        .sort((a, b) => String(b.created_at || b.date || '').localeCompare(String(a.created_at || a.date || '')))
        .slice(0, 10)

      const projectStats = {
        total: projects.length,
        active: projects.filter((p) => p.status === 'active').length,
        on_hold: projects.filter((p) => p.status === 'on_hold').length,
        completed: projects.filter((p) => p.status === 'completed').length,
        over_budget: projects.filter((p) => Number(p.consumed_hours || 0) > Number(p.total_allocated_hours || 0)).length,
        near_limit: projects.filter((p) => {
          const allocated = Number(p.total_allocated_hours || 0)
          const consumed = Number(p.consumed_hours || 0)
          return allocated > 0 && consumed / allocated >= 0.8 && consumed <= allocated
        }).length,
        delayed: projects.filter((p) => p.status === 'active' && p.expected_end_date && String(p.expected_end_date) < new Date().toISOString().slice(0, 10)).length,
      }

      const devUsers = users.filter((u) => u.role === 'developer')
      const devStats = {
        total: devUsers.length,
        active: devUsers.filter((u) => Number(u.is_active || 0) === 1).length,
      }

      const activeProjects = projects.filter((p) => p.status === 'active')
      const hoursStats = {
        total_allocated: sum(activeProjects, (p) => Number(p.total_allocated_hours || 0)),
        total_consumed: sum(activeProjects, (p) => Number(p.consumed_hours || 0)),
        total_remaining: sum(activeProjects, (p) => Math.max(0, Number(p.total_allocated_hours || 0) - Number(p.consumed_hours || 0))),
      }

      const weeklyDates = Array.from({ length: 7 }, (_, idx) => {
        const d = new Date()
        d.setDate(d.getDate() - (6 - idx))
        return d.toISOString().slice(0, 10)
      })
      const weekly_data = weeklyDates.map((date) => ({
        date,
        hours: sum(timesheets.filter((t) => t.date === date && t.approval_status !== 'rejected'), (t) => Number(t.hours_consumed || 0)),
      }))

      const monthMap = new Map<string, { month: string; hours: number; billable_hours: number }>()
      for (const entry of timesheets) {
        if (entry.approval_status === 'rejected') continue
        const key = monthKey(entry.date || entry.created_at || '')
        if (!key) continue
        const current = monthMap.get(key) || { month: key, hours: 0, billable_hours: 0 }
        current.hours += Number(entry.hours_consumed || 0)
        if (Number(entry.is_billable || 0) === 1) current.billable_hours += Number(entry.hours_consumed || 0)
        monthMap.set(key, current)
      }
      const monthly_data = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-6)

      const top_projects = activeProjects
        .map((p) => {
          const burn_pct = toPct(Number(p.consumed_hours || 0), Number(p.total_allocated_hours || 0))
          return {
            id: p.id,
            name: p.name,
            code: p.code,
            status: p.status,
            priority: p.priority,
            total_allocated_hours: p.total_allocated_hours || 0,
            consumed_hours: p.consumed_hours || 0,
            burn_pct,
            timeline_pct: 0,
          }
        })
        .sort((a, b) => b.burn_pct - a.burn_pct)
        .slice(0, 8)

      const utilization = devUsers.map((u) => {
        const monthly_consumed = sum(timesheets.filter((t) => t.user_id === u.id && t.approval_status !== 'rejected' && String(t.date || '').slice(0, 7) === new Date().toISOString().slice(0, 7)), (t) => Number(t.hours_consumed || 0))
        const total_allocated = sum(assignments.filter((a) => a.user_id === u.id && Number(a.is_active || 0) === 1), (a) => Number(a.allocated_hours || 0))
        const utilization_pct = Number(u.monthly_available_hours || 0) > 0 ? Math.round((monthly_consumed / Number(u.monthly_available_hours || 0)) * 100) : 0
        return {
          id: u.id,
          full_name: u.full_name,
          designation: u.designation,
          avatar_color: u.avatar_color,
          monthly_available_hours: u.monthly_available_hours || 0,
          monthly_consumed,
          total_allocated,
          project_count: assignments.filter((a) => a.user_id === u.id && Number(a.is_active || 0) === 1).length,
          utilization_pct,
        }
      })

      const overloaded = utilization.filter((u) => u.utilization_pct > 100).length
      const underutilized = utilization.filter((u) => u.utilization_pct < 50).length

      return res.json({
        data: {
          projects: projectStats,
          developers: { ...devStats, overloaded, underutilized },
          hours: hoursStats,
          recent_logs: recentLogs,
          weekly_data,
          monthly_data,
          top_projects,
          utilization,
        },
      })
    } catch (error: any) {
      return res.json({
        data: {
          projects: {
            total: 0,
            active: 0,
            on_hold: 0,
            completed: 0,
            over_budget: 0,
            near_limit: 0,
            delayed: 0,
          },
          developers: { total: 0, active: 0, overloaded: 0, underutilized: 0 },
          hours: { total_allocated: 0, total_consumed: 0, total_remaining: 0 },
          recent_logs: [],
          weekly_data: [],
          monthly_data: [],
          top_projects: [],
          utilization: [],
        },
      })
    }
  })

  router.get('/developer', async (req, res) => {
    try {
      const user = req.user as any
      const userId = user.sub
      const projects = await models.projects.find({}) as any[]
      const assignments = await models.projectAssignments.find({ user_id: userId, is_active: 1 }) as any[]
      const timesheets = await models.timesheets.find({ user_id: userId }) as any[]
      const userInfo = await models.users.findById(userId) as any

      const myProjects = assignments
        .map((a) => ({
          ...a,
          project_name: projects.find((p) => p.id === a.project_id)?.name,
          code: projects.find((p) => p.id === a.project_id)?.code,
          status: projects.find((p) => p.id === a.project_id)?.status,
          priority: projects.find((p) => p.id === a.project_id)?.priority,
          expected_end_date: projects.find((p) => p.id === a.project_id)?.expected_end_date,
          total_allocated_hours: projects.find((p) => p.id === a.project_id)?.total_allocated_hours || 0,
          project_consumed: projects.find((p) => p.id === a.project_id)?.consumed_hours || 0,
          my_logged: sum(timesheets.filter((t) => t.project_id === a.project_id && t.approval_status !== 'rejected'), (t) => Number(t.hours_consumed || 0)),
        }))

      const today = new Date().toISOString().slice(0, 10)
      const todayLogs = timesheets.filter((t) => t.date === today)
      const weeklyHours = Array.from({ length: 7 }, (_, idx) => {
        const d = new Date()
        d.setDate(d.getDate() - (6 - idx))
        const date = d.toISOString().slice(0, 10)
        return { date, hours: sum(timesheets.filter((t) => t.date === date && t.approval_status !== 'rejected'), (t) => Number(t.hours_consumed || 0)) }
      })
      const monthlyHours = Array.from(new Map(timesheets.filter((t) => t.approval_status !== 'rejected').map((t) => [String(t.date || '').slice(0, 7), t])).keys())
        .sort()
        .slice(-6)
        .map((month) => ({
          month,
          hours: sum(timesheets.filter((t) => String(t.date || '').slice(0, 7) === month && t.approval_status !== 'rejected'), (t) => Number(t.hours_consumed || 0)),
          billable: sum(timesheets.filter((t) => String(t.date || '').slice(0, 7) === month && t.approval_status !== 'rejected' && Number(t.is_billable || 0) === 1), (t) => Number(t.hours_consumed || 0)),
        }))
      const pending_approvals = timesheets.filter((t) => t.approval_status === 'pending').length
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

      const monthlyConsumed = sum(timesheets.filter((t) => t.approval_status !== 'rejected' && String(t.date || '').slice(0, 7) === new Date().toISOString().slice(0, 7)), (t) => Number(t.hours_consumed || 0))
      const capacity = Number(userInfo?.monthly_available_hours || 160)
      const utilizationPct = Math.round((monthlyConsumed / capacity) * 100)

      return res.json({
        data: {
          user: {
            ...userInfo,
            monthly_consumed: monthlyConsumed,
            total_allocated: sum(assignments, (a) => Number(a.allocated_hours || 0)),
          },
          capacity: { total: capacity, consumed: monthlyConsumed, remaining: Math.max(0, capacity - monthlyConsumed), utilization_pct: utilizationPct },
          projects: myProjects,
          today_logs: todayLogs,
          weekly_hours: weeklyHours,
          monthly_hours: monthlyHours,
          pending_approvals,
          suggestions,
        },
      })
    } catch (error: any) {
      return res.json({
        data: {
          user: null,
          capacity: { total: 0, consumed: 0, remaining: 0, utilization_pct: 0 },
          projects: [],
          today_logs: [],
          weekly_hours: [],
          monthly_hours: [],
          pending_approvals: 0,
          suggestions: [],
        },
      })
    }
  })

  router.get('/executive', async (req, res) => {
    try {
      const users = await models.users.find({}) as any[]
      const projects = await models.projects.find({}) as any[]
      const timesheets = await models.timesheets.find({}) as any[]

      const team_capacity = {
        total_capacity: sum(users.filter((u) => u.role === 'developer'), (u) => Number(u.monthly_available_hours || 0)),
        total_devs: users.filter((u) => u.role === 'developer').length,
        active_capacity: sum(users.filter((u) => u.role === 'developer' && Number(u.is_active || 0) === 1), (u) => Number(u.monthly_available_hours || 0)),
      }
      const project_costs = projects
        .filter((p) => ['active', 'completed'].includes(p.status))
        .map((p) => ({
          id: p.id,
          name: p.name,
          revenue: p.revenue || 0,
          effort_cost: 0,
          consumed_hours: p.consumed_hours || 0,
          total_allocated_hours: p.total_allocated_hours || 0,
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10)
      const monthlyTrend = [...new Set(timesheets.map((t) => String(t.date || '').slice(0, 7)))].sort().slice(-12).map((month) => ({
        month,
        total_hours: sum(timesheets.filter((t) => String(t.date || '').slice(0, 7) === month && t.approval_status !== 'rejected'), (t) => Number(t.hours_consumed || 0)),
        billable_hours: sum(timesheets.filter((t) => String(t.date || '').slice(0, 7) === month && t.approval_status !== 'rejected' && Number(t.is_billable || 0) === 1), (t) => Number(t.hours_consumed || 0)),
        active_devs: new Set(timesheets.filter((t) => String(t.date || '').slice(0, 7) === month && t.approval_status !== 'rejected').map((t) => t.user_id)).size,
      }))
      const top_developers = users
        .filter((u) => u.role === 'developer' && Number(u.is_active || 0) === 1)
        .map((u) => ({
          id: u.id,
          full_name: u.full_name,
          designation: u.designation,
          avatar_color: u.avatar_color,
          hourly_cost: u.hourly_cost || 0,
          total_logged: sum(timesheets.filter((t) => t.user_id === u.id && t.approval_status !== 'rejected'), (t) => Number(t.hours_consumed || 0)),
          billable_hours: sum(timesheets.filter((t) => t.user_id === u.id && t.approval_status !== 'rejected' && Number(t.is_billable || 0) === 1), (t) => Number(t.hours_consumed || 0)),
          projects_worked: new Set(timesheets.filter((t) => t.user_id === u.id && t.approval_status !== 'rejected').map((t) => t.project_id)).size,
        }))
        .sort((a, b) => b.total_logged - a.total_logged)
        .slice(0, 10)

      return res.json({
        data: {
          team_capacity,
          project_costs,
          monthly_trend: monthlyTrend,
          top_developers,
        },
      })
    } catch (error: any) {
      return res.json({
        data: {
          team_capacity: {
            total_capacity: 0,
            total_devs: 0,
            active_capacity: 0,
          },
          project_costs: [],
          monthly_trend: [],
          top_developers: [],
        },
      })
    }
  })

  return router
}
