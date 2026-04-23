-- Seed 0009: New Mariox admin account
-- Password: mariox@123

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
