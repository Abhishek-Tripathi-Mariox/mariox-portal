// ═══════════════════════════════════════════════════════════
// Mariox DevPortal – Core App (auth + layout + API + routing)
// ═══════════════════════════════════════════════════════════

// Compatibility stub for legacy router.register() calls in pages2.js
const router = { register: () => {}, navigate: () => {}, routes: {} }
// Compatibility stub for legacy state object
const state = {
  get user() { return _user ? { ..._user, id: _user.sub || _user.id, full_name: _user.name || _user.full_name } : null }
}
// Compatibility stub for legacy auth.check() calls in pages2.js
const auth = {
  check: () => Promise.resolve(!!_user || loadAuth())
}
// Compatibility stub for renderLayout / renderLogin (legacy pages2.js uses these)
function renderLayout() {} // no-op: handled by app.js shell

// Compatibility shim: utils.* used by legacy pages.js / pages2.js.
// Maps to the live helpers defined below in this file.
const utils = {
  getInitials:      (n) => initials(n),
  formatNum:        (n) => fmtNum(n),
  formatHours:      (n) => `${Number(n||0).toFixed(1)}h`,
  formatDate:       (d) => fmtDate(d),
  formatRelative:   (d) => timeAgo(d),
  toast:            (msg, type='info', dur=3500) => toast(msg, type, dur),
  priorityBadge:    (p) => priorityBadge(p),
  statusBadge:      (s) => statusBadge(s),
  approvalBadge:    (s) => statusBadge(s),
  utilizationBadge: (pct) => {
    const n = Number(pct||0)
    const cls = n >= 100 ? 'badge-critical' : n >= 70 ? 'badge-done' : n >= 50 ? 'badge-medium' : 'badge-todo'
    return `<span class="badge ${cls}">${Math.round(n)}%</span>`
  },
  healthBadge: (status) => {
    const map = { healthy:'badge-done', warning:'badge-medium', critical:'badge-critical', on_track:'badge-done', at_risk:'badge-medium' }
    return `<span class="badge ${map[status]||'badge-todo'}">${(status||'unknown').replace('_',' ')}</span>`
  },
  progressBar: (pct, color='green') => {
    const colors = { green:'#10b981', yellow:'#f59e0b', red:'#ef4444', blue:'#6366f1' }
    const bg = colors[color] || color
    const w = Math.max(0, Math.min(100, Number(pct||0)))
    return `<div class="progress-bar"><div class="progress-fill" style="width:${w}%;background:${bg}"></div></div>`
  },
  confirm: async (msg) => Promise.resolve(window.confirm(msg)),
}

const BASE = '/api'
let _token = null, _user = null

// ── API helper ───────────────────────────────────────────────
const API = {
  get headers() {
    const h = { 'Content-Type': 'application/json' }
    if (_token) h['Authorization'] = 'Bearer ' + _token
    return h
  },
  async req(method, url, body) {
    const opts = { method, headers: this.headers }
    if (body) opts.body = JSON.stringify(body)
    const r = await fetch(BASE + url, opts)
    const data = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
    return data
  },
  get:    (u, opts = {}) => API.req('GET', buildUrl(u, opts?.params)),
  post:   (u, b) => API.req('POST', u, b),
  put:    (u, b) => API.req('PUT', u, b),
  patch:  (u, b) => API.req('PATCH', u, b),
  delete: (u) => API.req('DELETE', u),
}

function buildUrl(url, params = {}) {
  if (!params || typeof params !== 'object') return url
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value))
    }
  })
  const qs = search.toString()
  if (!qs) return url
  return url + (url.includes('?') ? '&' : '?') + qs
}

function paginateClient(items, page = 1, limit = 10) {
  const total = Array.isArray(items) ? items.length : 0
  const safeLimit = Math.max(1, Number(limit) || 10)
  const totalPages = Math.max(1, Math.ceil(total / safeLimit))
  const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages)
  const start = total ? ((safePage - 1) * safeLimit) + 1 : 0
  const end = total ? Math.min(safePage * safeLimit, total) : 0
  return {
    items: Array.isArray(items) ? items.slice((safePage - 1) * safeLimit, safePage * safeLimit) : [],
    total,
    page: safePage,
    limit: safeLimit,
    totalPages,
    hasMore: safePage < totalPages,
    start,
    end,
  }
}

