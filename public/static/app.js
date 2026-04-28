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
    const colors = { green:'#58C68A', yellow:'#FFCB47', red:'#FF5E3A', blue:'#FF7A45' }
    const bg = colors[color] || color
    const w = Math.max(0, Math.min(100, Number(pct||0)))
    return `<div class="progress-bar"><div class="progress-fill" style="width:${w}%;background:${bg}"></div></div>`
  },
  confirm: async (msg) => Promise.resolve(window.confirm(msg)),
}

const BASE = '/api'
let _token = null, _user = null
const SIDEBAR_GROUP_STORAGE_KEY = 'devportal_sidebar_groups'
const SIDEBAR_PAGE_GROUPS = {
  'super-dashboard': 'admin',
  'clients-list': 'admin',
  'billing-admin': 'admin',
  'team-overview': 'admin',
  'pm-dashboard': 'pm',
  'projects-list': 'pm',
  'kanban-board': 'pm',
  'sprints-view': 'pm',
  'milestones-view': 'pm',
  'documents-center': 'pm',
  'resources-view': 'pm',
  'dev-dashboard': 'dev',
  'my-tasks': 'dev',
  'timesheets-view': 'dev',
  'support-tickets': 'dev',
  'approval-queue': 'dev',
  'leaves-view': 'dev',
  'reports-view': 'analytics',
  'alerts-view': 'analytics',
  'settings-view': 'settings',
}
const SIDEBAR_GROUP_DEFAULTS = {
  admin: true,
  pm: true,
  dev: true,
  analytics: false,
  settings: true,
}
let _sidebarGroupState = loadSidebarGroupState()

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

const PAGE_SIZE_OPTIONS = [10, 15, 20, 25, 50, 100, 200]
window.PAGE_SIZE_OPTIONS = PAGE_SIZE_OPTIONS

function renderPager(pagination, prevFn, nextFn, label = 'items', pageKey = '') {
  if (!pagination) return ''
  const currentLimit = Number(pagination.limit || PAGE_SIZE_OPTIONS[0])
  const pageSizeControl = pageKey ? `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:12px;color:#64748b;white-space:nowrap">Rows per page</span>
        <select class="form-select" style="width:96px;padding:8px 28px 8px 10px" onchange="setEnterprisePageSize('${pageKey}', this.value)">
          ${PAGE_SIZE_OPTIONS.map(size => `<option value="${size}" ${currentLimit===size?'selected':''}>${size}</option>`).join('')}
        </select>
      </div>` : ''
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-top:1px solid var(--border);flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div style="font-size:12px;color:#94a3b8">
          ${pagination.total ? `Showing ${pagination.start}-${pagination.end} of ${pagination.total} ${label}` : `No ${label} found`}
        </div>
        ${pageSizeControl}
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

function loadSidebarGroupState() {
  try {
    const raw = localStorage.getItem(SIDEBAR_GROUP_STORAGE_KEY)
    return raw ? { ...SIDEBAR_GROUP_DEFAULTS, ...JSON.parse(raw) } : { ...SIDEBAR_GROUP_DEFAULTS }
  } catch {
    return { ...SIDEBAR_GROUP_DEFAULTS }
  }
}

function saveSidebarGroupState() {
  try {
    localStorage.setItem(SIDEBAR_GROUP_STORAGE_KEY, JSON.stringify(_sidebarGroupState))
  } catch {}
}

function applySidebarGroupState() {
  document.querySelectorAll('[data-nav-group]').forEach(group => {
    const key = group.dataset.navGroup
    const isOpen = _sidebarGroupState[key] !== false
    group.classList.toggle('is-open', isOpen)
    group.classList.toggle('is-collapsed', !isOpen)
    const toggle = group.querySelector('[data-nav-toggle]')
    if (toggle) toggle.setAttribute('aria-expanded', String(isOpen))
  })
}

function toggleSidebarGroup(groupKey) {
  if (!groupKey) return
  _sidebarGroupState[groupKey] = !(_sidebarGroupState[groupKey] !== false)
  saveSidebarGroupState()
  applySidebarGroupState()
}

function ensureSidebarGroupOpen(page) {
  const groupKey = SIDEBAR_PAGE_GROUPS[page]
  if (!groupKey) return
  if (_sidebarGroupState[groupKey] === false) {
    _sidebarGroupState[groupKey] = true
    saveSidebarGroupState()
  }
  applySidebarGroupState()
}

// ── Toast ────────────────────────────────────────────────────
function toast(msg, type='info', dur=3500) {
  let ct = document.getElementById('toast-container')
  if (!ct) { ct = document.createElement('div'); ct.id = 'toast-container'; document.body.appendChild(ct) }
  const icons = { success:'fa-check-circle', error:'fa-exclamation-circle', info:'fa-info-circle' }
  const t = document.createElement('div')
  t.className = `toast ${type}`
  t.innerHTML = `<i class="fas ${icons[type]||'fa-info-circle'}" style="color:${type==='success'?'#58C68A':type==='error'?'#FF5E3A':'#FF7A45'}"></i><span>${msg}</span>`
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
    if (window.innerWidth <= 768) closeSidebar()
    updateBackButton()
  },
  back() {
    if (this.history.length === 0) return
    this.current = this.history.pop()
    renderApp()
    if (window.innerWidth <= 768) closeSidebar()
    updateBackButton()
  }
}

