// ═══════════════════════════════════════════════════════════
// Mariox DevPortal – Core App (auth + layout + API + routing)
// ═══════════════════════════════════════════════════════════

// Compatibility shim for legacy router.register() / router.navigate() calls
// in pages.js + pages2.js. Those files were written against an old standalone
// router and use short page names ('timesheet', 'projects', 'leaves', etc.)
// that don't match the current page dispatcher. We forward to the real Router
// after translating the name. `register` is a no-op — page render functions
// are now wired through the main loadPage() switch, not through this shim.
const _LEGACY_PAGE_ALIAS = {
  'timesheet':         'timesheets-view',
  'timesheets':        'timesheets-view',
  'developers':        'team-overview',
  'developer-detail':  'team-overview',
  'project-detail':    'kanban-board',
  'projects':          'projects-list',
  'approvals':         'approval-queue',
  'alerts':            'alerts-view',
  'settings':          'settings-view',
  'leaves':            'leaves-view',
  'tasks':             'my-tasks',
  'reports':           'reports-view',
}
const router = {
  register: () => {},
  navigate: (page, params) => {
    const target = _LEGACY_PAGE_ALIAS[page] || page
    if (typeof Router !== 'undefined' && Router?.navigate) Router.navigate(target, params || {})
  },
  routes: {},
}
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
    const colors = { green:'#58C68A', yellow:'#C9A7FF', red:'#FF5E3A', blue:'#A970FF' }
    const bg = colors[color] || color
    const w = Math.max(0, Math.min(100, Number(pct||0)))
    return `<div class="progress-bar"><div class="progress-fill" style="width:${w}%;background:${bg}"></div></div>`
  },
  confirm: async (msg) => Promise.resolve(window.confirm(msg)),
}

const BASE = '/api'
let _token = null, _user = null

// Project-name display helper — normalises whatever the user typed (UPPER,
// lower, mixedCase, snake_case…) into "Title Case With Words Capitalised".
// Acronyms shorter than 3 chars are left as-is so "API"/"SDK"/"CRM" survive.
// Used everywhere a raw project name is shown to humans.
function toTitleCase(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return raw
  return raw
    .split(/(\s+)/) // keep original spacing
    .map(token => {
      if (!token || /^\s+$/.test(token)) return token
      // Preserve all-caps short acronyms (API, SDK, CRM, …).
      if (token.length <= 4 && token === token.toUpperCase() && /^[A-Z0-9]+$/.test(token)) return token
      // Title-case dashed/underscored chunks too: "my_cool-app" → "My Cool App".
      return token
        .split(/([_-]+)/)
        .map(part => {
          if (/^[_-]+$/.test(part)) return ' '
          if (!part) return part
          return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
        })
        .join('')
    })
    .join('')
}
// Short alias for inline use in templates.
const tc = (v) => toTitleCase(v)

