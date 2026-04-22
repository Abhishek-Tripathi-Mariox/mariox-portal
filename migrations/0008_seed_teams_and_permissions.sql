-- ─────────────────────────────────────────────────────────────────
-- Seed 0008: Default kanban permissions + example project teams
-- ─────────────────────────────────────────────────────────────────

-- Default kanban permissions for every existing project.
-- These apply site-wide defaults:
--   admin     → full access
--   pm        → full access
--   developer → view + create + move + edit own + comment
--   client    → view + comment only
-- These can be overridden per-project via the /api/projects/:id/permissions endpoint.

-- Admin: full access on every project
INSERT OR IGNORE INTO kanban_permissions
  (id, project_id, role, can_view, can_create_task, can_edit_any_task, can_edit_own_task, can_move_task, can_delete_task, can_manage_columns, can_comment)
SELECT
  'kp-admin-' || p.id, p.id, 'admin', 1, 1, 1, 1, 1, 1, 1, 1
FROM projects p;

-- PM: full access on every project
INSERT OR IGNORE INTO kanban_permissions
  (id, project_id, role, can_view, can_create_task, can_edit_any_task, can_edit_own_task, can_move_task, can_delete_task, can_manage_columns, can_comment)
SELECT
  'kp-pm-' || p.id, p.id, 'pm', 1, 1, 1, 1, 1, 1, 1, 1
FROM projects p;

-- Developer: view + create own + edit own + move + comment (no delete, no column management)
INSERT OR IGNORE INTO kanban_permissions
  (id, project_id, role, can_view, can_create_task, can_edit_any_task, can_edit_own_task, can_move_task, can_delete_task, can_manage_columns, can_comment)
SELECT
  'kp-dev-' || p.id, p.id, 'developer', 1, 1, 0, 1, 1, 0, 0, 1
FROM projects p;

-- Client: view + comment only
INSERT OR IGNORE INTO kanban_permissions
  (id, project_id, role, can_view, can_create_task, can_edit_any_task, can_edit_own_task, can_move_task, can_delete_task, can_manage_columns, can_comment)
SELECT
  'kp-client-' || p.id, p.id, 'client', 1, 0, 0, 0, 0, 0, 0, 1
FROM projects p;

-- ─────────────────────────────────────────────────────────────────
-- Example project teams for Growniq (proj-1) and HealWin (proj-2)
-- ─────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO project_teams (id, project_id, name, description, team_lead_id, color, position, created_by)
VALUES
  ('pt-1', 'proj-1', 'Backend Squad', 'API, database, and infra work',     'user-dev-1', '#6366f1', 0, 'user-pm-1'),
  ('pt-2', 'proj-1', 'Frontend Team', 'React dashboard and UI components', 'user-dev-2', '#ec4899', 1, 'user-pm-1'),
  ('pt-3', 'proj-2', 'Mobile Team',   'React Native iOS + Android',        'user-dev-5', '#10b981', 0, 'user-pm-1'),
  ('pt-4', 'proj-2', 'Telemedicine',  'Video call and prescription flow',  'user-dev-1', '#f59e0b', 1, 'user-pm-1');

INSERT OR IGNORE INTO project_team_members (id, project_team_id, user_id, role)
VALUES
  ('ptm-1', 'pt-1', 'user-dev-1', 'lead'),
  ('ptm-2', 'pt-1', 'user-dev-4', 'member'),
  ('ptm-3', 'pt-1', 'user-dev-3', 'member'),
  ('ptm-4', 'pt-2', 'user-dev-2', 'lead'),
  ('ptm-5', 'pt-3', 'user-dev-5', 'lead'),
  ('ptm-6', 'pt-3', 'user-dev-4', 'member'),
  ('ptm-7', 'pt-4', 'user-dev-1', 'lead');

-- ─────────────────────────────────────────────────────────────────
-- Default Kanban columns seeded for every existing project
-- (Migration 0006 created the table but didn't populate it)
-- ─────────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO kanban_columns (id, project_id, name, status_key, color, position, wip_limit, is_done_column)
SELECT 'kc-' || p.id || '-backlog',     p.id, 'Backlog',     'backlog',     '#64748b', 0, 0, 0 FROM projects p
UNION ALL SELECT 'kc-' || p.id || '-todo',        p.id, 'To Do',       'todo',        '#6366f1', 1, 0, 0 FROM projects p
UNION ALL SELECT 'kc-' || p.id || '-in_progress', p.id, 'In Progress', 'in_progress', '#f59e0b', 2, 5, 0 FROM projects p
UNION ALL SELECT 'kc-' || p.id || '-in_review',   p.id, 'In Review',   'in_review',   '#8b5cf6', 3, 3, 0 FROM projects p
UNION ALL SELECT 'kc-' || p.id || '-qa',          p.id, 'QA',          'qa',          '#06b6d4', 4, 3, 0 FROM projects p;

INSERT OR IGNORE INTO kanban_columns (id, project_id, name, status_key, color, position, wip_limit, is_done_column)
SELECT 'kc-' || p.id || '-done',        p.id, 'Done',        'done',        '#10b981', 5, 0, 1 FROM projects p
UNION ALL SELECT 'kc-' || p.id || '-blocked',     p.id, 'Blocked',     'blocked',     '#ef4444', 6, 0, 0 FROM projects p;
