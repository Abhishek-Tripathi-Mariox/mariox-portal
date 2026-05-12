// ═══════════════════════════════════════════════════════════════
// Scopes — structured scope-of-work documents that sales users can
// build (intro + sections + deliverables + timeline + assumptions)
// and email to a lead. Mirrors the Portfolio pattern: admin owns the
// catalog by default and can grant "add" permission to others. Every
// send is logged in scope_sends and stamped on the lead activity
// timeline (kind='scope_sent') so it surfaces on the lead detail page.
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

// Permission source: Settings → Roles & Permissions (capability key
// `scopes.manage`). Admin always passes. Legacy per-user grants still
// pass for backward compat with old installs.
async function canManageScopes(models: MongoModels, user: any): Promise<boolean> {
  const role = lower(user?.role)
  if (role === 'admin') return true
  if (role) {
    const roleDoc = (await models.roles.findOne({ key: role })) as any
    const perms = Array.isArray(roleDoc?.permissions) ? roleDoc.permissions : []
    if (perms.includes('scopes.manage')) return true
  }
  const userId = String(user?.sub || user?.id || '')
  if (!userId) return false
  const grant = (await models.scopePermissions.findOne({ user_id: userId })) as any
  return !!grant
}

type ScopeBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'subheading'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'numbered'; items: string[] }
  | { type: 'table'; columns: string[]; rows: string[][] }
  | { type: 'code'; text: string }

function normalizeBlocks(raw: any[]): ScopeBlock[] {
  if (!Array.isArray(raw)) return []
  const out: ScopeBlock[] = []
  for (const b of raw) {
    if (!b || typeof b !== 'object') continue
    const type = String(b.type || '').toLowerCase()
    if (type === 'paragraph') {
      const text = String(b.text || '').trim().slice(0, 12000)
      if (text) out.push({ type: 'paragraph', text })
    } else if (type === 'subheading') {
      const text = String(b.text || '').trim().slice(0, 300)
      if (text) out.push({ type: 'subheading', text })
    } else if (type === 'bullets' || type === 'numbered') {
      const items = (Array.isArray(b.items) ? b.items : [])
        .map((x: any) => String(x || '').trim().slice(0, 800))
        .filter(Boolean)
      if (items.length) out.push({ type: type as 'bullets' | 'numbered', items })
    } else if (type === 'table') {
      const columns = (Array.isArray(b.columns) ? b.columns : [])
        .map((x: any) => String(x || '').trim().slice(0, 200))
      const rowsRaw = Array.isArray(b.rows) ? b.rows : []
      const rows = rowsRaw
        .map((r: any) => (Array.isArray(r) ? r : []).map((c: any) => String(c || '').slice(0, 2000)))
        .filter((r: string[]) => r.some((c) => c.trim()))
      if (columns.length || rows.length) out.push({ type: 'table', columns, rows })
    } else if (type === 'code') {
      const text = String(b.text || '').slice(0, 16000)
      if (text.trim()) out.push({ type: 'code', text })
    }
  }
  return out
}

function normalizeScopePayload(body: any) {
  const title = validateLength(String(body.title || '').trim(), 2, 200, 'Title')
  const project_name = String(body.project_name || '').trim().slice(0, 300)
  const client_name = String(body.client_name || '').trim().slice(0, 200)
  const spoc_name = String(body.spoc_name || '').trim().slice(0, 200)
  const overview = String(body.overview || '').trim().slice(0, 8000)
  const footer_text = String(body.footer_text || '').trim().slice(0, 4000)
  const timeline_text = String(body.timeline_text || '').trim().slice(0, 4000)
  const assumptions = String(body.assumptions || '').trim().slice(0, 8000)
  const sectionsRaw = Array.isArray(body.sections) ? body.sections : []
  const sections = sectionsRaw
    .map((s: any) => {
      const heading = String(s?.heading || '').trim().slice(0, 300)
      const body = String(s?.body || '').trim().slice(0, 12000)
      const blocks = normalizeBlocks(Array.isArray(s?.blocks) ? s.blocks : [])
      return { heading, body, blocks }
    })
    .filter((s: { heading: string; body: string; blocks: ScopeBlock[] }) =>
      s.heading || s.body || s.blocks.length,
    )
  const deliverablesRaw = Array.isArray(body.deliverables) ? body.deliverables : []
  const deliverables = deliverablesRaw
    .map((d: any) => String(d || '').trim().slice(0, 500))
    .filter(Boolean)
  // Optional uploaded file (e.g. a polished SOW PDF). When present, it gets
  // attached to the email on send in addition to the rendered HTML body.
  const file = body.file && typeof body.file === 'object' && body.file.url
    ? {
        url: String(body.file.url),
        name: String(body.file.name || body.file.original_name || 'sow'),
        mime: String(body.file.mime || body.file.mime_type || ''),
        size: Number(body.file.size || 0),
      }
    : null
  return {
    title,
    project_name,
    client_name,
    spoc_name,
    overview,
    sections,
    deliverables,
    timeline_text,
    assumptions,
    footer_text,
    file,
  }
}

