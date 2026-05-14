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

const ASSET_TYPES = ['laptop', 'desktop', 'monitor', 'phone', 'sim', 'id_card', 'access_card', 'headset', 'keyboard', 'mouse', 'other'] as const
const ASSET_STATUSES = ['available', 'assigned', 'returned', 'retired', 'lost'] as const

export function createHrAssetsRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  router.get('/', async (req, res) => {
    try {
      const user = req.user as any
      const isManager = await userHasAnyPermission(models, user, 'hr.assets.manage')
      const filter: any = {}
      // Non-managers see only assets currently assigned to them.
      if (!isManager) filter.assigned_to = user.sub
      else if (typeof req.query.assigned_to === 'string') filter.assigned_to = req.query.assigned_to

      const [rows, users] = await Promise.all([
        models.hrAssets.find(filter) as Promise<any[]>,
        models.users.find({}) as Promise<any[]>,
      ])
      const usersById = new Map(users.map((u) => [String(u.id), u]))
      const enriched = rows.map((a) => ({
        ...a,
        assigned_to_name: a.assigned_to ? (usersById.get(String(a.assigned_to))?.full_name || null) : null,
        assigned_to_email: a.assigned_to ? (usersById.get(String(a.assigned_to))?.email || null) : null,
        assigned_to_avatar_color: a.assigned_to ? (usersById.get(String(a.assigned_to))?.avatar_color || null) : null,
      })).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      return res.json({ data: enriched, assets: enriched })
    } catch {
      return res.json({ data: [], assets: [] })
    }
  })

  router.post('/', requireAnyPermission(models, 'hr.assets.manage'), async (req, res) => {
    try {
      const body = req.body || {}
      const name = validateLength(String(body.name || '').trim(), 1, 200, 'Name')
      const assetType = validateEnum(body.asset_type, ASSET_TYPES, 'Asset type')
      const tag = validateOptional(body.tag, (v) => validateLength(String(v).trim(), 1, 100, 'Tag / serial'))
      const purchaseDate = body.purchase_date ? validateISODate(body.purchase_date, 'Purchase date') : null
      const purchaseCost = body.purchase_cost !== undefined && body.purchase_cost !== null && body.purchase_cost !== ''
        ? Number(body.purchase_cost) || 0
        : null
      const notes = validateOptional(body.notes, (v) => validateLength(String(v).trim(), 1, 2000, 'Notes'))

      const id = generateId('asset')
      const now = new Date().toISOString()
      await models.hrAssets.insertOne({
        id,
        name,
        asset_type: assetType,
        tag,
        purchase_date: purchaseDate,
        purchase_cost: purchaseCost,
        status: 'available',
        assigned_to: null,
        assigned_at: null,
        returned_at: null,
        notes,
        created_at: now,
        updated_at: now,
      })
      return res.status(201).json({ message: 'Asset added', data: { id } })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.post('/:id/assign', requireAnyPermission(models, 'hr.assets.manage'), async (req, res) => {
    try {
      const body = req.body || {}
      const targetUserId = String(body.user_id || '').trim()
      if (!targetUserId) return res.status(400).json({ error: 'Employee is required' })
      const targetUser = await models.users.findById(targetUserId) as any
      if (!targetUser) return res.status(400).json({ error: 'Employee not found' })

      const asset = await models.hrAssets.findById(String(req.params.id)) as any
      if (!asset) return res.status(404).json({ error: 'Asset not found' })
      if (asset.status === 'assigned') return res.status(400).json({ error: 'Asset is already assigned — return it first' })
      if (asset.status === 'retired' || asset.status === 'lost') {
        return res.status(400).json({ error: `Asset is ${asset.status}; cannot assign` })
      }
      const now = new Date().toISOString()
      await models.hrAssets.updateById(asset.id, {
        $set: {
          status: 'assigned',
          assigned_to: targetUserId,
          assigned_at: now,
          returned_at: null,
          updated_at: now,
        },
      })
      return res.json({ message: 'Asset assigned' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.post('/:id/return', requireAnyPermission(models, 'hr.assets.manage'), async (req, res) => {
    try {
      const body = req.body || {}
      const asset = await models.hrAssets.findById(String(req.params.id)) as any
      if (!asset) return res.status(404).json({ error: 'Asset not found' })
      if (asset.status !== 'assigned') return res.status(400).json({ error: 'Asset is not currently assigned' })
      const conditionNote = validateOptional(body.condition_note, (v) => validateLength(String(v).trim(), 1, 1000, 'Condition note'))
      const newStatus = body.retire === true || body.retire === 'true' ? 'retired' : 'available'
      const now = new Date().toISOString()
      await models.hrAssets.updateById(asset.id, {
        $set: {
          status: newStatus,
          assigned_to: null,
          returned_at: now,
          last_return_note: conditionNote,
          updated_at: now,
        },
      })
      return res.json({ message: 'Asset returned' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.patch('/:id', requireAnyPermission(models, 'hr.assets.manage'), async (req, res) => {
    try {
      const body = req.body || {}
      const asset = await models.hrAssets.findById(String(req.params.id)) as any
      if (!asset) return res.status(404).json({ error: 'Asset not found' })
      const patch: any = { updated_at: new Date().toISOString() }
      if (body.status) patch.status = validateEnum(body.status, ASSET_STATUSES, 'Status')
      if (body.name !== undefined) patch.name = validateLength(String(body.name).trim(), 1, 200, 'Name')
      if (body.tag !== undefined) {
        patch.tag = body.tag === null ? null : validateLength(String(body.tag).trim(), 1, 100, 'Tag / serial')
      }
      if (body.notes !== undefined) {
        patch.notes = body.notes === null ? null : validateLength(String(body.notes).trim(), 1, 2000, 'Notes')
      }
      await models.hrAssets.updateById(asset.id, { $set: patch })
      return res.json({ message: 'Asset updated' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.delete('/:id', requireAnyPermission(models, 'hr.assets.manage'), async (req, res) => {
    try {
      await models.hrAssets.deleteById(String(req.params.id))
      return res.json({ message: 'Asset deleted' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to delete' })
    }
  })

  return router
}
