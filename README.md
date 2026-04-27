# Mariox DevPortal — Enterprise Project & Client Management Platform

## Project Overview
- **Name**: Mariox DevPortal (DevTrack Pro)
- **Goal**: Full-stack SaaS platform for project management, developer time tracking, and client portal
- **Platform**: Node.js + Hono
- **Tech Stack**: Hono + TypeScript + Tailwind CSS v3 (CLI build) + Chart.js + MongoDB

---

## Live Demo (Sandbox)
- **URL**: http://localhost:3000 (sandbox) / https://3000-ivbwhv85a9xksobmz8kje-5c13a017.sandbox.novita.ai
- **GitHub**: https://github.com/marioxsoftware/PMportal

---

## Demo Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | akash@marioxsoftware.com | mariox@123 |

All other users are created from the admin panel after signing in.

---

## Features Implemented

### ✅ Authentication & RBAC
- JWT-based authentication (HS256 algorithm, 24h expiry)
- Role-based access control: Admin, Project Manager, Project Coordinator, Developer, Team Member, Client
- Separate client auth flow (`/client-auth/login`)
- Password management (change password)

### ✅ Admin / PM Dashboard
- Summary cards: Active projects, total developers, allocated vs consumed hours
- Top projects by burn rate with visual indicators
- Developer utilization table with health indicators
- Weekly and monthly hours charts (Chart.js)
- Recent timesheet logs
- Project health status (critical, warning, healthy)

### ✅ Developer Dashboard
- Personal utilization meter
- Assigned projects with hour consumption
- Daily timesheet entry form with suggestions
- Idle time detection alerts
- Weekly summary view

### ✅ Developer Management
- Full CRUD for developer profiles
- Tech stack and skill tags management
- Monthly capacity and availability settings
- Leave and holiday integration
- Productivity scoring per developer

### ✅ Project Management
- Full CRUD for projects with client info
- Project status: Active, On Hold, Completed, Cancelled
- Priority levels: Critical, High, Medium, Low
- Burn rate calculation and visual progress bars
- Billable vs non-billable flag
- Project budget and revenue tracking
- Developer assignment/unassignment

### ✅ Kanban Board & Sprints
- Drag-and-drop style kanban columns (Backlog, Todo, In Progress, In Review, QA, Done, Blocked)
- Sprint management with milestones
- Task drawer with subtasks, comments, and activity log
- Status updates per task

### ✅ Documents Center
- Upload documents (URL-based) with categories and visibility (all / client / internal)
- Document filtering by project, category, search
- Client-visible document flag
- Download tracking and count

### ✅ Hour Allocation Module
- Allocate hours per developer per project
- Consumed vs allocated tracking
- Auto-update on timesheet approval
- Allocation health indicators

### ✅ Timesheet / Daily Work Log
- Daily work log entry by developers
- Module name, task description, hours (0.5 step)
- Billable hours flag, blocker details
- Approval workflow (Pending → Approved/Rejected)
- One-click bulk approval for PMs
- Auto hour consumption update on approval
- CSV export, weekly summary, suggestions

### ✅ Reports & Analytics
- Team utilization report (`/reports/team-utilization`)
- Project summary report (`/reports/project-summary`)
- Developer report (`/reports/developer/:id`)
- Project report (`/reports/project/:id`)
- Export to CSV (Excel-compatible)
- Date range filters, billable vs non-billable breakdown

### ✅ Invoices & Billing
- Client billing with invoice management
- Invoice status: draft, sent, paid, overdue
- Total billed/paid amounts per client

### ✅ Alerts & Notifications
- Smart alerts: Burn rate warnings, overallocation, idle developers
- Severity levels: Critical, Warning, Info
- Mark as read / dismiss / bulk-read functionality
- Auto-generate alerts via `/alerts/generate`
- Real-time alert badge counter

### ✅ Settings / Master Data
- Company settings (working hours, fiscal year, OT thresholds)
- Holiday calendar management
- Tech stack master data
- System info card

### ✅ Leave Management
- Leave requests and approvals
- Leave type: Sick, Casual, Earned
- Monthly leave calendar view

