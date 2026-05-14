import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, requireAnyPermission, userHasAnyPermission } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'
import {
  validateEnum,
  validateISODate,
  validateLength,
  validateOptional,
  respondWithError,
} from '../validators'

// HR letter generator. The route just stores the *parameters* used to
// generate the letter (employee, type, dates, amounts, signatory) — the
// rendered text lives in the frontend template so admin can tweak wording
// without a backend deploy.
const DOC_TYPES = ['offer_letter', 'experience_certificate', 'salary_certificate', 'appointment_letter', 'relieving_letter'] as const

export function createHrDocumentsRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  router.get('/', async (req, res) => {
    try {
      const user = req.user as any
      const isManager = await userHasAnyPermission(models, user, 'hr.documents.manage')
      const filter: any = {}
      // Non-managers only see their own docs (e.g. an employee viewing their
      // own offer letter / experience cert).
      if (!isManager) filter.user_id = user.sub
      else if (typeof req.query.user_id === 'string') filter.user_id = req.query.user_id

      const [rows, users] = await Promise.all([
        models.hrDocuments.find(filter) as Promise<any[]>,
        models.users.find({}) as Promise<any[]>,
      ])
      const usersById = new Map(users.map((u) => [String(u.id), u]))
      const enriched = rows.map((d) => ({
        ...d,
        full_name: usersById.get(String(d.user_id))?.full_name || null,
        email: usersById.get(String(d.user_id))?.email || null,
        designation: usersById.get(String(d.user_id))?.designation || null,
        avatar_color: usersById.get(String(d.user_id))?.avatar_color || null,
        generated_by_name: d.generated_by ? (usersById.get(String(d.generated_by))?.full_name || null) : null,
      })).sort((a, b) => String(b.issued_date || '').localeCompare(String(a.issued_date || '')))
      return res.json({ data: enriched, documents: enriched })
    } catch {
      return res.json({ data: [], documents: [] })
    }
  })

  router.post('/', requireAnyPermission(models, 'hr.documents.manage'), async (req, res) => {
    try {
      const user = req.user as any
      const body = req.body || {}
      const targetUserId = String(body.user_id || '').trim()
      if (!targetUserId) return res.status(400).json({ error: 'Employee is required' })
      const targetUser = await models.users.findById(targetUserId) as any
      if (!targetUser) return res.status(400).json({ error: 'Employee not found' })

      const docType = validateEnum(body.document_type, DOC_TYPES, 'Document type')
      const issuedDate = validateISODate(body.issued_date, 'Issued date')
      const signedBy = validateOptional(body.signed_by, (v) => validateLength(String(v).trim(), 1, 200, 'Signed by'))
      const signedTitle = validateOptional(body.signed_title, (v) => validateLength(String(v).trim(), 1, 200, 'Signed title'))
      const notes = validateOptional(body.notes, (v) => validateLength(String(v).trim(), 1, 2000, 'Notes'))

      // Free-form payload for fields specific to a doc type (CTC, joining
      // date, last working day, etc.). Caller picks the keys — frontend
      // renders the template, backend just stores. Cap size so an attacker
      // can't dump a megabyte of JSON per document.
      const rawPayload = body.payload ?? {}
      if (typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
        return res.status(400).json({ error: 'payload must be an object' })
      }
      const payloadStr = JSON.stringify(rawPayload)
      if (payloadStr.length > 20000) {
        return res.status(400).json({ error: 'payload too large (max 20kB)' })
      }

      const id = generateId('doc')
      const now = new Date().toISOString()
      await models.hrDocuments.insertOne({
        id,
        user_id: targetUserId,
        document_type: docType,
        issued_date: issuedDate,
        signed_by: signedBy,
        signed_title: signedTitle,
        payload: rawPayload,
        notes,
        generated_by: user?.sub || null,
        created_at: now,
        updated_at: now,
      })
      return res.status(201).json({ message: 'Document generated', data: { id } })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.delete('/:id', requireAnyPermission(models, 'hr.documents.manage'), async (req, res) => {
    try {
      await models.hrDocuments.deleteById(String(req.params.id))
      return res.json({ message: 'Document deleted' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to delete' })
    }
  })

  return router
}
