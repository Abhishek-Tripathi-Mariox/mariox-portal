import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, requireRole } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'
import {
  validateLength,
  validateOptional,
  validateHexColor,
  respondWithError,
} from '../validators'

async function enrichTeams(models: MongoModels, teams: any[]) {
  const [users, members, projects] = await Promise.all([
    models.users.find({}) as Promise<any[]>,
    models.projectTeamMembers.find({}) as Promise<any[]>,
    models.projects.find({}) as Promise<any[]>,
  ])
  const usersById = new Map(users.map((u) => [String(u.id), u]))
  const projectsById = new Map(projects.map((p) => [String(p.id), p]))
  const membersByTeam = new Map<string, any[]>()
  for (const m of members) {
    const key = String(m.project_team_id)
    const list = membersByTeam.get(key) || []
    const u = usersById.get(String(m.user_id)) as any
    if (u) {
      list.push({
        ...m,
        full_name: u.full_name,
        email: u.email,
        designation: u.designation,
        avatar_color: u.avatar_color,
        hourly_cost: u.hourly_cost,
      })
    }
    membersByTeam.set(key, list)
  }
  return teams.map((t) => {
    const lead = usersById.get(String(t.team_lead_id)) as any
    const project = projectsById.get(String(t.project_id)) as any
    const list = membersByTeam.get(String(t.id)) || []
    list.sort((a, b) => (a.role === 'lead' ? -1 : 1) - (b.role === 'lead' ? -1 : 1))
    return {
      ...t,
      lead_name: lead?.full_name || null,
      lead_avatar: lead?.avatar_color || null,
      member_count: list.length,
      members: list,
      project_name: project?.name || null,
    }
  })
}

export function createProjectTeamsRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  router.get('/', async (_req, res) => {
    try {
      const teams = await models.projectTeams.find({}) as any[]
      teams.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      const enriched = await enrichTeams(models, teams)
      return res.json({ data: enriched, teams: enriched })
    } catch {
      return res.json({ data: [], teams: [] })
    }
  })

  router.get('/project/:projectId', async (req, res) => {
    try {
      const projectId = String(req.params.projectId)
      const teams = await models.projectTeams.find({ project_id: projectId }) as any[]
      teams.sort((a, b) => (Number(a.position || 0) - Number(b.position || 0)) || String(a.created_at || '').localeCompare(String(b.created_at || '')))
      const enriched = await enrichTeams(models, teams)
      return res.json({ data: enriched, teams: enriched })
    } catch {
      return res.json({ data: [], teams: [] })
    }
  })

  router.post('/', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
      const user = req.user as any
      const body = req.body || {}
      validateLength(String(body.name || '').trim(), 2, 80, 'Team name')
      if (body.color) validateHexColor(body.color, 'Color')
      const projectId = body.project_id ? String(body.project_id) : null
      const id = await createTeam(models, user, projectId, body)
      return res.status(201).json({ data: { id, project_id: projectId }, message: 'Team created successfully' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.post('/project/:projectId', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
      const user = req.user as any
      const projectId = String(req.params.projectId)
      const body = req.body || {}
      validateLength(String(body.name || '').trim(), 2, 80, 'Team name')
      if (body.color) validateHexColor(body.color, 'Color')
      const id = await createTeam(models, user, projectId, body)
      return res.status(201).json({ data: { id, project_id: projectId }, message: 'Team created successfully' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.get('/:teamId', async (req, res) => {
    try {
      const team = await models.projectTeams.findById(String(req.params.teamId)) as any
      if (!team) return res.status(404).json({ error: 'Team not found' })
      const [enriched] = await enrichTeams(models, [team])
      return res.json({ data: enriched, team: enriched })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load team' })
    }
  })

  router.put('/:teamId', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
      const teamId = String(req.params.teamId)
      const body = req.body || {}
      const name = validateLength(String(body.name || '').trim(), 2, 80, 'Team name')
      const description = validateOptional(body.description, (v) => validateLength(String(v).trim(), 0, 2000, 'Description'))
      const color = body.color ? validateHexColor(body.color, 'Color') : '#6366f1'
      await models.projectTeams.updateById(teamId, {
        $set: {
          name,
          description,
          team_lead_id: body.team_lead_id || null,
          color,
          updated_at: new Date().toISOString(),
        },
      })
      return res.json({ message: 'Team updated' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.delete('/:teamId', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
      const teamId = String(req.params.teamId)
      await models.projectAssignments.updateMany({ project_team_id: teamId }, { $set: { project_team_id: null } })
      await models.tasks.updateMany({ project_team_id: teamId }, { $set: { project_team_id: null } })
      await models.projectTeamMembers.deleteMany({ project_team_id: teamId })
      await models.projectTeams.deleteById(teamId)
      return res.json({ message: 'Team deleted' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to delete team' })
    }
  })

  router.post('/:teamId/members', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
      const teamId = String(req.params.teamId)
      const { user_id, role } = req.body || {}
      if (!user_id) return res.status(400).json({ error: 'user_id is required' })
      const existing = await models.projectTeamMembers.findOne({ project_team_id: teamId, user_id }) as any
      const now = new Date().toISOString()
      if (existing) {
        await models.projectTeamMembers.updateById(existing.id, {
          $set: { role: role || 'member', updated_at: now },
        })
      } else {
        await models.projectTeamMembers.insertOne({
          id: generateId('ptm'),
          project_team_id: teamId,
          user_id,
          role: role || 'member',
          created_at: now,
          updated_at: now,
        })
      }
      if (role === 'lead') {
        await models.projectTeams.updateById(teamId, { $set: { team_lead_id: user_id, updated_at: now } })
      }
      return res.status(201).json({ message: 'Member added' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to add member' })
    }
  })

  router.delete('/:teamId/members/:userId', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
      const teamId = String(req.params.teamId)
      const userId = String(req.params.userId)
      await models.projectTeamMembers.deleteOne({ project_team_id: teamId, user_id: userId })
      const team = await models.projectTeams.findById(teamId) as any
      if (team?.team_lead_id === userId) {
        await models.projectTeams.updateById(teamId, {
          $set: { team_lead_id: null, updated_at: new Date().toISOString() },
        })
      }
      return res.json({ message: 'Member removed' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to remove member' })
    }
  })

  return router
}

async function createTeam(models: MongoModels, user: any, projectId: string | null, body: any) {
  const existing = await models.projectTeams.find(
    projectId ? { project_id: projectId } : { project_id: null }
  ) as any[]
  const position = existing.reduce((max, t) => Math.max(max, Number(t.position || 0)), -1) + 1
  const id = generateId('pt')
  const now = new Date().toISOString()
  await models.projectTeams.insertOne({
    id,
    project_id: projectId,
    name: String(body.name).trim(),
    description: body.description || null,
    team_lead_id: body.team_lead_id || null,
    color: body.color || '#6366f1',
    position,
    created_by: user?.sub || null,
    created_at: now,
    updated_at: now,
  })
  if (body.team_lead_id) {
    await models.projectTeamMembers.insertOne({
      id: generateId('ptm'),
      project_team_id: id,
      user_id: body.team_lead_id,
      role: 'lead',
      created_at: now,
      updated_at: now,
    })
  }
  return id
}