function renderScopeBlockHtml(b: ScopeBlock, esc: (s: string) => string, paragraph: (s: string) => string): string {
  if (b.type === 'paragraph') {
    return `<div style="font:14px/1.6 Arial,Helvetica,sans-serif;color:#374151;margin:10px 0">${paragraph(b.text)}</div>`
  }
  if (b.type === 'subheading') {
    return `<div style="font:700 15px Arial,Helvetica,sans-serif;color:#1f2937;margin:14px 0 6px">${esc(b.text)}</div>`
  }
  if (b.type === 'bullets') {
    return `<ul style="margin:8px 0;padding-left:22px;color:#374151;font:14px/1.6 Arial,Helvetica,sans-serif">
      ${b.items.map((it) => `<li style="margin-bottom:4px">${esc(it)}</li>`).join('')}
    </ul>`
  }
  if (b.type === 'numbered') {
    return `<ol style="margin:8px 0;padding-left:22px;color:#374151;font:14px/1.6 Arial,Helvetica,sans-serif">
      ${b.items.map((it) => `<li style="margin-bottom:4px">${esc(it)}</li>`).join('')}
    </ol>`
  }
  if (b.type === 'table') {
    const headHtml = b.columns.length ? `
      <thead><tr style="background:#FFEAD9">
        ${b.columns.map((c) => `<th style="padding:10px 12px;text-align:left;font:600 12px Arial,Helvetica,sans-serif;color:#1f2937;border:1px solid #f1d2b6">${esc(c)}</th>`).join('')}
      </tr></thead>` : ''
    const colCount = b.columns.length || (b.rows[0]?.length ?? 1)
    const bodyHtml = b.rows.map((r) => {
      const cells: string[] = []
      for (let i = 0; i < colCount; i++) {
        cells.push(`<td style="padding:10px 12px;font:13px/1.5 Arial,Helvetica,sans-serif;color:#374151;border:1px solid #f1d2b6;vertical-align:top">${paragraph(r[i] || '')}</td>`)
      }
      return `<tr>${cells.join('')}</tr>`
    }).join('')
    return `<table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin:10px 0;border:1px solid #f1d2b6">
      ${headHtml}
      <tbody>${bodyHtml}</tbody>
    </table>`
  }
  if (b.type === 'code') {
    return `<pre style="margin:10px 0;padding:14px;background:#0f172a;color:#e2e8f0;border-radius:8px;font:12px/1.55 'Courier New',monospace;white-space:pre;overflow:auto">${esc(b.text)}</pre>`
  }
  return ''
}