// Role → page allow-list. Sidebar items, page dispatcher and the router all
// consult this so a single source of truth controls who-sees-what. Pages not
// listed here are open to every authenticated user.
const PAGE_PERMISSIONS = {
  'super-dashboard': ['admin'],
  'broadcasts-view': ['admin'],
  'clients-list':    ['admin'],
  'billing-admin':   ['admin'],
  'team-overview':   ['admin', 'pm'],
  'external-team':   ['admin', 'pm'],
  // Sales CRM pages — defaulted to admin + sales family. PM/PC don't get
  // these by default any more; admin can still grant them via the granular
  // permission keys (leads.*, portfolios.*, scopes.*, quotations.*,
  // meetings.*, sales_incentive.*) which canSeePage honours via NAV_PERMISSION_MAP.
  'leads-view':      ['admin', 'sales_manager', 'sales_tl', 'sales_agent'],
  'lead-detail':     ['admin', 'sales_manager', 'sales_tl', 'sales_agent'],
  'lead-followups':  ['admin', 'sales_manager', 'sales_tl', 'sales_agent'],
  'lead-tasks':      ['admin', 'sales_manager', 'sales_tl', 'sales_agent'],
  'sales-tracker':   ['admin', 'sales_manager', 'sales_tl', 'sales_agent'],
  'sales-team':      ['admin', 'sales_manager', 'sales_tl'],
  'portfolio-library': ['admin', 'sales_manager', 'sales_tl', 'sales_agent'],
  'scope-library':     ['admin', 'sales_manager', 'sales_tl', 'sales_agent'],
  'quotation-library': ['admin', 'sales_manager', 'sales_tl', 'sales_agent'],
  'sales-incentive':   ['admin', 'sales_manager', 'sales_tl', 'sales_agent'],
  'meet-setup':        ['admin', 'sales_manager', 'sales_tl', 'sales_agent'],
  'project-team':    ['admin', 'pm', 'pc'],
  'dev-team':        ['admin', 'pm', 'pc'],
  'hr-team':         ['admin', 'pm', 'pc', 'hr'],
  'personal-tasks':  ['admin', 'pm', 'pc', 'developer', 'team', 'sales_manager', 'sales_tl', 'sales_agent', 'hr'],
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
  // HR pages: role-based fallback for users without any permission grants.
  // Admin always bypasses (canSeePage), and NAV_PERMISSION_MAP below makes
  // these visible to anyone with the relevant hr.*.manage permission, so
  // admin can hand HR access to any role (incl. a custom `hr` role) without
  // editing this list.
  'hr-attendance':   ['admin', 'hr'],
  // Calendar is visible to every authenticated user — they can at least add
  // personal events (client meetings, follow-ups). HR/admin still own the
  // "Company" visibility toggle inside the Add Event modal.
  'hr-calendar':     ['admin', 'pm', 'pc', 'developer', 'team', 'sales_manager', 'sales_tl', 'sales_agent', 'hr'],
  'hr-warnings':     ['admin', 'hr'],
  'hr-pips':         ['admin', 'hr'],
  'hr-salary-slips': ['admin', 'hr'],
  'hr-terminations': ['admin', 'hr'],
  'hr-documents':    ['admin', 'hr'],
  'hr-assets':       ['admin', 'hr'],
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
// Every sidebar page is gated by at least one permission key. canSeePage
// requires the user's role document to grant ONE of these keys — admin
// always bypasses. Removing the only matching permission from a role hides
// the tab immediately on the next page refresh.
const NAV_PERMISSION_MAP = {
  // Admin areas
  'super-dashboard':   ['reports.view_admin_dashboard'],
  'broadcasts-view':   ['broadcasts.send', 'broadcasts.view', 'broadcasts.create', 'broadcasts.edit', 'broadcasts.delete'],
  'clients-list':      ['clients.create', 'clients.view_all', 'clients.edit', 'clients.delete'],
  'billing-admin':     ['invoices.create', 'invoices.view_all', 'invoices.send', 'invoices.mark_paid', 'invoices.delete'],
  'team-overview':     ['team.view_overview'],
  'external-team':     ['team.view_external'],
  // Team directories — each has its own view permission so admin can grant
  // one tab without exposing the others.
  'sales-team':        ['team.view_sales'],
  'project-team':      ['team.view_project'],
  'dev-team':          ['team.view_dev'],
  'hr-team':           ['team.view_hr'],
  // PM / work
  'pm-dashboard':      ['reports.view_pm_dashboard'],
  'dev-dashboard':     ['dashboards.dev.view'],
  'team-dashboard':    ['dashboards.team.view'],
  'projects-list':     ['projects.create', 'projects.view_all', 'projects.edit', 'projects.delete', 'projects.manage_team', 'projects.manage_kanban_perms'],
  'kanban-board':      ['tasks.create', 'tasks.edit_any', 'tasks.edit_own', 'tasks.move', 'tasks.comment'],
  'my-tasks':          ['tasks.view_project'],
  'personal-tasks':    ['personal_tasks.view'],
  'bidding-view':      ['bids.view'],
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
  // HR module pages — show in sidebar to anyone with the corresponding
  // manage permission. Calendar now has its own .view permission so admin
  // can hide it from any role.
  'hr-attendance':     ['hr.attendance.manage'],
  'hr-calendar':       ['hr.calendar.view', 'hr.calendar.manage'],
  'hr-warnings':       ['hr.warnings.manage'],
  'hr-pips':           ['hr.pips.manage'],
  'hr-salary-slips':   ['hr.salary_slips.manage'],
  'hr-terminations':   ['hr.terminations.manage'],
  'hr-documents':      ['hr.documents.manage'],
  'hr-assets':         ['hr.assets.manage'],
  'sales-incentive':   ['sales_incentive.view_all', 'sales_incentive.set_target', 'sales_incentive.override', 'sales_incentive.mark_paid'],
  // Settings page — visible if user has ANY settings.* permission.
  'settings-view':     ['settings.manage_company', 'settings.manage_holidays', 'settings.manage_tech_stacks', 'settings.manage_invites', 'settings.manage_roles'],
  // Leads / sales tracker
  'leads-view':     ['leads.view_own', 'leads.view_all', 'leads.create', 'leads.edit', 'leads.delete'],
  'lead-detail':    ['leads.view_own', 'leads.view_all', 'leads.create', 'leads.edit', 'leads.delete'],
  'lead-followups': ['leads.view_own', 'leads.view_all', 'leads.create', 'leads.edit', 'leads.delete'],
  'lead-tasks':     ['leads.view_own', 'leads.view_all', 'leads.create', 'leads.edit', 'leads.delete'],
  'sales-tracker':  ['sales.tracker.view'],
  // Sprint / Milestone pages
  'sprints-view':    ['sprints.create', 'sprints.edit'],
  'milestones-view': ['milestones.create', 'milestones.edit'],
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
  // Strict, permission-authoritative gating: when a page is in
  // NAV_PERMISSION_MAP the user MUST have one of the listed permission
  // keys. The role-allowlist in PAGE_PERMISSIONS is only consulted for
  // pages that aren't permission-mapped (kept for forward compatibility
  // with future routes; the sidebar today maps every visible tab).
  const perms = NAV_PERMISSION_MAP[page]
  if (perms && perms.length) {
    return hasAnyPermission(perms)
  }
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
  'external-team': 'admin',
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
  'hr-attendance': 'hr',
  'hr-calendar': 'hr',
  'hr-warnings': 'hr',
  'hr-pips': 'hr',
  'hr-salary-slips': 'hr',
  'hr-terminations': 'hr',
  'hr-documents': 'hr',
  'hr-assets': 'hr',
  'hr-team': 'hr',
  'personal-tasks': 'dev',
}
const SIDEBAR_GROUP_DEFAULTS = {
  admin: true,
  pm: true,
  dev: true,
  team: true,
  sales: true,
  analytics: false,
  settings: true,
  hr: true,
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

// ── Global click-loader ──────────────────────────────────────
// Prevents double-clicks on action buttons. Every <button> / .btn click is
// intercepted: the element is marked busy (visually shows a spinner overlay
// via .is-busy CSS) and a second click is swallowed at capture phase until
// the action completes. Async work is tracked by wrapping window.fetch — any
// fetch initiated synchronously inside the click handler extends the lock
// until the network call resolves. For sync-only handlers we release after
// a short minimum so the lock still absorbs rapid duplicate clicks.
//
// Pure UI affordances (sidebar toggles, modal close, topbar icons, nav links,
// tab switches, pagination) are excluded so they remain responsive.
;(function installClickLoader(){
  if (window.__clickLoaderInstalled) return
  window.__clickLoaderInstalled = true

  // Pure UI affordances — never lock these. They're toggles/navigation, not
  // actions, and locking would block rapid UI interaction without preventing
  // any duplicate-submission risk.
  const SKIP_SELECTOR = [
    '[data-no-lock]',
    '.no-loader',
    '.close-btn',
    '.sidebar-reopen-fab',
    '.topbar-hamburger',
    '.icon-btn',
    '.tab-btn',
    '.nav-link',
    '.notif-btn',
    '.menu-item',
    '.dropdown-item',
  ].join(',')

  // Ancestor containers whose buttons are pure UI (sidebar nav, topbar icons,
  // drawer chrome, popover menus). Modals are NOT in this list — modal action
  // buttons (Save/Submit/Delete) must lock.
  const SKIP_ANCESTOR = '.sidebar, #sidebar, .topbar, .drawer-overlay, .dropdown-menu, .menu-popover, .modal-header'

  // onclick handlers that are *only* a UI toggle/opener/navigation — never
  // even arm the dup-click guard for these (they re-render synchronously or
  // navigate the router, no backend action). For everything else we use the
  // lazy-spinner strategy below: arm the guard immediately so rapid double
  // clicks are absorbed, but only paint the visible spinner if/when a real
  // fetch is initiated by the handler.
  const SKIP_ONCLICK = /^\s*(closeModal|closeDrawer|closeSidebar|openSidebar|switchTab|Router\.(back|navigate)|onProfileSetTheme|cpNavigate|cpBack|copyInviteLink|loadPage|toggle[A-Z][a-zA-Z]*|show[A-Z][a-zA-Z]*Modal|open[A-Z][a-zA-Z]*Modal|hide[A-Z][a-zA-Z]*|cancelEdit[A-Z]?[a-zA-Z]*|switch[A-Z][a-zA-Z]*|filter[A-Z][a-zA-Z]*|set[A-Z][a-zA-Z]*(Filter|View|Sort|Tab|Page)|go[A-Z][a-zA-Z]*Page)\s*\(/

  let _owner = null         // button currently "owning" the active click
  let _inflight = 0         // fetches in flight initiated under this owner
  let _minTimer = null
  let _spinnerShown = false // true once we've painted .is-busy on _owner
  // Safety net — every armed button registers a max-lock deadline. The
  // sweeper below force-releases anything still busy 30s later. Catches
  // hung servers, dropped fetch promises, and the edge case where the user
  // clicked a second button before the first one's fetch resolved (which
  // used to leave the original button stuck because _owner had moved on).
  const _stuckGuard = new Map() // el → setTimeout id
  const MAX_LOCK_MS = 30_000

  function shouldSkip(el){
    if (el.matches(SKIP_SELECTOR)) return true
    if (el.closest(SKIP_ANCESTOR)) return true
    const oc = el.getAttribute('onclick')
    if (oc && SKIP_ONCLICK.test(oc)) return true
    return false
  }

  // Two-phase locking:
  //   armBusy(el)   — flag the element so the capture-phase guard eats
  //                   double-clicks. Pure data flag, no visual change.
  //   showSpinner(el) — paint the .is-busy class + aria-busy. This is the
  //                   user-visible loader. Only triggered when a real fetch
  //                   actually starts (see the fetch wrapper below).
  // release(el) tears down whichever phase was applied. Splitting these
  // means a click that doesn't talk to the backend never shows a spinner.
  function armBusy(el){
    if (!el || el.dataset.busy === '1') return
    el.dataset.busy = '1'
    // Safety-net deadline: if anything goes wrong (server hangs, fetch
    // promise never resolves, another button takes over _owner before we
    // release this one) the sweeper force-releases the button at 30s so
    // the user is never stuck staring at a dead spinner.
    const prev = _stuckGuard.get(el)
    if (prev) clearTimeout(prev)
    _stuckGuard.set(el, setTimeout(() => {
      _stuckGuard.delete(el)
      if (el.dataset.busy === '1') {
        // Force-release — bypasses the same _owner check release() does.
        el.dataset.busy = ''
        if (el.dataset.prevAriaBusy) el.setAttribute('aria-busy', el.dataset.prevAriaBusy)
        else el.removeAttribute('aria-busy')
        el.classList.remove('is-busy')
        delete el.dataset.prevAriaBusy
        if (_owner === el) { _owner = null; _inflight = 0; _spinnerShown = false }
      }
    }, MAX_LOCK_MS))
    // IMPORTANT: do NOT set el.disabled = true here. Doing so (even via a
    // microtask) causes the click's "activation behavior" — e.g. submitting
    // the parent form on a <button type="submit"> — to be skipped because
    // the browser checks .disabled during activation. The CSS class
    // pointer-events:none + the dataset.busy capture-phase guard already
    // eat subsequent clicks; that's enough to prevent duplicates without
    // breaking the FIRST click's default action.
  }

  function showSpinner(el){
    if (!el || el.classList.contains('is-busy')) return
    el.dataset.prevAriaBusy = el.getAttribute('aria-busy') || ''
    el.setAttribute('aria-busy', 'true')
    el.classList.add('is-busy')
    _spinnerShown = true
  }

  function release(el){
    if (!el || el.dataset.busy !== '1') return
    el.dataset.busy = ''
    if (el.dataset.prevAriaBusy) el.setAttribute('aria-busy', el.dataset.prevAriaBusy)
    else el.removeAttribute('aria-busy')
    el.classList.remove('is-busy')
    delete el.dataset.prevAriaBusy
    const t = _stuckGuard.get(el)
    if (t) { clearTimeout(t); _stuckGuard.delete(el) }
  }

  // Backwards-compat for window.withButtonLoader — that helper expects an
  // imperative "lock everything now" entry-point.
  function lock(el){ armBusy(el); showSpinner(el) }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('button, .btn, [data-click-lock]')
    if (!el) return
    // Second click while still busy → eat it. This is the core duplicate-action
    // guard: even if browser hasn't applied disabled yet, capture phase fires
    // before bubble so we stop the handler chain here.
    if (el.dataset.busy === '1' || el.disabled) {
      e.preventDefault()
      e.stopImmediatePropagation()
      return
    }
    if (shouldSkip(el)) return
    // Only arm for things that actually do something — having an onclick
    // attr or being a submit button is a good proxy. Plain layout buttons
    // get skipped.
    const isAction = el.hasAttribute('onclick')
      || el.type === 'submit'
      || el.hasAttribute('data-click-lock')
    if (!isAction) return

    // Arm the dup-click guard immediately. The visible spinner is deferred
    // until a real fetch starts (see the fetch wrapper below) so UI-only
    // handlers never paint a spinner that would just flash and vanish.
    armBusy(el)
    _owner = el
    _inflight = 0
    _spinnerShown = false
    clearTimeout(_minTimer)
    queueMicrotask(() => {
      if (_inflight > 0) return // fetch wrapper will release when count hits 0
      // Sync-only handler — release the dup-guard after a short minimum so
      // rapid duplicate clicks are still absorbed. No spinner was ever
      // painted because no fetch happened.
      _minTimer = setTimeout(() => {
        // Release the originating element regardless of the current _owner —
        // a second click that armed another button must not strand this
        // first one in a busy state. Only clear _owner if it still points
        // at us (otherwise we'd kick the legitimate current owner).
        release(el)
        if (_owner === el && _inflight === 0) {
          _owner = null
          _spinnerShown = false
        }
      }, 350)
    })
  }, true)

  // Wrap fetch so the visible spinner is painted only when a real network
  // call is in flight, and torn down when the last one resolves. The
  // dup-click guard was armed synchronously on the click; we extend it for
  // as long as fetches are in flight.
  if (typeof window.fetch === 'function') {
    const _origFetch = window.fetch.bind(window)
    window.fetch = function patchedFetch(){
      const captured = _owner
      if (!captured) return _origFetch.apply(this, arguments)
      // First fetch initiated by this click → paint the spinner now. Any
      // further fetches before the count drops to zero stay under the same
      // spinner (no re-paint).
      _inflight++
      if (_inflight === 1) showSpinner(captured)
      const p = _origFetch.apply(this, arguments)
      const done = () => {
        _inflight = Math.max(0, _inflight - 1)
        if (_inflight === 0) {
          // One paint frame after the last fetch so post-action re-render runs
          // before we re-enable the button. We release the *captured* element
          // unconditionally — even if the user clicked another button in the
          // meantime — because that's the one we locked. Skipping the release
          // when _owner has moved on was the bug that left buttons stuck.
          requestAnimationFrame(() => {
            release(captured)
            if (_inflight === 0 && _owner === captured) {
              _owner = null
              _spinnerShown = false
            }
          })
        }
      }
      p.then(done, done)
      return p
    }
  }

  // Form submit safety net — if a form submits natively (rare here), lock its
  // submit button briefly so it can't be re-submitted.
  document.addEventListener('submit', (e) => {
    const form = e.target
    if (!(form instanceof HTMLFormElement)) return
    if (form.dataset.busy === '1') {
      e.preventDefault()
      e.stopImmediatePropagation()
      return
    }
    if (form.matches('[data-no-lock]')) return
    form.dataset.busy = '1'
    const submitter = e.submitter || form.querySelector('button[type=submit], input[type=submit]')
    if (submitter) lock(submitter)
    setTimeout(() => {
      form.dataset.busy = ''
      if (submitter) release(submitter)
    }, 1500)
  }, true)

  // Public helper for code paths that run outside the click pipeline (timers,
  // websocket triggers, programmatic actions): await withButtonLoader(btn, fn).
  window.withButtonLoader = async function(btn, fn){
    if (!btn) return fn()
    try { lock(btn); return await fn() }
    finally { release(btn) }
  }
})()

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
  // Bust every page's cache flag — any page the user navigates to next will
  // re-fetch instead of showing stale data captured before this mutation.
  // Without this, moving a kanban task and switching to PM Dashboard would
  // show pre-move stats until the user manually refreshed.
  document.querySelectorAll('.page').forEach(p => {
    if (p.id && p.id.startsWith('page-')) p.dataset.loaded = ''
  })
  // Active page wins; otherwise fall back to the router's current route.
  const active = document.querySelector('.page.active')
  if (active && active.id?.startsWith('page-')) {
    const page = active.id.replace(/^page-/, '')
    if (typeof loadPage === 'function') loadPage(page, active)
    return
  }
  if (Router?.current?.page) {
    const el = document.getElementById('page-' + Router.current.page)
    if (el && typeof loadPage === 'function') {
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
        <span style="font-size:12px;color:#7E7E8F;white-space:nowrap">Rows per page</span>
        <select class="form-select" style="width:96px;padding:8px 28px 8px 10px" onchange="setEnterprisePageSize('${pageKey}', this.value)">
          ${PAGE_SIZE_OPTIONS.map(size => `<option value="${size}" ${currentLimit===size?'selected':''}>${size}</option>`).join('')}
        </select>
      </div>` : ''
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-top:1px solid var(--border);flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div style="font-size:12px;color:#7E7E8F">
          ${pagination.total ? `Showing ${pagination.start}-${pagination.end} of ${pagination.total} ${label}` : `No ${label} found`}
        </div>
        ${pageSizeControl}
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <button class="btn btn-sm btn-outline" ${pagination.page <= 1 ? 'disabled' : ''} onclick="${prevFn}(${pagination.page - 1})">Previous</button>
        <span style="font-size:12px;color:#7E7E8F">Page ${pagination.page} of ${pagination.totalPages || 1}</span>
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
  t.innerHTML = `<i class="fas ${icons[type]||'fa-info-circle'}" style="color:${type==='success'?'#58C68A':type==='error'?'#FF5E3A':'#A970FF'}"></i><span>${msg}</span>`
  ct.appendChild(t)
  setTimeout(() => t.remove(), dur)
}

// ── Auth ─────────────────────────────────────────────────────
function saveAuth(token, user) {
  _token = token; _user = user
  localStorage.setItem('devportal_token', token)
  localStorage.setItem('devportal_user', JSON.stringify(user))
  applyTheme(user?.theme)
}
function clearAuth() {
  _token = null; _user = null
  localStorage.removeItem('devportal_token')
  localStorage.removeItem('devportal_user')
}
function loadAuth() {
  const t = localStorage.getItem('devportal_token')
  const u = localStorage.getItem('devportal_user')
  if (t && u) { _token = t; _user = JSON.parse(u); applyTheme(_user?.theme); return true }
  return false
}

// Theme: light | dark. Default = dark (AMOLED lavender). Stored on the user
// record server-side so it follows them across devices; localStorage is just
// a cache so the page paints with the right theme before /verify resolves.
function applyTheme(theme) {
  const t = String(theme || '').toLowerCase() === 'light' ? 'light' : 'dark'
  document.body.classList.toggle('theme-light', t === 'light')
  document.body.classList.toggle('theme-dark', t === 'dark')
  try { localStorage.setItem('devportal_theme', t) } catch {}
}

// Read theme from localStorage *before* user data is available, so the login
// page and the first paint don't flash the wrong theme on reload.
function applyCachedTheme() {
  try { applyTheme(localStorage.getItem('devportal_theme')) } catch { applyTheme('dark') }
}

async function setTheme(theme) {
  const next = String(theme || '').toLowerCase() === 'light' ? 'light' : 'dark'
  applyTheme(next)
  if (_user) {
    _user = { ..._user, theme: next }
    localStorage.setItem('devportal_user', JSON.stringify(_user))
  }
  if (!_token) return
  try {
    await API.patch('/auth/theme', { theme: next })
  } catch (e) {
    // Surface the failure but keep the local change so the UI doesn't
    // jump back — they can retry from the profile modal.
    toast('Theme saved locally, server update failed: ' + (e?.message || ''), 'warning')
  }
}
window.setTheme = setTheme
window.applyTheme = applyTheme

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
      applyTheme(_user.theme)
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
        // Encode params into the URL hash too — `#/page?id=xxx&name=yyy` —
        // so a hard refresh restores the full route even if sessionStorage
        // gets cleared by the browser. This is what keeps the kanban board
        // on the same project after F5 / Cmd-R.
        const params = this.current.params || {}
        const qs = Object.keys(params)
          .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
          .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k])))
          .join('&')
        const targetHash = '#/' + this.current.page + (qs ? '?' + qs : '')
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

