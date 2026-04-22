-- Seed 0004: Enterprise data — clients, tasks, sprints, milestones, invoices, documents, activity

-- ─────────────────────────────────────────
-- CLIENTS
-- ─────────────────────────────────────────
INSERT OR IGNORE INTO clients (id, email, password_hash, company_name, contact_name, phone, website, industry, avatar_color, is_active)
VALUES
('client-1','admin@growniq.com','e1f9ef5e1e7f2481fc1bdbfcb2c71dfe2293c8404bd6c9a70e7c7fd2afbb8673','Growniq Technologies','Vikram Nair','+91-9800000001','https://growniq.in','SaaS / Analytics','#6366f1',1),
('client-2','admin@healwin.com','e1f9ef5e1e7f2481fc1bdbfcb2c71dfe2293c8404bd6c9a70e7c7fd2afbb8673','HealWin Healthcare','Dr. Ananya Rao','+91-9800000002','https://healwin.in','Healthcare','#10b981',1),
('client-3','admin@kavach.com','e1f9ef5e1e7f2481fc1bdbfcb2c71dfe2293c8404bd6c9a70e7c7fd2afbb8673','Kavach Security','Rajesh Mehta','+91-9800000003','https://kavach.in','Security / IoT','#f59e0b',1),
('client-4','admin@retailedge.com','e1f9ef5e1e7f2481fc1bdbfcb2c71dfe2293c8404bd6c9a70e7c7fd2afbb8673','RetailEdge Inc','Sunita Sharma','+91-9800000004','https://retailedge.in','Retail / E-commerce','#ec4899',1);

-- ─────────────────────────────────────────
-- LINK CLIENTS TO PROJECTS
-- ─────────────────────────────────────────
UPDATE projects SET client_id='client-1', completion_pct=72, contract_value=1200000, tech_stack='["Node.js","React","PostgreSQL"]' WHERE id='proj-1';
UPDATE projects SET client_id='client-2', completion_pct=42, contract_value=800000,  tech_stack='["React Native","Node.js"]'         WHERE id='proj-2';
UPDATE projects SET client_id='client-3', completion_pct=89, contract_value=600000,  tech_stack='["React","Node.js","QR"]'            WHERE id='proj-3';
UPDATE projects SET client_id='client-4', completion_pct=68, contract_value=450000,  tech_stack='["React","Python","FastAPI"]'        WHERE id='proj-4';

-- ─────────────────────────────────────────
-- SPRINTS  (proj-1 = Growniq, proj-2 = HealWin)
-- ─────────────────────────────────────────
INSERT OR IGNORE INTO sprints (id, project_id, name, goal, start_date, end_date, status, total_story_points, completed_story_points, created_by)
VALUES
('sp-1','proj-1','Sprint 1 – Auth & Core','Complete authentication and user management',  date('now','-45 days'), date('now','-32 days'),'completed',40,40,'user-pm-1'),
('sp-2','proj-1','Sprint 2 – Dashboard','Build PM and analytics dashboards',               date('now','-30 days'), date('now','-17 days'),'completed',35,32,'user-pm-1'),
('sp-3','proj-1','Sprint 3 – Reports','Reports, exports, and billing views',               date('now','-14 days'), date('now','+0 days'), 'active',   30,18,'user-pm-1'),
('sp-4','proj-1','Sprint 4 – Polish','Final testing, UAT, deployment',                    date('now','+3 days'),  date('now','+16 days'),'planning', 20,0, 'user-pm-1'),
('sp-5','proj-2','Sprint 1 – Mobile Core','Patient login, profile, appointment flow',      date('now','-30 days'), date('now','-17 days'),'completed',28,25,'user-pm-1'),
('sp-6','proj-2','Sprint 2 – Telemedicine','Video call UI and doctor-patient flow',        date('now','-14 days'), date('now','+2 days'), 'active',   25,14,'user-pm-1');