// ── Colour helpers ───────────────────────────────────────────
function initials(name='') { return name.split(' ').map(p=>p[0]).join('').substring(0,2).toUpperCase() }
function avatar(name, color='#FF7A45', size='') {
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
function pctColor(p) { return p >= 90 ? '#FF5E3A' : p >= 70 ? '#FFCB47' : '#58C68A' }
function docCategoryIcon(cat) {
  const ic = { sow:'📋', brd:'📌', frd:'📐', uiux:'🎨', wireframes:'🖼️', meeting_notes:'📝', technical:'⚙️', test_report:'🧪', release:'🚀', billing:'💰', contract:'📜', other:'📄' }
  return ic[cat] || '📄'
}
function docCategoryColor(cat) {
  const c = { sow:'#FF7A45', brd:'#F4C842', frd:'#FF7A45', uiux:'#FF5E3A', wireframes:'#FFCB47', meeting_notes:'#58C68A', technical:'#64748b', test_report:'#FF7A45', release:'#FFB347', billing:'#58C68A', contract:'#FFA577', other:'#475569' }
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
  ensureSidebarGroupOpen(pg)
  applySidebarGroupState()
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
    <div class="nav-section nav-group nav-group-admin" data-nav-group="admin">
      <button class="nav-section-toggle" type="button" data-nav-toggle="admin" aria-expanded="true">
        <span class="nav-section-heading"><i class="fas fa-sparkles"></i> Admin</span>
        <span class="nav-section-chip">Core</span>
        <i class="fas fa-chevron-down nav-section-caret"></i>
      </button>
      <div class="nav-section-body">
        <a class="nav-item" data-page="super-dashboard"><span class="nav-icon"><i class="fas fa-chart-pie"></i></span>Overview</a>
        <a class="nav-item" data-page="clients-list"><span class="nav-icon"><i class="fas fa-building"></i></span>Clients</a>
        <a class="nav-item" data-page="billing-admin"><span class="nav-icon"><i class="fas fa-file-invoice-dollar"></i></span>Billing <span class="nav-badge" id="nb-overdue">!</span></a>
        <a class="nav-item" data-page="team-overview"><span class="nav-icon"><i class="fas fa-users"></i></span>Team</a>
      </div>
    </div>` : ''

  const navPm = ['admin','pm'].includes(role) ? `
    <div class="nav-section nav-group nav-group-pm" data-nav-group="pm">
      <button class="nav-section-toggle" type="button" data-nav-toggle="pm" aria-expanded="true">
        <span class="nav-section-heading"><i class="fas fa-layer-group"></i> Project Management</span>
        <span class="nav-section-chip">Work</span>
        <i class="fas fa-chevron-down nav-section-caret"></i>
      </button>
      <div class="nav-section-body">
        <a class="nav-item" data-page="pm-dashboard"><span class="nav-icon"><i class="fas fa-gauge-high"></i></span>PM Dashboard</a>
        <a class="nav-item" data-page="projects-list"><span class="nav-icon"><i class="fas fa-layer-group"></i></span>Projects</a>
        <a class="nav-item" data-page="kanban-board"><span class="nav-icon"><i class="fas fa-columns"></i></span>Kanban Board</a>
        <a class="nav-item" data-page="sprints-view"><span class="nav-icon"><i class="fas fa-bolt"></i></span>Sprints</a>
        <a class="nav-item" data-page="milestones-view"><span class="nav-icon"><i class="fas fa-flag"></i></span>Milestones</a>
        <a class="nav-item" data-page="documents-center"><span class="nav-icon"><i class="fas fa-folder-open"></i></span>Documents</a>
        <a class="nav-item" data-page="resources-view"><span class="nav-icon"><i class="fas fa-users-gear"></i></span>Resources</a>
      </div>
    </div>` : ''

  const navDev = `
    <div class="nav-section nav-group nav-group-dev" data-nav-group="dev">
      <button class="nav-section-toggle" type="button" data-nav-toggle="dev" aria-expanded="true">
        <span class="nav-section-heading"><i class="fas fa-code"></i> ${role === 'developer' ? 'My Work' : 'Developer View'}</span>
        <span class="nav-section-chip">${role === 'developer' ? 'Me' : 'Dev'}</span>
        <i class="fas fa-chevron-down nav-section-caret"></i>
      </button>
      <div class="nav-section-body">
        ${role === 'developer' ? `<a class="nav-item" data-page="dev-dashboard"><span class="nav-icon"><i class="fas fa-gauge"></i></span>My Dashboard</a>` : ''}
        <a class="nav-item" data-page="my-tasks"><span class="nav-icon"><i class="fas fa-list-check"></i></span>Tasks</a>
        <a class="nav-item" data-page="timesheets-view"><span class="nav-icon"><i class="fas fa-clock"></i></span>Timesheets</a>
        <a class="nav-item" data-page="leaves-view"><span class="nav-icon"><i class="fas fa-umbrella-beach"></i></span>Leaves <span class="nav-badge" id="nb-leaves">0</span></a>
        <a class="nav-item" data-page="support-tickets"><span class="nav-icon"><i class="fas fa-life-ring"></i></span>Support Tickets</a>
        ${role !== 'developer' ? `<a class="nav-item" data-page="approval-queue"><span class="nav-icon"><i class="fas fa-clipboard-check"></i></span>Approvals <span class="nav-badge" id="nb-approval">0</span></a>` : ''}
      </div>
    </div>`

  const navReports = `
    <div class="nav-section nav-group nav-group-analytics" data-nav-group="analytics">
      <button class="nav-section-toggle" type="button" data-nav-toggle="analytics" aria-expanded="false">
        <span class="nav-section-heading"><i class="fas fa-wand-magic-sparkles"></i> Analytics</span>
        <span class="nav-section-chip">Insight</span>
        <i class="fas fa-chevron-down nav-section-caret"></i>
      </button>
      <div class="nav-section-body">
        <a class="nav-item" data-page="reports-view"><span class="nav-icon"><i class="fas fa-chart-bar"></i></span>Reports</a>
        <a class="nav-item" data-page="alerts-view"><span class="nav-icon"><i class="fas fa-bell"></i></span>Alerts <span class="nav-badge" id="nb-alerts">0</span></a>
      </div>
    </div>`

  return `
  <div id="sidebar">
    <div class="logo">
      <div class="sidebar-logo-mark"><img src="/static/images/mariox-logo.jpg" alt="Mariox" onerror="this.outerHTML='<i class=\\'fas fa-rocket\\'></i>'"/></div>
      <div class="sidebar-logo-text">
        <span>Mariox Software</span>
      </div>
    </div>
    ${navAdmin}${navPm}${navDev}${navReports}
    <div class="nav-section nav-group nav-group-settings" data-nav-group="settings">
      <button class="nav-section-toggle" type="button" data-nav-toggle="settings" aria-expanded="true">
        <span class="nav-section-heading"><i class="fas fa-sliders"></i> Settings</span>
        <span class="nav-section-chip">App</span>
        <i class="fas fa-chevron-down nav-section-caret"></i>
      </button>
      <div class="nav-section-body">
        <a class="nav-item" data-page="settings-view"><span class="nav-icon"><i class="fas fa-gear"></i></span>Settings</a>
      </div>
    </div>
    <div class="sidebar-footer">
      <div class="user-card" onclick="showProfileModal()">
        ${avatar(_user.name||_user.full_name, _user.avatar_color||'#FF7A45')}
        <div style="min-width:0">
          <div style="font-size:13px;font-weight:700;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_user.name||_user.full_name}</div>
          <div style="font-size:11px;color:#94a3b8;text-transform:capitalize">${_user.role}</div>
        </div>
        <i class="fas fa-ellipsis" style="color:#64748b;margin-left:auto;font-size:12px"></i>
      </div>
    </div>
  </div>
  <div id="sidebar-overlay" class="sidebar-overlay" onclick="closeSidebar()"></div>
  <div id="topbar">
    <button class="topbar-hamburger" onclick="toggleSidebar()" id="menu-toggle" aria-label="Toggle sidebar"><i class="fas fa-bars"></i></button>
    <button class="icon-btn" id="back-btn" onclick="Router.back()" style="display:none" data-tip="Go Back"><i class="fas fa-arrow-left"></i></button>
    <div class="breadcrumb" id="breadcrumb">
      <span>DevPortal</span><i class="fas fa-chevron-right" style="font-size:10px"></i><span class="current" id="bc-current">Dashboard</span>
    </div>
    <div class="topbar-actions">
      <div class="search-wrap">
        <i class="fas fa-search"></i>
        <input class="search-bar" placeholder="Search tasks, projects…" id="global-search" oninput="globalSearch(this.value)"/>
      </div>
      <button class="icon-btn notif-btn" onclick="showNotifications()" data-tip="Notifications"><i class="fas fa-bell"></i><span class="notif-dot" id="notif-dot" style="display:none"></span><span class="notif-badge" id="notif-badge" style="display:none">0</span></button>
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
    <div id="page-leaves-view"      class="page"></div>
    <div id="page-reports-view"     class="page"></div>
    <div id="page-alerts-view"      class="page"></div>
    <div id="page-clients-list"     class="page"></div>
    <div id="page-billing-admin"    class="page"></div>
    <div id="page-team-overview"    class="page"></div>
    <div id="page-support-tickets"  class="page"></div>
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
  ensureSidebarGroupOpen(page)
}

const breadcrumbMap = {
  'super-dashboard':'Overview','pm-dashboard':'PM Dashboard','dev-dashboard':'My Dashboard',
  'projects-list':'Projects','kanban-board':'Kanban Board','sprints-view':'Sprints',
  'milestones-view':'Milestones','documents-center':'Documents','resources-view':'Resources',
  'my-tasks':'My Tasks','timesheets-view':'Timesheets','approval-queue':'Approvals','leaves-view':'Leaves',
  'reports-view':'Reports & Analytics','alerts-view':'Alerts','clients-list':'Clients',
  'billing-admin':'Billing & Invoices','team-overview':'Team','support-tickets':'Support Tickets','settings-view':'Settings'
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
    const toggle = e.target.closest('[data-nav-toggle]')
    if (toggle) {
      toggleSidebarGroup(toggle.dataset.navToggle)
      return
    }
    const item = e.target.closest('[data-page]')
    if (item) {
      Router.navigate(item.dataset.page)
      if (window.innerWidth <= 768) closeSidebar()
    }
  })
  applySidebarGroupState()
  loadBadges()
  startNotificationPoller()
}

