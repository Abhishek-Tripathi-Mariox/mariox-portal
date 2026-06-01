// ───────────────────────────────────────────────────────────────────
// Trash — centralized recycle bin for deleted records
// ───────────────────────────────────────────────────────────────────
// Instead of hard-deleting, delete handlers call moveToTrash(), which stores a
// snapshot of the record (plus an optional bundle of its cascade children) in
// the `trash` collection and removes it from its own collection. The Trash
// module lists every trashed item across modules and can restore it (re-insert
// snapshot + children) or purge it permanently.
import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, requireAnyPermission } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'
import { isElasticEnabled, bulkIndex as esBulkIndex } from '../utils/elastic'

export interface TrashInput {
  entityType: string                       // the record's own collection name (e.g. 'projects')
  id: string                               // the record's id
  title: string                            // human label for the trash list
  snapshot: any                            // the full document
  related?: Record<string, any[]>          // { collectionName: [docs] } cascade bundle
  user: any                                // actor
  reason?: string
}

// Snapshot a record (and its cascade children) into the trash collection.
// The caller is responsible for removing the originals from their collections.
export async function moveToTrash(models: MongoModels, input: TrashInput) {
  const now = new Date().toISOString()
  const record = {
    id: generateId('trash'),
    entity_type: String(input.entityType),
    entity_id: String(input.id),
    title: String(input.title || input.id),
    snapshot: input.snapshot,
    related: input.related || {},
    reason: input.reason ? String(input.reason).slice(0, 500) : null,
    deleted_by: input.user?.sub || null,
    deleted_by_name: input.user?.name || input.user?.full_name || null,
    deleted_at: now,
    created_at: now,
  }
  await models.trash.insertOne(record)
  return record
}

// Strip Mongo's _id so a re-insert doesn't collide on a stale ObjectId; the
// record's own string `id` is what everything keys on.
function withoutMongoId(doc: any) {
  if (!doc || typeof doc !== 'object') return doc
  const { _id, ...rest } = doc
  return rest
}

export function createTrashRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  // List trashed items (newest first), optionally filtered by ?type=projects.
  router.get('/', requireAnyPermission(models, 'trash.view'), async (req, res) => {
    try {
      const type = typeof req.query.type === 'string' ? req.query.type : undefined
      const filter: any = {}
      if (type) filter.entity_type = type
      const rows = (await models.trash.find(filter) as any[])
        .sort((a, b) => String(b.deleted_at || '').localeCompare(String(a.deleted_at || '')))
        .map((t) => ({
          id: t.id,
          entity_type: t.entity_type,
          entity_id: t.entity_id,
          title: t.title,
          reason: t.reason || null,
          deleted_by: t.deleted_by || null,
          deleted_by_name: t.deleted_by_name || null,
          deleted_at: t.deleted_at,
          // counts of cascade children, for display — not the full payload
          related_counts: Object.fromEntries(Object.entries(t.related || {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])),
        }))
      return res.json({ data: rows, trash: rows, total: rows.length })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load trash' })
    }
  })

  // Restore: re-insert the snapshot + its cascade children, re-index to ES,
  // then remove the trash record.
  router.post('/:id/restore', requireAnyPermission(models, 'trash.restore'), async (req, res) => {
    try {
      const t = await models.trash.findById(String(req.params.id)) as any
      if (!t) return res.status(404).json({ error: 'Trash item not found' })
      const db = models.rawDb

      // Main document.
      const snap = withoutMongoId(t.snapshot)
      if (snap?.id) {
        await db.collection(t.entity_type).deleteOne({ id: snap.id } as any) // avoid dup if a record was re-created
        await db.collection(t.entity_type).insertOne(snap as any)
        if (isElasticEnabled()) { try { await esBulkIndex(t.entity_type, [snap]) } catch { /* non-fatal */ } }
      }
      // Cascade children.
      for (const [coll, docs] of Object.entries(t.related || {})) {
        const list = (Array.isArray(docs) ? docs : []).map(withoutMongoId).filter((d: any) => d && d.id)
        if (!list.length) continue
        const ids = list.map((d: any) => d.id)
        await db.collection(coll).deleteMany({ id: { $in: ids } } as any)
        await db.collection(coll).insertMany(list as any[])
        if (isElasticEnabled()) { try { await esBulkIndex(coll, list) } catch { /* non-fatal */ } }
      }

      await models.trash.deleteById(t.id)
      return res.json({ message: 'Restored', id: t.id, entity_type: t.entity_type, entity_id: t.entity_id })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to restore' })
    }
  })

  // Purge: permanently drop the trash record (the original is already gone).
  router.delete('/:id', requireAnyPermission(models, 'trash.purge'), async (req, res) => {
    try {
      const t = await models.trash.findById(String(req.params.id)) as any
      if (!t) return res.status(404).json({ error: 'Trash item not found' })
      await models.trash.deleteById(t.id)
      return res.json({ message: 'Permanently deleted', id: t.id })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to purge' })
    }
  })

  return router
}
