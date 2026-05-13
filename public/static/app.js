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

// Role → page allow-list. Sidebar items, page dispatcher and the router all
// consult this so a single source of truth controls who-sees-what. Pages not
// listed here are open to every authenticated user.
const PAGE_PERMISSIONS = {
  'super-dashboard': ['admin'],
  'clients-list':    ['admin'],
  'billing-admin':   ['admin'],
  'team-overview':   ['admin', 'pm'],
  'leads-view':      ['admin', 'pm', 'pc', 'sales_manager', 'sales_tl', 'sales_agent'],
  'lead-detail':     ['admin', 'pm', 'pc', 'sales_manager', 'sales_tl', 'sales_agent'],
  'lead-followups':  ['admin', 'pm', 'pc', 'sales_manager', 'sales_tl', 'sales_agent'],
  'lead-tasks':      ['admin', 'pm', 'pc', 'sales_manager', 'sales_tl', 'sales_agent'],
  'sales-tracker':   ['admin', 'pm', 'pc', 'sales_manager', 'sales_tl', 'sales_agent'],
  'sales-team':      ['admin', 'pm', 'pc', 'sales_manager', 'sales_tl'],
  'portfolio-library': ['admin', 'pm', 'pc', 'sales_manager', 'sales_tl', 'sales_agent'],
  'scope-library':     ['admin', 'pm', 'pc', 'sales_manager', 'sales_tl', 'sales_agent'],
  'quotation-library': ['admin', 'pm', 'pc', 'sales_manager', 'sales_tl', 'sales_agent'],
  'sales-incentive':   ['admin', 'pm', 'pc', 'sales_manager', 'sales_tl', 'sales_agent'],
  'meet-setup':        ['admin', 'pm', 'pc', 'sales_manager', 'sales_tl', 'sales_agent'],
  'project-team':    ['admin', 'pm', 'pc'],
  'dev-team':        ['admin', 'pm', 'pc'],
  // PM Dashboard is the operational view for PM/PC only — admins land on
  // their own Super Admin Overview, so we hide pm-dashboard from them.
  'pm-dashboard':    ['pm', 'pc'],
  'projects-list':   ['admin', 'pm', 'pc', 'developer', 'team'],
  'kanban-board':    ['admin', 'pm', 'pc', 'developer', 'team'],
  'sprints-view':    ['admin', 'pm', 'pc'],
  'milestones-view': ['admin', 'pm', 'pc'],
  'documents-center':['admin', 'pm', 'pc', 'developer'],
  'resources-view':  ['admin', 'pm'],
  'dev-dashboard':   ['developer'],
  'team-dashboard':  ['team'],
  'my-tasks':        ['admin', 'pm', 'pc', 'developer', 'team', 'sales_manager', 'sales_tl', 'sales_agent'],
  'timesheets-view': ['admin', 'pm', 'pc', 'developer'],
  'leaves-view':     ['admin', 'pm', 'pc', 'developer'], // team excluded — they don't apply for leave here
  'bidding-view':    ['admin', 'pm', 'team'],
  'support-tickets': ['admin', 'pm', 'pc', 'developer', 'team'],
  'approval-queue':  ['admin', 'pm', 'pc'],
  'reports-view':    ['admin', 'pm'],
  'alerts-view':     ['admin', 'pm'],
  'settings-view':   ['admin', 'pm', 'pc', 'developer', 'team'],
}

// Every page admin can grant cross-role access to is mapped here to one
// or more granular permission keys. A user (non-admin) needs AT LEAST
// ONE of the listed permissions to see the page — the hardcoded
// PAGE_PERMISSIONS role list is ignored for mapped pages, so admin can
// give e.g. `clients.view_all` to a sales agent and they'll see the
// Clients tab even though sales_agent isn't in PAGE_PERMISSIONS for it.
//
// Pages NOT listed here keep pure role-based gating (Leads pages,
// role-specific dashboards, etc.) because they're inherently scoped to
// a role family rather than a feature permission.
const NAV_PERMISSION_MAP = {
  // Admin areas
  'super-dashboard':   ['reports.view_admin_dashboard'],
  'clients-list':      ['clients.create', 'clients.view_all', 'clients.edit', 'clients.delete'],
  'billing-admin':     ['invoices.create', 'invoices.view_all', 'invoices.send', 'invoices.mark_paid', 'invoices.delete'],
  'team-overview':     ['users.view_all'],
  // Team directories — gate on user-list visibility
  'sales-team':        ['users.view_all'],
  'project-team':      ['users.view_all'],
  'dev-team':          ['users.view_all'],
  // PM / work
  'pm-dashboard':      ['reports.view_pm_dashboard'],
  'projects-list':     ['projects.create', 'projects.view_all', 'projects.edit', 'projects.delete'],
  'kanban-board':      ['tasks.create', 'tasks.edit_any', 'tasks.edit_own', 'tasks.move', 'tasks.comment'],
  'documents-center':  ['documents.upload', 'documents.view_all', 'documents.delete'],
  'resources-view':    ['reports.view_resources'],
  'reports-view':      ['reports.export', 'reports.view_admin_dashboard', 'reports.view_pm_dashboard', 'reports.view_resources'],
  // Operations
  'timesheets-view':   ['timesheets.log_own', 'timesheets.approve', 'timesheets.edit_any', 'timesheets.view_team', 'timesheets.view_all'],
  'leaves-view':       ['leaves.create_own', 'leaves.approve', 'leaves.view_all'],
  'approval-queue':    ['leaves.approve', 'timesheets.approve'],
  'support-tickets':   ['tickets.create', 'tickets.view_all', 'tickets.assign', 'tickets.delete', 'tickets.internal_notes'],
  'alerts-view':       ['reports.view_admin_dashboard'],
  // Sales-library + meetings (already gated)
  'portfolio-library': ['portfolios.create', 'portfolios.edit', 'portfolios.delete', 'portfolios.manage'],
  'scope-library':     ['scopes.create', 'scopes.edit', 'scopes.delete', 'scopes.manage'],
  'quotation-library': ['quotations.create', 'quotations.edit', 'quotations.delete', 'quotations.manage'],
  'meet-setup':        ['meetings.create', 'meetings.edit', 'meetings.delete'],
  'sales-incentive':   ['sales_incentive.view_all', 'sales_incentive.set_target', 'sales_incentive.override', 'sales_incentive.mark_paid'],
  // Pages intentionally NOT mapped (role-based only):
  //   leads-view / lead-detail / lead-followups / lead-tasks / sales-tracker
  //   → role-bound to sales family; no granular catalog entry yet
  //   dev-dashboard / team-dashboard / my-tasks
  //   → role-specific landing pages
  //   bidding-view, sprints-view, milestones-view, settings-view
  //   → no catalog entry yet; admin can keep role-based default
}