// Expose Router on window so scripts loaded as separate <script> tags
// (enterprise.js, pages.js, etc.) can reach it via `window.Router`. A
// top-level `const Router = { … }` is NOT attached to window automatically,
// which silently broke every `window.Router?.current?…` access in other
// files (kanban project selection, drawer URL persistence, etc.).
window.Router = Router

window.addEventListener('hashchange', () => {
  const m = (location.hash || '').match(/^#\/([\w-]+)(\?(.*))?/)
  if (!m) return
  const next = m[1]
  const params = {}
  const qs = m[3] || ''
  if (qs) {
    for (const part of qs.split('&')) {
      const [k, v = ''] = part.split('=')
      if (k) {
        try { params[decodeURIComponent(k)] = decodeURIComponent(v) }
        catch { params[k] = v }
      }
    }
  }
  // Already on the same page+params? No-op so we don't fight our own
  // history.replaceState in _persist.
  const cur = Router.current
  if (cur?.page === next && JSON.stringify(cur.params || {}) === JSON.stringify(params)) return
  if (_user) Router.navigate(next, params)
})

// ── Colour helpers ───────────────────────────────────────────
function initials(name='') { return name.split(' ').map(p=>p[0]).join('').substring(0,2).toUpperCase() }
function avatar(name, color='#A970FF', size='') {
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
// Absolute timestamp formatter — replaces the old "3m ago" relative output.
// The team prefers exact date+time everywhere so users can correlate events
// across systems without recomputing the wall-clock. Format: "12 Mar 2026, 04:35 PM".
function timeAgo(d) {
  if (!d) return ''
  const date = new Date(d)
  if (Number.isNaN(date.getTime())) return ''
  if (typeof dayjs === 'function') {
    return dayjs(date).format('DD MMM YYYY, hh:mm A')
  }
  return date.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
}
function pctColor(p) { return p >= 90 ? '#FF5E3A' : p >= 70 ? '#C9A7FF' : '#58C68A' }
function docCategoryIcon(cat) {
  const ic = { sow:'📋', brd:'📌', frd:'📐', uiux:'🎨', wireframes:'🖼️', meeting_notes:'📝', technical:'⚙️', test_report:'🧪', release:'🚀', billing:'💰', contract:'📜', other:'📄' }
  return ic[cat] || '📄'
}
function docCategoryColor(cat) {
  const c = { sow:'#A970FF', brd:'#C9A7FF', frd:'#A970FF', uiux:'#FF5E3A', wireframes:'#C9A7FF', meeting_notes:'#58C68A', technical:'#7E7E8F', test_report:'#A970FF', release:'#C9A7FF', billing:'#58C68A', contract:'#B388FF', other:'#5A5A66' }
  return c[cat] || '#5A5A66'
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
    applyStoredSidebarState()
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
    hr: 'hr-attendance',
    // Clients land on Support — the only main-app surface they can reach. The
    // dedicated client portal is rendered separately via renderClientPortal()
    // before this map is consulted, but if a client somehow ends up in the
    // main shell we still need a non-blank landing.
    client: 'support-tickets',
  }
  // Preferred landing for this role. If the user's permissions block even
  // that (e.g. role exists but the permission was revoked), fall through to
  // the first page they CAN see — otherwise Router.navigate bounces forever.
  const preferred = map[_user?.role] || 'pm-dashboard'
  if (typeof canSeePage === 'function' && canSeePage(preferred)) return preferred
  const fallbacks = [
    'pm-dashboard', 'dev-dashboard', 'team-dashboard',
    'my-tasks', 'personal-tasks', 'hr-attendance', 'hr-calendar',
    'leaves-view', 'documents-center', 'settings-view',
  ]
  for (const p of fallbacks) {
    if (canSeePage(p)) return p
  }
  return preferred
}

// ── Shell HTML ────────────────────────────────────────────────
// Build a single nav <a> only if the current user has permission to see the
// page. Sections that end up empty are dropped entirely so we don't render
// hollow group headers.
function navItem(page, iconClass, label, badgeHtml = '') {
  if (!canSeePage(page)) return ''
  return `<a class="nav-item" data-page="${page}"><span class="nav-icon"><i class="fas ${iconClass}"></i></span>${label}${badgeHtml}</a>`
}
// A parent nav item that expands to reveal sub-items. Used for grouping
// related pages (e.g. internal / external Team) under one entry without
// taking two slots in the sidebar. Children that the user can't see are
// dropped; if zero remain, the whole parent is suppressed.
function navItemExpandable({ key, iconClass, label, defaultOpen = true, children = [] }) {
  const filtered = children.filter(c => canSeePage(c.page)).map(c =>
    `<a class="nav-item nav-subitem" data-page="${c.page}"><span class="nav-icon"><i class="fas ${c.iconClass}"></i></span>${c.label}</a>`
  )
  if (!filtered.length) return ''
  return `<div class="nav-subgroup ${defaultOpen ? 'is-open' : ''}" data-nav-subgroup="${key}">
    <button type="button" class="nav-item nav-subgroup-toggle" data-nav-subtoggle="${key}" aria-expanded="${defaultOpen ? 'true' : 'false'}">
      <span class="nav-icon"><i class="fas ${iconClass}"></i></span>
      ${label}
      <i class="fas fa-chevron-down nav-subgroup-caret" style="margin-left:auto;font-size:11px;transition:transform .18s"></i>
    </button>
    <div class="nav-subgroup-body">${filtered.join('')}</div>
  </div>`
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
      navItem('broadcasts-view', 'fa-bullhorn',  'Broadcast'),
      navItemExpandable({
        key: 'admin-team',
        iconClass: 'fa-users',
        label: 'Team',
        defaultOpen: true,
        children: [
          { page: 'team-overview', iconClass: 'fa-user',     label: 'Internal Team' },
          { page: 'external-team', iconClass: 'fa-user-tag', label: 'External Team' },
        ],
      }),
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
      navItem('lead-tasks',      'fa-list-check',     'Sales Tasks'),
      // Calendar lives in the HR section now — listing it here led to 3-4
      // duplicate "Calendar" entries in every sidebar. Same applies to
      // "My Task" which has its own home under My Workspace.
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
      navItem('pm-dashboard',    'fa-gauge-high', 'My Dashboard'),
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
      navItem('my-tasks',       'fa-list-check',  'Project Tasks'),
      navItem('personal-tasks', 'fa-clipboard-check', 'My Task'),
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
      navItem('personal-tasks', 'fa-clipboard-check', 'My Task'),
      navItem('bidding-view',   'fa-gavel',       'Bidding', ' <span class="nav-badge" id="nb-bids" style="display:none">0</span>'),
      navItem('support-tickets','fa-life-ring',   'Support Tickets'),
      navItem('dev-team',       'fa-people-group','Dev Team'),
    ],
  }) : ''

  // HR section — admin/PM/PC manage people ops here. Calendar is the only
  // entry visible to everyone since it just shows company events/holidays.
  const navHR = navSection({
    key: 'hr', heading: 'HR', chip: 'People', expanded: true, icon: 'fa-id-badge',
    items: [
      navItem('hr-attendance',   'fa-user-clock',      'Attendance'),
      navItem('hr-calendar',     'fa-calendar-days',   'Calendar'),
      navItem('hr-warnings',     'fa-triangle-exclamation', 'Warnings'),
      navItem('hr-pips',         'fa-clipboard-list',  'PIPs'),
      navItem('hr-salary-slips', 'fa-money-check-dollar', 'Salary Slips'),
      navItem('hr-terminations', 'fa-user-slash',      'Terminations'),
      navItem('hr-documents',    'fa-file-signature',  'Documents'),
      navItem('hr-assets',       'fa-box-archive',     'Assets'),
      navItem('hr-team',         'fa-people-group',    'HR Team'),
    ],
  })

  const navReports = navSection({
    key: 'analytics', heading: 'Analytics', chip: 'Insight', expanded: false, icon: 'fa-wand-magic-sparkles',
    items: [
      navItem('reports-view', 'fa-chart-bar', 'Reports'),
      navItem('alerts-view',  'fa-bell',      'Alerts', ' <span class="nav-badge" id="nb-alerts">0</span>'),
    ],
  })

  // Settings section — gated via NAV_PERMISSION_MAP so it shows only for
  // admin or anyone with at least one settings.* permission. Used to be
  // hardcoded into the shell and bypassed canSeePage entirely.
  const navSettings = navSection({
    key: 'settings', heading: 'Settings', chip: 'App', expanded: true, icon: 'fa-sliders',
    items: [
      navItem('settings-view', 'fa-gear', 'Settings'),
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
    ${navAdmin}${navPm}${navDev}${navTeam}${navSales}${navHR}${navReports}${navSettings}
    <div class="sidebar-footer">
      <div class="user-card" onclick="showProfileModal()">
        ${avatar(_user.name||_user.full_name, _user.avatar_color||'#A970FF')}
        <div style="min-width:0">
          <div style="font-size:13px;font-weight:700;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_user.name||_user.full_name}</div>
          <div style="font-size:11px;color:#7E7E8F;text-transform:capitalize">${_user.role}</div>
        </div>
        <i class="fas fa-ellipsis" style="color:#7E7E8F;margin-left:auto;font-size:12px"></i>
      </div>
    </div>
  </div>
  <div id="sidebar-overlay" class="sidebar-overlay" onclick="closeSidebar()"></div>
  <div id="topbar">
    <button class="topbar-hamburger" onclick="toggleSidebar()" id="menu-toggle" aria-label="Toggle sidebar" style="display:flex"><i class="fas fa-bars"></i></button>
    <button class="icon-btn" id="back-btn" onclick="Router.back()" style="display:none" data-tip="Go Back"><i class="fas fa-arrow-left"></i></button>
    <div class="breadcrumb" id="breadcrumb">
      <span>DevPortal</span><i class="fas fa-chevron-right" style="font-size:10px"></i><span class="current" id="bc-current">Dashboard</span>
    </div>
    <div class="topbar-actions">
      <div class="search-wrap" style="position:relative">
        <i class="fas fa-search"></i>
        <input class="search-bar" placeholder="Search projects, tasks, clients, leads, invoices…" id="global-search" autocomplete="off"
          oninput="globalSearch(this.value)"
          onfocus="primeGlobalSearch();globalSearch(this.value)"
          onblur="setTimeout(()=>{const d=document.getElementById('global-search-results');if(d)d.style.display='none'},180)"
          onkeydown="if(event.key==='Escape'){this.blur();this.value='';const d=document.getElementById('global-search-results');if(d)d.style.display='none'}"/>
        <div id="global-search-results" class="global-search-dropdown" style="display:none"></div>
      </div>
      <button class="icon-btn notif-btn" onclick="showNotifications()" data-tip="Notifications"><i class="fas fa-bell"></i><span class="notif-dot" id="notif-dot" hidden style="display:none"></span><span class="notif-badge" id="notif-badge" hidden style="display:none"></span></button>
      <button class="icon-btn" onclick="logout()" data-tip="Logout"><i class="fas fa-sign-out-alt"></i></button>
    </div>
  </div>
  <div id="main">
    <div id="page-super-dashboard"  class="page"></div>
    <div id="page-broadcasts-view"  class="page"></div>
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
    <div id="page-external-team"    class="page"></div>
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
    <div id="page-hr-attendance"    class="page"></div>
    <div id="page-hr-calendar"      class="page"></div>
    <div id="page-hr-warnings"      class="page"></div>
    <div id="page-hr-pips"          class="page"></div>
    <div id="page-hr-salary-slips"  class="page"></div>
    <div id="page-hr-terminations"  class="page"></div>
    <div id="page-hr-documents"     class="page"></div>
    <div id="page-hr-assets"        class="page"></div>
    <div id="page-hr-team"          class="page"></div>
    <div id="page-personal-tasks"   class="page"></div>
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
  'super-dashboard':'Overview','broadcasts-view':'Broadcast','pm-dashboard':'My Dashboard','dev-dashboard':'My Dashboard','team-dashboard':'Team Dashboard',
  'projects-list':'Projects','kanban-board':'Kanban Board','sprints-view':'Sprints',
  'milestones-view':'Milestones','documents-center':'Documents','resources-view':'Resources',
  'my-tasks':'My Tasks','timesheets-view':'Timesheets','approval-queue':'Approvals','leaves-view':'Leaves','bidding-view':'Bidding',
  'reports-view':'Reports & Analytics','alerts-view':'Alerts','clients-list':'Clients',
  'billing-admin':'Billing & Invoices','team-overview':'Team','external-team':'External Team','leads-view':'Leads','lead-detail':'Lead Details','lead-followups':'Lead Follow-ups','lead-tasks':'Lead Tasks','sales-tracker':'Sale Tracker','sales-team':'Sales Team','project-team':'Project Team','dev-team':'Dev Team','portfolio-library':'Portfolio','scope-library':'Scope of Work','quotation-library':'Quotation','sales-incentive':'Sale Incentive','meet-setup':'Meet Setup','support-tickets':'Support Tickets','hr-attendance':'Attendance','hr-calendar':'Calendar','hr-warnings':'Warnings','hr-pips':'Performance Improvement Plans','hr-salary-slips':'Salary Slips','hr-terminations':'Terminations','hr-documents':'HR Documents','hr-assets':'Asset Register','hr-team':'HR Team','personal-tasks':'My Task','settings-view':'Settings'
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
    // Sub-group toggle (e.g. Team → Internal / External). Handle BEFORE
    // [data-page] because the toggle button itself isn't a page link.
    const subToggle = e.target.closest('[data-nav-subtoggle]')
    if (subToggle) {
      const wrap = subToggle.closest('[data-nav-subgroup]')
      if (wrap) {
        const isOpen = wrap.classList.toggle('is-open')
        subToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false')
      }
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
  stream: null,
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

// ── Broadcast buzz ────────────────────────────────────────────
// Broadcasts are higher-priority than a regular ping — admin posted an
// announcement that the recipient should actively acknowledge. So instead
// of a one-shot ding we repeat the chime every BUZZ_PERIOD_MS until the
// user marks the broadcast read (clicks it in the panel, or hits Mark all
// read). The set tracks the still-unacknowledged broadcast notification
// ids; the interval auto-stops when the set empties.
const _broadcastBuzz = { pending: new Set(), timer: null }
const BROADCAST_BUZZ_PERIOD_MS = 4000

function _broadcastBuzzStart(notifId) {
  if (!notifId) return
  if (_broadcastBuzz.pending.has(notifId)) return
  _broadcastBuzz.pending.add(notifId)
  if (_broadcastBuzz.timer) return // already buzzing for an earlier broadcast
  const tick = () => {
    if (!_broadcastBuzz.pending.size) { _broadcastBuzzStop(); return }
    _notifPlayDing('broadcast')
  }
  tick() // play once immediately, then keep repeating until acknowledged
  _broadcastBuzz.timer = setInterval(tick, BROADCAST_BUZZ_PERIOD_MS)
}

function _broadcastBuzzStop(notifId) {
  if (notifId === undefined) {
    _broadcastBuzz.pending.clear()
  } else {
    _broadcastBuzz.pending.delete(notifId)
  }
  if (!_broadcastBuzz.pending.size && _broadcastBuzz.timer) {
    clearInterval(_broadcastBuzz.timer)
    _broadcastBuzz.timer = null
  }
}
window._broadcastBuzzStop = _broadcastBuzzStop

// Reconcile the pending-buzz set against the latest unread list from the
// server. On every poll/SSE message we call this with the current `recent`
// payload so any broadcast that's now marked read elsewhere (another tab,
// the mobile app, etc.) stops buzzing here too.
//
// Idempotency: once we've shown a broadcast's modal in this session (id in
// `_broadcastModal.shown`), reconciliation must NEVER re-pop it or restart
// the buzz for it — even if the server still reports it as unread for one
// more poll cycle (POST /read → next GET race). Otherwise the modal we
// just closed reappears and looks like the page went blank under it.
function _broadcastBuzzReconcile(recent) {
  if (!Array.isArray(recent)) return
  const stillUnread = new Map()  // id → notif doc
  for (const n of recent) {
    if (!n || n.type !== 'broadcast') continue
    if (!n.is_read) stillUnread.set(n.id, n)
  }
  for (const id of Array.from(_broadcastBuzz.pending)) {
    if (!stillUnread.has(id)) {
      _broadcastBuzzStop(id)
      _broadcastModalDismiss(id)
    }
  }
  for (const [id, doc] of stillUnread) {
    if (_broadcastModal.shown.has(id)) continue // already shown → don't revive
    _broadcastBuzzStart(id)
    _broadcastModalShow(doc)
  }
}

// ── Broadcast modal popup ─────────────────────────────────────
// Mirror of the lead follow-up alarm. When a broadcast lands, we show a
// blocking overlay with the title + body so the user can't miss it — same
// "must explicitly acknowledge to dismiss" UX. Multiple broadcasts queue
// up; acknowledging one pops the next. Acknowledge calls
// /notifications/{id}/read which (via the reconcile pass) also stops the
// buzz and removes any future re-pop on the next poll.
const _broadcastModal = {
  queue: [],     // pending notification docs, FIFO
  active: null,  // currently rendered doc (or null)
  hostId: 'broadcast-modal-host',
  shown: new Set(), // ids we've ever rendered this session — prevents re-pop
}

function _broadcastModalShow(notif) {
  if (!notif || !notif.id) return
  if (_broadcastModal.shown.has(notif.id)) return
  _broadcastModal.shown.add(notif.id)
  if (_broadcastModal.active) {
    // Already showing one — queue and render after the user acknowledges.
    if (!_broadcastModal.queue.some(q => q.id === notif.id)) {
      _broadcastModal.queue.push(notif)
    }
    return
  }
  _broadcastModal.active = notif
  _broadcastModalRender(notif)
}

function _broadcastModalRender(n) {
  const safeId = String(n.id || '').replace(/[^\w-]/g, '')
  const sender = escapeHtml(n.actor_name || 'Admin')
  const when = n.created_at ? (typeof timeAgo === 'function' ? timeAgo(n.created_at) : n.created_at) : ''
  const html = `
    <div id="broadcast-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="broadcast-modal-title" style="position:fixed;inset:0;background:rgba(0,0,0,.7);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:9999">
      <div style="width:min(480px,94vw);background:#16161C;border:1px solid #A970FF;border-radius:14px;box-shadow:0 28px 72px rgba(0,0,0,.7);overflow:hidden">
        <div style="padding:14px 18px;background:linear-gradient(90deg,#7B4DFF,#A970FF,#C56FE6);color:#fff;display:flex;align-items:center;gap:10px">
          <i class="fas fa-bullhorn fa-shake" style="font-size:18px"></i>
          <div style="font-weight:700;letter-spacing:.5px" id="broadcast-modal-title">Broadcast Announcement</div>
        </div>
        <div style="padding:20px">
          <div style="font-size:15px;font-weight:700;color:#e2e8f0;margin-bottom:10px;line-height:1.35">${escapeHtml(n.title || '')}</div>
          <div style="font-size:13.5px;color:#cbd5e1;line-height:1.55;white-space:pre-wrap">${escapeHtml(n.body || '')}</div>
          <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.06);font-size:11.5px;color:#7E7E8F;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
            <span><i class="fas fa-user" style="margin-right:5px"></i>${sender}</span>
            ${when ? `<span><i class="fas fa-clock" style="margin-right:5px"></i>${escapeHtml(when)}</span>` : ''}
          </div>
        </div>
        <div style="padding:12px 18px;background:rgba(169,112,255,.06);display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--border,rgba(255,255,255,.06))">
          <button class="btn btn-primary btn-sm" onclick="acknowledgeBroadcastModal('${safeId}')"><i class="fas fa-check"></i> Acknowledge</button>
        </div>
      </div>
    </div>`
  let host = document.getElementById(_broadcastModal.hostId)
  if (!host) {
    host = document.createElement('div')
    host.id = _broadcastModal.hostId
    document.body.appendChild(host)
  }
  host.innerHTML = html
}

// Cross-tab dismissal — if another tab marked this broadcast read we tear
// down the popup here too (called from _broadcastBuzzReconcile).
function _broadcastModalDismiss(id) {
  if (_broadcastModal.active?.id === id) {
    _broadcastModalCloseHost()
    _broadcastModal.active = null
    _broadcastModalPopNext()
    return
  }
  // Drop from queue if it was waiting.
  _broadcastModal.queue = _broadcastModal.queue.filter(q => q.id !== id)
}

function _broadcastModalCloseHost() {
  const host = document.getElementById(_broadcastModal.hostId)
  if (host) host.innerHTML = ''
}

function _broadcastModalPopNext() {
  const next = _broadcastModal.queue.shift()
  if (!next) { _broadcastModal.active = null; return }
  _broadcastModal.active = next
  _broadcastModalRender(next)
}

// "Acknowledge" — the explicit user gesture that:
//   1. marks the broadcast read server-side (mirrors clicking the notif row),
//   2. stops the buzz loop for this id,
//   3. closes the modal and pops the next queued broadcast (if any).
async function acknowledgeBroadcastModal(id) {
  if (!id) {
    id = _broadcastModal.active?.id
    if (!id) return
  }
  _broadcastBuzzStop(id)
  try { await API.post(`/notifications/${id}/read`, {}) } catch {}
  if (_notifState.unreadCount > 0) _notifSetBadge(Math.max(0, _notifState.unreadCount - 1))
  _broadcastModalCloseHost()
  _broadcastModal.active = null
  _broadcastModalPopNext()
  // Refresh badges + recent list silently so the bell stays in sync.
  pollNotifications()
}
window.acknowledgeBroadcastModal = acknowledgeBroadcastModal

// Build the Audio element once + ask the browser to start fetching the
// bytes immediately. Called from _tryPlayCategorySound on first use AND
// eagerly via preloadNotifSounds() so the first real notification doesn't
// have to wait for a 200-500ms network round-trip.
function _ensureCategoryAudio(cat) {
  if (_notifAudioEls[cat] || _notifAudioFailed[cat]) return _notifAudioEls[cat]
  try {
    const url = NOTIF_SOUND_FILES[cat] || NOTIF_SOUND_FILES.other
    const el = new Audio(url)
    el.preload = 'auto'
    el.volume = 0.7
    el.addEventListener('error', () => {
      _notifAudioFailed[cat] = true
      delete _notifAudioEls[cat]
    })
    // Force the network fetch + decode now so play() later is instant.
    try { el.load() } catch {}
    _notifAudioEls[cat] = el
    return el
  } catch {
    _notifAudioFailed[cat] = true
    return null
  }
}

function _tryPlayCategorySound(cat) {
  try {
    const el = _ensureCategoryAudio(cat)
    if (!el) return false
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

// Eagerly fetch every category's audio at app startup so the first real
// notification plays instantly. Without this, browser waits ~200-500ms to
// fetch + decode the .wav on the FIRST ding — which is exactly when the
// user is most likely to notice the delay.
function preloadNotifSounds() {
  for (const cat of Object.keys(NOTIF_SOUND_FILES)) _ensureCategoryAudio(cat)
  // Try to warm up RIGHT NOW. If we were called inside a user-activation
  // window (e.g. doLogin's onsubmit just fired), the muted play will succeed
  // and every Audio element gets "user-activated" — subsequent unmuted SSE
  // plays won't be autoplay-blocked. If we're NOT in activation context the
  // muted play silently rejects; the click listener below picks up the next
  // gesture as a fallback.
  warmupNotifAudio()
  document.addEventListener('click', warmupNotifAudio, { once: true })
  document.addEventListener('keydown', warmupNotifAudio, { once: true })
}
window.preloadNotifSounds = preloadNotifSounds

// Side-effect: resumes AudioContext + tickles each Audio element with a
// muted play() + pause(). After this, calling play() from a non-gesture
// context (SSE notification handler) is allowed by autoplay policy.
function warmupNotifAudio() {
  try {
    if (!_notifState.audioCtx) {
      const Ctor = window.AudioContext || window.webkitAudioContext
      if (Ctor) _notifState.audioCtx = new Ctor()
    }
    if (_notifState.audioCtx?.state === 'suspended') {
      _notifState.audioCtx.resume().catch(() => {})
    }
    for (const el of Object.values(_notifAudioEls)) {
      if (!el || el.dataset.warmedUp === '1') continue
      const wasMuted = el.muted
      el.muted = true
      const p = el.play()
      if (p && typeof p.then === 'function') {
        p.then(() => {
          el.pause()
          el.currentTime = 0
          el.muted = wasMuted
          el.dataset.warmedUp = '1'
        }).catch(() => { el.muted = wasMuted })
      } else {
        el.pause()
        el.muted = wasMuted
        el.dataset.warmedUp = '1'
      }
    }
  } catch {}
}
window.warmupNotifAudio = warmupNotifAudio

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
  if (dot) {
    dot.style.display = count > 0 ? '' : 'none'
    dot.hidden = !(count > 0)
  }
  if (badge) {
    // Belt + braces: drive both the `hidden` attribute (CSS handles via
    // `[hidden]`) and the inline display so a 0-count badge never lingers
    // even if some other rule sets display via !important.
    badge.hidden = !(count > 0)
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

    // First load: just sync state, don't ding — BUT do start the
    // broadcast buzz for any unread broadcast in the recent list, so the
    // user is still nagged on a fresh page load until they acknowledge.
    if (!_notifState.initialized) {
      _notifState.lastSeenId = latestId
      _notifState.lastSeenAt = res.latest_created_at || null
      _notifState.initialized = true
      _notifSetBadge(count)
      _broadcastBuzzReconcile(recent)
      return
    }

    if (latestId && latestId !== previousLastSeen) {
      // Find which entries are new (newer than lastSeenAt)
      const cutoff = _notifState.lastSeenAt
      const fresh = recent.filter((n) => !cutoff || (n.created_at && n.created_at > cutoff))
      if (fresh.length) {
        // Broadcasts get their own buzz loop + modal popup — kick them off
        // first so the recurring chime + announcement modal surface even if
        // the same poll also brings a lower-priority ticket/task ding.
        for (const n of fresh) {
          if (String(n.type || '').toLowerCase() === 'broadcast' && !n.is_read) {
            _broadcastBuzzStart(n.id)
            _broadcastModalShow(n)
          }
        }
        // Pick the highest-priority category among fresh non-broadcast items
        // so the ticket sound wins over a less specific sound. Skip if a
        // broadcast is already buzzing — no need to overlay another ding.
        const nonBroadcast = fresh.filter((n) => String(n.type || '').toLowerCase() !== 'broadcast')
        if (nonBroadcast.length) {
          const priority = ['ticket', 'task', 'other']
          const cats = nonBroadcast.map((n) => _notifSoundCategory(n.type))
          const pickedCat = priority.find((p) => cats.includes(p)) || 'other'
          const pickedItem = nonBroadcast.find((n) => _notifSoundCategory(n.type) === pickedCat) || nonBroadcast[0]
          _notifPlayDing(pickedItem?.type)
        }
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
    // Cross-tab acknowledgement: if another tab (or the server) marked the
    // broadcast read, stop buzzing here too.
    _broadcastBuzzReconcile(recent)
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
  // Eagerly fetch the .wav files so the FIRST notification's ding plays
  // instantly — without this the browser blocks the play() while it
  // streams the audio over the network (200-500ms delay users notice).
  preloadNotifSounds()
  // Fallback polling. SSE handles the real-time path; this catches anything
  // missed while the stream was disconnected or in flight. 4s keeps it tight
  // without thrashing the API — most users hit SSE first anyway.
  _notifState.timer = setInterval(() => { pollNotifications() }, 4000)
  // Refresh immediately when the tab becomes visible again, so the badge
  // catches up without waiting for the next interval tick.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      pollNotifications()
      // Tab woke up; reconnect SSE if the browser killed it while hidden.
      if (!_notifState.stream) startNotificationStream()
    }
  })
  startNotificationStream()
}

// Live push channel. The server emits each new notification onto an SSE
// stream the moment createUserNotification runs, so this normally fires
// within a few ms of the originating action. We process the pushed payload
// in place (no extra round-trip) so the badge / toast / sound update
// instantly. The fallback poller above still runs as a safety net.
function startNotificationStream() {
  if (_notifState.stream) return
  if (typeof EventSource === 'undefined') return
  if (!_token) return
  try {
    const src = new EventSource('/api/notifications/stream?token=' + encodeURIComponent(_token))
    _notifState.stream = src
    _notifState.streamRetry = 0
    src.addEventListener('notification', (ev) => {
      let doc = null
      try { doc = JSON.parse(ev.data) } catch { /* malformed payload */ }
      if (doc && doc.id) {
        _applyPushedNotification(doc)
      } else {
        // Payload missing — fall back to a poll so we still surface something.
        pollNotifications()
      }
    })
    src.onopen = () => { _notifState.streamRetry = 0 }
    src.onerror = () => {
      // Reconnect with exponential backoff (1s, 2s, 4s, capped at 30s). The
      // EventSource browser-default reconnect is opaque and sometimes never
      // fires, so we close + retry ourselves to keep the channel hot.
      try { src.close() } catch {}
      _notifState.stream = null
      const delay = Math.min(30000, 1000 * Math.pow(2, _notifState.streamRetry++))
      clearTimeout(_notifState.streamTimer)
      _notifState.streamTimer = setTimeout(startNotificationStream, delay)
    }
  } catch { /* ignore — poller covers us */ }
}

// Apply a newly-pushed notification doc to UI state without re-fetching.
// Mirrors what pollNotifications() does on detecting a fresh item but skips
// the network round-trip — that's the real-time win over polling.
function _applyPushedNotification(doc) {
  // Skip if we've already seen this one (SSE + poll can race on slow tabs).
  if (_notifState.recent.some((n) => n.id === doc.id)) return
  // Prepend to recent list (capped to 50 so memory doesn't grow forever).
  _notifState.recent = [doc, ...(_notifState.recent || [])].slice(0, 50)
  if (!doc.is_read) _notifSetBadge((_notifState.unreadCount || 0) + 1)
  _notifState.lastSeenId = doc.id
  _notifState.lastSeenAt = doc.created_at || new Date().toISOString()
  _notifState.initialized = true
  // Broadcasts buzz on a loop AND pop a blocking modal (same UX as the
  // lead follow-up alarm) until the user explicitly acknowledges them.
  // Everything else gets the normal one-shot ding + toast.
  if (String(doc.type || '').toLowerCase() === 'broadcast' && !doc.is_read) {
    _broadcastBuzzStart(doc.id)
    _broadcastModalShow(doc)
  } else {
    _notifPlayDing(doc.type)
    _notifShowToast(doc)
  }
  // Re-render the open notifications panel + active page (e.g. leaves view)
  // so the new item appears without the user reopening the bell or refreshing.
  _notifAutoRefreshActiveView([doc])
  // The bell panel is rendered via showModal; detect it via the unique
  // summary span and refresh in place.
  if (document.getElementById('notif-panel-summary') && typeof showNotifications === 'function') {
    showNotifications()
  }
}

function stopNotificationPoller() {
  if (_notifState.timer) {
    clearInterval(_notifState.timer)
    _notifState.timer = null
  }
  if (_notifState.streamTimer) {
    clearTimeout(_notifState.streamTimer)
    _notifState.streamTimer = null
  }
  if (_notifState.stream) {
    try { _notifState.stream.close() } catch {}
    _notifState.stream = null
  }
  _notifState.initialized = false
  _notifSetBadge(0)
}

// Sidebar visibility toggle.
//   Mobile (≤768px): slides the sidebar in/out via the `mobile-open` class.
//   Desktop (>768px): collapses the sidebar fully via body.sidebar-collapsed,
//   the floating "Menu" FAB brings it back. Choice is persisted to
//   localStorage so the layout sticks across navigations / reloads.
const SIDEBAR_COLLAPSED_KEY = 'devportal_sidebar_collapsed'
function applyStoredSidebarState() {
  try {
    if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1' && window.innerWidth > 768) {
      document.body.classList.add('sidebar-collapsed')
    }
  } catch {}
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar')
  const overlay = document.getElementById('sidebar-overlay')
  if (!sidebar) return
  if (window.innerWidth <= 768) {
    sidebar.classList.toggle('mobile-open')
    const isOpen = sidebar.classList.contains('mobile-open')
    if (overlay) overlay.classList.toggle('show', isOpen)
    document.body.style.overflow = isOpen ? 'hidden' : ''
    return
  }
  const collapsed = document.body.classList.toggle('sidebar-collapsed')
  try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0') } catch {}
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar')
  const overlay = document.getElementById('sidebar-overlay')
  if (sidebar) sidebar.classList.remove('mobile-open')
  if (overlay) overlay.classList.remove('show')
  document.body.style.overflow = ''
}

window.addEventListener('resize', () => {
  // Coming back to desktop from mobile: drop the mobile drawer state but
  // restore the user's desktop collapse preference.
  if (window.innerWidth > 768) {
    closeSidebar()
    applyStoredSidebarState()
  } else {
    // Mobile shouldn't show the desktop collapsed mode (the sidebar would
    // never be reachable). Clear the class but keep the stored preference.
    document.body.classList.remove('sidebar-collapsed')
  }
})

// Apply the saved collapse state on every shell rebuild.
applyStoredSidebarState()
window.addEventListener('DOMContentLoaded', applyStoredSidebarState)

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
              <button type="button" onclick="togglePass('login-pass',this)" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;color:#7E7E8F;cursor:pointer"><i class="fas fa-eye"></i></button>
            </div>
          </div>
          <button type="submit" class="btn btn-primary w-full" style="margin-top:4px"><i class="fas fa-sign-in-alt"></i>Sign In</button>
        </form>
        <div style="margin-top:14px;text-align:center">
          <a href="javascript:void(0)" onclick="openForgotPasswordModal()" style="font-size:12.5px;color:#C9A7FF;text-decoration:none">Forgot password?</a>
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
  // The Sign In submit IS a user gesture — kick off audio preload + warm-up
  // here while transient activation is still live. After login the user might
  // sit idle on a page; when someone else assigns them a task, the SSE-
  // triggered ding needs audio already unlocked or the first play is delayed.
  try { preloadNotifSounds() } catch {}
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
      <h3 style="display:flex;align-items:center;gap:8px"><i class="fas fa-key" style="color:#C9A7FF"></i> Set a new password</h3>
    </div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:12px">
      <div style="padding:10px 12px;border-radius:10px;background:rgba(169,112,255,.10);border:1px solid rgba(169,112,255,.35);font-size:12.5px;color:#C9A7FF;line-height:1.5">
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
  // Outside-click no longer closes silently. `tryCloseModalIfClean` checks
  // whether any input/textarea has non-empty content; if so we keep the modal
  // open (the user almost certainly clicked outside by accident). They can
  // still dismiss via the explicit ✕ / Cancel buttons.
  root.innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)tryCloseModalIfClean()"><div class="modal ${size}">${html}</div></div>`
}

// Returns true if any text input / textarea / contenteditable inside the
// current modal has a non-empty value. Hidden inputs and inputs the user
// hasn't focused yet aren't counted as "dirty".
function _modalHasInputContent() {
  const root = document.getElementById('modal-root')
  if (!root) return false
  const inputs = root.querySelectorAll('input, textarea')
  for (const el of inputs) {
    if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') continue
    if (el.type === 'checkbox' || el.type === 'radio') continue
    if (el.disabled || el.readOnly) continue
    if (el.dataset.modalDirtyIgnore === '1') continue
    const v = (el.value || '').toString().trim()
    if (v) return true
  }
  return false
}

function tryCloseModalIfClean() {
  if (!_modalHasInputContent()) {
    closeModal()
    return
  }
  // Surface a quick non-blocking nudge so the user knows the click was
  // intentional-ish — they have to use Cancel / ✕ to discard a partial form.
  if (typeof toast === 'function') {
    toast('Your changes are kept — use ✕ or Cancel to discard.', 'info', 2200)
  }
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
  // Drop the `task` param from the URL so a follow-up refresh doesn't
  // re-open the drawer for a task we just closed.
  if (window.Router?.current?.params?.task) {
    const next = { ...window.Router.current.params }
    delete next.task
    window.Router.current = { ...window.Router.current, params: next }
    if (typeof window.Router._persist === 'function') window.Router._persist()
  }
}
// Stash the currently-open task id on the URL so a refresh reopens the
// same drawer. Called from openTaskDrawer right after it kicks off the
// fetch — the drawer renders async, but the URL update is sync so the
// browser bar already shows `?task=…` while the panel is still loading.
function _persistTaskInUrl(taskId) {
  if (!window.Router?.current) return
  const params = { ...(window.Router.current.params || {}), task: taskId }
  window.Router.current = { ...window.Router.current, params }
  if (typeof window.Router._persist === 'function') window.Router._persist()
}
window._persistTaskInUrl = _persistTaskInUrl

// ── Profile Modal ─────────────────────────────────────────────
function showProfileModal() {
  const currentTheme = String(_user?.theme || 'dark').toLowerCase() === 'light' ? 'light' : 'dark'
  const role = String(_user?.role || '').toLowerCase()
  const isSalesRole = ['sales_agent', 'sales_tl', 'sales_manager'].includes(role)
  showModal(`
    <div class="modal-header"><h3>My Profile</h3><button class="close-btn" onclick="closeModal()">✕</button></div>
    <div class="modal-body" style="text-align:center">
      <div id="profile-avatar-wrap">${renderProfileAvatar()}</div>
      <div style="margin-top:14px">
        <div style="font-size:18px;font-weight:700;color:var(--text-primary,#fff)">${_user.name||_user.full_name}</div>
        <div style="font-size:13px;color:var(--text-muted,#7E7E8F);text-transform:capitalize;margin-top:2px">${_user.role} • ${_user.designation||'DevPortal'}</div>
        <div style="font-size:13px;color:var(--text-muted,#7E7E8F);margin-top:4px">${_user.email}</div>
      </div>

      <div style="margin-top:22px;padding:14px 16px;border:1px solid var(--border,rgba(179,136,255,0.12));border-radius:14px;text-align:left">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--text-primary,#fff)"><i class="fas fa-palette" style="color:#A970FF;margin-right:6px"></i>Theme</div>
            <div style="font-size:12px;color:var(--text-muted,#7E7E8F);margin-top:2px">Choose how the app looks — saved to your profile.</div>
          </div>
          <div id="theme-toggle-group" style="display:flex;gap:6px">
            <button id="theme-btn-dark" class="btn btn-sm ${currentTheme === 'dark' ? 'btn-primary' : 'btn-outline'}" onclick="onProfileSetTheme('dark')"><i class="fas fa-moon"></i> Dark</button>
            <button id="theme-btn-light" class="btn btn-sm ${currentTheme === 'light' ? 'btn-primary' : 'btn-outline'}" onclick="onProfileSetTheme('light')"><i class="fas fa-sun"></i> Light</button>
          </div>
        </div>
      </div>

      ${isSalesRole ? renderProfileMediaSection() : ''}

      <div style="margin-top:20px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="btn btn-outline" onclick="openChangePasswordModal()"><i class="fas fa-key"></i> Change Password</button>
        <button class="btn btn-danger" onclick="logout();closeModal()"><i class="fas fa-sign-out-alt"></i> Logout</button>
      </div>
    </div>`)
}

// Render the avatar (photo if uploaded, else initials disc) at the top of
// the profile modal. Kept in its own helper so the photo upload handler
// can re-render just the avatar without reopening the modal.
function renderProfileAvatar() {
  const photoUrl = _user?.photo?.url || ''
  if (photoUrl) {
    return `<div class="avatar xl" style="background:#fff;overflow:hidden"><img src="${photoUrl}" alt="Profile photo" style="width:100%;height:100%;object-fit:cover;display:block"/></div>`
  }
  return avatar(_user.name||_user.full_name, _user.avatar_color||'#A970FF','xl')
}

// Profile media block — photo, signature and supporting attachment.
// Shown only to sales roles (agent / TL / manager). Each row has a
// preview, an upload button, and a remove button. Server endpoint is
// /api/auth/profile-media which only accepts these three fields.
function renderProfileMediaSection() {
  return `
    <div style="margin-top:14px;padding:14px 16px;border:1px solid var(--border,rgba(179,136,255,0.12));border-radius:14px;text-align:left">
      <div style="font-size:13px;font-weight:700;color:var(--text-primary,#fff);margin-bottom:10px"><i class="fas fa-id-card" style="color:#A970FF;margin-right:6px"></i>Profile Media</div>
      <div style="display:flex;flex-direction:column;gap:14px">
        ${renderProfileMediaRow('photo', 'Profile Photo', 'image/*')}
        ${renderProfileMediaRow('signature', 'Signature', 'image/*')}
        ${renderProfileMediaRow('attachment', 'Attachment', '')}
      </div>
      <div style="font-size:11px;color:var(--text-muted,#7E7E8F);margin-top:10px">Photo & signature should be image files. Attachment can be any supporting document (PDF/image/doc).</div>
    </div>`
}

function renderProfileMediaRow(field, label, accept) {
  const file = _user?.[field]
  const isImage = file?.mime?.startsWith('image/') && file?.url
  let preview = ''
  if (isImage) {
    preview = `<img src="${file.url}" alt="${label}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;border:1px solid var(--border,#2B2B35);background:#fff"/>`
  } else if (file?.url) {
    preview = `<div style="width:48px;height:48px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:var(--surface-2,#1A1A22);border:1px solid var(--border,#2B2B35);color:#A970FF"><i class="fas fa-file fa-lg"></i></div>`
  } else {
    preview = `<div style="width:48px;height:48px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:var(--surface-2,#1A1A22);border:1px dashed var(--border,#2B2B35);color:var(--text-muted,#7E7E8F)"><i class="fas fa-${field === 'photo' ? 'user' : field === 'signature' ? 'signature' : 'paperclip'}"></i></div>`
  }
  const fileName = file?.name ? `<a href="${file.url}" target="_blank" rel="noopener" style="font-size:12px;color:var(--text-secondary,#9CA3AF);text-decoration:none;word-break:break-all">${escapeHtml(file.name)}</a>` : `<span style="font-size:12px;color:var(--text-muted,#7E7E8F)">Not uploaded</span>`
  return `
    <div style="display:flex;align-items:center;gap:12px">
      ${preview}
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:var(--text-primary,#fff)">${label}</div>
        <div style="margin-top:2px">${fileName}</div>
      </div>
      <input type="file" id="profile-media-input-${field}" ${accept ? `accept="${accept}"` : ''} style="display:none" onchange="onProfileMediaSelected('${field}', this)"/>
      <div style="display:flex;gap:6px">
        <button class="btn btn-xs btn-outline" onclick="document.getElementById('profile-media-input-${field}').click()"><i class="fas fa-upload"></i> ${file?.url ? 'Replace' : 'Upload'}</button>
        ${file?.url ? `<button class="btn btn-xs btn-outline" style="color:#FF5E3A" onclick="onProfileMediaRemove('${field}')"><i class="fas fa-times"></i></button>` : ''}
      </div>
    </div>`
}

async function onProfileMediaSelected(field, input) {
  const f = input?.files?.[0]
  if (!f) return
  try {
    const uploaded = await uploadProfileMediaFile(f)
    await saveProfileMedia({ [field]: uploaded })
    toast(`${field.charAt(0).toUpperCase() + field.slice(1)} updated`, 'success')
    refreshProfileMediaUI()
  } catch (e) {
    toast('Upload failed: ' + (e?.message || ''), 'error')
  } finally {
    if (input) input.value = ''
  }
}
window.onProfileMediaSelected = onProfileMediaSelected

async function onProfileMediaRemove(field) {
  try {
    await saveProfileMedia({ [field]: null })
    toast(`${field.charAt(0).toUpperCase() + field.slice(1)} removed`, 'success')
    refreshProfileMediaUI()
  } catch (e) {
    toast('Failed: ' + (e?.message || ''), 'error')
  }
}
window.onProfileMediaRemove = onProfileMediaRemove

function uploadProfileMediaFile(file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/uploads', true)
    if (_token) xhr.setRequestHeader('Authorization', 'Bearer ' + _token)
    xhr.onload = () => {
      let data = {}
      try { data = JSON.parse(xhr.responseText) } catch {}
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({
          url: data.url || data.file_url || '',
          name: data.original_name || data.name || file.name,
          mime: data.mime_type || data.mime || file.type,
          size: Number(data.size || file.size || 0),
        })
      } else {
        reject(new Error(data?.error || `HTTP ${xhr.status}`))
      }
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    const fd = new FormData()
    fd.append('file', file)
    xhr.send(fd)
  })
}