### ✅ Client Portal (Separate Login)
- Dedicated login at `/client-auth/login`
- Client dashboard with project overview, billing summary, recent activity
- Project detail with tasks, milestones, documents, sprints, updates
- Kanban board view (client read-only)
- Document browser with download tracking
- Invoice viewer
- Activity feed
- Profile & change password

---

## API Endpoints

### Authentication
- `POST /api/auth/login` — Login (staff)
- `POST /api/auth/verify` — Verify JWT token
- `POST /api/auth/change-password` — Change password
- `POST /api/client-auth/login` — Client login
- `POST /api/client-auth/signup` — Client signup
- `GET  /api/client-auth/me` — Client profile

### Users / Developers
- `GET    /api/users` — List users (filter: role, is_active)
- `POST   /api/users` — Create new user
- `GET    /api/users/:id` — Get user detail
- `PUT    /api/users/:id` — Update user
- `DELETE /api/users/:id` — Deactivate user

### Projects
- `GET    /api/projects` — List projects (filter: status, priority, pm_id)
- `POST   /api/projects` — Create project
- `GET    /api/projects/:id` — Get project detail with assignments
- `PUT    /api/projects/:id` — Update project
- `DELETE /api/projects/:id` — Delete project
- `POST   /api/projects/:id/assign` — Assign developer
- `DELETE /api/projects/:id/assign/:userId` — Unassign developer
- `PATCH  /api/projects/:id/assign/:userId` — Update allocation hours/role

### Timesheets
- `GET    /api/timesheets` — List (filter: user, project, date_from, date_to, status)
- `POST   /api/timesheets` — Create entry
- `PUT    /api/timesheets/:id` — Update entry
- `DELETE /api/timesheets/:id` — Delete entry
- `PATCH  /api/timesheets/:id/approve` — Approve / reject
- `POST   /api/timesheets/bulk-approve` — Bulk approve
- `GET    /api/timesheets/summary/weekly` — Weekly summary
- `GET    /api/timesheets/suggestions` — Suggested entries

### Tasks
- `GET    /api/tasks` — List tasks (filter: project_id, sprint_id, status, assignee_id)
- `POST   /api/tasks` — Create task
- `GET    /api/tasks/:id` — Task detail with subtasks, comments, activity
- `PUT    /api/tasks/:id` — Update task
- `DELETE /api/tasks/:id` — Delete task
- `PATCH  /api/tasks/:id/status` — Update status
- `POST   /api/tasks/:id/comments` — Add comment
- `POST   /api/tasks/:id/subtasks` — Add subtask
- `PATCH  /api/tasks/:id/subtasks/:sid` — Update subtask

### Sprints & Milestones
- `GET    /api/sprints` — List sprints (filter: project_id)
- `POST   /api/sprints` — Create sprint
- `GET    /api/sprints/:id` — Sprint detail
- `PUT    /api/sprints/:id` — Update sprint
- `GET    /api/milestones` — List milestones
- `POST   /api/milestones` — Create milestone
- `PATCH  /api/milestones/:id` — Update milestone

### Documents
- `GET    /api/documents` — List (filter: project_id, category, visibility)
- `POST   /api/documents` — Upload document (URL-based)
- `PUT    /api/documents/:id` — Update document
- `DELETE /api/documents/:id` — Delete document
- `PATCH  /api/documents/:id/download` — Increment download count

### Invoices
- `GET    /api/invoices` — List invoices (filter: client_id, status)
- `POST   /api/invoices` — Create invoice
- `GET    /api/invoices/:id` — Invoice detail
- `PUT    /api/invoices/:id` — Update invoice
- `PATCH  /api/invoices/:id/status` — Update status

### Clients
- `GET    /api/clients` — List clients (with billing aggregates)
- `GET    /api/clients/:id` — Client detail with projects and invoices
- `PUT    /api/clients/:id` — Update client profile
- `GET    /api/clients/:id/dashboard` — Client portal dashboard
- `GET    /api/clients/:id/project/:pid` — Project detail for client
- `POST   /api/clients/:id/project/:pid/comment` — Add comment
- `GET    /api/clients/:id/notifications` — Client notifications
- `PATCH  /api/clients/notifications/:id/read` — Mark notification read

