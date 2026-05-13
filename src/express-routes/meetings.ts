// ═══════════════════════════════════════════════════════════════
// Meetings — sales team schedules meetings with leads (date/time,
// agenda, manually pasted Meet/Zoom link, internal attendees). On
// create we stamp the lead activity timeline (kind='meeting_scheduled')
// and push an in-app notification to every attendee. A background
// tick (started from server.ts) fires another notification 5 minutes
// before the meeting starts. The lead invite email is a separate
// manual action — same pattern as Portfolio / Scope / Quotation
// "send to lead".
// ═══════════════════════════════════════════════════════════════
import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'
import { validateLength, respondWithError } from '../validators'
import { createUserNotifications } from './notifications'
import { sendSmtpEmail, type SmtpEnv } from '../utils/smtp'
import { canUserAccessLead } from './leads'

function lower(value: any): string {
  return String(value || '').toLowerCase().trim()
}

// Permission source: Settings → Roles & Permissions. Granular keys:
// `meetings.create | edit | delete`. Admin always passes.
async function getMeetingPerms(models: MongoModels, user: any): Promise<{
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
  return {
    canCreate: perms.includes('meetings.create'),
    canEdit:   perms.includes('meetings.edit'),
    canDelete: perms.includes('meetings.delete'),
  }
}

function normalizeAttendees(raw: any): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  for (const v of raw) {
    const s = String(v || '').trim()
    if (s) seen.add(s)
  }
  return Array.from(seen)
}

function normalizeMeetingPayload(body: any) {
  const title = validateLength(String(body.title || '').trim(), 2, 200, 'Title')
  const lead_id = String(body.lead_id || '').trim()
  if (!lead_id) throw new Error('Lead is required')
  const scheduled_at = String(body.scheduled_at || '').trim()
  if (!scheduled_at || isNaN(Date.parse(scheduled_at))) {
    throw new Error('A valid scheduled date/time is required')
  }
  const duration_mins = Math.max(5, Math.min(600, Number(body.duration_mins) || 30))
  const meeting_link = String(body.meeting_link || '').trim().slice(0, 1000)
  const agenda = String(body.agenda || '').trim().slice(0, 4000)
  const attendees = normalizeAttendees(body.attendees)
  const status = ['scheduled', 'completed', 'cancelled'].includes(String(body.status || '').toLowerCase())
    ? String(body.status).toLowerCase()
    : 'scheduled'
  return {
    title,
    lead_id,
    scheduled_at: new Date(scheduled_at).toISOString(),
    duration_mins,
    meeting_link,
    agenda,
    attendees,
    status,
  }
}

function buildInviteHtml(meeting: any, lead: any, senderName: string, opts: { isReschedule?: boolean } = {}): string {
  const esc = (s: string) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c])
  const when = new Date(meeting.scheduled_at).toLocaleString('en-IN', {
    dateStyle: 'full', timeStyle: 'short',
  })
  const isJitsi = /(^|\.)meet\.jit\.si\//i.test(String(meeting.meeting_link || ''))
  const linkBlock = meeting.meeting_link
    ? `<div style="margin:14px 0"><a href="${esc(meeting.meeting_link)}" style="display:inline-block;background:#FF7A45;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Join Meeting</a></div>`
    : ''
  const jitsiNote = isJitsi
    ? `<div style="margin:10px 0;padding:10px 12px;background:#fff4e5;border-left:3px solid #f59e0b;border-radius:0 6px 6px 0;font:13px/1.5 Arial,Helvetica,sans-serif;color:#92400e">If you see "waiting for moderator", please wait a moment — the host will start the call shortly.</div>`
    : ''
  const heading = opts.isReschedule ? 'Meeting Rescheduled' : 'Meeting Invitation'
  const intro = opts.isReschedule
    ? `Our meeting has been moved to a new time. Updated details:`
    : `You're invited to a meeting with Mariox Software. Details below:`
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
    <div style="max-width:640px;margin:0 auto;background:#fff;padding:28px 30px;border-radius:8px;border:1px solid #e5e7eb">
      <div style="text-align:center;padding-bottom:14px;border-bottom:2px solid #FF7A45;margin-bottom:18px">
        <div style="font:800 22px Arial,Helvetica,sans-serif;color:#111827">${heading}</div>
        <div style="font:700 15px Arial,Helvetica,sans-serif;color:#FF7A45;margin-top:6px">${esc(meeting.title)}</div>
      </div>
      <p style="font:14px/1.6 Arial,Helvetica,sans-serif">Hi ${esc(lead?.name || 'there')},</p>
      <p style="font:14px/1.6 Arial,Helvetica,sans-serif">${intro}</p>
      <div style="background:#fafafa;padding:14px 16px;border-left:3px solid #FF7A45;border-radius:0 6px 6px 0;margin:14px 0">
        <div style="font:14px/1.7 Arial,Helvetica,sans-serif"><strong>When:</strong> ${esc(when)}</div>
        <div style="font:14px/1.7 Arial,Helvetica,sans-serif"><strong>Duration:</strong> ${meeting.duration_mins} minutes</div>
      </div>
      ${linkBlock}
      ${jitsiNote}
      ${meeting.agenda ? `<div style="margin-top:14px"><div style="font:700 14px Arial,Helvetica,sans-serif;color:#1f2937;margin-bottom:6px">Agenda</div><div style="font:14px/1.6 Arial,Helvetica,sans-serif;color:#374151;white-space:pre-wrap">${esc(meeting.agenda)}</div></div>` : ''}
      <div style="margin-top:24px;padding-top:14px;border-top:1px solid #e5e7eb;font:13px Arial,Helvetica,sans-serif;color:#6b7280">
        Regards,<br/><strong style="color:#1f2937">${esc(senderName)}</strong><br/>Mariox Software
      </div>
    </div></body></html>`
}

function buildInviteText(meeting: any, lead: any, senderName: string, opts: { isReschedule?: boolean } = {}): string {
  const when = new Date(meeting.scheduled_at).toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' })
  const intro = opts.isReschedule
    ? `Our meeting has been moved to a new time: ${meeting.title}`
    : `You're invited to a meeting with Mariox Software: ${meeting.title}`
  const lines = [
    `Hi ${lead?.name || 'there'},`,
    '',
    intro,
    '',
    `When: ${when}`,
    `Duration: ${meeting.duration_mins} minutes`,
  ]
  if (meeting.meeting_link) lines.push(`Join: ${meeting.meeting_link}`)
  if (meeting.agenda) { lines.push('', 'Agenda:', meeting.agenda) }
  lines.push('', 'Regards,', senderName, 'Mariox Software')
  return lines.join('\n')
}