async function saveProfileMedia(patch) {
  const res = await API.patch('/auth/profile-media', patch)
  // Server returns the canonical {photo, signature, attachment} block —
  // mirror it into the cached _user so the next profile modal open and
  // any future code that reads _user.photo sees the fresh state.
  if (res && _user) {
    _user = {
      ..._user,
      photo: 'photo' in patch ? res.photo : _user.photo,
      signature: 'signature' in patch ? res.signature : _user.signature,
      attachment: 'attachment' in patch ? res.attachment : _user.attachment,
    }
    try { localStorage.setItem('devportal_user', JSON.stringify(_user)) } catch {}
  }
}

// Re-render only the affected pieces of the profile modal — the avatar
// at the top and the Profile Media block. Avoids the full reopen blink
// and keeps the user's scroll position inside the modal.
function refreshProfileMediaUI() {
  const av = document.getElementById('profile-avatar-wrap')
  if (av) av.innerHTML = renderProfileAvatar()
  // Find the profile media section by its sentinel icon class and replace
  // the whole block. Simpler than threading IDs through each row.
  const body = document.querySelector('.modal-body')
  if (!body) return
  const blocks = body.querySelectorAll('div[style*="border-radius:14px"]')
  blocks.forEach((block) => {
    if (block.querySelector('.fa-id-card')) {
      block.outerHTML = renderProfileMediaSection()
    }
  })
}

