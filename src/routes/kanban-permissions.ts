import { Hono } from 'hono'
import { authMiddleware, requireRole } from '../middleware/auth'
import { generateId } from '../utils/helpers'

type Bindings = { DB: D1Database }
type Variables = { user: any }

const kanbanPerms = new Hono<{ Bindings: Bindings; Variables: Variables }>()
kanbanPerms.use('*', authMiddleware)

// GET /api/kanban-permissions/project/:projectId — get the permission matrix for a project
kanbanPerms.get('/project/:projectId', async (c) => {
  try {
    const projectId = c.req.param('projectId')
    const rows = await c.env.DB.prepare(
      'SELECT * FROM kanban_permissions WHERE project_id = ? ORDER BY role'
    ).bind(projectId).all()
    return c.json({ data: rows.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// GET /api/kanban-permissions/project/:projectId/mine — what can *I* do on this project's board?
kanbanPerms.get('/project/:projectId/mine', async (c) => {
  try {
    const user = c.get('user')
    const projectId = c.req.param('projectId')

    // If client, look up client-role perms; otherwise use the user's role
    const role = user.role

    // Developers who aren't assigned to this project get 'view only' (no editing)
    let isAssignedDev = false
    if (role === 'developer') {
      const a = await c.env.DB.prepare(
        'SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ? AND is_active = 1'
      ).bind(projectId, user.sub).first()
      isAssignedDev = !!a
    }

    const perms = await c.env.DB.prepare(
      'SELECT * FROM kanban_permissions WHERE project_id = ? AND role = ?'
    ).bind(projectId, role).first() as any

    // Fallback defaults if no row exists yet
    const defaults: Record<string, any> = {
      admin:     { can_view:1, can_create_task:1, can_edit_any_task:1, can_edit_own_task:1, can_move_task:1, can_delete_task:1, can_manage_columns:1, can_comment:1 },
      pm:        { can_view:1, can_create_task:1, can_edit_any_task:1, can_edit_own_task:1, can_move_task:1, can_delete_task:1, can_manage_columns:1, can_comment:1 },
      developer: { can_view:1, can_create_task:1, can_edit_any_task:0, can_edit_own_task:1, can_move_task:1, can_delete_task:0, can_manage_columns:0, can_comment:1 },
      client:    { can_view:1, can_create_task:0, can_edit_any_task:0, can_edit_own_task:0, can_move_task:0, can_delete_task:0, can_manage_columns:0, can_comment:1 },
    }
    const effective = perms || defaults[role] || defaults.client

    // Developers NOT on this project are downgraded to view-only
    if (role === 'developer' && !isAssignedDev) {
      return c.json({
        data: {
          can_view: 1, can_create_task: 0, can_edit_any_task: 0, can_edit_own_task: 0,
          can_move_task: 0, can_delete_task: 0, can_manage_columns: 0, can_comment: 1,
          reason: 'not_assigned'
        }
      })
    }

    return c.json({ data: effective })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// PUT /api/kanban-permissions/project/:projectId — bulk upsert the permission matrix (PM only)
kanbanPerms.put('/project/:projectId', requireRole('admin', 'pm'), async (c) => {
  try {
    const projectId = c.req.param('projectId')
    const { permissions } = await c.req.json()
    if (!Array.isArray(permissions)) return c.json({ error: 'permissions array required' }, 400)

    for (const p of permissions) {
      await c.env.DB.prepare(`
        INSERT INTO kanban_permissions
          (id, project_id, role, can_view, can_create_task, can_edit_any_task, can_edit_own_task, can_move_task, can_delete_task, can_manage_columns, can_comment)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(project_id, role) DO UPDATE SET
          can_view=excluded.can_view,
          can_create_task=excluded.can_create_task,
          can_edit_any_task=excluded.can_edit_any_task,
          can_edit_own_task=excluded.can_edit_own_task,
          can_move_task=excluded.can_move_task,
          can_delete_task=excluded.can_delete_task,
          can_manage_columns=excluded.can_manage_columns,
          can_comment=excluded.can_comment
      `).bind(
        generateId('kp'), projectId, p.role,
        p.can_view ? 1 : 0, p.can_create_task ? 1 : 0,
        p.can_edit_any_task ? 1 : 0, p.can_edit_own_task ? 1 : 0,
        p.can_move_task ? 1 : 0, p.can_delete_task ? 1 : 0,
        p.can_manage_columns ? 1 : 0, p.can_comment ? 1 : 0
      ).run()
    }

    return c.json({ message: 'Permissions updated' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Helper exported for use in tasks.ts (permission check on task mutations)
export async function checkKanbanPerm(
  db: D1Database,
  projectId: string,
  userRole: string,
  userId: string,
  requiredPerm: 'can_create_task' | 'can_edit_any_task' | 'can_edit_own_task' | 'can_move_task' | 'can_delete_task' | 'can_manage_columns' | 'can_comment',
  taskAssigneeId?: string
): Promise<{ allowed: boolean; reason?: string }> {
  // Admin/PM always pass
  if (userRole === 'admin' || userRole === 'pm') return { allowed: true }

  // Devs must be assigned to the project for write ops
  if (userRole === 'developer' && requiredPerm !== 'can_comment') {
    const a = await db.prepare(
      'SELECT 1 FROM project_assignments WHERE project_id = ? AND user_id = ? AND is_active = 1'
    ).bind(projectId, userId).first()
    if (!a) return { allowed: false, reason: 'not_assigned_to_project' }
  }

  const row = await db.prepare(
    'SELECT * FROM kanban_permissions WHERE project_id = ? AND role = ?'
  ).bind(projectId, userRole).first() as any

  // Fallback defaults if the row is missing
  const defaults: Record<string, any> = {
    developer: { can_view:1, can_create_task:1, can_edit_any_task:0, can_edit_own_task:1, can_move_task:1, can_delete_task:0, can_manage_columns:0, can_comment:1 },
    client:    { can_view:1, can_create_task:0, can_edit_any_task:0, can_edit_own_task:0, can_move_task:0, can_delete_task:0, can_manage_columns:0, can_comment:1 },
  }
  const perm = row || defaults[userRole] || defaults.client

  // If requiredPerm is can_edit_own_task, enforce that the user IS the assignee
  if (requiredPerm === 'can_edit_own_task' && taskAssigneeId && taskAssigneeId !== userId) {
    // fall back to can_edit_any_task check
    return { allowed: !!perm.can_edit_any_task, reason: perm.can_edit_any_task ? undefined : 'not_task_owner' }
  }

  return { allowed: !!perm[requiredPerm], reason: perm[requiredPerm] ? undefined : 'forbidden' }
}

export default kanbanPerms