function renderPager(pagination, prevFn, nextFn, label = 'items') {
  if (!pagination) return ''
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-top:1px solid var(--border);flex-wrap:wrap">
      <div style="font-size:12px;color:#94a3b8">
        ${pagination.total ? `Showing ${pagination.start}-${pagination.end} of ${pagination.total} ${label}` : `No ${label} found`}
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <button class="btn btn-sm btn-outline" ${pagination.page <= 1 ? 'disabled' : ''} onclick="${prevFn}(${pagination.page - 1})">Previous</button>
        <span style="font-size:12px;color:#64748b">Page ${pagination.page} of ${pagination.totalPages || 1}</span>
        <button class="btn btn-sm btn-outline" ${!pagination.hasMore ? 'disabled' : ''} onclick="${nextFn}(${pagination.page + 1})">Next</button>
      </div>
    </div>`
}

window.buildUrl = buildUrl
window.paginateClient = paginateClient
window.renderPager = renderPager

// ── Toast ────────────────────────────────────────────────────
function toast(msg, type='info', dur=3500) {
  let ct = document.getElementById('toast-container')
  if (!ct) { ct = document.createElement('div'); ct.id = 'toast-container'; document.body.appendChild(ct) }
  const icons = { success:'fa-check-circle', error:'fa-exclamation-circle', info:'fa-info-circle' }
  const t = document.createElement('div')
  t.className = `toast ${type}`
  t.innerHTML = `<i class="fas ${icons[type]||'fa-info-circle'}" style="color:${type==='success'?'#34d399':type==='error'?'#fb7185':'#818cf8'}"></i><span>${msg}</span>`
  ct.appendChild(t)
  setTimeout(() => t.remove(), dur)
}

// ── Auth ─────────────────────────────────────────────────────
function saveAuth(token, user) {
  _token = token; _user = user
  localStorage.setItem('devportal_token', token)
  localStorage.setItem('devportal_user', JSON.stringify(user))
}
function clearAuth() {
  _token = null; _user = null
  localStorage.removeItem('devportal_token')
  localStorage.removeItem('devportal_user')
}
function loadAuth() {
  const t = localStorage.getItem('devportal_token')
  const u = localStorage.getItem('devportal_user')
  if (t && u) { _token = t; _user = JSON.parse(u); return true }
  return false
}

// ── Routing ──────────────────────────────────────────────────
const Router = {
  current: null,
  history: [],
  navigate(page, params={}) {
    // Push current page to history before navigating
    if (this.current) {
      this.history.push(this.current)
    }
    this.current = { page, params }
    renderApp()
    updateBackButton()
  },
  back() {
    if (this.history.length === 0) return
    this.current = this.history.pop()
    renderApp()
    updateBackButton()
  }
}

// ── Colour helpers ───────────────────────────────────────────
function initials(name='') { return name.split(' ').map(p=>p[0]).join('').substring(0,2).toUpperCase() }
function avatar(name, color='#6366f1', size='') {
  return `<div class="avatar ${size}" style="background:${color}">${initials(name)}</div>`
}

function priorityBadge(p) {
  const map = { critical:'badge-critical', high:'badge-high', medium:'badge-medium', low:'badge-low' }
  const ic = { critical:'<i class="fas fa-circle-exclamation"></i>', high:'<i class="fas fa-arrow-up"></i>', medium:'<i class="fas fa-minus"></i>', low:'<i class="fas fa-arrow-down"></i>' }
  return `<span class="badge ${map[p]||'badge-medium'}">${ic[p]||''}${p||'medium'}</span>`
}
function statusBadge(s) {
  const map = { backlog:'badge-todo', todo:'badge-todo', in_progress:'badge-inprogress', in_review:'badge-review', qa:'badge-qa', done:'badge-done', blocked:'badge-blocked', active:'badge-done', on_hold:'badge-medium', completed:'badge-review', cancelled:'badge-todo', pending:'badge-todo', approved:'badge-done', rejected:'badge-blocked', planning:'badge-todo' }
  const labels = { in_progress:'In Progress', in_review:'In Review', on_hold:'On Hold', todo:'To Do', qa:'QA' }
  return `<span class="badge ${map[s]||'badge-todo'}">${labels[s]||s}</span>`
}
function taskTypeIcon(t) {
  const ic = { bug:'<i class="fas fa-bug text-rose-400 text-xs"></i>', story:'<i class="fas fa-bookmark text-cyan-400 text-xs"></i>', task:'<i class="fas fa-check-square text-violet-400 text-xs"></i>', epic:'<i class="fas fa-bolt text-amber-400 text-xs"></i>', sub_task:'<i class="fas fa-code-branch text-slate-400 text-xs"></i>' }
  return ic[t] || ic.task
}
function fmtDate(d) { if (!d) return '—'; return dayjs(d).format('DD MMM YYYY') }
function fmtNum(n) { return Number(n||0).toLocaleString('en-IN') }
function fmtCurrency(n, cur='INR') { return '₹' + fmtNum(n) }
function timeAgo(d) {
  if (!d) return ''
  const diff = Date.now() - new Date(d)
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return Math.floor(diff/60000) + 'm ago'
  if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago'
  return Math.floor(diff/86400000) + 'd ago'
}
function pctColor(p) { return p >= 90 ? '#f43f5e' : p >= 70 ? '#f59e0b' : '#10b981' }
function docCategoryIcon(cat) {
  const ic = { sow:'📋', brd:'📌', frd:'📐', uiux:'🎨', wireframes:'🖼️', meeting_notes:'📝', technical:'⚙️', test_report:'🧪', release:'🚀', billing:'💰', contract:'📜', other:'📄' }
  return ic[cat] || '📄'
}
function docCategoryColor(cat) {
  const c = { sow:'#6366f1', brd:'#06b6d4', frd:'#8b5cf6', uiux:'#ec4899', wireframes:'#f59e0b', meeting_notes:'#10b981', technical:'#64748b', test_report:'#f97316', release:'#14b8a6', billing:'#22c55e', contract:'#3b82f6', other:'#475569' }
  return c[cat] || '#475569'
}

// ── Main render entry ────────────────────────────────────────
function renderApp() {
  const app = document.getElementById('app')
  if (!_user) { renderLogin(); return }
  if (_user.role === 'client') { renderClientPortal(); return }

  // Build the shell once
  if (!document.getElementById('sidebar')) {
    app.innerHTML = buildShell()
    bindNav()
  }
  const pg = Router.current?.page || defaultPage()
  showPage(pg)
  updateNav(pg)
  updateTopbar(pg)
  updateBackButton()
}

function defaultPage() {
  const map = { admin: 'super-dashboard', pm: 'pm-dashboard', developer: 'dev-dashboard' }
  return map[_user?.role] || 'pm-dashboard'
}

// ── Shell HTML ────────────────────────────────────────────────
function buildShell() {
  const role = _user.role
  const navAdmin = role === 'admin' ? `
    <div class="nav-section">
      <div class="nav-section-title">Admin</div>
      <a class="nav-item" data-page="super-dashboard"><span class="nav-icon"><i class="fas fa-chart-pie"></i></span>Overview</a>
      <a class="nav-item" data-page="clients-list"><span class="nav-icon"><i class="fas fa-building"></i></span>Clients</a>
      <a class="nav-item" data-page="billing-admin"><span class="nav-icon"><i class="fas fa-file-invoice-dollar"></i></span>Billing <span class="nav-badge" id="nb-overdue">!</span></a>
      <a class="nav-item" data-page="team-overview"><span class="nav-icon"><i class="fas fa-users"></i></span>Team</a>
    </div>` : ''

  const navPm = ['admin','pm'].includes(role) ? `
    <div class="nav-section">
      <div class="nav-section-title">Project Management</div>
      <a class="nav-item" data-page="pm-dashboard"><span class="nav-icon"><i class="fas fa-gauge-high"></i></span>PM Dashboard</a>
      <a class="nav-item" data-page="projects-list"><span class="nav-icon"><i class="fas fa-layer-group"></i></span>Projects</a>
      <a class="nav-item" data-page="kanban-board"><span class="nav-icon"><i class="fas fa-columns"></i></span>Kanban Board</a>
      <a class="nav-item" data-page="sprints-view"><span class="nav-icon"><i class="fas fa-bolt"></i></span>Sprints</a>
      <a class="nav-item" data-page="milestones-view"><span class="nav-icon"><i class="fas fa-flag"></i></span>Milestones</a>
      <a class="nav-item" data-page="documents-center"><span class="nav-icon"><i class="fas fa-folder-open"></i></span>Documents</a>
      <a class="nav-item" data-page="resources-view"><span class="nav-icon"><i class="fas fa-users-gear"></i></span>Resources</a>
    </div>` : ''

  const navDev = `
    <div class="nav-section">
      <div class="nav-section-title">${role === 'developer' ? 'My Work' : 'Developer View'}</div>
      ${role === 'developer' ? `<a class="nav-item" data-page="dev-dashboard"><span class="nav-icon"><i class="fas fa-gauge"></i></span>My Dashboard</a>` : ''}
      <a class="nav-item" data-page="my-tasks"><span class="nav-icon"><i class="fas fa-list-check"></i></span>Tasks</a>
      <a class="nav-item" data-page="timesheets-view"><span class="nav-icon"><i class="fas fa-clock"></i></span>Timesheets</a>
      ${role !== 'developer' ? `<a class="nav-item" data-page="approval-queue"><span class="nav-icon"><i class="fas fa-clipboard-check"></i></span>Approvals <span class="nav-badge" id="nb-approval">0</span></a>` : ''}
    </div>`

  const navReports = `
    <div class="nav-section">
      <div class="nav-section-title">Analytics</div>
      <a class="nav-item" data-page="reports-view"><span class="nav-icon"><i class="fas fa-chart-bar"></i></span>Reports</a>
      <a class="nav-item" data-page="alerts-view"><span class="nav-icon"><i class="fas fa-bell"></i></span>Alerts <span class="nav-badge" id="nb-alerts">0</span></a>
    </div>`

  return `
  <div id="sidebar">
    <div class="logo">
      <h1><i class="fas fa-rocket" style="color:#6366f1;margin-right:8px"></i>DevPortal</h1>
      <span>Mariox Software</span>
    </div>
    ${navAdmin}${navPm}${navDev}${navReports}
    <div class="nav-section">
      <div class="nav-section-title">Settings</div>
      <a class="nav-item" data-page="settings-view"><span class="nav-icon"><i class="fas fa-gear"></i></span>Settings</a>
    </div>
    <div class="sidebar-footer">
      <div class="user-card" onclick="showProfileModal()">
        ${avatar(_user.name||_user.full_name, _user.avatar_color||'#6366f1')}
        <div style="min-width:0">
          <div style="font-size:13px;font-weight:600;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_user.name||_user.full_name}</div>
          <div style="font-size:11px;color:#64748b;text-transform:capitalize">${_user.role}</div>
        </div>
        <i class="fas fa-ellipsis" style="color:#475569;margin-left:auto;font-size:12px"></i>
      </div>
    </div>
  </div>
  <div id="topbar">
    <button class="icon-btn" onclick="toggleSidebar()" style="display:none" id="menu-toggle"><i class="fas fa-bars"></i></button>
    <button class="icon-btn" id="back-btn" onclick="Router.back()" style="display:none" data-tip="Go Back"><i class="fas fa-arrow-left"></i></button>
    <div class="breadcrumb" id="breadcrumb">
      <span>DevPortal</span><i class="fas fa-chevron-right" style="font-size:10px"></i><span class="current" id="bc-current">Dashboard</span>
    </div>
    <div class="topbar-actions">
      <div class="search-wrap">
        <i class="fas fa-search"></i>
        <input class="search-bar" placeholder="Search tasks, projects…" id="global-search" oninput="globalSearch(this.value)"/>
      </div>
      <button class="icon-btn notif-btn" onclick="showNotifications()"><i class="fas fa-bell"></i><span class="notif-dot" id="notif-dot" style="display:none"></span></button>
      <button class="icon-btn" onclick="logout()" data-tip="Logout"><i class="fas fa-sign-out-alt"></i></button>
    </div>
  </div>
  <div id="main">
    <div id="page-super-dashboard"  class="page"></div>
    <div id="page-pm-dashboard"     class="page"></div>
    <div id="page-dev-dashboard"    class="page"></div>
    <div id="page-projects-list"    class="page"></div>
    <div id="page-kanban-board"     class="page"></div>
    <div id="page-sprints-view"     class="page"></div>
    <div id="page-milestones-view"  class="page"></div>
    <div id="page-documents-center" class="page"></div>
    <div id="page-resources-view"   class="page"></div>
    <div id="page-my-tasks"         class="page"></div>
    <div id="page-timesheets-view"  class="page"></div>
    <div id="page-approval-queue"   class="page"></div>
    <div id="page-reports-view"     class="page"></div>
    <div id="page-alerts-view"      class="page"></div>
    <div id="page-clients-list"     class="page"></div>
    <div id="page-billing-admin"    class="page"></div>
    <div id="page-team-overview"    class="page"></div>
    <div id="page-settings-view"    class="page"></div>
  </div>
  <div id="drawer-overlay" class="drawer-overlay" onclick="closeDrawer()"></div>
  <div id="task-drawer" class="drawer task-detail"></div>
  <div id="modal-root"></div>
  <div id="toast-container"></div>`
}

function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
  const el = document.getElementById('page-'+page)
  if (!el) return
  el.classList.add('active')
  // Lazy-load page content
  if (!el.dataset.loaded) {
    el.dataset.loaded = '1'
    loadPage(page, el)
  }
}

function updateNav(page) {
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.page === page)
  })
}

const breadcrumbMap = {
  'super-dashboard':'Overview','pm-dashboard':'PM Dashboard','dev-dashboard':'My Dashboard',
  'projects-list':'Projects','kanban-board':'Kanban Board','sprints-view':'Sprints',
  'milestones-view':'Milestones','documents-center':'Documents','resources-view':'Resources',
  'my-tasks':'My Tasks','timesheets-view':'Timesheets','approval-queue':'Approvals',
  'reports-view':'Reports & Analytics','alerts-view':'Alerts','clients-list':'Clients',
  'billing-admin':'Billing & Invoices','team-overview':'Team','settings-view':'Settings'
}
function updateTopbar(page) {
  const el = document.getElementById('bc-current')
  if (el) el.textContent = breadcrumbMap[page] || page
}

function updateBackButton() {
  const backBtn = document.getElementById('back-btn')
  if (backBtn) {
    backBtn.style.display = Router.history.length > 0 ? 'flex' : 'none'
  }
}

function bindNav() {
  document.getElementById('sidebar').addEventListener('click', e => {
    const item = e.target.closest('[data-page]')
    if (item) { Router.navigate(item.dataset.page) }
  })
  loadBadges()
}

async function loadBadges() {
  try {
    const data = await API.get('/alerts')
    const unread = (data.alerts||[]).filter(a=>!a.is_read&&!a.is_dismissed).length
    const nb = document.getElementById('nb-alerts')
    if (nb) { nb.textContent = unread||''; nb.style.display = unread?'':'none' }
    const dot = document.getElementById('notif-dot')
    if (dot) dot.style.display = unread ? '' : 'none'
  } catch {}
  try {
    const data = await API.get('/timesheets?approval_status=pending')
    const cnt = (data.timesheets||data||[]).length
    const nb = document.getElementById('nb-approval')
    if (nb) { nb.textContent = cnt||'0' }
  } catch {}
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open')
}

function logout() {
  clearAuth()
  document.getElementById('app').innerHTML = ''
  renderLogin()
  toast('Logged out successfully', 'info')
}

// ── Login Page ────────────────────────────────────────────────
function renderLogin() {
  document.getElementById('app').innerHTML = `
  <div id="login-page">
    <div class="login-card">
      <div class="login-logo">
        <div style="width:52px;height:52px;background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.3);border-radius:14px;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:22px">🚀</div>
        <h1>DevPortal</h1>
        <p>Mariox Software – Project & Client Platform</p>
      </div>
      <div id="login-tabs" style="display:flex;gap:4px;margin-bottom:20px;background:rgba(255,255,255,.04);border-radius:8px;padding:3px">
        <button class="btn w-full" id="tab-staff" onclick="switchLoginTab('staff')" style="background:rgba(99,102,241,.2);color:#818cf8;border-radius:6px">Staff Login</button>
        <button class="btn w-full" id="tab-client" onclick="switchLoginTab('client')" style="background:transparent;color:#64748b;border-radius:6px">Client Portal</button>
      </div>
      <div id="staff-login-form">
        <form onsubmit="doLogin();return false;" autocomplete="on">
        <div class="form-group">
          <label class="form-label">Email</label>
          <input id="login-email" type="email" class="form-input" placeholder="you@mariox.in" value="admin@devtrack.com" autocomplete="email"/>
        </div>
        <div class="form-group">
          <label class="form-label">Password</label>
          <div style="position:relative">
            <input id="login-pass" type="password" class="form-input" placeholder="••••••••" value="Admin@123" autocomplete="current-password"/>
            <button type="button" onclick="togglePass('login-pass',this)" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;color:#64748b;cursor:pointer"><i class="fas fa-eye"></i></button>
          </div>
        </div>
        <button type="submit" class="btn btn-primary w-full" style="margin-top:4px"><i class="fas fa-sign-in-alt"></i>Sign In</button>
        </form>
        <div style="margin-top:16px">
          <p style="font-size:11px;color:#475569;text-align:center;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px">Quick Access</p>
          <div class="quick-logins">
            ${[['admin@devtrack.com','Admin@123','⚡ Super Admin','#6366f1'],['sarah.pm@devtrack.com','Password@123','📋 PM - Sarah','#0ea5e9'],['rahul@devtrack.com','Password@123','💻 Dev - Rahul','#f59e0b'],['priya@devtrack.com','Password@123','🎨 Dev - Priya','#ec4899']].map(([e,p,n,c])=>`<div class="quick-login-btn" onclick="quickLogin('${e}','${p}')"><div class="ql-name">${n}</div><div class="ql-role">${e}</div></div>`).join('')}
          </div>
        </div>
      </div>
      <div id="client-login-form" style="display:none">
        <form onsubmit="doClientLogin();return false;" autocomplete="on">
        <div class="form-group">
          <label class="form-label">Company Email</label>
          <input id="cl-email" type="email" class="form-input" placeholder="admin@yourcompany.com" value="admin@growniq.com" autocomplete="email"/>
        </div>
        <div class="form-group">
          <label class="form-label">Password</label>
          <input id="cl-pass" type="password" class="form-input" placeholder="••••••••" value="Password@123" autocomplete="current-password"/>
        </div>
        <button type="submit" class="btn btn-primary w-full" style="margin-top:4px"><i class="fas fa-sign-in-alt"></i>Client Sign In</button>
        </form>
        <div style="margin-top:14px;padding:12px;background:rgba(6,182,212,.07);border:1px solid rgba(6,182,212,.2);border-radius:8px;font-size:12px;color:#94a3b8">
          <p style="margin-bottom:6px;font-weight:600;color:#22d3ee"><i class="fas fa-info-circle mr-1"></i>Demo Client Accounts</p>
          ${[['admin@growniq.com','Growniq Technologies'],['admin@healwin.com','HealWin Healthcare'],['admin@kavach.com','Kavach Security']].map(([e,n])=>`<div class="quick-login-btn" style="margin-top:4px" onclick="quickClientLogin('${e}')"><div class="ql-name">${n}</div><div class="ql-role">${e}</div></div>`).join('')}
        </div>
        <p style="text-align:center;margin-top:14px;font-size:12px;color:#475569">New client? <a href="#" onclick="showClientSignup()" style="color:#818cf8;text-decoration:none">Request Access</a></p>
      </div>
    </div>
  </div>`
}

function switchLoginTab(tab) {
  document.getElementById('staff-login-form').style.display = tab==='staff' ? '' : 'none'
  document.getElementById('client-login-form').style.display = tab==='client' ? '' : 'none'
  document.getElementById('tab-staff').style.cssText = tab==='staff' ? 'background:rgba(99,102,241,.2);color:#818cf8;border-radius:6px' : 'background:transparent;color:#64748b;border-radius:6px'
  document.getElementById('tab-client').style.cssText = tab==='client' ? 'background:rgba(99,102,241,.2);color:#818cf8;border-radius:6px' : 'background:transparent;color:#64748b;border-radius:6px'
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim()
  const password = document.getElementById('login-pass').value
  if (!email || !password) return toast('Enter email and password', 'error')
  try {
    const data = await API.post('/auth/login', { email, password })
    saveAuth(data.token, { ...data.user, role: data.user.role })
    toast('Welcome back, ' + (data.user.full_name||data.user.name) + '!', 'success')
    Router.navigate(defaultPage())
  } catch(e) { toast(e.message, 'error') }
}

async function doClientLogin() {
  const email = document.getElementById('cl-email').value.trim()
  const password = document.getElementById('cl-pass').value || 'Password@123'
  try {
    const data = await API.post('/client-auth/login', { email, password })
    saveAuth(data.token, { ...data.client, role: 'client', name: data.client.contact_name })
    toast('Welcome, ' + data.client.contact_name + '!', 'success')
    renderClientPortal()
  } catch(e) { toast(e.message || 'Login failed', 'error') }
}

function quickLogin(email, pass) {
  document.getElementById('login-email').value = email
  document.getElementById('login-pass').value = pass
  doLogin()
}
function quickClientLogin(email) {
  document.getElementById('cl-email').value = email
  document.getElementById('cl-pass').value = 'Password@123'
  doClientLogin()
}
function togglePass(id, btn) {
  const inp = document.getElementById(id)
  const show = inp.type === 'password'
  inp.type = show ? 'text' : 'password'
  btn.innerHTML = `<i class="fas fa-eye${show?'-slash':''}"></i>`
}

function showClientSignup() {
  showModal(`
    <div class="modal-header"><h3>Request Client Access</h3><button class="close-btn" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <div class="form-row">
        <div class="form-group"><label class="form-label">Company Name *</label><input class="form-input" id="cs-company" placeholder="Acme Corp"/></div>
        <div class="form-group"><label class="form-label">Contact Name *</label><input class="form-input" id="cs-contact" placeholder="John Doe"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Email *</label><input class="form-input" type="email" id="cs-email" placeholder="john@acme.com"/></div>
        <div class="form-group"><label class="form-label">Password *</label><input class="form-input" type="password" id="cs-pass" placeholder="••••••••"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Phone</label><input class="form-input" id="cs-phone" placeholder="+91-9800000000"/></div>
        <div class="form-group"><label class="form-label">Industry</label><input class="form-input" id="cs-industry" placeholder="SaaS / Fintech"/></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="doClientSignup()"><i class="fas fa-user-plus"></i>Create Account</button>
    </div>`)
}

async function doClientSignup() {
  const body = {
    email: document.getElementById('cs-email').value.trim(),
    password: document.getElementById('cs-pass').value,
    company_name: document.getElementById('cs-company').value.trim(),
    contact_name: document.getElementById('cs-contact').value.trim(),
    phone: document.getElementById('cs-phone').value.trim(),
    industry: document.getElementById('cs-industry').value.trim()
  }
  if (!body.email || !body.password || !body.company_name || !body.contact_name) return toast('Fill required fields', 'error')
  try {
    const data = await API.post('/client-auth/signup', body)
    saveAuth(data.token, { ...data.client, role: 'client', name: data.client.contact_name })
    closeModal()
    toast('Account created! Welcome, ' + data.client.contact_name, 'success')
    renderClientPortal()
  } catch(e) { toast(e.message, 'error') }
}

// ── Modal helpers ─────────────────────────────────────────────
function showModal(html, size='') {
  const root = document.getElementById('modal-root')
  root.innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal ${size}">${html}</div></div>`
}
function closeModal() { document.getElementById('modal-root').innerHTML = '' }

