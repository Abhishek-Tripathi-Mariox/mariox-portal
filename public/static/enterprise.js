// ═══════════════════════════════════════════════════════════
// enterprise.js  – Super Admin, PM, Developer pages + Kanban
// ═══════════════════════════════════════════════════════════

let _projectsPageLimit = 10
let _sprintsPageLimit = 10
let _milestonesPageLimit = 10
let _myTasksPageLimit = 10
let _resourcesPageLimit = 10
let _approvalQueuePageLimit = 10
let _clientsPageLimit = 10
let _teamOverviewPageLimit = 10
let _billingInvoiceLimit = 10

let _projectsListPage = 1
let _sprintsViewPage = 1
let _milestonesViewPage = 1
let _myTasksPage = 1
let _resourcesPage = 1
let _approvalQueuePage = 1
let _clientsListPage = 1
let _teamOverviewPage = 1
let _billingInvoicePage = 1

const ENTERPRISE_PAGE_SIZE_OPTIONS = window.PAGE_SIZE_OPTIONS || [10, 15, 20, 25, 50, 100, 200]

function normalizePageSize(limit, fallback = 10) {
  const next = Number(limit)
  return ENTERPRISE_PAGE_SIZE_OPTIONS.includes(next) ? next : fallback
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const pageSizeRegistry = {
  'projects-list': {
    getPage: () => _projectsListPage,
    setPage: value => { _projectsListPage = Math.max(1, Number(value) || 1) },
    getLimit: () => _projectsPageLimit,
    setLimit: value => { _projectsPageLimit = normalizePageSize(value, _projectsPageLimit) },
  },
  'sprints-view': {
    getPage: () => _sprintsViewPage,
    setPage: value => { _sprintsViewPage = Math.max(1, Number(value) || 1) },
    getLimit: () => _sprintsPageLimit,
    setLimit: value => { _sprintsPageLimit = normalizePageSize(value, _sprintsPageLimit) },
  },
  'milestones-view': {
    getPage: () => _milestonesViewPage,
    setPage: value => { _milestonesViewPage = Math.max(1, Number(value) || 1) },
    getLimit: () => _milestonesPageLimit,
    setLimit: value => { _milestonesPageLimit = normalizePageSize(value, _milestonesPageLimit) },
  },
  'my-tasks': {
    getPage: () => _myTasksPage,
    setPage: value => { _myTasksPage = Math.max(1, Number(value) || 1) },
    getLimit: () => _myTasksPageLimit,
    setLimit: value => { _myTasksPageLimit = normalizePageSize(value, _myTasksPageLimit) },
  },
  'resources-view': {
    getPage: () => _resourcesPage,
    setPage: value => { _resourcesPage = Math.max(1, Number(value) || 1) },
    getLimit: () => _resourcesPageLimit,
    setLimit: value => { _resourcesPageLimit = normalizePageSize(value, _resourcesPageLimit) },
  },
  'approval-queue': {
    getPage: () => _approvalQueuePage,
    setPage: value => { _approvalQueuePage = Math.max(1, Number(value) || 1) },
    getLimit: () => _approvalQueuePageLimit,
    setLimit: value => { _approvalQueuePageLimit = normalizePageSize(value, _approvalQueuePageLimit) },
  },
  'clients-list': {
    getPage: () => _clientsListPage,
    setPage: value => { _clientsListPage = Math.max(1, Number(value) || 1) },
    getLimit: () => _clientsPageLimit,
    setLimit: value => { _clientsPageLimit = normalizePageSize(value, _clientsPageLimit) },
  },
  'team-overview': {
    getPage: () => _teamOverviewPage,
    setPage: value => { _teamOverviewPage = Math.max(1, Number(value) || 1) },
    getLimit: () => _teamOverviewPageLimit,
    setLimit: value => { _teamOverviewPageLimit = normalizePageSize(value, _teamOverviewPageLimit) },
  },
  'billing-admin': {
    getPage: () => _billingInvoicePage,
    setPage: value => { _billingInvoicePage = Math.max(1, Number(value) || 1) },
    getLimit: () => _billingInvoiceLimit,
    setLimit: value => { _billingInvoiceLimit = normalizePageSize(value, _billingInvoiceLimit) },
  },
}

function setEnterprisePageSize(pageKey, limit) {
  const entry = pageSizeRegistry[pageKey]
  if (!entry) return
  const nextLimit = normalizePageSize(limit, entry.getLimit())
  if (nextLimit === entry.getLimit()) return
  entry.setLimit(nextLimit)
  entry.setPage(1)
  rerenderEnterprisePage(pageKey, () => {})
}

window.setEnterprisePageSize = setEnterprisePageSize

function rerenderEnterprisePage(page, stateSetter) {
  stateSetter()
  const el = document.getElementById('page-' + page)
  if (el) {
    el.dataset.loaded = ''
    loadPage(page, el)
  }
}

/* ── SUPER ADMIN DASHBOARD ──────────────────────────────── */
async function renderSuperDashboard(el) {
  el.innerHTML = `<div class="page-header"><div><h1 class="page-title">Super Admin Overview</h1><p class="page-subtitle">Platform health, billing, and team metrics</p></div><div class="page-actions"><button class="btn btn-primary" onclick="Router.navigate('billing-admin')"><i class="fas fa-file-invoice-dollar"></i>Manage Billing</button></div></div><div style="display:flex;align-items:center;gap:10px;color:#64748b"><i class="fas fa-spinner fa-spin"></i> Loading…</div>`
  try {
    const [dash, invoiceData, clientsData] = await Promise.all([
      API.get('/dashboard/pm'),
      API.get('/invoices'),
      API.get('/clients')
    ])
    const d = dash.data || {}
    const inv = invoiceData.summary || {}
    const clients = clientsData.clients || []
    const activeClients = clients.filter(c=>c.project_count>0).length

    el.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Super Admin Overview</h1><p class="page-subtitle">Platform health, billing, and team metrics</p></div>
      <div class="page-actions">
        <button class="btn btn-outline" onclick="Router.navigate('clients-list')"><i class="fas fa-building"></i>Clients</button>
        <button class="btn btn-primary" onclick="Router.navigate('billing-admin')"><i class="fas fa-file-invoice-dollar"></i>Billing</button>
      </div>
    </div>
    <div class="grid-4" style="margin-bottom:20px">
      ${statCard('Total Projects', d.projects?.total||0, 'fas fa-layer-group', '#FF7A45', `${d.projects?.active||0} active`)}
      ${statCard('Active Clients', activeClients, 'fas fa-building', '#F4C842', `${clients.length} total`)}
      ${statCard('Total Revenue', '₹'+fmtNum(inv.total_value||0), 'fas fa-indian-rupee-sign', '#58C68A', `₹${fmtNum(inv.total_paid||0)} collected`)}
      ${statCard('Pending Invoices', inv.overdue_count||0, 'fas fa-exclamation-circle', '#FF5E3A', `₹${fmtNum(inv.total_overdue||0)} overdue`)}
    </div>
    <div class="grid-2" style="margin-bottom:20px">
      ${statCard('Allocated Hours', fmtNum(d.hours?.total_allocated||0)+'h', 'fas fa-clock', '#C56FE6', `${fmtNum(d.hours?.total_consumed||0)}h consumed`)}
      ${statCard('Team Members', (d.developers?.total||0)+' devs', 'fas fa-users', '#FFCB47', `${d.developers?.active||0} active`)}
    </div>
    <div class="grid-2" style="margin-bottom:20px">
      <div class="card">
        <div class="card-header"><span style="font-weight:600">Project Health</span><button class="btn btn-sm btn-outline" onclick="Router.navigate('projects-list')">View All</button></div>
        <div class="card-body p-0">
          <table class="data-table">
            <thead><tr><th>Project</th><th>Client</th><th>Status</th><th>Burn</th><th>Health</th></tr></thead>
            <tbody>${(d.top_projects||[]).map(p=>`
              <tr>
                <td><div style="font-weight:500;color:#e2e8f0">${p.name}</div><div style="font-size:11px;color:#64748b">${p.code}</div></td>
                <td><span style="font-size:12px;color:#94a3b8">—</span></td>
                <td>${statusBadge(p.status)}</td>
                <td>
                  <div style="display:flex;align-items:center;gap:8px">
                    <div class="progress-bar" style="width:80px"><div class="progress-fill ${p.burn_pct>=90?'rose':p.burn_pct>=70?'amber':'green'}" style="width:${Math.min(p.burn_pct,100)}%"></div></div>
                    <span style="font-size:12px;color:${pctColor(p.burn_pct)}">${p.burn_pct?.toFixed(0)}%</span>
                  </div>
                </td>
                <td>${p.burn_pct>=90?'🔴 Critical':p.burn_pct>=70?'🟡 Warning':'🟢 Healthy'}</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span style="font-weight:600">Recent Invoices</span><button class="btn btn-sm btn-outline" onclick="Router.navigate('billing-admin')">Manage</button></div>
        <div class="card-body p-0">
          <table class="data-table">
            <thead><tr><th>Invoice</th><th>Amount</th><th>Status</th><th>Due</th></tr></thead>
            <tbody>${(invoiceData.invoices||[]).slice(0,6).map(i=>`
              <tr>
                <td><div style="font-weight:500;font-size:12px;color:#e2e8f0">${i.invoice_number}</div><div style="font-size:11px;color:#64748b">${i.company_name||'—'}</div></td>
                <td style="font-weight:600;color:#58C68A">${fmtCurrency(i.total_amount)}</td>
                <td><span class="badge ${invoiceStatusClass(i.status)}">${i.status}</span></td>
                <td style="font-size:12px;color:${new Date(i.due_date)<new Date()&&i.status!=='paid'?'#FF5E3A':'#94a3b8'}">${fmtDate(i.due_date)}</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><span style="font-weight:600">Developer Utilization</span></div>
      <div class="card-body p-0">
        <table class="data-table">
          <thead><tr><th>Developer</th><th>Monthly Capacity</th><th>Consumed This Month</th><th>Utilization</th><th>Projects</th></tr></thead>
          <tbody>${(d.utilization||[]).map(u=>`
            <tr>
              <td><div style="display:flex;align-items:center;gap:8px">${avatar(u.full_name,u.avatar_color,'sm')}<div><div style="font-weight:500;color:#e2e8f0">${u.full_name}</div><div style="font-size:11px;color:#64748b">${u.designation}</div></div></div></td>
              <td>${u.monthly_available_hours}h</td>
              <td>${u.monthly_consumed}h</td>
              <td>
                <div style="display:flex;align-items:center;gap:8px">
                  <div class="progress-bar" style="width:100px"><div class="progress-fill ${u.utilization_pct>=80?'rose':u.utilization_pct>=50?'amber':'green'}" style="width:${Math.min(u.utilization_pct,100)}%"></div></div>
                  <span style="font-size:12px;color:${pctColor(u.utilization_pct)}">${u.utilization_pct}%</span>
                </div>
              </td>
              <td>${u.project_count}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`
  } catch(e) { el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Failed to load: ${e.message}</p></div>` }
}

function invoiceStatusClass(s) {
  return { paid:'badge-done', pending:'badge-todo', sent:'badge-inprogress', overdue:'badge-blocked', partially_paid:'badge-review', cancelled:'badge-todo' }[s] || 'badge-todo'
}

function statCard(label, value, icon, color, sub='') {
  return `<div class="stat-card">
    <div style="display:flex;align-items:flex-start;justify-content:space-between">
      <div>
        <div class="stat-label">${label}</div>
        <div class="stat-value">${value}</div>
        ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
      </div>
      <div class="stat-icon" style="background:${color}22;color:${color}"><i class="${icon}"></i></div>
    </div>
  </div>`
}

function listSectionHeader(labels, templateColumns) {
  return `
    <div class="card" style="margin-bottom:12px;padding:14px 16px;background:rgba(15,23,42,.72);border:1px solid rgba(148,163,184,.22);box-shadow:none">
      <div style="display:grid;grid-template-columns:${templateColumns};gap:12px;align-items:center;font-size:12px;letter-spacing:.03em;color:#f8fafc;font-weight:700">
        ${labels.map((label, index) => `<div style="${index === 0 ? 'padding-left:2px' : ''}">${label}</div>`).join('')}
      </div>
    </div>
  `
}

function showEditProjectModal(projectId) {
  return openProjectModal(projectId)
}
function showCreateProjectModal() {
  return openProjectModal()
}

function goProjectsPage(page) {
  _projectsListPage = Math.max(1, Number(page) || 1)
  rerenderEnterprisePage('projects-list', () => {})
}

function goSprintsPage(page) {
  _sprintsViewPage = Math.max(1, Number(page) || 1)
  rerenderEnterprisePage('sprints-view', () => {})
}

function goMilestonesPage(page) {
  _milestonesViewPage = Math.max(1, Number(page) || 1)
  rerenderEnterprisePage('milestones-view', () => {})
}

function goMyTasksPage(page) {
  _myTasksPage = Math.max(1, Number(page) || 1)
  rerenderEnterprisePage('my-tasks', () => {})
}

function goResourcesPage(page) {
  _resourcesPage = Math.max(1, Number(page) || 1)
  rerenderEnterprisePage('resources-view', () => {})
}

function goApprovalQueuePage(page) {
  _approvalQueuePage = Math.max(1, Number(page) || 1)
  rerenderEnterprisePage('approval-queue', () => {})
}

function goClientsPage(page) {
  _clientsListPage = Math.max(1, Number(page) || 1)
  rerenderEnterprisePage('clients-list', () => {})
}

function goTeamOverviewPage(page) {
  _teamOverviewPage = Math.max(1, Number(page) || 1)
  rerenderEnterprisePage('team-overview', () => {})
}

/* ── PM DASHBOARD ────────────────────────────────────────── */
async function renderPMDashboard(el) {
  el.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:24px;color:#64748b"><i class="fas fa-spinner fa-spin"></i> Loading PM dashboard…</div>`
  try {
    const [dash, tasks, sprints] = await Promise.all([
      API.get('/dashboard/pm'),
      API.get('/tasks'),
      API.get('/sprints')
    ])
    const d = dash.data || {}
    const allTasks = tasks.tasks || []
    const allSprints = sprints.sprints || []
    const activeSprint = allSprints.find(s=>s.status==='active')

    // Task status breakdown
    const statusCounts = {}
    allTasks.forEach(t => { statusCounts[t.status] = (statusCounts[t.status]||0)+1 })

    el.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">PM Dashboard</h1><p class="page-subtitle">Sprint progress, task health, and team allocation</p></div>
      <div class="page-actions">
        <button class="btn btn-outline" onclick="Router.navigate('kanban-board')"><i class="fas fa-columns"></i>Kanban</button>
        <button class="btn btn-primary" onclick="showCreateTaskModal()"><i class="fas fa-plus"></i>New Task</button>
      </div>
    </div>
    <div class="grid-4" style="margin-bottom:20px">
      ${statCard('Active Projects', d.projects?.active||0, 'fas fa-layer-group', '#FF7A45', `${d.projects?.total||0} total`)}
      ${statCard('Open Tasks', allTasks.filter(t=>t.status!=='done').length, 'fas fa-list-check', '#F4C842', `${allTasks.filter(t=>t.status==='blocked').length} blocked`)}
      ${statCard('Team Members', d.developers?.total||0, 'fas fa-users', '#58C68A', `${d.developers?.active||0} active`)}
      ${statCard('Hours Consumed', fmtNum(d.hours?.total_consumed||0)+'h', 'fas fa-clock', '#FFCB47', `${fmtNum(d.hours?.total_remaining||0)}h remaining`)}
    </div>
    ${activeSprint ? `
    <div class="sprint-header" style="margin-bottom:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div><span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px">Active Sprint</span><div style="font-size:16px;font-weight:600;color:#e2e8f0;margin-top:2px">${activeSprint.name}</div><div style="font-size:12px;color:#64748b">${fmtDate(activeSprint.start_date)} – ${fmtDate(activeSprint.end_date)}</div></div>
        <button class="btn btn-sm btn-outline" onclick="Router.navigate('kanban-board')">Open Board <i class="fas fa-arrow-right"></i></button>
      </div>
      <div style="display:flex;gap:24px;margin-bottom:10px">
        ${[['Total Points', activeSprint.total_story_points||0,'#94a3b8'],['Done', activeSprint.completed_story_points||0,'#58C68A'],['Tasks', activeSprint.task_count||0,'#FF7A45'],['Blocked', activeSprint.blocked_count||0,'#FF5E3A']].map(([l,v,c])=>`<div class="sprint-stat"><div class="val" style="color:${c}">${v}</div><div class="lbl">${l}</div></div>`).join('')}
      </div>
      <div class="progress-bar xl"><div class="progress-fill ${((activeSprint.completed_story_points/Math.max(activeSprint.total_story_points,1))*100)>=80?'green':'blue'}" style="width:${Math.min((activeSprint.completed_story_points/Math.max(activeSprint.total_story_points,1))*100,100)}%"></div></div>
    </div>` : ''}
    <div class="grid-2" style="margin-bottom:20px">
      <div class="card">
        <div class="card-header"><span style="font-weight:600">Task Status Breakdown</span><button class="btn btn-sm btn-outline" onclick="Router.navigate('kanban-board')">Kanban</button></div>
        <div class="card-body">
          <canvas id="task-status-chart" height="200"></canvas>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span style="font-weight:600">My Open Tasks</span></div>
        <div style="max-height:280px;overflow-y:auto">
          ${allTasks.filter(t=>t.status!=='done').slice(0,6).map(t=>`
            <div style="padding:10px 16px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .15s" onmouseenter="this.style.background='var(--hover)'" onmouseleave="this.style.background=''" onclick="openTaskDrawer('${t.id}')">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                ${taskTypeIcon(t.task_type)}${priorityBadge(t.priority)}
                ${t.status==='blocked'?'<span style="color:#FF5E3A;font-size:11px"><i class="fas fa-ban"></i> Blocked</span>':''}
              </div>
              <div style="font-size:13px;color:#e2e8f0;font-weight:500">${t.title}</div>
              <div style="font-size:11px;color:#64748b;margin-top:2px">${t.project_name||'—'} • ${t.assignee_name||'Unassigned'}</div>
            </div>`).join('') || '<div class="empty-state"><i class="fas fa-check-circle"></i><p>No open tasks</p></div>'}
        </div>
      </div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-header"><span style="font-weight:600">Top Projects by Burn Rate</span></div>
        <div class="card-body p-0">
          ${(d.top_projects||[]).map(p=>`
            <div style="padding:12px 16px;border-bottom:1px solid rgba(30,30,69,.5)">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
                <div><span style="font-size:13px;font-weight:500;color:#e2e8f0">${p.name}</span> <span style="font-size:11px;color:#475569">${p.code}</span></div>
                <span style="font-size:12px;font-weight:600;color:${pctColor(p.burn_pct)}">${p.burn_pct?.toFixed(0)}%</span>
              </div>
              <div class="progress-bar"><div class="progress-fill ${p.burn_pct>=90?'rose':p.burn_pct>=70?'amber':'green'}" style="width:${Math.min(p.burn_pct,100)}%"></div></div>
              <div style="font-size:11px;color:#64748b;margin-top:4px">${p.consumed_hours}h of ${p.total_allocated_hours}h used</div>
            </div>`).join('')}
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span style="font-weight:600">Recent Activity</span><button class="btn btn-sm btn-outline" onclick="Router.navigate('reports-view')">View Reports</button></div>
        <div style="max-height:300px;overflow-y:auto;padding:12px 16px">
          ${(d.recent_logs||[]).slice(0,6).map(log=>`
            <div class="feed-item">
              ${avatar(log.full_name||'?', log.avatar_color||'#FF7A45','sm')}
              <div class="feed-content">
                <div class="feed-title"><strong>${log.full_name}</strong> logged ${log.hours_consumed}h on ${log.project_name}</div>
                <div class="feed-time">${log.module_name} • ${fmtDate(log.date)}</div>
              </div>
            </div>`).join('') || '<div class="empty-state" style="padding:20px"><p>No recent activity</p></div>'}
        </div>
      </div>
    </div>`

    // Draw chart
    setTimeout(() => {
      const ctx = document.getElementById('task-status-chart')
      if (!ctx) return
      const labels = ['Backlog','To Do','In Progress','In Review','QA','Done','Blocked']
      const keys   = ['backlog','todo','in_progress','in_review','qa','done','blocked']
      const colors = ['#475569','#94a3b8','#F4C842','#C56FE6','#FFA577','#58C68A','#FF5E3A']
      new Chart(ctx, { type:'doughnut', data:{ labels, datasets:[{ data: keys.map(k=>statusCounts[k]||0), backgroundColor: colors, borderColor: '#1F0F08', borderWidth: 2 }] }, options:{ responsive:true, plugins:{ legend:{ position:'right', labels:{ color:'#94a3b8', font:{size:11} } } } } })
    }, 100)
  } catch(e) { el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>` }
}

/* ── DEV DASHBOARD ───────────────────────────────────────── */
async function renderDevDashboard(el) {
  el.innerHTML = `<div style="padding:24px;color:#64748b"><i class="fas fa-spinner fa-spin"></i> Loading…</div>`
  try {
    // Some login flows store the user id under `id`, JWT-issued ones under `sub`.
    // Always resolve to a real id so server-side `user_id` filters don't get the
    // literal string "undefined".
    const myId = _user?.sub || _user?.id || ''
    const [myTasks, timesheets, allocations] = await Promise.all([
      API.get('/tasks?assignee_id=' + myId),
      API.get('/timesheets?user_id=' + myId),
      API.get('/allocations?user_id=' + myId)
    ])
    const tasks = myTasks.tasks || []
    const logs = timesheets.timesheets || timesheets || []
    const allocs = allocations.data || allocations.allocations || []
    const totalLogged = logs.reduce((s,l)=>s+(l.hours_consumed||0), 0)
    const totalAllocated = allocs.reduce((s,a)=>s+(a.allocated_hours||0), 0)
    const todayLogs = logs.filter(l=>l.date===dayjs().format('YYYY-MM-DD'))
    const todayHours = todayLogs.reduce((s,l)=>s+(l.hours_consumed||0),0)

    el.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">My Dashboard</h1><p class="page-subtitle">Your tasks, timesheets, and project assignments</p></div>
      <div class="page-actions">
        <button class="btn btn-primary" onclick="Router.navigate('timesheets-view')"><i class="fas fa-plus"></i>Log Hours</button>
      </div>
    </div>
    <div class="grid-4" style="margin-bottom:20px">
      ${statCard("Today's Hours", todayHours+'h', 'fas fa-sun', '#FFCB47', `${8-todayHours}h remaining`)}
      ${statCard('Open Tasks', tasks.filter(t=>t.status!=='done').length, 'fas fa-list-check', '#FF7A45', `${tasks.filter(t=>t.status==='in_progress').length} in progress`)}
      ${statCard('Hours This Month', totalLogged+'h', 'fas fa-clock', '#58C68A', `of ${totalAllocated}h allocated`)}
      ${statCard('Blocked Tasks', tasks.filter(t=>t.status==='blocked').length, 'fas fa-ban', '#FF5E3A', 'needs attention')}
    </div>
    <div class="grid-2" style="margin-bottom:20px">
      <div class="card">
        <div class="card-header"><span style="font-weight:600">My Active Tasks</span><button class="btn btn-sm btn-outline" onclick="Router.navigate('my-tasks')">All Tasks</button></div>
        <div>
          ${tasks.filter(t=>['in_progress','todo','blocked'].includes(t.status)).slice(0,6).map(t=>`
            <div style="padding:12px 16px;border-bottom:1px solid var(--border);cursor:pointer" onclick="openTaskDrawer('${t.id}')">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                ${taskTypeIcon(t.task_type)}${priorityBadge(t.priority)}${statusBadge(t.status)}
              </div>
              <div style="font-size:13px;font-weight:500;color:#e2e8f0">${t.title}</div>
              <div style="font-size:11px;color:#64748b;margin-top:2px">${t.project_name||'—'} • Due: ${fmtDate(t.due_date)}</div>
              <div style="margin-top:6px">
                <div class="progress-bar"><div class="progress-fill blue" style="width:${Math.min(((t.logged_hours||0)/(t.estimated_hours||1))*100,100)}%"></div></div>
              </div>
            </div>`).join('') || '<div class="empty-state" style="padding:20px"><i class="fas fa-check-double"></i><p>All tasks complete!</p></div>'}
        </div>
      </div>
      <div class="card">
        <div class="card-header"><span style="font-weight:600">My Projects & Hours</span></div>
        <div class="card-body p-0">
          <table class="data-table">
            <thead><tr><th>Project</th><th>Allocated</th><th>Consumed</th><th>Left</th></tr></thead>
            <tbody>${allocs.map(a=>`
              <tr>
                <td><div style="font-weight:500;color:#e2e8f0">${a.project_name||a.project_id}</div><span class="badge ${a.role==='lead'?'badge-inprogress':'badge-todo'}">${a.role}</span></td>
                <td>${a.allocated_hours}h</td>
                <td>${a.consumed_hours}h</td>
                <td style="color:${(a.allocated_hours-a.consumed_hours)<=8?'#FF5E3A':'#58C68A'}">${a.allocated_hours-a.consumed_hours}h</td>
              </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:#64748b;padding:20px">No allocations</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><span style="font-weight:600">Recent Timesheet Entries</span><button class="btn btn-sm btn-primary" onclick="Router.navigate('timesheets-view')"><i class="fas fa-plus"></i>Log Today</button></div>
      <div class="card-body p-0">
        <table class="data-table">
          <thead><tr><th>Date</th><th>Project</th><th>Task / Module</th><th>Hours</th><th>Status</th></tr></thead>
          <tbody>${(Array.isArray(logs)?logs:logs.timesheets||[]).slice(0,8).map(l=>`
            <tr>
              <td>${fmtDate(l.date)}</td>
              <td>${l.project_name||l.project_id}</td>
              <td><div style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.task_description}</div></td>
              <td><strong>${l.hours_consumed}h</strong></td>
              <td>${statusBadge(l.approval_status)}</td>
            </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:20px">No logs yet</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`
  } catch(e) { el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>` }
}

/* ── PROJECTS LIST ───────────────────────────────────────── */
async function renderProjectsList(el) {
  el.innerHTML = `<div style="padding:24px;color:#64748b"><i class="fas fa-spinner fa-spin"></i> Loading projects…</div>`
  try {
    const [proj, clients] = await Promise.all([API.get('/projects'), API.get('/clients').catch(()=>({clients:[]}))])
    const projects = proj.projects || proj || []
    const clientMap = {}
    ;(clients.clients||[]).forEach(c => clientMap[c.id]=c)
    const pagination = paginateClient(projects, _projectsListPage, _projectsPageLimit)
    _projectsListPage = pagination.page
    const visibleProjects = pagination.items

    el.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Projects</h1><p class="page-subtitle">${pagination.total} total projects</p></div>
      <div class="page-actions">
        <div class="search-wrap"><i class="fas fa-search"></i><input class="search-bar" placeholder="Search projects…" oninput="filterTable(this.value,'proj-table')"/></div>
        ${['admin','pm'].includes(_user.role)?`<button class="btn btn-primary" onclick="openProjectModal()"><i class="fas fa-plus"></i>New Project</button>`:''}
      </div>
    </div>
    <div class="card">
      <div class="card-body p-0 table-wrap">
        <table class="data-table" id="proj-table">
          <thead><tr><th>Project</th><th>Client</th><th>PM</th><th>Status</th><th>Priority</th>${_user.role !== 'team' ? '<th>Progress</th><th>Hours</th>' : ''}<th>Due Date</th><th>Actions</th></tr></thead>
          <tbody>
            ${visibleProjects.map(p=>{
              const cl = p.client_id ? clientMap[p.client_id] : null
              const burnPct = p.total_allocated_hours>0 ? Math.round((p.consumed_hours/p.total_allocated_hours)*100) : 0
              return `<tr>
                <td>
                  <div style="font-weight:600;color:#e2e8f0">${p.name}</div>
                  <div style="font-size:11px;color:#475569;font-family:monospace">${p.code}</div>
                </td>
                <td>${cl ? `<div style="display:flex;align-items:center;gap:6px">${avatar(cl.company_name,cl.avatar_color,'sm')}<span style="font-size:12px">${cl.company_name}</span></div>` : `<span style="color:#475569;font-size:12px">${p.client_name||'—'}</span>`}</td>
                <td><span style="font-size:12px;color:#94a3b8">${p.pm_name||'—'}</span></td>
                <td>${statusBadge(p.status)}</td>
                <td>${priorityBadge(p.priority)}</td>
                ${_user.role !== 'team' ? `
                <td style="min-width:120px">
                  <div style="display:flex;align-items:center;gap:8px">
                    <div class="progress-bar" style="flex:1"><div class="progress-fill ${burnPct>=90?'rose':burnPct>=70?'amber':'green'}" style="width:${Math.min(burnPct,100)}%"></div></div>
                    <span style="font-size:11px;color:${pctColor(burnPct)};min-width:30px">${burnPct}%</span>
                  </div>
                </td>
                <td><span style="font-size:12px">${p.consumed_hours}h / ${p.total_allocated_hours}h</span></td>` : ''}
                <td style="font-size:12px;color:${new Date(p.expected_end_date)<new Date()&&p.status==='active'?'#FF5E3A':'#94a3b8'}">${fmtDate(p.expected_end_date)}</td>
                <td>
                  <div style="display:flex;gap:4px">
                    <button class="btn btn-xs btn-outline" onclick="openProjectBoard('${p.id}','${p.name}')" title="Open Kanban board"><i class="fas fa-columns"></i></button>
                    ${['admin','pm'].includes(_user.role)?`<button class="btn btn-xs btn-outline" onclick="openKanbanPermissionsModal('${p.id}','${p.name.replace(/'/g,"\\'")}')" title="Kanban permissions"><i class="fas fa-shield-alt"></i></button>`:''}
                    ${['admin','pm'].includes(_user.role)?`<button class="btn btn-xs btn-outline" onclick="showEditProjectModal('${p.id}')" title="Edit project"><i class="fas fa-edit"></i></button>`:''}
                  </div>
                </td>
              </tr>`
            }).join('')}
          </tbody>
        </table>
        ${renderPager(pagination, 'goProjectsPage', 'goProjectsPage', 'projects', 'projects-list')}
      </div>
    </div>`
  } catch(e) { el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>` }
}

function openProjectBoard(projectId, name) {
  window._kanbanProjectId = projectId
  window._kanbanProjectName = name
  window._kanbanSprintId = ''
  const el = document.getElementById('page-kanban-board')
  if (el) { el.dataset.loaded = '' }
  Router.navigate('kanban-board')
}

/* ══════════════════════════════════════════════════════════════
   JIRA-STYLE KANBAN BOARD
   - Per-project custom columns (PM configures them)
   - Drag-and-drop between columns
   - WIP limits shown
   - Column management (add/edit/delete) for PM/Admin
══════════════════════════════════════════════════════════════ */
async function renderKanbanBoard(el) {
  el.innerHTML = `<div style="padding:24px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Loading board…</div>`
  try {
    const [proj, spData] = await Promise.all([API.get('/projects'), API.get('/sprints')])
    const projects = proj.projects || proj.data || []
    const allSprints = spData.sprints || []

    // Determine which project to show
    let selProject = window._kanbanProjectId

    // For developers, auto-select their first assigned project
    if (!selProject && _user.role === 'developer') {
      // Find first project where this developer is assigned
      for (const p of projects) {
        try {
          const devsRes = await API.get(`/projects/${p.id}/developers`)
          const myDev = (devsRes.developers || []).find(d => d.user_id === _user.id || d.user_id === _user.sub)
          if (myDev) { selProject = p.id; break }
        } catch(e) {}
      }
    }
    if (!selProject) selProject = projects[0]?.id
    if (!selProject) {
      el.innerHTML = '<div class="empty-state"><i class="fas fa-columns fa-3x" style="color:#FF7A45;margin-bottom:16px"></i><h3>No Projects Found</h3><p>There are no projects available to view.</p></div>'
      return
    }

    const selSprint = window._kanbanSprintId || ''
    const projectSprints = allSprints.filter(s => s.project_id === selProject)
    const projName = window._kanbanProjectName || projects.find(p => p.id === selProject)?.name || ''
    window._kanbanProjectName = projName

    // Load board data (includes column_defs from custom columns)
    const boardData = await API.get(`/tasks/board/${selProject}${selSprint ? '?sprint_id=' + selSprint : ''}`)
    const cols = boardData.columns || {}
    const colDefs = boardData.column_defs || []
    const canManage = ['admin', 'pm'].includes(_user.role)

    // Filter sidebar for active sprint
    const activeSprint = projectSprints.find(s => s.status === 'active')
    const totalTasks = Object.values(cols).reduce((s, tasks) => s + tasks.length, 0)
    const doneTasks = Object.values(cols).filter((tasks, i) => colDefs[i]?.is_done_column).reduce((s, tasks) => s + tasks.length, 0)

    el.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;gap:0">
      <!-- Board Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:0 0 16px 0;flex-wrap:wrap;gap:10px">
        <div style="display:flex;align-items:center;gap:12px">
          <div style="width:36px;height:36px;border-radius:8px;background:linear-gradient(135deg,#FF7A45,#C56FE6);display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <i class="fas fa-columns" style="color:#fff;font-size:15px"></i>
          </div>
          <div>
            <h1 style="font-size:18px;font-weight:700;color:var(--text-primary);margin:0">${projName}</h1>
            <p style="font-size:12px;color:var(--text-muted);margin:0">${totalTasks} tasks • ${colDefs.length} columns</p>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <!-- Project Switcher (visible to PM/Admin) -->
          ${canManage || _user.role === 'developer' ? `
          <select class="form-select" style="min-width:180px;max-width:220px" onchange="switchBoardProject(this.value)">
            ${projects.map(p => `<option value="${p.id}" ${p.id === selProject ? 'selected' : ''}>${p.name}</option>`).join('')}
          </select>` : `<span style="font-size:14px;font-weight:600;color:var(--primary)">${projName}</span>`}
          <!-- Sprint Filter -->
          <select class="form-select" style="min-width:160px" onchange="switchBoardSprint(this.value)">
            <option value="" ${!selSprint ? 'selected' : ''}>All Sprints</option>
            ${projectSprints.map(s => `<option value="${s.id}" ${s.id === selSprint ? 'selected' : ''}>${s.name}${s.status === 'active' ? ' ●' : ''}</option>`).join('')}
          </select>
          ${canManage ? `
          <button class="btn btn-outline btn-sm" onclick="manageBoardColumns('${selProject}')" title="Configure board columns"><i class="fas fa-sliders-h"></i> Columns</button>
          <button class="btn btn-outline btn-sm" onclick="openKanbanPermissionsModal('${selProject}','${projName.replace(/'/g,"\\'")}')" title="Kanban permissions"><i class="fas fa-shield-alt"></i> Permissions</button>
          <button class="btn btn-outline btn-sm" onclick="showProjectTeamsModal('${selProject}','${projName.replace(/'/g,"\\'")}')" title="Project teams"><i class="fas fa-users"></i> Teams</button>
          <button class="btn btn-primary btn-sm" onclick="showCreateTaskModal('${selProject}','${selSprint}','backlog')"><i class="fas fa-plus"></i> Add Task</button>` : ''}
        </div>
      </div>

      <!-- Sprint Progress Bar (if sprint selected) -->
      ${activeSprint && !selSprint ? `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:10px 16px;margin-bottom:14px;display:flex;align-items:center;gap:16px">
        <div style="display:flex;align-items:center;gap:8px">
          <i class="fas fa-bolt" style="color:#FF7A45;font-size:13px"></i>
          <span style="font-size:12px;font-weight:600;color:var(--text-primary)">${activeSprint.name}</span>
          <span class="badge badge-inprogress" style="font-size:10px">Active</span>
        </div>
        <div style="flex:1;display:flex;align-items:center;gap:10px">
          <div style="flex:1;height:6px;background:var(--bg-input);border-radius:3px;overflow:hidden">
            <div style="height:100%;background:#FF7A45;border-radius:3px;width:${activeSprint.total_story_points > 0 ? Math.round((activeSprint.completed_story_points / activeSprint.total_story_points) * 100) : 0}%;transition:.3s"></div>
          </div>
          <span style="font-size:11px;color:var(--text-muted);white-space:nowrap">${activeSprint.completed_story_points||0}/${activeSprint.total_story_points||0} pts</span>
        </div>
        <button class="btn btn-xs btn-outline" onclick="switchBoardSprint('${activeSprint.id}')">Focus Sprint</button>
      </div>` : ''}

      <!-- Kanban Board Scrollable Area -->
      <div style="flex:1;overflow-x:auto;overflow-y:hidden;padding-bottom:8px">
        <div class="kanban-board" id="kanban-board" style="min-height:calc(100vh - 280px)">
          ${buildKanbanColumns(cols, colDefs, selProject, selSprint, canManage)}
        </div>
      </div>
    </div>`

    setupKanbanDragDrop()
  } catch(e) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle" style="color:#FF5E3A"></i><p style="color:#FF5E3A">${e.message}</p></div>`
  }
}

function buildKanbanColumns(cols, colDefs, projectId, sprintId, canManage) {
  if (!colDefs.length) {
    // Fallback default columns
    colDefs = [
      { status_key: 'backlog', name: 'Backlog', color: '#64748b', wip_limit: 0, is_done_column: 0 },
      { status_key: 'todo', name: 'To Do', color: '#94a3b8', wip_limit: 0, is_done_column: 0 },
      { status_key: 'in_progress', name: 'In Progress', color: '#FFA577', wip_limit: 3, is_done_column: 0 },
      { status_key: 'in_review', name: 'In Review', color: '#C56FE6', wip_limit: 0, is_done_column: 0 },
      { status_key: 'qa', name: 'QA', color: '#FFA577', wip_limit: 0, is_done_column: 0 },
      { status_key: 'done', name: 'Done', color: '#58C68A', wip_limit: 0, is_done_column: 1 },
      { status_key: 'blocked', name: 'Blocked', color: '#FF5E3A', wip_limit: 0, is_done_column: 0 },
    ]
  }
  return colDefs.map(col => {
    const tasks = cols[col.status_key] || []
    const wipOver = col.wip_limit > 0 && tasks.length > col.wip_limit
    const wipAt = col.wip_limit > 0 && tasks.length === col.wip_limit
    const wipColor = wipOver ? '#FF5E3A' : wipAt ? '#FFCB47' : col.color
    return `
    <div class="kanban-col" data-status="${col.status_key}" data-col-id="${col.id||''}" style="min-width:260px;max-width:280px">
      <div class="kanban-col-header" style="border-top:3px solid ${col.color}">
        <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0">
          <span style="width:8px;height:8px;border-radius:50%;background:${col.color};flex-shrink:0"></span>
          <span class="col-title" style="font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${col.name}</span>
          <span style="background:${wipColor}22;color:${wipColor};font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px;flex-shrink:0">${tasks.length}${col.wip_limit > 0 ? '/' + col.wip_limit : ''}</span>
          ${col.is_done_column ? '<i class="fas fa-check-circle" style="color:#58C68A;font-size:11px"></i>' : ''}
        </div>
        ${canManage ? `<button onclick="editColumnInline('${col.id||''}','${col.name}','${col.color}',${col.wip_limit},${col.is_done_column})" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:11px;padding:2px 4px;border-radius:4px;flex-shrink:0" title="Edit column"><i class="fas fa-ellipsis-h"></i></button>` : ''}
      </div>
      ${wipOver ? `<div style="font-size:10px;color:#FF5E3A;padding:4px 10px;background:#3A1A14;text-align:center;font-weight:600"><i class="fas fa-exclamation-triangle"></i> WIP limit exceeded</div>` : ''}
      <div class="kanban-tasks" data-status="${col.status_key}" data-project="${projectId}" data-sprint="${sprintId||''}" style="min-height:100px">
        ${tasks.map(t => buildTaskCard(t)).join('')}
      </div>
      ${canManage ? `
      <div class="add-task-btn" onclick="showCreateTaskModal('${projectId}','${sprintId||''}','${col.status_key}')">
        <i class="fas fa-plus"></i> Add task
      </div>` : ''}
    </div>`
  }).join('')
}

function buildTaskCard(t) {
  const typeIcons = { bug: '🐛', story: '📖', task: '✓', epic: '⚡', sub_task: '↳' }
  const typeColors = { bug: '#FF5E3A', story: '#F4C842', task: '#FF7A45', epic: '#FFCB47', sub_task: '#64748b' }
  const prioColors = { critical: '#FF5E3A', high: '#FF7A45', medium: '#FFCB47', low: '#6b7280' }
  const prioIcon = { critical: '🔴', high: '🟠', medium: '🟡', low: '⚪' }
  const isOverdue = t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done'
  return `
  <div class="task-card" draggable="true" data-task-id="${t.id}" onclick="openTaskDrawer('${t.id}')">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
      <span style="font-size:11px;background:${typeColors[t.task_type]||'#FF7A45'}22;color:${typeColors[t.task_type]||'#FF7A45'};padding:1px 6px;border-radius:4px;font-weight:600;letter-spacing:.3px">${(t.task_type||'task').toUpperCase()}</span>
      <span style="font-size:10px;color:var(--text-muted);margin-left:auto;font-family:monospace">#${String(t.id).split('-').pop()}</span>
    </div>
    <div style="font-size:13px;font-weight:500;color:var(--text-primary);line-height:1.4;margin-bottom:8px">${t.title}</div>
    ${t.description ? `<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${t.description}</div>` : ''}
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap">
      ${isOverdue ? `<span style="font-size:10px;color:#FF5E3A;background:#3A1A14;padding:1px 6px;border-radius:4px;font-weight:600"><i class="fas fa-exclamation-circle"></i> Overdue</span>` : ''}
      ${t.due_date ? `<span style="font-size:10px;color:${isOverdue ? '#FF5E3A' : 'var(--text-muted)'}"><i class="fas fa-calendar-alt"></i> ${fmtDate(t.due_date)}</span>` : ''}
      ${t.sprint_name ? `<span style="font-size:10px;color:#FF7A45"><i class="fas fa-bolt"></i> ${t.sprint_name}</span>` : ''}
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between">
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:11px" title="${t.priority||'medium'} priority">${prioIcon[t.priority]||'🟡'}</span>
        ${t.story_points ? `<span style="font-size:10px;background:var(--bg-hover);color:var(--text-muted);padding:1px 5px;border-radius:4px">${t.story_points}sp</span>` : ''}
        ${t.estimated_hours && _user.role !== 'team' ? `<span style="font-size:10px;color:var(--text-muted)"><i class="fas fa-clock"></i> ${t.logged_hours||0}/${t.estimated_hours}h</span>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:4px">
        ${t.subtask_count > 0 ? `<span style="font-size:10px;color:var(--text-muted)"><i class="fas fa-code-branch"></i>${t.subtask_count}</span>` : ''}
        ${t.comment_count > 0 ? `<span style="font-size:10px;color:var(--text-muted)"><i class="fas fa-comment"></i>${t.comment_count}</span>` : ''}
        ${t.assignee_name ? `<div title="${t.assignee_name}" style="width:24px;height:24px;border-radius:50%;background:${t.assignee_color||'#FF7A45'};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;flex-shrink:0">${t.assignee_name.split(' ').map(n=>n[0]).join('').slice(0,2)}</div>` : `<div style="width:24px;height:24px;border-radius:50%;background:var(--bg-hover);display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--text-muted);flex-shrink:0">?</div>`}
      </div>
    </div>
  </div>`
}

function setupKanbanDragDrop() {
  const board = document.getElementById('kanban-board')
  if (!board) return
  let draggedId = null, draggedCard = null

  board.addEventListener('dragstart', e => {
    const card = e.target.closest('.task-card')
    if (!card) return
    draggedId = card.dataset.taskId
    draggedCard = card
    setTimeout(() => card.style.opacity = '0.4', 0)
    e.dataTransfer.effectAllowed = 'move'
  })
  board.addEventListener('dragend', () => {
    if (draggedCard) draggedCard.style.opacity = ''
    board.querySelectorAll('.kanban-tasks').forEach(c => {
      c.classList.remove('kanban-droptarget')
      c.style.background = ''
    })
    draggedId = null; draggedCard = null
  })
  board.addEventListener('dragover', e => {
    e.preventDefault()
    const col = e.target.closest('.kanban-tasks')
    board.querySelectorAll('.kanban-tasks').forEach(c => {
      c.classList.remove('kanban-droptarget')
      c.style.background = ''
    })
    if (col) {
      col.classList.add('kanban-droptarget')
      col.style.background = 'rgba(108,95,252,0.05)'
    }
  })
  board.addEventListener('drop', async e => {
    e.preventDefault()
    const col = e.target.closest('.kanban-tasks')
    if (!col || !draggedId) return
    col.classList.remove('kanban-droptarget')
    col.style.background = ''
    const newStatus = col.dataset.status
    // Check if actually moved
    const card = board.querySelector(`[data-task-id="${draggedId}"]`)
    if (!card) return
    const oldCol = card.closest('.kanban-tasks')
    if (oldCol === col) return
    try {
      await API.patch(`/tasks/${draggedId}/move`, { status: newStatus, position: col.children.length })
      col.appendChild(card)
      card.style.opacity = ''
      // Update counts
      board.querySelectorAll('.kanban-col').forEach(kcol => {
        const header = kcol.querySelector('.col-count, [class*="col-count"]')
        const taskArea = kcol.querySelector('.kanban-tasks')
        if (taskArea) {
          const count = taskArea.querySelectorAll('.task-card').length
          const badge = kcol.querySelector('.kanban-col-header span[style*="border-radius:10px"]')
          if (badge) {
            const wipPart = badge.textContent.includes('/') ? '/' + badge.textContent.split('/')[1] : ''
            badge.textContent = count + wipPart
          }
        }
      })
      toast('Moved to ' + newStatus.replace(/_/g, ' '), 'success', 2000)
    } catch(err) {
      if (card) card.style.opacity = ''
      toast('Failed: ' + err.message, 'error')
    }
  })
}

function switchBoardProject(id) {
  window._kanbanProjectId = id
  window._kanbanSprintId = ''
  window._kanbanProjectName = ''
  const el = document.getElementById('page-kanban-board')
  if (el) { el.dataset.loaded = ''; loadPage('kanban-board', el) }
}
function switchBoardSprint(id) {
  window._kanbanSprintId = id
  const el = document.getElementById('page-kanban-board')
  if (el) { el.dataset.loaded = ''; loadPage('kanban-board', el) }
}

/* ── COLUMN MANAGEMENT (PM/Admin only) ─────────────────────── */
async function manageBoardColumns(projectId) {
  try {
    const data = await API.get(`/tasks/columns/${projectId}`)
    const cols = data.columns || []
    const projData = await API.get('/projects')
    const projName = (projData.projects || projData.data || []).find(p => p.id === projectId)?.name || projectId
    showModal(`
    <div class="modal-header">
      <h3 style="display:flex;align-items:center;gap:8px"><i class="fas fa-columns" style="color:#FF7A45"></i> Board Columns — ${projName}</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:16px">Configure the columns (stages/levels) for this project's Kanban board. Drag to reorder, set WIP limits, or add custom columns.</p>
      <div id="col-list" style="display:flex;flex-direction:column;gap:8px">
        ${cols.map((col, i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg-input);border-radius:8px;border:1px solid var(--border)" data-col-id="${col.id}">
          <span style="width:12px;height:12px;border-radius:50%;background:${col.color};flex-shrink:0"></span>
          <span style="font-weight:600;font-size:13px;flex:1;color:var(--text-primary)">${col.name}</span>
          ${col.wip_limit > 0 ? `<span style="font-size:11px;color:#FFCB47;background:rgba(255,203,71,.1);padding:1px 6px;border-radius:4px">WIP: ${col.wip_limit}</span>` : ''}
          ${col.is_done_column ? `<span style="font-size:11px;color:#58C68A;background:rgba(88,198,138,.1);padding:1px 6px;border-radius:4px"><i class="fas fa-check"></i> Done</span>` : ''}
          <div style="display:flex;gap:4px">
            <button onclick="editColumnModal('${col.id}','${col.name}','${col.color}',${col.wip_limit},${col.is_done_column},'${projectId}')" class="btn btn-xs btn-outline" title="Edit"><i class="fas fa-pencil"></i></button>
            ${cols.length > 1 ? `<button onclick="deleteColumn('${col.id}','${projectId}')" class="btn btn-xs btn-outline" style="color:#FF5E3A;border-color:#FF5E3A" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
          </div>
        </div>`).join('')}
      </div>
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
        <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
          <div class="form-group" style="flex:1;min-width:140px;margin:0">
            <label class="form-label">New Column Name</label>
            <input class="form-input" id="new-col-name" placeholder="e.g., UAT, Staging, Deploy…"/>
          </div>
          <div class="form-group" style="width:100px;margin:0">
            <label class="form-label">WIP Limit</label>
            <input class="form-input" type="number" id="new-col-wip" value="0" min="0" placeholder="0 = unlimited"/>
          </div>
          <div class="form-group" style="width:80px;margin:0">
            <label class="form-label">Color</label>
            <input type="color" id="new-col-color" value="#FF7A45" class="form-input" style="height:38px;padding:2px 4px"/>
          </div>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;color:var(--text-muted);margin-bottom:2px"><input type="checkbox" id="new-col-done" style="accent-color:#58C68A"/> Done column</label>
          <button class="btn btn-primary btn-sm" onclick="addBoardColumn('${projectId}')"><i class="fas fa-plus"></i> Add Column</button>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Close</button>
    </div>`, 'modal-lg')
  } catch(e) { toast(e.message, 'error') }
}

async function addBoardColumn(projectId) {
  const name = document.getElementById('new-col-name')?.value?.trim()
  const wip_limit = parseInt(document.getElementById('new-col-wip')?.value || '0')
  const color = document.getElementById('new-col-color')?.value || '#FF7A45'
  const is_done_column = document.getElementById('new-col-done')?.checked ? 1 : 0
  if (!name) return toast('Enter a column name', 'error')
  try {
    await API.post(`/tasks/columns/${projectId}`, { name, color, wip_limit, is_done_column })
    toast('Column added!', 'success')
    closeModal()
    manageBoardColumns(projectId)
  } catch(e) { toast(e.message, 'error') }
}

function editColumnModal(colId, name, color, wipLimit, isDone, projectId) {
  showModal(`
  <div class="modal-header"><h3>Edit Column</h3><button class="close-btn" onclick="closeModal()">✕</button></div>
  <div class="modal-body">
    <div class="form-group"><label class="form-label">Column Name *</label><input class="form-input" id="ec-name" value="${name}"/></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Color</label><input type="color" class="form-input" id="ec-color" value="${color}" style="height:38px;padding:2px 4px"/></div>
      <div class="form-group"><label class="form-label">WIP Limit (0=unlimited)</label><input class="form-input" type="number" id="ec-wip" value="${wipLimit}" min="0"/></div>
    </div>
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px"><input type="checkbox" id="ec-done" ${isDone?'checked':''} style="accent-color:#58C68A"/> Mark as Done/Completion column</label>
  </div>
  <div class="modal-footer">
    <button class="btn btn-outline" onclick="manageBoardColumns('${projectId}')">Back</button>
    <button class="btn btn-primary" onclick="saveColumnEdit('${colId}','${projectId}')"><i class="fas fa-save"></i> Save</button>
  </div>`)
}

async function saveColumnEdit(colId, projectId) {
  const name = document.getElementById('ec-name')?.value?.trim()
  const color = document.getElementById('ec-color')?.value
  const wip_limit = parseInt(document.getElementById('ec-wip')?.value || '0')
  const is_done_column = document.getElementById('ec-done')?.checked ? 1 : 0
  if (!name) return toast('Name required', 'error')
  try {
    await API.put(`/tasks/columns/${colId}`, { name, color, wip_limit, is_done_column })
    toast('Column updated!', 'success')
    closeModal()
    const el = document.getElementById('page-kanban-board')
    if (el) { el.dataset.loaded = ''; loadPage('kanban-board', el) }
  } catch(e) { toast(e.message, 'error') }
}

async function deleteColumn(colId, projectId) {
  if (!confirm('Delete this column? Tasks in it will move to Backlog.')) return
  try {
    await API.delete(`/tasks/columns/${colId}`)
    toast('Column deleted', 'success')
    manageBoardColumns(projectId)
    const el = document.getElementById('page-kanban-board')
    if (el) { el.dataset.loaded = ''; loadPage('kanban-board', el) }
  } catch(e) { toast(e.message, 'error') }
}

function editColumnInline(colId, name, color, wipLimit, isDone) {
  if (!colId) return
  const projectId = window._kanbanProjectId
  editColumnModal(colId, name, color, wipLimit, isDone, projectId)
}

/* ── TASK DRAWER ────────────────────────────────────────── */
async function openTaskDrawer(taskId) {
  openDrawer(`<div style="padding:20px;color:#64748b"><i class="fas fa-spinner fa-spin"></i> Loading task…</div>`)
  try {
    const data = await API.get('/tasks/' + taskId)
    const t = data.task
    const subtasks = data.subtasks||[]
    const comments = data.comments||[]
    const activity = data.activity||[]

    const drawerHTML = `
    <div class="detail-header" style="padding:18px 22px;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        ${taskTypeIcon(t.task_type)}<span style="font-size:11px;color:#475569;font-family:monospace">${t.id}</span>
        ${statusBadge(t.status)}${priorityBadge(t.priority)}
        <button class="close-btn" onclick="closeDrawer()" style="margin-left:auto"><i class="fas fa-times"></i></button>
      </div>
      <div style="font-size:17px;font-weight:600;color:#fff;line-height:1.4">${t.title}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:14px 22px;border-bottom:1px solid var(--border)">
      ${metaItem('Assignee', t.assignee_name ? `${avatar(t.assignee_name,t.assignee_color||'#FF7A45','sm')} ${t.assignee_name}` : '—')}
      ${metaItem('Reporter', t.reporter_name||'—')}
      ${metaItem('Project', t.project_name||'—')}
      ${metaItem('Sprint', t.sprint_name||'—')}
      ${metaItem('Due Date', `<span style="color:${t.due_date&&new Date(t.due_date)<new Date()?'#FF5E3A':'#94a3b8'}">${fmtDate(t.due_date)}</span>`)}
      ${_user.role !== 'team' ? metaItem('Hours', `${t.logged_hours||0}h logged / ${t.estimated_hours||0}h est`) : ''}
    </div>
    <div style="padding:14px 22px;border-bottom:1px solid var(--border)">
      <div style="font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Move to</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap" id="task-status-btns-${t.id}">
        ${['admin','pm'].includes(_user.role) ? 
          ['backlog','todo','in_progress','in_review','qa','done','blocked'].map(s=>`<button class="btn btn-xs ${t.status===s?'btn-primary':'btn-outline'}" onclick="updateTaskStatus('${t.id}','${s}')">${s.replace(/_/g,' ')}</button>`).join('')
          : `${statusBadge(t.status)}`}
      </div>
    </div>
    ${t.description ? `<div style="padding:14px 22px;border-bottom:1px solid var(--border)"><p style="font-size:13px;color:#94a3b8;line-height:1.6">${t.description}</p></div>` : ''}
    ${subtasks.length ? `
    <div style="padding:14px 22px;border-bottom:1px solid var(--border)">
      <div style="font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Subtasks (${subtasks.length})</div>
      ${subtasks.map(st=>`
        <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(30,30,69,.4)">
          <input type="checkbox" ${st.status==='done'?'checked':''} onchange="updateTaskStatus('${st.id}',this.checked?'done':'todo')" style="accent-color:#FF7A45"/>
          <span style="font-size:13px;color:${st.status==='done'?'#475569':'#e2e8f0'};${st.status==='done'?'text-decoration:line-through':''}">${st.title}</span>
          ${statusBadge(st.status)}
        </div>`).join('')}
    </div>` : ''}
    <div style="padding:14px 22px">
      <div style="font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Comments (${comments.length})</div>
      <div id="task-comments">
        ${comments.map(cm=>`
          <div class="comment-item">
            ${avatar(cm.author_name||cm.client_name||'?', cm.author_color||cm.client_color||'#FF7A45','sm')}
            <div style="flex:1">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                <span style="font-size:12px;font-weight:600;color:#e2e8f0">${cm.author_name||cm.client_name||'Unknown'}</span>
                ${cm.is_internal?'<span style="font-size:10px;background:rgba(255,122,69,.15);color:#FFB347;padding:1px 6px;border-radius:4px">Internal</span>':''}
                <span style="font-size:11px;color:#475569;margin-left:auto">${timeAgo(cm.created_at)}</span>
              </div>
              <p style="font-size:13px;color:#94a3b8;line-height:1.5">${cm.content}</p>
            </div>
          </div>`).join('') || '<div style="color:#475569;font-size:13px;padding:8px 0">No comments yet.</div>'}
      </div>
      <div class="comment-box" style="margin-top:12px">
        <textarea id="new-comment-${t.id}" placeholder="Add a comment…"></textarea>
        <div class="comment-box-footer">
          ${['admin','pm'].includes(_user.role)?`<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#64748b;margin-right:auto;cursor:pointer"><input type="checkbox" id="comment-internal-${t.id}" style="accent-color:#FF7A45"/> Internal only</label>`:''}
          <button class="btn btn-sm btn-primary" onclick="submitComment('${t.id}')"><i class="fas fa-paper-plane"></i>Comment</button>
        </div>
      </div>
    </div>`
    openDrawer(drawerHTML)

    // Load project-specific status columns for PM/Admin
    if (['admin','pm'].includes(_user.role) && t.project_id) {
      API.get('/tasks/columns/' + t.project_id).then(cd => {
        const cols = cd.columns || []
        if (!cols.length) return
        const btnsEl = document.getElementById('task-status-btns-' + t.id)
        if (btnsEl) {
          btnsEl.innerHTML = cols.map(col =>
            `<button class="btn btn-xs ${t.status === col.status_key ? 'btn-primary' : 'btn-outline'}" 
             onclick="updateTaskStatus('${t.id}','${col.status_key}')"
             style="${t.status === col.status_key ? `background:${col.color};border-color:${col.color}` : `border-color:${col.color};color:${col.color}`}"
            >${col.name}</button>`
          ).join('')
        }
      }).catch(() => {})
    }
  } catch(e) { openDrawer(`<div style="padding:20px;color:#FF5E3A">${e.message}</div>`) }
}

function metaItem(label, value) {
  return `<div><div style="font-size:10px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">${label}</div><div style="font-size:13px;color:#e2e8f0;display:flex;align-items:center;gap:4px">${value}</div></div>`
}

async function updateTaskStatus(taskId, newStatus) {
  try {
    await API.patch(`/tasks/${taskId}/move`, { status: newStatus })
    toast('Status updated: ' + newStatus, 'success', 2000)
    // Refresh drawer
    openTaskDrawer(taskId)
  } catch(e) { toast(e.message, 'error') }
}

async function submitComment(taskId) {
  const content = document.getElementById('new-comment-'+taskId)?.value?.trim()
  if (!content) return toast('Write a comment first', 'error')
  const is_internal = document.getElementById('comment-internal-'+taskId)?.checked ? 1 : 0
  try {
    await API.post(`/tasks/${taskId}/comment`, { content, is_internal })
    toast('Comment added', 'success', 2000)
    openTaskDrawer(taskId)
  } catch(e) { toast(e.message, 'error') }
}

/* ── CREATE TASK MODAL ───────────────────────────────────── */
async function showCreateTaskModal(projectId='', sprintId='', defaultStatus='backlog') {
  try {
    const [proj, users, sprints] = await Promise.all([API.get('/projects'), API.get('/users'), API.get('/sprints')])
    const projects = proj.projects || proj.data || []
    const allDevs = users.users || users.data || []
    const allSprints = sprints.sprints || []

    // Get project-specific developers (only those assigned to the project)
    let assignableDevs = allDevs.filter(u => ['developer','pm'].includes(u.role))
    if (projectId) {
      try {
        const projDevs = await API.get(`/projects/${projectId}/developers`)
        const assignedIds = (projDevs.developers || []).map(d => d.user_id)
        if (assignedIds.length > 0) {
          assignableDevs = allDevs.filter(u => assignedIds.includes(u.id) || u.role === 'pm')
        }
      } catch(e) {}
    }

    // Get custom columns for selected project
    let statusOptions = `<option value="backlog" ${defaultStatus==='backlog'?'selected':''}>Backlog</option>
      <option value="todo" ${defaultStatus==='todo'?'selected':''}>To Do</option>
      <option value="in_progress" ${defaultStatus==='in_progress'?'selected':''}>In Progress</option>
      <option value="in_review" ${defaultStatus==='in_review'?'selected':''}>In Review</option>
      <option value="qa" ${defaultStatus==='qa'?'selected':''}>QA</option>
      <option value="done" ${defaultStatus==='done'?'selected':''}>Done</option>
      <option value="blocked" ${defaultStatus==='blocked'?'selected':''}>Blocked</option>`
    if (projectId) {
      try {
        const colData = await API.get(`/tasks/columns/${projectId}`)
        const cols = colData.columns || []
        if (cols.length > 0) {
          statusOptions = cols.map(c => `<option value="${c.status_key}" ${c.status_key===defaultStatus?'selected':''}>${c.name}</option>`).join('')
        }
      } catch(e) {}
    }

    showModal(`
    <div class="modal-header">
      <h3 style="display:flex;align-items:center;gap:8px"><i class="fas fa-plus-circle" style="color:#FF7A45"></i> Create Task</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Project *</label>
          <select class="form-select" id="ct-project" onchange="updateSprintsAndStatusForProject(this.value)">
            ${projects.map(p=>`<option value="${p.id}" ${p.id===projectId?'selected':''}>${p.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Sprint</label>
          <select class="form-select" id="ct-sprint">
            <option value="">Backlog (No Sprint)</option>
            ${allSprints.filter(s=>!projectId||s.project_id===projectId).map(s=>`<option value="${s.id}" ${s.id===sprintId?'selected':''}>${s.name}${s.status==='active'?' ●':''}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group"><label class="form-label">Title *</label><input class="form-input" id="ct-title" placeholder="e.g. Implement login API, Fix header bug…" autofocus/></div>
      <div class="form-group"><label class="form-label">Description</label><textarea class="form-textarea" id="ct-desc" placeholder="Describe the task in detail…" rows="3"></textarea></div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        <div class="form-group" style="margin:0"><label class="form-label">Type</label><select class="form-select" id="ct-type">
          <option value="task">✓ Task</option><option value="story">📖 Story</option><option value="bug">🐛 Bug</option><option value="epic">⚡ Epic</option><option value="sub_task">↳ Sub-task</option>
        </select></div>
        <div class="form-group" style="margin:0"><label class="form-label">Priority</label><select class="form-select" id="ct-priority">
          <option value="medium" selected>🟡 Medium</option><option value="high">🟠 High</option><option value="critical">🔴 Critical</option><option value="low">⚪ Low</option>
        </select></div>
        <div class="form-group" style="margin:0"><label class="form-label">Status / Column</label><select class="form-select" id="ct-status">${statusOptions}</select></div>
      </div>
      <div class="form-row" style="margin-top:10px">
        <div class="form-group"><label class="form-label">Assignee</label>
          <select class="form-select" id="ct-assignee">
            <option value="">Unassigned</option>
            ${assignableDevs.map(u=>`<option value="${u.id}">${u.full_name} (${u.designation||u.role})</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label class="form-label">Due Date</label><input class="form-input" type="date" id="ct-due"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Estimated Hours</label><input class="form-input" type="number" id="ct-hours" placeholder="0" min="0" step="0.5"/></div>
        <div class="form-group"><label class="form-label">Story Points</label><input class="form-input" type="number" id="ct-points" placeholder="0" min="0"/></div>
      </div>
      <div style="display:flex;align-items:center;gap:16px;margin-top:6px">
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;color:var(--text-muted)"><input type="checkbox" id="ct-visible" checked style="accent-color:#FF7A45"/> Client visible</label>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;color:var(--text-muted)"><input type="checkbox" id="ct-billable" checked style="accent-color:#FF7A45"/> Billable</label>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="doCreateTask()"><i class="fas fa-plus"></i>Create Task</button>
    </div>`, 'modal-lg')
  } catch(e) { toast(e.message, 'error') }
}

function updateSprintsForProject(projectId) {
  API.get('/sprints?project_id='+projectId).then(data => {
    const sel = document.getElementById('ct-sprint')
    if (!sel) return
    sel.innerHTML = `<option value="">Backlog (No Sprint)</option>${(data.sprints||[]).map(s=>`<option value="${s.id}">${s.name}${s.status==='active'?' ●':''}</option>`).join('')}`
  }).catch(()=>{})
}

async function updateSprintsAndStatusForProject(projectId) {
  updateSprintsForProject(projectId)
  // Also update status dropdown with project columns
  try {
    const colData = await API.get(`/tasks/columns/${projectId}`)
    const cols = colData.columns || []
    const sel = document.getElementById('ct-status')
    if (sel && cols.length > 0) {
      sel.innerHTML = cols.map(c => `<option value="${c.status_key}">${c.name}</option>`).join('')
    }
    // Update assignee dropdown with project developers
    const projDevs = await API.get(`/projects/${projectId}/developers`)
    const devIds = (projDevs.developers || []).map(d => d.user_id)
    if (devIds.length > 0) {
      const usersData = await API.get('/users')
      const allUsers = usersData.users || usersData.data || []
      const devs = allUsers.filter(u => devIds.includes(u.id) || u.role === 'pm')
      const assignSel = document.getElementById('ct-assignee')
      if (assignSel) {
        assignSel.innerHTML = `<option value="">Unassigned</option>${devs.map(u=>`<option value="${u.id}">${u.full_name} (${u.designation||u.role})</option>`).join('')}`
      }
    }
  } catch(e) {}
}

async function doCreateTask() {
  const body = {
    project_id: document.getElementById('ct-project').value,
    sprint_id: document.getElementById('ct-sprint').value||null,
    title: document.getElementById('ct-title').value.trim(),
    description: document.getElementById('ct-desc').value.trim(),
    task_type: document.getElementById('ct-type').value,
    priority: document.getElementById('ct-priority').value,
    status: document.getElementById('ct-status').value,
    assignee_id: document.getElementById('ct-assignee').value||null,
    due_date: document.getElementById('ct-due').value||null,
    estimated_hours: parseFloat(document.getElementById('ct-hours').value)||0,
    story_points: parseInt(document.getElementById('ct-points').value)||0,
    is_client_visible: document.getElementById('ct-visible').checked?1:0,
    is_billable: document.getElementById('ct-billable').checked?1:0,
  }
  if (!body.project_id || !body.title) return toast('Project and title required', 'error')
  try {
    await API.post('/tasks', body)
    toast('Task created!', 'success')
    closeModal()
    // Refresh kanban if open
    const kb = document.getElementById('page-kanban-board')
    if (kb?.classList.contains('active')) { kb.dataset.loaded=''; loadPage('kanban-board', kb) }
    const mt = document.getElementById('page-my-tasks')
    if (mt?.classList.contains('active')) { mt.dataset.loaded=''; loadPage('my-tasks', mt) }
  } catch(e) { toast(e.message, 'error') }
}

/* ── SPRINTS VIEW ────────────────────────────────────────── */
async function renderSprintsView(el) {
  el.innerHTML = `<div style="padding:24px;color:#64748b"><i class="fas fa-spinner fa-spin"></i></div>`
  try {
    const [spData, proj] = await Promise.all([API.get('/sprints'), API.get('/projects')])
    const sprints = spData.sprints||[]
    const projects = proj.projects||proj||[]
    const projMap = {}; projects.forEach(p=>projMap[p.id]=p)
    const pagination = paginateClient(sprints, _sprintsViewPage, _sprintsPageLimit)
    _sprintsViewPage = pagination.page

    el.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Sprints</h1><p class="page-subtitle">${pagination.total} sprints across all projects</p></div>
      <div class="page-actions">
        ${['admin','pm'].includes(_user.role)?`<button class="btn btn-primary" onclick="showCreateSprintModal()"><i class="fas fa-plus"></i>New Sprint</button>`:''}
      </div>
    </div>
    ${listSectionHeader(['Sprint', 'Project / Timeline', 'Stats', 'Status / Progress'], '2.1fr 1.2fr 1fr 1.1fr')}
    ${pagination.items.map(s => {
      const pct = s.total_story_points>0 ? Math.round((s.completed_story_points/s.total_story_points)*100) : 0
      return `
      <div class="card" style="margin-bottom:14px">
        <div class="card-header">
          <div>
            <div style="display:flex;align-items:center;gap:10px">
              <span style="font-size:15px;font-weight:600;color:#e2e8f0">${s.name}</span>
              ${statusBadge(s.status)}
            </div>
            <div style="font-size:12px;color:#64748b;margin-top:3px">${projMap[s.project_id]?.name||s.project_id} • ${fmtDate(s.start_date)} → ${fmtDate(s.end_date)}</div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-sm btn-outline" onclick="openProjectBoard('${s.project_id}','')"><i class="fas fa-columns"></i>Board</button>
            ${['admin','pm'].includes(_user.role)?`<button class="btn btn-sm btn-outline" onclick="editSprint('${s.id}','${s.status}')"><i class="fas fa-edit"></i></button>`:''}
          </div>
        </div>
        <div class="card-body">
          ${s.goal?`<p style="font-size:13px;color:#94a3b8;margin-bottom:12px"><i class="fas fa-bullseye" style="color:#FF7A45;margin-right:6px"></i>${s.goal}</p>`:''}
          <div style="display:flex;gap:28px;margin-bottom:12px">
            ${[['Total Tasks',s.task_count,'#94a3b8'],['Completed',s.done_count,'#58C68A'],['Blocked',s.blocked_count,'#FF5E3A'],['Story Points',`${s.completed_story_points}/${s.total_story_points}`,'#FF7A45']].map(([l,v,c])=>`<div><div style="font-size:18px;font-weight:700;color:${c}">${v}</div><div style="font-size:11px;color:#64748b">${l}</div></div>`).join('')}
          </div>
          <div class="progress-bar lg">
            <div class="progress-fill ${pct>=80?'green':pct>=50?'blue':'amber'}" style="width:${pct}%"></div>
          </div>
          <div style="font-size:11px;color:#64748b;margin-top:4px">${pct}% complete</div>
        </div>
      </div>`
    }).join('') || '<div class="empty-state"><i class="fas fa-bolt"></i><p>No sprints created yet</p></div>'}
    ${renderPager(pagination, 'goSprintsPage', 'goSprintsPage', 'sprints', 'sprints-view')}
    `
  } catch(e) { el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>` }
}

async function showCreateSprintModal() {
  const proj = await API.get('/projects')
  const projects = proj.projects||proj||[]
  showModal(`
  <div class="modal-header"><h3>Create Sprint</h3><button class="close-btn" onclick="closeModal()">✕</button></div>
  <div class="modal-body">
    <div class="form-group"><label class="form-label">Project *</label><select class="form-select" id="csp-project">${projects.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Sprint Name *</label><input class="form-input" id="csp-name" placeholder="Sprint 1 – Feature X"/></div>
    <div class="form-group"><label class="form-label">Sprint Goal</label><textarea class="form-textarea" id="csp-goal" placeholder="What does this sprint aim to deliver?"></textarea></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Start Date *</label><input class="form-input" type="date" id="csp-start"/></div>
      <div class="form-group"><label class="form-label">End Date *</label><input class="form-input" type="date" id="csp-end"/></div>
    </div>
  </div>
  <div class="modal-footer">
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="doCreateSprint()"><i class="fas fa-plus"></i>Create Sprint</button>
  </div>`)
}

async function doCreateSprint() {
  const body = { project_id: document.getElementById('csp-project').value, name: document.getElementById('csp-name').value.trim(), goal: document.getElementById('csp-goal').value.trim(), start_date: document.getElementById('csp-start').value, end_date: document.getElementById('csp-end').value }
  if (!body.project_id||!body.name||!body.start_date||!body.end_date) return toast('Fill all required fields','error')
  try {
    await API.post('/sprints', body); toast('Sprint created!','success'); closeModal()
    const el = document.getElementById('page-sprints-view'); if(el){el.dataset.loaded='';loadPage('sprints-view',el)}
  } catch(e) { toast(e.message,'error') }
}

async function editSprint(id, currentStatus) {
  const newStatus = currentStatus==='planning'?'active':currentStatus==='active'?'completed':currentStatus
  if (newStatus===currentStatus) return
  try {
    await API.put('/sprints/'+id, {status: newStatus})
    toast('Sprint status updated to '+newStatus,'success')
    const el = document.getElementById('page-sprints-view'); if(el){el.dataset.loaded='';loadPage('sprints-view',el)}
  } catch(e) { toast(e.message,'error') }
}

/* ── MILESTONES VIEW ────────────────────────────────────── */
async function renderMilestonesView(el) {
  el.innerHTML = `<div style="padding:24px;color:#64748b"><i class="fas fa-spinner fa-spin"></i></div>`
  try {
    const [msData, proj] = await Promise.all([API.get('/milestones'), API.get('/projects')])
    const milestones = msData.milestones||[]
    const projects = proj.projects||proj||[]
    const projMap = {}; projects.forEach(p=>projMap[p.id]=p)
    const pagination = paginateClient(milestones, _milestonesViewPage, _milestonesPageLimit)
    _milestonesViewPage = pagination.page

    el.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Milestones</h1><p class="page-subtitle">${pagination.total} deliverables and billing milestones</p></div>
      <div class="page-actions">
        ${['admin','pm'].includes(_user.role)?`<button class="btn btn-primary" onclick="showCreateMilestoneModal()"><i class="fas fa-plus"></i>New Milestone</button>`:''}
      </div>
    </div>
    ${listSectionHeader(['Milestone', 'Project', 'Due / Status', 'Billing / Progress'], '2fr 1.15fr 1fr 1fr')}
    <div class="grid-2">
      ${pagination.items.map(m=>`
        <div class="card">
          <div class="card-header">
            <div>
              <div style="font-size:14px;font-weight:600;color:#e2e8f0">${m.title}</div>
              <div style="font-size:11px;color:#64748b;margin-top:2px">${projMap[m.project_id]?.name||'—'}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              ${statusBadge(m.status)}
              ${m.is_billable?`<span style="font-size:11px;background:rgba(88,198,138,.15);color:#58C68A;padding:2px 7px;border-radius:10px">₹${fmtNum(m.invoice_amount)}</span>`:''}
            </div>
          </div>
          <div class="card-body">
            ${m.description?`<p style="font-size:13px;color:#94a3b8;margin-bottom:12px">${m.description}</p>`:''}
            <div style="display:flex;justify-content:space-between;font-size:12px;color:#64748b;margin-bottom:8px">
              <span><i class="fas fa-calendar"></i> Due: <strong style="color:${new Date(m.due_date)<new Date()&&m.status!=='completed'?'#FF5E3A':'#94a3b8'}">${fmtDate(m.due_date)}</strong></span>
              <span>${m.completion_pct}% complete</span>
            </div>
            <div class="progress-bar"><div class="progress-fill ${m.completion_pct>=100?'green':m.completion_pct>=70?'blue':'amber'}" style="width:${m.completion_pct}%"></div></div>
            ${['admin','pm'].includes(_user.role)?`
            <div style="display:flex;gap:8px;margin-top:12px">
              <input type="range" min="0" max="100" value="${m.completion_pct}" style="flex:1;accent-color:#FF7A45" oninput="this.nextElementSibling.textContent=this.value+'%'" onchange="updateMilestonePct('${m.id}',this.value)"/>
              <span style="font-size:12px;color:#FF7A45;min-width:35px">${m.completion_pct}%</span>
            </div>`:''}
          </div>
        </div>`).join('') || '<div class="empty-state"><i class="fas fa-flag"></i><p>No milestones defined</p></div>'}
    </div>
    ${renderPager(pagination, 'goMilestonesPage', 'goMilestonesPage', 'milestones', 'milestones-view')}
    `
  } catch(e) { el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>` }
}

async function updateMilestonePct(id, pct) {
  const status = pct>=100?'completed':pct>0?'in_progress':'pending'
  try { await API.put('/milestones/'+id,{completion_pct:parseInt(pct),status}); toast('Milestone updated','success',2000) }
  catch(e) { toast(e.message,'error') }
}

async function showCreateMilestoneModal() {
  const proj = await API.get('/projects')
  const projects = proj.projects||proj||[]
  showModal(`
  <div class="modal-header"><h3>Create Milestone</h3><button class="close-btn" onclick="closeModal()">✕</button></div>
  <div class="modal-body">
    <div class="form-group"><label class="form-label">Project *</label><select class="form-select" id="cms-project">${projects.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Milestone Title *</label><input class="form-input" id="cms-title" placeholder="Phase 1 – Delivery"/></div>
    <div class="form-group"><label class="form-label">Description</label><textarea class="form-textarea" id="cms-desc" placeholder="What is delivered in this milestone?"></textarea></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Due Date *</label><input class="form-input" type="date" id="cms-due"/></div>
      <div class="form-group"><label class="form-label">Invoice Amount (₹)</label><input class="form-input" type="number" id="cms-amount" placeholder="0"/></div>
    </div>
    <div style="display:flex;gap:16px">
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="cms-billable" style="accent-color:#FF7A45"/> Billable Milestone</label>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" id="cms-visible" checked style="accent-color:#FF7A45"/> Client Visible</label>
    </div>
  </div>
  <div class="modal-footer">
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="doCreateMilestone()"><i class="fas fa-flag"></i>Create Milestone</button>
  </div>`)
}

async function doCreateMilestone() {
  const body = { project_id:document.getElementById('cms-project').value, title:document.getElementById('cms-title').value.trim(), description:document.getElementById('cms-desc').value.trim(), due_date:document.getElementById('cms-due').value, invoice_amount:parseFloat(document.getElementById('cms-amount').value)||0, is_billable:document.getElementById('cms-billable').checked?1:0, client_visible:document.getElementById('cms-visible').checked?1:0 }
  if (!body.project_id||!body.title||!body.due_date) return toast('Fill required fields','error')
  try {
    await API.post('/milestones',body); toast('Milestone created!','success'); closeModal()
    const el=document.getElementById('page-milestones-view');if(el){el.dataset.loaded='';loadPage('milestones-view',el)}
  } catch(e){toast(e.message,'error')}
}

/* ── MY TASKS ────────────────────────────────────────────── */
async function renderMyTasks(el) {
  el.innerHTML = `<div style="padding:24px;color:#64748b"><i class="fas fa-spinner fa-spin"></i></div>`
  try {
    const assigneeId = _user.role === 'developer' ? (_user.sub || _user.id || '') : ''
    const data = await API.get('/tasks' + (assigneeId?'?assignee_id='+assigneeId:''))
    const tasks = data.tasks||[]
    const pagination = paginateClient(tasks, _myTasksPage, _myTasksPageLimit)
    _myTasksPage = pagination.page

    el.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">${_user.role==='developer'?'My Tasks':'All Tasks'}</h1><p class="page-subtitle">${pagination.total} tasks</p></div>
      <div class="page-actions">
        <select class="form-select" style="width:140px" onchange="filterByStatus(this.value,'my-tasks-table')">
          <option value="">All Status</option>
          ${['backlog','todo','in_progress','in_review','qa','done','blocked'].map(s=>`<option value="${s}">${s.replace('_',' ')}</option>`).join('')}
        </select>
        <select class="form-select" style="width:130px" onchange="filterByPriority(this.value,'my-tasks-table')">
          <option value="">All Priority</option>
          ${['critical','high','medium','low'].map(p=>`<option value="${p}">${p}</option>`).join('')}
        </select>
        ${['admin','pm'].includes(_user.role)?`<button class="btn btn-primary" onclick="showCreateTaskModal()"><i class="fas fa-plus"></i>New Task</button>`:''}
      </div>
    </div>
    <div class="card">
      <div class="card-body p-0 table-wrap">
        <table class="data-table" id="my-tasks-table">
          <thead><tr><th>Task</th><th>Project</th><th>Type</th><th>Priority</th><th>Status</th><th>Assignee</th><th>Due</th>${_user.role !== 'team' ? '<th>Hours</th>' : ''}<th></th></tr></thead>
          <tbody>
            ${pagination.items.map(t=>`
            <tr data-status="${t.status}" data-priority="${t.priority}">
              <td style="max-width:220px">
                <div style="display:flex;align-items:center;gap:6px">${taskTypeIcon(t.task_type)}<span style="font-weight:500;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.title}</span></div>
                ${t.sprint_name?`<div style="font-size:10px;color:#475569;margin-top:2px"><i class="fas fa-bolt"></i> ${t.sprint_name}</div>`:''}
              </td>
              <td><span style="font-size:12px;color:#94a3b8">${t.project_name||'—'}</span></td>
              <td><span style="font-size:11px;text-transform:capitalize;color:#64748b">${t.task_type}</span></td>
              <td>${priorityBadge(t.priority)}</td>
              <td>${statusBadge(t.status)}</td>
              <td>${t.assignee_name?`<div style="display:flex;align-items:center;gap:5px">${avatar(t.assignee_name,t.assignee_color,'sm')}<span style="font-size:12px">${t.assignee_name}</span></div>`:'<span style="color:#475569;font-size:12px">—</span>'}</td>
              <td style="font-size:12px;color:${t.due_date&&new Date(t.due_date)<new Date()&&t.status!=='done'?'#FF5E3A':'#94a3b8'}">${fmtDate(t.due_date)}</td>
              ${_user.role !== 'team' ? `<td style="font-size:12px">${t.logged_hours||0}/${t.estimated_hours||0}h</td>` : ''}
              <td><button class="btn btn-xs btn-outline" onclick="openTaskDrawer('${t.id}')"><i class="fas fa-eye"></i></button></td>
            </tr>`).join('')}
          </tbody>
        </table>
        ${renderPager(pagination, 'goMyTasksPage', 'goMyTasksPage', 'tasks', 'my-tasks')}
      </div>
    </div>`
  } catch(e) { el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>` }
}

function filterByStatus(val, tableId) {
  const tbl = document.getElementById(tableId)
  if (!tbl) return
  tbl.querySelectorAll('tbody tr').forEach(row => {
    row.style.display = (!val || row.dataset.status===val) ? '' : 'none'
  })
}
function filterByPriority(val, tableId) {
  const tbl = document.getElementById(tableId)
  if (!tbl) return
  tbl.querySelectorAll('tbody tr').forEach(row => {
    row.style.display = (!val || row.dataset.priority===val) ? '' : 'none'
  })
}
function filterTable(val, tableId) {
  const q = val.toLowerCase()
  document.querySelectorAll(`#${tableId} tbody tr`).forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none'
  })
}

/* ── RESOURCES VIEW ─────────────────────────────────────── */
async function renderResourcesView(el) {
  el.innerHTML = `<div style="padding:24px;color:#64748b"><i class="fas fa-spinner fa-spin"></i></div>`
  try {
    const [usersData, proj, dash] = await Promise.all([API.get('/users?role=developer'), API.get('/projects'), API.get('/dashboard/pm')])
    const devs = usersData.users||usersData||[]
    const d = dash.data||{}
    const pagination = paginateClient(d.utilization || [], _resourcesPage, _resourcesPageLimit)
    _resourcesPage = pagination.page

    el.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Resource Allocation</h1><p class="page-subtitle">Team capacity, utilization, and allocation planning</p></div>
    </div>
    <div class="grid-4" style="margin-bottom:20px">
      ${statCard('Total Developers', devs.length, 'fas fa-code', '#FF7A45', `${devs.filter(d=>d.is_active).length} active`)}
      ${statCard('Total Allocated', fmtNum(d.hours?.total_allocated||0)+'h', 'fas fa-clock', '#F4C842', 'across all projects')}
      ${statCard('Consumed', fmtNum(d.hours?.total_consumed||0)+'h', 'fas fa-check', '#58C68A', 'logged and approved')}
      ${statCard('Remaining', fmtNum(d.hours?.total_remaining||0)+'h', 'fas fa-hourglass-half', '#FFCB47', 'to be consumed')}
    </div>
    <div class="card">
      <div class="card-header"><span style="font-weight:600">Developer Utilization Matrix</span></div>
      <div class="card-body p-0 table-wrap">
        <table class="data-table">
          <thead><tr><th>Developer</th><th>Designation</th><th>Monthly Cap</th><th>This Month</th><th>Utilization</th><th>Projects</th><th>Allocated Total</th><th>Status</th></tr></thead>
          <tbody>
            ${pagination.items.map(u=>`
            <tr>
              <td><div style="display:flex;align-items:center;gap:8px">${avatar(u.full_name,u.avatar_color,'sm')}<span style="font-weight:500;color:#e2e8f0">${u.full_name}</span></div></td>
              <td><span style="font-size:12px;color:#94a3b8">${u.designation}</span></td>
              <td>${u.monthly_available_hours}h</td>
              <td>${u.monthly_consumed}h</td>
              <td style="min-width:160px">
                <div style="display:flex;align-items:center;gap:8px">
                  <div class="progress-bar" style="flex:1"><div class="progress-fill ${u.utilization_pct>=80?'rose':u.utilization_pct>=50?'green':'amber'}" style="width:${Math.min(u.utilization_pct,100)}%"></div></div>
                  <span style="font-size:12px;font-weight:600;color:${pctColor(u.utilization_pct)}">${u.utilization_pct}%</span>
                </div>
              </td>
              <td>${u.project_count}</td>
              <td>${u.total_allocated}h</td>
              <td>${u.utilization_pct>=90?'<span style="color:#FF5E3A;font-size:12px">⚡ Overloaded</span>':u.utilization_pct>=50?'<span style="color:#58C68A;font-size:12px">✓ Healthy</span>':'<span style="color:#FFCB47;font-size:12px">↓ Underutil.</span>'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        ${renderPager(pagination, 'goResourcesPage', 'goResourcesPage', 'developers', 'resources-view')}
      </div>
    </div>`
  } catch(e) { el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>` }
}

/* ── APPROVAL QUEUE ─────────────────────────────────────── */
async function renderApprovalQueue(el) {
  el.innerHTML = `<div style="padding:24px;color:#64748b"><i class="fas fa-spinner fa-spin"></i></div>`
  try {
    const data = await API.get('/timesheets?approval_status=pending')
    const logs = data.timesheets||data||[]
    const pagination = paginateClient(logs, _approvalQueuePage, _approvalQueuePageLimit)
    _approvalQueuePage = pagination.page
    const selectedCount = 0
    const billableCount = logs.filter(l => l.is_billable).length
    const overLimitCount = logs.filter(l => Number(l.hours_consumed || 0) >= 10).length
    const totalHours = logs.reduce((sum, l) => sum + Number(l.hours_consumed || 0), 0)
    const avgHours = logs.length ? (totalHours / logs.length).toFixed(1) : '0.0'
    el.innerHTML = `
    <div class="page-hero">
      <div class="page-hero-copy">
        <div class="eyebrow"><i class="fas fa-clipboard-check"></i> Workflow control</div>
        <h1 class="page-title">Approval Queue</h1>
        <p class="page-subtitle">Review pending timesheets before they are billed or pushed into reporting.</p>
        <div class="hero-pills">
          <span class="hero-pill"><i class="fas fa-clock"></i>${pagination.total} pending</span>
          <span class="hero-pill"><i class="fas fa-wallet"></i>${billableCount} billable</span>
          <span class="hero-pill"><i class="fas fa-bolt"></i>${overLimitCount} high hour entries</span>
        </div>
      </div>
      <div class="page-hero-actions">
        <button class="btn btn-secondary" onclick="loadApprovalQueue()"><i class="fas fa-rotate"></i> Refresh</button>
        ${pagination.total>0?`<button class="btn btn-success" onclick="bulkApprove()"><i class="fas fa-check-double"></i> Approve all</button>`:''}
      </div>
    </div>
    <div class="summary-grid">
      <div class="summary-card">
        <div>
          <div class="summary-label">Pending</div>
          <div class="summary-value">${pagination.total}</div>
          <div class="summary-note">Ready for review</div>
        </div>
        <div class="summary-icon blue"><i class="fas fa-hourglass-half"></i></div>
      </div>
      <div class="summary-card">
        <div>
          <div class="summary-label">Billable</div>
          <div class="summary-value">${billableCount}</div>
          <div class="summary-note">Linked to invoicing</div>
        </div>
        <div class="summary-icon green"><i class="fas fa-file-invoice-dollar"></i></div>
      </div>
      <div class="summary-card">
        <div>
          <div class="summary-label">Avg hours</div>
          <div class="summary-value">${avgHours}h</div>
          <div class="summary-note">Per pending entry</div>
        </div>
        <div class="summary-icon amber"><i class="fas fa-chart-line"></i></div>
      </div>
      <div class="summary-card">
        <div>
          <div class="summary-label">Selection</div>
          <div class="summary-value" id="approval-selection-count">${selectedCount}</div>
          <div class="summary-note">For bulk actions</div>
        </div>
        <div class="summary-icon red"><i class="fas fa-square-check"></i></div>
      </div>
    </div>
    <div class="card surface-card">
      <div class="table-toolbar">
        <div>
          <div style="font-size:15px;font-weight:800;color:var(--text-primary)">Pending timesheets</div>
          <div class="hint">Select one or more rows to approve or reject in bulk.</div>
        </div>
        <div class="selection-chip"><i class="fas fa-mouse-pointer"></i><span id="approval-selection-label">0 selected</span></div>
      </div>
      <div class="card-body p-0 table-wrap">
        <table class="data-table">
          <thead><tr><th><input type="checkbox" class="table-check" id="select-all" onchange="toggleSelectAll(this)"/></th><th>Developer</th><th>Project</th><th>Date</th><th>Task</th><th>Hours</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${pagination.items.map(l=>`
            <tr id="log-row-${l.id}">
              <td><input type="checkbox" class="log-check table-check" value="${l.id}" onchange="updateApprovalSelectionState()"/></td>
              <td><div style="display:flex;align-items:center;gap:8px">${avatar(l.full_name||'?',l.avatar_color||'#FF7A45','sm')}<span>${l.full_name||l.user_id}</span></div></td>
              <td><span style="font-size:12px;color:#94a3b8">${l.project_name||l.project_id}</span></td>
              <td style="font-size:12px">${fmtDate(l.date)}</td>
              <td style="max-width:200px"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${l.task_description}</div></td>
              <td><strong>${l.hours_consumed}h</strong></td>
              <td>${statusBadge(l.approval_status)}</td>
              <td>
                <div style="display:flex;gap:6px;flex-wrap:wrap">
                  <button class="btn btn-xs btn-success" onclick="approveLog('${l.id}')"><i class="fas fa-check"></i>Approve</button>
                  <button class="btn btn-xs btn-danger" onclick="rejectLog('${l.id}')"><i class="fas fa-times"></i>Reject</button>
                </div>
              </td>
            </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;padding:30px;color:#64748b"><i class="fas fa-check-circle" style="margin-right:6px;color:#58C68A"></i>All timesheets approved!</td></tr>'}
          </tbody>
        </table>
        ${renderPager(pagination, 'goApprovalQueuePage', 'goApprovalQueuePage', 'approvals', 'approval-queue')}
      </div>
    </div>`
    updateApprovalSelectionState()
  } catch(e) { el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>` }
}

function loadApprovalQueue() {
  const el = document.getElementById('page-approval-queue')
  if (el) {
    el.dataset.loaded = ''
    renderApprovalQueue(el)
  }
}

function toggleSelectAll(cb) {
  document.querySelectorAll('.log-check').forEach(c => c.checked = cb.checked)
  updateApprovalSelectionState()
}

function updateApprovalSelectionState() {
  const selected = document.querySelectorAll('.log-check:checked').length
  const total = document.querySelectorAll('.log-check').length
  const selectionCount = document.getElementById('approval-selection-count')
  const selectionLabel = document.getElementById('approval-selection-label')
  const selectAll = document.getElementById('select-all')
  if (selectionCount) selectionCount.textContent = String(selected)
  if (selectionLabel) selectionLabel.textContent = `${selected} selected`
  if (selectAll) selectAll.checked = total > 0 && selected === total
}
async function approveLog(id) {
  try {
    await API.post(`/timesheets/${id}/approve`, {})
    document.getElementById('log-row-'+id)?.remove()
    toast('Timesheet approved','success',2000)
    loadBadges()
    updateApprovalSelectionState()
  } catch(e){toast(e.message,'error')}
}
async function rejectLog(id) {
  const notes = prompt('Rejection reason (optional):')
  try {
    await API.post(`/timesheets/${id}/reject`, {pm_notes: notes||''})
    document.getElementById('log-row-'+id)?.remove()
    toast('Timesheet rejected','info',2000)
    updateApprovalSelectionState()
  } catch(e){toast(e.message,'error')}
}
async function bulkApprove() {
  const checked = [...document.querySelectorAll('.log-check:checked')].map(c=>c.value)
  if (!checked.length) { toast('Select timesheets first','error'); return }
  try {
    await API.post('/timesheets/bulk-approve', {ids: checked})
    checked.forEach(id => document.getElementById('log-row-'+id)?.remove())
    toast(`${checked.length} timesheets approved`,'success')
    loadBadges()
    updateApprovalSelectionState()
  } catch(e){toast(e.message,'error')}
}

/* ── CLIENTS LIST (Admin) ────────────────────────────────── */
async function renderClientsList(el) {
  el.innerHTML = `<div style="padding:24px;color:#64748b"><i class="fas fa-spinner fa-spin"></i></div>`
  try {
    const data = await API.get('/clients')
    const clients = data.clients||[]
    const pagination = paginateClient(clients, _clientsListPage, _clientsPageLimit)
    _clientsListPage = pagination.page
    el.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Clients</h1><p class="page-subtitle">${pagination.total} client companies</p></div>
      ${_user.role === 'admin' ? `<div class="page-actions" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-secondary" onclick="openImportClientsModal()"><i class="fas fa-file-csv"></i>Import CSV</button><button class="btn btn-primary" onclick="openCreateClientModal()"><i class="fas fa-user-plus"></i>Add Client</button></div>` : ''}
    </div>
    <div class="grid-2">
      ${pagination.items.map(cl=>`
        <div class="client-project-card" onclick="showClientDetail('${cl.id}')">
          <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
            ${avatar(cl.company_name,cl.avatar_color,'lg')}
            <div>
              <div style="font-size:15px;font-weight:600;color:#e2e8f0">${cl.company_name}</div>
              <div style="font-size:12px;color:#94a3b8">${cl.contact_name}</div>
              <div style="font-size:12px;color:#64748b">${cl.email}</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
            <div style="text-align:center"><div style="font-size:18px;font-weight:700;color:#e2e8f0">${cl.project_count||0}</div><div style="font-size:11px;color:#64748b">Projects</div></div>
            <div style="text-align:center"><div style="font-size:18px;font-weight:700;color:#58C68A">₹${cl.total_paid?fmtNum(cl.total_paid):'0'}</div><div style="font-size:11px;color:#64748b">Paid</div></div>
            <div style="text-align:center"><div style="font-size:18px;font-weight:700;color:#FFCB47">₹${cl.total_billed?(fmtNum(cl.total_billed-cl.total_paid)):'0'}</div><div style="font-size:11px;color:#64748b">Pending</div></div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="status-chip status-${cl.is_active?'active':'cancelled'}">${cl.is_active?'Active':'Inactive'}</span>
            <span style="font-size:12px;color:#475569">${cl.industry||'—'}</span>
          </div>
        </div>`).join('') || '<div class="empty-state"><i class="fas fa-building"></i><p>No clients registered</p></div>'}
    </div>
    ${renderPager(pagination, 'goClientsPage', 'goClientsPage', 'clients', 'clients-list')}
    `
  } catch(e) { el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>` }
}

function openCreateClientModal() {
  showModal(`
    <div class="modal-header"><h3>Create Client</h3><button class="close-btn" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-row">
        <div class="form-group"><label class="form-label">Company Name *</label><input class="form-input" id="client-company" placeholder="Acme Corp"/></div>
        <div class="form-group"><label class="form-label">Contact Name *</label><input class="form-input" id="client-contact" placeholder="John Doe"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Email *</label><input class="form-input" id="client-email" type="email" placeholder="john@company.com"/></div>
        <div class="form-group"><label class="form-label">Password *</label><input class="form-input" id="client-password" type="password" placeholder="Temporary password"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Phone</label><input class="form-input" id="client-phone" placeholder="+91-9800000000"/></div>
        <div class="form-group"><label class="form-label">Website</label><input class="form-input" id="client-website" placeholder="https://example.com"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Industry</label><input class="form-input" id="client-industry" placeholder="SaaS / Fintech"/></div>
        <div class="form-group"><label class="form-label">Avatar Color</label><input class="form-input" id="client-color" type="color" value="#FF7A45" style="height:40px;padding:3px"/></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveClient()"><i class="fas fa-save"></i>Create Client</button>
    </div>
  `, 'modal-lg')
}

async function saveClient() {
  const payload = {
    company_name: document.getElementById('client-company').value.trim(),
    contact_name: document.getElementById('client-contact').value.trim(),
    email: document.getElementById('client-email').value.trim(),
    password: document.getElementById('client-password').value,
    phone: document.getElementById('client-phone').value.trim(),
    website: document.getElementById('client-website').value.trim(),
    industry: document.getElementById('client-industry').value.trim(),
    avatar_color: document.getElementById('client-color').value,
  }
  if (!payload.company_name || !payload.contact_name || !payload.email || !payload.password) {
    toast('Company name, contact name, email and password are required', 'error')
    return
  }
  try {
    await API.post('/clients', payload)
    toast('Client created successfully', 'success')
    closeModal()
    rerenderEnterprisePage('clients-list', () => {})
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

async function showClientDetail(clientId) {
  try {
    const data = await API.get('/clients/'+clientId)
    const cl = data.client
    const projects = data.projects||[]
    const invoices = data.invoices||[]
    showModal(`
      <div class="modal-header">${avatar(cl.company_name,cl.avatar_color)} <h3 style="margin-left:8px">${cl.company_name}</h3><button class="close-btn" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <div class="grid-2" style="margin-bottom:16px">
          ${metaItem('Contact', cl.contact_name)} ${metaItem('Email', cl.email)}
          ${metaItem('Phone', cl.phone||'—')} ${metaItem('Industry', cl.industry||'—')}
          ${metaItem('Website', cl.website||'—')} ${metaItem('Total Billed', fmtCurrency(invoices.reduce((s,i)=>s+i.total_amount,0)))}
        </div>
        <div class="tab-bar">
          <button class="tab-btn active" onclick="switchTab(this,'ct-projects')">Projects (${projects.length})</button>
          <button class="tab-btn" onclick="switchTab(this,'ct-invoices')">Invoices (${invoices.length})</button>
        </div>
        <div id="ct-projects" class="tab-content active">
          ${projects.map(p=>`<div style="padding:10px 0;border-bottom:1px solid var(--border)"><div style="font-weight:500;color:#e2e8f0">${p.name}</div><div style="display:flex;gap:8px;margin-top:4px">${statusBadge(p.status)}${priorityBadge(p.priority)}<span style="font-size:12px;color:#64748b">PM: ${p.pm_name||'—'}</span></div></div>`).join('') || '<p style="color:#64748b;font-size:13px;padding:12px 0">No projects</p>'}
        </div>
        <div id="ct-invoices" class="tab-content">
          ${invoices.map(i=>`<div style="padding:10px 0;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between"><div><div style="font-weight:500;color:#e2e8f0">${i.invoice_number}</div><div style="font-size:12px;color:#64748b">${fmtDate(i.due_date)}</div></div><div style="display:flex;align-items:center;gap:10px"><strong style="color:#58C68A">${fmtCurrency(i.total_amount)}</strong><span class="badge ${invoiceStatusClass(i.status)}">${i.status}</span></div></div>`).join('') || '<p style="color:#64748b;font-size:13px;padding:12px 0">No invoices</p>'}
        </div>
      </div>`, 'modal-lg')
  } catch(e) { toast(e.message,'error') }
}

function switchTab(btn, targetId) {
  const parent = btn.closest('.modal-body')||btn.closest('.card-body')||document
  parent.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'))
  parent.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'))
  btn.classList.add('active')
  document.getElementById(targetId)?.classList.add('active')
}

/* ── BILLING ADMIN ──────────────────────────────────────── */
async function renderBillingAdmin(el) {
  el.innerHTML = `<div style="padding:24px;color:#64748b"><i class="fas fa-spinner fa-spin"></i></div>`
  try {
    const data = await API.get('/invoices?page=' + _billingInvoicePage + '&limit=' + _billingInvoiceLimit)
    const invoices = data.invoices||[]
    const s = data.summary||{}
    const pagination = data.pagination || { total: invoices.length, page: _billingInvoicePage, limit: _billingInvoiceLimit, totalPages: 1, hasMore: false }
    _billingInvoicePage = pagination.page || _billingInvoicePage
    const start = pagination.total ? ((pagination.page - 1) * pagination.limit) + 1 : 0
    const end = Math.min(pagination.page * pagination.limit, pagination.total || 0)
    const billingPagination = { ...pagination, start, end }
    el.innerHTML = `
    <div class="billing-page">
    <div class="page-header">
      <div><h1 class="page-title">Billing & Invoices</h1><p class="page-subtitle">Manage all client invoices and payments</p></div>
      <div class="page-actions">
        ${_user.role==='admin'?`<button class="btn btn-primary" onclick="showCreateInvoiceModal()"><i class="fas fa-plus"></i>Create Invoice</button>`:''}
      </div>
    </div>
    <div class="grid-4" style="margin-bottom:20px">
      ${statCard('Total Invoiced', fmtCurrency(s.total_value||0), 'fas fa-file-invoice', '#FF7A45', `${s.total_invoices||0} invoices`)}
      ${statCard('Collected', fmtCurrency(s.total_paid||0), 'fas fa-check-circle', '#58C68A', 'payments received')}
      ${statCard('Pending', fmtCurrency(s.total_pending||0), 'fas fa-clock', '#FFCB47', 'awaiting payment')}
      ${statCard('Overdue', fmtCurrency(s.total_overdue||0), 'fas fa-exclamation-triangle', '#FF5E3A', `${s.overdue_count||0} overdue`)}
    </div>
      <div class="card billing-table-shell">
        <div class="card-header billing-table-header">
          <span style="font-weight:600">All Invoices</span>
          <div style="display:flex;gap:8px">
            <select class="form-select" style="width:130px" onchange="filterTable(this.value,'inv-table')">
            <option value="">All Status</option>
            ${['pending','sent','paid','partially_paid','overdue','cancelled'].map(s=>`<option value="${s}">${s}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="billing-table-scroll">
        <div class="table-wrap">
          <table class="data-table" id="inv-table">
            <thead><tr><th>Invoice</th><th>Client</th><th>Project</th><th>Amount</th><th>Status</th><th>Issue Date</th><th>Due Date</th><th>Actions</th></tr></thead>
            <tbody>
              ${invoices.map(i=>`
              <tr>
                <td><div style="font-weight:600;font-size:12px;font-family:monospace;color:#FFB347">${i.invoice_number}</div><div style="font-size:11px;color:#64748b;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i.title}</div></td>
                <td><div style="display:flex;align-items:center;gap:6px">${avatar(i.company_name||'?',i.client_color||'#FF7A45','sm')}<span style="font-size:12px">${i.company_name||'—'}</span></div></td>
                <td><span style="font-size:12px;color:#94a3b8">${i.project_name||'—'}</span></td>
                <td><strong style="color:#58C68A">${fmtCurrency(i.total_amount)}</strong>${i.paid_amount>0&&i.paid_amount<i.total_amount?`<div style="font-size:11px;color:#94a3b8">Paid: ${fmtCurrency(i.paid_amount)}</div>`:''}</td>
                <td><span class="badge ${invoiceStatusClass(i.status)}">${i.status}</span></td>
                <td style="font-size:12px">${fmtDate(i.issue_date)}</td>
                <td style="font-size:12px;color:${new Date(i.due_date)<new Date()&&i.status!=='paid'?'#FF5E3A':'#94a3b8'}">${fmtDate(i.due_date)}</td>
                <td>
                  <div style="display:flex;gap:4px">
                    ${_user.role==='admin'?`<button class="btn btn-xs btn-outline" title="Send Invoice" aria-label="Send Invoice" onclick="showSendInvoiceModal('${i.id}')"><i class="fas fa-paper-plane"></i></button>`:''}
                    ${_user.role==='admin'&&i.status!=='paid'?`<button class="btn btn-xs btn-success" onclick="showMarkPaidModal('${i.id}','${i.invoice_number}',${i.total_amount})"><i class="fas fa-check"></i>Mark Paid</button>`:''}
                    ${_user.role==='admin'?`<button class="btn btn-xs btn-outline" onclick="showEditInvoiceModal('${i.id}')"><i class="fas fa-edit"></i></button>`:''}
                  </div>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${renderPager(billingPagination, 'goBillingInvoicePage', 'goBillingInvoicePage', 'invoices', 'billing-admin')}
      </div>
    </div>`
  } catch(e) { el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>` }
}

function goBillingInvoicePage(page) {
  const nextPage = Math.max(1, Number(page) || 1)
  if (_billingInvoicePage === nextPage) return
  _billingInvoicePage = nextPage
  const el = document.getElementById('page-billing-admin')
  if (el) {
    el.dataset.loaded = ''
    loadPage('billing-admin', el)
  }
}

async function showCreateInvoiceModal() {
  const [proj, clients, ms] = await Promise.all([API.get('/projects'), API.get('/clients'), API.get('/milestones')])
  const projects = proj.projects||proj.data||proj||[]
  const allClients = clients.clients||clients.data||[]
  const milestones = ms.milestones||ms.data||[]
  // Stash for the client-change handler so it can rebuild the project + milestone lists
  window._invoiceProjects = projects
  window._invoiceMilestones = milestones
  showModal(`
  <div class="modal-header"><h3>Create Invoice</h3><button class="close-btn" onclick="closeModal()">✕</button></div>
  <div class="modal-body">
    <div class="form-row">
      <div class="form-group"><label class="form-label">Client *</label><select class="form-select" id="ci-client" onchange="onCreateInvoiceClientChanged(this.value)"><option value="">— Select a client —</option>${allClients.map(c=>`<option value="${c.id}">${c.company_name}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Project *</label><select class="form-select" id="ci-project" disabled onchange="onCreateInvoiceProjectChanged(this.value)"><option value="">— Select a client first —</option></select></div>
    </div>
    <div class="form-group"><label class="form-label">Milestone (optional)</label><select class="form-select" id="ci-milestone" disabled><option value="">No milestone</option></select></div>
    <div class="form-group"><label class="form-label">Invoice Title *</label><input class="form-input" id="ci-title" placeholder="Phase 1 – Delivery Invoice"/></div>
    <div class="form-group"><label class="form-label">Description</label><textarea class="form-textarea" id="ci-desc" placeholder="Invoice details…" style="min-height:60px"></textarea></div>
    <div class="form-row-3">
      <div class="form-group"><label class="form-label">Amount (pre-tax) *</label><input class="form-input" type="number" id="ci-amount" placeholder="100000" oninput="calcTax()"/></div>
      <div class="form-group"><label class="form-label">Tax %</label><input class="form-input" type="number" id="ci-tax" value="18" oninput="calcTax()"/></div>
      <div class="form-group"><label class="form-label">Total (incl. tax)</label><input class="form-input" id="ci-total" readonly style="background:rgba(88,198,138,.07);color:#58C68A"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Issue Date *</label><input class="form-input" type="date" id="ci-issue" value="${dayjs().format('YYYY-MM-DD')}"/></div>
      <div class="form-group"><label class="form-label">Due Date *</label><input class="form-input" type="date" id="ci-due" value="${dayjs().add(30,'day').format('YYYY-MM-DD')}"/></div>
    </div>
    <div class="form-group"><label class="form-label">Payment Terms</label><input class="form-input" id="ci-terms" placeholder="Net 30 days"/></div>
    <div class="form-group"><label class="form-label">Notes</label><textarea class="form-textarea" id="ci-notes" style="min-height:50px"></textarea></div>
  </div>
  <div class="modal-footer">
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="doCreateInvoice()"><i class="fas fa-file-invoice"></i>Create Invoice</button>
  </div>`, 'modal-lg')
}

function onCreateInvoiceClientChanged(clientId) {
  const projectSelect = document.getElementById('ci-project')
  const milestoneSelect = document.getElementById('ci-milestone')
  const projects = window._invoiceProjects || []
  if (!projectSelect) return
  if (!clientId) {
    projectSelect.disabled = true
    projectSelect.innerHTML = '<option value="">— Select a client first —</option>'
    if (milestoneSelect) {
      milestoneSelect.disabled = true
      milestoneSelect.innerHTML = '<option value="">No milestone</option>'
    }
    return
  }
  const filtered = projects.filter(p => String(p.client_id) === String(clientId))
  projectSelect.disabled = false
  if (!filtered.length) {
    projectSelect.innerHTML = '<option value="">No projects for this client</option>'
  } else {
    projectSelect.innerHTML = `<option value="">— Select a project —</option>${filtered.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}`
  }
  if (milestoneSelect) {
    milestoneSelect.disabled = true
    milestoneSelect.innerHTML = '<option value="">Select a project first</option>'
  }
}

function onCreateInvoiceProjectChanged(projectId) {
  const milestoneSelect = document.getElementById('ci-milestone')
  const milestones = window._invoiceMilestones || []
  if (!milestoneSelect) return
  if (!projectId) {
    milestoneSelect.disabled = true
    milestoneSelect.innerHTML = '<option value="">Select a project first</option>'
    return
  }
  const filtered = milestones.filter(m => String(m.project_id) === String(projectId))
  milestoneSelect.disabled = false
  milestoneSelect.innerHTML = `<option value="">No milestone</option>${filtered.map(m=>`<option value="${m.id}">${m.title}</option>`).join('')}`
}

async function showEditInvoiceModal(id) {
  try {
    const [invRes, projRes, clientsRes, msRes] = await Promise.all([
      API.get(`/invoices/${id}`),
      API.get('/projects'),
      API.get('/clients'),
      API.get('/milestones')
    ])
    const inv = invRes.invoice || invRes.data || invRes
    const projects = projRes.projects || projRes || []
    const allClients = clientsRes.clients || []
    const milestones = msRes.milestones || []
    showModal(`
    <div class="modal-header"><h3>Edit Invoice</h3><button class="close-btn" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-row">
        <div class="form-group"><label class="form-label">Client</label><select class="form-select" id="ei-client">${allClients.map(c=>`<option value="${c.id}" ${c.id===inv.client_id?'selected':''}>${c.company_name}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Project</label><select class="form-select" id="ei-project">${projects.map(p=>`<option value="${p.id}" ${p.id===inv.project_id?'selected':''}>${p.name}</option>`).join('')}</select></div>
      </div>
      <div class="form-group"><label class="form-label">Milestone</label><select class="form-select" id="ei-milestone"><option value="">No milestone</option>${milestones.map(m=>`<option value="${m.id}" ${m.id===inv.milestone_id?'selected':''}>${m.title}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Invoice Title *</label><input class="form-input" id="ei-title" value="${inv.title||''}"/></div>
      <div class="form-group"><label class="form-label">Description</label><textarea class="form-textarea" id="ei-desc" style="min-height:60px">${inv.description||''}</textarea></div>
      <div class="form-row-3">
        <div class="form-group"><label class="form-label">Amount (pre-tax) *</label><input class="form-input" type="number" min="0" step="0.01" id="ei-amount" value="${Number(inv.amount||0)}" oninput="calcEditTax()"/></div>
        <div class="form-group"><label class="form-label">Tax %</label><input class="form-input" type="number" min="0" max="100" step="0.01" id="ei-tax" value="${Number(inv.tax_pct ?? 18)}" oninput="calcEditTax()"/></div>
        <div class="form-group"><label class="form-label">Total (incl. tax)</label><input class="form-input" id="ei-total" readonly value="${fmtCurrency(inv.total_amount||0)}" style="background:rgba(88,198,138,.07);color:#58C68A"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Status</label><select class="form-select" id="ei-status">${['pending','sent','overdue','partially_paid','paid','cancelled'].map(s=>`<option value="${s}" ${inv.status===s?'selected':''}>${s.replace('_',' ')}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Due Date *</label><input class="form-input" type="date" id="ei-due" value="${inv.due_date||''}"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Paid Amount</label><input class="form-input" type="number" id="ei-paid-amount" value="${inv.paid_amount ?? 0}"/></div>
        <div class="form-group"><label class="form-label">Paid Date</label><input class="form-input" type="date" id="ei-paid-date" value="${inv.paid_date||''}"/></div>
      </div>
      <div class="form-group"><label class="form-label">Transaction Reference</label><input class="form-input" id="ei-ref" value="${inv.transaction_ref||''}" placeholder="TXN123456"/></div>
      <div class="form-group"><label class="form-label">Payment Terms</label><input class="form-input" id="ei-terms" value="${inv.payment_terms||''}"/></div>
      <div class="form-group"><label class="form-label">Notes</label><textarea class="form-textarea" id="ei-notes" style="min-height:50px">${inv.notes||''}</textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="doEditInvoice('${id}')"><i class="fas fa-save"></i>Save Changes</button>
    </div>`, 'modal-lg')
  } catch (e) {
    toast('Failed to load invoice: ' + e.message, 'error')
  }
}

async function showSendInvoiceModal(id) {
  try {
    const res = await API.get(`/invoices/${id}`)
    const inv = res.invoice || res.data || res
    const defaultTo = escapeHtml(inv.client_email || '')
    const defaultSubject = escapeHtml(`Invoice ${inv.invoice_number} from ${inv.company_name || 'DevPortal'}`)
    const previewAmount = fmtCurrency(inv.total_amount || 0)
    const previewDue = fmtDate(inv.due_date)
    const previewProject = escapeHtml(inv.project_name || '—')
    const previewClient = escapeHtml(inv.company_name || '—')

    showModal(`
    <div class="modal-header"><h3>Send Invoice</h3><button class="close-btn" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div style="background:linear-gradient(135deg, rgba(255,122,69,.12), rgba(88,198,138,.10));border:1px solid rgba(255,122,69,.18);border-radius:16px;padding:16px 18px;margin-bottom:18px">
        <div style="font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.12em">Invoice Preview</div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px">
          <div>
            <div style="font-size:11px;color:#64748b">Invoice</div>
            <div style="font-weight:700;color:#e2e8f0">${escapeHtml(inv.invoice_number)}</div>
          </div>
          <div>
            <div style="font-size:11px;color:#64748b">Amount</div>
            <div style="font-weight:700;color:#58C68A">${previewAmount}</div>
          </div>
          <div>
            <div style="font-size:11px;color:#64748b">Client</div>
            <div style="font-weight:700;color:#e2e8f0">${previewClient}</div>
          </div>
          <div>
            <div style="font-size:11px;color:#64748b">Project</div>
            <div style="font-weight:700;color:#e2e8f0">${previewProject}</div>
          </div>
          <div>
            <div style="font-size:11px;color:#64748b">Due Date</div>
            <div style="font-weight:700;color:#e2e8f0">${previewDue}</div>
          </div>
          <div>
            <div style="font-size:11px;color:#64748b">Status</div>
            <div style="font-weight:700;color:#e2e8f0">${escapeHtml(String(inv.status || 'pending').replace('_', ' '))}</div>
          </div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Client Email *</label>
        <input class="form-input" id="se-to" type="email" value="${defaultTo}" placeholder="client@company.com"/>
      </div>
      <div class="form-group">
        <label class="form-label">CC</label>
        <input class="form-input" id="se-cc" placeholder="finance@company.com, accounts@company.com"/>
        <div style="font-size:12px;color:#64748b;margin-top:6px">Comma-separated emails supported.</div>
      </div>
      <div class="form-group">
        <label class="form-label">Subject</label>
        <input class="form-input" id="se-subject" value="${defaultSubject}" placeholder="Invoice subject"/>
      </div>
      <div style="font-size:13px;color:#94a3b8;line-height:1.6">
        The invoice will be sent in the same billing format used by the system email template.
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="doSendInvoice('${id}')"><i class="fas fa-paper-plane"></i>Send Invoice</button>
    </div>`, 'modal-lg')
  } catch (e) {
    toast('Failed to load invoice: ' + e.message, 'error')
  }
}

function calcEditTax() {
  const amount = parseFloat(document.getElementById('ei-amount')?.value || '0') || 0
  const taxPct = parseFloat(document.getElementById('ei-tax')?.value || '0') || 0
  const total = amount + (amount * taxPct) / 100
  const totalEl = document.getElementById('ei-total')
  if (totalEl) totalEl.value = fmtCurrency(total)
}

async function doEditInvoice(id) {
  const amount = parseFloat(document.getElementById('ei-amount')?.value || '0')
  const taxPct = parseFloat(document.getElementById('ei-tax')?.value || '0')
  const body = {
    title: document.getElementById('ei-title')?.value.trim(),
    description: document.getElementById('ei-desc')?.value.trim(),
    status: document.getElementById('ei-status')?.value,
    due_date: document.getElementById('ei-due')?.value,
    amount: Number.isFinite(amount) ? amount : 0,
    tax_pct: Number.isFinite(taxPct) ? taxPct : 0,
    paid_amount: parseFloat(document.getElementById('ei-paid-amount')?.value || '0'),
    paid_date: document.getElementById('ei-paid-date')?.value || null,
    transaction_ref: document.getElementById('ei-ref')?.value.trim(),
    payment_terms: document.getElementById('ei-terms')?.value.trim(),
    notes: document.getElementById('ei-notes')?.value.trim(),
  }
  if (!body.title || !body.due_date) return toast('Title and due date are required', 'error')
  if (!(body.amount >= 0)) return toast('Amount must be a non-negative number', 'error')
  if (body.tax_pct < 0 || body.tax_pct > 100) return toast('Tax % must be between 0 and 100', 'error')
  try {
    await API.put(`/invoices/${id}`, body)
    toast('Invoice updated!', 'success')
    closeModal()
    const el = document.getElementById('page-billing-admin')
    if (el) { el.dataset.loaded = ''; loadPage('billing-admin', el) }
  } catch (e) {
    toast(e.message, 'error')
  }
}

async function doSendInvoice(id) {
  const body = {
    to: document.getElementById('se-to')?.value.trim(),
    cc: document.getElementById('se-cc')?.value.trim(),
    subject: document.getElementById('se-subject')?.value.trim(),
  }
  if (!body.to) return toast('Client email is required', 'error')
  try {
    await API.post(`/invoices/${id}/send-email`, body)
    toast('Invoice email sent!', 'success')
    closeModal()
    const el = document.getElementById('page-billing-admin')
    if (el) { el.dataset.loaded = ''; loadPage('billing-admin', el) }
  } catch (e) {
    toast(e.message, 'error')
  }
}

function calcTax() {
  const amt = parseFloat(document.getElementById('ci-amount')?.value)||0
  const tax = parseFloat(document.getElementById('ci-tax')?.value)||18
  const total = amt + (amt*tax/100)
  const el = document.getElementById('ci-total'); if(el) el.value = '₹'+fmtNum(total.toFixed(0))
}

async function doCreateInvoice() {
  const body = { client_id:document.getElementById('ci-client').value, project_id:document.getElementById('ci-project').value, milestone_id:document.getElementById('ci-milestone').value||null, title:document.getElementById('ci-title').value.trim(), description:document.getElementById('ci-desc').value.trim(), amount:parseFloat(document.getElementById('ci-amount').value), tax_pct:parseFloat(document.getElementById('ci-tax').value)||18, issue_date:document.getElementById('ci-issue').value, due_date:document.getElementById('ci-due').value, payment_terms:document.getElementById('ci-terms').value, notes:document.getElementById('ci-notes').value }
  if (!body.client_id||!body.project_id||!body.title||!body.amount||!body.issue_date||!body.due_date) return toast('Fill all required fields','error')
  try {
    await API.post('/invoices',body); toast('Invoice created!','success'); closeModal()
    _billingInvoicePage = 1
    const el=document.getElementById('page-billing-admin');if(el){el.dataset.loaded='';loadPage('billing-admin',el)}
  } catch(e){toast(e.message,'error')}
}

function showMarkPaidModal(id, num, total) {
  showModal(`
  <div class="modal-header"><h3>Mark Invoice Paid</h3><button class="close-btn" onclick="closeModal()">✕</button></div>
  <div class="modal-body">
    <p style="font-size:13px;color:#94a3b8;margin-bottom:16px">Invoice: <strong style="color:#e2e8f0">${num}</strong> • Total: <strong style="color:#58C68A">${fmtCurrency(total)}</strong></p>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Amount Received *</label><input class="form-input" type="number" id="mp-amount" value="${total}"/></div>
      <div class="form-group"><label class="form-label">Payment Date</label><input class="form-input" type="date" id="mp-date" value="${dayjs().format('YYYY-MM-DD')}"/></div>
    </div>
    <div class="form-group"><label class="form-label">Transaction Reference</label><input class="form-input" id="mp-ref" placeholder="TXN123456"/></div>
  </div>
  <div class="modal-footer">
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-success" onclick="doMarkPaid('${id}')"><i class="fas fa-check"></i>Confirm Payment</button>
  </div>`)
}

async function doMarkPaid(id) {
  const body = { paid_amount:parseFloat(document.getElementById('mp-amount').value), paid_date:document.getElementById('mp-date').value, transaction_ref:document.getElementById('mp-ref').value }
  try {
    await API.patch('/invoices/'+id+'/mark-paid',body); toast('Payment recorded!','success'); closeModal()
    const el=document.getElementById('page-billing-admin');if(el){el.dataset.loaded='';loadPage('billing-admin',el)}
  } catch(e){toast(e.message,'error')}
}

/* ── TEAM OVERVIEW ──────────────────────────────────────── */
const TEAM_ROLE_META = {
  admin:     { label: 'Admin',     badge: 'critical'   },
  pm:        { label: 'PM',        badge: 'inprogress' },
  pc:        { label: 'PC',        badge: 'review'     },
  developer: { label: 'Developer', badge: 'done'       },
  team:      { label: 'Team',      badge: 'todo'       },
  client:    { label: 'Client',    badge: 'review'     },
}
let _teamOverviewRoleFilter = ''

async function renderTeamOverview(el) {
  el.innerHTML = `<div style="padding:24px;color:#64748b"><i class="fas fa-spinner fa-spin"></i></div>`
  try {
    const data = await API.get('/users')
    const users = (data.users || data.data || [])
    const roleCounts = users.reduce((acc, u) => {
      const key = String(u.role || 'other').toLowerCase()
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
    const filtered = _teamOverviewRoleFilter
      ? users.filter(u => String(u.role || '').toLowerCase() === _teamOverviewRoleFilter)
      : users
    const pagination = paginateClient(filtered, _teamOverviewPage, _teamOverviewPageLimit)
    _teamOverviewPage = pagination.page
    const isAdmin = _user.role === 'admin'
    const canEdit = ['admin', 'pm'].includes(_user.role)

    el.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Team Overview</h1><p class="page-subtitle">${users.length} total members · ${pagination.total} shown</p></div>
      ${isAdmin ? `<div class="page-actions" style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" onclick="openImportUsersModal()"><i class="fas fa-file-csv"></i>Import CSV</button>
        <button class="btn btn-primary btn-sm" onclick="openTeamMemberModal('')"><i class="fas fa-user-plus"></i>Add User</button>
      </div>` : ''}
    </div>

    <div class="card" style="margin-bottom:12px">
      <div class="card-body" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:12px 16px">
        <div class="search-wrap" style="flex:1;min-width:240px"><i class="fas fa-search"></i><input class="search-bar" placeholder="Search members…" oninput="filterTable(this.value,'team-overview-table')"/></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${['', 'admin', 'pm', 'pc', 'developer', 'team'].map(r => {
            const meta = r ? TEAM_ROLE_META[r] : { label: 'All' }
            const count = r ? (roleCounts[r] || 0) : users.length
            const active = _teamOverviewRoleFilter === r
            return `<button class="btn btn-sm ${active ? 'btn-primary' : 'btn-outline'}" onclick="filterTeamOverviewByRole('${r}')">${meta.label} <span style="opacity:.7;margin-left:4px">${count}</span></button>`
          }).join('')}
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-body p-0 table-wrap">
        <table class="data-table" id="team-overview-table">
          <thead><tr>
            <th>Member</th><th>Email</th><th>Role</th><th>Designation</th>
            <th>Capacity</th><th>Joined</th><th>Status</th>${canEdit ? '<th style="width:140px">Actions</th>' : ''}
          </tr></thead>
          <tbody>
            ${pagination.items.map(u => {
              const meta = TEAM_ROLE_META[String(u.role || '').toLowerCase()] || { label: u.role || '—', badge: 'todo' }
              return `<tr>
                <td>
                  <div style="display:flex;align-items:center;gap:10px">
                    ${avatar(u.full_name, u.avatar_color, 'sm')}
                    <div>
                      <div style="font-weight:600;color:#e2e8f0">${u.full_name || '—'}</div>
                      <div style="font-size:11px;color:#64748b">${u.phone || ''}</div>
                    </div>
                  </div>
                </td>
                <td><span style="font-size:12px;color:#94a3b8">${u.email || '—'}</span></td>
                <td><span class="badge badge-${meta.badge}">${meta.label}</span></td>
                <td><span style="font-size:12px;color:#94a3b8">${u.designation || '—'}</span></td>
                <td><span style="font-size:12px">${u.monthly_available_hours || 0}h / mo</span></td>
                <td><span style="font-size:12px;color:#94a3b8">${u.joining_date ? fmtDate(u.joining_date) : '—'}</span></td>
                <td><span class="badge ${u.is_active ? 'badge-done' : 'badge-todo'}">${u.is_active ? 'Active' : 'Inactive'}</span></td>
                ${canEdit ? `<td>
                  <div style="display:flex;gap:4px">
                    <button class="btn btn-xs btn-outline" title="Edit" onclick="openEditTeamMember('${u.id}')"><i class="fas fa-edit"></i></button>
                    ${isAdmin ? `<button class="btn btn-xs btn-outline" title="Reset password" onclick="openAdminResetPasswordModal('${u.id}','${(u.full_name||'').replace(/'/g,"\\'")}')"><i class="fas fa-key"></i></button>` : ''}
                    <button class="btn btn-xs ${u.is_active ? 'btn-outline' : 'btn-primary'}" title="${u.is_active ? 'Deactivate' : 'Activate'}" onclick="toggleTeamMemberStatus('${u.id}',${!u.is_active})"><i class="fas fa-${u.is_active ? 'ban' : 'check'}"></i></button>
                  </div>
                </td>` : ''}
              </tr>`
            }).join('') || `<tr><td colspan="${canEdit ? 8 : 7}" style="text-align:center;color:#64748b;padding:24px">No team members match the current filter.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
    ${renderPager(pagination, 'goTeamOverviewPage', 'goTeamOverviewPage', 'team members', 'team-overview')}
    `
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>`
  }
}

function filterTeamOverviewByRole(role) {
  _teamOverviewRoleFilter = role || ''
  _teamOverviewPage = 1
  const el = document.getElementById('page-team-overview')
  if (el) { el.dataset.loaded = ''; loadPage('team-overview', el) }
}

function openTeamMemberModal(role) {
  if (typeof openDeveloperModal !== 'function') { toast('User modal unavailable', 'error'); return }
  openDeveloperModal(role ? { role } : null)
}

async function openEditTeamMember(id) {
  try {
    const res = await API.get(`/users/${id}`)
    if (typeof openDeveloperModal !== 'function') { toast('User modal unavailable', 'error'); return }
    openDeveloperModal(res.data)
  } catch (e) { toast(e.message, 'error') }
}

async function toggleTeamMemberStatus(id, active) {
  try {
    await API.patch(`/users/${id}/status`, { is_active: active })
    toast(`User ${active ? 'activated' : 'deactivated'}`, 'success')
    const el = document.getElementById('page-team-overview')
    if (el) { el.dataset.loaded = ''; loadPage('team-overview', el) }
  } catch (e) { toast('Failed: ' + e.message, 'error') }
}

// Admin-only password reset for any user. Used both manually from the Team
// page and as the action an admin takes after a "password_reset_request"
// notification. The user gets a notification telling them the password changed.
function openAdminResetPasswordModal(userId, userName) {
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-key" style="color:var(--accent);margin-right:6px"></i>Reset password${userName ? ' · ' + userName : ''}</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:12px">
      <div style="font-size:12.5px;color:var(--text-muted);line-height:1.5">
        Set a new password for this user. Share it with them over a secure channel — they'll be able to sign in with it immediately and change it from their profile.
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">New Password *</label>
        <div style="position:relative">
          <input id="arp-new" type="password" class="form-input" autocomplete="new-password" placeholder="At least 8 characters"/>
          <button type="button" onclick="togglePass('arp-new',this)" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;color:#64748b;cursor:pointer"><i class="fas fa-eye"></i></button>
        </div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">Confirm Password *</label>
        <input id="arp-confirm" type="password" class="form-input" autocomplete="new-password" placeholder="Re-type the new password"/>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitAdminResetPassword('${userId}')"><i class="fas fa-check"></i> Reset Password</button>
    </div>
  `, 'modal-md')
}

async function submitAdminResetPassword(userId) {
  const next = document.getElementById('arp-new')?.value || ''
  const confirm = document.getElementById('arp-confirm')?.value || ''
  if (!next || !confirm) { toast('Both fields are required', 'error'); return }
  if (next !== confirm) { toast('Passwords do not match', 'error'); return }
  try {
    const res = await API.post('/auth/admin-reset-password', { user_id: userId, new_password: next })
    toast(res.message || 'Password reset', 'success')
    closeModal()
  } catch (e) { toast(e.message || 'Failed', 'error') }
}

/* ── BULK CSV IMPORT (users + clients) ────────────────────── */
const IMPORT_TEMPLATES = {
  users: {
    filename: 'users_import_template.csv',
    headers: 'full_name,email,role,designation,phone,daily_work_hours,monthly_available_hours,hourly_cost,joining_date,avatar_color,password',
    rows: [
      'Rahul Sharma,rahul@example.com,developer,Senior Developer,+91-9876543210,8,160,800,2024-01-15,#FF7A45,Welcome@123',
      'Priya Verma,priya@example.com,pm,Project Manager,+91-9876500001,8,160,1200,2023-06-01,#FFB347,Welcome@123',
      'Aman Singh,aman@example.com,team,External Developer,+91-9876500002,8,160,600,,#C56FE6,Welcome@123',
    ],
  },
  clients: {
    filename: 'clients_import_template.csv',
    headers: 'company_name,contact_name,email,phone,website,industry,avatar_color,password',
    rows: [
      'Acme Corp,Anita Joshi,anita@acme.com,+91-9876543210,https://acme.com,SaaS,#FF7A45,Welcome@123',
      'Globex Ltd,Karthik Iyer,karthik@globex.com,+91-9876500001,https://globex.com,Fintech,#FFB347,Welcome@123',
    ],
  },
}

function downloadImportTemplate(kind) {
  const tpl = IMPORT_TEMPLATES[kind]
  if (!tpl) { toast('Unknown template', 'error'); return }
  const csv = [tpl.headers, ...tpl.rows].join('\n') + '\n'
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = tpl.filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function _importModalHtml(kind) {
  const isUsers = kind === 'users'
  const title = isUsers ? 'Import Team Members' : 'Import Clients'
  const cols = isUsers
    ? 'full_name, email, role, designation, phone, daily_work_hours, monthly_available_hours, hourly_cost, joining_date, avatar_color, password'
    : 'company_name, contact_name, email, phone, website, industry, avatar_color, password'
  return `
    <div class="modal-header">
      <h3><i class="fas fa-file-csv" style="color:var(--accent);margin-right:6px"></i>${title}</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div style="padding:12px 14px;border-radius:10px;background:rgba(255,180,120,0.10);border:1px solid rgba(255,180,120,0.25);font-size:12.5px;line-height:1.55;color:var(--text-secondary)">
        <i class="fas fa-circle-info" style="color:var(--accent);margin-right:6px"></i>
        Upload a <strong>CSV file</strong> with a header row. Excel users: <em>File → Save As → CSV (UTF-8)</em>.<br/>
        <strong>Required columns:</strong> ${isUsers ? 'full_name, email' : 'company_name, contact_name, email'}<br/>
        <strong>All columns:</strong> <span style="color:var(--text-muted);font-family:'IBM Plex Mono',monospace;font-size:11px">${cols}</span><br/>
        <strong>Default password</strong> if blank: <code>Welcome@123</code> — users should change on first login.
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn btn-outline btn-sm" onclick="downloadImportTemplate('${kind}')"><i class="fas fa-download"></i> Download sample template</button>
      </div>

      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">CSV File *</label>
        <input id="import-csv-file" type="file" accept=".csv,text/csv" class="form-input" style="padding:10px"/>
        <div class="form-hint">Pick a .csv file (Excel users: File → Save As → CSV UTF-8).</div>
      </div>

      <div id="import-result" style="display:none"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="import-submit-btn" onclick="submitImportCsv('${kind}')"><i class="fas fa-upload"></i> Import</button>
    </div>
  `
}

function openImportUsersModal()   { showModal(_importModalHtml('users'), 'modal-lg') }
function openImportClientsModal() { showModal(_importModalHtml('clients'), 'modal-lg') }

async function submitImportCsv(kind) {
  const fileInput = document.getElementById('import-csv-file')
  const submitBtn = document.getElementById('import-submit-btn')
  const file = fileInput?.files?.[0]
  if (!file) { toast('Please choose a CSV file', 'error'); return }
  const csv = (await file.text()).trim()
  if (!csv) { toast('CSV file is empty', 'error'); return }

  const url = kind === 'users' ? '/users/import' : '/clients/import'
  if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing…' }
  try {
    const res = await API.post(url, { csv })
    const created = res.created_count || 0
    const errCount = res.error_count || 0
    const errors = res.errors || []
    const result = document.getElementById('import-result')
    if (result) {
      result.style.display = ''
      result.innerHTML = `
        <div style="padding:12px 14px;border-radius:10px;background:rgba(88,198,138,0.10);border:1px solid rgba(88,198,138,0.30);color:#86E0A8;font-size:13px;margin-bottom:8px">
          <i class="fas fa-check-circle"></i> <strong>${created}</strong> ${kind === 'users' ? 'team members' : 'clients'} imported successfully.
        </div>
        ${errCount > 0 ? `
          <div style="padding:12px 14px;border-radius:10px;background:rgba(255,94,58,0.10);border:1px solid rgba(255,94,58,0.30);color:#FF8866;font-size:12.5px;line-height:1.5">
            <i class="fas fa-triangle-exclamation"></i> <strong>${errCount}</strong> rows skipped:
            <ul style="margin:6px 0 0 18px;padding:0">
              ${errors.slice(0, 25).map(e => `<li>Row ${e.row}${e.email ? ' (' + _supEsc(e.email) + ')' : ''}: ${_supEsc(e.error)}</li>`).join('')}
              ${errors.length > 25 ? `<li>…and ${errors.length - 25} more</li>` : ''}
            </ul>
          </div>
        ` : ''}
      `
    }
    toast(`${created} imported${errCount ? `, ${errCount} skipped` : ''}`, errCount ? 'warning' : 'success')

    // Refresh the list page
    const pageId = kind === 'users' ? 'page-team-overview' : 'page-clients-list'
    const el = document.getElementById(pageId)
    if (el) { el.dataset.loaded = ''; loadPage(kind === 'users' ? 'team-overview' : 'clients-list', el) }
  } catch (e) {
    toast('Import failed: ' + (e.message || 'unknown'), 'error')
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-upload"></i> Import' }
  }
}
