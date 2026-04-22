-- Seed Data for DevTrack Pro

-- Insert Company Settings
INSERT OR IGNORE INTO company_settings (id, company_name, default_daily_hours, default_working_days) 
VALUES ('settings-1', 'DevTrack Pro', 8, 22);

-- Insert Admin User (password: Admin@123)
INSERT OR IGNORE INTO users (id, email, password_hash, full_name, role, designation, daily_work_hours, working_days_per_week, monthly_available_hours, avatar_color, is_active)
VALUES (
  'user-admin-1',
  'admin@devtrack.com',
  'b31ff3674597530af005e01390bf9abef626b643feba59f4506c4ee57693c036',
  'Super Admin',
  'admin',
  'CTO',
  8, 5, 160,
  '#6366f1',
  1
);

-- Insert PM Users (password: Password@123)
INSERT OR IGNORE INTO users (id, email, password_hash, full_name, role, designation, phone, daily_work_hours, working_days_per_week, monthly_available_hours, avatar_color, hourly_cost, is_active)
VALUES 
(
  'user-pm-1',
  'sarah.pm@devtrack.com',
  'e1f9ef5e1e7f2481fc1bdbfcb2c71dfe2293c8404bd6c9a70e7c7fd2afbb8673',
  'Sarah Mitchell',
  'pm',
  'Project Manager',
  '+91-9876543210',
  8, 5, 160,
  '#0ea5e9',
  1500,
  1
),
(
  'user-pm-2',
  'james.pm@devtrack.com',
  'e1f9ef5e1e7f2481fc1bdbfcb2c71dfe2293c8404bd6c9a70e7c7fd2afbb8673',
  'James Rodriguez',
  'pm',
  'Senior PM',
  '+91-9876543211',
  8, 5, 160,
  '#10b981',
  1800,
  1
);

-- Insert Developer Users
INSERT OR IGNORE INTO users (id, email, password_hash, full_name, role, designation, phone, tech_stack, skill_tags, daily_work_hours, working_days_per_week, monthly_available_hours, avatar_color, hourly_cost, reporting_pm_id, joining_date, is_active)
VALUES 
(
  'user-dev-1',
  'rahul@devtrack.com',
  'e1f9ef5e1e7f2481fc1bdbfcb2c71dfe2293c8404bd6c9a70e7c7fd2afbb8673',
  'Rahul Sharma',
  'developer',
  'Senior Backend Developer',
  '+91-9876543212',
  '["Node.js","React","PostgreSQL","Redis"]',
  '["Backend","API","Database"]',
  8, 5, 160,
  '#f59e0b',
  700,
  'user-pm-1',
  '2022-03-15',
  1
),
(
  'user-dev-2',
  'priya@devtrack.com',
  'e1f9ef5e1e7f2481fc1bdbfcb2c71dfe2293c8404bd6c9a70e7c7fd2afbb8673',
  'Priya Patel',
  'developer',
  'Frontend Developer',
  '+91-9876543213',
  '["React","TypeScript","Tailwind CSS","Next.js"]',
  '["Frontend","UI/UX","Mobile"]',
  8, 5, 160,
  '#ec4899',
  650,
  'user-pm-1',
  '2022-06-01',
  1
),
(
  'user-dev-3',
  'amit@devtrack.com',
  'e1f9ef5e1e7f2481fc1bdbfcb2c71dfe2293c8404bd6c9a70e7c7fd2afbb8673',
  'Amit Kumar',
  'developer',
  'Full Stack Developer',
  '+91-9876543214',
  '["React","Node.js","MongoDB","AWS"]',
  '["Fullstack","DevOps","Cloud"]',
  8, 5, 160,
  '#8b5cf6',
  750,
  'user-pm-2',
  '2021-11-20',
  1
),
(
  'user-dev-4',
  'neha@devtrack.com',
  'e1f9ef5e1e7f2481fc1bdbfcb2c71dfe2293c8404bd6c9a70e7c7fd2afbb8673',
  'Neha Singh',
  'developer',
  'QA Engineer',
  '+91-9876543215',
  '["Selenium","Cypress","Jest","Python"]',
  '["QA","Testing","Automation"]',
  8, 5, 160,
  '#14b8a6',
  550,
  'user-pm-1',
  '2023-01-10',
  1
),
(
  'user-dev-5',
  'arjun@devtrack.com',
  'e1f9ef5e1e7f2481fc1bdbfcb2c71dfe2293c8404bd6c9a70e7c7fd2afbb8673',
  'Arjun Mehta',
  'developer',
  'Mobile Developer',
  '+91-9876543216',
  '["React Native","Flutter","iOS","Android"]',
  '["Mobile","iOS","Android"]',
  8, 5, 160,
  '#f97316',
  800,
  'user-pm-2',
  '2022-09-05',
  1
),
(
  'user-dev-6',
  'divya@devtrack.com',
  'e1f9ef5e1e7f2481fc1bdbfcb2c71dfe2293c8404bd6c9a70e7c7fd2afbb8673',
  'Divya Nair',
  'developer',
  'Backend Developer',
  '+91-9876543217',
  '["Python","Django","FastAPI","PostgreSQL"]',
  '["Backend","API","ML"]',
  8, 5, 160,
  '#06b6d4',
  680,
  'user-pm-2',
  '2023-04-15',
  1
);

