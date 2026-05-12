import type {
  Collection,
  Db,
  Document,
  Filter,
  ReplaceOptions,
  UpdateFilter,
  UpdateOptions,
} from 'mongodb'
import { generateId } from '../utils/helpers'

type AnyObject = Record<string, any>

function normalizeEmail(value: string) {
  return String(value || '').toLowerCase().trim()
}

export interface BaseRecord extends Document {
  id: string
  created_at?: string
  updated_at?: string
}

export interface UserRecord extends BaseRecord {
  email: string
  password_hash: string
  full_name: string
  role: string
  phone?: string | null
  designation?: string | null
  tech_stack?: unknown
  skill_tags?: unknown
  joining_date?: string | null
  daily_work_hours?: number
  working_days_per_week?: number
  hourly_cost?: number
  monthly_available_hours?: number
  // Sales-incentive configuration (sales roles): the agent's monthly target
  // and per-unit incentive rate paid on achievement above target.
  monthly_target?: number
  incentive_rate?: number
  reporting_pm_id?: string | null
  // Sales hierarchy: TLs report to a manager, agents report to a TL.
  // Required for sales_tl (manager_id) and sales_agent (tl_id); ignored for other roles.
  manager_id?: string | null
  tl_id?: string | null
  avatar_color?: string
  remarks?: string | null
  is_active?: number
  // 1 = the user is on a system-issued password (just created or admin reset)
  // and must change it on next login. Cleared once they pick their own.
  must_change_password?: number
}

export interface ClientRecord extends BaseRecord {
  email: string
  password_hash: string
  company_name: string
  contact_name: string
  phone?: string | null
  website?: string | null
  industry?: string | null
  gstin?: string | null
  address_line?: string | null
  city?: string | null
  state?: string | null
  state_code?: string | null
  pincode?: string | null
  country?: string | null
  avatar_color?: string
  is_active?: number
  email_verified?: number
}

class MongoRepository<T extends Document = Document> {
  constructor(protected readonly collection: Collection<T>) {}

  get name() {
    return this.collection.collectionName
  }

  raw() {
    return this.collection
  }

  async findOne(filter: AnyObject = {}, options: AnyObject = {}) {
    return this.collection.findOne(filter as Filter<T>, options)
  }

  async findById(id: string, options: AnyObject = {}) {
    return this.findOne({ id }, options)
  }

  async find(filter: AnyObject = {}, options: AnyObject = {}) {
    return this.collection.find(filter as Filter<T>, options).toArray()
  }

  async countDocuments(filter: AnyObject = {}) {
    return this.collection.countDocuments(filter as Filter<T>)
  }

  async insertOne(document: AnyObject) {
    return this.collection.insertOne(document as any)
  }

  async insertMany(documents: AnyObject[]) {
    return this.collection.insertMany(documents as any)
  }

  async updateOne(filter: AnyObject, update: AnyObject, options: UpdateOptions = {}) {
    return this.collection.updateOne(filter as Filter<T>, update as UpdateFilter<T>, options)
  }

  async updateById(id: string, update: AnyObject, options: UpdateOptions = {}) {
    return this.updateOne({ id }, update, options)
  }

  async replaceOne(filter: AnyObject, document: AnyObject, options: ReplaceOptions = {}) {
    return this.collection.replaceOne(filter as Filter<T>, document as T, options)
  }

  async deleteOne(filter: AnyObject) {
    return this.collection.deleteOne(filter as Filter<T>)
  }

  async deleteById(id: string) {
    return this.deleteOne({ id })
  }

  async deleteMany(filter: AnyObject) {
    return this.collection.deleteMany(filter as Filter<T>)
  }

  async updateMany(filter: AnyObject, update: AnyObject, options: UpdateOptions = {}) {
    return this.collection.updateMany(filter as Filter<T>, update as UpdateFilter<T>, options)
  }

  async aggregate<R extends Document = Document>(pipeline: Document[]) {
    return this.collection.aggregate<R>(pipeline as Document[]).toArray()
  }
}

export class UserModel extends MongoRepository<UserRecord> {
  async findByEmail(email: string) {
    return this.findOne({
      email: normalizeEmail(email),
    })
  }

  async findActiveByEmail(email: string) {
    return this.findOne({
      email: normalizeEmail(email),
      is_active: 1,
    })
  }

  async findActiveById(id: string, options: AnyObject = {}) {
    return this.findOne({
      id,
      is_active: 1,
    }, options)
  }

