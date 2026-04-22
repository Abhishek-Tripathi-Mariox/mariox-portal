-- Users table (both PMs and Developers)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'developer', -- 'admin', 'pm', 'developer'
  phone TEXT,
  designation TEXT,
  tech_stack TEXT, -- JSON array
  skill_tags TEXT, -- JSON array
  joining_date TEXT,
  daily_work_hours REAL DEFAULT 8,
  working_days_per_week INTEGER DEFAULT 5,
  hourly_cost REAL DEFAULT 0,
  monthly_available_hours REAL DEFAULT 160,
  is_active INTEGER DEFAULT 1,
  reporting_pm_id TEXT,
  remarks TEXT,
  avatar_color TEXT DEFAULT '#6366f1',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Company Settings
CREATE TABLE IF NOT EXISTS company_settings (
  id TEXT PRIMARY KEY,
  company_name TEXT DEFAULT 'DevTrack Pro',
  default_daily_hours REAL DEFAULT 8,
  default_working_days INTEGER DEFAULT 22,
  fiscal_year_start TEXT DEFAULT '01-01',
  alert_threshold_hours REAL DEFAULT 0.8,
  overtime_threshold REAL DEFAULT 10,
  inactivity_days INTEGER DEFAULT 3,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Holidays
CREATE TABLE IF NOT EXISTS holidays (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  type TEXT DEFAULT 'national', -- 'national', 'optional', 'company'
  created_at TEXT DEFAULT (datetime('now'))
);

-- Leaves
CREATE TABLE IF NOT EXISTS leaves (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  leave_type TEXT NOT NULL, -- 'sick', 'casual', 'earned', 'unpaid'
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days_count REAL NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'approved', -- 'pending', 'approved', 'rejected'
  approved_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Tech Stack Master
CREATE TABLE IF NOT EXISTS tech_stacks (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  category TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  client_name TEXT,
  description TEXT,
  project_type TEXT DEFAULT 'development', -- 'development', 'maintenance', 'support', 'consulting'
  start_date TEXT NOT NULL,
  expected_end_date TEXT NOT NULL,
  priority TEXT DEFAULT 'medium', -- 'critical', 'high', 'medium', 'low'
  status TEXT DEFAULT 'active', -- 'active', 'on_hold', 'completed', 'archived', 'cancelled'
  total_allocated_hours REAL DEFAULT 0,
  estimated_budget_hours REAL DEFAULT 0,
  consumed_hours REAL DEFAULT 0,
  team_lead_id TEXT,
  pm_id TEXT,
  billable INTEGER DEFAULT 1,
  revenue REAL DEFAULT 0,
  remarks TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (team_lead_id) REFERENCES users(id),
  FOREIGN KEY (pm_id) REFERENCES users(id)
);

-- Project Assignments (Developer <-> Project)
CREATE TABLE IF NOT EXISTS project_assignments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  allocated_hours REAL DEFAULT 0,
  consumed_hours REAL DEFAULT 0,
  role TEXT DEFAULT 'developer', -- 'lead', 'developer', 'qa', 'designer'
  assigned_at TEXT DEFAULT (datetime('now')),
  is_active INTEGER DEFAULT 1,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(project_id, user_id)
);

-- Timesheets / Daily Work Logs
CREATE TABLE IF NOT EXISTS timesheets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  date TEXT NOT NULL,
  module_name TEXT,
  task_description TEXT NOT NULL,
  hours_consumed REAL NOT NULL,
  is_billable INTEGER DEFAULT 1,
  extra_hours_reason TEXT,
  status TEXT DEFAULT 'in_progress', -- 'in_progress', 'completed', 'blocked'
  blocker_remarks TEXT,
  approval_status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  pm_notes TEXT,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Alerts
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL, -- 'overload', 'burn', 'idle', 'missing_log', 'high_hours', 'delay', 'exceeded'
  severity TEXT DEFAULT 'warning', -- 'info', 'warning', 'critical'
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  user_id TEXT,
  project_id TEXT,
  is_read INTEGER DEFAULT 0,
  is_dismissed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  old_values TEXT, -- JSON
  new_values TEXT, -- JSON
  ip_address TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Notes / Comments
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  entity_type TEXT NOT NULL, -- 'project', 'developer', 'timesheet'
  entity_id TEXT NOT NULL,
  content TEXT NOT NULL,
  is_internal INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (author_id) REFERENCES users(id)
);

-- Refresh Tokens
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_timesheets_user_date ON timesheets(user_id, date);
CREATE INDEX IF NOT EXISTS idx_timesheets_project ON timesheets(project_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_approval ON timesheets(approval_status);
CREATE INDEX IF NOT EXISTS idx_project_assignments_user ON project_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_project_assignments_project ON project_assignments(project_id);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_unread ON alerts(is_read, is_dismissed);
CREATE INDEX IF NOT EXISTS idx_leaves_user ON leaves(user_id);