-- ─────────────────────────────────────────
-- MILESTONES
-- ─────────────────────────────────────────
INSERT OR IGNORE INTO milestones (id, project_id, title, description, due_date, completion_pct, status, is_billable, invoice_amount, client_visible, created_by)
VALUES
('ms-1','proj-1','Phase 1 – Discovery & Architecture','Kickoff, BRD, tech design docs', date('now','-45 days'),100,'completed',1,250000,1,'user-pm-1'),
('ms-2','proj-1','Phase 2 – Core Development','User auth, dashboards, core APIs',        date('now','-15 days'),100,'completed',1,400000,1,'user-pm-1'),
('ms-3','proj-1','Phase 3 – Reports & Advanced','Reports, analytics, exports',             date('now','+5 days'), 60, 'in_progress',1,350000,1,'user-pm-1'),
('ms-4','proj-1','Phase 4 – UAT & Launch','Testing, bug fixes, go-live',                  date('now','+20 days'),0,  'pending',   1,200000,1,'user-pm-1'),
('ms-5','proj-2','Phase 1 – Mobile MVP','Patient app core functionality',                  date('now','-10 days'),100,'completed',1,300000,1,'user-pm-1'),
('ms-6','proj-2','Phase 2 – Telemedicine','Video call + prescription module',              date('now','+10 days'),55, 'in_progress',1,300000,1,'user-pm-1'),
('ms-7','proj-3','Phase 1 – QR Engine','QR generation and scanning core',                  date('now','-20 days'),100,'completed',1,300000,1,'user-pm-2'),
('ms-8','proj-3','Phase 2 – Access Control','Role-based access management system',        date('now','+5 days'), 80, 'in_progress',1,200000,1,'user-pm-2');

-- ─────────────────────────────────────────
-- TASKS / TICKETS  (Growniq – Sprint 3)
-- ─────────────────────────────────────────
INSERT OR IGNORE INTO tasks (id, project_id, sprint_id, title, description, task_type, status, priority, assignee_id, reporter_id, story_points, estimated_hours, logged_hours, due_date, is_client_visible, position)
VALUES
-- Backlog
('task-1','proj-1','sp-3','Design export PDF template','Create PDF layout for reports export','task','backlog','medium','user-dev-2','user-pm-1',3,6,0,date('now','+5 days'),1,1),
('task-2','proj-1','sp-3','Add role filter to user list','Filter users by role in admin panel','story','backlog','low','user-dev-1','user-pm-1',2,3,0,date('now','+6 days'),1,2),
-- To Do
('task-3','proj-1','sp-3','Build report summary API','Aggregate hours and billable data per project','story','todo','high','user-dev-1','user-pm-1',5,10,0,date('now','+3 days'),1,1),
('task-4','proj-1','sp-3','Implement CSV export endpoint','Export timesheet data as downloadable CSV','task','todo','high','user-dev-1','user-pm-1',3,6,0,date('now','+4 days'),1,2),
('task-5','proj-1','sp-3','Billing dashboard UI','Build client-visible billing view with charts','task','todo','medium','user-dev-2','user-pm-1',5,10,0,date('now','+5 days'),1,3),
-- In Progress
('task-6','proj-1','sp-3','Hours utilization chart','Doughnut chart for allocated vs consumed hours','task','in_progress','high','user-dev-2','user-pm-1',3,6,4,date('now','+1 days'),1,1),
('task-7','proj-1','sp-3','Monthly effort summary table','Tabular view of developer monthly hours','story','in_progress','medium','user-dev-1','user-pm-1',5,8,3,date('now','+2 days'),1,2),
('task-8','proj-1','sp-3','Alert system backend','Smart alerts for overrun and idle devs','story','in_progress','critical','user-dev-1','user-pm-1',8,14,8,date('now','+1 days'),0,3),
-- In Review
('task-9','proj-1','sp-3','JWT auth middleware refactor','Fix alg option and add token refresh','task','in_review','high','user-dev-1','user-pm-1',5,8,8,date('now','-1 days'),0,1),
('task-10','proj-1','sp-3','PM dashboard charts','Weekly and monthly bar charts with Chart.js','task','in_review','medium','user-dev-2','user-pm-1',5,10,10,date('now','-1 days'),1,2),
-- QA
('task-11','proj-1','sp-3','E2E auth flow testing','Test login, token refresh, role-based access','task','qa','high','user-dev-4','user-pm-1',3,6,5,date('now','-2 days'),1,1),
-- Done
('task-12','proj-1','sp-2','User management CRUD','Create, read, update, deactivate users','story','done','medium','user-dev-1','user-pm-1',8,16,16,date('now','-18 days'),1,1),
('task-13','proj-1','sp-2','Project management module','Full CRUD for projects with status tracking','story','done','high','user-dev-1','user-pm-1',8,16,16,date('now','-20 days'),1,2),
('task-14','proj-1','sp-2','Timesheet entry form','Daily work log entry with approval workflow','story','done','high','user-dev-2','user-pm-1',5,10,10,date('now','-22 days'),1,3),
-- Blocked
('task-15','proj-1','sp-3','Integrate Razorpay gateway','Payment gateway for invoice payments','task','blocked','critical','user-dev-1','user-pm-1',8,16,2,date('now','+3 days'),1,1),

