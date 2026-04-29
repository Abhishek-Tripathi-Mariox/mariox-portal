import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, requireRole } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'
import { DEFAULT_KANBAN_COLUMNS } from '../constants'
import {
  validateName,
  validateLength,
  validateEnum,
  validateOptional,
  validateISODate,
  validatePositiveNumber,
  respondWithError,
} from '../validators'
import { createUserNotification, createUserNotifications } from './notifications'

const AUCTION_STATUSES = ['open', 'awarded', 'cancelled', 'closed'] as const
const SUBMISSION_STATUSES = ['submitted', 'awarded', 'lost', 'withdrawn'] as const
const AUCTION_CODE_PATTERN = /^[A-Za-z0-9_-]{2,40}$/

// Decide what a viewer is allowed to see about other people's bids.
// Admin / PM / PC are oversight roles and always see everything. The bidder
// always sees their own. For any other invited team-member we honour the
// auction's visibility_hours window: bids reveal once we cross the threshold.
function canSeeAllSubmissions(viewerRole: string, auction: any) {
  const role = String(viewerRole || '').toLowerCase()
  if (role === 'admin' || role === 'pm' || role === 'pc') return true
  if (auction.status !== 'open') return true
  const deadlineMs = auction.bid_deadline ? new Date(auction.bid_deadline).getTime() : null
  if (!deadlineMs) return false
  const visibilityHours = Number(auction.visibility_hours) || 0
  const revealAt = deadlineMs - visibilityHours * 60 * 60 * 1000
  return Date.now() >= revealAt
}

function enrichSubmission(sub: any, usersById: Map<string, any>) {
  const u = usersById.get(String(sub.user_id))
  return {
    ...sub,
    bidder_name: u?.full_name || null,
    bidder_role: u?.role || null,
    avatar_color: u?.avatar_color || null,
  }
}

