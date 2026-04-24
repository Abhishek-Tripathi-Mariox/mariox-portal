// ───────────────────────────────────────────────────────────────────
// Application Constants
// ───────────────────────────────────────────────────────────────────

// Roles & Permissions
export const ROLES = {
  ADMIN: 'admin',
  PM: 'pm',
  PC: 'pc',
  DEVELOPER: 'developer',
  TEAM: 'team',
  CLIENT: 'client',
} as const

export const ADMIN_ROLES = [ROLES.ADMIN]
export const PM_ROLES = [ROLES.ADMIN, ROLES.PM, ROLES.PC]
export const DEV_ROLES = [ROLES.ADMIN, ROLES.PM, ROLES.PC, ROLES.DEVELOPER, ROLES.TEAM]

export const USER_ROLES = [
  ROLES.ADMIN,
  ROLES.PM,
  ROLES.PC,
  ROLES.DEVELOPER,
  ROLES.TEAM,
  ROLES.CLIENT,
] as const

// Roles that can be created through the internal staff creation flows
export const STAFF_CREATE_ROLES = [
  ROLES.PM,
  ROLES.PC,
  ROLES.TEAM,
  ROLES.DEVELOPER,
] as const

// Project Status
export const PROJECT_STATUS = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
  ON_HOLD: 'on_hold',
} as const

// Task Status / Kanban Columns
export const TASK_STATUS = {
  BACKLOG: 'backlog',
  TODO: 'todo',
  IN_PROGRESS: 'in_progress',
  IN_REVIEW: 'in_review',
  QA: 'qa',
  DONE: 'done',
  BLOCKED: 'blocked',
} as const

// Default Kanban Columns
export const DEFAULT_KANBAN_COLUMNS = [
  { name: 'Backlog', status_key: 'backlog', color: '#64748b', position: 0, wip_limit: 0, is_done_column: 0 },
  { name: 'To Do', status_key: 'todo', color: '#6366f1', position: 1, wip_limit: 0, is_done_column: 0 },
  { name: 'In Progress', status_key: 'in_progress', color: '#f59e0b', position: 2, wip_limit: 5, is_done_column: 0 },
  { name: 'In Review', status_key: 'in_review', color: '#8b5cf6', position: 3, wip_limit: 3, is_done_column: 0 },
  { name: 'QA', status_key: 'qa', color: '#06b6d4', position: 4, wip_limit: 3, is_done_column: 0 },
  { name: 'Done', status_key: 'done', color: '#10b981', position: 5, wip_limit: 0, is_done_column: 1 },
  { name: 'Blocked', status_key: 'blocked', color: '#ef4444', position: 6, wip_limit: 0, is_done_column: 0 },
]

// Avatar Colors
export const AVATAR_COLORS = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#f97316'
]

// Priority Levels
export const PRIORITY_LEVELS = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const

// Document Categories
export const DOC_CATEGORIES = [
  'sow', 'brd', 'frd', 'uiux', 'wireframes', 'meeting_notes',
  'technical', 'test_report', 'release', 'billing', 'contract', 'other'
] as const

// HTTP Status Codes
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
} as const

// Error Messages
export const ERROR_MESSAGES = {
  UNAUTHORIZED: 'Unauthorized access',
  FORBIDDEN: 'Insufficient permissions',
  NOT_FOUND: 'Resource not found',
  INVALID_INPUT: 'Invalid input provided',
  DUPLICATE: 'Resource already exists',
  SERVER_ERROR: 'Internal server error',
  INVALID_CREDENTIALS: 'Invalid email or password',
  TOKEN_EXPIRED: 'Token has expired',
  INVALID_TOKEN: 'Invalid token',
} as const
