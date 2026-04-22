-- Migration 0003: Enterprise Extension
-- Adds: clients, tasks, sprints, milestones, documents, invoices, comments, activity_logs, task_watchers

-- ─────────────────────────────────────────
-- CLIENTS TABLE (separate from users)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  phone TEXT,
  website TEXT,
  address TEXT,
  industry TEXT,
  logo_url TEXT,
  avatar_color TEXT DEFAULT '#0ea5e9',
  is_active INTEGER DEFAULT 1,
  email_verified INTEGER DEFAULT 1,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────
-- PROJECT ↔ CLIENT MAPPING
-- ─────────────────────────────────────────
ALTER TABLE projects ADD COLUMN client_id TEXT REFERENCES clients(id);
ALTER TABLE projects ADD COLUMN client_visible INTEGER DEFAULT 1;
ALTER TABLE projects ADD COLUMN completion_pct REAL DEFAULT 0;
ALTER TABLE projects ADD COLUMN contract_value REAL DEFAULT 0;
ALTER TABLE projects ADD COLUMN currency TEXT DEFAULT 'INR';
ALTER TABLE projects ADD COLUMN project_logo TEXT;
ALTER TABLE projects ADD COLUMN tech_stack TEXT; -- JSON array

-- ─────────────────────────────────────────
-- MILESTONES
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_date TEXT NOT NULL,
  completion_pct REAL DEFAULT 0,
  status TEXT DEFAULT 'pending', -- 'pending','in_progress','completed','delayed'
  deliverables TEXT, -- JSON array
  is_billable INTEGER DEFAULT 0,
  invoice_amount REAL DEFAULT 0,
  client_visible INTEGER DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- ─────────────────────────────────────────
-- SPRINTS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sprints (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  goal TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT DEFAULT 'planning', -- 'planning','active','completed','cancelled'
  velocity INTEGER DEFAULT 0,
  total_story_points INTEGER DEFAULT 0,
  completed_story_points INTEGER DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- ─────────────────────────────────────────
-- TASKS / TICKETS (JIRA-style)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  sprint_id TEXT,
  parent_task_id TEXT, -- for subtasks
  title TEXT NOT NULL,
  description TEXT,
  task_type TEXT DEFAULT 'task', -- 'task','story','bug','epic','sub_task'
  status TEXT DEFAULT 'backlog', -- 'backlog','todo','in_progress','in_review','qa','done','blocked'
  priority TEXT DEFAULT 'medium', -- 'critical','high','medium','low'
  assignee_id TEXT,
  reporter_id TEXT NOT NULL,
  story_points INTEGER DEFAULT 0,
  estimated_hours REAL DEFAULT 0,
  logged_hours REAL DEFAULT 0,
  due_date TEXT,
  completed_at TEXT,
  labels TEXT, -- JSON array
  attachments TEXT, -- JSON array of {name,url,size}
  is_client_visible INTEGER DEFAULT 1,
  is_billable INTEGER DEFAULT 1,
  position INTEGER DEFAULT 0, -- for ordering within column
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (sprint_id) REFERENCES sprints(id),
  FOREIGN KEY (parent_task_id) REFERENCES tasks(id),
  FOREIGN KEY (assignee_id) REFERENCES users(id),
  FOREIGN KEY (reporter_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_sprint ON tasks(sprint_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);

-- ─────────────────────────────────────────
-- TASK WATCHERS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_watchers (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  user_id TEXT,
  client_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

-- ─────────────────────────────────────────
-- COMMENTS (tasks, projects, documents)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL, -- 'task','project','document','invoice'
  entity_id TEXT NOT NULL,
  author_user_id TEXT, -- if internal user
  author_client_id TEXT, -- if client
  content TEXT NOT NULL,
  attachments TEXT, -- JSON array
  is_internal INTEGER DEFAULT 0, -- internal-only flag
  parent_comment_id TEXT, -- for threaded replies
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (author_user_id) REFERENCES users(id),
  FOREIGN KEY (author_client_id) REFERENCES clients(id),
  FOREIGN KEY (parent_comment_id) REFERENCES comments(id)
);

CREATE INDEX IF NOT EXISTS idx_comments_entity ON comments(entity_type, entity_id);

-- ─────────────────────────────────────────
-- DOCUMENTS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'other', -- 'sow','brd','frd','uiux','wireframes','meeting_notes','technical','test_report','release','billing','contract','other'
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size INTEGER DEFAULT 0,
  file_type TEXT,
  version TEXT DEFAULT '1.0',
  uploaded_by TEXT NOT NULL,
  visibility TEXT DEFAULT 'all', -- 'all','internal','client_hidden'
  is_client_visible INTEGER DEFAULT 1,
  download_count INTEGER DEFAULT 0,
  tags TEXT, -- JSON array
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);

-- ─────────────────────────────────────────
-- INVOICES / BILLING
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  invoice_number TEXT UNIQUE NOT NULL,
  project_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  milestone_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'INR',
  tax_pct REAL DEFAULT 18,
  tax_amount REAL DEFAULT 0,
  total_amount REAL NOT NULL,
  status TEXT DEFAULT 'pending', -- 'pending','sent','partially_paid','paid','overdue','cancelled'
  due_date TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  paid_date TEXT,
  paid_amount REAL DEFAULT 0,
  transaction_ref TEXT,
  file_url TEXT,
  notes TEXT,
  payment_terms TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (milestone_id) REFERENCES milestones(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_invoices_project ON invoices(project_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

-- ─────────────────────────────────────────
-- ACTIVITY LOG (unified feed)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  entity_type TEXT NOT NULL, -- 'task','project','document','invoice','sprint','milestone','timesheet'
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL, -- 'created','updated','deleted','status_changed','commented','assigned','uploaded','approved','rejected'
  actor_user_id TEXT,
  actor_client_id TEXT,
  actor_name TEXT NOT NULL,
  actor_role TEXT,
  old_value TEXT,
  new_value TEXT,
  metadata TEXT, -- JSON for extra info
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (actor_user_id) REFERENCES users(id),
  FOREIGN KEY (actor_client_id) REFERENCES clients(id)
);

CREATE INDEX IF NOT EXISTS idx_activity_project ON activity_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_logs(entity_type, entity_id);

-- ─────────────────────────────────────────
-- PROJECT UPDATES (PM posts to client)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_updates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  update_type TEXT DEFAULT 'general', -- 'general','milestone','blocker','delivery','status'
  is_client_visible INTEGER DEFAULT 1,
  posted_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (posted_by) REFERENCES users(id)
);

-- ─────────────────────────────────────────
-- TASK ↔ TIMESHEET LINK
-- ─────────────────────────────────────────
ALTER TABLE timesheets ADD COLUMN task_id TEXT REFERENCES tasks(id);
ALTER TABLE timesheets ADD COLUMN sprint_id TEXT REFERENCES sprints(id);

-- ─────────────────────────────────────────
-- CLIENT NOTIFICATIONS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS client_notifications (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  project_id TEXT,
  type TEXT NOT NULL, -- 'invoice','document','task_update','project_update','milestone'
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- ─────────────────────────────────────────
-- INDEXES (extra performance)
-- ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_sprints_project ON sprints(project_id);
CREATE INDEX IF NOT EXISTS idx_project_updates_project ON project_updates(project_id);
CREATE INDEX IF NOT EXISTS idx_client_notifications_client ON client_notifications(client_id, is_read);