function hasAnyPermission(keys) {
  if (!Array.isArray(keys) || !keys.length) return true
  // Strict check: a missing permissions array means "no permissions",
  // not "show everything". Legacy sessions get the right tabs once
  // /verify completes (init() re-renders the sidebar on permsChanged).
  const perms = Array.isArray(_user?.permissions) ? _user.permissions : []
  for (const k of keys) if (perms.includes(k)) return true
  return false
}

function canSeePage(page) {
  const role = String(_user?.role || '').toLowerCase()
  // Admin bypasses every gate — they see and do everything.
  if (role === 'admin') return true
  // Permission-first: if the page is mapped to granular keys, the
  // hardcoded role list is ignored. This is what lets admin grant
  // `clients.view_all` to a sales agent and have the Clients tab
  // actually appear, even though sales_agent isn't in
  // PAGE_PERMISSIONS['clients-list'].
  const perms = NAV_PERMISSION_MAP[page]
  if (perms && perms.length) {
    return hasAnyPermission(perms)
  }
  // Unmapped pages stay role-based (lead pages, role-specific dashboards,
  // settings, etc.).
  const allowed = PAGE_PERMISSIONS[page]
  if (!allowed) return true
  return allowed.includes(role)
}

const SIDEBAR_GROUP_STORAGE_KEY = 'devportal_sidebar_groups'
const SIDEBAR_PAGE_GROUPS = {
  'super-dashboard': 'admin',
  'clients-list': 'admin',
  'billing-admin': 'admin',
  'team-overview': 'admin',
  'leads-view': 'sales',
  'lead-followups': 'sales',
  'lead-tasks': 'sales',
  'lead-detail': 'sales',
  'sales-tracker': 'sales',
  'sales-team': 'sales',
  'portfolio-library': 'sales',
  'scope-library': 'sales',
  'quotation-library': 'sales',
  'sales-incentive': 'sales',
  'meet-setup': 'sales',
  'project-team': 'pm',
  'dev-team': 'dev',
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
  'team-dashboard': 'team',
  'bidding-view': 'team',
  'reports-view': 'analytics',
  'alerts-view': 'analytics',
  'settings-view': 'settings',
}
const SIDEBAR_GROUP_DEFAULTS = {
  admin: true,
  pm: true,
  dev: true,
  team: true,
  sales: true,
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
    if (method !== 'GET' && method !== 'HEAD') scheduleActivePageReload()
    return data
  },
  get:    (u, opts = {}) => API.req('GET', buildUrl(u, opts?.params)),
  post:   (u, b) => API.req('POST', u, b),
  put:    (u, b) => API.req('PUT', u, b),
  patch:  (u, b) => API.req('PATCH', u, b),
  delete: (u) => API.req('DELETE', u),
}

// After any successful mutation we reload the visible page so listings reflect
// the change without a full browser refresh. Coalesce multiple bursts (e.g.
// import loops, parallel updates) into a single re-render via micro-debounce.
let _reloadActivePageTimer = null
function scheduleActivePageReload(delay = 120) {
  if (_reloadActivePageTimer) clearTimeout(_reloadActivePageTimer)
  _reloadActivePageTimer = setTimeout(() => {
    _reloadActivePageTimer = null
    reloadActivePage()
  }, delay)
}
function reloadActivePage() {
  // Refresh sidebar badges so approval/leave counters reflect the change.
  if (typeof loadBadges === 'function') { try { loadBadges() } catch {} }
  // Active page wins; otherwise fall back to the router's current route.
  const active = document.querySelector('.page.active')
  if (active && active.id?.startsWith('page-')) {
    const page = active.id.replace(/^page-/, '')
    active.dataset.loaded = ''
    if (typeof loadPage === 'function') loadPage(page, active)
    return
  }
  if (Router?.current?.page) {
    const el = document.getElementById('page-' + Router.current.page)
    if (el && typeof loadPage === 'function') {
      el.dataset.loaded = ''
      loadPage(Router.current.page, el)
    }
  }
}
window.reloadActivePage = reloadActivePage
window.scheduleActivePageReload = scheduleActivePageReload

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

// Re-fetch the current user from the server so role/designation changes the
// admin makes elsewhere take effect on the next page load — without forcing
// the affected user to log out. Best-effort: a network failure or 401 just
// keeps the cached _user, with 401 also clearing it (the token is dead).
async function refreshAuthFromServer() {
  if (!_token) return
  try {
    const r = await fetch(BASE + '/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: _token }),
    })
    if (r.status === 401) {
      clearAuth()
      return
    }
    const data = await r.json().catch(() => ({}))
    if (data?.valid && data?.user) {
      _user = { ..._user, ...data.user, role: String(data.user.role || '').toLowerCase() }
      localStorage.setItem('devportal_user', JSON.stringify(_user))
      // Catch the case where a session is already open when admin resets the
      // password — verify will return must_change_password=1 even though we
      // didn't just log in.
      if (Number(data.user.must_change_password) === 1 && !window._forcePwdShown) {
        window._forcePwdShown = true
        if (typeof showForcePasswordChangeModal === 'function') {
          setTimeout(() => showForcePasswordChangeModal(), 250)
        }
      }
    }
  } catch {
    // offline or transient — keep the cached user
  }
}