// Attendee email — internal team member who's been added to a meeting.
// Same details but the framing is "you've been added", not "you're invited
// from the outside". Includes the lead name so the attendee knows context.
function buildAttendeeHtml(meeting: any, lead: any, attendeeName: string, senderName: string, opts: { isReschedule?: boolean } = {}): string {
  const esc = (s: string) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c])
  const when = new Date(meeting.scheduled_at).toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' })
  const linkBlock = meeting.meeting_link
    ? `<div style="margin:14px 0"><a href="${esc(meeting.meeting_link)}" style="display:inline-block;background:#a78bfa;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Join Meeting</a></div>`
    : ''
  const heading = opts.isReschedule ? 'Meeting Rescheduled' : 'Meeting Scheduled'
  const intro = opts.isReschedule
    ? `A meeting${lead?.name ? ` with <strong>${esc(lead.name)}</strong>` : ''} has been rescheduled. Updated details:`
    : `You've been added to a meeting${lead?.name ? ` with <strong>${esc(lead.name)}</strong>` : ''}. Details:`
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
    <div style="max-width:640px;margin:0 auto;background:#fff;padding:28px 30px;border-radius:8px;border:1px solid #e5e7eb">
      <div style="text-align:center;padding-bottom:14px;border-bottom:2px solid #a78bfa;margin-bottom:18px">
        <div style="font:800 22px Arial,Helvetica,sans-serif;color:#111827">${heading}</div>
        <div style="font:700 15px Arial,Helvetica,sans-serif;color:#a78bfa;margin-top:6px">${esc(meeting.title)}</div>
      </div>
      <p style="font:14px/1.6 Arial,Helvetica,sans-serif">Hi ${esc(attendeeName || 'team')},</p>
      <p style="font:14px/1.6 Arial,Helvetica,sans-serif">${intro}</p>
      <div style="background:#fafafa;padding:14px 16px;border-left:3px solid #a78bfa;border-radius:0 6px 6px 0;margin:14px 0">
        <div style="font:14px/1.7 Arial,Helvetica,sans-serif"><strong>When:</strong> ${esc(when)}</div>
        <div style="font:14px/1.7 Arial,Helvetica,sans-serif"><strong>Duration:</strong> ${meeting.duration_mins} minutes</div>
        ${lead?.name ? `<div style="font:14px/1.7 Arial,Helvetica,sans-serif"><strong>Lead:</strong> ${esc(lead.name)}${lead.email ? ` (${esc(lead.email)})` : ''}</div>` : ''}
        <div style="font:14px/1.7 Arial,Helvetica,sans-serif"><strong>Scheduled by:</strong> ${esc(senderName)}</div>
      </div>
      ${linkBlock}
      ${meeting.agenda ? `<div style="margin-top:14px"><div style="font:700 14px Arial,Helvetica,sans-serif;color:#1f2937;margin-bottom:6px">Agenda</div><div style="font:14px/1.6 Arial,Helvetica,sans-serif;color:#374151;white-space:pre-wrap">${esc(meeting.agenda)}</div></div>` : ''}
      <div style="margin-top:24px;padding-top:14px;border-top:1px solid #e5e7eb;font:13px Arial,Helvetica,sans-serif;color:#6b7280">
        You'll also get an in-app reminder 5 minutes before the meeting starts.<br/>— Mariox Portal
      </div>
    </div></body></html>`
}

function buildAttendeeText(meeting: any, lead: any, attendeeName: string, senderName: string, opts: { isReschedule?: boolean } = {}): string {
  const when = new Date(meeting.scheduled_at).toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' })
  const intro = opts.isReschedule
    ? `Meeting rescheduled${lead?.name ? ` with ${lead.name}` : ''}: ${meeting.title}`
    : `You've been added to a meeting${lead?.name ? ` with ${lead.name}` : ''}: ${meeting.title}`
  const lines = [
    `Hi ${attendeeName || 'team'},`,
    '',
    intro,
    '',
    `When: ${when}`,
    `Duration: ${meeting.duration_mins} minutes`,
  ]
  if (lead?.name) lines.push(`Lead: ${lead.name}${lead.email ? ` (${lead.email})` : ''}`)
  lines.push(`Scheduled by: ${senderName}`)
  if (meeting.meeting_link) lines.push(`Join: ${meeting.meeting_link}`)
  if (meeting.agenda) { lines.push('', 'Agenda:', meeting.agenda) }
  lines.push('', "You'll get an in-app reminder 5 minutes before the meeting.", '— Mariox Portal')
  return lines.join('\n')
}

