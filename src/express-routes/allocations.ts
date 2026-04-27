import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware } from '../express-middleware/auth'

export function createAllocationsRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  router.get('/', async (req, res) => {
    try {
      const projectId = typeof req.query.project_id === 'string' ? req.query.project_id : undefined
      const userId = typeof req.query.user_id === 'string' ? req.query.user_id : undefined

      const filter: any = { is_active: 1 }
      if (projectId) filter.project_id = projectId
      if (userId) filter.user_id = userId

      const [assignments, users, projects, timesheets, allAssignments] = await Promise.all([
        models.projectAssignments.find(filter) as Promise<any[]>,
        models.users.find({}) as Promise<any[]>,
        models.projects.find({}) as Promise<any[]>,
        models.timesheets.find({}) as Promise<any[]>,
        models.projectAssignments.find({ is_active: 1 }) as Promise<any[]>,
      ])
      const usersById = new Map(users.map((u) => [String(u.id), u]))
      const projectsById = new Map(projects.map((p) => [String(p.id), p]))

      const loggedHoursByUserProject = new Map<string, number>()
      for (const t of timesheets) {
        if (t.approval_status === 'rejected') continue
        const key = `${t.user_id}::${t.project_id}`
        loggedHoursByUserProject.set(key, (loggedHoursByUserProject.get(key) || 0) + Number(t.hours_consumed || 0))
      }
      const totalAllocatedByUser = new Map<string, number>()
      for (const a of allAssignments) {
        const key = String(a.user_id)
        totalAllocatedByUser.set(key, (totalAllocatedByUser.get(key) || 0) + Number(a.allocated_hours || 0))
      }

      const enriched = assignments
        .map((a) => {
          const u = usersById.get(String(a.user_id)) as any
          const p = projectsById.get(String(a.project_id)) as any
          if (!u || !p) return null
          return {
            ...a,
            full_name: u.full_name,
            designation: u.designation,
            avatar_color: u.avatar_color,
            monthly_available_hours: u.monthly_available_hours || 0,
            project_name: p.name,
            project_code: p.code,
            total_allocated_hours: p.total_allocated_hours || 0,
            logged_hours: loggedHoursByUserProject.get(`${a.user_id}::${a.project_id}`) || 0,
            total_allocated_for_dev: totalAllocatedByUser.get(String(a.user_id)) || 0,
          }
        })
        .filter(Boolean)
        .sort((a: any, b: any) => String(a.project_name || '').localeCompare(String(b.project_name || '')) || String(a.full_name || '').localeCompare(String(b.full_name || '')))

      return res.json({ data: enriched, allocations: enriched })
    } catch {
      return res.json({ data: [], allocations: [] })
    }
  })

  router.get('/summary', async (req, res) => {
    try {
      const [users, assignments] = await Promise.all([
        models.users.find({ role: { $in: ['developer', 'team'] }, is_active: 1 }) as Promise<any[]>,
        models.projectAssignments.find({ is_active: 1 }) as Promise<any[]>,
      ])
      const data = users.map((u) => {
        const mine = assignments.filter((a) => a.user_id === u.id)
        const totalAllocated = mine.reduce((acc, a) => acc + Number(a.allocated_hours || 0), 0)
        const totalConsumed = mine.reduce((acc, a) => acc + Number(a.consumed_hours || 0), 0)
        const available = Number(u.monthly_available_hours || 160)
        return {
          id: u.id,
          full_name: u.full_name,
          designation: u.designation,
          avatar_color: u.avatar_color,
          monthly_available_hours: available,
          total_allocated: totalAllocated,
          total_consumed: totalConsumed,
          project_count: mine.length,
          is_overallocated: totalAllocated > available ? 1 : 0,
          idle_hours: Math.max(0, available - totalAllocated),
        }
      }).sort((a, b) => b.total_allocated - a.total_allocated)
      return res.json({ data, summary: data })
    } catch {
      return res.json({ data: [], summary: [] })
    }
  })

  return router
}