// ── Routing ──────────────────────────────────────────────────
const Router = {
  current: null,
  history: [],
  _persist() {
    try {
      if (this.current) sessionStorage.setItem('pmp_current_page', JSON.stringify(this.current))
      else sessionStorage.removeItem('pmp_current_page')
      if (this.current?.page) {
        const targetHash = '#/' + this.current.page
        if (location.hash !== targetHash) {
          history.replaceState(null, '', targetHash)
        }
      }
    } catch {}
  },
  navigate(page, params={}) {
    // Permission gate: if the user lacks access, silently bounce to their
    // default landing page so deep-links / stale URLs can't reach forbidden
    // pages. This mirrors what canSeePage hides in the sidebar.
    if (_user && !canSeePage(page)) {
      const fallback = defaultPage()
      if (fallback && fallback !== page) {
        if (typeof toast === 'function') toast('You don’t have access to that page', 'info')
        page = fallback
      } else {
        return
      }
    }
    // Push current page to history before navigating
    if (this.current) {
      this.history.push(this.current)
    }
    this.current = { page, params }
    this._persist()
    renderApp()
    if (window.innerWidth <= 768) closeSidebar()
    updateBackButton()
  },
  back() {
    if (this.history.length === 0) return
    this.current = this.history.pop()
    this._persist()
    renderApp()
    if (window.innerWidth <= 768) closeSidebar()
    updateBackButton()
  }
}

window.addEventListener('hashchange', () => {
  const m = (location.hash || '').match(/^#\/([\w-]+)/)
  if (!m) return
  const next = m[1]
  if (Router.current?.page === next) return
  if (_user) Router.navigate(next)
})

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

  // Rebuild the shell when no sidebar exists OR the cached shell was built
  // for a different user. The "different user" case happens on account
  // switch (admin → developer) — without this check, the stale admin
  // sidebar persisted because the #sidebar element from the old session
  // was still in the DOM and the early-return skipped the rebuild.
  const currentUserKey = String(_user.sub || _user.id || _user.email || '')
  const builtForKey = app?.dataset.shellUser || ''
  if (!document.getElementById('sidebar') || builtForKey !== currentUserKey) {
    app.innerHTML = buildShell()
    bindNav()
    if (app) app.dataset.shellUser = currentUserKey
  }
  const pg = Router.current?.page || defaultPage()
  ensureSidebarGroupOpen(pg)
  applySidebarGroupState()
  showPage(pg)
  updateNav(pg)
  updateTopbar(pg)
  updateBackButton()
  renderImpersonationBanner()
}

