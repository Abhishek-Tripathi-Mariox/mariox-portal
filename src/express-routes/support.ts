import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'
import {
  TICKET_STATUS,
  TICKET_PRIORITY,
  TICKET_CATEGORIES,
} from '../constants'
import {
  validateLength,
  validateEnum,
  respondWithError,
} from '../validators'
import { createUserNotifications } from './notifications'

type Role = 'admin' | 'pm' | 'pc' | 'developer' | 'team' | 'client' | string

const STAFF_ROLES = new Set(['admin', 'pm', 'pc', 'developer', 'team'])
const PM_ROLES = new Set(['admin', 'pm', 'pc'])
const DEV_ROLES = new Set(['developer', 'team'])

const VALID_STATUS = new Set(Object.values(TICKET_STATUS))
const VALID_PRIORITY = new Set(Object.values(TICKET_PRIORITY))
const VALID_CATEGORY = new Set<string>(TICKET_CATEGORIES as readonly string[])

function role(user: any): Role {
  return String(user?.role || '').toLowerCase()
}

function isStaff(user: any) {
  return STAFF_ROLES.has(role(user))
}

function isPmOrAdmin(user: any) {
  return PM_ROLES.has(role(user))
}

function isClient(user: any) {
  return role(user) === 'client'
}

function isDeveloper(user: any) {
  return DEV_ROLES.has(role(user))
}

function canViewTicket(user: any, ticket: any, scope: { projectIds: Set<string>; assignedProjectIds: Set<string> }) {
  if (!ticket) return false
  if (isPmOrAdmin(user)) return true
  if (isClient(user)) {
    return ticket.client_id === user.sub || ticket.created_by_id === user.sub
  }
  if (isDeveloper(user)) {
    if (ticket.assigned_to_id === user.sub) return true
    if (ticket.created_by_id === user.sub) return true
    if (ticket.project_id && scope.projectIds.has(String(ticket.project_id))) return true
    if (ticket.project_id && scope.assignedProjectIds.has(String(ticket.project_id))) return true
    return false
  }
  return false
}

async function loadUserProjectScope(models: MongoModels, userId: string) {
  const [memberships, assignments] = await Promise.all([
    models.projectTeamMembers.find({ user_id: userId }) as Promise<any[]>,
    models.projectAssignments.find({ user_id: userId }) as Promise<any[]>,
  ])
  const teamIds = memberships.map((m) => m.project_team_id || m.team_id).filter(Boolean)
  const teamProjectIds = new Set<string>()
  if (teamIds.length) {
    const teams = await models.projectTeams.find({ id: { $in: teamIds } }) as any[]
    for (const t of teams) if (t.project_id) teamProjectIds.add(String(t.project_id))

    // Also include projects that pinned this team as their external team
    const externalProjects = await models.projects.find({
      external_team_id: { $in: teamIds },
      assignment_type: 'external',
    }) as any[]
    for (const p of externalProjects) teamProjectIds.add(String(p.id))
  }
  // Projects with this user as the external single-user assignee
  const externalUserProjects = await models.projects.find({
    external_team_id: userId,
    external_assignee_type: 'user',
  }) as any[]
  for (const p of externalUserProjects) teamProjectIds.add(String(p.id))

  const assignedProjectIds = new Set<string>(
    assignments.map((a) => String(a.project_id)).filter(Boolean),
  )
  return { projectIds: teamProjectIds, assignedProjectIds }
}

async function loadEligibleAssigneeIds(models: MongoModels, projectId: string | null) {
  const ids = new Set<string>()
  if (!projectId) {
    const managers = await models.users.find({
      role: { $in: ['admin', 'pm', 'pc'] },
      is_active: 1,
    }) as any[]
    for (const u of managers) ids.add(String(u.id))
    return ids
  }
  const project = await models.projects.findById(projectId) as any
  if (!project) return ids
  if (project.pm_id) ids.add(String(project.pm_id))
  if (project.team_lead_id) ids.add(String(project.team_lead_id))

  if (project.assignment_type === 'external' && project.external_team_id) {
    if (project.external_assignee_type === 'user') {
      ids.add(String(project.external_team_id))
    } else {
      const members = await models.projectTeamMembers.find({
        project_team_id: project.external_team_id,
      }) as any[]
      for (const m of members) if (m.user_id) ids.add(String(m.user_id))
    }
  } else {
    const assignments = await models.projectAssignments.find({ project_id: projectId }) as any[]
    for (const a of assignments) if (a.user_id) ids.add(String(a.user_id))
  }
  return ids
}