// ── Drawer helpers ────────────────────────────────────────────
function openDrawer(html) {
  document.getElementById('task-drawer').innerHTML = html
  document.getElementById('task-drawer').classList.add('open')
  document.getElementById('drawer-overlay').classList.add('show')
}
function closeDrawer() {
  document.getElementById('task-drawer').classList.remove('open')
  document.getElementById('drawer-overlay').classList.remove('show')
}

// ── Profile Modal ─────────────────────────────────────────────
function showProfileModal() {
  showModal(`
    <div class="modal-header"><h3>My Profile</h3><button class="close-btn" onclick="closeModal()">✕</button></div>
    <div class="modal-body" style="text-align:center">
      ${avatar(_user.name||_user.full_name, _user.avatar_color||'#6366f1','xl')}
      <div style="margin-top:14px">
        <div style="font-size:18px;font-weight:700;color:#fff">${_user.name||_user.full_name}</div>
        <div style="font-size:13px;color:#94a3b8;text-transform:capitalize;margin-top:2px">${_user.role} • ${_user.designation||'DevPortal'}</div>
        <div style="font-size:13px;color:#64748b;margin-top:4px">${_user.email}</div>
      </div>
      <div style="margin-top:20px;display:flex;gap:10px;justify-content:center">
        <button class="btn btn-outline" onclick="closeModal()"><i class="fas fa-edit"></i>Edit Profile</button>
        <button class="btn btn-danger" onclick="logout();closeModal()"><i class="fas fa-sign-out-alt"></i>Logout</button>
      </div>
    </div>`)
}

