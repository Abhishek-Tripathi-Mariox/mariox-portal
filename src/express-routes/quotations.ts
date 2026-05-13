// ═══════════════════════════════════════════════════════════════
// Quotations — structured price quotes (header + intro + line items
// with qty/rate/amount + tax + grand total + validity + terms) that
// sales users can build and email to a lead. Mirrors the Portfolio /
// Scope pattern: admin owns the catalog by default and can grant
// "add" permission to others. Every send is logged in quotation_sends
// and stamped on the lead activity timeline (kind='quotation_sent').
// ═══════════════════════════════════════════════════════════════
import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, requireRole } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'
import { validateLength, respondWithError } from '../validators'
import { sendSmtpEmail, type SmtpEnv } from '../utils/smtp'

function lower(value: any): string {
  return String(value || '').toLowerCase().trim()
}

// Permission source: Settings → Roles & Permissions. Granular keys are
// `quotations.create | edit | delete`. Legacy `quotations.manage` is still
// honored as a superset for older role docs. Admin always passes. Legacy
// per-user grants in quotationPermissions also still pass for backward
// compat with old installs.
async function getQuotationPerms(models: MongoModels, user: any): Promise<{
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
    ? !!(await models.quotationPermissions.findOne({ user_id: userId }))
    : false
  const hasManage = perms.includes('quotations.manage') || legacyGrant
  return {
    canCreate: hasManage || perms.includes('quotations.create'),
    canEdit:   hasManage || perms.includes('quotations.edit'),
    canDelete: hasManage || perms.includes('quotations.delete'),
  }
}