export function createBidsRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  // List auctions visible to the current user.
  router.get('/', async (req, res) => {
    try {
      const user = req.user as any
      const role = String(user?.role || '').toLowerCase()
      const isAdminLike = ['admin', 'pm', 'pc'].includes(role)

      const [auctions, submissions, users] = await Promise.all([
        models.bidAuctions.find({}) as Promise<any[]>,
        models.bidSubmissions.find({}) as Promise<any[]>,
        models.users.find({}) as Promise<any[]>,
      ])
      const usersById = new Map(users.map((u) => [String(u.id), u]))
      const subsByAuction = new Map<string, any[]>()
      for (const s of submissions) {
        const key = String(s.auction_id)
        const list = subsByAuction.get(key) || []
        list.push(s)
        subsByAuction.set(key, list)
      }

      const visible = auctions.filter((a) => {
        if (isAdminLike) return true
        const invited = Array.isArray(a.invited_user_ids) ? a.invited_user_ids : []
        return invited.includes(user.sub) || a.awarded_user_id === user.sub
      })

      const enriched = visible.map((a) => {
        const all = (subsByAuction.get(String(a.id)) || [])
          .map((s) => enrichSubmission(s, usersById))
          .sort((x, y) => Number(x.amount || 0) - Number(y.amount || 0))
        const reveal = canSeeAllSubmissions(role, a)
        // Bidders only see their own row when the visibility gate is shut.
        const visibleSubs = reveal ? all : all.filter((s) => s.user_id === user.sub)
        const lowest = all[0] || null
        const winner = a.awarded_user_id ? all.find((s) => s.user_id === a.awarded_user_id) || null : null
        const deadlineMs = a.bid_deadline ? new Date(a.bid_deadline).getTime() : null
        return {
          ...a,
          submissions: visibleSubs,
          submission_count: all.length,
          lowest_amount: reveal && lowest ? lowest.amount : null,
          lowest_bidder_name: reveal && lowest ? lowest.bidder_name : null,
          my_submission: all.find((s) => s.user_id === user.sub) || null,
          winner_name: winner?.bidder_name || null,
          winner_amount: winner?.amount || a.awarded_amount || null,
          time_left_ms: deadlineMs ? Math.max(0, deadlineMs - Date.now()) : null,
          is_closed: deadlineMs ? Date.now() > deadlineMs : false,
          visibility_open: reveal,
          can_view_all: reveal,
        }
      }).sort((x, y) => String(y.created_at || '').localeCompare(String(x.created_at || '')))

      return res.json({ data: enriched, auctions: enriched })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load bids' })
    }
  })

  // Single auction detail.
  router.get('/:id', async (req, res) => {
    try {
      const user = req.user as any
      const role = String(user?.role || '').toLowerCase()
      const isAdminLike = ['admin', 'pm', 'pc'].includes(role)
      const auction = await models.bidAuctions.findById(String(req.params.id)) as any
      if (!auction) return res.status(404).json({ error: 'Auction not found' })
      const invited = Array.isArray(auction.invited_user_ids) ? auction.invited_user_ids : []
      if (!isAdminLike && !invited.includes(user.sub) && auction.awarded_user_id !== user.sub) {
        return res.status(403).json({ error: 'You are not invited to this auction' })
      }
      const [subs, users] = await Promise.all([
        models.bidSubmissions.find({ auction_id: auction.id }) as Promise<any[]>,
        models.users.find({}) as Promise<any[]>,
      ])
      const usersById = new Map(users.map((u) => [String(u.id), u]))
      const all = subs.map((s) => enrichSubmission(s, usersById))
        .sort((x, y) => Number(x.amount || 0) - Number(y.amount || 0))
      const reveal = canSeeAllSubmissions(role, auction)
      const visibleSubs = reveal ? all : all.filter((s) => s.user_id === user.sub)
      const winner = auction.awarded_user_id ? all.find((s) => s.user_id === auction.awarded_user_id) || null : null
      const data = {
        ...auction,
        submissions: visibleSubs,
        submission_count: all.length,
        my_submission: all.find((s) => s.user_id === user.sub) || null,
        winner_name: winner?.bidder_name || null,
        winner_amount: winner?.amount || auction.awarded_amount || null,
        invited_users: invited.map((id: string) => {
          const u = usersById.get(id)
          return u ? { id: u.id, full_name: u.full_name, role: u.role } : { id }
        }),
        visibility_open: reveal,
      }
      return res.json({ data, auction: data })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to load auction' })
    }
  })

  // Create a new auction.
  router.post('/', requireRole('admin', 'pm'), async (req, res) => {
    try {
      const user = req.user as any
      const body = req.body || {}
      const name = validateName(body.name, 'Auction name', 2, 120)
      const code = validateLength(String(body.code || '').trim(), 2, 40, 'Auction code')
      if (!AUCTION_CODE_PATTERN.test(code)) {
        return res.status(400).json({ error: 'Code may only contain letters, numbers, underscore or hyphen' })
      }
      const scope = validateLength(String(body.scope || '').trim(), 1, 20000, 'Project scope')
      const maxBidAmount = validatePositiveNumber(body.max_bid_amount, 'Maximum bid amount')
      if (maxBidAmount <= 0) {
        return res.status(400).json({ error: 'Maximum bid amount must be greater than zero' })
      }

      const deadlineRaw = body.bid_deadline
      if (!deadlineRaw) return res.status(400).json({ error: 'Bid deadline is required' })
      const deadline = new Date(String(deadlineRaw))
      if (isNaN(deadline.getTime())) return res.status(400).json({ error: 'Invalid bid deadline' })
      if (deadline.getTime() <= Date.now()) return res.status(400).json({ error: 'Bid deadline must be in the future' })

      const visibilityHours = body.visibility_hours !== undefined
        ? validatePositiveNumber(body.visibility_hours, 'Visibility hours')
        : 0
      const plannedStart = validateOptional(body.planned_start_date, (v) => validateISODate(v, 'Planned start date'))
      const plannedEnd = validateOptional(body.planned_end_date, (v) => validateISODate(v, 'Planned end date'))
      if (plannedStart && plannedEnd && plannedStart > plannedEnd) {
        return res.status(400).json({ error: 'Planned end date must be after start date' })
      }

      const invitedRaw = Array.isArray(body.invited_user_ids) ? body.invited_user_ids : []
      const invitedTrimmed: string[] = Array.from(new Set<string>(
        invitedRaw.map((v: any) => String(v || '').trim()).filter((s: string) => s.length > 0),
      ))
      if (invitedTrimmed.length === 0) {
        return res.status(400).json({ error: 'Pick at least one team to invite for bidding' })
      }
      // Validate every invited id resolves to an active staff user — silent drops
      // would let admins invite stale ids by accident.
      const invitedUsers = await models.users.find({
        id: { $in: invitedTrimmed }, is_active: 1,
      }) as any[]
      const validInvited = new Set(invitedUsers.map((u) => String(u.id)))
      const missing = invitedTrimmed.filter((id) => !validInvited.has(id))
      if (missing.length) {
        return res.status(400).json({ error: `Invited user(s) not found: ${missing.join(', ')}` })
      }

      const id = generateId('bid')
      const nowIso = new Date().toISOString()
      const auction = {
        id,
        name,
        code,
        client_id: body.client_id || null,
        client_name: body.client_name || null,
        scope,
        bid_deadline: deadline.toISOString(),
        visibility_hours: visibilityHours,
        planned_start_date: plannedStart || null,
        planned_end_date: plannedEnd || null,
        max_bid_amount: maxBidAmount,
        invited_user_ids: invitedTrimmed,
        status: 'open',
        awarded_submission_id: null,
        awarded_user_id: null,
        awarded_amount: null,
        awarded_at: null,
        resulting_project_id: null,
        created_by: user?.sub || null,
        created_at: nowIso,
        updated_at: nowIso,
      }
      await models.bidAuctions.insertOne(auction)

      // Notify only the invited bidders + admins (oversight). Creator skipped via actor_id.
      try {
        const admins = await models.users.find({ role: 'admin', is_active: 1 }) as any[]
        const recipientIds = Array.from(new Set([
          ...invitedTrimmed,
          ...admins.map((a) => String(a.id)),
        ]))
        const creator = await models.users.findById(user?.sub) as any
        const creatorName = creator?.full_name || creator?.email || 'Admin'
        const briefPreview = scope.replace(/\s+/g, ' ').slice(0, 200)
        const bodyParts = [
          `Bids open until ${new Date(auction.bid_deadline).toLocaleString()}`,
          `Maximum bid ₹${Number(maxBidAmount).toLocaleString()}`,
          briefPreview ? `Scope: ${briefPreview}${scope.length > 200 ? '…' : ''}` : '',
        ].filter(Boolean)
        await createUserNotifications(models, recipientIds, {
          type: 'bid_opened',
          title: `New bid auction: ${name} (${code})`,
          body: bodyParts.join(' · '),
          link: `bid:${id}`,
          actor_id: user?.sub || null,
          actor_name: creatorName,
          meta: { bid_id: id, auction_code: code },
        })
      } catch (e) {
        console.warn('[bids] notify-on-create failed:', e)
      }

      return res.status(201).json({ message: 'Auction created', data: auction })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // Update an auction (only while still open).
  router.put('/:id', requireRole('admin', 'pm'), async (req, res) => {
    try {
      const id = String(req.params.id)
      const auction = await models.bidAuctions.findById(id) as any
      if (!auction) return res.status(404).json({ error: 'Auction not found' })
      if (auction.status !== 'open') {
        return res.status(400).json({ error: 'Closed/awarded auctions cannot be edited' })
      }
      const body = req.body || {}
      const $set: any = { updated_at: new Date().toISOString() }

      if (body.name !== undefined) $set.name = validateName(body.name, 'Auction name', 2, 120)
      if (body.scope !== undefined) $set.scope = validateLength(String(body.scope || '').trim(), 1, 20000, 'Project scope')
      if (body.max_bid_amount !== undefined) {
        const m = validatePositiveNumber(body.max_bid_amount, 'Maximum bid amount')
        if (m <= 0) return res.status(400).json({ error: 'Maximum bid amount must be greater than zero' })
        $set.max_bid_amount = m
      }
      if (body.bid_deadline !== undefined) {
        const parsed = new Date(String(body.bid_deadline))
        if (isNaN(parsed.getTime())) return res.status(400).json({ error: 'Invalid bid deadline' })
        if (parsed.getTime() <= Date.now()) return res.status(400).json({ error: 'Bid deadline must be in the future' })
        $set.bid_deadline = parsed.toISOString()
      }
      if (body.visibility_hours !== undefined) {
        $set.visibility_hours = validatePositiveNumber(body.visibility_hours, 'Visibility hours')
      }
      if (body.planned_start_date !== undefined) {
        $set.planned_start_date = body.planned_start_date
          ? validateISODate(body.planned_start_date, 'Planned start date') : null
      }
      if (body.planned_end_date !== undefined) {
        $set.planned_end_date = body.planned_end_date
          ? validateISODate(body.planned_end_date, 'Planned end date') : null
      }
      if (body.client_id !== undefined) $set.client_id = body.client_id || null
      if (body.client_name !== undefined) $set.client_name = body.client_name || null
      if (Array.isArray(body.invited_user_ids)) {
        const cleaned: string[] = Array.from(new Set<string>(
          body.invited_user_ids.map((v: any) => String(v || '').trim()).filter((s: string) => s.length > 0),
        ))
        if (cleaned.length === 0) return res.status(400).json({ error: 'At least one invitee required' })
        $set.invited_user_ids = cleaned
      }

      await models.bidAuctions.updateById(id, { $set })
      return res.json({ message: 'Auction updated' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.delete('/:id', requireRole('admin'), async (req, res) => {
    try {
      const id = String(req.params.id)
      await models.bidAuctions.updateById(id, {
        $set: { status: 'cancelled', updated_at: new Date().toISOString() },
      })
      return res.json({ message: 'Auction cancelled' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to cancel auction' })
    }
  })

  // Place / update a bid.
  router.post('/:id/submissions', async (req, res) => {
    try {
      const user = req.user as any
      if (!user?.sub) return res.status(401).json({ error: 'Unauthenticated' })
      const id = String(req.params.id)
      const auction = await models.bidAuctions.findById(id) as any
      if (!auction) return res.status(404).json({ error: 'Auction not found' })
      if (auction.status !== 'open') return res.status(400).json({ error: 'Auction is no longer open' })
      if (auction.bid_deadline && new Date(auction.bid_deadline).getTime() < Date.now()) {
        return res.status(400).json({ error: 'Bid deadline has passed' })
      }

      // Only invited teams may submit a bid (admins/PMs run the auction; they don't bid).
      const invited = Array.isArray(auction.invited_user_ids) ? auction.invited_user_ids : []
      const role = String(user?.role || '').toLowerCase()
      if (!invited.includes(user.sub)) {
        return res.status(403).json({ error: 'You were not invited to bid on this auction' })
      }
      if (role === 'admin' || role === 'pm' || role === 'pc') {
        return res.status(403).json({ error: 'Admin / PM / PC accounts cannot place bids' })
      }

      const amount = validatePositiveNumber(req.body?.amount, 'Bid amount')
      if (amount <= 0) return res.status(400).json({ error: 'Bid amount must be greater than zero' })
      // Hard cap — show a clear message so the bidder knows why their bid was rejected.
      if (Number(auction.max_bid_amount) > 0 && amount > Number(auction.max_bid_amount)) {
        return res.status(400).json({
          error: `Bid amount cannot exceed the maximum of ₹${Number(auction.max_bid_amount).toLocaleString()}`,
        })
      }
      const deliveryDays = req.body?.delivery_days !== undefined
        ? validatePositiveNumber(req.body.delivery_days, 'Delivery days')
        : null
      const note = req.body?.note ? validateLength(String(req.body.note), 0, 1000, 'Note') : null

      const existing = await models.bidSubmissions.findOne({ auction_id: id, user_id: user.sub }) as any
      const nowIso = new Date().toISOString()
      const submissionId = existing?.id || generateId('sub')
      const bidder = await models.users.findById(user.sub) as any
      const bidderName = bidder?.full_name || bidder?.email || 'Bidder'

      if (existing) {
        await models.bidSubmissions.updateById(existing.id, {
          $set: { amount, delivery_days: deliveryDays, note, updated_at: nowIso },
        })
      } else {
        await models.bidSubmissions.insertOne({
          id: submissionId,
          auction_id: id,
          user_id: user.sub,
          amount,
          delivery_days: deliveryDays,
          note,
          status: 'submitted',
          created_at: nowIso,
          updated_at: nowIso,
        })
      }

      // Tight notification: admin (oversight) gets pinged when any bid lands.
      // Other invited bidders only learn about competitor amounts once the
      // visibility window opens — keeping bid_placed silent for them avoids
      // leaking amounts before the reveal.
      try {
        const admins = await models.users.find({ role: 'admin', is_active: 1 }) as any[]
        await createUserNotifications(models, admins.map((u) => u.id), {
          type: 'bid_placed',
          title: `${bidderName} bid ₹${Number(amount).toLocaleString()} on ${auction.name}`,
          body: deliveryDays
            ? `Delivery in ${deliveryDays} day${deliveryDays === 1 ? '' : 's'}${note ? ' — ' + note : ''}`
            : (note || 'New bid placed'),
          link: `bid:${id}`,
          actor_id: user.sub,
          actor_name: bidderName,
          meta: { bid_id: id, submission_id: submissionId, amount },
        })
      } catch (e) {
        console.warn('[bids] notify-on-place failed:', e)
      }

      return res.status(201).json({ message: 'Bid submitted', data: { id: submissionId } })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.delete('/:id/submissions/:subId', async (req, res) => {
    try {
      const user = req.user as any
      const sub = await models.bidSubmissions.findById(String(req.params.subId)) as any
      if (!sub) return res.status(404).json({ error: 'Bid not found' })
      if (sub.user_id !== user.sub) return res.status(403).json({ error: 'Not your bid' })
      if (sub.status !== 'submitted') return res.status(400).json({ error: 'Awarded bids cannot be withdrawn' })
      await models.bidSubmissions.updateById(sub.id, {
        $set: { status: 'withdrawn', updated_at: new Date().toISOString() },
      })
      return res.json({ message: 'Bid withdrawn' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // Award a bid → flip the auction closed AND auto-create the real project.
  router.post('/:id/submissions/:subId/award', requireRole('admin', 'pm'), async (req, res) => {
    try {
      const user = req.user as any
      const auctionId = String(req.params.id)
      const subId = String(req.params.subId)
      const auction = await models.bidAuctions.findById(auctionId) as any
      if (!auction) return res.status(404).json({ error: 'Auction not found' })
      if (auction.status === 'awarded') {
        return res.status(400).json({ error: 'Auction has already been awarded' })
      }
      const sub = await models.bidSubmissions.findById(subId) as any
      if (!sub || sub.auction_id !== auctionId) return res.status(404).json({ error: 'Bid not found' })
      if (sub.status !== 'submitted') return res.status(400).json({ error: 'Bid is not in a submitted state' })

      const winner = await models.users.findById(sub.user_id) as any
      const winnerName = winner?.full_name || 'Winner'
      const winnerRole = String(winner?.role || '').toLowerCase()
      const isExternalWinner = winnerRole === 'team'

      const nowDate = new Date()
      const nowIso = nowDate.toISOString()
      const todayDate = nowIso.slice(0, 10)
      const startDate = auction.planned_start_date || todayDate
      let endDate: string | null = auction.planned_end_date || null
      if (!endDate && Number(sub.delivery_days) > 0) {
        const computed = new Date(nowDate)
        computed.setDate(computed.getDate() + Number(sub.delivery_days))
        endDate = computed.toISOString().slice(0, 10)
      }

      // 1) Auto-create the real project from the auction.
      const projectId = generateId('proj')
      const projectCode = String(auction.code) + '-PRJ'
      const project = {
        id: projectId,
        name: auction.name,
        code: projectCode,
        client_id: auction.client_id || null,
        client_name: auction.client_name || null,
        description: auction.scope || null,
        project_type: 'development',
        start_date: startDate,
        expected_end_date: endDate,
        priority: 'medium',
        status: 'active',
        total_allocated_hours: 0,
        estimated_budget_hours: 0,
        team_lead_id: null,
        pm_id: user?.sub || null,
        pc_id: null,
        assignment_type: isExternalWinner ? 'external' : 'in_house',
        external_team_id: isExternalWinner ? sub.user_id : null,
        external_assignee_type: isExternalWinner ? 'user' : null,
        billable: 1,
        revenue: Number(sub.amount) || 0,
        remarks: null,
        consumed_hours: 0,
        source_bid_id: auction.id,
        created_at: nowIso,
        updated_at: nowIso,
      }
      await models.projects.insertOne(project)

      // 2) Default kanban scaffolding so the new project is usable immediately.
      await models.kanbanPermissions.insertMany([
        { id: generateId('kp'), project_id: projectId, role: 'admin', can_view: 1, can_create_task: 1, can_edit_any_task: 1, can_edit_own_task: 1, can_move_task: 1, can_delete_task: 1, can_manage_columns: 1, can_comment: 1 },
        { id: generateId('kp'), project_id: projectId, role: 'pm', can_view: 1, can_create_task: 1, can_edit_any_task: 1, can_edit_own_task: 1, can_move_task: 1, can_delete_task: 1, can_manage_columns: 1, can_comment: 1 },
        { id: generateId('kp'), project_id: projectId, role: 'pc', can_view: 1, can_create_task: 1, can_edit_any_task: 1, can_edit_own_task: 1, can_move_task: 1, can_delete_task: 0, can_manage_columns: 0, can_comment: 1 },
        { id: generateId('kp'), project_id: projectId, role: 'developer', can_view: 1, can_create_task: 1, can_edit_any_task: 0, can_edit_own_task: 1, can_move_task: 1, can_delete_task: 0, can_manage_columns: 0, can_comment: 1 },
        { id: generateId('kp'), project_id: projectId, role: 'team', can_view: 1, can_create_task: 1, can_edit_any_task: 0, can_edit_own_task: 1, can_move_task: 1, can_delete_task: 0, can_manage_columns: 0, can_comment: 1 },
        { id: generateId('kp'), project_id: projectId, role: 'client', can_view: 1, can_create_task: 0, can_edit_any_task: 0, can_edit_own_task: 0, can_move_task: 0, can_delete_task: 0, can_manage_columns: 0, can_comment: 1 },
      ])
      await models.kanbanColumns.insertMany(DEFAULT_KANBAN_COLUMNS.map((col) => ({
        id: generateId('kc'),
        project_id: projectId,
        name: col.name,
        status_key: col.status_key,
        color: col.color,
        position: col.position,
        wip_limit: col.wip_limit,
        is_done_column: col.is_done_column,
      })))

      // 3) For in-house winners, also create a project_assignments row so the
      // winner sees the project on their dashboard / workload immediately.
      if (!isExternalWinner && sub.user_id) {
        await models.projectAssignments.insertOne({
          id: generateId('pa'),
          project_id: projectId,
          user_id: sub.user_id,
          allocated_hours: 0,
          consumed_hours: 0,
          role: winnerRole === 'developer' ? 'developer' : winnerRole || 'developer',
          is_active: 1,
          created_at: nowIso,
          updated_at: nowIso,
        })
      }

      // 4) Stamp the auction + submission as awarded and record the cross-link.
      await models.bidAuctions.updateById(auctionId, {
        $set: {
          status: 'awarded',
          awarded_submission_id: subId,
          awarded_user_id: sub.user_id,
          awarded_amount: sub.amount,
          awarded_at: nowIso,
          resulting_project_id: projectId,
          updated_at: nowIso,
        },
      })
      await models.bidSubmissions.updateById(subId, {
        $set: { status: 'awarded', updated_at: nowIso },
      })
      // Mark all other submissions as 'lost' so the bid module shows clean state.
      await models.bidSubmissions.updateMany(
        { auction_id: auctionId, id: { $ne: subId }, status: 'submitted' },
        { $set: { status: 'lost', updated_at: nowIso } },
      )

      // 5) Notifications — only related people. Losing bidders + winner.
      const otherSubs = await models.bidSubmissions.find({ auction_id: auctionId }) as any[]
      const losingIds = Array.from(new Set(
        otherSubs.map((s) => s.user_id).filter((uid) => uid && uid !== sub.user_id),
      ))
      if (losingIds.length) {
        await createUserNotifications(models, losingIds, {
          type: 'bid_awarded',
          title: `Bid awarded for ${auction.name}`,
          body: `${winnerName} won at ₹${Number(sub.amount).toLocaleString()}`,
          link: `bid:${auctionId}`,
          actor_id: user?.sub || null,
          meta: { bid_id: auctionId, project_id: projectId, winner_id: sub.user_id },
        })
      }
      if (sub.user_id) {
        const parts = [
          `Awarded at ₹${Number(sub.amount).toLocaleString()}`,
          `Starts ${startDate}`,
          endDate ? `Target end ${endDate}` : '',
        ].filter(Boolean)
        await createUserNotification(models, {
          user_id: sub.user_id,
          type: 'bid_awarded',
          title: `You won the bid: ${auction.name}`,
          body: parts.join(' · '),
          link: `project:${projectId}`,
          actor_id: user?.sub || null,
          meta: { bid_id: auctionId, project_id: projectId },
        })
      }

      return res.json({
        message: 'Bid awarded — project created',
        data: {
          project_id: projectId,
          start_date: startDate,
          expected_end_date: endDate,
          assignment_type: isExternalWinner ? 'external' : 'in_house',
          winner_id: sub.user_id,
        },
      })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  return router
}
