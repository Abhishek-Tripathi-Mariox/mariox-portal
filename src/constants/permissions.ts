// ───────────────────────────────────────────────────────────────────
// Permission Catalogue
// ───────────────────────────────────────────────────────────────────
// Each permission key follows the pattern <module>.<action>.
// Roles store an array of these keys. The frontend reads the catalogue
// to render the Roles & Permissions UI; the backend uses the same keys
// when adding permission-aware route guards.
// ───────────────────────────────────────────────────────────────────

export type PermissionKey = string

export interface PermissionEntry {
  key: PermissionKey
  label: string
  description?: string
}

export interface PermissionGroup {
  module: string
  label: string
  icon: string
  permissions: PermissionEntry[]
}

export const PERMISSION_CATALOGUE: PermissionGroup[] = [
  {
    module: 'projects',
    label: 'Projects',
    icon: 'fa-folder-open',
    permissions: [
      { key: 'projects.create',             label: 'Create projects' },
      { key: 'projects.view_all',           label: 'View all projects' },
      { key: 'projects.edit',               label: 'Edit projects' },
      { key: 'projects.delete',             label: 'Delete projects' },
      { key: 'projects.manage_team',        label: 'Assign / remove developers' },
      { key: 'projects.manage_kanban_perms',label: 'Manage Kanban permissions' },
    ],
  },
  {
    module: 'sprints',
    label: 'Sprints & Milestones',
    icon: 'fa-bolt',
    permissions: [
      { key: 'sprints.create',    label: 'Create sprints' },
      { key: 'sprints.edit',      label: 'Edit sprints' },
      { key: 'sprints.delete',    label: 'Delete sprints' },
      { key: 'milestones.create', label: 'Create milestones' },
      { key: 'milestones.edit',   label: 'Edit milestones' },
      { key: 'milestones.delete', label: 'Delete milestones' },
    ],
  },
  {
    module: 'tasks',
    label: 'Tasks & Kanban',
    icon: 'fa-list-check',
    permissions: [
      { key: 'tasks.create',     label: 'Create tasks' },
      { key: 'tasks.edit_any',   label: 'Edit any task' },
      { key: 'tasks.edit_own',   label: 'Edit own tasks' },
      { key: 'tasks.delete',     label: 'Delete tasks' },
      { key: 'tasks.move',       label: 'Move tasks across columns' },
      { key: 'tasks.comment',    label: 'Comment on tasks' },
      { key: 'tasks.view_project', label: 'View Project Tasks tab',
        description: 'Show the "Project Tasks" entry in the sidebar.' },
      { key: 'personal_tasks.view', label: 'View My Task tab',
        description: 'Show the personal "My Task" planner in the sidebar.' },
      { key: 'personal_tasks.manage_statuses', label: 'Manage My Task statuses',
        description: 'Add / remove custom statuses for the personal "My Task" planner.' },
      { key: 'bids.view',        label: 'View Bidding tab',
        description: 'Show the Bidding (lead capture) entry in the sidebar.' },
    ],
  },
  {
    module: 'timesheets',
    label: 'Timesheets',
    icon: 'fa-clock',
    permissions: [
      { key: 'timesheets.log_own',    label: 'Log own time' },
      { key: 'timesheets.approve',    label: 'Approve timesheets' },
      { key: 'timesheets.edit_any',   label: 'Edit any timesheet' },
      { key: 'timesheets.view_team',  label: 'View team timesheets' },
      { key: 'timesheets.view_all',   label: 'View all timesheets' },
      { key: 'timesheets.delete',     label: 'Delete timesheets',
        description: 'Remove timesheet entries (admin / HR clean-up for invalid logs).' },
    ],
  },
  {
    module: 'users',
    label: 'Users / Team',
    icon: 'fa-users',
    permissions: [
      { key: 'users.create',         label: 'Add team members' },
      { key: 'users.view_all',       label: 'View all team members' },
      { key: 'users.edit',           label: 'Edit team members' },
      { key: 'users.deactivate',     label: 'Activate / deactivate users' },
      { key: 'users.delete',         label: 'Delete team members',
        description: 'Permanently remove a user record. Prefer Deactivate to preserve history; Delete is for cleanup of erroneous entries.' },
      { key: 'users.manage_roles',   label: 'Assign roles to users' },
      { key: 'team.view_overview',   label: 'View Team Overview tab',
        description: 'Show the admin "Team Overview" sidebar entry.' },
      { key: 'team.view_external',   label: 'View External Team tab',
        description: 'Show the admin "External Team" sidebar entry.' },
      { key: 'team.view_sales',      label: 'View Sales Team directory',
        description: 'Show the "Sales Team" entry under the Sales / CRM section.' },
      { key: 'team.view_project',    label: 'View Project Team directory',
        description: 'Show the "Project Team" entry under the Project Management section.' },
      { key: 'team.view_dev',        label: 'View Dev Team directory',
        description: 'Show the "Dev Team" entry under My Workspace.' },
      { key: 'team.view_hr',         label: 'View HR Team directory',
        description: 'Show the "HR Team" entry under HR.' },
    ],
  },
  {
    module: 'clients',
    label: 'Clients',
    icon: 'fa-building',
    permissions: [
      { key: 'clients.create',     label: 'Create clients' },
      { key: 'clients.view_all',   label: 'View all clients' },
      { key: 'clients.edit',       label: 'Edit clients' },
      { key: 'clients.delete',     label: 'Delete clients' },
      { key: 'clients.view_price', label: 'View client deal price',
        description: 'See and edit the price/value on each client. Admin and PM see it by default.' },
    ],
  },
  {
    module: 'invoices',
    label: 'Invoices & Billing',
    icon: 'fa-file-invoice-dollar',
    permissions: [
      { key: 'invoices.create',     label: 'Create invoices' },
      { key: 'invoices.view_all',   label: 'View all invoices' },
      { key: 'invoices.send',       label: 'Send invoices to clients' },
      { key: 'invoices.mark_paid',  label: 'Mark invoices paid' },
      { key: 'invoices.delete',     label: 'Delete invoices' },
    ],
  },
  {
    module: 'tickets',
    label: 'Support Tickets',
    icon: 'fa-life-ring',
    permissions: [
      { key: 'tickets.create',          label: 'Create tickets' },
      { key: 'tickets.view_all',        label: 'View all tickets' },
      { key: 'tickets.assign',          label: 'Assign tickets' },
      { key: 'tickets.delete',          label: 'Delete tickets' },
      { key: 'tickets.internal_notes',  label: 'Add internal notes' },
    ],
  },
  {
    module: 'documents',
    label: 'Documents',
    icon: 'fa-file-lines',
    permissions: [
      { key: 'documents.upload',    label: 'Upload documents' },
      { key: 'documents.view_all',  label: 'View all documents' },
      { key: 'documents.delete',    label: 'Delete documents' },
    ],
  },
  {
    module: 'reports',
    label: 'Dashboards & Reports',
    icon: 'fa-chart-line',
    permissions: [
      { key: 'reports.view_admin_dashboard',label: 'View admin dashboard' },
      { key: 'reports.view_pm_dashboard',   label: 'View PM dashboard' },
      { key: 'reports.view_resources',      label: 'View resource utilization' },
      { key: 'reports.export',              label: 'Export reports' },
      { key: 'dashboards.dev.view',         label: 'View Dev Dashboard',
        description: 'Show the developer "My Dashboard" landing page in the sidebar.' },
      { key: 'dashboards.team.view',        label: 'View Team Dashboard',
        description: 'Show the external team "Dashboard" landing page in the sidebar.' },
    ],
  },
  {
    module: 'allocations',
    label: 'Allocations',
    icon: 'fa-diagram-project',
    permissions: [
      { key: 'allocations.create', label: 'Create allocations' },
      { key: 'allocations.edit',   label: 'Edit allocations' },
      { key: 'allocations.view',   label: 'View allocations' },
      { key: 'allocations.delete', label: 'Delete allocations' },
    ],
  },
  {
    module: 'leaves',
    label: 'Leaves',
    icon: 'fa-umbrella-beach',
    permissions: [
      { key: 'leaves.create_own', label: 'Apply for leave' },
      { key: 'leaves.view_own',   label: 'View own leaves',
        description: 'See and track the leaves the user submitted themselves. Every employee with apply-for-leave should also have this.' },
      { key: 'leaves.view_all',   label: 'View all leaves',
        description: 'See every leave in the system regardless of submitter — needed by HR / approvers to review pending requests.' },
      { key: 'leaves.edit_own',   label: 'Edit own leave',
        description: 'Update a leave the user submitted themselves while it is still pending (fix dates, reason, type).' },
      { key: 'leaves.edit',       label: 'Edit any leave',
        description: 'Edit any employee\'s leave record (admin / HR correction).' },
      { key: 'leaves.approve',    label: 'Approve / reject leaves' },
      { key: 'leaves.delete_own', label: 'Withdraw own leave',
        description: 'Delete / withdraw a leave application the user submitted themselves while it is still pending.' },
      { key: 'leaves.delete_any', label: 'Delete any leave',
        description: 'Delete leave records for any employee (admin / HR clean-up).' },
    ],
  },
  {
    module: 'settings',
    label: 'Settings',
    icon: 'fa-gear',
    permissions: [
      { key: 'settings.manage_company',     label: 'Manage company settings' },
      { key: 'settings.manage_holidays',    label: 'Manage holidays' },
      { key: 'settings.manage_tech_stacks', label: 'Manage tech stacks' },
      { key: 'settings.manage_invites',     label: 'Send / manage invites' },
      { key: 'settings.manage_roles',       label: 'Manage roles & permissions' },
    ],
  },
  {
    module: 'leads',
    label: 'Leads',
    icon: 'fa-bullseye',
    permissions: [
      { key: 'leads.create',   label: 'Create leads' },
      { key: 'leads.edit_own', label: 'Edit own leads',
        description: 'Edit leads directly assigned to the user (or to subordinates for TL / Manager).' },
      { key: 'leads.edit',     label: 'Edit any lead',
        description: 'Edit every lead in the system regardless of assignment — admin grants for cross-team override.' },
      { key: 'leads.delete',   label: 'Delete leads' },
      { key: 'leads.view_own', label: 'View own leads',
        description: 'See the Leads tab and access leads assigned to me (sales agents). Sales TLs / managers see their team\'s leads.' },
      { key: 'leads.view_all', label: 'View all leads',
        description: 'See and act on every lead in the system regardless of assignee.' },
      { key: 'leads.assign_to_others', label: 'Assign leads to others',
        description: 'Show the "Assign To" picker on the New Lead form. Without this permission the lead is auto-assigned to the creator.' },
      { key: 'leads.manage_statuses', label: 'Manage lead statuses',
        description: 'Add / remove custom lead + task statuses from the "Manage Statuses" modal.' },
      { key: 'leads.manage_sources',  label: 'Manage lead sources',
        description: 'Add / remove custom lead sources from the "Manage Sources" modal.' },
      { key: 'sales.tracker.view', label: 'View Sale Tracker tab',
        description: 'Show the "Sale Tracker" entry in the sidebar.' },
    ],
  },
  {
    module: 'portfolios',
    label: 'Portfolios',
    icon: 'fa-briefcase',
    permissions: [
      { key: 'portfolios.create',     label: 'Create portfolios' },
      { key: 'portfolios.view_own',   label: 'View own portfolios',
        description: 'See portfolios the user created themselves.' },
      { key: 'portfolios.view_all',   label: 'View all portfolios',
        description: 'See every portfolio in the library regardless of author.' },
      { key: 'portfolios.edit_own',   label: 'Edit own portfolios',
        description: 'Edit only portfolios the user created.' },
      { key: 'portfolios.edit',       label: 'Edit any portfolio',
        description: 'Edit any portfolio (full access).' },
      { key: 'portfolios.delete_own', label: 'Delete own portfolios',
        description: 'Delete only portfolios the user created.' },
      { key: 'portfolios.delete',     label: 'Delete any portfolio',
        description: 'Delete any portfolio (full access).' },
      { key: 'portfolios.manage',     label: 'Manage portfolio access',
        description: 'Grant or revoke other users\' access to the Portfolio library. NAV gate for the sidebar entry.' },
    ],
  },
  {
    module: 'scopes',
    label: 'SOW (Scope of Work)',
    icon: 'fa-file-signature',
    permissions: [
      { key: 'scopes.create',     label: 'Create SOW' },
      { key: 'scopes.view_own',   label: 'View own SOWs',
        description: 'See SOWs the user created themselves.' },
      { key: 'scopes.view_all',   label: 'View all SOWs',
        description: 'See every SOW regardless of author.' },
      { key: 'scopes.edit_own',   label: 'Edit own SOWs',
        description: 'Edit only SOWs the user created.' },
      { key: 'scopes.edit',       label: 'Edit any SOW',
        description: 'Edit any SOW (full access).' },
      { key: 'scopes.delete_own', label: 'Delete own SOWs',
        description: 'Delete only SOWs the user created.' },
      { key: 'scopes.delete',     label: 'Delete any SOW',
        description: 'Delete any SOW (full access).' },
      { key: 'scopes.manage',     label: 'Manage SOW access',
        description: 'Grant or revoke other users\' access to the SOW library. NAV gate for the sidebar entry.' },
    ],
  },
  {
    module: 'quotations',
    label: 'Quotations',
    icon: 'fa-file-invoice',
    permissions: [
      { key: 'quotations.create',     label: 'Create quotations' },
      { key: 'quotations.view_own',   label: 'View own quotations',
        description: 'See quotations the user created themselves.' },
      { key: 'quotations.view_all',   label: 'View all quotations',
        description: 'See every quotation regardless of author.' },
      { key: 'quotations.edit_own',   label: 'Edit own quotations',
        description: 'Edit only quotations the user created.' },
      { key: 'quotations.edit',       label: 'Edit any quotation',
        description: 'Edit any quotation (full access).' },
      { key: 'quotations.delete_own', label: 'Delete own quotations',
        description: 'Delete only quotations the user created.' },
      { key: 'quotations.delete',     label: 'Delete any quotation',
        description: 'Delete any quotation (full access).' },
      { key: 'quotations.manage',     label: 'Manage quotation access',
        description: 'Grant or revoke other users\' access to the Quotation library. NAV gate for the sidebar entry.' },
    ],
  },
  {
    module: 'meetings',
    label: 'Meet Setup',
    icon: 'fa-video',
    permissions: [
      { key: 'meetings.create',     label: 'Schedule meetings' },
      { key: 'meetings.view_own',   label: 'View own meetings',
        description: 'See meetings the user created or is a participant in.' },
      { key: 'meetings.view_all',   label: 'View all meetings',
        description: 'See every meeting on the calendar.' },
      { key: 'meetings.edit_own',   label: 'Edit own meetings',
        description: 'Edit only meetings the user created.' },
      { key: 'meetings.edit',       label: 'Edit any meeting',
        description: 'Edit any meeting (full access).' },
      { key: 'meetings.delete_own', label: 'Delete own meetings',
        description: 'Delete only meetings the user created.' },
      { key: 'meetings.delete',     label: 'Delete any meeting',
        description: 'Delete any meeting (full access).' },
    ],
  },
  {
    module: 'hr',
    label: 'HR',
    icon: 'fa-id-badge',
    permissions: [
      { key: 'hr.attendance.manage',     label: 'Manage attendance',     description: 'Mark attendance for any employee and view the full attendance log.' },
      { key: 'hr.calendar.view',         label: 'View HR Calendar tab',  description: 'Show the HR Calendar entry in the sidebar.' },
      { key: 'hr.calendar.manage',       label: 'Manage HR calendar',    description: 'Create / delete company calendar events (holidays, training, etc.).' },
      { key: 'hr.warnings.manage',       label: 'Issue warnings',        description: 'Issue, view and delete disciplinary warnings for any employee.' },
      { key: 'hr.pips.manage',           label: 'Manage PIPs',           description: 'Create, update and close Performance Improvement Plans.' },
      { key: 'hr.salary_slips.manage',   label: 'Generate salary slips', description: 'Generate, view and delete monthly salary slips for any employee.' },
      { key: 'hr.terminations.manage',   label: 'Manage terminations',   description: 'Record offboarding details and deactivate users on completion.' },
      { key: 'hr.documents.manage',      label: 'Manage HR documents',   description: 'Generate offer letters, experience certificates, salary certificates for any employee.' },
      { key: 'hr.assets.manage',         label: 'Manage assets',         description: 'Assign / return company assets (laptops, phones, ID cards) and view the asset register.' },
    ],
  },
  {
    module: 'broadcasts',
    label: 'Broadcast',
    icon: 'fa-bullhorn',
    permissions: [
      { key: 'broadcasts.create', label: 'Create broadcast',
        description: 'Compose a new broadcast (saved as a draft until explicitly sent).' },
      { key: 'broadcasts.edit',   label: 'Edit broadcast',
        description: 'Edit a draft broadcast before it has been sent.' },
      { key: 'broadcasts.delete', label: 'Delete broadcast',
        description: 'Remove a draft or sent broadcast from the history.' },
      { key: 'broadcasts.send',   label: 'Send broadcast',
        description: 'Dispatch an existing draft — pushes the notification to every targeted user/client.' },
      { key: 'broadcasts.view',   label: 'View broadcast history',
        description: 'See the list of broadcasts with sender, targets and recipient counts.' },
    ],
  },
  {
    module: 'sales_incentive',
    label: 'Sales Incentive',
    icon: 'fa-money-bill-trend-up',
    permissions: [
      { key: 'sales_incentive.view_all',    label: 'View team incentive tracker',
        description: 'See target / achieved / earned across all sales agents.' },
      { key: 'sales_incentive.set_target',  label: 'Set monthly target & incentive rate on users',
        description: 'Configure each agent\'s monthly target and incentive rate.' },
      { key: 'sales_incentive.override',    label: 'Override achieved value for a period',
        description: 'Manually edit the achieved number when auto-calc doesn\'t fit.' },
      { key: 'sales_incentive.mark_paid',   label: 'Mark incentives as paid',
        description: 'Record that a period\'s incentive has been paid out.' },
    ],
  },
]