// ── Notifications panel ───────────────────────────────────────
async function showNotifications() {
  try {
    const data = await API.get('/alerts?limit=10')
    const alerts = data.alerts || []
    const items = alerts.slice(0,8).map(a=>`
      <div style="padding:12px 16px;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:flex-start;gap:10px">
          <div style="width:32px;height:32px;border-radius:8px;background:${a.severity==='critical'?'var(--danger-light)':a.severity==='warning'?'var(--warning-light)':'var(--primary-light)'};display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0">
            ${a.severity==='critical'?'🔴':a.severity==='warning'?'⚠️':'ℹ️'}
          </div>
          <div><div style="font-size:13px;color:var(--text-primary);font-weight:600">${a.title}</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">${a.message.substring(0,80)}…</div></div>
        </div>
      </div>`).join('')
    showModal(`
      <div class="modal-header"><h3>Notifications</h3><button class="close-btn" onclick="closeModal()">✕</button></div>
      <div style="max-height:420px;overflow-y:auto">${items||'<div class="empty-state"><i class="fas fa-bell-slash"></i><p>No new alerts</p></div>'}</div>
      <div class="modal-footer"><button class="btn btn-primary" onclick="Router.navigate('alerts-view');closeModal()"><i class="fas fa-list"></i>View All Alerts</button></div>`)
  } catch(e) { toast('Failed to load notifications', 'error') }
}