async function onProfileSetTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark'
  await setTheme(next)
  // Re-sync the toggle UI inside the modal so the highlighted button matches
  // the new state without forcing the user to reopen the modal.
  const darkBtn = document.getElementById('theme-btn-dark')
  const lightBtn = document.getElementById('theme-btn-light')
  if (darkBtn && lightBtn) {
    darkBtn.className = 'btn btn-sm ' + (next === 'dark' ? 'btn-primary' : 'btn-outline')
    lightBtn.className = 'btn btn-sm ' + (next === 'light' ? 'btn-primary' : 'btn-outline')
    darkBtn.innerHTML = '<i class="fas fa-moon"></i> Dark'
    lightBtn.innerHTML = '<i class="fas fa-sun"></i> Light'
  }
  toast(`Switched to ${next} theme`, 'success')
}
window.onProfileSetTheme = onProfileSetTheme

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
          <input id="cp-current" type="password" class="form-input" autocomplete="current-password" placeholder="••••••••" oninput="clearChangePasswordError('cp-current')"/>
          <button type="button" onclick="togglePass('cp-current',this)" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;color:#7E7E8F;cursor:pointer"><i class="fas fa-eye"></i></button>
        </div>
        <div id="cp-current-err" style="display:none;color:#FF5E3A;font-size:12px;margin-top:6px"></div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">New Password *</label>
        <div style="position:relative">
          <input id="cp-new" type="password" class="form-input" autocomplete="new-password" placeholder="At least 8 characters" oninput="clearChangePasswordError('cp-new')"/>
          <button type="button" onclick="togglePass('cp-new',this)" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;color:#7E7E8F;cursor:pointer"><i class="fas fa-eye"></i></button>
        </div>
        <div id="cp-new-err" style="display:none;color:#FF5E3A;font-size:12px;margin-top:6px"></div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">Confirm New Password *</label>
        <input id="cp-confirm" type="password" class="form-input" autocomplete="new-password" placeholder="Re-type the new password" oninput="clearChangePasswordError('cp-confirm')"/>
        <div id="cp-confirm-err" style="display:none;color:#FF5E3A;font-size:12px;margin-top:6px"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitChangePassword()"><i class="fas fa-check"></i> Update Password</button>
    </div>
  `, 'modal-md')
}

function setChangePasswordError(fieldId, msg) {
  const input = document.getElementById(fieldId)
  const err = document.getElementById(fieldId + '-err')
  if (input) input.style.borderColor = '#FF5E3A'
  if (err) { err.textContent = msg; err.style.display = 'block' }
}

function clearChangePasswordError(fieldId) {
  const input = document.getElementById(fieldId)
  const err = document.getElementById(fieldId + '-err')
  if (input) input.style.borderColor = ''
  if (err) { err.textContent = ''; err.style.display = 'none' }
}

function clearAllChangePasswordErrors() {
  ;['cp-current', 'cp-new', 'cp-confirm'].forEach(clearChangePasswordError)
}

async function submitChangePassword() {
  const cur = document.getElementById('cp-current')?.value || ''
  const next = document.getElementById('cp-new')?.value || ''
  const confirm = document.getElementById('cp-confirm')?.value || ''
  clearAllChangePasswordErrors()
  if (!cur) { setChangePasswordError('cp-current', 'Current password is required'); toast('All fields are required', 'error'); return }
  if (!next) { setChangePasswordError('cp-new', 'New password is required'); toast('All fields are required', 'error'); return }
  if (!confirm) { setChangePasswordError('cp-confirm', 'Please confirm the new password'); toast('All fields are required', 'error'); return }
  if (next !== confirm) { setChangePasswordError('cp-confirm', 'New passwords do not match'); toast('New passwords do not match', 'error'); return }
  if (cur === next) { setChangePasswordError('cp-new', 'New password must differ from current'); toast('New password must differ from current', 'error'); return }
  try {
    await API.post('/auth/change-password', { current_password: cur, new_password: next })
    toast('Password updated', 'success')
    closeModal()
  } catch (e) {
    const msg = e.message || 'Failed'
    if (/current password/i.test(msg)) {
      setChangePasswordError('cp-current', msg)
    } else if (/new password/i.test(msg)) {
      setChangePasswordError('cp-new', msg)
    } else {
      setChangePasswordError('cp-current', msg)
    }
    toast(msg, 'error')
  }
}

// ── Notifications panel ───────────────────────────────────────
function _notifIcon(type) {
  const map = {
    ticket_created:        { icon: 'fa-ticket', color: '#A970FF' },
    ticket_assigned:       { icon: 'fa-user-check', color: '#C56FE6' },
    ticket_status:         { icon: 'fa-circle-half-stroke', color: '#B388FF' },
    ticket_priority:       { icon: 'fa-flag', color: '#C9A7FF' },
    ticket_comment:        { icon: 'fa-message', color: '#B388FF' },
    ticket_internal_note:  { icon: 'fa-lock', color: '#C9A7FF' },
    bid_opened:            { icon: 'fa-gavel', color: '#C9A7FF' },
    bid_placed:            { icon: 'fa-coins', color: '#C9A7FF' },
    bid_awarded:           { icon: 'fa-trophy', color: '#86E0A8' },
    leave_request:           { icon: 'fa-umbrella-beach', color: '#B388FF' },
    leave_approved:          { icon: 'fa-check-circle', color: '#86E0A8' },
    leave_rejected:          { icon: 'fa-times-circle', color: '#A970FF' },
    password_reset_request:  { icon: 'fa-key', color: '#C9A7FF' },
    password_reset_done:     { icon: 'fa-key', color: '#86E0A8' },
    project_assignment_needed: { icon: 'fa-user-tag', color: '#C9A7FF' },
  }
  return map[type] || { icon: 'fa-bell', color: '#C9A7FF' }
}

function _notifTimeAgo(iso) {
  if (!iso) return ''
  return timeAgo(iso)
}

function _notifEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// Notification panel default: show ONLY unread items so the bell isn't a
// graveyard of old "meeting starting soon" pings the user already saw.
// `window._notifShowAll` flips to true when the user clicks "View history".
window._notifShowAll = window._notifShowAll || false

async function showNotifications() {
  try {
    // Wake the audio context (browsers require a user gesture before sound plays)
    if (_notifState.audioCtx?.state === 'suspended') _notifState.audioCtx.resume().catch(() => {})

    const data = await API.get('/notifications/me?limit=50')
    const all = data.notifications || data.data || []
    const items = window._notifShowAll ? all : all.filter((n) => !n.is_read)
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

    const readCount = all.filter((n) => n.is_read).length
    const summary = window._notifShowAll
      ? `${data.unread_count || 0} unread · ${all.length} total`
      : `${data.unread_count || 0} unread`
    const toggleLabel = window._notifShowAll
      ? '<i class="fas fa-bell"></i> Show unread only'
      : `<i class="fas fa-clock-rotate-left"></i> View history${readCount ? ' (' + readCount + ')' : ''}`
    const emptyMsg = window._notifShowAll ? 'No notifications yet.' : 'You are all caught up — no unread notifications.'

    showModal(`
      <div class="modal-header">
        <h3><i class="fas fa-bell" style="margin-right:6px"></i> Notifications</h3>
        <button class="close-btn" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body" style="padding:0">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text-muted);flex-wrap:wrap">
          <span id="notif-panel-summary">${summary}</span>
          <div style="display:flex;gap:6px;align-items:center">
            <button class="btn btn-xs btn-outline" onclick="toggleNotifHistory()">${toggleLabel}</button>
            ${items.some((n) => !n.is_read) ? '<button id="notif-mark-all-btn" class="btn btn-xs btn-outline" onclick="markAllNotifsRead()"><i class="fas fa-check-double"></i> Mark all read</button>' : ''}
          </div>
        </div>
        <div class="notif-list">
          ${items.length ? itemsHtml : `<div class="empty-state" style="padding:36px 18px"><i class="fas fa-bell-slash"></i><p>${emptyMsg}</p></div>`}
        </div>
      </div>
    `, 'modal-lg')

    // Auto-mark-all-read on open: same Slack-style pattern as before, but
    // the panel now shows only unread by default so they vanish after
    // the read flip — no more lingering "you already saw this" rows.
    const hasUnread = items.some((n) => !n.is_read)
    if (hasUnread) {
      API.post('/notifications/read-all', {}).catch(() => {})
      // Opening the panel + the auto-read-all counts as the user
      // acknowledging every pending broadcast — silence the buzz loop and
      // tear down any open announcement modal so we don't double-up UI.
      _broadcastBuzzStop()
      _broadcastModal.queue = []
      if (_broadcastModal.active) {
        _broadcastModalCloseHost()
        _broadcastModal.active = null
      }
      _notifSetBadge(0)
      document.querySelectorAll('.notif-row.is-unread').forEach((row) => {
        row.classList.remove('is-unread')
        row.querySelector('.notif-row-dot')?.remove()
      })
      document.getElementById('notif-mark-all-btn')?.remove()
      // Don't strip the rows from the DOM while the panel is open — the user
      // may still want to click them to navigate. Just update the count.
      const summaryEl = document.getElementById('notif-panel-summary')
      if (summaryEl) summaryEl.textContent = window._notifShowAll
        ? `0 unread · ${all.length} total`
        : '0 unread'
    }
  } catch (e) {
    toast('Failed to load notifications: ' + e.message, 'error')
  }
}

// Flip between "unread only" (default) and "history" views, then re-open
// the panel so the new filter takes effect.
function toggleNotifHistory() {
  window._notifShowAll = !window._notifShowAll
  showNotifications()
}

async function onNotifClick(id, link) {
  // Optimistic UI update: clear unread look from the row right away
  const row = document.querySelector(`.notif-row[data-id="${CSS.escape(id)}"]`)
  if (row) {
    row.classList.remove('is-unread')
    row.querySelector('.notif-row-dot')?.remove()
  }
  // Stop the broadcast buzz + tear down the announcement modal for this
  // specific notification (no-op if it's not a broadcast or wasn't open).
  // Acknowledge = the user saw + clicked.
  _broadcastBuzzStop(id)
  _broadcastModalDismiss(id)
  try { await API.post(`/notifications/${id}/read`, {}) } catch {}
  // Update badges immediately
  if (_notifState.unreadCount > 0) _notifSetBadge(Math.max(0, _notifState.unreadCount - 1))
  pollNotifications()
  if (!(link && typeof link === 'string')) return
  // Route by link prefix → open the right page/drawer.
  // Format: "<kind>:<id>" e.g. "task:abc123", "lead:xyz".
  const [kind, ...rest] = link.split(':')
  const entityId = rest.join(':')
  if (!kind || !entityId) return
  closeModal()
  switch (kind) {
    case 'task':
      if (typeof openTaskDrawer === 'function') openTaskDrawer(entityId)
      else Router.navigate('my-tasks')
      break
    case 'ptask': // personal task
      Router.navigate('personal-tasks')
      break
    case 'lead':
      if (window.Router?.navigate) Router.navigate('lead-detail', { id: entityId })
      break
    case 'ticket':
      if (typeof openSupportDetail === 'function') openSupportDetail(entityId)
      else Router.navigate('support-tickets')
      break
    case 'meeting':
      Router.navigate('meet-setup')
      break
    case 'project':
      if (typeof openProjectBoard === 'function') openProjectBoard(entityId, '')
      else Router.navigate('projects-list')
      break
    case 'leave':
      Router.navigate('leaves-view')
      break
    case 'invoice':
      Router.navigate('billing-admin')
      break
    case 'bid':
      Router.navigate('bidding-view')
      break
    case 'pip':
      Router.navigate('hr-pips')
      break
    case 'warning':
      Router.navigate('hr-warnings')
      break
    case 'salary':
      Router.navigate('hr-salary-slips')
      break
    case 'user':
      Router.navigate('team-overview')
      break
    case 'broadcast':
      // Broadcast notifications carry `broadcast:<id>` — there's no detail
      // view for a single broadcast (they're one-shot announcements), so we
      // jump to the history page which lists every broadcast the role can see.
      if (typeof canSeePage === 'function' && canSeePage('broadcasts-view')) {
        Router.navigate('broadcasts-view')
      }
      break
    default:
      // Unknown link type — leave the panel closed; user can navigate manually.
      break
  }
}

async function markAllNotifsRead() {
  try {
    await API.post('/notifications/read-all', {})
    // "Mark all read" acknowledges every pending broadcast at once — clear
    // the buzz loop AND tear down any open announcement modal + queued ones.
    _broadcastBuzzStop()
    _broadcastModal.queue = []
    if (_broadcastModal.active) {
      _broadcastModalCloseHost()
      _broadcastModal.active = null
    }
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
// Strategy: fetch each entity list at most once per session (warmed on the
// first focus/keystroke), cache it for 60s, and filter in-memory on every
// keystroke so the dropdown re-renders in ~1ms instead of waiting on the
// network. A stale cache is refreshed silently in the background so the
// user never sees a "Searching…" spinner after the first warm-up.
const SEARCH_CACHE_TTL_MS = 60_000
let _searchCache = null            // { data, fetchedAt }
let _searchCachePromise = null     // in-flight fetch promise (dedupe)
let _searchRenderRaf = 0           // RAF id for coalescing renders

function _searchPerms() {
  const can = (page) => (typeof canSeePage === 'function' ? canSeePage(page) : true)
  return {
    canTasks:    can('kanban-board') || can('my-tasks'),
    canProjects: can('projects-list'),
    canClients:  can('clients-list'),
    canLeads:    can('leads-view'),
    canInvoices: can('billing-admin'),
    canDocs:     can('documents-center'),
    canTickets:  can('support-tickets'),
    canPTasks:   can('personal-tasks'),
  }
}

function _searchFetch() {
  if (_searchCachePromise) return _searchCachePromise
  const p = _searchPerms()
  const empty = (k) => Promise.resolve({ [k]: [] })
  _searchCachePromise = Promise.all([
    p.canTasks    ? API.get('/tasks').catch(() => ({ tasks: [] }))           : empty('tasks'),
    p.canProjects ? API.get('/projects').catch(() => ({ projects: [] }))     : empty('projects'),
    p.canClients  ? API.get('/clients').catch(() => ({ clients: [] }))       : empty('clients'),
    p.canLeads    ? API.get('/leads').catch(() => ({ leads: [] }))           : empty('leads'),
    p.canInvoices ? API.get('/invoices').catch(() => ({ invoices: [] }))     : empty('invoices'),
    p.canDocs     ? API.get('/documents').catch(() => ({ documents: [] }))   : empty('documents'),
    p.canTickets  ? API.get('/support').catch(() => ({ tickets: [] }))       : empty('tickets'),
    p.canPTasks   ? API.get('/personal-tasks').catch(() => ({ tasks: [] })) : empty('tasks'),
  ]).then(([tasks, projects, clients, leads, invoices, documents, tickets, ptasks]) => {
    const data = {
      tasks:     tasks.tasks       || tasks.data     || [],
      projects:  projects.projects || projects.data  || [],
      clients:   clients.clients   || clients.data   || [],
      leads:     leads.leads       || leads.data     || [],
      invoices:  invoices.invoices || invoices.data  || [],
      documents: documents.documents || documents.data || [],
      tickets:   tickets.tickets   || tickets.data   || [],
      ptasks:    ptasks.tasks      || ptasks.data    || [],
      perms:     p,
    }
    _searchCache = { data, fetchedAt: Date.now() }
    _searchCachePromise = null
    return data
  }).catch((e) => {
    _searchCachePromise = null
    throw e
  })
  return _searchCachePromise
}

// Kick off a background fetch when the user focuses the search bar so by the
// time they finish typing the first 2 chars the cache is already warm.
function primeGlobalSearch() {
  const fresh = _searchCache && (Date.now() - _searchCache.fetchedAt) < SEARCH_CACHE_TTL_MS
  if (!fresh && !_searchCachePromise) { _searchFetch().catch(() => {}) }
}
window.primeGlobalSearch = primeGlobalSearch

function _renderSearchResults(q) {
  const dd = document.getElementById('global-search-results')
  if (!dd || !_searchCache) return
  const { data } = _searchCache
  const { perms } = data
  const ql = q.toLowerCase()
  const inc = (s) => String(s || '').toLowerCase().includes(ql)
  const matchT  = data.tasks.filter(t => inc(t.title) || inc(t.id)).slice(0, 6)
  const matchP  = data.projects.filter(p => inc(p.name) || inc(p.code)).slice(0, 5)
  const matchC  = data.clients.filter(c => inc(c.company_name) || inc(c.contact_name) || inc(c.email)).slice(0, 5)
  const matchL  = data.leads.filter(l => inc(l.name) || inc(l.email) || inc(l.phone)).slice(0, 5)
  const matchI  = data.invoices.filter(i => inc(i.invoice_number) || inc(i.title) || inc(i.company_name)).slice(0, 5)
  const matchD  = data.documents.filter(d => inc(d.title) || inc(d.file_name)).slice(0, 5)
  const matchTk = data.tickets.filter(t => inc(t.title) || inc(t.subject) || inc(t.id)).slice(0, 5)
  const matchPT = data.ptasks.filter(t => inc(t.title)).slice(0, 5)

  const total = matchT.length + matchP.length + matchC.length + matchL.length + matchI.length + matchD.length + matchTk.length + matchPT.length
  if (!total) {
    dd.innerHTML = `<div style="padding:18px;text-align:center;color:var(--text-muted);font-size:13px">No matches for "${escapeHtml(q)}"</div>`
    return
  }

  const escapeAttr = (s) => String(s || '').replace(/'/g, "\\'")
  const ttl = (kind, count) => `<div style="padding:8px 14px 4px;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.6px;display:flex;justify-content:space-between"><span>${kind}</span><span style="color:#A970FF">${count}</span></div>`
  const row = (icon, color, primary, secondary, onClickAttr) => `
    <div class="search-result-row" onmousedown="event.preventDefault()" onclick="hideGlobalSearch();${onClickAttr}" style="display:flex;align-items:center;gap:10px;padding:9px 14px;cursor:pointer;border-bottom:1px solid var(--border-soft,rgba(255,255,255,.04))">
      <i class="fas ${icon}" style="color:${color};font-size:13px;width:18px;text-align:center"></i>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${primary}</div>
        <div style="font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${secondary}</div>
      </div>
    </div>`

  const rows = []
  if (perms.canProjects && matchP.length) {
    rows.push(ttl('Projects', matchP.length))
    for (const p of matchP) rows.push(row('fa-folder', '#A970FF',
      escapeHtml((typeof tc==='function'?tc(p.name):p.name) || ''),
      `${escapeHtml(p.code || '')} · ${escapeHtml(p.status || '')}`,
      `openProjectBoard('${escapeAttr(p.id)}','${escapeAttr(p.name)}')`))
  }
  if (perms.canTasks && matchT.length) {
    rows.push(ttl('Project Tasks', matchT.length))
    for (const t of matchT) rows.push(row('fa-check-square', '#C56FE6',
      escapeHtml(t.title || ''),
      `${escapeHtml((typeof tc==='function'?tc(t.project_name||''):t.project_name) || '')} · ${escapeHtml((t.status || '').replace(/_/g,' '))}`,
      `openTaskDrawer('${escapeAttr(t.id)}')`))
  }
  if (perms.canPTasks && matchPT.length) {
    rows.push(ttl('My Task', matchPT.length))
    for (const t of matchPT) rows.push(row('fa-clipboard-check', '#a855f7',
      escapeHtml(t.title || ''),
      `${escapeHtml(t.assigned_to_name || 'Unassigned')} · ${escapeHtml((t.status || '').replace(/_/g,' '))}`,
      `Router.navigate('personal-tasks')`))
  }
  if (perms.canClients && matchC.length) {
    rows.push(ttl('Clients', matchC.length))
    for (const c of matchC) rows.push(row('fa-building', '#58C68A',
      escapeHtml(c.company_name || c.contact_name || ''),
      `${escapeHtml(c.email || '')} · ${escapeHtml(c.city || '')}`,
      `Router.navigate('clients-list')`))
  }
  if (perms.canLeads && matchL.length) {
    rows.push(ttl('Leads', matchL.length))
    for (const l of matchL) rows.push(row('fa-bullseye', '#C9A7FF',
      escapeHtml(l.name || ''),
      `${escapeHtml(l.email || '')} · ${escapeHtml(l.phone || '')} · ${escapeHtml(l.status || '')}`,
      `Router.navigate('lead-detail', { id: '${escapeAttr(l.id)}' })`))
  }
  if (perms.canInvoices && matchI.length) {
    rows.push(ttl('Invoices', matchI.length))
    for (const i of matchI) rows.push(row('fa-file-invoice-dollar', '#58C68A',
      escapeHtml(i.invoice_number || i.title || ''),
      `${escapeHtml(i.company_name || '')} · ${escapeHtml((i.status || '').replace(/_/g,' '))}`,
      `Router.navigate('billing-admin')`))
  }
  if (perms.canDocs && matchD.length) {
    rows.push(ttl('Documents', matchD.length))
    for (const d of matchD) rows.push(row('fa-file-lines', '#A8C8FF',
      escapeHtml(d.title || d.file_name || ''),
      `${escapeHtml((typeof tc==='function'?tc(d.project_name||''):d.project_name) || '')} · ${escapeHtml(d.category || '')}`,
      `Router.navigate('documents-center')`))
  }
  if (perms.canTickets && matchTk.length) {
    rows.push(ttl('Support Tickets', matchTk.length))
    for (const t of matchTk) {
      const tid = escapeAttr(t.id)
      rows.push(row('fa-life-ring', '#FF5E3A',
        escapeHtml(t.title || t.subject || ''),
        `${escapeHtml((t.status || '').replace(/_/g,' '))} · #${escapeHtml(String(t.id || '').slice(-6))}`,
        `(typeof openSupportDetail==='function'?openSupportDetail('${tid}'):Router.navigate('support-tickets'))`))
    }
  }
  dd.innerHTML = rows.join('')
}