async function loadBadges() {
  try {
    const [alertsData, notifData] = await Promise.all([
      API.get('/alerts').catch(() => ({ alerts: [] })),
      API.get('/notifications/unread-count').catch(() => ({ unread_count: 0 })),
    ])
    const alertUnread = (alertsData.alerts||[]).filter(a=>!a.is_read&&!a.is_dismissed).length
    const notifUnread = notifData.unread_count || 0
    const total = alertUnread + notifUnread
    const nb = document.getElementById('nb-alerts')
    if (nb) { nb.textContent = total||''; nb.style.display = total?'':'none' }
  } catch {}
  try {
    const data = await API.get('/timesheets?approval_status=pending')
    const cnt = (data.timesheets||data||[]).length
    const nb = document.getElementById('nb-approval')
    if (nb) { nb.textContent = cnt||'0' }
  } catch {}
  // Notifications badge + initial sync
  pollNotifications(true)
}

// ── Notifications: poller + sound + toast ─────────────────────
const _notifState = {
  lastSeenId: null,
  lastSeenAt: null,
  unreadCount: 0,
  recent: [],
  audioCtx: null,
  timer: null,
  initialized: false,
}

function _notifPlayDing() {
  // Light "ding" via Web Audio API — no asset needed.
  try {
    if (!_notifState.audioCtx) {
      const Ctor = window.AudioContext || window.webkitAudioContext
      if (!Ctor) return
      _notifState.audioCtx = new Ctor()
    }
    const ctx = _notifState.audioCtx
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    const now = ctx.currentTime
    const tone = (freq, start, dur, peak = 0.18) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now + start)
      gain.gain.setValueAtTime(0, now + start)
      gain.gain.linearRampToValueAtTime(peak, now + start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + start)
      osc.stop(now + start + dur + 0.02)
    }
    // Two-note chime
    tone(880, 0, 0.18)
    tone(1320, 0.10, 0.22)
  } catch (e) {
    // sound failures are non-fatal
  }
}

