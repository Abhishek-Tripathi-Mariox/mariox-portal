// ───────────────────────────────────────────────────────────────────
// Broadcast notifications
// ───────────────────────────────────────────────────────────────────
// Two-step lifecycle:
//   1. POST   /api/broadcasts            → create a DRAFT (status='draft')
//   2. POST   /api/broadcasts/:id/send   → dispatch the draft to recipients
//                                          (flips status='sent' + fans out)
//   Drafts can be edited (PATCH) or thrown away (DELETE) before they're sent.
//   Sent broadcasts are immutable, but admins with `broadcasts.delete` can
//   still remove them from the history.
//
// Target roles list any role.key from the catalogue. Special sentinels:
//   - "all"     → every active staff user (excludes the synthetic 'client' role)
//   - "client"  → every active client record (fan-out via client_notifications)
//
// Notifications:
//   - Staff users get a row in user_notifications (type='broadcast'),
//     surfacing in the bell icon + SSE stream — the buzz loop on the
//     frontend keeps ringing until they acknowledge.
//   - Clients get a row in client_notifications, surfacing in the client
//     portal's existing notification list.
//
// Gating:
//   GET    /api/broadcasts              → broadcasts.view (admin auto)
//   POST   /api/broadcasts              → broadcasts.create
//   PATCH  /api/broadcasts/:id          → broadcasts.edit  (drafts only)
//   DELETE /api/broadcasts/:id          → broadcasts.delete
//   POST   /api/broadcasts/:id/send     → broadcasts.send  (drafts only)
import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, requireAnyPermission, userHasAnyPermission } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'
import { validateLength, respondWithError } from '../validators'
import { createUserNotifications } from './notifications'

const MAX_TITLE = 160
const MAX_BODY  = 2000

function normalizeTargets(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  for (const raw of input) {
    const v = String(raw || '').trim().toLowerCase()
    if (!v) continue
    out.push(v === '*' ? 'all' : v)
  }
  return Array.from(new Set(out))
}

// Attachment is optional. Upload happens separately via /api/uploads; the
// broadcast just stores the resulting {url, name, mime, size} blob. Returning
// null here means "no attachment" — explicitly removes one on PATCH too.
type BroadcastAttachment = { url: string; name: string; mime: string; size: number }
function normalizeAttachment(input: unknown): BroadcastAttachment | null {
  if (!input || typeof input !== 'object') return null
  const a = input as Record<string, unknown>
  const url = String(a.url || '').trim()
  if (!url) return null
  return {
    url,
    name: String(a.name || '').trim() || 'attachment',
    mime: String(a.mime || a.mime_type || '').trim(),
    size: Number(a.size || 0) || 0,
  }
}

