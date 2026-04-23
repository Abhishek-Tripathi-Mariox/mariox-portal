import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { serveStatic } from 'hono/cloudflare-workers'
import authRoutes from './routes/auth'
import clientAuthRoutes from './routes/client-auth'
import userRoutes from './routes/users'
import projectRoutes from './routes/projects'
import timesheetRoutes from './routes/timesheets'
import dashboardRoutes from './routes/dashboard'
import reportRoutes from './routes/reports'
import alertRoutes from './routes/alerts'
import settingsRoutes from './routes/settings'
import allocationRoutes from './routes/allocations'
import leaveRoutes from './routes/leaves'
import taskRoutes from './routes/tasks'
import sprintRoutes, { milestonesRouter } from './routes/sprints'
import documentRoutes from './routes/documents'
import invoiceRoutes from './routes/invoices'
import clientRoutes from './routes/clients'
import activityRoutes from './routes/activity'
import projectTeamsRoutes from './routes/project-teams'
import kanbanPermsRoutes from './routes/kanban-permissions'
import invitesRoutes from './routes/invites'

type Bindings = { DB: D1Database; JWT_SECRET: string; PASSWORD_SALT: string }

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', logger())
app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'],
  allowHeaders: ['Content-Type','Authorization'],
  exposeHeaders: ['Content-Length'],
  maxAge: 600,
  credentials: true,
}))

// ── Auth routes (internal users + clients)
app.route('/api/auth', authRoutes)
app.route('/api/client-auth', clientAuthRoutes)

// ── Internal user routes
app.route('/api/users', userRoutes)
app.route('/api/projects', projectRoutes)
app.route('/api/timesheets', timesheetRoutes)
app.route('/api/dashboard', dashboardRoutes)
app.route('/api/reports', reportRoutes)
app.route('/api/alerts', alertRoutes)
app.route('/api/settings', settingsRoutes)
app.route('/api/allocations', allocationRoutes)
app.route('/api/leaves', leaveRoutes)

// ── Enterprise extension routes
app.route('/api/tasks', taskRoutes)
app.route('/api/sprints', sprintRoutes)
app.route('/api/milestones', milestonesRouter)
app.route('/api/documents', documentRoutes)
app.route('/api/invoices', invoiceRoutes)
app.route('/api/clients', clientRoutes)
app.route('/api/activity', activityRoutes)
app.route('/api/project-teams', projectTeamsRoutes)
app.route('/api/kanban-permissions', kanbanPermsRoutes)
app.route('/api/invites', invitesRoutes)

// ── Static files
app.use('/static/*', serveStatic({ root: './' }))

// ── SPA fallback
app.get('*', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta name="theme-color" content="#0B1220"/>
  <title>DevPortal</title>
  <!-- Modern UI Font -->
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet"/>
  <!-- Icons -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.1/css/all.min.css"/>
  <!-- App CSS -->
  <link rel="stylesheet" href="/static/styles.css"/>
  <!-- Scripts -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/dayjs@1.11.10/dayjs.min.js"></script>
</head>
<body>
  <div id="app"></div>
  <script src="/static/app.js"></script>
  <script src="/static/pages.js"></script>
  <script src="/static/pages2.js"></script>
  <script src="/static/enterprise.js"></script>
  <script src="/static/enterprise2.js"></script>
  <script src="/static/client-portal.js"></script>
  <script src="/static/project-extensions.js"></script>
</body>
</html>`)
})

export default app