function num(v: any, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function normalizeQuotationPayload(body: any) {
  const title = validateLength(String(body.title || '').trim(), 2, 200, 'Title')
  const quote_number = String(body.quote_number || '').trim().slice(0, 80)
  const client_name = String(body.client_name || '').trim().slice(0, 200)
  const intro_text = String(body.intro_text || '').trim().slice(0, 5000)
  const terms_text = String(body.terms_text || '').trim().slice(0, 5000)
  const currency = (String(body.currency || 'INR').trim().toUpperCase().slice(0, 6) || 'INR')
  const validity_date = String(body.validity_date || '').trim().slice(0, 30)
  const tax_percent = Math.max(0, Math.min(100, num(body.tax_percent, 0)))

  const itemsRaw = Array.isArray(body.line_items) ? body.line_items : []
  const line_items = itemsRaw
    .map((it: any) => {
      const description = String(it?.description || '').trim().slice(0, 500)
      const qty = Math.max(0, num(it?.qty, 0))
      const rate = Math.max(0, num(it?.rate, 0))
      const amount = +(qty * rate).toFixed(2)
      return { description, qty, rate, amount }
    })
    .filter((it: { description: string; qty: number; rate: number }) => it.description || it.qty || it.rate)

  const subtotal = +line_items.reduce((sum: number, it: any) => sum + (it.amount || 0), 0).toFixed(2)
  const tax_amount = +((subtotal * tax_percent) / 100).toFixed(2)
  const grand_total = +(subtotal + tax_amount).toFixed(2)

  // Optional uploaded quotation file (e.g. PDF). When present, gets attached
  // to the email along with the rendered HTML body.
  const file = body.file && typeof body.file === 'object' && body.file.url
    ? {
        url: String(body.file.url),
        name: String(body.file.name || body.file.original_name || 'quotation'),
        mime: String(body.file.mime || body.file.mime_type || ''),
        size: Number(body.file.size || 0),
      }
    : null

  return {
    title,
    quote_number,
    client_name,
    intro_text,
    line_items,
    currency,
    subtotal,
    tax_percent,
    tax_amount,
    grand_total,
    validity_date,
    terms_text,
    file,
  }
}

function currencySymbol(code: string): string {
  const c = String(code || 'INR').toUpperCase()
  if (c === 'INR') return '₹'
  if (c === 'USD') return '$'
  if (c === 'EUR') return '€'
  if (c === 'GBP') return '£'
  return c + ' '
}

function fmtAmount(n: number, code: string): string {
  const sym = currencySymbol(code)
  const formatted = Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return sym + formatted
}

function renderQuotationHtml(q: any, leadName: string, senderName: string): string {
  const esc = (s: string) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c])
  const paragraph = (text: string) => esc(text).replace(/\n+/g, '<br/>')
  const rowsHtml = (q.line_items || []).map((it: any, i: number) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font:13px Arial,Helvetica,sans-serif;color:#374151">${i + 1}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font:13px Arial,Helvetica,sans-serif;color:#1f2937">${esc(it.description || '')}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font:13px Arial,Helvetica,sans-serif;color:#374151">${it.qty}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font:13px Arial,Helvetica,sans-serif;color:#374151">${esc(fmtAmount(it.rate, q.currency))}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font:13px Arial,Helvetica,sans-serif;color:#111827;font-weight:600">${esc(fmtAmount(it.amount, q.currency))}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
  <div style="max-width:720px;margin:0 auto;background:#ffffff;padding:28px 30px;border-radius:8px;border:1px solid #e5e7eb">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:14px;border-bottom:2px solid #FF7A45;margin-bottom:14px">
      <div>
        <div style="font:700 22px Arial,Helvetica,sans-serif;color:#111827">${esc(q.title)}</div>
        ${q.client_name || leadName ? `<div style="font:13px Arial,Helvetica,sans-serif;color:#6b7280;margin-top:4px">Prepared for ${esc(q.client_name || leadName)}</div>` : ''}
      </div>
      <div style="text-align:right;font:12px Arial,Helvetica,sans-serif;color:#6b7280">
        ${q.quote_number ? `Quote #${esc(q.quote_number)}<br/>` : ''}
        ${q.validity_date ? `Valid till ${esc(q.validity_date)}` : ''}
      </div>
    </div>
    ${q.intro_text ? `<div style="font:14px/1.6 Arial,Helvetica,sans-serif;color:#374151;margin-bottom:18px">${paragraph(q.intro_text)}</div>` : ''}
    ${(q.line_items || []).length ? `
      <table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin-top:6px;border:1px solid #e5e7eb">
        <thead>
          <tr style="background:#f9fafb">
            <th style="padding:10px 12px;text-align:left;font:600 12px Arial,Helvetica,sans-serif;color:#374151;border-bottom:1px solid #e5e7eb;width:36px">#</th>
            <th style="padding:10px 12px;text-align:left;font:600 12px Arial,Helvetica,sans-serif;color:#374151;border-bottom:1px solid #e5e7eb">Description</th>
            <th style="padding:10px 12px;text-align:right;font:600 12px Arial,Helvetica,sans-serif;color:#374151;border-bottom:1px solid #e5e7eb;width:64px">Qty</th>
            <th style="padding:10px 12px;text-align:right;font:600 12px Arial,Helvetica,sans-serif;color:#374151;border-bottom:1px solid #e5e7eb;width:110px">Rate</th>
            <th style="padding:10px 12px;text-align:right;font:600 12px Arial,Helvetica,sans-serif;color:#374151;border-bottom:1px solid #e5e7eb;width:120px">Amount</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot>
          <tr><td colspan="3"></td>
            <td style="padding:8px 12px;text-align:right;font:13px Arial,Helvetica,sans-serif;color:#374151">Subtotal</td>
            <td style="padding:8px 12px;text-align:right;font:13px Arial,Helvetica,sans-serif;color:#111827">${esc(fmtAmount(q.subtotal, q.currency))}</td>
          </tr>
          <tr><td colspan="3"></td>
            <td style="padding:8px 12px;text-align:right;font:13px Arial,Helvetica,sans-serif;color:#374151">Tax (${q.tax_percent}%)</td>
            <td style="padding:8px 12px;text-align:right;font:13px Arial,Helvetica,sans-serif;color:#111827">${esc(fmtAmount(q.tax_amount, q.currency))}</td>
          </tr>
          <tr><td colspan="3"></td>
            <td style="padding:12px;text-align:right;font:700 14px Arial,Helvetica,sans-serif;color:#111827;border-top:2px solid #111827">Grand Total</td>
            <td style="padding:12px;text-align:right;font:700 14px Arial,Helvetica,sans-serif;color:#FF7A45;border-top:2px solid #111827">${esc(fmtAmount(q.grand_total, q.currency))}</td>
          </tr>
        </tfoot>
      </table>` : ''}
    ${q.terms_text ? `
      <div style="margin-top:22px">
        <div style="font:600 14px Arial,Helvetica,sans-serif;color:#1f2937;margin-bottom:6px">Terms &amp; Notes</div>
        <div style="font:13px/1.55 Arial,Helvetica,sans-serif;color:#4b5563">${paragraph(q.terms_text)}</div>
      </div>` : ''}
    <div style="margin-top:26px;padding-top:14px;border-top:1px solid #e5e7eb;font:13px Arial,Helvetica,sans-serif;color:#6b7280">
      Regards,<br/><strong style="color:#1f2937">${esc(senderName)}</strong><br/>Mariox Software
    </div>
  </div>
</body></html>`
}

function renderQuotationPlainText(q: any, leadName: string, senderName: string): string {
  const lines: string[] = []
  lines.push(q.title)
  if (q.client_name || leadName) lines.push(`Prepared for ${q.client_name || leadName}`)
  if (q.quote_number) lines.push(`Quote #${q.quote_number}`)
  if (q.validity_date) lines.push(`Valid till ${q.validity_date}`)
  lines.push('')
  if (q.intro_text) { lines.push(q.intro_text); lines.push('') }
  if ((q.line_items || []).length) {
    lines.push('Line Items:')
    for (const [i, it] of (q.line_items as any[]).entries()) {
      lines.push(`  ${i + 1}. ${it.description}  ×${it.qty}  @ ${fmtAmount(it.rate, q.currency)}  = ${fmtAmount(it.amount, q.currency)}`)
    }
    lines.push('')
    lines.push(`Subtotal:    ${fmtAmount(q.subtotal, q.currency)}`)
    lines.push(`Tax (${q.tax_percent}%): ${fmtAmount(q.tax_amount, q.currency)}`)
    lines.push(`Grand Total: ${fmtAmount(q.grand_total, q.currency)}`)
    lines.push('')
  }
  if (q.terms_text) { lines.push('Terms & Notes'); lines.push(q.terms_text); lines.push('') }
  lines.push('Regards,')
  lines.push(senderName)
  return lines.join('\n')
}

