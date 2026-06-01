// ───────────────────────────────────────────────────────────────────
// Generic Entity Custom Columns
// ───────────────────────────────────────────────────────────────────
// Reusable version of the project-task custom-columns feature (see
// task-columns.ts) so the SAME capability can be bolted onto other record
// types — currently sales (lead) tasks and attendance. Each column carries:
//   - key       (slug from label, immutable once created)
//   - label     (header text)
//   - type      (text | textarea | checkbox | radio | date | dropdown)
//   - options[] (checkbox / radio / dropdown only)
//   - position  (display order)
// Per-record values live on the entity document under custom_values: a flat
// { column_key: value } map, exactly like project tasks.
import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, requireAnyPermission } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'
import { validateLength, respondWithError } from '../validators'

const MAX_COLUMNS = 20
const COLUMN_TYPES = ['text', 'textarea', 'checkbox', 'radio', 'date', 'dropdown'] as const
type ColumnType = typeof COLUMN_TYPES[number]

type AnyRepo = { find: Function; findById: Function; insertOne: Function; updateById: Function; deleteById: Function; updateMany: Function }

export interface EntityColumnsConfig {
  // Collection that stores the column DEFINITIONS for this entity.
  columns: AnyRepo
  // Collection that stores the entity RECORDS carrying custom_values.
  values: AnyRepo
  // Permission key that gates create/update/delete (list is open to all auth).
  managePerm: string
  // id prefix for new column docs, e.g. 'ltcol' / 'attcol'.
  idPrefix: string
}

function slugify(label: string): string {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

function normalizeOptions(input: unknown): Array<{ value: string; label: string }> {
  if (!Array.isArray(input)) return []
  const out: Array<{ value: string; label: string }> = []
  const seen = new Set<string>()
  for (const raw of input) {
    if (raw == null) continue
    let value = ''
    let label = ''
    if (typeof raw === 'string') {
      value = label = raw.trim()
    } else if (typeof raw === 'object') {
      const o = raw as Record<string, unknown>
      value = String(o.value || o.label || '').trim()
      label = String(o.label || o.value || '').trim()
    }
    if (!value || !label) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ value: value.slice(0, 80), label: label.slice(0, 120) })
    if (out.length >= 50) break
  }
  return out
}

// Merge a custom_values patch into an existing record's map (used by the host
// entity's create/update endpoints). Keys are slug-sanitised; a null value
// clears that key. Returns the merged map.
export function mergeCustomValues(existing: unknown, patch: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = (existing && typeof existing === 'object') ? { ...(existing as any) } : {}
  if (patch && typeof patch === 'object') {
    for (const [rawKey, val] of Object.entries(patch as Record<string, unknown>)) {
      const key = slugify(rawKey)
      if (!key) continue
      if (val === null || val === undefined || val === '') delete out[key]
      else out[key] = val
    }
  }
  return out
}

export function createEntityColumnsRouter(_models: MongoModels, jwtSecret: string, cfg: EntityColumnsConfig) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  router.get('/', async (_req, res) => {
    try {
      const rows = (await cfg.columns.find({}) as any[])
        .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
      return res.json({ data: rows, columns: rows, total: rows.length })
    } catch (e: any) {
      return respondWithError(res, e, 500)
    }
  })

  router.post('/', requireAnyPermission(_models, cfg.managePerm), async (req, res) => {
    try {
      const user = req.user as any
      const body = req.body || {}
      const label = validateLength(String(body.label || '').trim(), 1, 60, 'Label')
      const type = String(body.type || '').toLowerCase() as ColumnType
      if (!COLUMN_TYPES.includes(type)) {
        return res.status(400).json({ error: `Invalid type — must be one of: ${COLUMN_TYPES.join(', ')}` })
      }
      const existing = (await cfg.columns.find({}) as any[])
      if (existing.length >= MAX_COLUMNS) {
        return res.status(400).json({ error: `Column limit reached (${MAX_COLUMNS}). Delete an existing column first.` })
      }
      const key = slugify(body.key || label)
      if (!key) return res.status(400).json({ error: 'Column key is empty after sanitisation' })
      if (existing.some((c) => String(c.key).toLowerCase() === key)) {
        return res.status(409).json({ error: 'A column with this key already exists' })
      }
      const needsOptions = (type === 'checkbox' || type === 'radio' || type === 'dropdown')
      const options = needsOptions ? normalizeOptions(body.options) : []
      if (needsOptions && !options.length) {
        return res.status(400).json({ error: `${type} columns need at least one option` })
      }
      const now = new Date().toISOString()
      const position = existing.length
        ? Math.max(...existing.map((c) => Number(c.position || 0))) + 1
        : 0
      const doc = {
        id: generateId(cfg.idPrefix),
        key,
        label,
        type,
        options,
        position,
        created_at: now,
        created_by: user?.sub || null,
        created_by_name: user?.name || user?.full_name || null,
        updated_at: now,
      }
      await cfg.columns.insertOne(doc)
      return res.status(201).json({ data: doc, column: doc, message: 'Column added' })
    } catch (e: any) {
      return respondWithError(res, e, 500)
    }
  })

  router.patch('/:id', requireAnyPermission(_models, cfg.managePerm), async (req, res) => {
    try {
      const id = String(req.params.id)
      const existing = await cfg.columns.findById(id) as any
      if (!existing) return res.status(404).json({ error: 'Column not found' })
      const body = req.body || {}
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if ('label' in body) patch.label = validateLength(String(body.label || '').trim(), 1, 60, 'Label')
      if ('type' in body) {
        const type = String(body.type || '').toLowerCase()
        if (!COLUMN_TYPES.includes(type as ColumnType)) {
          return res.status(400).json({ error: `Invalid type — must be one of: ${COLUMN_TYPES.join(', ')}` })
        }
        patch.type = type
      }
      if ('options' in body) {
        const effectiveType = (patch.type as string) || existing.type
        const opts = normalizeOptions(body.options)
        const needsOpts = (effectiveType === 'checkbox' || effectiveType === 'radio' || effectiveType === 'dropdown')
        if (needsOpts && !opts.length) {
          return res.status(400).json({ error: `${effectiveType} columns need at least one option` })
        }
        patch.options = opts
      }
      if ('position' in body) {
        const p = Number(body.position)
        if (Number.isFinite(p)) patch.position = Math.max(0, Math.round(p))
      }
      await cfg.columns.updateById(id, { $set: patch })
      const updated = await cfg.columns.findById(id)
      return res.json({ data: updated, column: updated, message: 'Column updated' })
    } catch (e: any) {
      return respondWithError(res, e, 500)
    }
  })

  router.delete('/:id', requireAnyPermission(_models, cfg.managePerm), async (req, res) => {
    try {
      const id = String(req.params.id)
      const existing = await cfg.columns.findById(id) as any
      if (!existing) return res.status(404).json({ error: 'Column not found' })
      await cfg.columns.deleteById(id)
      // Best-effort: strip the column's values off every host record.
      try {
        await cfg.values.updateMany({}, { $unset: { [`custom_values.${existing.key}`]: '' } })
      } catch { /* ignore */ }
      return res.json({ message: 'Column deleted', id })
    } catch (e: any) {
      return respondWithError(res, e, 500)
    }
  })

  return router
}