// ── Global search ─────────────────────────────────────────────
let searchTimeout
function globalSearch(q) {
  clearTimeout(searchTimeout)
  if (!q || q.length < 2) return
  searchTimeout = setTimeout(async () => {
    try {
      const [tasks, projects] = await Promise.all([
        API.get('/tasks?project_id='),
        API.get('/projects')
      ])
      const allTasks = tasks.tasks||[]
      const allProjects = projects.projects||[]
      const ql = q.toLowerCase()
      const matchT = allTasks.filter(t=>t.title.toLowerCase().includes(ql)).slice(0,5)
      const matchP = allProjects.filter(p=>p.name.toLowerCase().includes(ql)||p.code.toLowerCase().includes(ql)).slice(0,3)
      if (!matchT.length && !matchP.length) return
      toast(`Found ${matchT.length} tasks, ${matchP.length} projects for "${q}"`, 'info', 2500)
    } catch {}
  }, 400)
}

// ── Page loader dispatcher ────────────────────────────────────
function loadPage(page, el) {
  switch(page) {
    case 'super-dashboard':  renderSuperDashboard(el); break
    case 'pm-dashboard':     renderPMDashboard(el); break
    case 'dev-dashboard':    renderDevDashboard(el); break
    case 'projects-list':    renderProjectsList(el); break
    case 'kanban-board':     renderKanbanBoard(el); break
    case 'sprints-view':     renderSprintsView(el); break
    case 'milestones-view':  renderMilestonesView(el); break
    case 'documents-center': renderDocumentsCenter(el); break
    case 'resources-view':   renderResourcesView(el); break
    case 'my-tasks':         renderMyTasks(el); break
    case 'timesheets-view':  renderTimesheetsView(el); break
    case 'approval-queue':   renderApprovalQueue(el); break
    case 'reports-view':     renderReportsView(el); break
    case 'alerts-view':      renderAlertsView(el); break
    case 'clients-list':     renderClientsList(el); break
    case 'billing-admin':    renderBillingAdmin(el); break
    case 'team-overview':    renderTeamOverview(el); break
    case 'settings-view':    renderSettingsView(el); break
    default: el.innerHTML = `<div class="page-header"><h1 class="page-title">${breadcrumbMap[page]||page}</h1></div><div class="empty-state"><i class="fas fa-hammer"></i><p>Module coming soon…</p></div>`
  }
}

// ── Init ──────────────────────────────────────────────────────
function resolveInitialPage() {
  const path = (location.pathname || '/').replace(/\/+$/, '').toLowerCase()
  const legacyMap = {
    '/devportaloverview': 'super-dashboard',
    '/devportaldashboard': 'super-dashboard',
    '/overview': 'super-dashboard',
    '/dashboard': 'super-dashboard',
    '/pm-dashboard': 'pm-dashboard',
    '/dev-dashboard': 'dev-dashboard',
  }
  return legacyMap[path] || null
}

function init() {
  // If URL is /accept-invite, defer to project-extensions.js
  if (location.pathname === '/accept-invite') return

  if (loadAuth()) {
    if (_user.role === 'client') {
      if (typeof renderClientPortal === 'function') renderClientPortal()
    } else {
      const initialPage = resolveInitialPage() || defaultPage()
      Router.navigate(initialPage)
    }
  } else {
    renderLogin()
  }
}

if (document.readyState === 'complete') {
  init()
} else {
  window.addEventListener('load', init, { once: true })
}
