import type { MongoModels, UserRecord } from '../models/mongo-models'
import { SYSTEM_ROLE_SEEDS } from '../constants/permissions'

const LEAD_STATUS_SEEDS = [
  { key: 'new',       label: 'New',       badge: 'todo',       position: 0 },
  { key: 'contacted', label: 'Contacted', badge: 'inprogress', position: 1 },
  { key: 'qualified', label: 'Qualified', badge: 'review',     position: 2 },
  { key: 'converted', label: 'Converted', badge: 'done',       position: 3 },
  { key: 'lost',      label: 'Lost',      badge: 'critical',   position: 4 },
  { key: 'closed',    label: 'Deal Close', badge: 'done',      position: 5 },
]

const LEAD_TASK_STATUS_SEEDS = [
  { key: 'pending',     label: 'Pending',     badge: 'todo',       position: 0 },
  { key: 'in_progress', label: 'In Progress', badge: 'inprogress', position: 1 },
  { key: 'done',        label: 'Done',        badge: 'done',       position: 2 },
  { key: 'skipped',     label: 'Skipped',     badge: 'critical',   position: 3 },
  { key: 'follow_up',   label: 'Follow Up',   badge: 'review',     position: 4 },
]

const LEAD_SOURCE_SEEDS = [
  { key: 'ppc',       label: 'PPC',       position: 0 },
  { key: 'seo',       label: 'SEO',       position: 1 },
  { key: 'referral',  label: 'Referral',  position: 2 },
  { key: 'website',   label: 'Website',   position: 3 },
  { key: 'other',     label: 'Other',     position: 4 },
]

async function hashPassword(password: string, salt: string) {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + salt)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

function envString(env: Record<string, unknown>, key: string) {
  const value = env[key]
  return typeof value === 'string' ? value.trim() : ''
}

async function ensureAdminUser(
  models: MongoModels,
  passwordSalt: string,
  config: {
    email: string
    password: string
    fullName: string
    phone: string
    userId: string
  },
) {
  const existing = await models.users.findByEmail(config.email) as UserRecord | null
  if (existing) return existing

  const now = new Date().toISOString()
  const password_hash = await hashPassword(config.password, passwordSalt)
  const adminUser: UserRecord = {
    id: config.userId,
    email: config.email,
    password_hash,
    full_name: config.fullName,
    role: 'admin',
    phone: config.phone || null,
    designation: 'Administrator',
    tech_stack: null,
    skill_tags: null,
    joining_date: null,
    daily_work_hours: 8,
    working_days_per_week: 5,
    hourly_cost: 0,
    monthly_available_hours: 160,
    reporting_pm_id: null,
    avatar_color: '#9D6CFF',
    remarks: 'Seeded admin account',
    is_active: 1,
    created_at: now,
    updated_at: now,
  }

  await models.users.insertOne(adminUser)
  return adminUser
}

export async function bootstrapSeed(models: MongoModels, runtimeEnv: Record<string, unknown>) {
  const passwordSalt = envString(runtimeEnv, 'PASSWORD_SALT')
  if (!passwordSalt) {
    console.warn('[bootstrap] PASSWORD_SALT is not set — skipping admin seed')
    return
  }

  const adminEmail = envString(runtimeEnv, 'ADMIN_EMAIL').toLowerCase()
  const adminPassword = envString(runtimeEnv, 'ADMIN_PASSWORD')
  if (!adminEmail || !adminPassword) {
    console.warn('[bootstrap] ADMIN_EMAIL or ADMIN_PASSWORD is not set — skipping admin seed')
    return
  }

  const config = {
    email: adminEmail,
    password: adminPassword,
    fullName: envString(runtimeEnv, 'ADMIN_FULL_NAME') || 'Administrator',
    phone: envString(runtimeEnv, 'ADMIN_PHONE'),
    userId: envString(runtimeEnv, 'ADMIN_USER_ID') || 'user-admin-main',
  }

  await ensureAdminUser(models, passwordSalt, config)
  console.log(`[bootstrap] Admin seed ensured for ${adminEmail}`)

  await ensureSystemRoles(models)
  await ensureLeadStatuses(models)
  await ensureLeadSources(models)
}