-- ── HealWin Mobile App tasks
('task-16','proj-2','sp-6','Patient login screen','OTP-based phone verification','task','done','high','user-dev-5','user-pm-1',3,6,6,date('now','-15 days'),1,1),
('task-17','proj-2','sp-6','Doctor profile cards','List doctors with specialty and rating','task','in_progress','high','user-dev-5','user-pm-1',3,5,3,date('now','+1 days'),1,1),
('task-18','proj-2','sp-6','Appointment booking flow','Calendar UI + slot selection','story','in_progress','critical','user-dev-5','user-pm-1',8,14,6,date('now','+2 days'),1,2),
('task-19','proj-2','sp-6','Video call UI','WebRTC-based telemedicine screen','story','todo','critical','user-dev-5','user-pm-1',13,20,0,date('now','+5 days'),1,1),
('task-20','proj-2','sp-6','Prescription module','Digital prescription generation & PDF','task','backlog','medium','user-dev-1','user-pm-1',5,8,0,date('now','+8 days'),1,1),

-- ── Subtasks
('task-21','proj-1','sp-3','Alert: overrun detection logic','Write SQL query for hour overrun','sub_task','in_progress','high','user-dev-1','user-pm-1',3,4,2,date('now','+1 days'),0,1),
('task-22','proj-1','sp-3','Alert: idle developer detection','Detect devs with <50% utilization','sub_task','todo','medium','user-dev-1','user-pm-1',2,3,0,date('now','+2 days'),0,2),

-- ── Bugs
('task-23','proj-1','sp-3','BUG: Login 401 on token refresh','Token refresh fails after 24h expiry','bug','in_review','critical','user-dev-1','user-pm-1',3,4,4,date('now','-1 days'),0,1),
('task-24','proj-2','sp-6','BUG: Appointment slots showing wrong timezone','UTC offset causing wrong slot display','bug','todo','high','user-dev-5','user-pm-1',2,3,0,date('now','+2 days'),1,1);

-- Set parent tasks for subtasks
UPDATE tasks SET parent_task_id='task-8' WHERE id IN ('task-21','task-22');