// Sends invite emails to the lead + every attendee whose user record has
// an email. Best-effort: per-recipient failures are collected, but the
// helper itself never throws — so a flaky SMTP doesn't abort meeting
// creation. Returns a summary the caller can surface in the response.
async function sendMeetingInvites(
  models: MongoModels,
  runtimeEnv: SmtpEnv,
  meeting: any,
  lead: any,
  senderName: string,
  options: { excludeUserId?: string; reason?: 'new' | 'rescheduled' } = {},
): Promise<{ sentTo: string[]; failed: { email: string; error: string }[]; skipped: boolean }> {
  // SMTP guard — if env isn't configured we shouldn't even try, and the
  // caller can show a helpful message instead of N identical errors.
  const smtpHost = runtimeEnv.SMTP_HOST || (runtimeEnv.SMTP_USER || runtimeEnv.SENDER_EMAIL ? 'smtp.gmail.com' : '')
  const smtpUser = runtimeEnv.SMTP_USER || runtimeEnv.SENDER_EMAIL || ''
  const smtpPass = String(runtimeEnv.SMTP_PASS || runtimeEnv.APP_PASSWORD || '').replace(/\s+/g, '')
  if (!smtpHost || !smtpUser || !smtpPass) {
    console.warn('[meetings] SMTP not configured — invite emails skipped')
    return { sentTo: [], failed: [], skipped: true }
  }

  type Recipient = { email: string; isLead: boolean; name: string }
  const recipients: Recipient[] = []
  if (lead?.email) {
    recipients.push({ email: String(lead.email).trim(), isLead: true, name: String(lead.name || '') })
  }
  const attendeeIds: string[] = (Array.isArray(meeting.attendees) ? meeting.attendees : [])
    .map((x: any) => String(x || ''))
    .filter((x: string) => x && x !== options.excludeUserId)
  if (attendeeIds.length) {
    const users = (await models.users.find({ id: { $in: attendeeIds } })) as any[]
    for (const u of users) {
      const email = String(u?.email || '').trim()
      if (!email) continue
      recipients.push({ email, isLead: false, name: String(u.full_name || '') })
    }
  }

  // De-dup by email so a user whose own email matches the lead's email
  // (rare but possible during testing) gets one mail instead of two.
  const seen = new Set<string>()
  const uniq = recipients.filter((r) => {
    const k = r.email.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  const isReschedule = options.reason === 'rescheduled'
  const sentTo: string[] = []
  const failed: { email: string; error: string }[] = []
  await Promise.all(uniq.map(async (r) => {
    try {
      const baseSubject = r.isLead
        ? `Meeting Invitation — ${meeting.title}`
        : `Meeting scheduled: ${meeting.title}`
      const subject = isReschedule ? `Rescheduled — ${meeting.title}` : baseSubject
      const html = r.isLead
        ? buildInviteHtml(meeting, lead, senderName, { isReschedule })
        : buildAttendeeHtml(meeting, lead, r.name, senderName, { isReschedule })
      const text = r.isLead
        ? buildInviteText(meeting, lead, senderName, { isReschedule })
        : buildAttendeeText(meeting, lead, r.name, senderName, { isReschedule })
      await sendSmtpEmail(runtimeEnv, { to: r.email, subject, html, text })
      sentTo.push(r.email)
    } catch (e: any) {
      failed.push({ email: r.email, error: e?.message || String(e) })
    }
  }))

  return { sentTo, failed, skipped: false }
}

// ───────────────────────────────────────────────────────────────
// Reminder tick — exported so server.ts can start it once at boot.
// Polls every minute (default), claims due meetings atomically via
// reminder_sent flag so we don't double-fire even if the tick fires
// concurrently. Sends in-app notifications to every attendee + the
// meeting creator, and stamps the lead activity timeline.
// ───────────────────────────────────────────────────────────────
export function startMeetingReminderTick(
  models: MongoModels,
  intervalMs = 60_000,
): { stop: () => void } {
  const REMINDER_LEAD_MS = 5 * 60 * 1000 // 5 minutes
  let busy = false

  async function tick() {
    if (busy) return
    busy = true
    try {
      const now = Date.now()
      const nowIso = new Date(now).toISOString()
      const upper = new Date(now + REMINDER_LEAD_MS).toISOString()
      // ── Pass 1: auto-complete meetings whose duration window has ended ─
      // We can't easily compute scheduled_at + duration_mins in a Mongo
      // filter without aggregation, so fetch the small set of already-
      // started scheduled meetings and check the end time in JS. The
      // updateOne is gated on status='scheduled' so it doesn't clobber a
      // manual mark-completed/cancelled that happened in parallel.
      const startedMeetings = (await models.meetings.find({
        status: 'scheduled',
        scheduled_at: { $lt: nowIso },
      })) as any[]
      for (const m of startedMeetings) {
        const endMs = new Date(m.scheduled_at).getTime() + (Number(m.duration_mins) || 30) * 60000
        if (endMs > now) continue
        const claim = await models.meetings.updateOne(
          { id: m.id, status: 'scheduled' },
          { $set: { status: 'completed', auto_completed_at: nowIso, updated_at: nowIso } },
        ) as any
        const claimed = (claim && (claim.modifiedCount || claim.matchedCount || claim.result?.nModified)) || 0
        if (!claimed) continue
        if (m.lead_id) {
          try {
            await models.leadActivities.insertOne({
              id: generateId('lact'),
              lead_id: m.lead_id,
              kind: 'meeting_auto_completed',
              summary: `Meeting "${m.title}" auto-marked completed (duration ended)`,
              actor_id: null,
              actor_name: 'System',
              meta: { meeting_id: m.id, scheduled_at: m.scheduled_at, duration_mins: m.duration_mins },
              created_at: nowIso,
            })
          } catch { /* best-effort */ }
        }
      }

      // ── Pass 2: fire 5-min-pre-start reminders ────────────────────────
      // Find scheduled meetings whose start is within the next 5 minutes
      // and haven't been reminded yet. Buffer to past as well so a missed
      // tick (e.g. brief outage) still fires once the server is back.
      const lower = new Date(now - 60 * 60 * 1000).toISOString()
      const candidates = (await models.meetings.find({
        status: 'scheduled',
        reminder_sent: { $ne: 1 },
        scheduled_at: { $gte: lower, $lte: upper },
      })) as any[]

      for (const m of candidates) {
        // Atomically claim by flipping reminder_sent. If another worker
        // beat us, updateOne returns no change and we skip.
        const claim = await models.meetings.updateOne(
          { id: m.id, reminder_sent: { $ne: 1 } },
          { $set: { reminder_sent: 1, reminder_sent_at: new Date().toISOString() } },
        ) as any
        const claimed = (claim && (claim.modifiedCount || claim.matchedCount || claim.result?.nModified)) || 0
        if (!claimed) continue

        const attendees: string[] = Array.isArray(m.attendees) ? m.attendees : []
        const recipients = new Set<string>(attendees.map((id: string) => String(id || '')).filter(Boolean))
        if (m.created_by) recipients.add(String(m.created_by))

        const when = new Date(m.scheduled_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
        await createUserNotifications(models, Array.from(recipients), {
          type: 'meeting_reminder',
          title: `Meeting starting soon: ${m.title}`,
          body: `Starts at ${when}${m.meeting_link ? ` · ${m.meeting_link}` : ''}`,
          link: `meeting:${m.id}`,
          meta: { meeting_id: m.id, lead_id: m.lead_id, scheduled_at: m.scheduled_at },
        })

        if (m.lead_id) {
          try {
            await models.leadActivities.insertOne({
              id: generateId('lact'),
              lead_id: m.lead_id,
              kind: 'meeting_reminder',
              summary: `Reminder: meeting "${m.title}" starts at ${when}`,
              actor_id: null,
              actor_name: 'System',
              meta: { meeting_id: m.id, scheduled_at: m.scheduled_at },
              created_at: new Date().toISOString(),
            })
          } catch { /* best-effort */ }
        }
      }
    } catch (e) {
      console.warn('[meetings] reminder tick failed:', e)
    } finally {
      busy = false
    }
  }

  // Fire once immediately so a restart catches anything queued, then
  // settle into the polling cadence.
  void tick()
  const handle = setInterval(tick, intervalMs)
  return { stop: () => clearInterval(handle) }
}

export function createMeetingsRouter(
  models: MongoModels,
  jwtSecret: string,
  runtimeEnv: SmtpEnv = {},
) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  // ── LIST ─────────────────────────────────────────────────
  // Supports filters: ?lead_id=&status=&mine=1
  router.get('/', async (req, res) => {
    try {
      const user = req.user as any
      const filter: Record<string, any> = {}
      const leadId = String(req.query.lead_id || '').trim()
      const status = String(req.query.status || '').trim().toLowerCase()
      const mine = String(req.query.mine || '').trim() === '1'
      if (leadId) filter.lead_id = leadId
      if (['scheduled', 'completed', 'cancelled'].includes(status)) filter.status = status
      if (mine && user?.sub) {
        filter.$or = [{ created_by: String(user.sub) }, { attendees: String(user.sub) }]
      }

      const meetings = (await models.meetings.find(filter)) as any[]
      meetings.sort((a, b) => String(b.scheduled_at || '').localeCompare(String(a.scheduled_at || '')))

      // Enrich with lead name / creator name / attendee names.
      const leadIds = [...new Set(meetings.map((m) => String(m.lead_id || '')).filter(Boolean))]
      const userIds = new Set<string>()
      for (const m of meetings) {
        if (m.created_by) userIds.add(String(m.created_by))
        for (const a of (m.attendees || [])) userIds.add(String(a))
      }
      const [leads, users] = await Promise.all([
        leadIds.length ? (models.leads.find({ id: { $in: leadIds } }) as Promise<any[]>) : Promise.resolve([] as any[]),
        userIds.size  ? (models.users.find({ id: { $in: Array.from(userIds) } }) as Promise<any[]>) : Promise.resolve([] as any[]),
      ])
      const leadsById = new Map(leads.map((l) => [String(l.id), l]))
      const usersById = new Map(users.map((u) => [String(u.id), u]))

      const enriched = meetings.map((m) => ({
        ...m,
        lead_name: leadsById.get(String(m.lead_id))?.name || null,
        lead_email: leadsById.get(String(m.lead_id))?.email || null,
        created_by_name: usersById.get(String(m.created_by))?.full_name || null,
        attendee_details: (m.attendees || []).map((aid: string) => ({
          id: aid,
          name: usersById.get(String(aid))?.full_name || null,
          email: usersById.get(String(aid))?.email || null,
        })),
      }))

      const perms = await getMeetingPerms(models, user)
      const canManage = perms.canCreate || perms.canEdit || perms.canDelete
      return res.json({ data: enriched, meetings: enriched, can_manage: canManage, perms })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── DETAIL ───────────────────────────────────────────────
  router.get('/:id', async (req, res) => {
    try {
      const id = String(req.params.id)
      const meeting = (await models.meetings.findOne({ id })) as any
      if (!meeting) return res.status(404).json({ error: 'Meeting not found' })
      return res.json({ data: meeting })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── CREATE ───────────────────────────────────────────────
  router.post('/', async (req, res) => {
    try {
      const user = req.user as any
      const perms = await getMeetingPerms(models, user)
      const payload = normalizeMeetingPayload(req.body || {})
      const lead = (await models.leads.findOne({ id: payload.lead_id })) as any
      if (!lead) return res.status(404).json({ error: 'Lead not found' })
      // Either explicit meetings.create perm OR access to the specific
      // lead is enough — this is what lets the Schedule Follow-up flow
      // create meetings without granting `meetings.create` to every sales
      // agent. Mirrors the rule we use for lead tasks and notes.
      const hasLeadAccess = await canUserAccessLead(models, user, lead)
      if (!perms.canCreate && !hasLeadAccess) {
        return res.status(403).json({ error: 'Not allowed to schedule meetings' })
      }

      const now = new Date().toISOString()
      const id = generateId('mtg')
      const doc = {
        id,
        ...payload,
        created_by: user?.sub || null,
        created_at: now,
        updated_at: now,
        reminder_sent: 0,
      }
      await models.meetings.insertOne(doc)

      // Side effects: lead activity stamp + in-app notification to attendees + creator.
      const when = new Date(payload.scheduled_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
      try {
        await models.leadActivities.insertOne({
          id: generateId('lact'),
          lead_id: payload.lead_id,
          kind: 'meeting_scheduled',
          summary: `Meeting "${payload.title}" scheduled for ${when}`,
          actor_id: user?.sub || null,
          actor_name: user?.full_name || user?.name || null,
          meta: { meeting_id: id, scheduled_at: payload.scheduled_at, meeting_link: payload.meeting_link || null },
          created_at: now,
        })
      } catch { /* best-effort */ }

      const recipients = new Set<string>(payload.attendees.map(String).filter(Boolean))
      if (user?.sub) recipients.add(String(user.sub))
      await createUserNotifications(models, Array.from(recipients), {
        type: 'meeting_scheduled',
        title: `New meeting: ${payload.title}`,
        body: `Scheduled for ${when} with ${lead.name || 'lead'}`,
        link: `meeting:${id}`,
        actor_id: user?.sub || null,
        actor_name: user?.full_name || user?.name || null,
        meta: { meeting_id: id, lead_id: payload.lead_id, scheduled_at: payload.scheduled_at },
      })

      // Auto-send invite emails to the lead + every internal attendee (skip
      // the creator — they already know). Best-effort: SMTP failures don't
      // block the create response, but we surface a summary so the UI can
      // tell the user "invites sent to N people" or that SMTP isn't set up.
      const senderName = user?.full_name || user?.name || 'Mariox Team'
      const emailResult = await sendMeetingInvites(models, runtimeEnv, doc, lead, senderName, {
        excludeUserId: user?.sub ? String(user.sub) : undefined,
      })
      if (emailResult.sentTo.length) {
        await models.meetings.updateOne(
          { id },
          { $set: { invite_sent_at: new Date().toISOString(), invite_sent_to: emailResult.sentTo } },
        )
        try {
          await models.leadActivities.insertOne({
            id: generateId('lact'),
            lead_id: payload.lead_id,
            kind: 'meeting_invite_sent',
            summary: `Meeting invite "${payload.title}" sent to ${emailResult.sentTo.length} recipient${emailResult.sentTo.length === 1 ? '' : 's'}`,
            actor_id: user?.sub || null,
            actor_name: senderName,
            meta: { meeting_id: id, scheduled_at: payload.scheduled_at, recipients: emailResult.sentTo },
            created_at: new Date().toISOString(),
          })
        } catch { /* best-effort */ }
      }

      return res.status(201).json({
        data: { id },
        message: 'Meeting scheduled',
        invites: {
          sent: emailResult.sentTo.length,
          failed: emailResult.failed.length,
          skipped: emailResult.skipped,
          failed_details: emailResult.failed,
        },
      })
    } catch (error: any) {
      return respondWithError(res, error, 400)
    }
  })

  // ── UPDATE ───────────────────────────────────────────────
  router.put('/:id', async (req, res) => {
    try {
      const user = req.user as any
      const id = String(req.params.id)
      const existing = (await models.meetings.findOne({ id })) as any
      if (!existing) return res.status(404).json({ error: 'Meeting not found' })

      const isAdmin = lower(user?.role) === 'admin'
      const isOwner = String(existing.created_by || '') === String(user?.sub || '')
      const perms = await getMeetingPerms(models, user)
      if (!isAdmin && !isOwner && !perms.canEdit) {
        return res.status(403).json({ error: 'Not allowed to edit this meeting' })
      }

      const payload = normalizeMeetingPayload(req.body || {})
      const timeChanged = payload.scheduled_at !== existing.scheduled_at
      // If the time changed, reset reminder_sent so a new reminder fires.
      const patch: Record<string, unknown> = {
        ...payload,
        updated_at: new Date().toISOString(),
      }
      if (timeChanged) patch.reminder_sent = 0
      await models.meetings.updateOne({ id }, { $set: patch })

      // Re-send invite emails when the time changed — attendees and the
      // lead need to know about the new slot. Other edits (typo, agenda
      // tweak) don't trigger emails to avoid spam.
      let invites: { sent: number; failed: number; skipped: boolean } | undefined
      if (timeChanged) {
        const lead = (await models.leads.findOne({ id: payload.lead_id })) as any
        if (lead) {
          const senderName = user?.full_name || user?.name || 'Mariox Team'
          const updated = { ...existing, ...payload }
          const r = await sendMeetingInvites(models, runtimeEnv, updated, lead, senderName, {
            excludeUserId: user?.sub ? String(user.sub) : undefined,
          })
          invites = { sent: r.sentTo.length, failed: r.failed.length, skipped: r.skipped }
          if (r.sentTo.length) {
            try {
              await models.leadActivities.insertOne({
                id: generateId('lact'),
                lead_id: payload.lead_id,
                kind: 'meeting_rescheduled',
                summary: `Meeting "${payload.title}" rescheduled — re-invite sent to ${r.sentTo.length} recipient${r.sentTo.length === 1 ? '' : 's'}`,
                actor_id: user?.sub || null,
                actor_name: senderName,
                meta: { meeting_id: id, scheduled_at: payload.scheduled_at, recipients: r.sentTo },
                created_at: new Date().toISOString(),
              })
            } catch { /* best-effort */ }
          }
        }
      }

      return res.json({ message: 'Meeting updated', invites })
    } catch (error: any) {
      return respondWithError(res, error, 400)
    }
  })

  // ── STATUS UPDATE (quick mark completed/cancelled) ───────
  router.post('/:id/status', async (req, res) => {
    try {
      const user = req.user as any
      const id = String(req.params.id)
      const existing = (await models.meetings.findOne({ id })) as any
      if (!existing) return res.status(404).json({ error: 'Meeting not found' })
      const isAdmin = lower(user?.role) === 'admin'
      const isOwner = String(existing.created_by || '') === String(user?.sub || '')
      const perms = await getMeetingPerms(models, user)
      if (!isAdmin && !isOwner && !perms.canEdit) {
        return res.status(403).json({ error: 'Not allowed to edit this meeting' })
      }
      const status = String((req.body || {}).status || '').toLowerCase()
      if (!['scheduled', 'completed', 'cancelled'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' })
      }
      await models.meetings.updateOne({ id }, { $set: { status, updated_at: new Date().toISOString() } })
      return res.json({ message: 'Status updated' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── DELETE ───────────────────────────────────────────────
  router.delete('/:id', async (req, res) => {
    try {
      const user = req.user as any
      const id = String(req.params.id)
      const existing = (await models.meetings.findOne({ id })) as any
      if (!existing) return res.status(404).json({ error: 'Meeting not found' })
      const isAdmin = lower(user?.role) === 'admin'
      const isOwner = String(existing.created_by || '') === String(user?.sub || '')
      const perms = await getMeetingPerms(models, user)
      if (!isAdmin && !isOwner && !perms.canDelete) {
        return res.status(403).json({ error: 'Not allowed to delete this meeting' })
      }
      await models.meetings.deleteOne({ id })
      return res.json({ message: 'Meeting deleted' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── RESCHEDULE ───────────────────────────────────────────
  // Focused endpoint for the common case of "just move the meeting to a
  // new time". Accepts only scheduled_at (required) and duration_mins
  // (optional). Other fields stay untouched, so the full UPDATE modal
  // isn't needed. Auto re-sends invite emails with a "Rescheduled —"
  // subject so the lead and attendees can spot it in their inbox.
  router.post('/:id/reschedule', async (req, res) => {
    try {
      const user = req.user as any
      const id = String(req.params.id)
      const existing = (await models.meetings.findOne({ id })) as any
      if (!existing) return res.status(404).json({ error: 'Meeting not found' })

      const isAdmin = lower(user?.role) === 'admin'
      const isOwner = String(existing.created_by || '') === String(user?.sub || '')
      const perms = await getMeetingPerms(models, user)
      if (!isAdmin && !isOwner && !perms.canEdit) {
        return res.status(403).json({ error: 'Not allowed to reschedule this meeting' })
      }
      if (existing.status !== 'scheduled') {
        return res.status(400).json({ error: `Can't reschedule a ${existing.status} meeting` })
      }

      const body = req.body || {}
      const rawWhen = String(body.scheduled_at || '').trim()
      if (!rawWhen || isNaN(Date.parse(rawWhen))) {
        return res.status(400).json({ error: 'A valid scheduled date/time is required' })
      }
      const newWhen = new Date(rawWhen).toISOString()
      const newDuration = body.duration_mins != null
        ? Math.max(5, Math.min(600, Number(body.duration_mins) || 30))
        : Number(existing.duration_mins) || 30

      const nowIso = new Date().toISOString()
      const patch: Record<string, unknown> = {
        scheduled_at: newWhen,
        duration_mins: newDuration,
        updated_at: nowIso,
      }
      // Only reset the reminder flag if the time actually changed — saves
      // the tick a needless re-fire when the user just tweaks duration.
      if (newWhen !== existing.scheduled_at) patch.reminder_sent = 0
      await models.meetings.updateOne({ id }, { $set: patch })

      // Re-send invite emails with "Rescheduled" framing.
      const lead = (await models.leads.findOne({ id: existing.lead_id })) as any
      let invites = { sent: 0, failed: 0, skipped: false } as { sent: number; failed: number; skipped: boolean; failed_details?: any[] }
      if (lead) {
        const senderName = user?.full_name || user?.name || 'Mariox Team'
        const updated = { ...existing, ...patch }
        const r = await sendMeetingInvites(models, runtimeEnv, updated, lead, senderName, {
          excludeUserId: user?.sub ? String(user.sub) : undefined,
          reason: 'rescheduled',
        })
        invites = { sent: r.sentTo.length, failed: r.failed.length, skipped: r.skipped, failed_details: r.failed }
        if (r.sentTo.length) {
          try {
            await models.leadActivities.insertOne({
              id: generateId('lact'),
              lead_id: existing.lead_id,
              kind: 'meeting_rescheduled',
              summary: `Meeting "${existing.title}" rescheduled to ${new Date(newWhen).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} — re-invite sent to ${r.sentTo.length} recipient${r.sentTo.length === 1 ? '' : 's'}`,
              actor_id: user?.sub || null,
              actor_name: senderName,
              meta: { meeting_id: id, old_scheduled_at: existing.scheduled_at, new_scheduled_at: newWhen, recipients: r.sentTo },
              created_at: nowIso,
            })
          } catch { /* best-effort */ }
        }
      }

      // In-app notification to the attendees + creator with the new time.
      const recipients = new Set<string>(((existing.attendees || []) as any[]).map(String).filter(Boolean))
      if (existing.created_by) recipients.add(String(existing.created_by))
      const when = new Date(newWhen).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
      await createUserNotifications(models, Array.from(recipients), {
        type: 'meeting_rescheduled',
        title: `Meeting rescheduled: ${existing.title}`,
        body: `New time: ${when}`,
        link: `meeting:${id}`,
        actor_id: user?.sub || null,
        actor_name: user?.full_name || user?.name || null,
        meta: { meeting_id: id, lead_id: existing.lead_id, scheduled_at: newWhen, old_scheduled_at: existing.scheduled_at },
      })

      return res.json({ message: 'Meeting rescheduled', invites })
    } catch (error: any) {
      return respondWithError(res, error, 400)
    }
  })

  // ── SEND INVITE (manual re-send) ─────────────────────────
  // Same helper as auto-send on create — covers the lead + every internal
  // attendee, so the user can also use this to re-send if SMTP was down
  // when the meeting was first created.
  router.post('/:id/send-invite', async (req, res) => {
    try {
      const user = req.user as any
      const id = String(req.params.id)
      const meeting = (await models.meetings.findOne({ id })) as any
      if (!meeting) return res.status(404).json({ error: 'Meeting not found' })
      const lead = (await models.leads.findOne({ id: meeting.lead_id })) as any
      if (!lead) return res.status(404).json({ error: 'Lead not found' })

      const senderName = user?.full_name || user?.name || 'Mariox Team'
      const result = await sendMeetingInvites(models, runtimeEnv, meeting, lead, senderName, {
        excludeUserId: user?.sub ? String(user.sub) : undefined,
      })

      if (result.skipped) {
        return res.status(502).json({ error: 'SMTP is not configured on the server' })
      }

      const sentAt = new Date().toISOString()
      if (result.sentTo.length) {
        await models.meetings.updateOne(
          { id },
          { $set: { invite_sent_at: sentAt, invite_sent_to: result.sentTo } },
        )
        try {
          await models.leadActivities.insertOne({
            id: generateId('lact'),
            lead_id: meeting.lead_id,
            kind: 'meeting_invite_sent',
            summary: `Meeting invite "${meeting.title}" sent to ${result.sentTo.length} recipient${result.sentTo.length === 1 ? '' : 's'}`,
            actor_id: user?.sub || null,
            actor_name: senderName,
            meta: { meeting_id: id, scheduled_at: meeting.scheduled_at, recipients: result.sentTo },
            created_at: sentAt,
          })
        } catch { /* best-effort */ }
      }

      // No one got the email and at least one tried — surface as 502 so the
      // UI can show an actionable error rather than a misleading success.
      if (!result.sentTo.length && result.failed.length) {
        return res.status(502).json({
          error: result.failed[0]?.error || 'Failed to send invites',
          failed: result.failed,
        })
      }

      return res.status(201).json({
        message: 'Invites sent',
        sent: result.sentTo.length,
        failed: result.failed.length,
        failed_details: result.failed,
      })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  return router
}
