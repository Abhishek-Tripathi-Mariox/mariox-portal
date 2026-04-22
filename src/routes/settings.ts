import { Hono } from 'hono'
import { authMiddleware, requireRole } from '../middleware/auth'
import { generateId } from '../utils/helpers'

type Bindings = { DB: D1Database }
type Variables = { user: any }

const settings = new Hono<{ Bindings: Bindings; Variables: Variables }>()
settings.use('*', authMiddleware)

// GET /api/settings — returns all settings, holidays, tech_stacks
settings.get('/', async (c) => {
  try {
    const [config, holidays, techStacks] = await Promise.all([
      c.env.DB.prepare('SELECT * FROM company_settings LIMIT 1').first(),
      c.env.DB.prepare('SELECT * FROM holidays ORDER BY date').all(),
      c.env.DB.prepare('SELECT * FROM tech_stacks ORDER BY category, name').all()
    ])
    // Return in multiple formats for compatibility
    return c.json({
      company_settings: config,
      settings: config,
      holidays: holidays.results,
      tech_stacks: techStacks.results,
      data: { config, holidays: holidays.results, tech_stacks: techStacks.results }
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// GET /api/settings/tech-stacks
settings.get('/tech-stacks', async (c) => {
  try {
    const result = await c.env.DB.prepare('SELECT * FROM tech_stacks ORDER BY category, name').all()
    return c.json({ tech_stacks: result.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// GET /api/settings/holidays
settings.get('/holidays', async (c) => {
  try {
    const result = await c.env.DB.prepare('SELECT * FROM holidays ORDER BY date').all()
    return c.json({ holidays: result.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// PUT /api/settings — update company settings (alias for PUT /company)
settings.put('/', requireRole('admin'), async (c) => {
  try {
    const body = await c.req.json()
    await c.env.DB.prepare(`
      UPDATE company_settings SET company_name=?, default_daily_hours=?, default_working_days=?,
      alert_threshold_hours=?, overtime_threshold=?, inactivity_days=?, updated_at=datetime('now')
      WHERE id='settings-1'
    `).bind(
      body.company_name || 'DevTrack Pro',
      body.default_daily_hours || 8,
      body.default_working_days || 22,
      body.alert_threshold_hours || 0.8,
      body.overtime_threshold || 10,
      body.inactivity_days || 3
    ).run()
    return c.json({ message: 'Settings updated' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// PUT /api/settings/company
settings.put('/company', requireRole('admin'), async (c) => {
  try {
    const body = await c.req.json()
    await c.env.DB.prepare(`
      UPDATE company_settings SET company_name=?, default_daily_hours=?, default_working_days=?,
      alert_threshold_hours=?, overtime_threshold=?, inactivity_days=?, updated_at=datetime('now')
      WHERE id='settings-1'
    `).bind(body.company_name, body.default_daily_hours, body.default_working_days, body.alert_threshold_hours, body.overtime_threshold, body.inactivity_days).run()
    return c.json({ message: 'Settings updated' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

settings.post('/holidays', requireRole('admin', 'pm'), async (c) => {
  try {
    const body = await c.req.json()
    const id = generateId('hol')
    await c.env.DB.prepare('INSERT INTO holidays (id, name, date, type) VALUES (?, ?, ?, ?)').bind(id, body.name, body.date, body.type || 'national').run()
    const holiday = await c.env.DB.prepare('SELECT * FROM holidays WHERE id=?').bind(id).first()
    return c.json({ message: 'Holiday added', holiday, data: { id } }, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

settings.delete('/holidays/:id', requireRole('admin', 'pm'), async (c) => {
  try {
    await c.env.DB.prepare('DELETE FROM holidays WHERE id=?').bind(c.req.param('id')).run()
    return c.json({ message: 'Holiday deleted' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

settings.post('/tech-stacks', requireRole('admin', 'pm'), async (c) => {
  try {
    const body = await c.req.json()
    const id = generateId('tech')
    await c.env.DB.prepare('INSERT INTO tech_stacks (id, name, category) VALUES (?, ?, ?)').bind(id, body.name, body.category || 'Other').run()
    return c.json({ message: 'Tech stack added', data: { id } }, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

settings.delete('/tech-stacks/:id', requireRole('admin', 'pm'), async (c) => {
  try {
    await c.env.DB.prepare('DELETE FROM tech_stacks WHERE id=?').bind(c.req.param('id')).run()
    return c.json({ message: 'Tech stack removed' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// POST /api/auth/change-password (proxied from settings for convenience, actual is in auth)
export default settings
