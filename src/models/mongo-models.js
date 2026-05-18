import { generateId } from '../utils/helpers';
function normalizeEmail(value) {
    return String(value || '').toLowerCase().trim();
}
class MongoRepository {
    collection;
    constructor(collection) {
        this.collection = collection;
    }
    get name() {
        return this.collection.collectionName;
    }
    raw() {
        return this.collection;
    }
    async findOne(filter = {}, options = {}) {
        return this.collection.findOne(filter, options);
    }
    async findById(id, options = {}) {
        return this.findOne({ id }, options);
    }
    async find(filter = {}, options = {}) {
        return this.collection.find(filter, options).toArray();
    }
    async countDocuments(filter = {}) {
        return this.collection.countDocuments(filter);
    }
    async insertOne(document) {
        return this.collection.insertOne(document);
    }
    async insertMany(documents) {
        return this.collection.insertMany(documents);
    }
    async updateOne(filter, update, options = {}) {
        return this.collection.updateOne(filter, update, options);
    }
    async updateById(id, update, options = {}) {
        return this.updateOne({ id }, update, options);
    }
    async replaceOne(filter, document, options = {}) {
        return this.collection.replaceOne(filter, document, options);
    }
    async deleteOne(filter) {
        return this.collection.deleteOne(filter);
    }
    async deleteById(id) {
        return this.deleteOne({ id });
    }
    async deleteMany(filter) {
        return this.collection.deleteMany(filter);
    }
    async updateMany(filter, update, options = {}) {
        return this.collection.updateMany(filter, update, options);
    }
    async aggregate(pipeline) {
        return this.collection.aggregate(pipeline).toArray();
    }
}
export class UserModel extends MongoRepository {
    async findByEmail(email) {
        return this.findOne({
            email: normalizeEmail(email),
        });
    }
    async findActiveByEmail(email) {
        return this.findOne({
            email: normalizeEmail(email),
            is_active: 1,
        });
    }
    async findActiveById(id, options = {}) {
        return this.findOne({
            id,
            is_active: 1,
        }, options);
    }
    async createStaff(input) {
        const now = new Date().toISOString();
        const id = input.id || generateId('user');
        const record = {
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
        };
        await this.insertOne(record);
        return record;
    }
    async updatePassword(id, passwordHash, mustChange = false) {
        return this.updateById(id, {
            $set: {
                password_hash: passwordHash,
                must_change_password: mustChange ? 1 : 0,
                updated_at: new Date().toISOString(),
            },
        });
    }
}
export class ClientModel extends MongoRepository {
    async findByEmail(email) {
        return this.findOne({
            email: normalizeEmail(email),
        });
    }
    async findActiveByEmail(email) {
        return this.findOne({
            email: normalizeEmail(email),
            is_active: 1,
        });
    }
    async createClient(input) {
        const now = new Date().toISOString();
        const id = input.id || generateId('client');
        const record = {
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
            price: input.price ?? null,
            is_active: input.is_active ?? 1,
            email_verified: input.email_verified ?? 1,
            created_at: input.created_at || now,
            updated_at: input.updated_at || now,
        };
        await this.insertOne(record);
        return record;
    }
    async updateProfile(id, patch) {
        return this.updateById(id, {
            $set: {
                ...patch,
                updated_at: new Date().toISOString(),
            },
        });
    }
}
export class MongoModels {
    db;
    users;
    clients;
    projects;
    projectAssignments;
    timesheets;
    tasks;
    comments;
    alerts;
    activityLogs;
    projectTeams;
    projectTeamMembers;
    kanbanColumns;
    kanbanPermissions;
    invoices;
    milestones;
    sprints;
    documents;
    leaves;
    holidays;
    techStacks;
    settings;
    notifications;
    supportTickets;
    supportComments;
    supportEvents;
    roles;
    userNotifications;
    projectUpdates;
    bidAuctions;
    bidSubmissions;
    leads;
    leadTasks;
    leadStatuses;
    leadTaskStatuses;
    leadSources;
    leadComments;
    leadActivities;
    leadNotes;
    portfolios;
    portfolioSends;
    portfolioPermissions;
    scopes;
    scopeSends;
    scopePermissions;
    quotations;
    quotationSends;
    quotationPermissions;
    salesIncentives;
    salesIncentivePayments;
    meetings;
    attendance;
    calendarEvents;
    warnings;
    pips;
    salarySlips;
    terminations;
    hrDocuments;
    hrAssets;
    personalTasks;
    constructor(db) {
        this.db = db;
        this.users = new UserModel(db.collection('users'));
        this.clients = new ClientModel(db.collection('clients'));
        this.projects = new MongoRepository(db.collection('projects'));
        this.projectAssignments = new MongoRepository(db.collection('project_assignments'));
        this.timesheets = new MongoRepository(db.collection('timesheets'));
        this.tasks = new MongoRepository(db.collection('tasks'));
        this.comments = new MongoRepository(db.collection('comments'));
        this.alerts = new MongoRepository(db.collection('alerts'));
        this.activityLogs = new MongoRepository(db.collection('activity_logs'));
        this.projectTeams = new MongoRepository(db.collection('project_teams'));
        this.projectTeamMembers = new MongoRepository(db.collection('project_team_members'));
        this.kanbanColumns = new MongoRepository(db.collection('kanban_columns'));
        this.kanbanPermissions = new MongoRepository(db.collection('kanban_permissions'));
        this.invoices = new MongoRepository(db.collection('invoices'));
        this.milestones = new MongoRepository(db.collection('milestones'));
        this.sprints = new MongoRepository(db.collection('sprints'));
        this.documents = new MongoRepository(db.collection('documents'));
        this.leaves = new MongoRepository(db.collection('leaves'));
        this.holidays = new MongoRepository(db.collection('holidays'));
        this.techStacks = new MongoRepository(db.collection('tech_stacks'));
        this.settings = new MongoRepository(db.collection('company_settings'));
        this.notifications = new MongoRepository(db.collection('client_notifications'));
        this.supportTickets = new MongoRepository(db.collection('support_tickets'));
        this.supportComments = new MongoRepository(db.collection('support_comments'));
        this.supportEvents = new MongoRepository(db.collection('support_events'));
        this.roles = new MongoRepository(db.collection('roles'));
        this.userNotifications = new MongoRepository(db.collection('user_notifications'));
        this.projectUpdates = new MongoRepository(db.collection('project_updates'));
        this.bidAuctions = new MongoRepository(db.collection('bid_auctions'));
        this.bidSubmissions = new MongoRepository(db.collection('bid_submissions'));
        this.leads = new MongoRepository(db.collection('leads'));
        this.leadTasks = new MongoRepository(db.collection('lead_tasks'));
        this.leadStatuses = new MongoRepository(db.collection('lead_statuses'));
        this.leadTaskStatuses = new MongoRepository(db.collection('lead_task_statuses'));
        this.leadSources = new MongoRepository(db.collection('lead_sources'));
        this.leadComments = new MongoRepository(db.collection('lead_comments'));
        this.leadActivities = new MongoRepository(db.collection('lead_activities'));
        this.leadNotes = new MongoRepository(db.collection('lead_notes'));
        this.portfolios = new MongoRepository(db.collection('portfolios'));
        this.portfolioSends = new MongoRepository(db.collection('portfolio_sends'));
        this.portfolioPermissions = new MongoRepository(db.collection('portfolio_permissions'));
        this.scopes = new MongoRepository(db.collection('scopes'));
        this.scopeSends = new MongoRepository(db.collection('scope_sends'));
        this.scopePermissions = new MongoRepository(db.collection('scope_permissions'));
        this.quotations = new MongoRepository(db.collection('quotations'));
        this.quotationSends = new MongoRepository(db.collection('quotation_sends'));
        this.quotationPermissions = new MongoRepository(db.collection('quotation_permissions'));
        this.salesIncentives = new MongoRepository(db.collection('sales_incentives'));
        this.salesIncentivePayments = new MongoRepository(db.collection('sales_incentive_payments'));
        this.meetings = new MongoRepository(db.collection('meetings'));
        this.attendance = new MongoRepository(db.collection('attendance'));
        this.calendarEvents = new MongoRepository(db.collection('calendar_events'));
        this.warnings = new MongoRepository(db.collection('warnings'));
        this.pips = new MongoRepository(db.collection('pips'));
        this.salarySlips = new MongoRepository(db.collection('salary_slips'));
        this.terminations = new MongoRepository(db.collection('terminations'));
        this.hrDocuments = new MongoRepository(db.collection('hr_documents'));
        this.hrAssets = new MongoRepository(db.collection('hr_assets'));
        this.personalTasks = new MongoRepository(db.collection('personal_tasks'));
    }
    get rawDb() {
        return this.db;
    }
}
export function createMongoModels(db) {
    return new MongoModels(db);
}
