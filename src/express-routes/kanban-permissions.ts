import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, requireRole } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'

const DEFAULT_PERMS: Record<string, any> = {
  admin: { can_view: 1, can_create_task: 1, can_edit_any_task: 1, can_edit_own_task: 1, can_move_task: 1, can_delete_task: 1, can_manage_columns: 1, can_comment: 1 },
  pm: { can_view: 1, can_create_task: 1, can_edit_any_task: 1, can_edit_own_task: 1, can_move_task: 1, can_delete_task: 1, can_manage_columns: 1, can_comment: 1 },
  pc: { can_view: 1, can_create_task: 1, can_edit_any_task: 1, can_edit_own_task: 1, can_move_task: 1, can_delete_task: 0, can_manage_columns: 0, can_comment: 1 },
  developer: { can_view: 1, can_create_task: 1, can_edit_any_task: 0, can_edit_own_task: 1, can_move_task: 1, can_delete_task: 0, can_manage_columns: 0, can_comment: 1 },
  team: { can_view: 1, can_create_task: 1, can_edit_any_task: 0, can_edit_own_task: 1, can_move_task: 1, can_delete_task: 0, can_manage_columns: 0, can_comment: 1 },
  client: { can_view: 1, can_create_task: 0, can_edit_any_task: 0, can_edit_own_task: 0, can_move_task: 0, can_delete_task: 0, can_manage_columns: 0, can_comment: 1 },
}

export function createKanbanPermissionsRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  router.get('/project/:projectId', async (req, res) => {
    try {
      const rows = await models.kanbanPermissions.find({ project_id: req.params.projectId }) as any[]
      rows.sort((a, b) => String(a.role || '').localeCompare(String(b.role || '')))
      return res.json({ data: rows, permissions: rows })
    } catch {
      return res.json({ data: [], permissions: [] })
    }
  })

  router.get('/project/:projectId/mine', async (req, res) => {
    try {
      const user = req.user as any
      const projectId = req.params.projectId
      const role = String(user?.role || '').toLowerCase()

      let isAssigned = true
      if (role === 'developer' || role === 'team') {
        const a = await models.projectAssignments.findOne({
          project_id: projectId, user_id: user?.sub, is_active: 1,
        })
        isAssigned = !!a
      }

      const perms = await models.kanbanPermissions.findOne({ project_id: projectId, role }) as any
      const effective = perms || DEFAULT_PERMS[role] || DEFAULT_PERMS.client

      if ((role === 'developer' || role === 'team') && !isAssigned) {
        return res.json({
          data: {
            can_view: 1, can_create_task: 0, can_edit_any_task: 0, can_edit_own_task: 0,
            can_move_task: 0, can_delete_task: 0, can_manage_columns: 0, can_comment: 1,
            reason: 'not_assigned',
          },
        })
      }

      return res.json({ data: effective })
    } catch (error: any) {
      return res.json({ data: DEFAULT_PERMS.client })
    }
  })

  router.put('/project/:projectId', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
      const projectId = req.params.projectId
      const { permissions } = req.body || {}
      if (!Array.isArray(permissions)) return res.status(400).json({ error: 'permissions array required' })

      for (const p of permissions) {
        const existing = await models.kanbanPermissions.findOne({ project_id: projectId, role: p.role }) as any
        const patch = {
          can_view: p.can_view ? 1 : 0,
          can_create_task: p.can_create_task ? 1 : 0,
          can_edit_any_task: p.can_edit_any_task ? 1 : 0,
          can_edit_own_task: p.can_edit_own_task ? 1 : 0,
          can_move_task: p.can_move_task ? 1 : 0,
          can_delete_task: p.can_delete_task ? 1 : 0,
          can_manage_columns: p.can_manage_columns ? 1 : 0,
          can_comment: p.can_comment ? 1 : 0,
          updated_at: new Date().toISOString(),
        }
        if (existing) {
          await models.kanbanPermissions.updateById(existing.id, { $set: patch })
        } else {
          await models.kanbanPermissions.insertOne({
            id: generateId('kp'),
            project_id: projectId,
            role: p.role,
            ...patch,
            created_at: new Date().toISOString(),
          })
        }
      }

      return res.json({ message: 'Permissions updated' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to update permissions' })
    }
  })

  return router
}