async function resolveActorName(models: MongoModels, actorId: string, actorRole: string): Promise<string> {
  if (!actorId) return 'System'
  if (actorRole === 'client') {
    const c = await models.clients.findById(actorId) as any
    return c?.contact_name || c?.company_name || c?.email || 'Client'
  }
  const u = await models.users.findById(actorId) as any
  return u?.full_name || u?.email || 'Staff'
}

async function resolveUserName(models: MongoModels, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null
  const u = await models.users.findById(userId) as any
  if (u) return u.full_name || u.email || null
  const c = await models.clients.findById(userId) as any
  return c?.contact_name || c?.company_name || c?.email || null
}

/**
 * Stakeholders for a ticket: PM/PC of the project + the ticket creator
 * + the current assignee (if any). Excludes the actor when caller passes
 * actor_id on the createUserNotifications call.
 */
async function ticketStakeholderIds(models: MongoModels, ticket: any): Promise<string[]> {
  const ids = new Set<string>()
  if (ticket.created_by_id) ids.add(String(ticket.created_by_id))
  if (ticket.assigned_to_id) ids.add(String(ticket.assigned_to_id))
  if (ticket.project_id) {
    const project = await models.projects.findById(ticket.project_id) as any
    if (project?.pm_id) ids.add(String(project.pm_id))
    if (project?.pc_id) ids.add(String(project.pc_id))
  }
  return Array.from(ids)
}

async function recordTicketEvent(
  models: MongoModels,
  params: {
    ticketId: string
    actorId: string
    actorRole: string
    type: string
    from?: any
    to?: any
    fromLabel?: string | null
    toLabel?: string | null
    note?: string
  },
) {
  try {
    const actorName = await resolveActorName(models, params.actorId, params.actorRole)
    await models.supportEvents.insertOne({
      id: generateId('tevt'),
      ticket_id: params.ticketId,
      actor_id: params.actorId,
      actor_role: params.actorRole,
      actor_name: actorName,
      type: params.type,
      from_value: params.from ?? null,
      to_value: params.to ?? null,
      from_label: params.fromLabel ?? null,
      to_label: params.toLabel ?? null,
      note: params.note || null,
      created_at: new Date().toISOString(),
    })
  } catch (e) {
    console.warn('Failed to record ticket event:', e)
  }
}

