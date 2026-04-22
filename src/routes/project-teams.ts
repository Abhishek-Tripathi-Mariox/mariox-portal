import { Hono } from 'hono'
import { authMiddleware, requireRole } from '../middleware/auth'
import { generateId } from '../utils/helpers'

type Bindings = { DB: D1Database }
type Variables = { user: any }

// Mounted at /api/projects/:id/teams (parent projects.ts delegates here)
// We also expose /api/project-teams/:teamId for direct team operations
const projectTeams = new Hono<{ Bindings: Bindings; Variables: Variables }>()
projectTeams.use('*', authMiddleware)

// GET /api/projects/:projectId/teams — list teams in a project
projectTeams.get('/project/:projectId', async (c) => {
  try {
    const projectId = c.req.param('projectId')
    const teams = await c.env.DB.prepare(`
      SELECT pt.*,
        u.full_name as lead_name, u.avatar_color as lead_avatar,
        (SELECT COUNT(*) FROM project_team_members ptm WHERE ptm.project_team_id = pt.id) as member_count
      FROM project_teams pt
      LEFT JOIN users u ON pt.team_lead_id = u.id
      WHERE pt.project_id = ?
      ORDER BY pt.position, pt.created_at
    `).bind(projectId).all()

    // Attach members for each team
    const results = await Promise.all((teams.results as any[]).map(async (t) => {
      const members = await c.env.DB.prepare(`
        SELECT ptm.*, u.full_name, u.email, u.designation, u.avatar_color
        FROM project_team_members ptm
        JOIN users u ON ptm.user_id = u.id
        WHERE ptm.project_team_id = ?
        ORDER BY CASE ptm.role WHEN 'lead' THEN 0 ELSE 1 END, u.full_name
      `).bind(t.id).all()
      return { ...t, members: members.results }
    }))

    return c.json({ data: results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// POST /api/projects/:projectId/teams — create a team within a project
projectTeams.post('/project/:projectId', requireRole('admin', 'pm'), async (c) => {
  try {
    const user = c.get('user')
    const projectId = c.req.param('projectId')
    const body = await c.req.json()

    if (!body.name?.trim()) return c.json({ error: 'Team name is required' }, 400)

    const id = generateId('pt')
    await c.env.DB.prepare(`
      INSERT INTO project_teams (id, project_id, name, description, team_lead_id, color, position, created_by)
      VALUES (?, ?, ?, ?, ?, ?,
        COALESCE((SELECT MAX(position)+1 FROM project_teams WHERE project_id = ?), 0),
        ?)
    `).bind(
      id, projectId, body.name.trim(), body.description || null,
      body.team_lead_id || null, body.color || '#6366f1',
      projectId, user.sub
    ).run()

    // If a lead was specified, add them as a team member with role 'lead'
    if (body.team_lead_id) {
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO project_team_members (id, project_team_id, user_id, role)
        VALUES (?, ?, ?, 'lead')
      `).bind(generateId('ptm'), id, body.team_lead_id).run()
    }

    return c.json({ data: { id }, message: 'Team created successfully' }, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// GET /api/project-teams/:teamId — single team detail
projectTeams.get('/:teamId', async (c) => {
  try {
    const teamId = c.req.param('teamId')
    const team = await c.env.DB.prepare(`
      SELECT pt.*, u.full_name as lead_name, u.avatar_color as lead_avatar, p.name as project_name
      FROM project_teams pt
      LEFT JOIN users u ON pt.team_lead_id = u.id
      JOIN projects p ON pt.project_id = p.id
      WHERE pt.id = ?
    `).bind(teamId).first()
    if (!team) return c.json({ error: 'Team not found' }, 404)

    const members = await c.env.DB.prepare(`
      SELECT ptm.*, u.full_name, u.email, u.designation, u.avatar_color, u.hourly_cost
      FROM project_team_members ptm
      JOIN users u ON ptm.user_id = u.id
      WHERE ptm.project_team_id = ?
    `).bind(teamId).all()

    return c.json({ data: { ...team, members: members.results } })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// PUT /api/project-teams/:teamId — update team
projectTeams.put('/:teamId', requireRole('admin', 'pm'), async (c) => {
  try {
    const teamId = c.req.param('teamId')
    const body = await c.req.json()
    await c.env.DB.prepare(`
      UPDATE project_teams SET name=?, description=?, team_lead_id=?, color=?, updated_at=datetime('now')
      WHERE id=?
    `).bind(
      body.name, body.description || null, body.team_lead_id || null,
      body.color || '#6366f1', teamId
    ).run()
    return c.json({ message: 'Team updated' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// DELETE /api/project-teams/:teamId
projectTeams.delete('/:teamId', requireRole('admin', 'pm'), async (c) => {
  try {
    const teamId = c.req.param('teamId')
    // Detach from assignments and tasks (don't delete them)
    await c.env.DB.prepare('UPDATE project_assignments SET project_team_id=NULL WHERE project_team_id=?').bind(teamId).run()
    await c.env.DB.prepare('UPDATE tasks SET project_team_id=NULL WHERE project_team_id=?').bind(teamId).run()
    await c.env.DB.prepare('DELETE FROM project_team_members WHERE project_team_id=?').bind(teamId).run()
    await c.env.DB.prepare('DELETE FROM project_teams WHERE id=?').bind(teamId).run()
    return c.json({ message: 'Team deleted' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// POST /api/project-teams/:teamId/members — add a member
projectTeams.post('/:teamId/members', requireRole('admin', 'pm'), async (c) => {
  try {
    const teamId = c.req.param('teamId')
    const { user_id, role } = await c.req.json()
    if (!user_id) return c.json({ error: 'user_id is required' }, 400)

    const id = generateId('ptm')
    await c.env.DB.prepare(`
      INSERT INTO project_team_members (id, project_team_id, user_id, role)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(project_team_id, user_id) DO UPDATE SET role=excluded.role
    `).bind(id, teamId, user_id, role || 'member').run()

    // If they're being added as lead, reflect on the team record
    if (role === 'lead') {
      await c.env.DB.prepare('UPDATE project_teams SET team_lead_id=? WHERE id=?').bind(user_id, teamId).run()
    }

    return c.json({ message: 'Member added' }, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// DELETE /api/project-teams/:teamId/members/:userId
projectTeams.delete('/:teamId/members/:userId', requireRole('admin', 'pm'), async (c) => {
  try {
    const teamId = c.req.param('teamId')
    const userId = c.req.param('userId')
    await c.env.DB.prepare('DELETE FROM project_team_members WHERE project_team_id=? AND user_id=?').bind(teamId, userId).run()
    // If they were the lead, clear that too
    await c.env.DB.prepare('UPDATE project_teams SET team_lead_id=NULL WHERE id=? AND team_lead_id=?').bind(teamId, userId).run()
    return c.json({ message: 'Member removed' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

export default projectTeams