function renderScopeHtml(scope: any, leadName: string, senderName: string): string {
  const esc = (s: string) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c])
  const paragraph = (text: string) => esc(text).replace(/\n+/g, '<br/>')

  // Each section: heading + (legacy body paragraph if present) + structured blocks.
  const sectionsHtml = (scope.sections || []).map((s: any, idx: number) => {
    const num = idx + 1
    const heading = `<h2 style="font:700 18px Arial,Helvetica,sans-serif;color:#111827;margin:22px 0 8px;padding-bottom:6px;border-bottom:2px solid #FF7A45;display:inline-block">${num}. ${esc(s.heading || '')}</h2>`
    const legacyBody = s.body ? `<div style="font:14px/1.6 Arial,Helvetica,sans-serif;color:#374151;margin:10px 0">${paragraph(s.body)}</div>` : ''
    const blocksHtml = (s.blocks || []).map((b: ScopeBlock) => renderScopeBlockHtml(b, esc, paragraph)).join('')
    return `<div style="margin-top:8px">${heading}${legacyBody}${blocksHtml}</div>`
  }).join('')

  const deliverablesHtml = (scope.deliverables || []).length ? `
    <div style="margin-top:18px">
      <h2 style="font:700 18px Arial,Helvetica,sans-serif;color:#111827;margin:0 0 8px;padding-bottom:6px;border-bottom:2px solid #FF7A45;display:inline-block">Deliverables</h2>
      <ul style="margin:8px 0;padding-left:22px;color:#374151;font:14px/1.6 Arial,Helvetica,sans-serif">
        ${(scope.deliverables || []).map((d: string) => `<li style="margin-bottom:4px">${esc(d)}</li>`).join('')}
      </ul>
    </div>` : ''
  const timelineHtml = scope.timeline_text ? `
    <div style="margin-top:18px">
      <h2 style="font:700 18px Arial,Helvetica,sans-serif;color:#111827;margin:0 0 8px;padding-bottom:6px;border-bottom:2px solid #FF7A45;display:inline-block">Timeline</h2>
      <div style="font:14px/1.6 Arial,Helvetica,sans-serif;color:#374151">${paragraph(scope.timeline_text)}</div>
    </div>` : ''
  const assumptionsHtml = scope.assumptions ? `
    <div style="margin-top:18px">
      <h2 style="font:700 18px Arial,Helvetica,sans-serif;color:#111827;margin:0 0 8px;padding-bottom:6px;border-bottom:2px solid #FF7A45;display:inline-block">Assumptions &amp; Notes</h2>
      <div style="font:14px/1.6 Arial,Helvetica,sans-serif;color:#374151">${paragraph(scope.assumptions)}</div>
    </div>` : ''

  // Header block (project name / client / SPOC / dev partner) — mirrors the
  // formal SOW layout when those fields are present.
  const projectName = scope.project_name || scope.title || ''
  const headerLines: string[] = []
  if (scope.client_name || leadName) headerLines.push(`<div><strong style="color:#1f2937">Client:</strong> <span style="color:#374151">${esc(scope.client_name || leadName)}</span></div>`)
  if (scope.spoc_name) headerLines.push(`<div><strong style="color:#1f2937">SPOC:</strong> <span style="color:#374151">${esc(scope.spoc_name)}</span></div>`)
  headerLines.push(`<div><strong style="color:#1f2937">Development Partner:</strong> <span style="color:#374151">Mariox Software</span></div>`)

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
  <div style="max-width:780px;margin:0 auto;background:#ffffff;padding:30px 34px;border-radius:8px;border:1px solid #e5e7eb">
    <div style="text-align:center;padding-bottom:18px;border-bottom:2px solid #FF7A45;margin-bottom:18px">
      <div style="font:800 26px Arial,Helvetica,sans-serif;color:#111827">STATEMENT OF WORK (SOW)</div>
      ${projectName ? `<div style="font:700 16px Arial,Helvetica,sans-serif;color:#FF7A45;margin-top:8px">${esc(projectName)}</div>` : ''}
    </div>

    <div style="display:block;margin:0 0 18px;font:14px/1.7 Arial,Helvetica,sans-serif">
      ${headerLines.join('')}
    </div>

    ${scope.overview ? `<div style="font:14px/1.7 Arial,Helvetica,sans-serif;color:#374151;margin:12px 0;padding:14px 16px;background:#fafafa;border-left:3px solid #FF7A45;border-radius:0 6px 6px 0">${paragraph(scope.overview)}</div>` : ''}

    ${sectionsHtml}
    ${deliverablesHtml}
    ${timelineHtml}
    ${assumptionsHtml}

    ${scope.footer_text ? `<div style="margin-top:22px;font:13px/1.6 Arial,Helvetica,sans-serif;color:#4b5563">${paragraph(scope.footer_text)}</div>` : ''}

    <div style="margin-top:26px;padding-top:14px;border-top:1px solid #e5e7eb;font:13px Arial,Helvetica,sans-serif;color:#6b7280">
      Regards,<br/><strong style="color:#1f2937">${esc(senderName)}</strong><br/>Mariox Software
    </div>
  </div>
