-- Migration 0005: Fix password hashes to use SHA-256 (devtrack-salt-2025)
-- SHA-256('Admin@123' + 'devtrack-salt-2025')   = b31ff3674597530af005e01390bf9abef626b643feba59f4506c4ee57693c036
-- SHA-256('Password@123' + 'devtrack-salt-2025') = e1f9ef5e1e7f2481fc1bdbfcb2c71dfe2293c8404bd6c9a70e7c7fd2afbb8673

-- Update admin user password
UPDATE users SET password_hash = 'b31ff3674597530af005e01390bf9abef626b643feba59f4506c4ee57693c036'
WHERE email = 'admin@devtrack.com';

-- Update all PM and Developer users
UPDATE users SET password_hash = 'e1f9ef5e1e7f2481fc1bdbfcb2c71dfe2293c8404bd6c9a70e7c7fd2afbb8673'
WHERE email IN (
  'sarah.pm@devtrack.com',
  'james.pm@devtrack.com',
  'rahul@devtrack.com',
  'priya@devtrack.com',
  'amit@devtrack.com',
  'neha@devtrack.com',
  'arjun@devtrack.com',
  'divya@devtrack.com'
);

-- Update client users if any
UPDATE users SET password_hash = 'e1f9ef5e1e7f2481fc1bdbfcb2c71dfe2293c8404bd6c9a70e7c7fd2afbb8673'
WHERE role = 'client';

-- Update all clients in the clients table (client portal logins)
UPDATE clients SET password_hash = 'e1f9ef5e1e7f2481fc1bdbfcb2c71dfe2293c8404bd6c9a70e7c7fd2afbb8673'
WHERE password_hash LIKE '$2a$%';
