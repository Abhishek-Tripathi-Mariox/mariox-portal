// ═══════════════════════════════════════════════════════════════
// Portfolios — a catalog of company portfolios that sales users
// can send to leads. Admin owns the catalog by default and can
// grant "add" permission to other users. Every send is logged in
// portfolio_sends and emitted to the lead's activity timeline
// (kind='portfolio_sent') so it surfaces on the lead detail page.
// ═══════════════════════════════════════════════════════════════
import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, requireRole } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'
import { validateLength, respondWithError } from '../validators'
import { sendSmtpEmail, type SmtpAttachment, type SmtpEnv } from '../utils/smtp'

const MAX_PORTFOLIO_ATTACHMENT_BYTES = 10 * 1024 * 1024 // 10 MB

function lower(value: any): string {
  return String(value || '').toLowerCase().trim()
}

// Permission source: Settings → Roles & Permissions. Granular keys are
// `portfolios.create | edit | delete`. Legacy `portfolios.manage` is still
// honored as a superset for older role docs. Admin always passes. Legacy
// per-user grants in portfolioPermissions also still pass for backward
// compat with old installs.
async function getPortfolioPerms(models: MongoModels, user: any): Promise<{
  canCreate: boolean; canEdit: boolean; canDelete: boolean;
}> {
  const role = lower(user?.role)
  if (role === 'admin') {
    return { canCreate: true, canEdit: true, canDelete: true }
  }
  let perms: string[] = []
  if (role) {
    const roleDoc = (await models.roles.findOne({ key: role })) as any
    perms = Array.isArray(roleDoc?.permissions) ? roleDoc.permissions : []
  }
  const userId = String(user?.sub || user?.id || '')
  const legacyGrant = userId
    ? !!(await models.portfolioPermissions.findOne({ user_id: userId }))
    : false
  const hasManage = perms.includes('portfolios.manage') || legacyGrant
  return {
    canCreate: hasManage || perms.includes('portfolios.create'),
    canEdit:   hasManage || perms.includes('portfolios.edit'),
    canDelete: hasManage || perms.includes('portfolios.delete'),
  }
}