export function createQuotationsRouter(
  models: MongoModels,
  jwtSecret: string,
  runtimeEnv: SmtpEnv = {},
) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  // ── LIST ─────────────────────────────────────────────────
  router.get('/', async (req, res) => {
    try {
      const quotations = (await models.quotations.find({})) as any[]
      quotations.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))

      const creatorIds = [...new Set(quotations.map((p) => String(p.created_by || '')).filter(Boolean))]
      const creators = creatorIds.length
        ? ((await models.users.find({ id: { $in: creatorIds } })) as any[])
        : []
      const creatorsById = new Map(creators.map((u) => [String(u.id), u]))

      const allSends = (await models.quotationSends.find({})) as any[]
      const sendCounts = new Map<string, number>()
      const lastSent = new Map<string, string>()
      for (const s of allSends) {
        const pid = String(s.quotation_id || '')
        sendCounts.set(pid, (sendCounts.get(pid) || 0) + 1)
        const prev = lastSent.get(pid)
        if (!prev || String(s.sent_at || '').localeCompare(prev) > 0) {
          lastSent.set(pid, String(s.sent_at || ''))
        }
      }

      const enriched = quotations.map((p) => ({
        ...p,
        created_by_name: creatorsById.get(String(p.created_by))?.full_name || null,
        send_count: sendCounts.get(String(p.id)) || 0,
        last_sent_at: lastSent.get(String(p.id)) || null,
      }))

      const user = req.user as any
      const perms = await getQuotationPerms(models, user)
      const canManage = perms.canCreate || perms.canEdit || perms.canDelete
      return res.json({ data: enriched, quotations: enriched, can_manage: canManage })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── PERMISSIONS (registered before /:id to avoid pattern collision) ──
  router.get('/permissions', requireRole('admin'), async (_req, res) => {
    try {
      const grants = (await models.quotationPermissions.find({})) as any[]
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
      const existing = (await models.quotationPermissions.findOne({ user_id: userId })) as any
      if (existing) return res.json({ message: 'Already granted' })
      await models.quotationPermissions.insertOne({
        id: generateId('qtp'),
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
      await models.quotationPermissions.deleteOne({ user_id: userId })
      return res.json({ message: 'Permission revoked' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── DETAIL ───────────────────────────────────────────────
  router.get('/:id', async (req, res) => {
    try {
      const id = String(req.params.id)
      const q = (await models.quotations.findOne({ id })) as any
      if (!q) return res.status(404).json({ error: 'Quotation not found' })
      return res.json({ data: q })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── CREATE ───────────────────────────────────────────────
  router.post('/', async (req, res) => {
    try {
      const user = req.user as any
      const perms = await getQuotationPerms(models, user)
      if (!perms.canCreate) {
        return res.status(403).json({ error: 'Not allowed to add quotations' })
      }
      const payload = normalizeQuotationPayload(req.body || {})
      const now = new Date().toISOString()
      const id = generateId('qt')
      await models.quotations.insertOne({
        id,
        ...payload,
        created_by: user?.sub || null,
        created_at: now,
        updated_at: now,
      })
      return res.status(201).json({ data: { id }, message: 'Quotation created' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── UPDATE ───────────────────────────────────────────────
  router.put('/:id', async (req, res) => {
    try {
      const user = req.user as any
      const id = String(req.params.id)
      const existing = (await models.quotations.findOne({ id })) as any
      if (!existing) return res.status(404).json({ error: 'Quotation not found' })

      const isAdmin = lower(user?.role) === 'admin'
      const isOwner = String(existing.created_by || '') === String(user?.sub || '')
      const perms = await getQuotationPerms(models, user)
      if (!isAdmin && !isOwner && !perms.canEdit) {
        return res.status(403).json({ error: 'Not allowed to edit this quotation' })
      }

      const payload = normalizeQuotationPayload(req.body || {})
      await models.quotations.updateOne({ id }, { $set: { ...payload, updated_at: new Date().toISOString() } })
      return res.json({ message: 'Quotation updated' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── DELETE ───────────────────────────────────────────────
  router.delete('/:id', async (req, res) => {
    try {
      const user = req.user as any
      const id = String(req.params.id)
      const existing = (await models.quotations.findOne({ id })) as any
      if (!existing) return res.status(404).json({ error: 'Quotation not found' })
      const isAdmin = lower(user?.role) === 'admin'
      const isOwner = String(existing.created_by || '') === String(user?.sub || '')
      const perms = await getQuotationPerms(models, user)
      if (!isAdmin && !isOwner && !perms.canDelete) {
        return res.status(403).json({ error: 'Not allowed to delete this quotation' })
      }
      await models.quotations.deleteOne({ id })
      return res.json({ message: 'Quotation deleted' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── HISTORY ──────────────────────────────────────────────
  router.get('/:id/history', async (req, res) => {
    try {
      const id = String(req.params.id)
      const sends = (await models.quotationSends.find({ quotation_id: id })) as any[]
      sends.sort((a, b) => String(b.sent_at || '').localeCompare(String(a.sent_at || '')))

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
  router.post('/:id/send/:leadId', async (req, res) => {
    try {
      const user = req.user as any
      const quotationId = String(req.params.id)
      const leadId = String(req.params.leadId)
      const q = (await models.quotations.findOne({ id: quotationId })) as any
      if (!q) return res.status(404).json({ error: 'Quotation not found' })
      const lead = (await models.leads.findOne({ id: leadId })) as any
      if (!lead) return res.status(404).json({ error: 'Lead not found' })

      const body = req.body || {}
      const subject = validateLength(
        String(body.subject || `Quotation — ${q.title}${q.quote_number ? ' (' + q.quote_number + ')' : ''}`).trim(),
        1, 300, 'Subject',
      )
      const to = String(body.to || lead.email || '').trim()
      if (!to) return res.status(400).json({ error: 'Recipient email is required' })
      const cc = Array.isArray(body.cc) ? body.cc.filter(Boolean) : []
      const senderName = user?.full_name || user?.name || 'Mariox Team'

      const html = renderQuotationHtml(q, lead.name || '', senderName)
      const text = renderQuotationPlainText(q, lead.name || '', senderName)

      // Optionally attach the uploaded quote file.
      const attachments: any[] = []
      if (q.file?.url) {
        try {
          const fileRes = await fetch(q.file.url)
          if (!fileRes.ok) throw new Error(`Failed to fetch quotation file (HTTP ${fileRes.status})`)
          const buf = new Uint8Array(await fileRes.arrayBuffer())
          if (buf.byteLength > 10 * 1024 * 1024) {
            return res.status(400).json({ error: 'Quotation attachment exceeds 10 MB limit' })
          }
          attachments.push({
            filename: String(q.file.name || 'quotation'),
            content: buf,
            contentType: String(q.file.mime || 'application/octet-stream'),
          })
        } catch (err: any) {
          return res.status(502).json({ error: err?.message || 'Failed to read quotation file' })
        }
      }

      let sentOk = false
      let sendError = ''
      try {
        const smtpHost = runtimeEnv.SMTP_HOST || (runtimeEnv.SMTP_USER || runtimeEnv.SENDER_EMAIL ? 'smtp.gmail.com' : '')
        const smtpUser = runtimeEnv.SMTP_USER || runtimeEnv.SENDER_EMAIL || ''
        const smtpPass = String(runtimeEnv.SMTP_PASS || runtimeEnv.APP_PASSWORD || '').replace(/\s+/g, '')
        if (!smtpHost || !smtpUser || !smtpPass) throw new Error('SMTP is not configured on the server')
        await sendSmtpEmail(runtimeEnv, { to, cc, subject, html, text, attachments })
        sentOk = true
      } catch (err: any) {
        sendError = err?.message || String(err)
      }

      const sentAt = new Date().toISOString()
      const sendId = generateId('qts')
      await models.quotationSends.insertOne({
        id: sendId,
        quotation_id: quotationId,
        quotation_title: q.title,
        quote_number: q.quote_number || null,
        grand_total: q.grand_total || 0,
        currency: q.currency || 'INR',
        lead_id: leadId,
        sent_to: to,
        cc,
        subject,
        sent_by: user?.sub || null,
        sent_by_name: senderName,
        sent_at: sentAt,
        success: sentOk,
        error: sentOk ? null : sendError,
      })

      try {
        await models.leadActivities.insertOne({
          id: generateId('lact'),
          lead_id: leadId,
          kind: 'quotation_sent',
          summary: sentOk
            ? `Quotation "${q.title}" (${currencySymbol(q.currency)}${q.grand_total}) sent to ${to}`
            : `Quotation "${q.title}" send to ${to} failed: ${sendError}`,
          actor_id: user?.sub || null,
          actor_name: senderName,
          meta: {
            quotation_id: quotationId,
            quotation_title: q.title,
            send_id: sendId,
            grand_total: q.grand_total,
            currency: q.currency,
            success: sentOk,
            to,
          },
          created_at: sentAt,
        })
      } catch { /* best-effort */ }

      if (!sentOk) return res.status(502).json({ error: sendError || 'Failed to send quotation' })
      return res.status(201).json({ data: { send_id: sendId }, message: 'Quotation sent' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  return router
}
