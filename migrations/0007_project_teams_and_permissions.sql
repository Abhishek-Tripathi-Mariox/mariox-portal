-- ─────────────────────────────────────────────────────────────────
-- Migration 0007: Per-project teams + Kanban permissions + Invites
-- ─────────────────────────────────────────────────────────────────

-- Per-project teams (e.g. "Backend Squad", "Mobile Team" within Project X)
CREATE TABLE IF NOT EXISTS project_teams (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  team_lead_id TEXT,                    -- user id of the team lead
  color TEXT DEFAULT '#6366f1',
  position INTEGER DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (team_lead_id) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_project_teams_project ON project_teams(project_id);

-- Members of a project-team (a dev can belong to multiple teams within the same project)
CREATE TABLE IF NOT EXISTS project_team_members (
  id TEXT PRIMARY KEY,
  project_team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT DEFAULT 'member',           -- 'lead','member','qa','designer'
  added_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_team_id) REFERENCES project_teams(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(project_team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ptm_team ON project_team_members(project_team_id);
CREATE INDEX IF NOT EXISTS idx_ptm_user ON project_team_members(user_id);

-- Tag assignments with an optional project_team_id so hours can be grouped by team
ALTER TABLE project_assignments ADD COLUMN project_team_id TEXT REFERENCES project_teams(id);

-- Tag tasks with an optional project_team_id for team-scoped kanban swimlanes
ALTER TABLE tasks ADD COLUMN project_team_id TEXT REFERENCES project_teams(id);

-- ─────────────────────────────────────────────────────────────────
-- Kanban per-project permission matrix
-- Controls who can do what on each project's board
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kanban_permissions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  role TEXT NOT NULL,                   -- 'pm','admin','developer','client'
  can_view INTEGER DEFAULT 1,
  can_create_task INTEGER DEFAULT 0,
  can_edit_any_task INTEGER DEFAULT 0,
  can_edit_own_task INTEGER DEFAULT 0,
  can_move_task INTEGER DEFAULT 0,
  can_delete_task INTEGER DEFAULT 0,
  can_manage_columns INTEGER DEFAULT 0,
  can_comment INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(project_id, role),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kanban_perms_project ON kanban_permissions(project_id);

-- ─────────────────────────────────────────────────────────────────
-- One-time invite tokens for developer account setup
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_invites (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL,                   -- 'developer','pm'
  token TEXT UNIQUE NOT NULL,
  invited_by TEXT NOT NULL,
  accepted_at TEXT,
  expires_at TEXT NOT NULL,
  user_id TEXT,                         -- populated when accepted
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (invited_by) REFERENCES users(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_invites_token ON user_invites(token);
CREATE INDEX IF NOT EXISTS idx_invites_email ON user_invites(email);

-- Force-password-change flag for first login
ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0;
