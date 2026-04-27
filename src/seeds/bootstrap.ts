import type { MongoModels, UserRecord } from '../models/mongo-models'

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
}