// When the active session is an impersonation (token issued via
// /auth/impersonate), pin a slim banner to the top of the viewport so
// the user remembers whose perspective they're in — and give them a
// one-click way back to their real account.
function renderImpersonationBanner() {
  const existing = document.getElementById('impersonation-banner')
  const impBy = _user?.impersonated_by
  if (!impBy || !impBy.id) {
    if (existing) existing.remove()
    document.body.style.removeProperty('padding-top')
    return
  }
  const banner = existing || (() => {
    const el = document.createElement('div')
    el.id = 'impersonation-banner'
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:linear-gradient(90deg,#7c3aed,#3b82f6);color:#fff;padding:8px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;font:600 13px/1.4 Arial,Helvetica,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.25)'
    document.body.appendChild(el)
    return el
  })()
  const safeName = (_user?.full_name || _user?.name || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const safeBy = String(impBy.name || 'admin').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  banner.innerHTML = `
    <div><i class="fas fa-user-secret" style="margin-right:6px"></i> You are logged in as <strong>${safeName}</strong> (impersonated by ${safeBy})</div>
    <button onclick="endImpersonation()" style="background:rgba(255,255,255,.18);color:#fff;border:1px solid rgba(255,255,255,.35);border-radius:6px;padding:5px 12px;font-weight:600;cursor:pointer"><i class="fas fa-undo"></i> Return to admin</button>
  `
  // Push the rest of the app down so the banner doesn't cover the topbar.
  document.body.style.paddingTop = `${banner.offsetHeight}px`
}

function defaultPage() {
  const map = {
    admin: 'super-dashboard',
    pm: 'pm-dashboard',
    pc: 'pm-dashboard',
    developer: 'dev-dashboard',
    team: 'team-dashboard',
    sales_manager: 'leads-view',
    sales_tl: 'leads-view',
    sales_agent: 'leads-view',
  }
  return map[_user?.role] || 'pm-dashboard'
}

// ── Shell HTML ────────────────────────────────────────────────
// Build a single nav <a> only if the current user has permission to see the
// page. Sections that end up empty are dropped entirely so we don't render
// hollow group headers.
function navItem(page, iconClass, label, badgeHtml = '') {
  if (!canSeePage(page)) return ''
  return `<a class="nav-item" data-page="${page}"><span class="nav-icon"><i class="fas ${iconClass}"></i></span>${label}${badgeHtml}</a>`
}
function navSection({ key, heading, chip, expanded, items, icon }) {
  const body = items.filter(Boolean).join('')
  if (!body) return ''
  return `
    <div class="nav-section nav-group nav-group-${key}" data-nav-group="${key}">
      <button class="nav-section-toggle" type="button" data-nav-toggle="${key}" aria-expanded="${expanded ? 'true' : 'false'}">
        <span class="nav-section-heading"><i class="fas ${icon}"></i> ${heading}</span>
        <span class="nav-section-chip">${chip}</span>
        <i class="fas fa-chevron-down nav-section-caret"></i>
      </button>
      <div class="nav-section-body">${body}</div>
    </div>`
}

function buildShell() {
  const role = String(_user.role || '').toLowerCase()

  // Admin/Core section — gating is now per-item via canSeePage (which is
  // permission-first). If admin grants e.g. `clients.view_all` to a
  // sales agent, the Clients item appears here and the section becomes
  // visible. Empty sections auto-collapse (navSection drops blanks).
  const navAdmin = navSection({
    key: 'admin', heading: 'Admin', chip: 'Core', expanded: true, icon: 'fa-sparkles',
    items: [
      navItem('super-dashboard', 'fa-chart-pie', 'Overview'),
      navItem('clients-list',    'fa-building',   'Clients'),
      navItem('billing-admin',   'fa-file-invoice-dollar', 'Billing'),
      navItem('team-overview',   'fa-users',      'Team'),
    ],
  })

  // Sales CRM group — same shape as Project Management. Visible to anyone
  // with lead access; sales-only roles get a more specific heading.
  const salesHeading = role === 'sales_manager' ? 'Sales (Manager)'
    : role === 'sales_tl' ? 'Sales (TL)'
    : role === 'sales_agent' ? 'Sales'
    : 'Sales CRM'
  const leadsLabel = role === 'sales_agent' ? 'My Leads'
    : (role === 'sales_manager' || role === 'sales_tl') ? 'Team Leads'
    : 'Leads'
  const navSales = navSection({
    key: 'sales', heading: salesHeading, chip: 'CRM', expanded: true, icon: 'fa-bullseye',
    items: [
      navItem('leads-view',      'fa-bullseye',       leadsLabel),
      navItem('lead-followups',  'fa-calendar-check', 'Follow-ups'),
      navItem('lead-tasks',      'fa-list-check',     'Tasks'),
      navItem('sales-tracker',   'fa-chart-line',     'Sale Tracker'),
      navItem('sales-team',      'fa-people-group',   'Sales Team'),
      navItem('portfolio-library','fa-briefcase',     'Portfolio'),
      navItem('scope-library',    'fa-file-lines',    'Scope of Work'),
      navItem('quotation-library','fa-file-invoice-dollar', 'Quotation'),
      navItem('meet-setup',      'fa-video',       'Meet Setup'),
      navItem('sales-incentive', 'fa-money-bill-trend-up', 'Sale Incentive'),
    ],
  })

  // Project Management section — items gated per-permission. Team-role
  // sees a dedicated "My Workspace" section below, so we still hide this
  // from team to avoid duplicate Projects/Kanban links.
  const navPm = role !== 'team' ? navSection({
    key: 'pm', heading: 'Project Management', chip: 'Work', expanded: true, icon: 'fa-layer-group',
    items: [
      navItem('pm-dashboard',    'fa-gauge-high', 'PM Dashboard'),
      navItem('projects-list',   'fa-layer-group', 'Projects'),
      navItem('bidding-view',    'fa-gavel',       'Bidding', ' <span class="nav-badge" id="nb-bids" style="display:none">0</span>'),
      navItem('kanban-board',    'fa-columns',     'Kanban Board'),
      navItem('sprints-view',    'fa-bolt',        'Sprints'),
      navItem('milestones-view', 'fa-flag',        'Milestones'),
      navItem('documents-center','fa-folder-open', 'Documents'),
      navItem('resources-view',  'fa-users-gear',  'Resources'),
      navItem('project-team',    'fa-people-group','Project Team'),
    ],
  }) : ''

  // Header label adapts to role so a sales agent doesn't see "Developer
  // View" sitting above their Tasks / Timesheets / Leaves.
  const devHeading = role === 'developer' ? 'My Work' : 'My Workspace'
  const devChip    = role === 'developer' ? 'Me' : 'Work'
  // Hard-gate the entire dev section away from team accounts. Team gets its
  // own "My Workspace" section below; without this gate Tasks/Support items
  // (which are shared) keep this section non-empty and timesheet/leave links
  // render even though the items themselves are role-gated.
  const navDev = role !== 'team' ? navSection({
    key: 'dev', heading: devHeading, chip: devChip, expanded: true, icon: 'fa-code',
    items: [
      navItem('dev-dashboard',  'fa-gauge',       'My Dashboard'),
      navItem('my-tasks',       'fa-list-check',  'Tasks'),
      navItem('timesheets-view','fa-clock',       'Timesheets'),
      navItem('leaves-view',    'fa-umbrella-beach', 'Leaves', ' <span class="nav-badge" id="nb-leaves">0</span>'),
      navItem('support-tickets','fa-life-ring',   'Support Tickets'),
      navItem('approval-queue', 'fa-clipboard-check', 'Approvals', ' <span class="nav-badge" id="nb-approval">0</span>'),
      navItem('dev-team',       'fa-people-group','Dev Team'),
    ],
  }) : ''

  // Dedicated section ONLY for external team accounts. Without the role gate
  // shared pages (Projects/Kanban/Tasks) leak this section into other roles'
  // sidebars, causing duplicate "My Projects" entries.
  const navTeam = role === 'team' ? navSection({
    key: 'team', heading: 'My Workspace', chip: 'Team', expanded: true, icon: 'fa-users',
    items: [
      navItem('team-dashboard', 'fa-gauge',       'Dashboard'),
      navItem('projects-list',  'fa-layer-group', 'My Projects'),
      navItem('kanban-board',   'fa-columns',     'Kanban Board'),
      navItem('my-tasks',       'fa-list-check',  'My Tasks'),
      navItem('bidding-view',   'fa-gavel',       'Bidding', ' <span class="nav-badge" id="nb-bids" style="display:none">0</span>'),
      navItem('support-tickets','fa-life-ring',   'Support Tickets'),
      navItem('dev-team',       'fa-people-group','Dev Team'),
    ],
  }) : ''

  const navReports = navSection({
    key: 'analytics', heading: 'Analytics', chip: 'Insight', expanded: false, icon: 'fa-wand-magic-sparkles',
    items: [
      navItem('reports-view', 'fa-chart-bar', 'Reports'),
      navItem('alerts-view',  'fa-bell',      'Alerts', ' <span class="nav-badge" id="nb-alerts">0</span>'),
    ],
  })

  return `
  <div id="sidebar">
    <div class="logo">
      <div class="sidebar-logo-mark"><img src="/static/images/mariox-logo.jpg" alt="Mariox" onerror="this.outerHTML='<i class=\\'fas fa-rocket\\'></i>'"/></div>
      <div class="sidebar-logo-text">
        <span>Mariox Software</span>
      </div>
    </div>
    ${navAdmin}${navPm}${navDev}${navTeam}${navSales}${navReports}
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
    <div id="page-bidding-view"     class="page"></div>
    <div id="page-team-dashboard"   class="page"></div>
    <div id="page-reports-view"     class="page"></div>
    <div id="page-alerts-view"      class="page"></div>
    <div id="page-clients-list"     class="page"></div>
    <div id="page-billing-admin"    class="page"></div>
    <div id="page-team-overview"    class="page"></div>
    <div id="page-leads-view"       class="page"></div>
    <div id="page-lead-detail"      class="page"></div>
    <div id="page-lead-followups"   class="page"></div>
    <div id="page-lead-tasks"       class="page"></div>
    <div id="page-sales-tracker"    class="page"></div>
    <div id="page-sales-team"       class="page"></div>
    <div id="page-project-team"     class="page"></div>
    <div id="page-dev-team"         class="page"></div>
    <div id="page-portfolio-library" class="page"></div>
    <div id="page-scope-library"    class="page"></div>
    <div id="page-quotation-library" class="page"></div>
    <div id="page-sales-incentive"  class="page"></div>
    <div id="page-meet-setup"       class="page"></div>
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
  'super-dashboard':'Overview','pm-dashboard':'PM Dashboard','dev-dashboard':'My Dashboard','team-dashboard':'Team Dashboard',
  'projects-list':'Projects','kanban-board':'Kanban Board','sprints-view':'Sprints',
  'milestones-view':'Milestones','documents-center':'Documents','resources-view':'Resources',
  'my-tasks':'My Tasks','timesheets-view':'Timesheets','approval-queue':'Approvals','leaves-view':'Leaves','bidding-view':'Bidding',
  'reports-view':'Reports & Analytics','alerts-view':'Alerts','clients-list':'Clients',
  'billing-admin':'Billing & Invoices','team-overview':'Team','leads-view':'Leads','lead-detail':'Lead Details','lead-followups':'Lead Follow-ups','lead-tasks':'Lead Tasks','sales-tracker':'Sale Tracker','sales-team':'Sales Team','project-team':'Project Team','dev-team':'Dev Team','portfolio-library':'Portfolio','scope-library':'Scope of Work','quotation-library':'Quotation','sales-incentive':'Sale Incentive','meet-setup':'Meet Setup','support-tickets':'Support Tickets','settings-view':'Settings'
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

function _setNavBadge(id, count) {
  const nb = document.getElementById(id)
  if (!nb) return
  const n = Number(count) || 0
  nb.textContent = n ? String(n) : ''
  nb.style.display = n ? '' : 'none'
}

async function loadBadges() {
  try {
    const [alertsData, notifData] = await Promise.all([
      API.get('/alerts').catch(() => ({ alerts: [] })),
      API.get('/notifications/unread-count').catch(() => ({ unread_count: 0 })),
    ])
    const alertUnread = (alertsData.alerts||[]).filter(a=>!a.is_read&&!a.is_dismissed).length
    const notifUnread = notifData.unread_count || 0
    _setNavBadge('nb-alerts', alertUnread + notifUnread)
  } catch {}
  // Approvals (pending timesheets) — only relevant for admin/pm/pc
  if (['admin','pm','pc'].includes(_user?.role)) {
    try {
      const data = await API.get('/timesheets?approval_status=pending')
      _setNavBadge('nb-approval', (data.timesheets||data||[]).length)
    } catch { _setNavBadge('nb-approval', 0) }
    // Pending leaves count
    try {
      const data = await API.get('/leaves')
      const list = data.leaves || data.data || []
      _setNavBadge('nb-leaves', list.filter(l => String(l.status||'').toLowerCase() === 'pending').length)
    } catch { _setNavBadge('nb-leaves', 0) }
  } else {
    _setNavBadge('nb-approval', 0)
    _setNavBadge('nb-leaves', 0)
  }
  // Notifications badge + initial sync
  pollNotifications(true)
}
window.loadBadges = loadBadges

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

// Per-category sound files. Drop them at the paths below (mp3/wav/ogg ok —
// keep the same filenames or update the URLs here). Missing files fall back
// to the synthesized two-note chime automatically.
const NOTIF_SOUND_FILES = {
  ticket: '/static/sounds/ticket.wav',  // support tickets — created/assigned/comment/status/priority
  task:   '/static/sounds/task.wav',    // tasks & kanban events
  other:  '/static/sounds/other.wav',   // everything else (leaves, alerts, generic)
}
const _notifAudioEls = {}      // { ticket: <Audio>, task: <Audio>, other: <Audio> }
const _notifAudioFailed = {}   // { category: true }  — set when file fails to load

function _notifSoundCategory(type) {
  const t = String(type || '').toLowerCase()
  if (!t) return 'other'
  if (t.startsWith('ticket_'))                       return 'ticket'
  if (t.startsWith('task_') || t.startsWith('kanban_')) return 'task'
  return 'other'
}

function _notifPlayDing(type) {
  const cat = _notifSoundCategory(type)
  if (!_notifAudioFailed[cat] && _tryPlayCategorySound(cat)) return
  _notifPlaySynthChime()
}

function _tryPlayCategorySound(cat) {
  try {
    const url = NOTIF_SOUND_FILES[cat] || NOTIF_SOUND_FILES.other
    if (!_notifAudioEls[cat]) {
      const el = new Audio(url)
      el.preload = 'auto'
      el.volume = 0.7
      el.addEventListener('error', () => {
        _notifAudioFailed[cat] = true
        delete _notifAudioEls[cat]
      })
      _notifAudioEls[cat] = el
    }
    const el = _notifAudioEls[cat]
    el.currentTime = 0
    const p = el.play()
    if (p && typeof p.catch === 'function') {
      p.catch(() => { /* autoplay blocked or file missing — synth fallback handles it */ })
    }
    return true
  } catch {
    _notifAudioFailed[cat] = true
    return false
  }
}

function _notifPlaySynthChime() {
  // Light "ding" via Web Audio API — used if the audio file is missing.
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
        // Pick the highest-priority category among fresh items so the
        // ticket sound wins over a less specific sound when both arrive together.
        const priority = ['ticket', 'task', 'other']
        const cats = fresh.map((n) => _notifSoundCategory(n.type))
        const pickedCat = priority.find((p) => cats.includes(p)) || 'other'
        const pickedItem = fresh.find((n) => _notifSoundCategory(n.type) === pickedCat) || fresh[0]
        _notifPlayDing(pickedItem?.type)
        // Show up to 2 toasts so we don't spam
        fresh.slice(0, 2).forEach(_notifShowToast)
        // Auto-refresh whichever data view the user is currently looking at —
        // saves them a manual reload to see the latest leaves / bids.
        _notifAutoRefreshActiveView(fresh)
      }
      _notifState.lastSeenId = latestId
      _notifState.lastSeenAt = res.latest_created_at || _notifState.lastSeenAt
    }
    _notifSetBadge(count)
  } catch {
    // ignore — likely offline / unauthenticated
  }
}

// When a fresh notification of a known type arrives, silently re-render the page
// the user is on so the new leave / bid shows up without a manual refresh. We
// only refresh the *currently visible* page to avoid wasted API hits.
function _notifAutoRefreshActiveView(freshItems) {
  if (!Array.isArray(freshItems) || freshItems.length === 0) return
  const types = new Set(freshItems.map((n) => String(n.type || '').toLowerCase()))
  // Map notification type → page id whose data should be reloaded.
  const refreshMap = [
    { match: (t) => t.startsWith('leave_'), page: 'leaves-view' },
    { match: (t) => t.startsWith('bid_'),   page: 'bidding-view' },
    { match: (t) => t.startsWith('bid_'),   page: 'team-dashboard' },
    { match: (t) => t.startsWith('ticket_'), page: 'support-tickets' },
  ]
  const pagesToRefresh = new Set()
  for (const { match, page } of refreshMap) {
    for (const t of types) if (match(t)) { pagesToRefresh.add(page); break }
  }
  pagesToRefresh.forEach((page) => {
    const el = document.getElementById('page-' + page)
    if (el && el.classList.contains('active')) {
      el.dataset.loaded = ''
      try { loadPage(page, el) } catch {}
    }
  })
  // If a bid event arrived and an auction-detail modal is open, re-render it
  // in place so the bid list / winner panel updates without manual reload.
  const hasBid = [...types].some((t) => t.startsWith('bid_'))
  if (hasBid) {
    const open = document.querySelector('[data-auction-modal]')
    const id = open?.getAttribute('data-auction-modal')
    if (id && typeof openAuctionDetailModal === 'function') {
      try { openAuctionDetailModal(id) } catch {}
    }
  }
  // Sidebar badges (leave count etc.) should also reflect the fresh state.
  if (typeof loadBadges === 'function') loadBadges()
}

function startNotificationPoller() {
  if (_notifState.timer) return
  // Notifications keep arriving until the user manually logs out — so we
  // poll regardless of tab visibility instead of pausing on hidden tabs.
  // 10s feels real-time without hammering the API.
  _notifState.timer = setInterval(() => { pollNotifications() }, 10000)
  // Refresh immediately when the tab becomes visible again, so the badge
  // catches up without waiting for the next interval tick.
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
  if (typeof stopFollowupAlarmPoller === 'function') stopFollowupAlarmPoller()
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
        <div style="margin-top:14px;text-align:center">
          <a href="javascript:void(0)" onclick="openForgotPasswordModal()" style="font-size:12.5px;color:#FFB347;text-decoration:none">Forgot password?</a>
        </div>
      </div>
    </div>
  </div>`
}

function openForgotPasswordModal() {
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-key" style="color:var(--accent);margin-right:6px"></i>Forgot Password</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:12px">
      <div style="font-size:12.5px;color:var(--text-muted);line-height:1.5">
        Enter the email tied to your account. If it exists, our admins will be notified and one of them will reset your password for you.
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">Email</label>
        <input id="fp-email" type="email" class="form-input" placeholder="you@mariox.in"/>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitForgotPassword()"><i class="fas fa-paper-plane"></i> Send request</button>
    </div>
  `, 'modal-md')
}

async function submitForgotPassword() {
  const email = (document.getElementById('fp-email')?.value || '').trim()
  if (!email) { toast('Enter your email', 'error'); return }
  try {
    const res = await fetch(BASE + '/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Request failed')
    toast(data.message || 'Reset request sent', 'success')
    closeModal()
  } catch (e) { toast(e.message || 'Failed', 'error') }
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
      // Server flag: this account is on a system-issued password (just
      // created, or admin-reset). Force a change before they keep working.
      if (Number(data.user.must_change_password) === 1) {
        setTimeout(() => showForcePasswordChangeModal(password), 250)
      }
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

function showForcePasswordChangeModal(currentPasswordHint) {
  showModal(`
    <div class="modal-header">
      <h3 style="display:flex;align-items:center;gap:8px"><i class="fas fa-key" style="color:#FFCB47"></i> Set a new password</h3>
    </div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:12px">
      <div style="padding:10px 12px;border-radius:10px;background:rgba(255,203,71,.10);border:1px solid rgba(255,203,71,.35);font-size:12.5px;color:#FFD9A0;line-height:1.5">
        <i class="fas fa-circle-info"></i> This is your first login (or your admin reset your password). Please choose a new password before you continue.
      </div>
      <div class="form-group">
        <label class="form-label">Current (temporary) password</label>
        <input id="fpc-current" class="form-input" type="password" autocomplete="current-password" value="${currentPasswordHint ? String(currentPasswordHint).replace(/"/g, '&quot;') : ''}" placeholder="Password you just signed in with"/>
      </div>
      <div class="form-group">
        <label class="form-label">New password</label>
        <input id="fpc-new" class="form-input" type="password" autocomplete="new-password" placeholder="Minimum 8 characters"/>
      </div>
      <div class="form-group">
        <label class="form-label">Confirm new password</label>
        <input id="fpc-confirm" class="form-input" type="password" autocomplete="new-password" placeholder="Repeat new password"/>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary" style="width:100%" onclick="submitForcePasswordChange()"><i class="fas fa-lock"></i> Update password</button>
    </div>`, 'modal-md')
}

async function submitForcePasswordChange() {
  const cur = document.getElementById('fpc-current')?.value
  const next = document.getElementById('fpc-new')?.value
  const conf = document.getElementById('fpc-confirm')?.value
  if (!cur) return toast('Enter your current password', 'error')
  if (!next || next.length < 8) return toast('New password must be at least 8 characters', 'error')
  if (next !== conf) return toast('New passwords do not match', 'error')
  if (cur === next) return toast('New password must differ from current', 'error')
  try {
    await API.post('/auth/change-password', { current_password: cur, new_password: next })
    toast('Password updated. Please continue.', 'success')
    closeModal()
    if (_user) {
      _user.must_change_password = 0
      localStorage.setItem('devportal_user', JSON.stringify(_user))
    }
    window._forcePwdShown = false
  } catch (e) { toast(e.message, 'error') }
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
// Guard against rapid double-clicks on slow API-backed edit openers.
// Same key + already-running → second call drops silently. Each opener
// passes a stable key (e.g. 'edit-client:abc123') so the same record is
// debounced but unrelated openers can run concurrently.
const _modalOpenerGuard = new Set()
async function guardedModalOpen(key, fn) {
  if (_modalOpenerGuard.has(key)) return
  _modalOpenerGuard.add(key)
  try { await fn() } finally { _modalOpenerGuard.delete(key) }
}
function closeModal() {
  if (typeof _revokeDocPreviewBlob === 'function') _revokeDocPreviewBlob()
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
      <div style="margin-top:20px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="btn btn-outline" onclick="openChangePasswordModal()"><i class="fas fa-key"></i> Change Password</button>
        <button class="btn btn-danger" onclick="logout();closeModal()"><i class="fas fa-sign-out-alt"></i> Logout</button>
      </div>
    </div>`)
}

