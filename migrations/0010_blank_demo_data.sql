-- Migration 0010: Clear demo data and keep only the core admin account

PRAGMA foreign_keys = OFF;

DELETE FROM task_watchers;
DELETE FROM comments;
DELETE FROM client_notifications;
DELETE FROM project_updates;
DELETE FROM activity_logs;
DELETE FROM invoices;
DELETE FROM documents;
DELETE FROM tasks;
DELETE FROM milestones;
DELETE FROM sprints;
DELETE FROM project_team_members;
DELETE FROM project_teams;
DELETE FROM kanban_permissions;
DELETE FROM kanban_columns;
DELETE FROM user_invites;
DELETE FROM project_developers;
DELETE FROM project_assignments;
DELETE FROM timesheets;
DELETE FROM alerts;
DELETE FROM leaves;
DELETE FROM holidays;
DELETE FROM notes;
DELETE FROM audit_logs;
DELETE FROM refresh_tokens;
DELETE FROM clients;
DELETE FROM projects;
DELETE FROM tech_stacks;
DELETE FROM users;
DELETE FROM company_settings;

INSERT OR IGNORE INTO company_settings (
  id,
  company_name,
  default_daily_hours,
  default_working_days,
  fiscal_year_start,
  alert_threshold_hours,
  overtime_threshold,
  inactivity_days
)
VALUES (
  'settings-1',
  'DevTrack Pro',
  8,
  22,
  '01-01',
  0.8,
  10,
  3
);

INSERT OR IGNORE INTO users (
  id,
  email,
  password_hash,
  full_name,
  role,
  phone,
  designation,
  avatar_color,
  is_active
)
VALUES (
  'user-admin-mariox',
  'akash@marioxsoftware.com',
  '47dedcd885b83d15e22a6f895ce5b6dbc7ed2ebf7dfb1e0cc516a1a5a263d8e6',
  'admin',
  'admin',
  '9319009460',
  'Super Admin',
  '#6366f1',
  1
);

PRAGMA foreign_keys = ON;
