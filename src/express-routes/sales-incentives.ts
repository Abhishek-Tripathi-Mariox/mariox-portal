// ═══════════════════════════════════════════════════════════════
// Sales Incentive Tracker
//
// For each (user, period=YYYY-MM):
//   - target           = salary-based. sales_agent = salary × 10; sales_tl =
//                        1.4 × team agents' total; sales_manager = 1.4 × team
//                        TLs' total. Per-period admin override via target_snapshot.
//   - achieved (auto)  = sum of each closed lead's FIRST-milestone amount
//                        credited to the user in the period (TL/Manager roll up
//                        their team).
//   - achieved (final) = override stored in sales_incentives, else the auto value.
//   - earned           = tiered % of the sale: 100–130% of target → 3%,
//                        130–150% → 5%, >150% → 7% (marginal); <100% → 0.
//   - paid             = flag + paid_at / paid_by recorded by an admin.
//
// Permissions are read from Settings → Roles & Permissions:
//   - sales_incentive.view_all     — see all agents on the tracker
//   - sales_incentive.set_target   — set monthly target / incentive rate
//                                    (also covered by `users.edit`)
//   - sales_incentive.override     — override the achieved value
//   - sales_incentive.mark_paid    — mark a period as paid
//
// Admins bypass every check. Each sales agent can also see their OWN row
// regardless of `view_all`.
// ═══════════════════════════════════════════════════════════════
import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware } from '../express-middleware/auth'
import { generateId } from '../utils/helpers'
import { respondWithError } from '../validators'
import { ROLES, SALES_ROLES } from '../constants'

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

// Sums the SALE credited to each agent per period.
//
// Flow: lead → close & convert to client. At close the agent records the
// project value plus a milestone % breakdown (summing to 100%). Only the
// FIRST milestone's amount counts as the sale for the close month — the rest
// are recorded on the lead but don't affect incentives.
//
// We attribute the first-milestone amount to whoever the originating lead is
// credited to, in the month the lead was closed.
//
// Admin-handover override: if a lead has `revenue_credit_to` set, that user
// takes the credit instead of `assigned_to`. The lead's actual assignment
// stays unchanged — only the sale/incentive attribution moves.
//
// Returns: agentId → Map(period → first-milestone sale total).
//
// Backward compatibility: leads closed BEFORE milestone capture existed have no
// `first_milestone_amount`. For those we fall back to the revenue of the project
// that was created from the lead (the old attribution source), so historical
// sales still show. New closes always carry the milestone amount and use it.
async function buildSaleByAgentPeriod(models: MongoModels) {
  const [leads, projects] = await Promise.all([
    models.leads.find({}) as Promise<any[]>,
    models.projects.find({}) as Promise<any[]>,
  ])
  const projectRevByLead = new Map<string, number>()
  for (const p of projects) {
    const leadId = String(p.source_lead_id || '')
    if (!leadId) continue
    const rev = Number(p.revenue ?? p.project_amount ?? 0)
    if (!Number.isFinite(rev) || rev <= 0) continue
    projectRevByLead.set(leadId, (projectRevByLead.get(leadId) || 0) + rev)
  }

  const out = new Map<string, Map<string, number>>()
  for (const l of leads) {
    if (!l.client_id) continue // only closed/converted leads are sales
    let amount = Number(l.first_milestone_amount ?? 0)
    if (!Number.isFinite(amount) || amount <= 0) {
      // Old close with no milestone breakdown — use the linked project's revenue.
      amount = projectRevByLead.get(String(l.id)) || 0
    }
    if (!(amount > 0)) continue
    const agentId = String(l.revenue_credit_to || l.assigned_to || '').trim()
    if (!agentId) continue
    const period = String(l.sale_period || l.closed_at || '').slice(0, 7)
    if (!PERIOD_RE.test(period)) continue
    if (!out.has(agentId)) out.set(agentId, new Map())
    const m = out.get(agentId)!
    m.set(period, (m.get(period) || 0) + amount)
  }
  return out
}