export function createSupportRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  // List tickets
  router.get('/tickets', async (req, res) => {
    try {
      const user = req.user as any
      const { status, priority, project_id, assigned_to_id, client_id } = req.query as Record<string, string | undefined>
      const filter: Record<string, any> = {}
      if (status) filter.status = status
      if (priority) filter.priority = priority
      if (project_id) filter.project_id = project_id
      if (assigned_to_id) filter.assigned_to_id = assigned_to_id

      if (isPmOrAdmin(user)) {
        if (client_id) filter.client_id = client_id
      } else if (isClient(user)) {
        filter.$or = [{ client_id: user.sub }, { created_by_id: user.sub }]
      } else if (isDeveloper(user)) {
        const scope = await loadUserProjectScope(models, user.sub)
        const allProjectIds = Array.from(new Set<string>([
          ...scope.projectIds,
          ...scope.assignedProjectIds,
        ]))
        const visibility: any[] = [{ assigned_to_id: user.sub }, { created_by_id: user.sub }]
        if (allProjectIds.length) visibility.push({ project_id: { $in: allProjectIds } })
        filter.$or = visibility
      } else {
        return res.status(403).json({ error: 'Forbidden' })
      }

      const tickets = await models.supportTickets.find(filter, {
        sort: { created_at: -1 },
        limit: 500,
      }) as any[]

      const userIds = new Set<string>()
      const clientIds = new Set<string>()
      const projectIds = new Set<string>()
      for (const t of tickets) {
        if (t.assigned_to_id) userIds.add(t.assigned_to_id)
        if (t.created_by_role !== 'client' && t.created_by_id) userIds.add(t.created_by_id)
        if (t.client_id) clientIds.add(t.client_id)
        if (t.project_id) projectIds.add(t.project_id)
      }
      const [users, clients, projects] = await Promise.all([
        userIds.size ? models.users.find({ id: { $in: Array.from(userIds) } }) as Promise<any[]> : Promise.resolve([]),
        clientIds.size ? models.clients.find({ id: { $in: Array.from(clientIds) } }) as Promise<any[]> : Promise.resolve([]),
        projectIds.size ? models.projects.find({ id: { $in: Array.from(projectIds) } }) as Promise<any[]> : Promise.resolve([]),
      ])
      const usersById = new Map(users.map((u: any) => [String(u.id), u]))
      const clientsById = new Map(clients.map((c: any) => [String(c.id), c]))
      const projectsById = new Map(projects.map((p: any) => [String(p.id), p]))

      const enriched = tickets.map((t) => ({
        ...t,
        assigned_to_name: t.assigned_to_id ? usersById.get(String(t.assigned_to_id))?.full_name || null : null,
        created_by_name:
          t.created_by_role === 'client'
            ? clientsById.get(String(t.created_by_id))?.contact_name || null
            : usersById.get(String(t.created_by_id))?.full_name || null,
        client_name: t.client_id ? clientsById.get(String(t.client_id))?.company_name || null : null,
        project_name: t.project_id ? projectsById.get(String(t.project_id))?.name || null : null,
      }))

      return res.json({ tickets: enriched, data: enriched })
    } catch (error: any) {
      return res.json({ tickets: [], data: [] })
    }
  })

  // Create ticket
  router.post('/tickets', async (req, res) => {
    try {
      const user = req.user as any
      const body = req.body || {}
      const subject = validateLength(String(body.subject || '').trim(), 3, 200, 'Subject')
      const description = validateLength(String(body.description || '').trim(), 5, 5000, 'Description')
      const priority = validateEnum(
        body.priority || TICKET_PRIORITY.MEDIUM,
        Object.values(TICKET_PRIORITY) as readonly string[],
        'Priority',
      )
      const category = validateEnum(
        body.category || 'other',
        TICKET_CATEGORIES as readonly string[],
        'Category',
      )

      let clientId: string | null = null
      let projectId: string | null = body.project_id || null
      let createdByRole: 'staff' | 'client'

      if (isClient(user)) {
        createdByRole = 'client'
        clientId = user.sub
        if (projectId) {
          const project = await models.projects.findById(projectId) as any
          if (!project || project.client_id !== user.sub) {
            return res.status(403).json({ error: 'Project not accessible' })
          }
        }
      } else if (isStaff(user)) {
        createdByRole = 'staff'
        clientId = body.client_id || null
        if (clientId) {
          const client = await models.clients.findById(clientId)
          if (!client) return res.status(400).json({ error: 'Invalid client_id' })
        }
        if (projectId) {
          const project = await models.projects.findById(projectId)
          if (!project) return res.status(400).json({ error: 'Invalid project_id' })
        }
      } else {
        return res.status(403).json({ error: 'Forbidden' })
      }

      let assignedToId: string | null = null
      if (isStaff(user) && body.assigned_to_id) {
        const eligible = await loadEligibleAssigneeIds(models, projectId)
        if (!eligible.has(String(body.assigned_to_id))) {
          return res.status(400).json({ error: 'Assignee is not related to this project' })
        }
        assignedToId = String(body.assigned_to_id)
      }

      const now = new Date().toISOString()
      const ticket = {
        id: generateId('ticket'),
        subject: String(subject).trim(),
        description: String(description),
        status: TICKET_STATUS.OPEN,
        priority,
        category,
        project_id: projectId,
        client_id: clientId,
        created_by_id: user.sub,
        created_by_role: createdByRole,
        assigned_to_id: assignedToId,
        tags: Array.isArray(body.tags) ? body.tags : [],
        resolved_at: null,
        closed_at: null,
        created_at: now,
        updated_at: now,
      }

      await models.supportTickets.insertOne(ticket)
      await recordTicketEvent(models, {
        ticketId: ticket.id,
        actorId: user.sub,
        actorRole: createdByRole,
        type: 'created',
        toLabel: ticket.subject,
      })
      const actorName = await resolveActorName(models, user.sub, createdByRole)
      // Notify all stakeholders that a new ticket was raised
      const stakeholders = await ticketStakeholderIds(models, ticket)
      await createUserNotifications(models, stakeholders, {
        type: 'ticket_created',
        title: `New ticket: ${ticket.subject}`,
        body: `${actorName} raised a ${ticket.priority} priority ticket`,
        link: `ticket:${ticket.id}`,
        actor_id: user.sub,
        actor_name: actorName,
        meta: { ticket_id: ticket.id, project_id: ticket.project_id },
      })
      if (assignedToId) {
        const name = await resolveUserName(models, assignedToId)
        await recordTicketEvent(models, {
          ticketId: ticket.id,
          actorId: user.sub,
          actorRole: createdByRole,
          type: 'assignee_changed',
          from: null,
          to: assignedToId,
          fromLabel: 'Unassigned',
          toLabel: name || 'Assignee',
        })
        // Direct ping to the assignee
        await createUserNotifications(models, [assignedToId], {
          type: 'ticket_assigned',
          title: `Assigned: ${ticket.subject}`,
          body: `${actorName} assigned this ticket to you`,
          link: `ticket:${ticket.id}`,
          actor_id: user.sub,
          actor_name: actorName,
          meta: { ticket_id: ticket.id },
        })
      }
      return res.status(201).json({ ticket, data: ticket })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // Get one ticket (with comments)
  router.get('/tickets/:id', async (req, res) => {
    try {
      const user = req.user as any
      const ticket = await models.supportTickets.findById(req.params.id) as any
      if (!ticket) return res.status(404).json({ error: 'Ticket not found' })

      const scope = isDeveloper(user)
        ? await loadUserProjectScope(models, user.sub)
        : { projectIds: new Set<string>(), assignedProjectIds: new Set<string>() }
      if (!canViewTicket(user, ticket, scope)) {
        return res.status(403).json({ error: 'Forbidden' })
      }

      const commentFilter: any = { ticket_id: ticket.id }
      if (isClient(user)) commentFilter.is_internal = { $ne: 1 }
      const comments = await models.supportComments.find(commentFilter, { sort: { created_at: 1 } }) as any[]

      const events = await models.supportEvents.find(
        { ticket_id: ticket.id },
        { sort: { created_at: 1 } },
      ) as any[]

      return res.json({ ticket, comments, events })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load ticket' })
    }
  })

  // Update ticket
  router.patch('/tickets/:id', async (req, res) => {
    try {
      const user = req.user as any
      const ticket = await models.supportTickets.findById(req.params.id) as any
      if (!ticket) return res.status(404).json({ error: 'Ticket not found' })

      const scope = isDeveloper(user)
        ? await loadUserProjectScope(models, user.sub)
        : { projectIds: new Set<string>(), assignedProjectIds: new Set<string>() }
      if (!canViewTicket(user, ticket, scope)) {
        return res.status(403).json({ error: 'Forbidden' })
      }

      const body = req.body || {}
      const patch: any = { updated_at: new Date().toISOString() }
      const now = patch.updated_at

      if (isPmOrAdmin(user)) {
        // Full edit rights
        for (const k of ['subject', 'description', 'priority', 'category', 'project_id', 'client_id', 'assigned_to_id', 'tags']) {
          if (k in body) patch[k] = body[k]
        }
        if ('assigned_to_id' in body && body.assigned_to_id) {
          const projectIdForCheck = ('project_id' in body ? body.project_id : ticket.project_id) || null
          const eligible = await loadEligibleAssigneeIds(models, projectIdForCheck)
          if (!eligible.has(String(body.assigned_to_id))) {
            return res.status(400).json({ error: 'Assignee is not related to this project' })
          }
        }
        if ('status' in body) {
          const next = String(body.status).toLowerCase()
          if (!VALID_STATUS.has(next as any)) return res.status(400).json({ error: 'Invalid status' })
          patch.status = next
          if (next === TICKET_STATUS.RESOLVED && !ticket.resolved_at) patch.resolved_at = now
          if (next === TICKET_STATUS.CLOSED && !ticket.closed_at) patch.closed_at = now
        }
      } else if (isDeveloper(user)) {
        // Developer: only status (open/in_progress/resolved)
        if ('status' in body) {
          const next = String(body.status).toLowerCase()
          const allowed = [TICKET_STATUS.OPEN, TICKET_STATUS.IN_PROGRESS, TICKET_STATUS.RESOLVED, TICKET_STATUS.WAITING_ON_CLIENT]
          if (!allowed.includes(next as any)) return res.status(403).json({ error: 'Status change not allowed' })
          patch.status = next
          if (next === TICKET_STATUS.RESOLVED && !ticket.resolved_at) patch.resolved_at = now
        }
        if ('priority' in body) {
          const next = String(body.priority).toLowerCase()
          if (!VALID_PRIORITY.has(next as any)) return res.status(400).json({ error: 'Invalid priority' })
          patch.priority = next
        }
        if (Object.keys(patch).length === 1) {
          return res.status(403).json({ error: 'No updatable fields for your role' })
        }
      } else if (isClient(user)) {
        // Client: only their own tickets, and only open ones for content edits; can close anytime
        const isOwner = ticket.created_by_id === user.sub || ticket.client_id === user.sub
        if (!isOwner) return res.status(403).json({ error: 'Forbidden' })

        if ('subject' in body || 'description' in body || 'priority' in body || 'category' in body) {
          if (ticket.status !== TICKET_STATUS.OPEN) {
            return res.status(403).json({ error: 'Cannot edit ticket once it is being worked on' })
          }
          if ('subject' in body) patch.subject = body.subject
          if ('description' in body) patch.description = body.description
          if ('priority' in body) {
            const next = String(body.priority).toLowerCase()
            if (!VALID_PRIORITY.has(next as any)) return res.status(400).json({ error: 'Invalid priority' })
            patch.priority = next
          }
          if ('category' in body) {
            const next = String(body.category).toLowerCase()
            if (!VALID_CATEGORY.has(next)) return res.status(400).json({ error: 'Invalid category' })
            patch.category = next
          }
        }
        if ('status' in body) {
          const next = String(body.status).toLowerCase()
          // Client can close their ticket, or reopen a resolved/closed one
          const allowed = [TICKET_STATUS.CLOSED, TICKET_STATUS.OPEN]
          if (!allowed.includes(next as any)) return res.status(403).json({ error: 'Status change not allowed' })
          patch.status = next
          if (next === TICKET_STATUS.CLOSED) patch.closed_at = now
          if (next === TICKET_STATUS.OPEN) {
            patch.closed_at = null
            patch.resolved_at = null
          }
        }
        if (Object.keys(patch).length === 1) {
          return res.status(403).json({ error: 'No updatable fields for your role' })
        }
      } else {
        return res.status(403).json({ error: 'Forbidden' })
      }

      await models.supportTickets.updateById(ticket.id, { $set: patch })
      const updated = await models.supportTickets.findById(ticket.id) as any

      const actorRole = isClient(user) ? 'client' : (isStaff(user) ? 'staff' : String(user?.role || ''))
      const actorName = await resolveActorName(models, user.sub, actorRole)
      const stakeholders = await ticketStakeholderIds(models, updated)
      const trackedFields: Array<{ key: string; type: string; resolveLabels?: boolean }> = [
        { key: 'status', type: 'status_changed' },
        { key: 'priority', type: 'priority_changed' },
        { key: 'category', type: 'category_changed' },
        { key: 'subject', type: 'subject_edited' },
        { key: 'description', type: 'description_edited' },
        { key: 'project_id', type: 'project_changed', resolveLabels: true },
        { key: 'assigned_to_id', type: 'assignee_changed', resolveLabels: true },
      ]
      for (const f of trackedFields) {
        if (!(f.key in patch)) continue
        const before = (ticket as any)[f.key] ?? null
        const after = (patch as any)[f.key] ?? null
        if (String(before || '') === String(after || '')) continue
        let fromLabel: string | null = before ? String(before) : null
        let toLabel: string | null = after ? String(after) : null
        if (f.resolveLabels) {
          if (f.key === 'assigned_to_id') {
            fromLabel = before ? (await resolveUserName(models, before)) || 'Someone' : 'Unassigned'
            toLabel = after ? (await resolveUserName(models, after)) || 'Someone' : 'Unassigned'
          } else if (f.key === 'project_id') {
            const proj = after ? await models.projects.findById(after) as any : null
            const old = before ? await models.projects.findById(before) as any : null
            fromLabel = old?.name || (before ? 'Previous project' : 'No project')
            toLabel = proj?.name || (after ? 'New project' : 'No project')
          }
        }
        await recordTicketEvent(models, {
          ticketId: ticket.id,
          actorId: user.sub,
          actorRole,
          type: f.type,
          from: before,
          to: after,
          fromLabel,
          toLabel,
        })

        // Emit a user-facing notification per relevant change
        if (f.key === 'status') {
          await createUserNotifications(models, stakeholders, {
            type: 'ticket_status',
            title: `${updated.subject}`,
            body: `${actorName} moved status to ${String(after).replace(/_/g, ' ')}`,
            link: `ticket:${ticket.id}`,
            actor_id: user.sub,
            actor_name: actorName,
            meta: { ticket_id: ticket.id, status: after },
          })
        } else if (f.key === 'priority') {
          await createUserNotifications(models, stakeholders, {
            type: 'ticket_priority',
            title: `${updated.subject}`,
            body: `${actorName} changed priority to ${after}`,
            link: `ticket:${ticket.id}`,
            actor_id: user.sub,
            actor_name: actorName,
            meta: { ticket_id: ticket.id, priority: after },
          })
        } else if (f.key === 'assigned_to_id' && after) {
          // Direct ping to the new assignee + notice for previous assignee
          const recipients = [String(after)]
          if (before) recipients.push(String(before))
          await createUserNotifications(models, recipients, {
            type: 'ticket_assigned',
            title: `${updated.subject}`,
            body: String(after) === String(user.sub)
              ? `${actorName} assigned this ticket (you'll see it in your queue)`
              : `${actorName} assigned this ticket to ${toLabel}`,
            link: `ticket:${ticket.id}`,
            actor_id: user.sub,
            actor_name: actorName,
            meta: { ticket_id: ticket.id, assigned_to_id: after },
          })
        }
      }

      return res.json({ ticket: updated, data: updated })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to update ticket' })
    }
  })

  // Delete ticket (admin/pm only)
  router.delete('/tickets/:id', async (req, res) => {
    try {
      const user = req.user as any
      if (!isPmOrAdmin(user)) return res.status(403).json({ error: 'Forbidden' })
      const ticket = await models.supportTickets.findById(req.params.id)
      if (!ticket) return res.status(404).json({ error: 'Ticket not found' })
      await models.supportTickets.deleteById(req.params.id)
      await models.supportComments.deleteMany({ ticket_id: req.params.id })
      await models.supportEvents.deleteMany({ ticket_id: req.params.id })
      return res.json({ success: true })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to delete ticket' })
    }
  })

  // Assign ticket (admin/pm only)
  router.patch('/tickets/:id/assign', async (req, res) => {
    try {
      const user = req.user as any
      if (!isPmOrAdmin(user)) return res.status(403).json({ error: 'Forbidden' })
      const ticket = await models.supportTickets.findById(req.params.id) as any
      if (!ticket) return res.status(404).json({ error: 'Ticket not found' })
      const { assigned_to_id } = req.body || {}
      if (assigned_to_id) {
        const eligible = await loadEligibleAssigneeIds(models, ticket.project_id || null)
        if (!eligible.has(String(assigned_to_id))) {
          return res.status(400).json({ error: 'Assignee is not related to this project' })
        }
      }
      const now = new Date().toISOString()
      const previousAssignee = ticket.assigned_to_id || null
      const newAssignee = assigned_to_id || null
      await models.supportTickets.updateById(req.params.id, {
        $set: { assigned_to_id: newAssignee, updated_at: now },
      })
      const updated = await models.supportTickets.findById(req.params.id) as any
      if (String(previousAssignee || '') !== String(newAssignee || '')) {
        const fromLabel = previousAssignee ? (await resolveUserName(models, previousAssignee)) || 'Someone' : 'Unassigned'
        const toLabel = newAssignee ? (await resolveUserName(models, newAssignee)) || 'Someone' : 'Unassigned'
        await recordTicketEvent(models, {
          ticketId: ticket.id,
          actorId: user.sub,
          actorRole: 'staff',
          type: 'assignee_changed',
          from: previousAssignee,
          to: newAssignee,
          fromLabel,
          toLabel,
        })
        const actorName = await resolveActorName(models, user.sub, 'staff')
        if (newAssignee) {
          await createUserNotifications(models, [newAssignee], {
            type: 'ticket_assigned',
            title: `${updated.subject}`,
            body: `${actorName} assigned this ticket to you`,
            link: `ticket:${ticket.id}`,
            actor_id: user.sub,
            actor_name: actorName,
            meta: { ticket_id: ticket.id, assigned_to_id: newAssignee },
          })
        }
      }
      return res.json({ ticket: updated })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to assign ticket' })
    }
  })

  // Add comment
  router.post('/tickets/:id/comments', async (req, res) => {
    try {
      const user = req.user as any
      const ticket = await models.supportTickets.findById(req.params.id) as any
      if (!ticket) return res.status(404).json({ error: 'Ticket not found' })

      const scope = isDeveloper(user)
        ? await loadUserProjectScope(models, user.sub)
        : { projectIds: new Set<string>(), assignedProjectIds: new Set<string>() }
      if (!canViewTicket(user, ticket, scope)) {
        return res.status(403).json({ error: 'Forbidden' })
      }

      const body = req.body || {}
      const text = validateLength(
        String(body.body || body.message || '').trim(),
        1,
        5000,
        'Comment body',
      )

      // Only staff can mark a comment as internal (hidden from client)
      const isInternal = isStaff(user) && Number(body.is_internal ? 1 : 0)

      const now = new Date().toISOString()
      const comment = {
        id: generateId('tcomment'),
        ticket_id: ticket.id,
        author_id: user.sub,
        author_role: isClient(user) ? 'client' : 'staff',
        body: text,
        is_internal: isInternal,
        created_at: now,
        updated_at: now,
      }
      await models.supportComments.insertOne(comment)
      await models.supportTickets.updateById(ticket.id, { $set: { updated_at: now } })
      await recordTicketEvent(models, {
        ticketId: ticket.id,
        actorId: user.sub,
        actorRole: comment.author_role,
        type: isInternal ? 'internal_note_added' : 'comment_added',
        toLabel: text.length > 120 ? text.slice(0, 120) + '…' : text,
        note: comment.id,
      })

      // Notify stakeholders. Internal notes skip the client; public replies
      // ping everyone except the author.
      const actorName = await resolveActorName(models, user.sub, comment.author_role)
      let recipients = await ticketStakeholderIds(models, ticket)
      if (isInternal) recipients = recipients.filter((id) => id !== ticket.client_id)
      const preview = text.length > 100 ? text.slice(0, 100) + '…' : text
      await createUserNotifications(models, recipients, {
        type: isInternal ? 'ticket_internal_note' : 'ticket_comment',
        title: `${ticket.subject}`,
        body: `${actorName}${isInternal ? ' added an internal note' : ' replied'}: ${preview}`,
        link: `ticket:${ticket.id}`,
        actor_id: user.sub,
        actor_name: actorName,
        meta: { ticket_id: ticket.id, comment_id: comment.id, internal: isInternal ? 1 : 0 },
      })
      return res.status(201).json({ comment })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // Assignees for a ticket — scoped by project type and roles
  router.get('/assignees', async (req, res) => {
    try {
      const user = req.user as any
      if (isClient(user)) {
        // Clients only need the option to flag PM/PC of their own project
        const projectId = String(req.query.project_id || '')
        if (!projectId) return res.json({ assignees: [], groups: {} })
        const project = await models.projects.findById(projectId) as any
        if (!project || project.client_id !== user.sub) {
          return res.status(403).json({ error: 'Forbidden' })
        }
        const ids = [project.pm_id, project.team_lead_id].filter(Boolean)
        const users = ids.length
          ? await models.users.find({ id: { $in: ids } }) as any[]
          : []
        return res.json({ assignees: users, groups: { managers: users } })
      }
      if (!isStaff(user)) return res.status(403).json({ error: 'Forbidden' })

      const projectId = req.query.project_id ? String(req.query.project_id) : null
      const groups: Record<string, any[]> = { managers: [], developers: [], team: [] }

      if (!projectId) {
        // No project context — return all PMs/PCs and admins
        const managers = await models.users.find({
          role: { $in: ['admin', 'pm', 'pc'] },
          is_active: 1,
        }) as any[]
        groups.managers = managers
        return res.json({ assignees: managers, groups })
      }

      const project = await models.projects.findById(projectId) as any
      if (!project) return res.status(404).json({ error: 'Project not found' })

      const managerIds = [project.pm_id, project.team_lead_id].filter(Boolean)
      if (managerIds.length) {
        groups.managers = await models.users.find({ id: { $in: managerIds } }) as any[]
      }

      if (project.assignment_type === 'external' && project.external_team_id) {
        if (project.external_assignee_type === 'user') {
          const teamUser = await models.users.findById(project.external_team_id) as any
          if (teamUser) groups.team = [teamUser]
        } else {
          const members = await models.projectTeamMembers.find({
            project_team_id: project.external_team_id,
          }) as any[]
          const memberUserIds = members.map((m) => m.user_id).filter(Boolean)
          if (memberUserIds.length) {
            groups.team = await models.users.find({ id: { $in: memberUserIds } }) as any[]
          }
        }
      } else {
        // in-house: developers from project_assignments
        const assignments = await models.projectAssignments.find({ project_id: projectId }) as any[]
        const devIds = assignments.map((a) => a.user_id).filter(Boolean)
        if (devIds.length) {
          groups.developers = await models.users.find({ id: { $in: devIds } }) as any[]
        }
      }

      // Deduplicate union for the flat assignees array
      const seen = new Set<string>()
      const assignees: any[] = []
      for (const list of [groups.managers, groups.developers, groups.team]) {
        for (const u of list) {
          if (!u?.id || seen.has(String(u.id))) continue
          seen.add(String(u.id))
          assignees.push(u)
        }
      }

      return res.json({
        project: {
          id: project.id,
          name: project.name,
          assignment_type: project.assignment_type || 'in_house',
          external_team_id: project.external_team_id || null,
          external_assignee_type: project.external_assignee_type || null,
        },
        assignees,
        groups,
      })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load assignees' })
    }
  })

  // Stats endpoint (admin/pm)
  router.get('/stats', async (req, res) => {
    try {
      const user = req.user as any
      if (!isPmOrAdmin(user)) return res.status(403).json({ error: 'Forbidden' })
      const tickets = await models.supportTickets.find({}) as any[]
      const byStatus: Record<string, number> = {}
      const byPriority: Record<string, number> = {}
      for (const t of tickets) {
        byStatus[t.status] = (byStatus[t.status] || 0) + 1
        byPriority[t.priority] = (byPriority[t.priority] || 0) + 1
      }
      return res.json({
        total: tickets.length,
        open: byStatus[TICKET_STATUS.OPEN] || 0,
        in_progress: byStatus[TICKET_STATUS.IN_PROGRESS] || 0,
        resolved: byStatus[TICKET_STATUS.RESOLVED] || 0,
        closed: byStatus[TICKET_STATUS.CLOSED] || 0,
        by_status: byStatus,
        by_priority: byPriority,
      })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load stats' })
    }
  })

  return router
}