function globalSearch(q) {
  const dd = document.getElementById('global-search-results')
  if (!dd) return
  if (!q || q.length < 2) {
    dd.style.display = 'none'
    dd.innerHTML = ''
    return
  }
  dd.style.display = 'block'
  const fresh = _searchCache && (Date.now() - _searchCache.fetchedAt) < SEARCH_CACHE_TTL_MS
  if (fresh) {
    // Hot path: cache is warm, just filter and render — runs in well under
    // a millisecond for typical dataset sizes. Coalesce to one render per
    // animation frame so rapid typing doesn't queue up redundant work.
    if (_searchRenderRaf) cancelAnimationFrame(_searchRenderRaf)
    _searchRenderRaf = requestAnimationFrame(() => { _searchRenderRaf = 0; _renderSearchResults(q) })
    // Stale check while warm — if cache is in its last 10s, kick off a
    // background refresh so future keystrokes stay instant.
    if (Date.now() - _searchCache.fetchedAt > SEARCH_CACHE_TTL_MS - 10_000 && !_searchCachePromise) {
      _searchFetch().then(() => _renderSearchResults(q)).catch(() => {})
    }
    return
  }
  // Cold path: first search of the session (or cache expired). Show the
  // spinner only this once; subsequent keystrokes hit the warm cache.
  dd.innerHTML = `<div style="padding:14px;color:var(--text-muted);font-size:13px"><i class="fas fa-spinner fa-spin"></i> Searching…</div>`
  _searchFetch().then(() => _renderSearchResults(q)).catch((e) => {
    dd.innerHTML = `<div style="padding:14px;color:#FF5E3A;font-size:13px">Search failed: ${escapeHtml(e.message || 'error')}</div>`
  })
}
function invalidateGlobalSearchCache() {
  _searchCache = null
  _searchCachePromise = null
}
window.invalidateGlobalSearchCache = invalidateGlobalSearchCache
function hideGlobalSearch() {
  const dd = document.getElementById('global-search-results')
  const inp = document.getElementById('global-search')
  if (dd) { dd.style.display = 'none'; dd.innerHTML = '' }
  if (inp) inp.value = ''
}
window.hideGlobalSearch = hideGlobalSearch

