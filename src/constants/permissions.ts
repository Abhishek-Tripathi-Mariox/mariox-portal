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
      { key: 'users.manage_roles',   label: 'Assign roles to users' },
    ],
  },
  {
    module: 'clients',
    label: 'Clients',
    icon: 'fa-building',
    permissions: [
      { key: 'clients.create',  label: 'Create clients' },
      { key: 'clients.view_all',label: 'View all clients' },
      { key: 'clients.edit',    label: 'Edit clients' },
      { key: 'clients.delete',  label: 'Delete clients' },
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
    ],
  },
  {
    module: 'leaves',
    label: 'Leaves',
    icon: 'fa-umbrella-beach',
    permissions: [
      { key: 'leaves.create_own', label: 'Apply for leave' },
      { key: 'leaves.approve',    label: 'Approve / reject leaves' },
      { key: 'leaves.view_all',   label: 'View all leaves' },
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
    module: 'sales_library',
    label: 'Sales Library (Portfolio / SOW / Quotation)',
    icon: 'fa-briefcase',
    permissions: [
      { key: 'portfolios.manage', label: 'Add / edit / delete portfolios',
        description: 'Maintain entries in the Portfolio library and send them to leads.' },
      { key: 'scopes.manage',     label: 'Add / edit / delete SOW (Scope of Work)',
        description: 'Maintain entries in the Scope of Work library and send them to leads.' },
      { key: 'quotations.manage', label: 'Add / edit / delete quotations',
        description: 'Maintain entries in the Quotation library and send them to leads.' },
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
  'timesheets.log_own', 'timesheets.approve', 'timesheets.view_team', 'timesheets.view_all',
  'users.view_all',
  'clients.create', 'clients.view_all', 'clients.edit',
  'invoices.create', 'invoices.view_all', 'invoices.send', 'invoices.mark_paid',
  'tickets.create', 'tickets.view_all', 'tickets.assign', 'tickets.internal_notes',
  'documents.upload', 'documents.view_all',
  'reports.view_pm_dashboard', 'reports.view_resources', 'reports.export',
  'allocations.create', 'allocations.edit', 'allocations.view',
  'leaves.create_own', 'leaves.approve', 'leaves.view_all',
  'portfolios.manage', 'scopes.manage', 'quotations.manage',
]

const PC_PERMS: PermissionKey[] = [
  'projects.view_all', 'projects.edit',
  'tasks.create', 'tasks.edit_any', 'tasks.edit_own', 'tasks.move', 'tasks.comment',
  'timesheets.log_own', 'timesheets.view_team',
  'users.view_all',
  'clients.view_all',
  'tickets.create', 'tickets.view_all', 'tickets.assign', 'tickets.internal_notes',
  'documents.upload', 'documents.view_all',
  'reports.view_pm_dashboard',
  'allocations.view',
  'leaves.create_own',
]

const DEV_PERMS: PermissionKey[] = [
  'tasks.edit_own', 'tasks.move', 'tasks.comment',
  'timesheets.log_own',
  'tickets.create',
  'documents.upload',
  'leaves.create_own',
]

const TEAM_PERMS: PermissionKey[] = [
  'tasks.edit_own', 'tasks.move', 'tasks.comment',
  'timesheets.log_own',
  'tickets.create',
  'documents.upload',
  'leaves.create_own',
]

const SALES_AGENT_PERMS: PermissionKey[] = [
  'tasks.edit_own', 'tasks.move', 'tasks.comment',
  'timesheets.log_own',
  'leaves.create_own',
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
    key: 'sales_agent',
    name: 'Sales Agent',
    description: 'Handles assigned leads and follow-up tasks',
    permissions: SALES_AGENT_PERMS,
  },
  {
    key: 'client',
    name: 'Client',
    description: 'External client raising tickets and viewing progress',
    permissions: CLIENT_PERMS,
  },
]