function _notifSetBadge(count) {
  _notifState.unreadCount = count
  const dot = document.getElementById('notif-dot')
  const badge = document.getElementById('notif-badge')
  if (dot) dot.style.display = count > 0 ? '' : 'none'
  if (badge) {
    if (count > 0) {
      badge.style.display = ''
      badge.textContent = count > 99 ? '99+' : String(count)
    } else {
      badge.style.display = 'none'
    }
  }
  // Sidebar "Alerts" badge is owned by loadBadges() (alerts + notifications).
  // Refresh it whenever the bell count changes so both stay in sync.
  if (typeof loadBadges === 'function') loadBadges()
}

function _notifShowToast(n) {
  if (typeof toast !== 'function') return
  const text = `${n.title}${n.body ? ' — ' + n.body : ''}`
  toast(text.length > 140 ? text.slice(0, 140) + '…' : text, 'info')
}

async function pollNotifications(initial = false) {
  try {
    const res = await API.get('/notifications/unread-count')
    const count = res.unread_count || 0
    const latestId = res.latest_id || null
    const recent = res.recent || []
    const previousLastSeen = _notifState.lastSeenId
    _notifState.recent = recent

    // First load: just sync state, don't ding
    if (!_notifState.initialized) {
      _notifState.lastSeenId = latestId
      _notifState.lastSeenAt = res.latest_created_at || null
      _notifState.initialized = true
      _notifSetBadge(count)
      return
    }

    if (latestId && latestId !== previousLastSeen) {
      // Find which entries are new (newer than lastSeenAt)
      const cutoff = _notifState.lastSeenAt
      const fresh = recent.filter((n) => !cutoff || (n.created_at && n.created_at > cutoff))
      if (fresh.length) {
        _notifPlayDing()
        // Show up to 2 toasts so we don't spam
        fresh.slice(0, 2).forEach(_notifShowToast)
      }
      _notifState.lastSeenId = latestId
      _notifState.lastSeenAt = res.latest_created_at || _notifState.lastSeenAt
    }
    _notifSetBadge(count)
  } catch {
    // ignore — likely offline / unauthenticated
  }
}