  async createStaff(input: Partial<UserRecord> & Pick<UserRecord, 'email' | 'password_hash' | 'full_name' | 'role'>) {
    const now = new Date().toISOString()
    const id = input.id || generateId('user')
    const record: UserRecord = {
      id,
      email: normalizeEmail(input.email),
      password_hash: input.password_hash,
      full_name: String(input.full_name || '').trim(),
      role: String(input.role || '').trim().toLowerCase(),
      phone: input.phone ?? null,
      designation: input.designation ?? null,
      tech_stack: input.tech_stack ?? null,
      skill_tags: input.skill_tags ?? null,
      joining_date: input.joining_date ?? null,
      daily_work_hours: input.daily_work_hours ?? 8,
      working_days_per_week: input.working_days_per_week ?? 5,
      hourly_cost: input.hourly_cost ?? 0,
      monthly_available_hours: input.monthly_available_hours ?? 160,
      reporting_pm_id: input.reporting_pm_id ?? null,
      manager_id: input.manager_id ?? null,
      tl_id: input.tl_id ?? null,
      avatar_color: input.avatar_color || '#6366f1',
      remarks: input.remarks ?? null,
      is_active: input.is_active ?? 1,
      // New staff accounts always start with a forced password change so
      // admin-issued temporary passwords can't linger as the real one.
      must_change_password: input.must_change_password ?? 1,
      created_at: input.created_at || now,
      updated_at: input.updated_at || now,
    }

    await this.insertOne(record)
    return record
  }

  async updatePassword(id: string, passwordHash: string, mustChange = false) {
    return this.updateById(id, {
      $set: {
        password_hash: passwordHash,
        must_change_password: mustChange ? 1 : 0,
        updated_at: new Date().toISOString(),
      },
    })
  }
}

export class ClientModel extends MongoRepository<ClientRecord> {
  async findByEmail(email: string) {
    return this.findOne({
      email: normalizeEmail(email),
    })
  }

  async findActiveByEmail(email: string) {
    return this.findOne({
      email: normalizeEmail(email),
      is_active: 1,
    })
  }

  async createClient(input: Partial<ClientRecord> & Pick<ClientRecord, 'email' | 'password_hash' | 'company_name' | 'contact_name'>) {
    const now = new Date().toISOString()
    const id = input.id || generateId('client')
    const record: ClientRecord = {
      id,
      email: normalizeEmail(input.email),
      password_hash: input.password_hash,
      company_name: String(input.company_name || '').trim(),
      contact_name: String(input.contact_name || '').trim(),
      phone: input.phone ?? null,
      website: input.website ?? null,
      industry: input.industry ?? null,
      gstin: input.gstin ?? null,
      address_line: input.address_line ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      state_code: input.state_code ?? null,
      pincode: input.pincode ?? null,
      country: input.country ?? null,
      avatar_color: input.avatar_color || '#6366f1',
      is_active: input.is_active ?? 1,
      email_verified: input.email_verified ?? 1,
      created_at: input.created_at || now,
      updated_at: input.updated_at || now,
    }

    await this.insertOne(record)
    return record
  }

  async updateProfile(id: string, patch: Partial<ClientRecord>) {
    return this.updateById(id, {
      $set: {
        ...patch,
        updated_at: new Date().toISOString(),
      },
    })
  }
}

export class MongoModels {
  readonly users: UserModel
  readonly clients: ClientModel
  readonly projects: MongoRepository
  readonly projectAssignments: MongoRepository
  readonly timesheets: MongoRepository
  readonly tasks: MongoRepository
  readonly comments: MongoRepository
  readonly alerts: MongoRepository
  readonly activityLogs: MongoRepository
  readonly projectTeams: MongoRepository
  readonly projectTeamMembers: MongoRepository
  readonly kanbanColumns: MongoRepository
  readonly kanbanPermissions: MongoRepository
  readonly invoices: MongoRepository
  readonly milestones: MongoRepository
  readonly sprints: MongoRepository
  readonly documents: MongoRepository
  readonly leaves: MongoRepository
  readonly holidays: MongoRepository
  readonly techStacks: MongoRepository
  readonly settings: MongoRepository
  readonly notifications: MongoRepository
  readonly supportTickets: MongoRepository
  readonly supportComments: MongoRepository
  readonly supportEvents: MongoRepository
  readonly roles: MongoRepository
  readonly userNotifications: MongoRepository
  readonly projectUpdates: MongoRepository
  readonly bidAuctions: MongoRepository
  readonly bidSubmissions: MongoRepository
  readonly leads: MongoRepository
  readonly leadTasks: MongoRepository
  readonly leadStatuses: MongoRepository
  readonly leadTaskStatuses: MongoRepository
  readonly leadSources: MongoRepository
  readonly leadComments: MongoRepository
  readonly leadActivities: MongoRepository
  readonly leadNotes: MongoRepository
  readonly portfolios: MongoRepository
  readonly portfolioSends: MongoRepository
  readonly portfolioPermissions: MongoRepository
  readonly scopes: MongoRepository
  readonly scopeSends: MongoRepository
  readonly scopePermissions: MongoRepository
  readonly quotations: MongoRepository
  readonly quotationSends: MongoRepository
  readonly quotationPermissions: MongoRepository
  readonly salesIncentives: MongoRepository