// ── New incentive model ────────────────────────────────────────
// target  = salary-based. sales_agent → salary × 10. sales_tl → 1.4 × the
//           combined target of their active agents. sales_manager → 1.4 × the
//           combined target of their active TLs.
// sale    = sum of each closed lead's FIRST-milestone amount in the month.
// earned  = tiered % of the sale, by how far achievement runs past target:
//           the 100–130%-of-target band pays 3%, 130–150% pays 5%, above 150%
//           pays 7%. Anything below 100% of target earns nothing.
const AGENT_TARGET_MULTIPLIER = 10
const TEAM_TARGET_MULTIPLIER = 1.4
const INCENTIVE_TIERS = [
  { from: 1.0, to: 1.3, rate: 0.03 },
  { from: 1.3, to: 1.5, rate: 0.05 },
  { from: 1.5, to: Infinity, rate: 0.07 },
]

// Salary-based monthly target for a single user (0 when salary is unset).
function computeTargetForUser(userId: string, allUsers: any[]): number {
  const u = allUsers.find((x) => String(x.id) === String(userId))
  if (!u) return 0
  const role = String(u.role || '').toLowerCase().trim()
  if (role === 'sales_agent') {
    return +(num(u.salary, 0) * AGENT_TARGET_MULTIPLIER).toFixed(2)
  }
  if (role === 'sales_tl') {
    const agents = allUsers.filter((x) =>
      String(x.role || '').toLowerCase() === 'sales_agent' &&
      String(x.tl_id || '') === String(userId) &&
      Number(x.is_active || 0) === 1,
    )
    const teamTotal = agents.reduce((s, a) => s + computeTargetForUser(String(a.id), allUsers), 0)
    return +(teamTotal * TEAM_TARGET_MULTIPLIER).toFixed(2)
  }
  if (role === 'sales_manager') {
    const tls = allUsers.filter((x) =>
      String(x.role || '').toLowerCase() === 'sales_tl' &&
      String(x.manager_id || '') === String(userId) &&
      Number(x.is_active || 0) === 1,
    )
    const teamTotal = tls.reduce((s, t) => s + computeTargetForUser(String(t.id), allUsers), 0)
    return +(teamTotal * TEAM_TARGET_MULTIPLIER).toFixed(2)
  }
  return 0
}

// Tiered incentive on the month's sale. Each tier's rate applies only to the
// portion of the sale that falls within that achievement band (band edges are
// multiples of target). Returns 0 when target or sale is non-positive.
function computeEarnedTiered(sale: number, target: number): number {
  if (!Number.isFinite(sale) || sale <= 0 || !Number.isFinite(target) || target <= 0) return 0
  let earned = 0
  for (const tier of INCENTIVE_TIERS) {
    const lo = tier.from * target
    const hi = tier.to === Infinity ? Infinity : tier.to * target
    const portion = Math.max(0, Math.min(sale, hi) - lo)
    earned += portion * tier.rate
  }
  return +earned.toFixed(2)
}

function lower(v: any): string {
  return String(v || '').toLowerCase().trim()
}

function currentPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function num(v: any, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

// Returns the effective achieved value for a single user in a single period.
//   - sales_agent → just their own booked revenue.
//   - sales_tl    → own + every sales_agent's effective achieved where
//                   agent.tl_id === tl.id.
//   - sales_manager → own + every sales_tl's effective achieved (which already
//                     rolls up the TL's agents) where tl.manager_id === manager.id.
// An explicit period override (achieved_override) wins and skips the rollup —
// that's the whole point of admin override: force a fixed number.
//
// Returns { achieved, own, team, override }. Frontend uses own/team to show
// the breakdown for TL/Manager rows.
function computeEffectiveAchieved(
  userId: string,
  period: string,
  allUsers: any[],
  revenueByAgentPeriod: Map<string, Map<string, number>>,
  recordsByUserPeriod: Map<string, any>,
): { achieved: number; own: number; team: number; override: number | null } {
  const user = allUsers.find((u) => String(u.id) === String(userId))
  if (!user) return { achieved: 0, own: 0, team: 0, override: null }
  const own = revenueByAgentPeriod.get(String(userId))?.get(period) || 0
  const rec = recordsByUserPeriod.get(`${userId}:${period}`)
  const override = rec && rec.achieved_override !== undefined && rec.achieved_override !== null
    ? Number(rec.achieved_override) : null
  if (override !== null) return { achieved: override, own, team: 0, override }

  const role = lower(user.role)
  let team = 0
  if (role === 'sales_tl') {
    const agents = allUsers.filter((u) =>
      lower(u.role) === 'sales_agent' &&
      String(u.tl_id || '') === String(userId) &&
      Number(u.is_active || 0) === 1,
    )
    for (const a of agents) {
      team += computeEffectiveAchieved(String(a.id), period, allUsers, revenueByAgentPeriod, recordsByUserPeriod).achieved
    }
  } else if (role === 'sales_manager') {
    const tls = allUsers.filter((u) =>
      lower(u.role) === 'sales_tl' &&
      String(u.manager_id || '') === String(userId) &&
      Number(u.is_active || 0) === 1,
    )
    for (const tl of tls) {
      team += computeEffectiveAchieved(String(tl.id), period, allUsers, revenueByAgentPeriod, recordsByUserPeriod).achieved
    }
  }
  return { achieved: own + team, own, team, override: null }
}

async function hasPermission(models: MongoModels, user: any, key: string): Promise<boolean> {
  const role = lower(user?.role)
  if (role === 'admin') return true
  if (!role) return false
  const roleDoc = (await models.roles.findOne({ key: role })) as any
  const perms = Array.isArray(roleDoc?.permissions) ? roleDoc.permissions : []
  return perms.includes(key)
}

export function createSalesIncentivesRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  // ── SUMMARY ────────────────────────────────────────────────
  // Returns one row per sales user for the given period (defaults to current
  // month). Agents who lack view_all see only their own row.
  router.get('/summary', async (req, res) => {
    try {
      const user = req.user as any
      const period = String(req.query.period || currentPeriod())
      if (!PERIOD_RE.test(period)) {
        return res.status(400).json({ error: 'period must be YYYY-MM' })
      }
      const canViewAll = await hasPermission(models, user, 'sales_incentive.view_all')
      const myId = String(user?.sub || user?.id || '')

      const allUsers = (await models.users.find({})) as any[]
      let agents = allUsers.filter((u) =>
        SALES_ROLES.includes(lower(u.role) as any) && Number(u.is_active || 0) === 1,
      )
      if (!canViewAll) agents = agents.filter((u) => String(u.id) === myId)

      // Achievement = sum of each closed lead's first-milestone sale credited
      // to the agent in this period. Computed across all periods once so the
      // history endpoint can reuse the helper too.
      const revenueByAgentPeriod = await buildSaleByAgentPeriod(models)

      // Load overrides + paid status for this period.
      const records = (await models.salesIncentives.find({ period })) as any[]
      const recordByUserId = new Map(records.map((r) => [String(r.user_id), r]))
      // Keyed lookup for computeEffectiveAchieved (it works across periods).
      const recordsByUserPeriod = new Map(records.map((r) => [`${r.user_id}:${period}`, r]))

      // Pull every payment row for this period across all agents. We sum by
      // user to support partial payments: admin can record ₹500 today and
      // ₹500 next week, with `paid_amount` being the running total.
      const payments = (await models.salesIncentivePayments.find({ period })) as any[]
      const paymentsByUser = new Map<string, any[]>()
      for (const p of payments) {
        const uid = String(p.user_id)
        if (!paymentsByUser.has(uid)) paymentsByUser.set(uid, [])
        paymentsByUser.get(uid)!.push(p)
      }

      const rows = agents.map((u) => {
        const rec = recordByUserId.get(String(u.id)) || null
        // Use the period snapshot if one was frozen at action time (override
        // or payment), so adjusting the user's target later doesn't
        // retroactively change past months.
        // Target is salary-based (agent = salary×10; TL/Manager roll up their
        // team), unless an admin froze a per-period target_snapshot.
        const target = rec?.target_snapshot ?? computeTargetForUser(String(u.id), allUsers)
        // Effective achievement — for TL/Manager this rolls up direct reports.
        // achieved_auto here is the "own" booking value (kept for backward
        // compat with the override modal which shows the auto baseline).
        const eff = computeEffectiveAchieved(String(u.id), period, allUsers, revenueByAgentPeriod, recordsByUserPeriod)
        const achievedAuto = eff.own
        const achievedOverride = eff.override
        const achieved = eff.achieved
        // Tiered incentive on the sale (see computeEarnedTiered). The displayed
        // "rate" is the effective blended % of the sale that was earned.
        const earned = computeEarnedTiered(achieved, target)
        const rate = achieved > 0 ? +(earned / achieved * 100).toFixed(2) : 0
        const userPayments = (paymentsByUser.get(String(u.id)) || []).sort(
          (a, b) => String(b.paid_at || '').localeCompare(String(a.paid_at || '')),
        )
        // Sum of all partial payments + legacy single-amount field on the
        // sales_incentives row (for months recorded before payments existed).
        const paidFromPayments = userPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
        const legacyPaid = paidFromPayments === 0 && rec && rec.paid_amount !== undefined && rec.paid_amount !== null
          ? Number(rec.paid_amount) : 0
        const paid_amount = +(paidFromPayments + legacyPaid).toFixed(2)
        const balance = +Math.max(0, earned - paid_amount).toFixed(2)
        const fully_paid = earned > 0 && paid_amount >= earned
        return {
          user_id: String(u.id),
          user_name: u.full_name,
          user_email: u.email,
          user_role: u.role,
          avatar_color: u.avatar_color || null,
          period,
          target,
          incentive_rate: rate,
          achieved_auto: achievedAuto,
          achieved_override: achievedOverride,
          achieved,
          // Breakdown for TL/Manager rows: own = self-booked revenue,
          // team = sum rolled up from direct reports. For sales_agent rows,
          // own equals achieved (when no override) and team is 0.
          own_achieved: eff.own,
          team_achieved: eff.team,
          earned,
          paid: fully_paid || !!rec?.paid,
          paid_at: rec?.paid_at || null,
          paid_by: rec?.paid_by || null,
          paid_by_name: rec?.paid_by_name || null,
          paid_amount,
          balance,
          payments: userPayments.map((p) => ({
            id: p.id, amount: Number(p.amount), paid_at: p.paid_at,
            paid_by: p.paid_by, paid_by_name: p.paid_by_name, note: p.note || null,
          })),
          notes: rec?.notes || null,
          record_id: rec?.id || null,
        }
      })

      // Sort by earned desc so the biggest payouts surface first.
      rows.sort((a, b) => b.earned - a.earned)

      // Totals. `achieved` sums each row's own_achieved only — otherwise a
      // TL's rolled-up number plus the manager's rolled-up number would
      // double/triple-count the same booked revenue. earned/paid/pending are
      // per-user payouts and remain summable directly.
      const totals = rows.reduce((acc, r) => {
        acc.target += r.target
        acc.achieved += (r.own_achieved ?? r.achieved)
        acc.earned += r.earned
        acc.paid_amount += r.paid_amount
        acc.pending_amount += r.balance
        return acc
      }, { target: 0, achieved: 0, earned: 0, paid_amount: 0, pending_amount: 0 })

      return res.json({
        data: rows,
        rows,
        period,
        totals,
        can_view_all: canViewAll,
        can_set_target: await hasPermission(models, user, 'sales_incentive.set_target'),
        can_override:   await hasPermission(models, user, 'sales_incentive.override'),
        can_mark_paid:  await hasPermission(models, user, 'sales_incentive.mark_paid'),
      })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── EDIT PERIOD (target / rate / achieved override) ────────
  // One endpoint covers all three so admins can configure a month
  // independently of the user's "current" target/rate. Each field is
  // permission-gated so a viewer who only has sales_incentive.override
  // can't change the target/rate without sales_incentive.set_target.
  router.post('/:userId/:period/override', async (req, res) => {
    try {
      const actor = req.user as any
      const canOverride = await hasPermission(models, actor, 'sales_incentive.override')
      const canSetTarget = await hasPermission(models, actor, 'sales_incentive.set_target')
      if (!canOverride && !canSetTarget) {
        return res.status(403).json({ error: 'Not allowed to edit this period' })
      }

      const userId = String(req.params.userId)
      const period = String(req.params.period)
      if (!PERIOD_RE.test(period)) return res.status(400).json({ error: 'period must be YYYY-MM' })
      const target = (await models.users.findById(userId)) as any
      if (!target) return res.status(404).json({ error: 'User not found' })

      const body = req.body || {}

      // Achieved override (gated by sales_incentive.override).
      const wantsOverride = Object.prototype.hasOwnProperty.call(body, 'achieved_override')
      let achievedOverride: number | null = null
      if (wantsOverride) {
        if (!canOverride) return res.status(403).json({ error: 'Not allowed to override achieved value' })
        if (body.achieved_override === null || body.achieved_override === '') {
          achievedOverride = null
        } else {
          const n = Number(body.achieved_override)
          if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'achieved_override must be a non-negative number' })
          achievedOverride = n
        }
      }

      // Per-period target & rate (gated by sales_incentive.set_target).
      const wantsTarget = Object.prototype.hasOwnProperty.call(body, 'target_snapshot')
      const wantsRate = Object.prototype.hasOwnProperty.call(body, 'rate_snapshot')
      let targetSnapshot: number | undefined
      let rateSnapshot: number | undefined
      if (wantsTarget) {
        if (!canSetTarget) return res.status(403).json({ error: 'Not allowed to change the period target' })
        const n = Number(body.target_snapshot)
        if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'target_snapshot must be a non-negative number' })
        targetSnapshot = n
      }
      if (wantsRate) {
        if (!canSetTarget) return res.status(403).json({ error: 'Not allowed to change the period rate' })
        const n = Number(body.rate_snapshot)
        if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'rate_snapshot must be a non-negative number' })
        rateSnapshot = n
      }

      const notes = body.notes !== undefined ? String(body.notes).slice(0, 1000) : undefined

      const nowIso = new Date().toISOString()
      const existing = (await models.salesIncentives.findOne({ user_id: userId, period })) as any
      if (existing) {
        const patch: Record<string, unknown> = { updated_at: nowIso }
        if (wantsOverride) patch.achieved_override = achievedOverride
        if (wantsTarget)   patch.target_snapshot = targetSnapshot
        if (wantsRate)     patch.rate_snapshot = rateSnapshot
        if (notes !== undefined) patch.notes = notes
        await models.salesIncentives.updateOne({ id: existing.id }, { $set: patch })
      } else {
        // First time this period gets touched — freeze the current user
        // target/rate unless caller is supplying explicit snapshot values.
        await models.salesIncentives.insertOne({
          id: generateId('sinc'),
          user_id: userId,
          period,
          achieved_override: wantsOverride ? achievedOverride : null,
          target_snapshot: targetSnapshot ?? computeTargetForUser(userId, await models.users.find({}) as any[]),
          rate_snapshot:   rateSnapshot   ?? 0,
          paid: false,
          notes: notes ?? null,
          created_at: nowIso,
          updated_at: nowIso,
        })
      }
      return res.json({ message: 'Saved' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── MARK PAID ──────────────────────────────────────────────
  router.post('/:userId/:period/mark-paid', async (req, res) => {
    try {
      const actor = req.user as any
      if (!(await hasPermission(models, actor, 'sales_incentive.mark_paid'))) {
        return res.status(403).json({ error: 'Not allowed to mark incentives as paid' })
      }
      const userId = String(req.params.userId)
      const period = String(req.params.period)
      if (!PERIOD_RE.test(period)) return res.status(400).json({ error: 'period must be YYYY-MM' })
      const target = (await models.users.findById(userId)) as any
      if (!target) return res.status(404).json({ error: 'User not found' })

      const body = req.body || {}
      const paidAmount = body.paid_amount !== undefined && body.paid_amount !== null && body.paid_amount !== ''
        ? num(body.paid_amount) : null
      const notes = body.notes !== undefined ? String(body.notes).slice(0, 1000) : null

      const nowIso = new Date().toISOString()
      const existing = (await models.salesIncentives.findOne({ user_id: userId, period })) as any
      const patch = {
        paid: true,
        paid_at: nowIso,
        paid_by: actor?.sub || null,
        paid_by_name: actor?.full_name || actor?.name || null,
        paid_amount: paidAmount,
        notes: notes ?? (existing?.notes ?? null),
        updated_at: nowIso,
      }
      if (existing) {
        await models.salesIncentives.updateOne({ id: existing.id }, { $set: patch })
      } else {
        await models.salesIncentives.insertOne({
          id: generateId('sinc'),
          user_id: userId,
          period,
          achieved_override: null,
          target_snapshot: computeTargetForUser(userId, await models.users.find({}) as any[]),
          rate_snapshot: 0,
          ...patch,
          created_at: nowIso,
        })
      }
      return res.json({ message: 'Marked paid' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // ── PAYMENTS (partial pay history) ────────────────────────
  // The earned incentive can be paid out across multiple installments —
  // e.g. earned ₹10,000 → ₹5,000 today + ₹5,000 next week. Each call to
  // POST /payments adds one entry; the summary endpoint sums them per
  // user/period to compute paid_amount and balance.
  router.post('/:userId/:period/payments', async (req, res) => {
    try {
      const actor = req.user as any
      if (!(await hasPermission(models, actor, 'sales_incentive.mark_paid'))) {
        return res.status(403).json({ error: 'Not allowed to record payments' })
      }
      const userId = String(req.params.userId)
      const period = String(req.params.period)
      if (!PERIOD_RE.test(period)) return res.status(400).json({ error: 'period must be YYYY-MM' })
      const targetUser = (await models.users.findById(userId)) as any
      if (!targetUser) return res.status(404).json({ error: 'User not found' })

      const body = req.body || {}
      const amount = Number(body.amount)
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: 'amount must be a positive number' })
      }
      const note = body.note ? String(body.note).trim().slice(0, 500) : null
      const paidAt = body.paid_at ? new Date(body.paid_at).toISOString() : new Date().toISOString()

      const id = generateId('sincpay')
      await models.salesIncentivePayments.insertOne({
        id,
        user_id: userId,
        period,
        amount,
        paid_at: paidAt,
        paid_by: actor?.sub || null,
        paid_by_name: actor?.full_name || actor?.name || null,
        note,
        created_at: new Date().toISOString(),
      })

      // Snapshot the target/rate onto the sales_incentives row so the
      // period's earned amount stays stable even if admin tweaks the user's
      // monthly_target later. Same pattern as the override endpoint.
      const existing = (await models.salesIncentives.findOne({ user_id: userId, period })) as any
      if (!existing) {
        await models.salesIncentives.insertOne({
          id: generateId('sinc'),
          user_id: userId,
          period,
          achieved_override: null,
          target_snapshot: computeTargetForUser(userId, await models.users.find({}) as any[]),
          rate_snapshot: 0,
          paid: false,
          notes: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
      }
      return res.status(201).json({ message: 'Payment recorded', data: { id, amount } })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.delete('/payments/:paymentId', async (req, res) => {
    try {
      const actor = req.user as any
      if (!(await hasPermission(models, actor, 'sales_incentive.mark_paid'))) {
        return res.status(403).json({ error: 'Not allowed to delete payments' })
      }
      const id = String(req.params.paymentId)
      await models.salesIncentivePayments.deleteById(id)
      return res.json({ message: 'Payment deleted' })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Failed to delete' })
    }
  })

  // ── HISTORY (per agent) ───────────────────────────────────
  // Returns every month entry for one agent. The system snapshots each
  // month into sales_incentives as soon as any action is taken (override /
  // mark-paid); months that haven't been actioned still show their live
  // computed totals so the timeline is continuous.
  router.get('/history/:userId', async (req, res) => {
    try {
      const actor = req.user as any
      const userId = String(req.params.userId)
      const canViewAll = await hasPermission(models, actor, 'sales_incentive.view_all')
      const myId = String(actor?.sub || actor?.id || '')
      if (!canViewAll && myId !== userId) {
        return res.status(403).json({ error: 'Not allowed to view this history' })
      }
      const target = (await models.users.findById(userId)) as any
      if (!target) return res.status(404).json({ error: 'User not found' })

      const monthsBack = Math.max(1, Math.min(36, Number(req.query.months) || 12))

      // Build the list of periods to surface: last N months (rolling) plus any
      // older months that have an explicit DB record.
      const now = new Date()
      const periodsSet = new Set<string>()
      for (let i = 0; i < monthsBack; i++) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
        periodsSet.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
      }
      const records = (await models.salesIncentives.find({ user_id: userId })) as any[]
      const recordByPeriod = new Map(records.map((r) => [String(r.period), r]))
      for (const r of records) periodsSet.add(String(r.period))

      // Sum the first-milestone sale per period for THIS user (from leads they
      // closed). Same source-of-truth as the summary endpoint.
      const revenueByAgentPeriod = await buildSaleByAgentPeriod(models)
      const myRevenueByPeriod = revenueByAgentPeriod.get(userId) || new Map<string, number>()
      for (const p of myRevenueByPeriod.keys()) periodsSet.add(p)
      // Need every user to roll up TL/Manager achievements across history. For
      // sales_agent rows this is unused; for TL/Manager the rollup walks their
      // direct reports in the period being rendered.
      const allUsers = (await models.users.find({})) as any[]
      // Also surface periods where any descendant booked revenue, so a TL/
      // Manager with no direct sales still gets a row when their team did.
      if (lower(target.role) === 'sales_tl') {
        for (const a of allUsers.filter((u) => lower(u.role) === 'sales_agent' && String(u.tl_id || '') === String(userId))) {
          const m = revenueByAgentPeriod.get(String(a.id))
          if (m) for (const p of m.keys()) periodsSet.add(p)
        }
      } else if (lower(target.role) === 'sales_manager') {
        const tls = allUsers.filter((u) => lower(u.role) === 'sales_tl' && String(u.manager_id || '') === String(userId))
        for (const tl of tls) {
          const m = revenueByAgentPeriod.get(String(tl.id))
          if (m) for (const p of m.keys()) periodsSet.add(p)
          for (const a of allUsers.filter((u) => lower(u.role) === 'sales_agent' && String(u.tl_id || '') === String(tl.id))) {
            const ma = revenueByAgentPeriod.get(String(a.id))
            if (ma) for (const p of ma.keys()) periodsSet.add(p)
          }
        }
      }

      const liveTarget = computeTargetForUser(userId, allUsers)
      const liveRate = 0 // rate is now derived from the tier the sale reaches

      // Pull every payment row for this user and bucket by period so each
      // history row can report its running paid total + payment timeline.
      const allPayments = (await models.salesIncentivePayments.find({ user_id: userId })) as any[]
      const paymentsByPeriod = new Map<string, any[]>()
      for (const p of allPayments) {
        const k = String(p.period)
        if (!paymentsByPeriod.has(k)) paymentsByPeriod.set(k, [])
        paymentsByPeriod.get(k)!.push(p)
      }

      const rows = Array.from(periodsSet)
        .filter((p) => PERIOD_RE.test(p))
        .sort((a, b) => b.localeCompare(a)) // newest first
        .map((period) => {
          const rec = recordByPeriod.get(period) || null
          // computeEffectiveAchieved needs the override record for THIS period
          // only — pull all records for the user once and key them per period.
          const recordsByUserPeriod = new Map<string, any>()
          for (const r of records) recordsByUserPeriod.set(`${userId}:${r.period}`, r)
          const eff = computeEffectiveAchieved(userId, period, allUsers, revenueByAgentPeriod, recordsByUserPeriod)
          const achievedAuto = eff.own
          const achievedOverride = eff.override
          const achieved = eff.achieved
          const target_snapshot = rec?.target_snapshot ?? liveTarget
          // Tiered incentive on the sale; displayed rate is the effective %.
          const earned = computeEarnedTiered(achieved, target_snapshot)
          const rate_snapshot = achieved > 0 ? +(earned / achieved * 100).toFixed(2) : 0
          const periodPayments = (paymentsByPeriod.get(period) || []).sort(
            (a, b) => String(b.paid_at || '').localeCompare(String(a.paid_at || '')),
          )
          const paidFromPayments = periodPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
          const legacyPaid = paidFromPayments === 0 && rec && rec.paid_amount !== undefined && rec.paid_amount !== null
            ? Number(rec.paid_amount) : 0
          const paid_amount = +(paidFromPayments + legacyPaid).toFixed(2)
          const balance = +Math.max(0, earned - paid_amount).toFixed(2)
          const fully_paid = earned > 0 && paid_amount >= earned
          return {
            user_id: userId,
            period,
            target: target_snapshot,
            incentive_rate: rate_snapshot,
            achieved_auto: achievedAuto,
            achieved_override: achievedOverride,
            achieved,
            own_achieved: eff.own,
            team_achieved: eff.team,
            earned,
            paid: fully_paid || !!rec?.paid,
            paid_at: rec?.paid_at || null,
            paid_by_name: rec?.paid_by_name || null,
            paid_amount,
            balance,
            payments: periodPayments.map((p) => ({
              id: p.id, amount: Number(p.amount), paid_at: p.paid_at,
              paid_by: p.paid_by, paid_by_name: p.paid_by_name, note: p.note || null,
            })),
            notes: rec?.notes || null,
            record_id: rec?.id || null,
            has_record: !!rec,
          }
        })

      const totals = rows.reduce((acc, r) => {
        acc.earned += r.earned
        acc.paid_amount += r.paid_amount
        acc.pending_amount += r.balance
        return acc
      }, { earned: 0, paid_amount: 0, pending_amount: 0 })

      return res.json({
        data: rows,
        rows,
        user: {
          id: target.id,
          full_name: target.full_name,
          email: target.email,
          role: target.role,
          avatar_color: target.avatar_color,
          monthly_target: liveTarget,
          incentive_rate: liveRate,
        },
        totals,
        can_override:   await hasPermission(models, actor, 'sales_incentive.override'),
        can_set_target: await hasPermission(models, actor, 'sales_incentive.set_target'),
        can_mark_paid:  await hasPermission(models, actor, 'sales_incentive.mark_paid'),
      })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  router.post('/:userId/:period/unmark-paid', async (req, res) => {
    try {
      const actor = req.user as any
      if (!(await hasPermission(models, actor, 'sales_incentive.mark_paid'))) {
        return res.status(403).json({ error: 'Not allowed to change payment status' })
      }
      const userId = String(req.params.userId)
      const period = String(req.params.period)
      if (!PERIOD_RE.test(period)) return res.status(400).json({ error: 'period must be YYYY-MM' })
      const existing = (await models.salesIncentives.findOne({ user_id: userId, period })) as any
      if (existing) {
        await models.salesIncentives.updateOne({ id: existing.id }, {
          $set: {
            paid: false,
            paid_at: null,
            paid_by: null,
            paid_by_name: null,
            paid_amount: null,
            updated_at: new Date().toISOString(),
          },
        })
      }
      return res.json({ message: 'Payment status cleared' })
    } catch (error: any) {
      return respondWithError(res, error, 500)
    }
  })

  // Silence unused-import warning when ROLES.ADMIN is not directly referenced.
  void ROLES

  return router
}