export const ALL_PERMISSION_KEYS: PermissionKey[] = PERMISSION_CATALOGUE.flatMap(
  (g) => g.permissions.map((p) => p.key),
)

// ───────────────────────────────────────────────────────────────────
// System role definitions — seeded on first boot, editable thereafter.
// ───────────────────────────────────────────────────────────────────

export interface SystemRoleSeed {
  key: string
  name: string
  description: string
  permissions: PermissionKey[]
}

const PM_PERMS: PermissionKey[] = [
  'projects.create', 'projects.view_all', 'projects.edit', 'projects.manage_team', 'projects.manage_kanban_perms',
  'tasks.create', 'tasks.edit_any', 'tasks.edit_own', 'tasks.delete', 'tasks.move', 'tasks.comment',
  'tasks.view_project', 'personal_tasks.view', 'personal_tasks.manage_statuses', 'bids.view',
  'timesheets.log_own', 'timesheets.approve', 'timesheets.view_team', 'timesheets.view_all',
  'users.view_all',
  'team.view_overview', 'team.view_external', 'team.view_project', 'team.view_dev', 'team.view_hr',
  'clients.create', 'clients.view_all', 'clients.edit',
  'leads.assign_to_others', 'leads.manage_statuses', 'leads.manage_sources',
  'invoices.create', 'invoices.view_all', 'invoices.send', 'invoices.mark_paid',
  'tickets.create', 'tickets.view_all', 'tickets.assign', 'tickets.internal_notes',
  'documents.upload', 'documents.view_all',
  'reports.view_pm_dashboard', 'reports.view_resources', 'reports.export',
  'sprints.create', 'sprints.edit', 'sprints.delete',
  'milestones.create', 'milestones.edit', 'milestones.delete',
  'allocations.create', 'allocations.edit', 'allocations.view', 'allocations.delete',
  'leaves.create_own', 'leaves.view_own', 'leaves.edit_own', 'leaves.edit', 'leaves.delete_own', 'leaves.approve', 'leaves.view_all', 'leaves.delete_any',
  'portfolios.create', 'portfolios.view_all', 'portfolios.edit', 'portfolios.delete',
  'scopes.create', 'scopes.view_all', 'scopes.edit', 'scopes.delete',
  'quotations.create', 'quotations.view_all', 'quotations.edit', 'quotations.delete',
  'meetings.create', 'meetings.view_all', 'meetings.edit', 'meetings.delete',
  'hr.attendance.manage', 'hr.calendar.view', 'hr.calendar.manage', 'hr.warnings.manage',
  'hr.pips.manage', 'hr.salary_slips.manage', 'hr.terminations.manage',
  'hr.documents.manage', 'hr.assets.manage',
]

