import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, requireRole } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'
import {
  validateLength,
  validateEnum,
  respondWithError,
} from '../validators'

const UPDATE_TYPES = ['general', 'milestone', 'release', 'risk', 'announcement'] as const

export function createActivityRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  router.get('/', async (req, res) => {
    try {
      const { project_id, entity_type, limit = '30', client_id } = req.query as Record<string, string | undefined>
      const filter: any = {}
      if (project_id) filter.project_id = project_id
      if (entity_type) filter.entity_type = entity_type
      if (client_id) {
        const clientProjects = await models.projects.find({ client_id }) as any[]
        filter.project_id = { $in: clientProjects.map((p) => p.id) }
      }
      const [logs, projects] = await Promise.all([
        models.activityLogs.find(filter) as Promise<any[]>,
        models.projects.find({}) as Promise<any[]>,
      ])
      const projectsById = new Map(projects.map((p) => [String(p.id), p]))
      const lim = Math.min(parseInt(String(limit)) || 30, 100)
      const enriched = logs
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .slice(0, lim)
        .map((l) => ({
          ...l,
          project_name: projectsById.get(String(l.project_id))?.name || null,
        }))
      return res.json({ logs: enriched, activity: enriched, data: enriched })
    } catch {
      return res.json({ logs: [], activity: [], data: [] })
    }
  })

  router.get('/project/:project_id/feed', async (req, res) => {
    try {
      const projectId = req.params.project_id
      const [logs, comments, updates, users] = await Promise.all([
        models.activityLogs.find({ project_id: projectId }) as Promise<any[]>,
        models.comments.find({ entity_type: 'project', entity_id: projectId }) as Promise<any[]>,
        models.projectUpdates.find({ project_id: projectId }) as Promise<any[]>,
        models.users.find({}) as Promise<any[]>,
      ])
      const usersById = new Map(users.map((u) => [String(u.id), u]))
      logs.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      comments.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      const enrichedUpdates = updates
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .slice(0, 10)
        .map((u) => {
          const author = usersById.get(String(u.posted_by)) as any
          return {
            ...u,
            posted_by_name: author?.full_name || null,
            avatar_color: author?.avatar_color || null,
          }
        })
      return res.json({
        activity: logs.slice(0, 30),
        comments: comments.slice(0, 20),
        updates: enrichedUpdates,
      })
    } catch {
      return res.json({ activity: [], comments: [], updates: [] })
    }
  })

  router.post('/project/:project_id/update', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
      const user = req.user as any
      const projectId = String(req.params.project_id)
      const project = await models.projects.findById(projectId) as any
      if (!project) return res.status(404).json({ error: 'Project not found' })

      const body = req.body || {}
      const title = validateLength(String(body.title || '').trim(), 2, 200, 'Title')
      const content = validateLength(String(body.content || '').trim(), 1, 5000, 'Content')
      const updateType = validateEnum(body.update_type || 'general', UPDATE_TYPES, 'Update type')
      const isClientVisible = body.is_client_visible === false || body.is_client_visible === 0 ? 0 : 1

      const id = generateId('pu')
      const now = new Date().toISOString()
      const update = {
        id,
        project_id: projectId,
        title,
        content,
        update_type: updateType,
        is_client_visible: isClientVisible,
        posted_by: user?.sub || null,
        created_at: now,
        updated_at: now,
      }
      await models.projectUpdates.insertOne(update)

      try {
        await models.activityLogs.insertOne({
          id: generateId('al'),
          project_id: projectId,
          entity_type: 'project',
          entity_id: projectId,
          action: 'updated',
          actor_user_id: user?.sub || null,
          actor_name: user?.name || null,
          actor_role: user?.role || null,
          new_value: title,
          created_at: now,
        })
        if (isClientVisible && project.client_id) {
          await models.notifications.insertOne({
            id: generateId('cn'),
            client_id: project.client_id,
            project_id: projectId,
            type: 'project_update',
            title,
            message: content.slice(0, 200),
            is_read: 0,
            created_at: now,
          })
        }
      } catch {}

      return res.status(201).json({ update, data: update })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  return router
}