### Dashboards
- `GET /api/dashboard/pm` — PM dashboard (projects, utilization, charts)
- `GET /api/dashboard/dev` — Developer dashboard

### Reports
- `GET /api/reports/team-utilization` — Team utilization (alias: /team)
- `GET /api/reports/project-summary` — Project summary list
- `GET /api/reports/summary` — Executive summary
- `GET /api/reports/developer/:id` — Developer report
- `GET /api/reports/project/:id` — Project report
- `GET /api/reports/export/timesheets` — CSV export

### Allocations
- `GET /api/allocations` — List allocations (filter: project_id, user_id)
- `GET /api/allocations/summary` — Developer allocation summary

### Activity
- `GET  /api/activity` — Activity logs (filter: project_id, entity_type, client_id, limit)
- `GET  /api/activity/project/:id/feed` — Project activity feed
- `POST /api/activity/project/:id/update` — Add project update

### Alerts
- `GET   /api/alerts` — List alerts
- `PATCH /api/alerts/:id/read` — Mark as read
- `PATCH /api/alerts/:id/dismiss` — Dismiss
- `POST  /api/alerts/mark-all-read` — Mark all read
- `PATCH /api/alerts/read-all` — Alias mark-all-read
- `POST  /api/alerts/generate` — Auto-generate alerts (admin/PM)

### Settings
- `GET    /api/settings` — Company config, holidays, tech stacks
- `PUT    /api/settings/company` — Update company settings
- `POST   /api/settings/holidays` — Add holiday
- `DELETE /api/settings/holidays/:id` — Delete holiday
- `POST   /api/settings/tech-stacks` — Add tech stack
- `DELETE /api/settings/tech-stacks/:id` — Delete tech stack

### Leaves
- `GET  /api/leaves` — List leaves
- `POST /api/leaves` — Create leave request
- `PUT  /api/leaves/:id/approve` — Approve leave

---

## Data Architecture

### Database: MongoDB-backed SQL layer

**Tables:**
| Table | Description |
|-------|-------------|
| `users` | All users (admin, PM, developer) |
| `projects` | Projects with budget/hours/burn tracking |
| `project_assignments` | Developer-project allocations |
| `timesheets` | Daily work logs |
| `tasks` | Tasks with kanban status |
| `subtasks` | Task sub-items |
| `comments` | Task/project comments |
| `sprints` | Sprint management |
| `milestones` | Project milestones |
| `documents` | Document metadata (URL-based) |
| `invoices` | Client billing invoices |
| `clients` | Client company profiles |
| `client_notifications` | Alerts for client portal |
| `activity_logs` | Audit trail of all actions |
| `project_updates` | PM-authored project updates |
| `leaves` | Leave requests |
| `holidays` | Holiday calendar |
| `alerts` | Internal system alerts |
| `company_settings` | Global platform config |
| `tech_stacks` | Technology master data |

---

## Project Structure

