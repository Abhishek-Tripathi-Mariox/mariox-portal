-- ─────────────────────────────────────────────────────────────────
-- Migration 0006: Kanban Columns per project + Multi-dev allocation
-- ─────────────────────────────────────────────────────────────────

-- Per-project Kanban columns (PM configures these)
CREATE TABLE IF NOT EXISTS kanban_columns (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,           -- e.g. 'To Do', 'In Progress', 'UAT', 'Done'
  status_key TEXT NOT NULL,     -- maps to tasks.status: e.g. 'todo', 'in_progress', 'uat', 'done'
  color TEXT DEFAULT '#6366f1', -- hex color for column header
  position INTEGER DEFAULT 0,  -- order of column on board
  wip_limit INTEGER DEFAULT 0, -- 0 = unlimited, >0 = max tasks in this column
  is_done_column INTEGER DEFAULT 0, -- marks as completion column
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kanban_columns_project ON kanban_columns(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_columns_status ON kanban_columns(project_id, status_key);

-- Default columns seeded for existing projects (handled in JS on first board open)
-- project_developers: explicit many-to-many for quick multi-dev allocation on project
CREATE TABLE IF NOT EXISTS project_developers (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  allocated_hours REAL DEFAULT 0,
  role TEXT DEFAULT 'developer',  -- 'developer','lead','qa','designer'
  added_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, user_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_project_devs_project ON project_developers(project_id);
CREATE INDEX IF NOT EXISTS idx_project_devs_user ON project_developers(user_id);
