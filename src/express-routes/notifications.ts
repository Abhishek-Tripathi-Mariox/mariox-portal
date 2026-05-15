import { Router } from 'express'
import { EventEmitter } from 'node:events'
import { jwtVerify } from 'jose'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'

// Global bus that every Express worker (single-process here) emits to when
// a new notification lands. The SSE endpoint subscribes per connected user
// and forwards matching events down the wire so the bell badge / toast
// updates with zero lag — no waiting for the 10s frontend poller.
export const notificationBus = new EventEmitter()
notificationBus.setMaxListeners(0)

export interface UserNotificationInput {
  user_id: string
  type: string                  // 'ticket_created', 'ticket_assigned', 'ticket_status', 'ticket_comment', etc.
  title: string
  body?: string
  link?: string                 // optional deep-link payload like 'ticket:<id>'
  actor_id?: string | null
  actor_name?: string | null
  meta?: Record<string, any>
}

/**
 * Insert a new notification for a single user. Safe to call without
 * awaiting from event-emitting routes — failures are logged, not thrown.
 */
export async function createUserNotification(
  models: MongoModels,
  payload: UserNotificationInput,
) {
  if (!payload.user_id) return null
  try {
    const doc = {
      id: generateId('notif'),
      user_id: String(payload.user_id),
      type: payload.type,
      title: String(payload.title || '').slice(0, 200),
      body: payload.body ? String(payload.body).slice(0, 600) : '',
      link: payload.link || null,
      actor_id: payload.actor_id || null,
      actor_name: payload.actor_name || null,
      meta: payload.meta || {},
      is_read: 0,
      created_at: new Date().toISOString(),
    }
    await models.userNotifications.insertOne(doc)
    notificationBus.emit('notification', doc)
    return doc
  } catch (e) {
    console.warn('[notifications] failed to create:', e)
    return null
  }
}

/**
 * Insert the same notification for multiple users at once.
 * Skips duplicates and an empty actor (so the actor doesn't notify themselves).
 */
export async function createUserNotifications(
  models: MongoModels,
  userIds: Array<string | null | undefined>,
  payload: Omit<UserNotificationInput, 'user_id'>,
) {
  const dedup = new Set<string>()
  for (const id of userIds) {
    if (!id) continue
    if (payload.actor_id && String(id) === String(payload.actor_id)) continue
    dedup.add(String(id))
  }
  await Promise.all(
    Array.from(dedup).map((uid) =>
      createUserNotification(models, { ...payload, user_id: uid }),
    ),
  )
}

export function createNotificationsRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  const encoder = new TextEncoder()

  // SSE stream — must be declared BEFORE the bearer-token auth middleware
  // because EventSource can't send custom headers, so we accept the token
  // as a query param instead. Keeps the stream usable from the browser.
  router.get('/stream', async (req, res) => {
    const token = String(req.query.token || '')
    if (!token) { res.status(401).end(); return }
    let payload: any
    try {
      const result = await jwtVerify(token, encoder.encode(jwtSecret))
      payload = result.payload
    } catch {
      res.status(401).end(); return
    }
    const userId = String(payload?.sub || '')
    if (!userId) { res.status(401).end(); return }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write(`: connected ${new Date().toISOString()}\n\n`)

    const onNotif = (doc: any) => {
      if (!doc || String(doc.user_id) !== userId) return
      try {
        res.write(`event: notification\ndata: ${JSON.stringify(doc)}\n\n`)
      } catch { /* writer died — cleanup handled by 'close' */ }
    }
    notificationBus.on('notification', onNotif)

    const keepalive = setInterval(() => {
      try { res.write(`: ping ${Date.now()}\n\n`) } catch { /* ignore */ }
    }, 25000)

    req.on('close', () => {
      clearInterval(keepalive)
      notificationBus.off('notification', onNotif)
    })
  })

  router.use(createAuthMiddleware(jwtSecret))

  // List my notifications (most recent first)
  router.get('/me', async (req, res) => {
    try {
      const user = req.user as any
      if (!user?.sub) return res.status(401).json({ error: 'Unauthenticated' })
      const limit = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 200)
      const items = await models.userNotifications.find(
        { user_id: user.sub },
        { sort: { created_at: -1 }, limit },
      ) as any[]
      const unread = items.filter((n) => !n.is_read).length
      return res.json({ notifications: items, data: items, unread_count: unread })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load notifications' })
    }
  })

  // Lightweight unread count (called by the frontend poller)
  router.get('/unread-count', async (req, res) => {
    try {
      const user = req.user as any
      if (!user?.sub) return res.status(401).json({ error: 'Unauthenticated' })
      const items = await models.userNotifications.find(
        { user_id: user.sub, is_read: { $ne: 1 } },
        { sort: { created_at: -1 }, limit: 100 },
      ) as any[]
      const latestId = items[0]?.id || null
      return res.json({
        unread_count: items.length,
        latest_id: latestId,
        latest_created_at: items[0]?.created_at || null,
        recent: items.slice(0, 10),
      })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed' })
    }
  })

  // Mark a single notification read
  router.post('/:id/read', async (req, res) => {
    try {
      const user = req.user as any
      const item = await models.userNotifications.findById(String(req.params.id)) as any
      if (!item) return res.status(404).json({ error: 'Not found' })
      if (item.user_id !== user.sub) return res.status(403).json({ error: 'Forbidden' })
      await models.userNotifications.updateById(item.id, {
        $set: { is_read: 1, read_at: new Date().toISOString() },
      })
      return res.json({ success: true })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed' })
    }
  })

  // Mark all of mine read
  router.post('/read-all', async (req, res) => {
    try {
      const user = req.user as any
      if (!user?.sub) return res.status(401).json({ error: 'Unauthenticated' })
      await models.userNotifications.updateMany(
        { user_id: user.sub, is_read: { $ne: 1 } },
        { $set: { is_read: 1, read_at: new Date().toISOString() } },
      )
      return res.json({ success: true })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed' })
    }
  })

  return router
}