const PC_PERMS: PermissionKey[] = [
  'projects.edit',
  'tasks.create', 'tasks.edit_any', 'tasks.edit_own', 'tasks.move', 'tasks.comment',
  'tasks.view_project', 'personal_tasks.view', 'personal_tasks.manage_statuses',
  'timesheets.log_own', 'timesheets.view_team',
  'users.view_all',
  'team.view_project', 'team.view_dev', 'team.view_hr',
  'clients.view_all',
  'tickets.create', 'tickets.view_all', 'tickets.assign', 'tickets.internal_notes',
  'documents.upload', 'documents.view_all',
  'reports.view_pm_dashboard',
  'sprints.create', 'sprints.edit', 'sprints.delete',
  'milestones.create', 'milestones.edit', 'milestones.delete',
  'allocations.view',
  'leaves.create_own', 'leaves.view_own', 'leaves.edit_own', 'leaves.delete_own',
  'hr.calendar.view',
]

const DEV_PERMS: PermissionKey[] = [
  'tasks.edit_own', 'tasks.move', 'tasks.comment',
  'tasks.view_project', 'personal_tasks.view',
  'dashboards.dev.view',
  'timesheets.log_own',
  'tickets.create',
  'documents.upload',
  'leaves.create_own', 'leaves.view_own', 'leaves.edit_own', 'leaves.delete_own',
  'hr.calendar.view',
]

