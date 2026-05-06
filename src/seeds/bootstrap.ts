import type { MongoModels, UserRecord } from '../models/mongo-models'
import { SYSTEM_ROLE_SEEDS } from '../constants/permissions'

const LEAD_STATUS_SEEDS = [
  { key: 'new',       label: 'New',       badge: 'todo',       position: 0 },
  { key: 'contacted', label: 'Contacted', badge: 'inprogress', position: 1 },
  { key: 'qualified', label: 'Qualified', badge: 'review',     position: 2 },
  { key: 'converted', label: 'Converted', badge: 'done',       position: 3 },
  { key: 'lost',      label: 'Lost',      badge: 'critical',   position: 4 },
  { key: 'closed',    label: 'Closed',    badge: 'done',       position: 5 },
]

const LEAD_TASK_STATUS_SEEDS = [
  { key: 'pending',     label: 'Pending',     badge: 'todo',       position: 0 },
  { key: 'in_progress', label: 'In Progress', badge: 'inprogress', position: 1 },
  { key: 'done',        label: 'Done',        badge: 'done',       position: 2 },
  { key: 'skipped',     label: 'Skipped',     badge: 'critical',   position: 3 },
  { key: 'follow_up',   label: 'Follow Up',   badge: 'review',     position: 4 },
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
    avatar_color: '#6366f1',
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
}

async function ensureLeadStatuses(models: MongoModels) {
  const now = new Date().toISOString()
  for (const seed of LEAD_STATUS_SEEDS) {
    const existing = await models.leadStatuses.findOne({ key: seed.key })
    if (existing) continue
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

async function ensureSystemRoles(models: MongoModels) {
  const now = new Date().toISOString()
  for (const seed of SYSTEM_ROLE_SEEDS) {
    const existing = await models.roles.findOne({ key: seed.key }) as any
    if (existing) {
      // Backfill description / name on system roles, but never overwrite the
      // permissions admin has tweaked through the UI.
      const patch: Record<string, unknown> = { is_system: 1, updated_at: now }
      if (!existing.name) patch.name = seed.name
      if (!existing.description) patch.description = seed.description
      if (!Array.isArray(existing.permissions)) patch.permissions = seed.permissions
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