</body></html>`
}

function renderScopeBlockText(b: ScopeBlock): string {
  if (b.type === 'paragraph') return b.text + '\n'
  if (b.type === 'subheading') return `\n— ${b.text} —\n`
  if (b.type === 'bullets') return b.items.map((it) => `  • ${it}`).join('\n') + '\n'
  if (b.type === 'numbered') return b.items.map((it, i) => `  ${i + 1}. ${it}`).join('\n') + '\n'
  if (b.type === 'table') {
    const widths = (b.columns.length ? [b.columns, ...b.rows] : b.rows).reduce((acc: number[], row) => {
      row.forEach((cell, i) => { acc[i] = Math.max(acc[i] || 0, Math.min(36, String(cell || '').length)) })
      return acc
    }, [])
    const fmt = (row: string[]) => row.map((c, i) => String(c || '').slice(0, 36).padEnd(widths[i] || 0)).join(' | ')
    const lines: string[] = []
    if (b.columns.length) {
      lines.push(fmt(b.columns))
      lines.push(widths.map((w) => '-'.repeat(w)).join('-+-'))
    }
    for (const r of b.rows) lines.push(fmt(r))
    return lines.join('\n') + '\n'
  }
  if (b.type === 'code') return b.text + '\n'
  return ''
}

function renderScopePlainText(scope: any, leadName: string, senderName: string): string {
  const lines: string[] = []
  lines.push('STATEMENT OF WORK (SOW)')
  if (scope.project_name || scope.title) lines.push(scope.project_name || scope.title)
  lines.push('')
  if (scope.client_name || leadName) lines.push(`Client: ${scope.client_name || leadName}`)
  if (scope.spoc_name) lines.push(`SPOC: ${scope.spoc_name}`)
  lines.push('Development Partner: Mariox Software')
  lines.push('')
  if (scope.overview) { lines.push(scope.overview); lines.push('') }
  for (const [idx, s] of (scope.sections || []).entries()) {
    if (s.heading) lines.push(`${idx + 1}. ${String(s.heading).toUpperCase()}`)
    if (s.body) lines.push(s.body)
    for (const b of (s.blocks || []) as ScopeBlock[]) lines.push(renderScopeBlockText(b))
    lines.push('')
  }
  if ((scope.deliverables || []).length) {
    lines.push('DELIVERABLES')
    for (const d of scope.deliverables) lines.push(`  • ${d}`)
    lines.push('')
  }
  if (scope.timeline_text) { lines.push('TIMELINE'); lines.push(scope.timeline_text); lines.push('') }
  if (scope.assumptions) { lines.push('ASSUMPTIONS & NOTES'); lines.push(scope.assumptions); lines.push('') }
  if (scope.footer_text) { lines.push(scope.footer_text); lines.push('') }
  lines.push('Regards,')
  lines.push(senderName)
  return lines.join('\n')
}

export function createScopesRouter(
  models: MongoModels,
  jwtSecret: string,
  runtimeEnv: SmtpEnv = {},
) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  // ── LIST ─────────────────────────────────────────────────
  router.get('/', async (req, res) => {
    try {
      const scopes = (await models.scopes.find({})) as any[]
      scopes.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))

      const creatorIds = [...new Set(scopes.map((p) => String(p.created_by || '')).filter(Boolean))]
      const creators = creatorIds.length
        ? ((await models.users.find({ id: { $in: creatorIds } })) as any[])
        : []
      const creatorsById = new Map(creators.map((u) => [String(u.id), u]))

      const allSends = (await models.scopeSends.find({})) as any[]
      const sendCounts = new Map<string, number>()
      const lastSent = new Map<string, string>()
      for (const s of allSends) {
        const pid = String(s.scope_id || '')
        sendCounts.set(pid, (sendCounts.get(pid) || 0) + 1)
        const prev = lastSent.get(pid)
        if (!prev || String(s.sent_at || '').localeCompare(prev) > 0) {
          lastSent.set(pid, String(s.sent_at || ''))
        }
      }

      const enriched = scopes.map((p) => ({
        ...p,
        created_by_name: creatorsById.get(String(p.created_by))?.full_name || null,
        send_count: sendCounts.get(String(p.id)) || 0,
        last_sent_at: lastSent.get(String(p.id)) || null,
      }))

      const user = req.user as any
      const canManage = await canManageScopes(models, user)
      return res.json({ data: enriched, scopes: enriched, can_manage: canManage })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── DETAIL ───────────────────────────────────────────────
  router.get('/permissions', requireRole('admin'), async (_req, res) => {
    try {
      const grants = (await models.scopePermissions.find({})) as any[]
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
      const existing = (await models.scopePermissions.findOne({ user_id: userId })) as any
      if (existing) return res.json({ message: 'Already granted' })
      await models.scopePermissions.insertOne({
        id: generateId('scp'),
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
      await models.scopePermissions.deleteOne({ user_id: userId })
      return res.json({ message: 'Permission revoked' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.get('/:id', async (req, res) => {
    try {
      const id = String(req.params.id)
      const scope = (await models.scopes.findOne({ id })) as any
      if (!scope) return res.status(404).json({ error: 'Scope not found' })
      return res.json({ data: scope })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── CREATE ───────────────────────────────────────────────
  router.post('/', async (req, res) => {
    try {
      const user = req.user as any
      if (!(await canManageScopes(models, user))) {
        return res.status(403).json({ error: 'Not allowed to add scopes' })
      }
      const payload = normalizeScopePayload(req.body || {})
      const now = new Date().toISOString()
      const id = generateId('scp')
      await models.scopes.insertOne({
        id,
        ...payload,
        created_by: user?.sub || null,
        created_at: now,
        updated_at: now,
      })
      return res.status(201).json({ data: { id }, message: 'Scope created' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── UPDATE ───────────────────────────────────────────────
  router.put('/:id', async (req, res) => {
    try {
      const user = req.user as any
      const id = String(req.params.id)
      const existing = (await models.scopes.findOne({ id })) as any
      if (!existing) return res.status(404).json({ error: 'Scope not found' })

      const isAdmin = lower(user?.role) === 'admin'
      const isOwner = String(existing.created_by || '') === String(user?.sub || '')
      const canManage = await canManageScopes(models, user)
      if (!isAdmin && !isOwner && !canManage) {
        return res.status(403).json({ error: 'Not allowed to edit this scope' })
      }

      const payload = normalizeScopePayload(req.body || {})
      await models.scopes.updateOne({ id }, { $set: { ...payload, updated_at: new Date().toISOString() } })
      return res.json({ message: 'Scope updated' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── DELETE ───────────────────────────────────────────────
  router.delete('/:id', async (req, res) => {
    try {
      const user = req.user as any
      const id = String(req.params.id)
      const existing = (await models.scopes.findOne({ id })) as any
      if (!existing) return res.status(404).json({ error: 'Scope not found' })
      const isAdmin = lower(user?.role) === 'admin'
      const isOwner = String(existing.created_by || '') === String(user?.sub || '')
      if (!isAdmin && !isOwner) {
        return res.status(403).json({ error: 'Not allowed to delete this scope' })
      }
      await models.scopes.deleteOne({ id })
      return res.json({ message: 'Scope deleted' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── HISTORY ──────────────────────────────────────────────
  router.get('/:id/history', async (req, res) => {
    try {
      const id = String(req.params.id)
      const sends = (await models.scopeSends.find({ scope_id: id })) as any[]
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
      const scopeId = String(req.params.id)
      const leadId = String(req.params.leadId)
      const scope = (await models.scopes.findOne({ id: scopeId })) as any
      if (!scope) return res.status(404).json({ error: 'Scope not found' })
      const lead = (await models.leads.findOne({ id: leadId })) as any
      if (!lead) return res.status(404).json({ error: 'Lead not found' })

      const body = req.body || {}
      const subject = validateLength(
        String(body.subject || `Scope of Work — ${scope.title}`).trim(),
        1, 300, 'Subject',
      )
      const to = String(body.to || lead.email || '').trim()
      if (!to) return res.status(400).json({ error: 'Recipient email is required' })
      const cc = Array.isArray(body.cc) ? body.cc.filter(Boolean) : []
      const senderName = user?.full_name || user?.name || 'Mariox Team'

      const html = renderScopeHtml(scope, lead.name || '', senderName)
      const text = renderScopePlainText(scope, lead.name || '', senderName)

      // Optionally attach the uploaded SOW file (PDF/doc) so the recipient
      // gets both the rendered email body and a downloadable copy.
      const attachments: any[] = []
      if (scope.file?.url) {
        try {
          const fileRes = await fetch(scope.file.url)
          if (!fileRes.ok) throw new Error(`Failed to fetch SOW file (HTTP ${fileRes.status})`)
          const buf = new Uint8Array(await fileRes.arrayBuffer())
          if (buf.byteLength > 10 * 1024 * 1024) {
            return res.status(400).json({ error: 'SOW attachment exceeds 10 MB limit' })
          }
          attachments.push({
            filename: String(scope.file.name || 'sow'),
            content: buf,
            contentType: String(scope.file.mime || 'application/octet-stream'),
          })
        } catch (err: any) {
          return res.status(502).json({ error: err?.message || 'Failed to read SOW file' })
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
      const sendId = generateId('scs')
      await models.scopeSends.insertOne({
        id: sendId,
        scope_id: scopeId,
        scope_title: scope.title,
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
          kind: 'scope_sent',
          summary: sentOk
            ? `Scope "${scope.title}" sent to ${to}`
            : `Scope "${scope.title}" send to ${to} failed: ${sendError}`,
          actor_id: user?.sub || null,
          actor_name: senderName,
          meta: { scope_id: scopeId, scope_title: scope.title, send_id: sendId, success: sentOk, to },
          created_at: sentAt,
        })
      } catch { /* best-effort */ }

      if (!sentOk) return res.status(502).json({ error: sendError || 'Failed to send scope' })
      return res.status(201).json({ data: { send_id: sendId }, message: 'Scope sent' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  return router
}