const TEAM_PERMS: PermissionKey[] = [
  'tasks.edit_own', 'tasks.move', 'tasks.comment',
  'tasks.view_project', 'personal_tasks.view', 'bids.view',
  'dashboards.team.view',
  'team.view_dev',
  'timesheets.log_own',
  'tickets.create',
  'documents.upload',
  'leaves.create_own', 'leaves.view_own', 'leaves.edit_own', 'leaves.delete_own',
  'hr.calendar.view',
]

const SALES_AGENT_PERMS: PermissionKey[] = [
  'tasks.edit_own', 'tasks.move', 'tasks.comment',
  'tasks.view_project', 'personal_tasks.view',
  'leads.view_own', 'leads.edit_own',
  'sales.tracker.view',
  // Sales artefacts — agents see only what they created themselves. Admin
  // can flip on the *.view_all / *.edit / *.delete keys for an agent if a
  // wider scope is needed.
  'portfolios.view_own', 'portfolios.edit_own',
  'scopes.view_own', 'scopes.edit_own',
  'quotations.view_own', 'quotations.edit_own',
  'meetings.view_own', 'meetings.edit_own',
  'timesheets.log_own',
  'leaves.create_own', 'leaves.view_own', 'leaves.edit_own', 'leaves.delete_own',
  'hr.calendar.view',
]