-- Insert Projects
INSERT OR IGNORE INTO projects (id, name, code, client_name, description, project_type, start_date, expected_end_date, priority, status, total_allocated_hours, estimated_budget_hours, consumed_hours, team_lead_id, pm_id, billable, revenue, remarks)
VALUES
(
  'proj-1',
  'Growniq Platform',
  'GRW-001',
  'Growniq Technologies',
  'Enterprise SaaS platform for business growth analytics and reporting',
  'development',
  '2025-01-15',
  '2025-06-30',
  'critical',
  'active',
  800, 850, 580,
  'user-dev-1',
  'user-pm-1',
  1,
  1200000,
  'High priority client - needs weekly updates'
),
(
  'proj-2',
  'HealWin Mobile App',
  'HLW-002',
  'HealWin Healthcare',
  'Patient management and telemedicine mobile application',
  'development',
  '2025-02-01',
  '2025-07-31',
  'high',
  'active',
  500, 520, 210,
  'user-dev-5',
  'user-pm-1',
  1,
  800000,
  'React Native + Backend integration'
),
(
  'proj-3',
  'Kavach QR System',
  'KVQ-003',
  'Kavach Security',
  'QR code based security and access management system',
  'development',
  '2025-01-01',
  '2025-04-30',
  'high',
  'active',
  320, 300, 285,
  'user-dev-3',
  'user-pm-2',
  1,
  600000,
  'Nearly complete - final testing phase'
),
(
  'proj-4',
  'RetailEdge Dashboard',
  'RED-004',
  'RetailEdge Inc',
  'Real-time retail analytics and inventory management dashboard',
  'maintenance',
  '2024-10-01',
  '2025-12-31',
  'medium',
  'active',
  200, 220, 145,
  'user-dev-2',
  'user-pm-2',
  1,
  450000,
  'Ongoing maintenance and feature additions'
),
(
  'proj-5',
  'InnovateTech Portal',
  'ITP-005',
  'InnovateTech Corp',
  'Internal employee portal and HR management system',
  'development',
  '2025-03-01',
  '2025-09-30',
  'medium',
  'active',
  600, 580, 85,
  'user-dev-1',
  'user-pm-1',
  1,
  950000,
  'Phase 1 kick-off complete'
),
(
  'proj-6',
  'DataFlow Pipeline',
  'DFP-006',
  'DataFlow Solutions',
  'ETL pipeline and data warehouse migration project',
  'consulting',
  '2024-12-01',
  '2025-05-31',
  'low',
  'on_hold',
  150, 160, 90,
  'user-dev-6',
  'user-pm-2',
  1,
  300000,
  'On hold due to client infrastructure issues'
);