export function createBroadcastsRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  // History — newest first. Returns empty for users without view access
  // rather than 403, so the sidebar tab loads cleanly for anyone.
  router.get('/', async (req, res) => {
    try {
      const user = req.user as any
      const canView = await userHasAnyPermission(models, user,
        'broadcasts.view', 'broadcasts.send', 'broadcasts.create', 'broadcasts.edit', 'broadcasts.delete')
      if (!canView) return res.json({ data: [], broadcasts: [], total: 0 })
      const rows = (await models.broadcasts.find({}) as any[])
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .slice(0, 200)
      return res.json({ data: rows, broadcasts: rows, total: rows.length })
    } catch (e: any) {
      return respondWithError(res, e, 500)
    }
  })

  // Create a new draft. No notifications go out — the user must POST to
  // /:id/send explicitly. recipient_count is computed on send, not now.
  router.post('/', requireAnyPermission(models, 'broadcasts.create'), async (req, res) => {
    try {
      const user = req.user as any
      const body = req.body || {}
      const title = validateLength(String(body.title || '').trim(), 2, MAX_TITLE, 'Title')
      const message = validateLength(String(body.body || body.message || '').trim(), 1, MAX_BODY, 'Message')
      const targets = normalizeTargets(body.target_roles ?? body.targets)
      if (!targets.length) return res.status(400).json({ error: 'Pick at least one role to broadcast to' })
      const attachment = normalizeAttachment(body.attachment)

      const id = generateId('bcast')
      const now = new Date().toISOString()
      const senderName = user?.name || user?.full_name || user?.email || 'Admin'
      const record = {
        id,
        title,
        body: message,
        target_roles: targets,
        attachment,
        recipient_count: 0,
        recipient_ids: [] as string[],
        status: 'draft',
        sent_at: null as string | null,
        sender_id: user?.sub || null,
        sender_name: senderName,
        sender_role: user?.role || null,
        created_at: now,
        updated_at: now,
      }
      await models.broadcasts.insertOne(record)
      return res.status(201).json({ message: 'Broadcast saved as draft', data: record, broadcast: record })
    } catch (e: any) {
      return respondWithError(res, e, 500)
    }
  })

  // Edit a draft (sent broadcasts are immutable).
  router.patch('/:id', requireAnyPermission(models, 'broadcasts.edit'), async (req, res) => {
    try {
      const id = String(req.params.id)
      const existing = await models.broadcasts.findById(id) as any
      if (!existing) return res.status(404).json({ error: 'Broadcast not found' })
      if (existing.status === 'sent') {
        return res.status(409).json({ error: 'This broadcast has already been sent and cannot be edited' })
      }
      const body = req.body || {}
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if ('title' in body)        patch.title = validateLength(String(body.title || '').trim(), 2, MAX_TITLE, 'Title')
      if ('body' in body)         patch.body  = validateLength(String(body.body || '').trim(), 1, MAX_BODY, 'Message')
      else if ('message' in body) patch.body  = validateLength(String(body.message || '').trim(), 1, MAX_BODY, 'Message')
      if ('target_roles' in body || 'targets' in body) {
        const next = normalizeTargets(body.target_roles ?? body.targets)
        if (!next.length) return res.status(400).json({ error: 'Pick at least one role' })
        patch.target_roles = next
      }
      // `attachment: null` removes a previously attached file; an object replaces it.
      if ('attachment' in body) patch.attachment = normalizeAttachment(body.attachment)
      await models.broadcasts.updateById(id, { $set: patch })
      const updated = await models.broadcasts.findById(id)
      return res.json({ message: 'Draft updated', data: updated, broadcast: updated })
    } catch (e: any) {
      return respondWithError(res, e, 500)
    }
  })

  // Delete a draft OR a sent broadcast (history cleanup).
  router.delete('/:id', requireAnyPermission(models, 'broadcasts.delete'), async (req, res) => {
    try {
      const id = String(req.params.id)
      const existing = await models.broadcasts.findById(id) as any
      if (!existing) return res.status(404).json({ error: 'Broadcast not found' })
      await models.broadcasts.deleteById(id)
      return res.json({ message: 'Broadcast deleted', id })
    } catch (e: any) {
      return respondWithError(res, e, 500)
    }
  })

  // Send a draft — flips status to 'sent', stamps sent_at, fans out
  // notifications. Idempotent: a second send call on an already-sent
  // broadcast returns 409 instead of double-pinging recipients.
  router.post('/:id/send', requireAnyPermission(models, 'broadcasts.send'), async (req, res) => {
    try {
      const user = req.user as any
      const id = String(req.params.id)
      const draft = await models.broadcasts.findById(id) as any
      if (!draft) return res.status(404).json({ error: 'Broadcast not found' })
      if (draft.status === 'sent') {
        return res.status(409).json({ error: 'This broadcast has already been sent' })
      }
      const targets: string[] = Array.isArray(draft.target_roles) ? draft.target_roles : []
      const wantsAll = targets.includes('all')
      const wantsClients = targets.includes('client') || targets.includes('clients') || wantsAll
      // Staff filter — exclude the synthetic 'client' role from the role-list
      // match because clients live in the clients collection, not users.
      const staffRoleTargets = targets.filter(r => r !== 'client' && r !== 'clients' && r !== 'all')

      const staffFilter: any = { is_active: 1 }
      if (!wantsAll) {
        if (staffRoleTargets.length) staffFilter.role = { $in: staffRoleTargets }
        else staffFilter.__never = true // no staff target → return zero staff
      }
      const staffUsers = staffFilter.__never
        ? [] as any[]
        : (await models.users.find(staffFilter) as any[])
      const staffIds = staffUsers.map((u) => String(u.id)).filter(Boolean)

      // Client recipients (only when the client sentinel is in targets).
      let clientIds: string[] = []
      if (wantsClients) {
        const clients = (await models.clients.find({ is_active: 1 }) as any[])
        clientIds = clients.map((c) => String(c.id)).filter(Boolean)
      }

      const now = new Date().toISOString()
      const senderName = draft.sender_name || user?.name || user?.full_name || 'Admin'

      // Fan-out: staff via user_notifications, clients via client_notifications.
      await createUserNotifications(models, staffIds, {
        type: 'broadcast',
        title: draft.title,
        body: draft.body,
        link: `broadcast:${id}`,
        actor_id: draft.sender_id || user?.sub || null,
        actor_name: senderName,
        meta: { broadcast_id: id, target_roles: targets, attachment: draft.attachment || null },
      })
      if (clientIds.length) {
        // models.notifications is the client_notifications collection. Its
        // shape differs from user_notifications (message vs body, client_id
        // instead of user_id) so we can't reuse createUserNotifications here.
        await Promise.all(clientIds.map(async (client_id) => {
          try {
            await models.notifications.insertOne({
              id: generateId('cn'),
              client_id,
              project_id: null,
              type: 'broadcast',
              title: draft.title,
              message: draft.body,
              is_read: 0,
              created_at: now,
              meta: { broadcast_id: id, attachment: draft.attachment || null },
            })
          } catch {}
        }))
      }

      const allRecipientIds = [...staffIds, ...clientIds]
      await models.broadcasts.updateById(id, {
        $set: {
          status: 'sent',
          sent_at: now,
          updated_at: now,
          recipient_count: allRecipientIds.length,
          recipient_ids: allRecipientIds,
          recipient_staff_count: staffIds.length,
          recipient_client_count: clientIds.length,
        },
      })
      const updated = await models.broadcasts.findById(id)
      return res.json({ message: 'Broadcast sent', data: updated, broadcast: updated })
    } catch (e: any) {
      return respondWithError(res, e, 500)
    }
  })

  return router
}