// Sales Manager — top of the sales hierarchy. Owns the whole pipeline:
// cross-team lead visibility, library admin (portfolios / scopes /
// quotations), meeting scheduler, and FULL incentive control (set targets,
// override achieved, mark paid). Has the same self-service basics (tasks
// on own work, timesheets, leave) as everyone else.
const SALES_MANAGER_PERMS: PermissionKey[] = [
  'users.view_all',
  'team.view_sales',
  'clients.view_all',
  'leads.view_own', 'leads.view_all', 'leads.create', 'leads.edit_own', 'leads.edit', 'leads.delete', 'leads.assign_to_others', 'leads.manage_statuses', 'leads.manage_sources',
  'sales.tracker.view',
  'portfolios.create', 'portfolios.view_all', 'portfolios.edit', 'portfolios.delete',
  'scopes.create', 'scopes.view_all', 'scopes.edit', 'scopes.delete',
  'quotations.create', 'quotations.view_all', 'quotations.edit', 'quotations.delete',
  'meetings.create', 'meetings.view_all', 'meetings.edit', 'meetings.delete',
  'sales_incentive.view_all', 'sales_incentive.set_target',
  'sales_incentive.override', 'sales_incentive.mark_paid',
  'tasks.edit_own', 'tasks.move', 'tasks.comment',
  'tasks.view_project', 'personal_tasks.view',
  'timesheets.log_own',
  'leaves.create_own', 'leaves.view_own', 'leaves.edit_own', 'leaves.delete_own',
  'hr.calendar.view',
]

