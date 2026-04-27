import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, requireRole } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'

export function createSettingsRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  router.get('/', async (_req, res) => {
    try {
      const [config, holidays, techStacks] = await Promise.all([
        models.settings.findOne({}),
        models.holidays.find({}) as Promise<any[]>,
        models.techStacks.find({}) as Promise<any[]>,
      ])
      holidays.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
      techStacks.sort((a, b) => {
        const cat = String(a.category || '').localeCompare(String(b.category || ''))
        return cat !== 0 ? cat : String(a.name || '').localeCompare(String(b.name || ''))
      })
      return res.json({
        company_settings: config,
        settings: config,
        holidays,
        tech_stacks: techStacks,
        data: { config, holidays, tech_stacks: techStacks },
      })
    } catch {
      return res.json({ company_settings: null, settings: null, holidays: [], tech_stacks: [], data: { config: null, holidays: [], tech_stacks: [] } })
    }
  })

  router.get('/tech-stacks', async (_req, res) => {
    try {
      const items = await models.techStacks.find({}) as any[]
      items.sort((a, b) => {
        const cat = String(a.category || '').localeCompare(String(b.category || ''))
        return cat !== 0 ? cat : String(a.name || '').localeCompare(String(b.name || ''))
      })
      return res.json({ tech_stacks: items, data: items })
    } catch {
      return res.json({ tech_stacks: [], data: [] })
    }
  })

  router.get('/holidays', async (_req, res) => {
    try {
      const items = await models.holidays.find({}) as any[]
      items.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
      return res.json({ holidays: items, data: items })
    } catch {
      return res.json({ holidays: [], data: [] })
    }
  })

  async function upsertSettings(body: any) {
    const now = new Date().toISOString()
    const existing = await models.settings.findOne({}) as any
    const payload = {
      company_name: body.company_name || 'DevTrack Pro',
      default_daily_hours: Number(body.default_daily_hours || 8),
      default_working_days: Number(body.default_working_days || 22),
      alert_threshold_hours: Number(body.alert_threshold_hours || 0.8),
      overtime_threshold: Number(body.overtime_threshold || 10),
      inactivity_days: Number(body.inactivity_days || 3),
      updated_at: now,
    }
    if (existing) {
      await models.settings.updateById(existing.id, { $set: payload })
    } else {
      await models.settings.insertOne({ id: 'settings-1', ...payload, created_at: now })
    }
  }

  router.put('/', requireRole('admin'), async (req, res) => {
    try {
      await upsertSettings(req.body || {})
      return res.json({ message: 'Settings updated' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to update settings' })
    }
  })

  router.put('/company', requireRole('admin'), async (req, res) => {
    try {
      await upsertSettings(req.body || {})
      return res.json({ message: 'Settings updated' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to update settings' })
    }
  })

  router.post('/holidays', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
      const body = req.body || {}
      const id = generateId('hol')
      const holiday = {
        id,
        name: body.name,
        date: body.date,
        type: body.type || 'national',
        created_at: new Date().toISOString(),
      }
      await models.holidays.insertOne(holiday)
      return res.status(201).json({ message: 'Holiday added', holiday, data: { id } })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to add holiday' })
    }
  })

  router.delete('/holidays/:id', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
      await models.holidays.deleteById(String(req.params.id))
      return res.json({ message: 'Holiday deleted' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to delete holiday' })
    }
  })

  router.post('/tech-stacks', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
      const body = req.body || {}
      const id = generateId('tech')
      await models.techStacks.insertOne({
        id,
        name: body.name,
        category: body.category || 'Other',
        created_at: new Date().toISOString(),
      })
      return res.status(201).json({ message: 'Tech stack added', data: { id } })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to add tech stack' })
    }
  })

  router.delete('/tech-stacks/:id', requireRole('admin', 'pm', 'pc'), async (req, res) => {
    try {
      await models.techStacks.deleteById(String(req.params.id))
      return res.json({ message: 'Tech stack removed' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to remove tech stack' })
    }
  })

  return router
}