-- Insert Project Assignments
INSERT OR IGNORE INTO project_assignments (id, project_id, user_id, allocated_hours, consumed_hours, role)
VALUES
-- Growniq
('pa-1', 'proj-1', 'user-dev-1', 300, 240, 'lead'),
('pa-2', 'proj-1', 'user-dev-2', 200, 180, 'developer'),
('pa-3', 'proj-1', 'user-dev-4', 150, 100, 'developer'),
('pa-4', 'proj-1', 'user-dev-3', 150, 60, 'developer'),
-- HealWin
('pa-5', 'proj-2', 'user-dev-5', 250, 120, 'lead'),
('pa-6', 'proj-2', 'user-dev-1', 150, 55, 'developer'),
('pa-7', 'proj-2', 'user-dev-4', 100, 35, 'developer'),
-- Kavach QR
('pa-8', 'proj-3', 'user-dev-3', 180, 165, 'lead'),
('pa-9', 'proj-3', 'user-dev-6', 140, 120, 'developer'),
-- RetailEdge
('pa-10', 'proj-4', 'user-dev-2', 120, 95, 'lead'),
('pa-11', 'proj-4', 'user-dev-6', 80, 50, 'developer'),
-- InnovateTech
('pa-12', 'proj-5', 'user-dev-1', 200, 40, 'lead'),
('pa-13', 'proj-5', 'user-dev-2', 200, 30, 'developer'),
('pa-14', 'proj-5', 'user-dev-3', 200, 15, 'developer'),
-- DataFlow
('pa-15', 'proj-6', 'user-dev-6', 150, 90, 'lead');

-- Insert Holidays
INSERT OR IGNORE INTO holidays (id, name, date, type) VALUES
('hol-1', 'New Year Day', '2025-01-01', 'national'),
('hol-2', 'Republic Day', '2025-01-26', 'national'),
('hol-3', 'Holi', '2025-03-14', 'national'),
('hol-4', 'Good Friday', '2025-04-18', 'national'),
('hol-5', 'Independence Day', '2025-08-15', 'national'),
('hol-6', 'Gandhi Jayanti', '2025-10-02', 'national'),
('hol-7', 'Diwali', '2025-10-20', 'national'),
('hol-8', 'Christmas', '2025-12-25', 'national');

-- Insert Leaves
INSERT OR IGNORE INTO leaves (id, user_id, leave_type, start_date, end_date, days_count, reason, status)
VALUES
('lv-1', 'user-dev-1', 'sick', '2025-03-05', '2025-03-06', 2, 'Fever and cold', 'approved'),
('lv-2', 'user-dev-2', 'casual', '2025-03-10', '2025-03-10', 1, 'Personal work', 'approved'),
('lv-3', 'user-dev-5', 'earned', '2025-02-24', '2025-02-28', 5, 'Family vacation', 'approved'),
('lv-4', 'user-dev-3', 'casual', '2025-03-15', '2025-03-15', 1, 'Doctor appointment', 'approved');

-- Insert Tech Stacks Master
INSERT OR IGNORE INTO tech_stacks (id, name, category) VALUES
('ts-1', 'React', 'Frontend'),
('ts-2', 'Vue.js', 'Frontend'),
('ts-3', 'Angular', 'Frontend'),
('ts-4', 'Next.js', 'Frontend'),
('ts-5', 'TypeScript', 'Language'),
('ts-6', 'JavaScript', 'Language'),
('ts-7', 'Python', 'Language'),
('ts-8', 'Node.js', 'Backend'),
('ts-9', 'Express.js', 'Backend'),
('ts-10', 'NestJS', 'Backend'),
('ts-11', 'Django', 'Backend'),
('ts-12', 'FastAPI', 'Backend'),
('ts-13', 'PostgreSQL', 'Database'),
('ts-14', 'MySQL', 'Database'),
('ts-15', 'MongoDB', 'Database'),
('ts-16', 'Redis', 'Database'),
('ts-17', 'React Native', 'Mobile'),
('ts-18', 'Flutter', 'Mobile'),
('ts-19', 'AWS', 'Cloud'),
('ts-20', 'Docker', 'DevOps'),
('ts-21', 'Kubernetes', 'DevOps'),
('ts-22', 'Tailwind CSS', 'Frontend');