// Sales Team Lead — between Manager and Agent. Creates / edits sales
// artefacts but can't delete or set targets / mark payouts. Sees the team's
// incentive tracker read-only.
const SALES_TL_PERMS: PermissionKey[] = [
  'users.view_all',
  'team.view_sales',
  'clients.view_all',
  'leads.view_own', 'leads.create', 'leads.edit_own', 'leads.assign_to_others',
  'sales.tracker.view',
  'portfolios.create', 'portfolios.view_all', 'portfolios.edit_own',
  'scopes.create', 'scopes.view_all', 'scopes.edit_own',
  'quotations.create', 'quotations.view_all', 'quotations.edit_own',
  'meetings.create', 'meetings.view_all', 'meetings.edit_own',
  'sales_incentive.view_all',
  'tasks.edit_own', 'tasks.move', 'tasks.comment',
  'tasks.view_project', 'personal_tasks.view',
  'timesheets.log_own',
  'leaves.create_own', 'leaves.view_own', 'leaves.edit_own', 'leaves.delete_own',
  'hr.calendar.view',
]

// HR — owns the people-ops module. Full HR permissions plus the basic
// self-service (own tasks, log own time, apply leave) and can approve
// leaves company-wide.
const HR_PERMS: PermissionKey[] = [
  'hr.attendance.manage', 'hr.calendar.view', 'hr.calendar.manage', 'hr.warnings.manage',
  'hr.pips.manage', 'hr.salary_slips.manage', 'hr.terminations.manage',
  'hr.documents.manage', 'hr.assets.manage',
  'users.view_all',
  'team.view_hr',
  'leaves.create_own', 'leaves.view_own', 'leaves.edit_own', 'leaves.edit', 'leaves.delete_own', 'leaves.approve', 'leaves.view_all', 'leaves.delete_any',
  'tasks.edit_own', 'tasks.move', 'tasks.comment',
  'personal_tasks.view',
  'timesheets.log_own',
  'documents.upload', 'documents.view_all',
]