  constructor(private readonly db: Db) {
    this.users = new UserModel(db.collection<UserRecord>('users'))
    this.clients = new ClientModel(db.collection<ClientRecord>('clients'))
    this.projects = new MongoRepository(db.collection('projects'))
    this.projectAssignments = new MongoRepository(db.collection('project_assignments'))
    this.timesheets = new MongoRepository(db.collection('timesheets'))
    this.tasks = new MongoRepository(db.collection('tasks'))
    this.comments = new MongoRepository(db.collection('comments'))
    this.alerts = new MongoRepository(db.collection('alerts'))
    this.activityLogs = new MongoRepository(db.collection('activity_logs'))
    this.projectTeams = new MongoRepository(db.collection('project_teams'))
    this.projectTeamMembers = new MongoRepository(db.collection('project_team_members'))
    this.kanbanColumns = new MongoRepository(db.collection('kanban_columns'))
    this.kanbanPermissions = new MongoRepository(db.collection('kanban_permissions'))
    this.invoices = new MongoRepository(db.collection('invoices'))
    this.milestones = new MongoRepository(db.collection('milestones'))
    this.sprints = new MongoRepository(db.collection('sprints'))
    this.documents = new MongoRepository(db.collection('documents'))
    this.leaves = new MongoRepository(db.collection('leaves'))
    this.holidays = new MongoRepository(db.collection('holidays'))
    this.techStacks = new MongoRepository(db.collection('tech_stacks'))
    this.settings = new MongoRepository(db.collection('company_settings'))
    this.notifications = new MongoRepository(db.collection('client_notifications'))
    this.supportTickets = new MongoRepository(db.collection('support_tickets'))
    this.supportComments = new MongoRepository(db.collection('support_comments'))
    this.supportEvents = new MongoRepository(db.collection('support_events'))
    this.roles = new MongoRepository(db.collection('roles'))
    this.userNotifications = new MongoRepository(db.collection('user_notifications'))
    this.projectUpdates = new MongoRepository(db.collection('project_updates'))
    this.bidAuctions = new MongoRepository(db.collection('bid_auctions'))
    this.bidSubmissions = new MongoRepository(db.collection('bid_submissions'))
    this.leads = new MongoRepository(db.collection('leads'))
    this.leadTasks = new MongoRepository(db.collection('lead_tasks'))
    this.leadStatuses = new MongoRepository(db.collection('lead_statuses'))
    this.leadTaskStatuses = new MongoRepository(db.collection('lead_task_statuses'))
    this.leadSources = new MongoRepository(db.collection('lead_sources'))
    this.leadComments = new MongoRepository(db.collection('lead_comments'))
    this.leadActivities = new MongoRepository(db.collection('lead_activities'))
    this.leadNotes = new MongoRepository(db.collection('lead_notes'))
    this.portfolios = new MongoRepository(db.collection('portfolios'))
    this.portfolioSends = new MongoRepository(db.collection('portfolio_sends'))
    this.portfolioPermissions = new MongoRepository(db.collection('portfolio_permissions'))
    this.scopes = new MongoRepository(db.collection('scopes'))
    this.scopeSends = new MongoRepository(db.collection('scope_sends'))
    this.scopePermissions = new MongoRepository(db.collection('scope_permissions'))
    this.quotations = new MongoRepository(db.collection('quotations'))
    this.quotationSends = new MongoRepository(db.collection('quotation_sends'))
    this.quotationPermissions = new MongoRepository(db.collection('quotation_permissions'))
    this.salesIncentives = new MongoRepository(db.collection('sales_incentives'))
  }

  get rawDb() {
    return this.db
  }
}

export function createMongoModels(db: Db) {
  return new MongoModels(db)
}