function startNotificationPoller() {
  if (_notifState.timer) return
  _notifState.timer = setInterval(() => {
    if (document.visibilityState === 'visible') pollNotifications()
  }, 20000)
  // Resume immediately when tab becomes visible
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pollNotifications()
  })
}

function stopNotificationPoller() {
  if (_notifState.timer) {
    clearInterval(_notifState.timer)
    _notifState.timer = null
  }
  _notifState.initialized = false
  _notifSetBadge(0)
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar')
  const overlay = document.getElementById('sidebar-overlay')
  if (!sidebar) return
  sidebar.classList.toggle('mobile-open')
  const isOpen = sidebar.classList.contains('mobile-open')
  if (overlay) overlay.classList.toggle('show', isOpen)
  document.body.style.overflow = isOpen ? 'hidden' : ''
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar')
  const overlay = document.getElementById('sidebar-overlay')
  if (sidebar) sidebar.classList.remove('mobile-open')
  if (overlay) overlay.classList.remove('show')
  document.body.style.overflow = ''
}

window.addEventListener('resize', () => {
  if (window.innerWidth > 768) closeSidebar()
})

function logout() {
  clearAuth()
  if (typeof stopNotificationPoller === 'function') stopNotificationPoller()
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
        <div class="login-logo-mark"><img src="/static/images/mariox-logo.jpg" alt="Mariox" onerror="this.outerHTML='🚀'"/></div>
        <h1>Mariox Software</h1>
        <p>Project &amp; Client Platform</p>
      </div>
      <div>
        <form onsubmit="doLogin();return false;" autocomplete="on">
          <div class="form-group">
            <label class="form-label">Email</label>
            <input id="login-email" type="email" class="form-input" placeholder="you@mariox.in" autocomplete="email"/>
          </div>
          <div class="form-group">
            <label class="form-label">Password</label>
            <div style="position:relative">
              <input id="login-pass" type="password" class="form-input" placeholder="••••••••" autocomplete="current-password"/>
              <button type="button" onclick="togglePass('login-pass',this)" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;color:#64748b;cursor:pointer"><i class="fas fa-eye"></i></button>
            </div>
          </div>
          <button type="submit" class="btn btn-primary w-full" style="margin-top:4px"><i class="fas fa-sign-in-alt"></i>Sign In</button>
        </form>
        <p style="text-align:center;margin-top:14px;font-size:12px;color:#64748b">One sign-in for staff and client accounts</p>
        <p style="text-align:center;margin-top:6px;font-size:12px;color:#64748b">New client? <a href="#" onclick="showClientSignup()" style="color:#FF7A45;text-decoration:none;font-weight:700">Request Access</a></p>
      </div>
    </div>
  </div>`
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim()
  const password = document.getElementById('login-pass').value
  if (!email || !password) return toast('Enter email and password', 'error')
  try {
    let data = null
    try {
      data = await API.post('/auth/login', { email, password })
      saveAuth(data.token, { ...data.user, role: data.user.role })
      toast('Welcome back, ' + (data.user.full_name||data.user.name) + '!', 'success')
      Router.navigate(defaultPage())
      return
    } catch (staffErr) {
      try {
        data = await API.post('/client-auth/login', { email, password })
        saveAuth(data.token, { ...data.client, role: 'client', name: data.client.contact_name })
        toast('Welcome, ' + data.client.contact_name + '!', 'success')
        renderClientPortal()
        return
      } catch {
        throw staffErr
      }
    }
  } catch(e) { toast(e.message, 'error') }
}

async function doClientLogin() {
  const email = document.getElementById('cl-email').value.trim()
  const password = document.getElementById('cl-pass').value
  try {
    const data = await API.post('/client-auth/login', { email, password })
    saveAuth(data.token, { ...data.client, role: 'client', name: data.client.contact_name })
    toast('Welcome, ' + data.client.contact_name + '!', 'success')
    renderClientPortal()
  } catch(e) { toast(e.message || 'Login failed', 'error') }
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
  let root = document.getElementById('modal-root')
  if (!root) {
    root = document.createElement('div')
    root.id = 'modal-root'
    document.body.appendChild(root)
  }
  root.innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal ${size}">${html}</div></div>`
}
function closeModal() {
  const root = document.getElementById('modal-root')
  if (root) root.innerHTML = ''
}

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
      ${avatar(_user.name||_user.full_name, _user.avatar_color||'#FF7A45','xl')}
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
function _notifIcon(type) {
  const map = {
    ticket_created:        { icon: 'fa-ticket', color: '#FF7A45' },
    ticket_assigned:       { icon: 'fa-user-check', color: '#C56FE6' },
    ticket_status:         { icon: 'fa-circle-half-stroke', color: '#FFA577' },
    ticket_priority:       { icon: 'fa-flag', color: '#FFCB47' },
    ticket_comment:        { icon: 'fa-message', color: '#FFB67A' },
    ticket_internal_note:  { icon: 'fa-lock', color: '#FFCB47' },
  }
  return map[type] || { icon: 'fa-bell', color: '#FFB347' }
}