const CLIENT_PERMS: PermissionKey[] = [
  'tickets.create',
]

export const SYSTEM_ROLE_SEEDS: SystemRoleSeed[] = [
  {
    key: 'admin',
    name: 'Admin',
    description: 'Full system access',
    permissions: ALL_PERMISSION_KEYS,
  },
  {
    key: 'pm',
    name: 'Project Manager',
    description: 'Plans projects, manages team, handles billing',
    permissions: PM_PERMS,
  },
  {
    key: 'pc',
    name: 'Product Coordinator',
    description: 'Coordinates project execution and tickets',
    permissions: PC_PERMS,
  },
  {
    key: 'developer',
    name: 'Developer',
    description: 'In-house developer working on assigned tasks',
    permissions: DEV_PERMS,
  },
  {
    key: 'team',
    name: 'External Team',
    description: 'External collaborator on assigned projects',
    permissions: TEAM_PERMS,
  },
  {
    key: 'sales_manager',
    name: 'Sales Manager',
    description: 'Owns the sales pipeline — manages TLs, agents, targets and incentives',
    permissions: SALES_MANAGER_PERMS,
  },
  {
    key: 'sales_tl',
    name: 'Sales Team Lead',
    description: 'Leads a sales pod — creates/edits quotations & scopes, views the team incentive tracker',
    permissions: SALES_TL_PERMS,
  },
  {
    key: 'sales_agent',
    name: 'Sales Agent',
    description: 'Handles assigned leads and follow-up tasks',
    permissions: SALES_AGENT_PERMS,
  },
  {
    key: 'hr',
    name: 'HR',
    description: 'Owns people-ops — attendance, leaves, warnings, PIPs, salary slips, terminations, documents and assets',
    permissions: HR_PERMS,
  },
  {
    key: 'client',
    name: 'Client',
    description: 'External client raising tickets and viewing progress',
    permissions: CLIENT_PERMS,
  },
]