// ── Page loader dispatcher ────────────────────────────────────
function loadPage(page, el) {
  switch(page) {
    case 'super-dashboard':  renderSuperDashboard(el); break
    case 'broadcasts-view':  renderBroadcastsView(el); break
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
    case 'external-team':    renderExternalTeam(el); break
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
    case 'hr-attendance':    renderAttendanceView(el); break
    case 'hr-calendar':      renderHRCalendarView(el); break
    case 'hr-warnings':      renderWarningsView(el); break
    case 'hr-pips':          renderPipsView(el); break
    case 'hr-salary-slips':  renderSalarySlipsView(el); break
    case 'hr-terminations':  renderTerminationsView(el); break
    case 'hr-documents':     renderHrDocumentsView(el); break
    case 'hr-assets':        renderHrAssetsView(el); break
    case 'hr-team':          renderHRTeamPage(el); break
    case 'personal-tasks':   renderPersonalTasksPage(el); break
    case 'settings-view':    renderSettingsView(el); break
    default: el.innerHTML = `<div class="page-header"><h1 class="page-title">${breadcrumbMap[page]||page}</h1></div><div class="empty-state"><i class="fas fa-hammer"></i><p>Module coming soon…</p></div>`
  }
}

// ── Init ──────────────────────────────────────────────────────
function resolveInitialRoute() {
  let page = null
  let params = {}
  // 1) Hash route wins (e.g. #/clients-list or #/kanban-board?id=xxx)
  // The hash encodes both page and params so refresh restores the full route
  // even if sessionStorage gets cleared.
  const hashMatch = (location.hash || '').match(/^#\/([\w-]+)(\?(.*))?/)
  if (hashMatch) {
    page = hashMatch[1]
    const qs = hashMatch[3] || ''
    if (qs) {
      for (const part of qs.split('&')) {
        const [k, v = ''] = part.split('=')
        if (k) {
          try { params[decodeURIComponent(k)] = decodeURIComponent(v) }
          catch { params[k] = v }
        }
      }
    }
  }
  // 2) sessionStorage fallback — also survives refresh and restores params
  // for parameterized routes like lead-detail.
  try {
    const cached = JSON.parse(sessionStorage.getItem('pmp_current_page') || 'null')
    if (cached?.page) {
      if (!page) page = cached.page
      if (page === cached.page && cached.params) {
        // Merge: hash params take precedence (they're more visible/shareable),
        // sessionStorage fills in anything missing.
        params = { ...cached.params, ...params }
      }
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

  // Paint the right theme as the very first thing — before login or any page
  // render — so we never flash the wrong colour scheme on reload.
  applyCachedTheme()

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
          // Preserve params (e.g. ?id=projXYZ) when re-navigating to the same
          // page — without this, refreshing on a deep route (kanban board for
          // a specific project) drops the project id and bounces to the picker
          // or, if canSeePage fails, all the way to defaultPage(). The latter
          // was making refresh on Kanban land users on Projects.
          const stayOnInitial = canSeePage(initialPage)
          const next = stayOnInitial ? initialPage : defaultPage()
          const nextParams = stayOnInitial ? (initialRoute.params || {}) : {}
          Router.navigate(next, nextParams)
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