export function createPortfoliosRouter(
  models: MongoModels,
  jwtSecret: string,
  runtimeEnv: SmtpEnv = {},
) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  // ── LIST ─────────────────────────────────────────────────
  router.get('/', async (req, res) => {
    try {
      const portfolios = (await models.portfolios.find({})) as any[]
      portfolios.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))

      // Enrich with creator name + send count + last_sent_at.
      const creatorIds = [...new Set(portfolios.map((p) => String(p.created_by || '')).filter(Boolean))]
      const creators = creatorIds.length
        ? ((await models.users.find({ id: { $in: creatorIds } })) as any[])
        : []
      const creatorsById = new Map(creators.map((u) => [String(u.id), u]))

      const allSends = (await models.portfolioSends.find({})) as any[]
      const sendCounts = new Map<string, number>()
      const lastSent = new Map<string, string>()
      for (const s of allSends) {
        const pid = String(s.portfolio_id || '')
        sendCounts.set(pid, (sendCounts.get(pid) || 0) + 1)
        const prev = lastSent.get(pid)
        if (!prev || String(s.sent_at || '').localeCompare(prev) > 0) {
          lastSent.set(pid, String(s.sent_at || ''))
        }
      }

      const enriched = portfolios.map((p) => ({
        ...p,
        created_by_name: creatorsById.get(String(p.created_by))?.full_name || null,
        send_count: sendCounts.get(String(p.id)) || 0,
        last_sent_at: lastSent.get(String(p.id)) || null,
      }))

      const user = req.user as any
      const perms = await getPortfolioPerms(models, user)
      const canManage = perms.canCreate || perms.canEdit || perms.canDelete

      return res.json({ data: enriched, portfolios: enriched, can_manage: canManage })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── CREATE ───────────────────────────────────────────────
  router.post('/', async (req, res) => {
    try {
      const user = req.user as any
      const perms = await getPortfolioPerms(models, user)
      if (!perms.canCreate) {
        return res.status(403).json({ error: 'Not allowed to add portfolios' })
      }
      const body = req.body || {}
      const title = validateLength(String(body.title || '').trim(), 2, 200, 'Title')
      const description = String(body.description || '').trim().slice(0, 2000)
      const file = body.file && typeof body.file === 'object'
        ? {
            url: String(body.file.url || ''),
            name: String(body.file.name || body.file.original_name || 'portfolio'),
            mime: String(body.file.mime || body.file.mime_type || ''),
            size: Number(body.file.size || 0),
          }
        : null
      if (!file || !file.url) {
        return res.status(400).json({ error: 'A file is required' })
      }

      const now = new Date().toISOString()
      const id = generateId('pf')
      await models.portfolios.insertOne({
        id,
        title,
        description,
        file,
        created_by: user?.sub || null,
        created_at: now,
        updated_at: now,
      })
      return res.status(201).json({ data: { id }, message: 'Portfolio added' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── UPDATE ───────────────────────────────────────────────
  router.put('/:id', async (req, res) => {
    try {
      const user = req.user as any
      const id = String(req.params.id)
      const existing = (await models.portfolios.findOne({ id })) as any
      if (!existing) return res.status(404).json({ error: 'Portfolio not found' })

      const isAdmin = lower(user?.role) === 'admin'
      const isOwner = String(existing.created_by || '') === String(user?.sub || '')
      const perms = await getPortfolioPerms(models, user)
      if (!isAdmin && !isOwner && !perms.canEdit) {
        return res.status(403).json({ error: 'Not allowed to edit this portfolio' })
      }

      const body = req.body || {}
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if ('title' in body) patch.title = validateLength(String(body.title || '').trim(), 2, 200, 'Title')
      if ('description' in body) patch.description = String(body.description || '').trim().slice(0, 2000)
      if ('file' in body && body.file && typeof body.file === 'object') {
        patch.file = {
          url: String(body.file.url || ''),
          name: String(body.file.name || body.file.original_name || 'portfolio'),
          mime: String(body.file.mime || body.file.mime_type || ''),
          size: Number(body.file.size || 0),
        }
      }
      await models.portfolios.updateOne({ id }, { $set: patch })
      return res.json({ message: 'Portfolio updated' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── DELETE ───────────────────────────────────────────────
  router.delete('/:id', async (req, res) => {
    try {
      const user = req.user as any
      const id = String(req.params.id)
      const existing = (await models.portfolios.findOne({ id })) as any
      if (!existing) return res.status(404).json({ error: 'Portfolio not found' })

      const isAdmin = lower(user?.role) === 'admin'
      const isOwner = String(existing.created_by || '') === String(user?.sub || '')
      const perms = await getPortfolioPerms(models, user)
      if (!isAdmin && !isOwner && !perms.canDelete) {
        return res.status(403).json({ error: 'Not allowed to delete this portfolio' })
      }
      await models.portfolios.deleteOne({ id })
      // Preserve sends history — keeps the lead timeline coherent even after
      // the portfolio record itself goes away.
      return res.json({ message: 'Portfolio deleted' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── HISTORY ──────────────────────────────────────────────
  router.get('/:id/history', async (req, res) => {
    try {
      const id = String(req.params.id)
      const sends = (await models.portfolioSends.find({ portfolio_id: id })) as any[]
      sends.sort((a, b) => String(b.sent_at || '').localeCompare(String(a.sent_at || '')))

      // Enrich each send with lead name + sender name (best-effort).
      const leadIds = [...new Set(sends.map((s) => String(s.lead_id || '')).filter(Boolean))]
      const senderIds = [...new Set(sends.map((s) => String(s.sent_by || '')).filter(Boolean))]
      const [leads, senders] = await Promise.all([
        leadIds.length ? (models.leads.find({ id: { $in: leadIds } }) as Promise<any[]>) : Promise.resolve([] as any[]),
        senderIds.length ? (models.users.find({ id: { $in: senderIds } }) as Promise<any[]>) : Promise.resolve([] as any[]),
      ])
      const leadsById = new Map(leads.map((l) => [String(l.id), l]))
      const sendersById = new Map(senders.map((u) => [String(u.id), u]))

      const enriched = sends.map((s) => ({
        ...s,
        lead_name: leadsById.get(String(s.lead_id))?.name || null,
        lead_email: leadsById.get(String(s.lead_id))?.email || null,
        sent_by_name: sendersById.get(String(s.sent_by))?.full_name || null,
      }))
      return res.json({ data: enriched, sends: enriched })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── SEND TO LEAD ─────────────────────────────────────────
  // Emails the portfolio file to a lead's email (or override), logs the
  // send, and stamps the lead's activity timeline so it shows up on the
  // lead detail page without any extra wiring.
  router.post('/:id/send/:leadId', async (req, res) => {
    try {
      const user = req.user as any
      const portfolioId = String(req.params.id)
      const leadId = String(req.params.leadId)
      const portfolio = (await models.portfolios.findOne({ id: portfolioId })) as any
      if (!portfolio) return res.status(404).json({ error: 'Portfolio not found' })
      const lead = (await models.leads.findOne({ id: leadId })) as any
      if (!lead) return res.status(404).json({ error: 'Lead not found' })

      const body = req.body || {}
      const subject = validateLength(
        String(body.subject || `Mariox Software — ${portfolio.title}`).trim(),
        1, 300, 'Subject',
      )
      const messageText = String(body.text || body.body || '').trim() ||
        `Hi ${lead.name},\n\nThanks for your time. As discussed, please find our portfolio "${portfolio.title}" attached for your reference.\n\nRegards,\n${user?.full_name || user?.name || 'Mariox Team'}`
      const to = String(body.to || lead.email || '').trim()
      if (!to) return res.status(400).json({ error: 'Recipient email is required' })
      const cc = Array.isArray(body.cc) ? body.cc.filter(Boolean) : []

      // Fetch the file bytes from the stored URL and attach them.
      const attachments: SmtpAttachment[] = []
      if (portfolio.file?.url) {
        try {
          const fileRes = await fetch(portfolio.file.url)
          if (!fileRes.ok) throw new Error(`Failed to fetch portfolio file (HTTP ${fileRes.status})`)
          const buf = new Uint8Array(await fileRes.arrayBuffer())
          if (buf.byteLength > MAX_PORTFOLIO_ATTACHMENT_BYTES) {
            return res.status(400).json({
              error: `Portfolio file exceeds ${MAX_PORTFOLIO_ATTACHMENT_BYTES / (1024 * 1024)} MB limit`,
            })
          }
          attachments.push({
            filename: String(portfolio.file.name || 'portfolio'),
            content: buf,
            contentType: String(portfolio.file.mime || 'application/octet-stream'),
          })
        } catch (err: any) {
          return res.status(502).json({ error: err?.message || 'Failed to read portfolio file' })
        }
      }

      const html = `<pre style="font-family:Arial,Helvetica,sans-serif;white-space:pre-wrap">${messageText.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c])}</pre>`

      let sentOk = false
      let sendError = ''
      try {
        const smtpHost = runtimeEnv.SMTP_HOST || (runtimeEnv.SMTP_USER || runtimeEnv.SENDER_EMAIL ? 'smtp.gmail.com' : '')
        const smtpUser = runtimeEnv.SMTP_USER || runtimeEnv.SENDER_EMAIL || ''
        const smtpPass = String(runtimeEnv.SMTP_PASS || runtimeEnv.APP_PASSWORD || '').replace(/\s+/g, '')
        if (!smtpHost || !smtpUser || !smtpPass) throw new Error('SMTP is not configured on the server')
        await sendSmtpEmail(runtimeEnv, {
          to, cc, subject, html, text: messageText, attachments,
        })
        sentOk = true
      } catch (err: any) {
        sendError = err?.message || String(err)
      }

      const sentAt = new Date().toISOString()
      const sendId = generateId('pfs')
      await models.portfolioSends.insertOne({
        id: sendId,
        portfolio_id: portfolioId,
        portfolio_title: portfolio.title,
        lead_id: leadId,
        sent_to: to,
        cc,
        subject,
        sent_by: user?.sub || null,
        sent_by_name: user?.full_name || user?.name || null,
        sent_at: sentAt,
        success: sentOk,
        error: sentOk ? null : sendError,
      })

      // Stamp the lead activity timeline so it shows on the lead detail page.
      try {
        await models.leadActivities.insertOne({
          id: generateId('lact'),
          lead_id: leadId,
          kind: 'portfolio_sent',
          summary: sentOk
            ? `Portfolio "${portfolio.title}" sent to ${to}`
            : `Portfolio "${portfolio.title}" send to ${to} failed: ${sendError}`,
          actor_id: user?.sub || null,
          actor_name: user?.full_name || user?.name || null,
          meta: {
            portfolio_id: portfolioId,
            portfolio_title: portfolio.title,
            send_id: sendId,
            success: sentOk,
            to,
          },
          created_at: sentAt,
        })
      } catch {
        // best-effort — the send is still recorded in portfolio_sends.
      }

      if (!sentOk) return res.status(502).json({ error: sendError || 'Failed to send portfolio' })
      return res.status(201).json({ data: { send_id: sendId }, message: 'Portfolio sent' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── PERMISSIONS (admin) ──────────────────────────────────
  router.get('/permissions', requireRole('admin'), async (_req, res) => {
    try {
      const grants = (await models.portfolioPermissions.find({})) as any[]
      const userIds = [...new Set(grants.map((g) => String(g.user_id || '')).filter(Boolean))]
      const users = userIds.length
        ? ((await models.users.find({ id: { $in: userIds } })) as any[])
        : []
      const usersById = new Map(users.map((u) => [String(u.id), u]))
      const enriched = grants.map((g) => ({
        ...g,
        user_name: usersById.get(String(g.user_id))?.full_name || null,
        user_email: usersById.get(String(g.user_id))?.email || null,
        user_role: usersById.get(String(g.user_id))?.role || null,
      }))
      return res.json({ data: enriched, grants: enriched })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.post('/permissions', requireRole('admin'), async (req, res) => {
    try {
      const admin = req.user as any
      const body = req.body || {}
      const userId = String(body.user_id || '').trim()
      if (!userId) return res.status(400).json({ error: 'user_id is required' })
      const target = (await models.users.findById(userId)) as any
      if (!target) return res.status(404).json({ error: 'User not found' })
      const existing = (await models.portfolioPermissions.findOne({ user_id: userId })) as any
      if (existing) return res.json({ message: 'Already granted' })
      await models.portfolioPermissions.insertOne({
        id: generateId('pfp'),
        user_id: userId,
        granted_by: admin?.sub || null,
        granted_at: new Date().toISOString(),
      })
      return res.status(201).json({ message: 'Permission granted' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.delete('/permissions/:userId', requireRole('admin'), async (req, res) => {
    try {
      const userId = String(req.params.userId)
      await models.portfolioPermissions.deleteOne({ user_id: userId })
      return res.json({ message: 'Permission revoked' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  return router
}