async function ensureLeadStatuses(models: MongoModels) {
  const now = new Date().toISOString()
  for (const seed of LEAD_STATUS_SEEDS) {
    const existing = await models.leadStatuses.findOne({ key: seed.key }) as any
    if (existing) {
      // Backfill: if we changed a system label in code (e.g. Closed → Deal
      // Close), older DBs still have the old label sitting on disk. Update
      // it in place — but only on system rows so we don't trample over a
      // label admin renamed via the Settings UI.
      if (existing.is_system === 1 && existing.label !== seed.label) {
        await models.leadStatuses.updateById(String(existing.id), {
          $set: { label: seed.label, updated_at: now },
        })
      }
      continue
    }
    await models.leadStatuses.insertOne({
      id: `lead-status-${seed.key}`,
      ...seed,
      is_system: 1,
      created_at: now,
      updated_at: now,
    })
  }
  for (const seed of LEAD_TASK_STATUS_SEEDS) {
    const existing = await models.leadTaskStatuses.findOne({ key: seed.key })
    if (existing) continue
    await models.leadTaskStatuses.insertOne({
      id: `lead-task-status-${seed.key}`,
      ...seed,
      is_system: 1,
      created_at: now,
      updated_at: now,
    })
  }
  console.log('[bootstrap] Lead/task statuses seeded')
}

async function ensureLeadSources(models: MongoModels) {
  const now = new Date().toISOString()
  for (const seed of LEAD_SOURCE_SEEDS) {
    const existing = await models.leadSources.findOne({ key: seed.key })
    if (existing) continue
    await models.leadSources.insertOne({
      id: `lead-source-${seed.key}`,
      ...seed,
      is_system: 1,
      created_at: now,
      updated_at: now,
    })
  }
  console.log('[bootstrap] Lead sources seeded')
}

// View-only permission keys introduced when the sidebar was made fully
// permission-gated. We backfill these onto existing system roles so an
// upgrade doesn't suddenly hide their default tabs — but we DON'T touch
// any other keys (admin may have customized the manage permissions on
// the role and we don't want to undo that).
//
// Also includes the new ownership-scoped *.view_own / *.view_all / *.edit_own
// keys for portfolios / scopes / quotations / meetings so an upgrade doesn't
// suddenly hide a sales user's existing tabs — the seed defaults take effect
// for every existing role record that didn't already have these grants.
const VIEW_ONLY_PERMISSION_KEYS = new Set<string>([
  'tasks.view_project',
  'personal_tasks.view',
  'personal_tasks.manage_statuses',
  'bids.view',
  'leads.view_own',
  'leads.assign_to_others',
  'leads.manage_statuses', 'leads.manage_sources',
  'leaves.delete_own', 'leaves.delete_any',
  'sales.tracker.view',
  'dashboards.dev.view',
  'dashboards.team.view',
  'team.view_overview',
  'team.view_external',
  'team.view_sales',
  'team.view_project',
  'team.view_dev',
  'team.view_hr',
  'hr.calendar.view',
  // Ownership-scoped artefact permissions (backfilled from seeds).
  'portfolios.view_own', 'portfolios.view_all', 'portfolios.edit_own',
  'scopes.view_own', 'scopes.view_all', 'scopes.edit_own',
  'quotations.view_own', 'quotations.view_all', 'quotations.edit_own',
  'meetings.view_own', 'meetings.view_all', 'meetings.edit_own',
])

async function ensureSystemRoles(models: MongoModels) {
  const now = new Date().toISOString()
  for (const seed of SYSTEM_ROLE_SEEDS) {
    const existing = await models.roles.findOne({ key: seed.key }) as any
    if (existing) {
      // Backfill description / name on system roles. We keep this narrow so
      // admin-managed custom roles stay untouched, but we do remove the old
      // projects.view_all grant from the pc system role because project
      // visibility is now scope-based.
      const patch: Record<string, unknown> = { is_system: 1, updated_at: now }
      if (!existing.name) patch.name = seed.name
      if (!existing.description) patch.description = seed.description
      if (!Array.isArray(existing.permissions)) patch.permissions = seed.permissions
      if (Array.isArray(existing.permissions)) {
        // Strip the legacy pc.projects.view_all grant (kept from earlier
        // migration), then merge in any NEW view-only keys from the seed
        // so the upgrade preserves admin's existing tab visibility.
        const current = new Set<string>(
          existing.permissions
            .map((p: unknown) => String(p))
            .filter((p: string) => p && !(existing.key === 'pc' && p === 'projects.view_all')),
        )
        let mutated = existing.key === 'pc' && !current.has('projects.view_all')
          ? current.size !== existing.permissions.length
          : false
        for (const key of seed.permissions) {
          if (VIEW_ONLY_PERMISSION_KEYS.has(key) && !current.has(key)) {
            current.add(key)
            mutated = true
          }
        }
        if (mutated) patch.permissions = Array.from(current)
      }
      await models.roles.updateById(existing.id, { $set: patch })
      continue
    }
    await models.roles.insertOne({
      id: `role-${seed.key}`,
      key: seed.key,
      name: seed.name,
      description: seed.description,
      is_system: 1,
      permissions: seed.permissions,
      created_at: now,
      updated_at: now,
    })
  }
  console.log(`[bootstrap] System roles seeded (${SYSTEM_ROLE_SEEDS.length})`)
}