function _notifTimeAgo(iso) {
  if (!iso) return ''
  const ms = Math.max(0, Date.now() - new Date(iso).getTime())
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return m + 'm ago'
  const h = Math.floor(m / 60)
  if (h < 24) return h + 'h ago'
  const d = Math.floor(h / 24)
  if (d < 30) return d + 'd ago'
  return new Date(iso).toLocaleDateString()
}

function _notifEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

async function showNotifications() {
  try {
    // Wake the audio context (browsers require a user gesture before sound plays)
    if (_notifState.audioCtx?.state === 'suspended') _notifState.audioCtx.resume().catch(() => {})

    const data = await API.get('/notifications/me?limit=50')
    const items = data.notifications || data.data || []
    const itemsHtml = items.map((n) => {
      const ic = _notifIcon(n.type)
      const unread = !n.is_read
      return `
        <div class="notif-row ${unread ? 'is-unread' : ''}" data-id="${_notifEsc(n.id)}" data-link="${_notifEsc(n.link || '')}" onclick="onNotifClick('${_notifEsc(n.id)}','${_notifEsc(n.link || '')}')">
          <div class="notif-row-icon" style="background:${ic.color}22;color:${ic.color};border-color:${ic.color}55"><i class="fas ${ic.icon}"></i></div>
          <div class="notif-row-body">
            <div class="notif-row-title">${_notifEsc(n.title)}</div>
            ${n.body ? `<div class="notif-row-text">${_notifEsc(n.body)}</div>` : ''}
            <div class="notif-row-time">${_notifTimeAgo(n.created_at)}</div>
          </div>
          ${unread ? '<span class="notif-row-dot"></span>' : ''}
        </div>`
    }).join('')

    showModal(`
      <div class="modal-header">
        <h3><i class="fas fa-bell" style="margin-right:6px"></i> Notifications</h3>
        <button class="close-btn" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body" style="padding:0">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text-muted)">
          <span id="notif-panel-summary">${data.unread_count || 0} unread · ${items.length} recent</span>
          ${items.length ? '<button class="btn btn-xs btn-outline" onclick="markAllNotifsRead()"><i class="fas fa-check-double"></i> Mark all read</button>' : ''}
        </div>
        <div class="notif-list">
          ${items.length ? itemsHtml : '<div class="empty-state" style="padding:36px 18px"><i class="fas fa-bell-slash"></i><p>No notifications yet</p></div>'}
        </div>
      </div>
    `, 'modal-lg')

    // Auto-mark-all-read when the panel opens (Slack/Freshdesk pattern):
    // user has now "seen" them. Update both badges immediately.
    const hasUnread = items.some((n) => !n.is_read)
    if (hasUnread) {
      API.post('/notifications/read-all', {}).catch(() => {})
      _notifSetBadge(0)
    }
  } catch (e) {
    toast('Failed to load notifications: ' + e.message, 'error')
  }
}