```
webapp/
├── src/
│   ├── index.tsx                  # Main Hono app entry (all routes registered)
│   ├── middleware/
│   │   └── auth.ts                # JWT auth middleware + requireRole
│   ├── routes/
│   │   ├── auth.ts                # Staff login, verify, change-password
│   │   ├── client-auth.ts         # Client login, signup, me
│   │   ├── users.ts               # Developer/user CRUD
│   │   ├── projects.ts            # Project CRUD + assignments
│   │   ├── timesheets.ts          # Work logs + approval + bulk-approve
│   │   ├── dashboard.ts           # PM and developer dashboards
│   │   ├── reports.ts             # Team/project/developer reports + CSV
│   │   ├── alerts.ts              # Alerts CRUD + auto-generate
│   │   ├── settings.ts            # Company config, holidays, tech stacks
│   │   ├── allocations.ts         # Allocation list + summary
│   │   ├── leaves.ts              # Leave requests + approvals
│   │   ├── tasks.ts               # Tasks + subtasks + comments
│   │   ├── sprints.ts             # Sprints + milestones router
│   │   ├── documents.ts           # Document metadata + download tracking
│   │   ├── invoices.ts            # Invoice CRUD + status
│   │   ├── clients.ts             # Client management + portal APIs
│   │   └── activity.ts            # Activity logs + project updates
│   └── utils/
│       └── helpers.ts             # generateId, dates, pagination, colors
├── public/static/
│   ├── app.js                     # Core: auth, layout, routing, role-based nav
│   ├── pages.js                   # PM dashboard, developer pages, kanban, allocations
│   ├── pages2.js                  # Reports, timesheets, alerts (legacy router compat)
│   ├── enterprise.js              # Super admin dashboard, project boards, task drawer, resources
│   ├── enterprise2.js             # Documents, timesheets view, reports view, alerts, settings
│   ├── client-portal.js           # Full client portal (login, dashboard, projects, docs, billing)
│   ├── tailwind-input.css         # Tailwind CSS source (3 directives)
│   ├── tailwind.css               # Built & minified Tailwind (6.6KB — NO CDN)
│   └── styles.css                 # Custom CSS (sidebar, cards, forms, animations)
├── src/models/
│   └── mongo-models.ts     # Mongo collections registry
├── tailwind.config.js             # Tailwind v3 config (custom colors, shadows)
├── postcss.config.js              # PostCSS config
├── ecosystem.config.cjs           # PM2 config
├── src/server.ts                  # Node entrypoint
├── src/models/mongo-models.ts     # Mongo collections registry
├── tsconfig.json
└── package.json
```

---

## Local Development Setup

```bash
# 1. Clone the repository
git clone https://github.com/marioxsoftware/PMportal.git
cd PMportal

# 2. Install dependencies
npm install

# 3. Add local secrets without committing them
cat > .dev.vars <<'EOF'
JWT_SECRET=your-secret-value
PASSWORD_SALT=your-password-salt
LOCAL_MONGO_DB=mongodb://localhost:27017/mariox-portal
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=abhishek@marioxsoftware.com
SMTP_PASS=your-app-password
SMTP_FROM=abhishek@marioxsoftware.com
SMTP_SECURE=false
EOF

# 4. Build the CSS bundle
npm run build

# 5. Start development server
npm run dev
# or with PM2:
pm2 start ecosystem.config.cjs
```

---

## Deployment

```bash
# 1. Build
npm run build

# 2. Set production environment variables
#    LOCAL_MONGO_DB, JWT_SECRET, PASSWORD_SALT, SMTP_*

# 3. Start the Node server
npm run start
```

---

## Build Pipeline

```bash
npm run tw:build   # Tailwind CSS → public/static/tailwind.css (minified, 6.6KB)
npm run build      # tw:build
npm run tw:watch   # Watch mode for Tailwind during dev
```

**No CDN Tailwind** — CSS is built locally from source using `tailwindcss` CLI. All custom colors/shadows/fonts are defined in `tailwind.config.js`.

---

## Security Notes
- All API routes are protected by `authMiddleware` (JWT verification)
- Role-based access via `requireRole(['admin','pm'])` guards
- Client portal uses separate JWT with `client` role
- Password fields are inside `<form>` tags with proper `autocomplete` attributes
- Tokens: 24h expiry, HS256 algorithm

---

## Status

| Item | Status |
|------|--------|
| All APIs (18+ endpoints) | ✅ HTTP 200 |
| Authentication (Staff + Client) | ✅ JWT HS256 |
| Database | ✅ MongoDB with seeded demo data |
| Tailwind CSS | ✅ Built via CLI (no CDN) |
| Console warnings | ✅ Zero |
| Password form accessibility | ✅ Fixed |
| GitHub | ✅ https://github.com/marioxsoftware/PMportal |
| Node Deployment | ✅ Configure MongoDB and environment variables |
| **Last Updated** | 2026-03-24 |