-- Insert Sample Timesheets (last 30 days)
INSERT OR IGNORE INTO timesheets (id, user_id, project_id, date, module_name, task_description, hours_consumed, is_billable, status, approval_status)
VALUES
('ts-log-1', 'user-dev-1', 'proj-1', date('now', '-1 day'), 'API Development', 'Implemented REST API for user authentication module', 7, 1, 'completed', 'approved'),
('ts-log-2', 'user-dev-1', 'proj-2', date('now', '-1 day'), 'Backend', 'Fixed bug in patient data sync service', 1, 1, 'completed', 'approved'),
('ts-log-3', 'user-dev-2', 'proj-1', date('now', '-1 day'), 'Dashboard UI', 'Built analytics dashboard components with charts', 8, 1, 'completed', 'approved'),
('ts-log-4', 'user-dev-3', 'proj-3', date('now', '-1 day'), 'QR Scanner', 'Integrated QR scanner with access control system', 7, 1, 'completed', 'approved'),
('ts-log-5', 'user-dev-4', 'proj-1', date('now', '-1 day'), 'Testing', 'E2E testing for authentication flow', 6, 1, 'completed', 'approved'),
('ts-log-6', 'user-dev-5', 'proj-2', date('now', '-1 day'), 'Mobile UI', 'Built patient profile screen and appointment booking', 8, 1, 'in_progress', 'pending'),
('ts-log-7', 'user-dev-6', 'proj-3', date('now', '-1 day'), 'Database', 'Optimized database queries for QR validation', 5, 1, 'completed', 'approved'),
('ts-log-8', 'user-dev-1', 'proj-1', date('now', '-2 day'), 'API Development', 'Developed project management API endpoints', 8, 1, 'completed', 'approved'),
('ts-log-9', 'user-dev-2', 'proj-4', date('now', '-2 day'), 'Frontend', 'Implemented real-time inventory tracking UI', 7, 1, 'completed', 'approved'),
('ts-log-10', 'user-dev-3', 'proj-3', date('now', '-2 day'), 'Testing', 'Unit testing for access control module', 6, 1, 'completed', 'approved'),
('ts-log-11', 'user-dev-1', 'proj-5', date('now', '-3 day'), 'Architecture', 'System architecture design and documentation', 6, 1, 'completed', 'approved'),
('ts-log-12', 'user-dev-2', 'proj-1', date('now', '-3 day'), 'Dashboard UI', 'Responsive layout implementation for reports', 8, 1, 'completed', 'approved'),
('ts-log-13', 'user-dev-4', 'proj-2', date('now', '-3 day'), 'Testing', 'Mobile app testing on different devices', 5, 1, 'completed', 'approved'),
('ts-log-14', 'user-dev-5', 'proj-2', date('now', '-3 day'), 'Mobile UI', 'Telemedicine video call UI implementation', 8, 1, 'completed', 'approved'),
('ts-log-15', 'user-dev-6', 'proj-4', date('now', '-4 day'), 'Backend', 'API integration for retail data sync', 7, 1, 'completed', 'approved');

-- Insert Alerts
INSERT OR IGNORE INTO alerts (id, type, severity, title, message, user_id, project_id)
VALUES
('alert-1', 'burn', 'warning', 'Growniq Hours Near Exhaustion', 'Project Growniq has consumed 72.5% of allocated hours with 35% timeline remaining', NULL, 'proj-1'),
('alert-2', 'overload', 'warning', 'Rahul Over-Allocated', 'Rahul Sharma is allocated 650h against 160h monthly capacity', 'user-dev-1', NULL),
('alert-3', 'burn', 'critical', 'Kavach QR Critical', 'Project Kavach QR has consumed 89% of allocated hours', NULL, 'proj-3'),
('alert-4', 'idle', 'info', 'Divya Underutilized', 'Divya Nair has logged only 90 hours this month against 160h capacity', 'user-dev-6', NULL),
('alert-5', 'delay', 'warning', 'DataFlow Project On Hold', 'DataFlow Pipeline project has been inactive for more than 3 days', NULL, 'proj-6');
