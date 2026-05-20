import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, userHasAnyPermission } from '../express-middleware/auth'
import { DOC_CATEGORIES } from '../constants'
import { generateId } from '../utils/helpers'
import { extractS3Key, getS3Object, type S3Env } from '../utils/s3-upload'
import {
  validateRequired,
  validateLength,
  validateEnum,
  validateOptional,
  validateUrl,
  validatePositiveNumber,
  respondWithError,
} from '../validators'

const DOC_VISIBILITIES = ['internal', 'client', 'all'] as const

export function createDocumentsRouter(models: MongoModels, jwtSecret: string, runtimeEnv: S3Env = {}) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  router.get('/', async (req, res) => {
    try {
      const user = req.user as any
      const { project_id, category, visibility } = req.query as Record<string, string | undefined>
      const filter: any = {}
      if (project_id) filter.project_id = project_id
      if (category) filter.category = category
      if (visibility) filter.visibility = visibility
      const role = String(user?.role || '').toLowerCase()
      if (role === 'developer' || role === 'team') filter.visibility = { $ne: 'internal' }
      if (role === 'client') {
        const myProjects = await models.projects.find({ client_id: user.sub }) as any[]
        const projectIds = myProjects.map((p) => String(p.id))
        filter.visibility = { $in: ['client', 'all'] }
        // Client sees: their own uploads + docs on their projects
        filter.$or = [
          { client_id: user.sub },
          { uploaded_by: user.sub },
          ...(projectIds.length ? [{ project_id: { $in: projectIds } }] : []),
        ]
      }

      const [docs, users, projects, clients, auctions] = await Promise.all([
        models.documents.find(filter) as Promise<any[]>,
        models.users.find({}) as Promise<any[]>,
        models.projects.find({}) as Promise<any[]>,
        models.clients.find({}) as Promise<any[]>,
        models.bidAuctions.find({}) as Promise<any[]>,
      ])
      const usersById = new Map(users.map((u) => [String(u.id), u]))
      const clientsById = new Map(clients.map((c) => [String(c.id), c]))
      const projectsById = new Map(projects.map((p) => [String(p.id), p]))
      const enriched = docs
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .map((d) => {
          const uploaderRole = d.uploaded_by_role || 'staff'
          const uploaderName = uploaderRole === 'client'
            ? clientsById.get(String(d.uploaded_by))?.contact_name
              || clientsById.get(String(d.uploaded_by))?.company_name
              || null
            : usersById.get(String(d.uploaded_by))?.full_name || null
          const uploaderColor = uploaderRole === 'client'
            ? clientsById.get(String(d.uploaded_by))?.avatar_color
            : usersById.get(String(d.uploaded_by))?.avatar_color
          return {
            ...d,
            uploaded_by_name: uploaderName,
            uploaded_by_role: uploaderRole,
            uploader_color: uploaderColor || null,
            project_name: projectsById.get(String(d.project_id))?.name || null,
          }
        })

      // Surface bid auction attachments alongside regular documents so they
      // appear in the Documents center even before the auction is awarded.
      // Clients can't see other tenants' bids, so we omit this for the
      // client role entirely.
      if (role !== 'client') {
        for (const a of auctions || []) {
          const atts = Array.isArray(a.attachments) ? a.attachments : []
          if (!atts.length) continue
          if (project_id && String(a.resulting_project_id || '') !== String(project_id)) continue
          if (category && category !== 'bid') continue
          const creator = usersById.get(String(a.created_by))
          for (const f of atts) {
            enriched.push({
              id: `bid-att:${a.id}:${f.file_url}`,
              project_id: a.resulting_project_id || null,
              project_name: projectsById.get(String(a.resulting_project_id))?.name || null,
              client_id: a.client_id || null,
              title: `${a.name} — ${f.file_name || 'attachment'}`,
              description: `Auction ${a.code}`,
              category: 'bid',
              file_name: f.file_name || 'file',
              file_url: f.file_url,
              file_size: Number(f.file_size) || 0,
              file_type: f.file_type || null,
              version: '1.0',
              uploaded_by: a.created_by || null,
              uploaded_by_name: creator?.full_name || null,
              uploaded_by_role: 'staff',
              uploader_color: creator?.avatar_color || null,
              visibility: 'internal',
              is_client_visible: 0,
              tags: null,
              download_count: 0,
              created_at: a.created_at || null,
              updated_at: a.updated_at || null,
              source: 'bid',
              bid_id: a.id,
              read_only: true,
            })
          }
        }
        enriched.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      }

      // Surface built-in + admin-defined categories so the modal can offer
      // them in the dropdown. Custom categories are stored in their own
      // collection (`doc_categories`) — slug + label.
      const customCats = await models.docCategories.find({}) as any[]
      const customValues = customCats.map((c) => String(c.value || '').toLowerCase()).filter(Boolean)
      const allCategories = Array.from(new Set([...DOC_CATEGORIES, ...customValues]))

      return res.json({
        documents: enriched,
        categories: allCategories,
        builtin_categories: DOC_CATEGORIES,
        custom_categories: customCats,
        data: enriched,
      })
    } catch {
      return res.json({ documents: [], categories: DOC_CATEGORIES, builtin_categories: DOC_CATEGORIES, custom_categories: [], data: [] })
    }
  })

  // List custom doc categories (built-in ones are static and exposed via
  // the constants module; the front-end merges both lists).
  router.get('/categories', async (_req, res) => {
    try {
      const customCats = await models.docCategories.find({}) as any[]
      customCats.sort((a, b) => String(a.label || a.value || '').localeCompare(String(b.label || b.value || '')))
      const customValues = customCats.map((c) => String(c.value || '').toLowerCase()).filter(Boolean)
      const allCategories = Array.from(new Set([...DOC_CATEGORIES, ...customValues]))
      return res.json({
        categories: allCategories,
        builtin_categories: DOC_CATEGORIES,
        custom_categories: customCats,
      })
    } catch {
      return res.json({ categories: DOC_CATEGORIES, builtin_categories: DOC_CATEGORIES, custom_categories: [] })
    }
  })

  router.post('/categories', async (req, res) => {
    try {
      const user = req.user as any
      const role = String(user?.role || '').toLowerCase()
      const allowed = ['admin', 'pm', 'pc'].includes(role)
        || await userHasAnyPermission(models, user, 'documents.upload')
      if (!allowed) return res.status(403).json({ error: 'Forbidden' })

      const body = req.body || {}
      const label = validateLength(String(body.label || body.name || '').trim(), 2, 60, 'Category name')
      // slug: lowercase, alphanumerics + underscores, derived from label unless
      // the caller passes an explicit value.
      const explicitValue = String(body.value || '').trim().toLowerCase()
      const slug = (explicitValue || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
        .slice(0, 40)
      if (!slug) return res.status(400).json({ error: 'Category name must contain letters or numbers' })
      // Reject duplicates against built-in + existing custom categories.
      if ((DOC_CATEGORIES as readonly string[]).includes(slug)) {
        return res.status(409).json({ error: 'A built-in category with this name already exists' })
      }
      const existing = await models.docCategories.findOne({ value: slug })
      if (existing) return res.status(409).json({ error: 'This category already exists' })

      const id = generateId('doccat')
      const now = new Date().toISOString()
      const record = {
        id,
        value: slug,
        label,
        created_by: user?.sub || null,
        created_by_name: user?.name || user?.full_name || null,
        created_at: now,
      }
      await models.docCategories.insertOne(record)
      return res.status(201).json({ category: record, message: 'Category added' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.delete('/categories/:id', async (req, res) => {
    try {
      const user = req.user as any
      const role = String(user?.role || '').toLowerCase()
      const allowed = ['admin', 'pm', 'pc'].includes(role)
        || await userHasAnyPermission(models, user, 'documents.upload')
      if (!allowed) return res.status(403).json({ error: 'Forbidden' })
      const cat = await models.docCategories.findById(String(req.params.id)) as any
      if (!cat) return res.status(404).json({ error: 'Category not found' })
      await models.docCategories.deleteById(cat.id)
      return res.json({ message: 'Category removed' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.post('/', async (req, res) => {
    try {
      const user = req.user as any
      const role = String(user?.role || '').toLowerCase()
      const isClient = role === 'client'
      // Built-in roles + anyone admin has granted documents.upload to.
      const allowed = ['admin', 'pm', 'pc', 'client'].includes(role)
        || await userHasAnyPermission(models, user, 'documents.upload')
      if (!allowed) {
        return res.status(403).json({ error: 'Forbidden' })
      }
      const body = req.body || {}
      const title = validateLength(String(body.title || '').trim(), 2, 200, 'Title')
      const file_name = validateLength(String(body.file_name || '').trim(), 1, 255, 'File name')
      const file_url = validateUrl(body.file_url, 'File URL')

      // Accept built-in categories OR any admin-defined custom category.
      const rawCategory = String(body.category || 'other').trim().toLowerCase()
      let category: string
      if ((DOC_CATEGORIES as readonly string[]).includes(rawCategory)) {
        category = rawCategory
      } else {
        const customCat = await models.docCategories.findOne({ value: rawCategory })
        if (!customCat) {
          return res.status(400).json({ error: `Unknown category "${rawCategory}"` })
        }
        category = rawCategory
      }
      const fileSize = body.file_size !== undefined
        ? validatePositiveNumber(body.file_size, 'File size')
        : 0
      const description = validateOptional(body.description, (v) => validateLength(String(v), 0, 2000, 'Description'))

      let project_id: string | null
      let visibility: string
      let clientId: string | null = null

      if (isClient) {
        // Client uploads: project_id is optional; if provided, must belong to them.
        project_id = body.project_id ? String(body.project_id) : null
        if (project_id) {
          const project = await models.projects.findById(project_id) as any
          if (!project || String(project.client_id) !== String(user.sub)) {
            return res.status(403).json({ error: 'Project not accessible' })
          }
        }
        clientId = user.sub
        visibility = 'all' // client uploads are visible to client + staff by default
      } else {
        project_id = validateRequired(body.project_id, 'project_id')
        visibility = validateEnum(body.visibility || 'all', DOC_VISIBILITIES, 'Visibility')
        if (body.client_id) clientId = String(body.client_id)
      }

      const id = generateId('doc')
      const now = new Date().toISOString()
      const doc = {
        id,
        project_id,
        client_id: clientId,
        title,
        description,
        category,
        file_name,
        file_url,
        file_size: fileSize,
        file_type: body.file_type || null,
        version: body.version || '1.0',
        uploaded_by: user?.sub || null,
        uploaded_by_role: isClient ? 'client' : 'staff',
        visibility,
        is_client_visible: Number(body.is_client_visible ?? 1),
        tags: body.tags ? JSON.stringify(body.tags) : null,
        download_count: 0,
        created_at: now,
        updated_at: now,
      }
      await models.documents.insertOne(doc)
      return res.status(201).json({ document: doc, data: doc })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.put('/:id', async (req, res) => {
    try {
      const user = req.user as any
      const role = String(user?.role || '').toLowerCase()
      const id = String(req.params.id)
      const doc = await models.documents.findById(id) as any
      if (!doc) return res.status(404).json({ error: 'Document not found' })
      const isStaff = ['admin', 'pm', 'pc'].includes(role)
      const isOwner = role === 'client' && String(doc.uploaded_by) === String(user.sub)
      if (!isStaff && !isOwner) return res.status(403).json({ error: 'Forbidden' })

      const body = req.body || {}
      const patch: any = { updated_at: new Date().toISOString() }
      const editableFields = isStaff
        ? ['title', 'description', 'category', 'version', 'visibility', 'is_client_visible', 'tags']
        : ['title', 'description', 'category', 'version', 'tags']
      for (const k of editableFields) {
        if (k in body) patch[k] = k === 'tags' && Array.isArray(body[k]) ? JSON.stringify(body[k]) : body[k]
      }
      await models.documents.updateById(id, { $set: patch })
      const updated = await models.documents.findById(id)
      return res.json({ document: updated })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to update document' })
    }
  })

  router.delete('/:id', async (req, res) => {
    try {
      const user = req.user as any
      const role = String(user?.role || '').toLowerCase()
      const id = String(req.params.id)
      const doc = await models.documents.findById(id) as any
      if (!doc) return res.status(404).json({ error: 'Document not found' })
      const isStaff = ['admin', 'pm', 'pc'].includes(role)
      const isOwner = role === 'client' && String(doc.uploaded_by) === String(user.sub)
      if (!isStaff && !isOwner) return res.status(403).json({ error: 'Forbidden' })
      await models.documents.deleteById(id)
      return res.json({ success: true })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to delete document' })
    }
  })

  router.patch('/:id/download', async (req, res) => {
    try {
      const id = String(req.params.id)
      const doc = await models.documents.findById(id) as any
      if (!doc) return res.status(404).json({ error: 'Not found' })
      await models.documents.updateById(id, { $inc: { download_count: 1 } })
      return res.json({ file_url: doc.file_url, file_name: doc.file_name })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to record download' })
    }
  })

  // Inline preview proxy: streams the S3 object back with
  // `Content-Disposition: inline` regardless of how the object was uploaded.
  // The frontend fetches this with the Bearer token then wraps the response
  // body in a Blob URL so the iframe/img/video element can render it without
  // the browser ever seeing an "attachment" disposition.
  router.get('/:id/preview', async (req, res) => {
    try {
      const id = String(req.params.id)
      const doc = await models.documents.findById(id) as any
      if (!doc) return res.status(404).json({ error: 'Document not found' })

      const key = extractS3Key(runtimeEnv, String(doc.file_url || ''))
      if (!key) return res.status(400).json({ error: 'File location not available' })

      const obj = await getS3Object(runtimeEnv, key)
      const fileName = String(doc.file_name || 'file')
      res.setHeader('Content-Type', obj.contentType || doc.file_type || 'application/octet-stream')
      res.setHeader('Content-Disposition', `inline; filename="${fileName.replace(/"/g, '')}"`)
      if (obj.contentLength) res.setHeader('Content-Length', String(obj.contentLength))
      res.setHeader('Cache-Control', 'private, max-age=300')

      if (obj.body && typeof obj.body.pipe === 'function') {
        obj.body.pipe(res)
      } else if (obj.body && typeof obj.body.transformToByteArray === 'function') {
        const bytes = await obj.body.transformToByteArray()
        res.end(Buffer.from(bytes))
      } else {
        return res.status(500).json({ error: 'Unable to stream file' })
      }
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load preview' })
    }
  })

  return router
}