-- ─────────────────────────────────────────
-- DOCUMENTS
-- ─────────────────────────────────────────
INSERT OR IGNORE INTO documents (id, project_id, title, description, category, file_name, file_url, file_size, file_type, version, uploaded_by, is_client_visible)
VALUES
('doc-1','proj-1','Growniq – SOW v1.2','Scope of work signed document','sow','growniq_sow_v1.2.pdf','https://storage.example.com/docs/growniq_sow.pdf',245000,'application/pdf','1.2','user-pm-1',1),
('doc-2','proj-1','Growniq – BRD','Business requirements document','brd','growniq_brd.pdf','https://storage.example.com/docs/growniq_brd.pdf',480000,'application/pdf','1.0','user-pm-1',1),
('doc-3','proj-1','Growniq – Technical Architecture','System design and architecture doc','technical','growniq_arch.pdf','https://storage.example.com/docs/growniq_arch.pdf',320000,'application/pdf','1.0','user-pm-1',0),
('doc-4','proj-1','Growniq – UI Wireframes','Figma exported wireframes','wireframes','growniq_wireframes.pdf','https://storage.example.com/docs/growniq_wf.pdf',1200000,'application/pdf','2.1','user-pm-1',1),
('doc-5','proj-1','Sprint 2 – Meeting Notes','Sprint 2 planning and review notes','meeting_notes','sprint2_notes.pdf','https://storage.example.com/docs/sprint2_notes.pdf',85000,'application/pdf','1.0','user-pm-1',0),
('doc-6','proj-2','HealWin – SOW','Signed scope of work for HealWin','sow','healwin_sow.pdf','https://storage.example.com/docs/healwin_sow.pdf',215000,'application/pdf','1.0','user-pm-1',1),
('doc-7','proj-2','HealWin – FRD','Functional requirements for mobile app','frd','healwin_frd.pdf','https://storage.example.com/docs/healwin_frd.pdf',560000,'application/pdf','1.0','user-pm-1',1),
('doc-8','proj-2','App Design – Figma','Mobile app UI design exported from Figma','uiux','healwin_ui.pdf','https://storage.example.com/docs/healwin_ui.pdf',2100000,'application/pdf','3.0','user-pm-1',1),
('doc-9','proj-3','Kavach – Contract','Signed project contract','contract','kavach_contract.pdf','https://storage.example.com/docs/kavach_contract.pdf',125000,'application/pdf','1.0','user-pm-2',1),
('doc-10','proj-3','QR Security – Test Report','UAT test results for QR module','test_report','kavach_test.pdf','https://storage.example.com/docs/kavach_test.pdf',340000,'application/pdf','1.0','user-pm-2',1);

-- ─────────────────────────────────────────
-- INVOICES
-- ─────────────────────────────────────────
INSERT OR IGNORE INTO invoices (id, invoice_number, project_id, client_id, milestone_id, title, amount, tax_pct, tax_amount, total_amount, status, due_date, issue_date, paid_date, paid_amount, notes, created_by)
VALUES
('inv-1','INV-2025-001','proj-1','client-1','ms-1','Growniq – Phase 1: Discovery & Architecture',212000,18,38160,250160,'paid',date('now','-35 days'),date('now','-45 days'),date('now','-30 days'),250160,'Phase 1 completed and delivered as agreed','user-admin-1'),
('inv-2','INV-2025-002','proj-1','client-1','ms-2','Growniq – Phase 2: Core Development',338983,18,61017,400000,'paid',date('now','-10 days'),date('now','-20 days'),date('now','-8 days'),400000,'Phase 2 delivered on schedule','user-admin-1'),
('inv-3','INV-2025-003','proj-1','client-1','ms-3','Growniq – Phase 3: Reports & Analytics',296610,18,53390,350000,'sent',date('now','+5 days'),date('now','-2 days'),NULL,0,'Phase 3 – 60% complete. Invoice raised on partial delivery','user-admin-1'),
('inv-4','INV-2025-004','proj-2','client-2','ms-5','HealWin – Phase 1: Mobile MVP',254237,18,45763,300000,'paid',date('now','-5 days'),date('now','-15 days'),date('now','-3 days'),300000,'Mobile MVP approved by client','user-admin-1'),
('inv-5','INV-2025-005','proj-2','client-2','ms-6','HealWin – Phase 2: Telemedicine',254237,18,45763,300000,'pending',date('now','+10 days'),date('now','+1 days'),NULL,0,'Phase 2 in progress – 55% complete','user-admin-1'),
('inv-6','INV-2025-006','proj-3','client-3','ms-7','Kavach QR – Phase 1: QR Engine',254237,18,45763,300000,'paid',date('now','-15 days'),date('now','-25 days'),date('now','-12 days'),300000,'QR engine delivered and tested','user-admin-1'),
('inv-7','INV-2025-007','proj-3','client-3','ms-8','Kavach QR – Phase 2: Access Control',169492,18,30508,200000,'sent',date('now','+5 days'),date('now','-1 days'),NULL,0,'Phase 2 – 80% complete','user-admin-1'),
('inv-8','INV-2025-008','proj-4','client-4',NULL,'RetailEdge – Monthly Maintenance – March',38136,18,6864,45000,'overdue',date('now','-5 days'),date('now','-15 days'),NULL,0,'Monthly retainer invoice','user-admin-1');