function openChangePasswordModal() {
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-key" style="color:var(--accent);margin-right:6px"></i>Change Password</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:12px">
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">Current Password *</label>
        <div style="position:relative">
          <input id="cp-current" type="password" class="form-input" autocomplete="current-password" placeholder="••••••••"/>
          <button type="button" onclick="togglePass('cp-current',this)" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;color:#64748b;cursor:pointer"><i class="fas fa-eye"></i></button>
        </div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">New Password *</label>
        <div style="position:relative">
          <input id="cp-new" type="password" class="form-input" autocomplete="new-password" placeholder="At least 8 characters"/>
          <button type="button" onclick="togglePass('cp-new',this)" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;color:#64748b;cursor:pointer"><i class="fas fa-eye"></i></button>
        </div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">Confirm New Password *</label>
        <input id="cp-confirm" type="password" class="form-input" autocomplete="new-password" placeholder="Re-type the new password"/>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitChangePassword()"><i class="fas fa-check"></i> Update Password</button>
    </div>
  `, 'modal-md')
}

async function submitChangePassword() {
  const cur = document.getElementById('cp-current')?.value || ''
  const next = document.getElementById('cp-new')?.value || ''
  const confirm = document.getElementById('cp-confirm')?.value || ''
  if (!cur || !next || !confirm) { toast('All fields are required', 'error'); return }
  if (next !== confirm) { toast('New passwords do not match', 'error'); return }
  if (cur === next) { toast('New password must differ from current', 'error'); return }
  try {
    await API.post('/auth/change-password', { current_password: cur, new_password: next })
    toast('Password updated', 'success')
    closeModal()
  } catch (e) { toast(e.message || 'Failed', 'error') }
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
    bid_opened:            { icon: 'fa-gavel', color: '#FFB347' },
    bid_placed:            { icon: 'fa-coins', color: '#FFCB47' },
    bid_awarded:           { icon: 'fa-trophy', color: '#86E0A8' },
    leave_request:           { icon: 'fa-umbrella-beach', color: '#FFB67A' },
    leave_approved:          { icon: 'fa-check-circle', color: '#86E0A8' },
    leave_rejected:          { icon: 'fa-times-circle', color: '#FF8866' },
    password_reset_request:  { icon: 'fa-key', color: '#FFCB47' },
    password_reset_done:     { icon: 'fa-key', color: '#86E0A8' },
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
          ${items.some((n) => !n.is_read) ? '<button id="notif-mark-all-btn" class="btn btn-xs btn-outline" onclick="markAllNotifsRead()"><i class="fas fa-check-double"></i> Mark all read</button>' : ''}
        </div>
        <div class="notif-list">
          ${items.length ? itemsHtml : '<div class="empty-state" style="padding:36px 18px"><i class="fas fa-bell-slash"></i><p>No notifications yet</p></div>'}
        </div>
      </div>
    `, 'modal-lg')

    // Auto-mark-all-read when the panel opens (Slack/Freshdesk pattern):
    // user has now "seen" them. Update both badges immediately and
    // strip the unread visuals from the rows so the panel matches state.
    const hasUnread = items.some((n) => !n.is_read)
    if (hasUnread) {
      API.post('/notifications/read-all', {}).catch(() => {})
      _notifSetBadge(0)
      document.querySelectorAll('.notif-row.is-unread').forEach((row) => {
        row.classList.remove('is-unread')
        row.querySelector('.notif-row-dot')?.remove()
      })
      const summary = document.getElementById('notif-panel-summary')
      if (summary) summary.textContent = '0 unread · ' + items.length + ' recent'
      document.getElementById('notif-mark-all-btn')?.remove()
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
    if (summary) {
      const recentCount = document.querySelectorAll('.notif-row').length
      summary.textContent = '0 unread · ' + recentCount + ' recent'
    }
    document.getElementById('notif-mark-all-btn')?.remove()
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
    case 'bidding-view':     renderBiddingView(el); break
    case 'team-dashboard':   renderTeamDashboard(el); break
    case 'reports-view':     renderReportsView(el); break
    case 'alerts-view':      renderAlertsView(el); break
    case 'clients-list':     renderClientsList(el); break
    case 'billing-admin':    renderBillingAdmin(el); break
    case 'team-overview':    renderTeamOverview(el); break
    case 'leads-view':       renderLeadsView(el); break
    case 'lead-detail':      renderLeadDetailPage(el, Router.current?.params?.id); break
    case 'lead-followups':   renderLeadFollowupsPage(el); break
    case 'lead-tasks':       renderLeadTasksPage(el); break
    case 'sales-tracker':    renderSalesTrackerPage(el); break
    case 'sales-team':        renderSalesTeamPage(el); break
    case 'project-team':      renderProjectTeamPage(el); break
    case 'dev-team':          renderDevTeamPage(el); break
    case 'portfolio-library': renderPortfolioLibrary(el); break
    case 'scope-library':     renderScopeLibrary(el); break
    case 'quotation-library': renderQuotationLibrary(el); break
    case 'sales-incentive':   renderSalesIncentivePage(el); break
    case 'meet-setup':        renderMeetSetup(el); break
    case 'support-tickets':  renderSupportTickets(el); break
    case 'settings-view':    renderSettingsView(el); break
    default: el.innerHTML = `<div class="page-header"><h1 class="page-title">${breadcrumbMap[page]||page}</h1></div><div class="empty-state"><i class="fas fa-hammer"></i><p>Module coming soon…</p></div>`
  }
}