async function onNotifClick(id, link) {
  // Optimistic UI update: clear unread look from the row right away
  const row = document.querySelector(`.notif-row[data-id="${CSS.escape(id)}"]`)
  if (row) {
    row.classList.remove('is-unread')
    row.querySelector('.notif-row-dot')?.remove()
  }
  try { await API.post(`/notifications/${id}/read`, {}) } catch {}
  // Update badges immediately
  if (_notifState.unreadCount > 0) _notifSetBadge(Math.max(0, _notifState.unreadCount - 1))
  pollNotifications()
  if (link && typeof link === 'string' && link.startsWith('ticket:')) {
    closeModal()
    const ticketId = link.slice('ticket:'.length)
    if (typeof openSupportDetail === 'function') {
      openSupportDetail(ticketId)
    } else if (window.Router?.navigate) {
      Router.navigate('support-tickets')
    }
  }
}

async function markAllNotifsRead() {
  try {
    await API.post('/notifications/read-all', {})
    // Optimistic: clear all unread visuals in the panel without closing it
    document.querySelectorAll('.notif-row.is-unread').forEach((row) => {
      row.classList.remove('is-unread')
      row.querySelector('.notif-row-dot')?.remove()
    })
    const summary = document.getElementById('notif-panel-summary')
    if (summary) summary.textContent = '0 unread · ' + (_notifState.recent?.length || 0) + ' recent'
    _notifSetBadge(0)
    toast('Marked all notifications read', 'success')
    pollNotifications()
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
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
    case 'leaves-view':      renderLeavesView(el); break
    case 'reports-view':     renderReportsView(el); break
    case 'alerts-view':      renderAlertsView(el); break
    case 'clients-list':     renderClientsList(el); break
    case 'billing-admin':    renderBillingAdmin(el); break
    case 'team-overview':    renderTeamOverview(el); break
    case 'support-tickets':  renderSupportTickets(el); break
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