-- ─────────────────────────────────────────
-- COMMENTS
-- ─────────────────────────────────────────
INSERT OR IGNORE INTO comments (id, entity_type, entity_id, author_user_id, content, is_internal)
VALUES
('cmt-1','task','task-8','user-dev-1','Started implementing the overrun detection logic. Should be done by tomorrow.', 0),
('cmt-2','task','task-8','user-pm-1','Good progress! Make sure to test edge cases for 0-hour allocations.', 0),
('cmt-3','task','task-15','user-pm-1','Blocked on Razorpay API keys from client. Following up with Vikram.', 0),
('cmt-4','task','task-15','user-dev-1','I have the test keys but need production credentials to proceed.', 0),
('cmt-5','task','task-18','user-dev-5','Calendar component integrated. Working on slot selection logic now.', 0),
('cmt-6','task','task-23','user-dev-1','Issue identified: hono/jwt verify() requires alg option in v4.12+. Fix applied in middleware.', 0),
('cmt-7','project','proj-1','user-pm-1','Sprint 3 kickoff done. Team aligned on deliverables. Target: complete reports module by EOD Friday.', 0),
('cmt-8','project','proj-1','user-pm-1','Client requested to add PDF export for billing reports. Added to backlog.', 0);

-- Client comments
INSERT OR IGNORE INTO comments (id, entity_type, entity_id, author_client_id, content, is_internal)
VALUES
('cmt-9','task','task-10','client-1','The dashboard looks great! Can we add a date filter to the charts?', 0),
('cmt-10','project','proj-1','client-1','Excellent progress so far. Looking forward to the Phase 3 delivery next week.', 0),
('cmt-11','task','task-18','client-2','Please ensure the appointment booking supports multi-timezone for international patients.', 0);

-- ─────────────────────────────────────────
-- PROJECT UPDATES
-- ─────────────────────────────────────────
INSERT OR IGNORE INTO project_updates (id, project_id, title, content, update_type, is_client_visible, posted_by)
VALUES
('pu-1','proj-1','Sprint 3 Kickoff','We have successfully kicked off Sprint 3 focusing on Reports, Analytics, and Export features. The team is fully aligned and we expect delivery by end of this sprint.','general',1,'user-pm-1'),
('pu-2','proj-1','Phase 2 Completed ✓','Phase 2 (Core Development) has been successfully completed and delivered. All acceptance criteria have been met. Invoice INV-2025-002 has been raised.','milestone',1,'user-pm-1'),
('pu-3','proj-1','Blocker: Payment Gateway','We are currently blocked on Razorpay production API keys for the billing module. Awaiting client confirmation.','blocker',1,'user-pm-1'),
('pu-4','proj-2','Sprint 2 In Progress','Telemedicine module development is underway. Video call UI is being implemented using WebRTC. Expected completion in 2 weeks.','general',1,'user-pm-1'),
('pu-5','proj-2','Phase 1 Delivered ✓','Mobile MVP (Phase 1) has been delivered and approved. Patient login, profile, and appointment booking core flow are live.','milestone',1,'user-pm-1'),
('pu-6','proj-3','Final Testing Underway','QR Access Control system is in final QA phase. UAT will begin next week with the Kavach team.','status',1,'user-pm-2');