// ── Init ──────────────────────────────────────────────────────
function resolveInitialRoute() {
  let page = null
  let params = {}
  // 1) Hash route wins (e.g. #/clients-list) — survives browser refresh
  const hashMatch = (location.hash || '').match(/^#\/([\w-]+)/)
  if (hashMatch) page = hashMatch[1]
  // 2) sessionStorage fallback — also survives refresh and restores params
  // for parameterized routes like lead-detail.
  try {
    const cached = JSON.parse(sessionStorage.getItem('pmp_current_page') || 'null')
    if (cached?.page) {
      if (!page) page = cached.page
      if (page === cached.page && cached.params) params = cached.params
    }
  } catch {}
  // 3) Legacy path-based aliases
  if (!page) {
    const path = (location.pathname || '/').replace(/\/+$/, '').toLowerCase()
    const legacyMap = {
      '/devportaloverview': 'super-dashboard',
      '/devportaldashboard': 'super-dashboard',
      '/overview': 'super-dashboard',
      '/dashboard': 'super-dashboard',
      '/pm-dashboard': 'pm-dashboard',
      '/dev-dashboard': 'dev-dashboard',
    }
    page = legacyMap[path] || null
  }
  return { page, params }
}
function resolveInitialPage() {
  return resolveInitialRoute().page
}

function init() {
  // If URL is /accept-invite, defer to project-extensions.js
  if (location.pathname === '/accept-invite') return

  if (loadAuth()) {
    if (_user.role === 'client') {
      if (typeof renderClientPortal === 'function') renderClientPortal()
    } else {
      // Render the cached version first (no UI flash), then re-sync against
      // the server in the background.
      const initialRoute = resolveInitialRoute()
      const initialPage = initialRoute.page || defaultPage()
      const cachedRole = _user.role
      // Capture the cached permissions snapshot so we can tell if /verify
      // brought back a different set — admin tweaking a role's perms in
      // Settings should also bounce the sidebar without a re-login.
      const cachedPermsKey = Array.isArray(_user.permissions)
        ? _user.permissions.slice().sort().join('|')
        : '__missing__'
      Router.navigate(initialPage, initialRoute.params || {})
      refreshAuthFromServer().then(() => {
        if (!_user) { renderLogin(); return }
        const freshPermsKey = Array.isArray(_user.permissions)
          ? _user.permissions.slice().sort().join('|')
          : '__missing__'
        const roleChanged = _user.role !== cachedRole
        const permsChanged = freshPermsKey !== cachedPermsKey
        // Role/designation may have changed in the DB. renderApp() skips the
        // shell rebuild if a sidebar already exists, so we wipe + re-mount
        // when the role flipped OR permissions changed — that rebuilds the
        // sidebar with fresh permissions and bounces away from any
        // now-forbidden page.
        if (roleChanged || permsChanged) {
          const app = document.getElementById('app')
          if (app) app.innerHTML = ''
          Router.current = null
          Router.history = []
          const next = canSeePage(initialPage) ? initialPage : defaultPage()
          Router.navigate(next)
          if (roleChanged && typeof toast === 'function') toast(`Your role changed to ${_user.role}`, 'info')
        } else if (Router.current && !canSeePage(Router.current.page)) {
          Router.current = null
          Router.navigate(defaultPage())
        }
      })
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
