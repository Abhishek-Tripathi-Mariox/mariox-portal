// ───────────────────────────────────────────────────────────────────
// Task Custom Columns
// ───────────────────────────────────────────────────────────────────
// Admins (and anyone granted tasks.manage_columns) can extend the All
// Tasks table with up to 20 user-defined columns. Each column carries:
//   - key         (slug, generated from label, immutable once created)
//   - label       (display name shown in the table header)
//   - type        (text | textarea | checkbox | radio | date | dropdown)
//   - options[]   (only for radio + dropdown — labelled values)
//   - position    (display order, lowest first)
//
// Values per task live on the task document under custom_values: a flat
// map { column_key: value } so a column rename / type change is cheap.
import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, requireAnyPermission } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'
import { validateLength, respondWithError } from '../validators'

const MAX_COLUMNS = 20
const COLUMN_TYPES = ['text', 'textarea', 'checkbox', 'radio', 'date', 'dropdown'] as const
type ColumnType = typeof COLUMN_TYPES[number]

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

export function createTaskColumnsRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  // List — open to any authenticated user so the All Tasks renderer can
  // pull column definitions even when the caller can't manage them.
  router.get('/', async (_req, res) => {
    try {
      const rows = (await models.taskColumns.find({}) as any[])
        .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
      return res.json({ data: rows, columns: rows, total: rows.length })
    } catch (e: any) {
      return respondWithError(res, e, 500)
    }
  })

  router.post('/', requireAnyPermission(models, 'tasks.manage_columns'), async (req, res) => {
    try {
      const user = req.user as any
      const body = req.body || {}
      const label = validateLength(String(body.label || '').trim(), 1, 60, 'Label')
      const type = String(body.type || '').toLowerCase() as ColumnType
      if (!COLUMN_TYPES.includes(type)) {
        return res.status(400).json({ error: `Invalid type — must be one of: ${COLUMN_TYPES.join(', ')}` })
      }
      // Enforce the 20-column ceiling. Hard limit so the table stays usable
      // on smaller screens; admins can delete an unused column to add another.
      const existing = (await models.taskColumns.find({}) as any[])
      if (existing.length >= MAX_COLUMNS) {
        return res.status(400).json({ error: `Column limit reached (${MAX_COLUMNS}). Delete an existing column first.` })
      }
      const key = slugify(body.key || label)
      if (!key) return res.status(400).json({ error: 'Column key is empty after sanitisation' })
      if (existing.some((c) => String(c.key).toLowerCase() === key)) {
        return res.status(409).json({ error: 'A column with this key already exists' })
      }
      // Checkbox, radio, and dropdown all need ≥1 option. Checkbox + dropdown
      // are multi-select (value stored as an array of option values), radio
      // is single-select (value stored as a single string). Text/textarea/date
      // ignore options entirely.
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
        id: generateId('tcol'),
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
      await models.taskColumns.insertOne(doc)
      return res.status(201).json({ data: doc, column: doc, message: 'Column added' })
    } catch (e: any) {
      return respondWithError(res, e, 500)
    }
  })

  router.patch('/:id', requireAnyPermission(models, 'tasks.manage_columns'), async (req, res) => {
    try {
      const id = String(req.params.id)
      const existing = await models.taskColumns.findById(id) as any
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
        // Validation of "options required" is enforced against the resulting
        // type (incoming patch type beats stored type) so a single PATCH can
        // flip type + drop options or vice versa. Checkbox, radio, dropdown
        // all require options now (checkbox + dropdown are multi-select).
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
      await models.taskColumns.updateById(id, { $set: patch })
      const updated = await models.taskColumns.findById(id)
      return res.json({ data: updated, column: updated, message: 'Column updated' })
    } catch (e: any) {
      return respondWithError(res, e, 500)
    }
  })

  router.delete('/:id', requireAnyPermission(models, 'tasks.manage_columns'), async (req, res) => {
    try {
      const id = String(req.params.id)
      const existing = await models.taskColumns.findById(id) as any
      if (!existing) return res.status(404).json({ error: 'Column not found' })
      await models.taskColumns.deleteById(id)
      // Best-effort cleanup: strip the column's values from every task so the
      // database doesn't carry dead keys forever. Failures here are non-fatal.
      try {
        await models.tasks.updateMany({}, { $unset: { [`custom_values.${existing.key}`]: '' } })
      } catch { /* ignore */ }
      return res.json({ message: 'Column deleted', id })
    } catch (e: any) {
      return respondWithError(res, e, 500)
    }
  })

  return router
}