-- ─────────────────────────────────────────
-- ACTIVITY LOGS
-- ─────────────────────────────────────────
INSERT OR IGNORE INTO activity_logs (id, project_id, entity_type, entity_id, action, actor_user_id, actor_name, actor_role, old_value, new_value)
VALUES
('al-1','proj-1','task','task-9','status_changed','user-dev-1','Rahul Sharma','developer','in_progress','in_review'),
('al-2','proj-1','task','task-10','status_changed','user-dev-2','Priya Patel','developer','in_progress','in_review'),
('al-3','proj-1','task','task-11','status_changed','user-dev-4','Neha Singh','developer','in_progress','qa'),
('al-4','proj-1','task','task-6','commented','user-dev-2','Priya Patel','developer',NULL,'Added chart component with responsive layout'),
('al-5','proj-1','document','doc-4','uploaded','user-pm-1','Sarah Mitchell','pm',NULL,'Growniq – UI Wireframes v2.1'),
('al-6','proj-1','invoice','inv-3','created','user-admin-1','Super Admin','admin',NULL,'INV-2025-003 created for Phase 3'),
('al-7','proj-2','task','task-17','status_changed','user-dev-5','Arjun Mehta','developer','todo','in_progress'),
('al-8','proj-2','task','task-16','status_changed','user-dev-5','Arjun Mehta','developer','in_review','done'),
('al-9','proj-1','sprint','sp-3','activated','user-pm-1','Sarah Mitchell','pm','planning','active'),
('al-10','proj-3','milestone','ms-8','updated','user-pm-2','James Rodriguez','pm','70','80');

-- Activity logs from clients
INSERT OR IGNORE INTO activity_logs (id, project_id, entity_type, entity_id, action, actor_client_id, actor_name, actor_role, new_value)
VALUES
('al-11','proj-1','task','task-10','commented','client-1','Vikram Nair (Growniq)','client','Requested date filter on charts'),
('al-12','proj-2','task','task-18','commented','client-2','Dr. Ananya Rao (HealWin)','client','Requested multi-timezone support');

-- ─────────────────────────────────────────
-- CLIENT NOTIFICATIONS
-- ─────────────────────────────────────────
INSERT OR IGNORE INTO client_notifications (id, client_id, project_id, type, title, message, is_read)
VALUES
('cn-1','client-1','proj-1','invoice','New Invoice: INV-2025-003','Invoice for Phase 3 (₹3,50,000) has been raised. Due: in 5 days.',0),
('cn-2','client-1','proj-1','project_update','Sprint 3 Kickoff','Your project Growniq Platform has entered Sprint 3. Reports & Analytics module is in progress.',0),
('cn-3','client-1','proj-1','document','New Document: UI Wireframes v2.1','Updated wireframes have been uploaded to the document center.',1),
('cn-4','client-2','proj-2','milestone','Milestone Completed: Mobile MVP','Phase 1 (Mobile MVP) has been successfully delivered and approved.',1),
('cn-5','client-2','proj-2','invoice','Invoice Paid: INV-2025-004','Payment of ₹3,00,000 has been confirmed for HealWin Phase 1.',1),
('cn-6','client-2','proj-2','project_update','Telemedicine Module In Progress','Sprint 2 is underway. Video call UI development started.',0),
('cn-7','client-3','proj-3','milestone','Milestone Update: Access Control 80%','Phase 2 (Access Control) is 80% complete. UAT begins next week.',0),
('cn-8','client-4','proj-4','invoice','Invoice Overdue: INV-2025-008','Monthly maintenance invoice of ₹45,000 is overdue. Please arrange payment.',0);
