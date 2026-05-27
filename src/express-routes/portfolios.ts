// ═══════════════════════════════════════════════════════════════
// Portfolios — a catalog of company portfolios that sales users
// can send to leads. Admin owns the catalog by default and can
// grant "add" permission to other users. Every send is logged in
// portfolio_sends and emitted to the lead's activity timeline
// (kind='portfolio_sent') so it surfaces on the lead detail page.
// ═══════════════════════════════════════════════════════════════
import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, requireRole, userCanActOn, userViewScope } from '../express-middleware/auth'
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
  canEditOwn: boolean; canDeleteOwn: boolean;
}> {
  const role = lower(user?.role)
  if (role === 'admin') {
    return { canCreate: true, canEdit: true, canDelete: true, canEditOwn: true, canDeleteOwn: true }
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
  const canEditAll = hasManage || perms.includes('portfolios.edit') || perms.includes('portfolios.edit_all')
  const canDeleteAll = hasManage || perms.includes('portfolios.delete') || perms.includes('portfolios.delete_all')
  return {
    canCreate: hasManage || perms.includes('portfolios.create'),
    canEdit:   canEditAll,
    canDelete: canDeleteAll,
    canEditOwn:   canEditAll || perms.includes('portfolios.edit_own'),
    canDeleteOwn: canDeleteAll || perms.includes('portfolios.delete_own'),
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
      const user = req.user as any
      const scope = await userViewScope(models, user, 'portfolios')
      if (scope === 'none') {
        return res.json({ data: [], portfolios: [], can_manage: false })
      }
      const userId = String(user?.sub || user?.id || '')
      const allPortfolios = (await models.portfolios.find({})) as any[]
      const portfolios = scope === 'all'
        ? allPortfolios
        : allPortfolios.filter((p) => String(p.created_by || '') === userId)
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

      const perms = await getPortfolioPerms(models, user)
      const canManage = perms.canCreate || perms.canEdit || perms.canDelete

      return res.json({ data: enriched, portfolios: enriched, can_manage: canManage, scope, perms })
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

      if (!(await userCanActOn(models, user, 'portfolios', 'edit', existing))) {
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

      if (!(await userCanActOn(models, user, 'portfolios', 'delete', existing))) {
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
      // Email is now optional. When `send_email === false` (or `to` is empty)
      // we just log the share on the lead timeline without touching SMTP — the
      // sales user might have shared the portfolio via WhatsApp / in-person /
      // some other channel and just wants the activity recorded.
      const sendEmail = body.send_email !== false && body.send_email !== 'false'
      const subject = validateLength(
        String(body.subject || `Mariox Software — ${portfolio.title}`).trim(),
        1, 300, 'Subject',
      )
      const messageText = String(body.text || body.body || '').trim() ||
        `Hi ${lead.name},\n\nThanks for your time. As discussed, please find our portfolio "${portfolio.title}" attached for your reference.\n\nRegards,\n${user?.full_name || user?.name || 'Mariox Team'}`
      const to = String(body.to || (sendEmail ? lead.email || '' : '')).trim()
      if (sendEmail && !to) return res.status(400).json({ error: 'Recipient email is required when sending by email' })
      const cc = Array.isArray(body.cc) ? body.cc.filter(Boolean) : []

      // Fetch the file bytes from the stored URL and attach them — only when
      // we're actually emailing. Skipping this when send_email is off saves a
      // network round-trip on every share-only log.
      const attachments: SmtpAttachment[] = []
      if (sendEmail && portfolio.file?.url) {
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

      // Extra attachments uploaded with this send (files + pasted links).
      // Files come in as { url, name, mime } — same shape returned by
      // POST /uploads. Each file is fetched + attached; links are rendered
      // in the message body so the recipient can click through.
      const extraFiles = Array.isArray(body.extra_attachments) ? body.extra_attachments : []
      const extraLinks = Array.isArray(body.extra_links) ? body.extra_links : []
      if (sendEmail) {
        for (const a of extraFiles.slice(0, 10)) {
          if (!a || !a.url) continue
          try {
            const fileRes = await fetch(String(a.url))
            if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status}`)
            const buf = new Uint8Array(await fileRes.arrayBuffer())
            if (buf.byteLength > MAX_PORTFOLIO_ATTACHMENT_BYTES) {
              return res.status(400).json({
                error: `Attachment "${a.name || 'file'}" exceeds ${MAX_PORTFOLIO_ATTACHMENT_BYTES / (1024 * 1024)} MB limit`,
              })
            }
            attachments.push({
              filename: String(a.name || 'attachment'),
              content: buf,
              contentType: String(a.mime || 'application/octet-stream'),
            })
          } catch (err: any) {
            return res.status(502).json({ error: `Failed to read attachment "${a.name || 'file'}": ${err?.message || err}` })
          }
        }
      }

      const escapeText = (s: string) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c])
      // Append pasted links to the bottom of the email body so the recipient
      // sees them as clickable URLs. Skip when there are none.
      const linksBlock = (sendEmail && extraLinks.length)
        ? `\n\n<div style="margin-top:14px;padding-top:10px;border-top:1px solid #eee;font-family:Arial,Helvetica,sans-serif"><div style="font-size:12px;color:#666;margin-bottom:6px">Additional links:</div><ul style="margin:0;padding-left:18px">${
            extraLinks.slice(0, 20).map((l: any) =>
              `<li><a href="${escapeText(String(l.url || ''))}">${escapeText(String(l.name || l.url || ''))}</a></li>`,
            ).join('')
          }</ul></div>`
        : ''
      const html = `<pre style="font-family:Arial,Helvetica,sans-serif;white-space:pre-wrap">${escapeText(messageText)}</pre>${linksBlock}`

      let sentOk = false
      let sendError = ''
      if (sendEmail) {
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
        // Share-only entries (no email) get marked success=1 with channel='manual'
        // so the history view shows the share but doesn't flag a failed email.
        success: sendEmail ? sentOk : true,
        channel: sendEmail ? 'email' : 'manual',
        error: sendEmail && !sentOk ? sendError : null,
      })

      // Stamp the lead activity timeline so it shows on the lead detail page.
      try {
        const summary = !sendEmail
          ? `Portfolio "${portfolio.title}" shared (no email)`
          : sentOk
            ? `Portfolio "${portfolio.title}" sent to ${to}`
            : `Portfolio "${portfolio.title}" send to ${to} failed: ${sendError}`
        await models.leadActivities.insertOne({
          id: generateId('lact'),
          lead_id: leadId,
          kind: 'portfolio_sent',
          summary,
          actor_id: user?.sub || null,
          actor_name: user?.full_name || user?.name || null,
          meta: {
            portfolio_id: portfolioId,
            portfolio_title: portfolio.title,
            send_id: sendId,
            success: sendEmail ? sentOk : true,
            channel: sendEmail ? 'email' : 'manual',
            to: to || null,
          },
          created_at: sentAt,
        })
      } catch {
        // best-effort — the send is still recorded in portfolio_sends.
      }

      if (sendEmail && !sentOk) return res.status(502).json({ error: sendError || 'Failed to send portfolio' })
      return res.status(201).json({
        data: { send_id: sendId },
        message: sendEmail ? 'Portfolio sent' : 'Portfolio share recorded',
      })
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
