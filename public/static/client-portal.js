// ═══════════════════════════════════════════════════════════
// client-portal.js  – Full Client Portal (signup/login/dashboard)
// ═══════════════════════════════════════════════════════════

const CLIENT_BASE = '/api'

const ClientAPI = {
  get headers() {
    const h = { 'Content-Type': 'application/json' }
    if (_token) h['Authorization'] = 'Bearer ' + _token
    return h
  },
  async req(method, url, body) {
    const opts = { method, headers: this.headers }
    if (body) opts.body = JSON.stringify(body)
    const r = await fetch(CLIENT_BASE + url, opts)
    const data = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
    return data
  },
  get: (u, opts = {}) => ClientAPI.req('GET', buildUrl(u, opts?.params)),
  post: (u, b) => ClientAPI.req('POST', u, b),
  patch: (u, b) => ClientAPI.req('PATCH', u, b),
}

/* ═══ CLIENT PORTAL ENTRY POINT ═══════════════════════════ */
function renderClientPortal() {
  document.body.innerHTML = `
  <div id="client-app" class="bg-[#0a0a1a] text-gray-100 min-h-screen font-sans antialiased"></div>`
  const app = document.getElementById('client-app')

  if (!_token || !_user || _user.role !== 'client') {
    renderClientLogin(app)
  } else {
    renderClientMain(app)
  }
}

/* ═══ CLIENT LOGIN PAGE ═══════════════════════════════════ */
function renderClientLogin(container) {
  container.innerHTML = `
  <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#0a0a1a 0%,#111128 50%,#0a0a1a 100%)">
    <!-- Decorative background -->
    <div style="position:fixed;top:-100px;left:-100px;width:500px;height:500px;background:radial-gradient(circle,rgba(99,102,241,.12) 0%,transparent 70%);pointer-events:none"></div>
    <div style="position:fixed;bottom:-100px;right:-100px;width:500px;height:500px;background:radial-gradient(circle,rgba(6,182,212,.08) 0%,transparent 70%);pointer-events:none"></div>

    <div style="width:100%;max-width:460px;padding:24px">
      <!-- Logo -->
      <div style="text-align:center;margin-bottom:32px">
        <div style="width:56px;height:56px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;box-shadow:0 0 30px rgba(99,102,241,.3)">
          <i class="fas fa-rocket" style="font-size:24px;color:#fff"></i>
        </div>
        <h1 style="font-size:24px;font-weight:700;color:#e2e8f0;margin:0">Mariox DevPortal</h1>
        <p style="font-size:13px;color:#64748b;margin-top:4px">Client Portal – Secure Access</p>
      </div>

      <!-- Tab switcher -->
      <div style="display:flex;background:#111128;border-radius:10px;padding:4px;margin-bottom:24px;border:1px solid #1e1e45">
        <button id="tab-login" onclick="switchClientTab('login')" style="flex:1;padding:8px;border-radius:7px;border:none;cursor:pointer;font-size:13px;font-weight:600;transition:.2s;background:#6366f1;color:#fff">Sign In</button>
        <button id="tab-signup" onclick="switchClientTab('signup')" style="flex:1;padding:8px;border-radius:7px;border:none;cursor:pointer;font-size:13px;font-weight:500;background:transparent;color:#94a3b8">Register</button>
      </div>

      <!-- Login Form -->
      <div id="form-login" class="card" style="padding:28px">
        <h2 style="font-size:18px;font-weight:600;color:#e2e8f0;margin:0 0 4px">Welcome back</h2>
        <p style="font-size:12px;color:#64748b;margin:0 0 24px">Access your project portal</p>
        <form onsubmit="doClientLogin();return false;" autocomplete="on">
        <div class="form-group">
          <label class="form-label">Email Address</label>
          <input class="form-input" id="cl-email" type="email" placeholder="your@company.com" autocomplete="email"/>
        </div>
        <div class="form-group">
          <label class="form-label">Password</label>
          <div style="position:relative">
            <input class="form-input" id="cl-pass" type="password" placeholder="••••••••" autocomplete="current-password" style="padding-right:44px"/>
            <button type="button" onclick="togglePwd('cl-pass',this)" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:#64748b;cursor:pointer;padding:4px"><i class="fas fa-eye"></i></button>
          </div>
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%;margin-top:8px">
          <i class="fas fa-sign-in-alt"></i> Sign In to Portal
        </button>
        </form>
        <div style="margin-top:16px;text-align:center;font-size:12px;color:#64748b">
          Demo: <strong style="color:#94a3b8">admin@growniq.com</strong> / <strong style="color:#94a3b8">Password@123</strong>
        </div>
      </div>

      <!-- Signup Form -->
      <div id="form-signup" class="card" style="padding:28px;display:none">
        <h2 style="font-size:18px;font-weight:600;color:#e2e8f0;margin:0 0 4px">Create Account</h2>
        <p style="font-size:12px;color:#64748b;margin:0 0 24px">Register to access your project portal</p>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Contact Name *</label>
            <input class="form-input" id="cs-name" placeholder="John Doe"/>
          </div>
          <div class="form-group">
            <label class="form-label">Company Name *</label>
            <input class="form-input" id="cs-company" placeholder="Acme Corp"/>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Work Email *</label>
          <input class="form-input" id="cs-email" type="email" placeholder="john@acme.com"/>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Password *</label>
            <input class="form-input" id="cs-pass" type="password" placeholder="••••••••"/>
          </div>
          <div class="form-group">
            <label class="form-label">Phone</label>
            <input class="form-input" id="cs-phone" placeholder="+91 98765 43210"/>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Industry</label>
            <select class="form-select" id="cs-industry">
              <option value="">Select Industry</option>
              <option>Technology</option><option>Healthcare</option><option>Finance</option>
              <option>Retail</option><option>Education</option><option>Manufacturing</option><option>Other</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Website</label>
            <input class="form-input" id="cs-website" placeholder="https://acme.com"/>
          </div>
        </div>
        <button type="button" class="btn btn-primary" style="width:100%;margin-top:8px" onclick="doClientSignup()">
          <i class="fas fa-user-plus"></i> Create Account
        </button>
      </div>

      <p style="text-align:center;font-size:11px;color:#334155;margin-top:20px">
        <i class="fas fa-lock" style="margin-right:4px"></i>Secured by Mariox DevPortal • SOC 2 Compliant
      </p>
    </div>
  </div>`
}

function switchClientTab(tab) {
  document.getElementById('form-login').style.display = tab === 'login' ? 'block' : 'none'
  document.getElementById('form-signup').style.display = tab === 'signup' ? 'block' : 'none'
  document.getElementById('tab-login').style.background = tab === 'login' ? '#6366f1' : 'transparent'
  document.getElementById('tab-login').style.color = tab === 'login' ? '#fff' : '#94a3b8'
  document.getElementById('tab-signup').style.background = tab === 'signup' ? '#6366f1' : 'transparent'
  document.getElementById('tab-signup').style.color = tab === 'signup' ? '#fff' : '#94a3b8'
}

function togglePwd(inputId, btn) {
  const inp = document.getElementById(inputId)
  if (inp.type === 'password') { inp.type = 'text'; btn.innerHTML = '<i class="fas fa-eye-slash"></i>' }
  else { inp.type = 'password'; btn.innerHTML = '<i class="fas fa-eye"></i>' }
}

async function doClientLogin() {
  const email = document.getElementById('cl-email')?.value.trim()
  const password = document.getElementById('cl-pass')?.value
  if (!email || !password) return toast('Email and password required', 'error')
  const btn = document.querySelector('#form-login .btn-primary')
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing in…' }
  try {
    const data = await ClientAPI.post('/client-auth/login', { email, password })
    saveAuth(data.token, { ...data.client, role: 'client' })
    toast('Welcome back, ' + data.client.contact_name + '!', 'success')
    setTimeout(() => renderClientPortal(), 400)
  } catch(e) {
    toast(e.message, 'error')
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In to Portal' }
  }
}

async function doClientSignup() {
  const body = {
    email: document.getElementById('cs-email').value.trim(),
    password: document.getElementById('cs-pass').value,
    company_name: document.getElementById('cs-company').value.trim(),
    contact_name: document.getElementById('cs-name').value.trim(),
    phone: document.getElementById('cs-phone').value.trim() || undefined,
    website: document.getElementById('cs-website').value.trim() || undefined,
    industry: document.getElementById('cs-industry').value || undefined,
  }
  if (!body.email || !body.password || !body.company_name || !body.contact_name)
    return toast('Email, password, company name, and contact name are required', 'error')
  if (body.password.length < 8) return toast('Password must be at least 8 characters', 'error')
  const btn = document.querySelector('#form-signup .btn-primary')
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating…' }
  try {
    const data = await ClientAPI.post('/client-auth/signup', body)
    saveAuth(data.token, { ...data.client, role: 'client' })
    toast('Account created! Welcome, ' + data.client.contact_name + '!', 'success')
    setTimeout(() => renderClientPortal(), 400)
  } catch(e) {
    toast(e.message, 'error')
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-user-plus"></i> Create Account' }
  }
}

/* ═══ CLIENT MAIN APP ═════════════════════════════════════ */
let _clientPage = 'cp-dashboard'
let _clientHistory = []
let _clientData = { projects: [], invoices: [], documents: [], notifications: [] }
let _clientProjectsPage = 1
let _clientMilestonesPage = 1
let _clientDocumentsPage = 1
let _clientActivityPage = 1
let _clientInvoicePage = 1
const _clientInvoiceLimit = 10
const _clientProjectsLimit = 6
const _clientMilestonesLimit = 6
const _clientDocumentsLimit = 8
const _clientActivityLimit = 8

async function renderClientMain(container) {
  _clientProjectsPage = 1
  _clientMilestonesPage = 1
  _clientDocumentsPage = 1
  _clientActivityPage = 1
  _clientInvoicePage = 1
  container.innerHTML = `
  <div style="display:flex;min-height:100vh">
    <!-- Sidebar -->
    <aside id="cp-sidebar" style="width:240px;flex-shrink:0;background:#0d0d24;border-right:1px solid #1e1e45;display:flex;flex-direction:column;position:fixed;top:0;left:0;height:100vh;z-index:100;transition:.3s">
      <!-- Logo -->
      <div style="padding:20px 16px;border-bottom:1px solid #1e1e45">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:32px;height:32px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <i class="fas fa-rocket" style="font-size:14px;color:#fff"></i>
          </div>
          <div>
            <div style="font-size:13px;font-weight:700;color:#e2e8f0">DevPortal</div>
            <div style="font-size:10px;color:#64748b">Client Access</div>
          </div>
        </div>
      </div>
      <!-- Client info -->
      <div style="padding:14px 16px;border-bottom:1px solid #1e1e45">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:34px;height:34px;border-radius:50%;background:${_user.avatar_color||'#6366f1'};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff;flex-shrink:0">${(_user.contact_name||_user.name||'C').split(' ').map(p=>p[0]).join('').substring(0,2).toUpperCase()}</div>
          <div style="min-width:0">
            <div style="font-size:12px;font-weight:600;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_user.contact_name||_user.name||'Client'}</div>
            <div style="font-size:10px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_user.company_name||_user.company||''}</div>
          </div>
        </div>
      </div>
      <!-- Nav -->
      <nav style="flex:1;overflow-y:auto;padding:12px 8px">
        ${cpNavItem('cp-dashboard','fa-chart-line','Dashboard')}
        ${cpNavItem('cp-projects','fa-layer-group','My Projects')}
        ${cpNavItem('cp-kanban','fa-columns','Task Board')}
        ${cpNavItem('cp-milestones','fa-flag','Milestones')}
        ${cpNavItem('cp-documents','fa-folder-open','Documents')}
        ${cpNavItem('cp-invoices','fa-file-invoice-dollar','Invoices & Billing')}
        ${cpNavItem('cp-activity','fa-bell','Activity Feed')}
        ${cpNavItem('cp-profile','fa-user-cog','My Profile')}
      </nav>
      <div style="padding:12px 8px;border-top:1px solid #1e1e45">
        <button onclick="clientLogout()" style="width:100%;padding:8px 12px;border-radius:7px;background:transparent;border:1px solid #1e1e45;color:#64748b;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:8px;transition:.2s" onmouseover="this.style.background='#1a1a38';this.style.color='#f43f5e'" onmouseout="this.style.background='transparent';this.style.color='#64748b'">
          <i class="fas fa-sign-out-alt"></i>Sign Out
        </button>
      </div>
    </aside>

    <!-- Main Content -->
    <div style="flex:1;margin-left:240px;display:flex;flex-direction:column;min-height:100vh">
      <!-- Top bar -->
      <header style="background:#111128;border-bottom:1px solid #1e1e45;padding:0 24px;height:56px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:50">
        <div style="display:flex;align-items:center;gap:12px">
          <button id="cp-back-btn" onclick="cpBack()" style="display:none;width:36px;height:36px;border-radius:8px;background:transparent;border:1px solid #1e1e45;color:#94a3b8;cursor:pointer;align-items:center;justify-content:center;font-size:14px"><i class="fas fa-arrow-left"></i></button>
          <h2 id="cp-page-title" style="font-size:16px;font-weight:600;color:#e2e8f0;margin:0">Dashboard</h2>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <button id="cp-notif-btn" onclick="toggleCpNotifications()" style="width:36px;height:36px;border-radius:8px;background:transparent;border:1px solid #1e1e45;color:#94a3b8;cursor:pointer;position:relative;display:flex;align-items:center;justify-content:center;font-size:14px">
            <i class="fas fa-bell"></i>
            <span id="cp-notif-badge" style="position:absolute;top:-4px;right:-4px;width:16px;height:16px;background:#f43f5e;border-radius:50%;font-size:9px;color:#fff;display:none;align-items:center;justify-content:center">0</span>
          </button>
          <div style="font-size:12px;color:#64748b">${_user.company_name||_user.company||''}</div>
        </div>
      </header>

      <!-- Page content -->
      <main id="cp-main" style="flex:1;padding:24px;overflow-y:auto"></main>
    </div>
  </div>

  <!-- Notifications dropdown -->
  <div id="cp-notif-panel" style="position:fixed;top:56px;right:16px;width:340px;background:#111128;border:1px solid #1e1e45;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.6);z-index:200;display:none;overflow:hidden">
    <div style="padding:14px 16px;border-bottom:1px solid #1e1e45;display:flex;justify-content:space-between;align-items:center">
      <span style="font-weight:600;font-size:13px;color:#e2e8f0">Notifications</span>
      <button onclick="markAllCpNotifRead()" style="font-size:11px;color:#6366f1;background:none;border:none;cursor:pointer">Mark all read</button>
    </div>
    <div id="cp-notif-list" style="max-height:320px;overflow-y:auto"></div>
  </div>`

  // Load initial page
  cpNavigate('cp-dashboard')
  loadCpNotifications()
}

function cpNavItem(page, icon, label) {
  return `<button class="cp-nav-item" id="nav-${page}" data-page="${page}" onclick="cpNavigate('${page}')" style="width:100%;padding:9px 12px;border-radius:8px;border:none;cursor:pointer;background:transparent;color:#94a3b8;display:flex;align-items:center;gap:10px;font-size:13px;font-weight:500;text-align:left;transition:.2s;margin-bottom:2px">
    <i class="fas ${icon}" style="width:16px;text-align:center;font-size:13px"></i>${label}
  </button>`
}

function cpGoProjectsPage(page) {
  _clientProjectsPage = Math.max(1, Number(page) || 1)
  cpNavigate('cp-projects')
}

function cpGoMilestonesPage(page) {
  _clientMilestonesPage = Math.max(1, Number(page) || 1)
  cpNavigate('cp-milestones')
}

function cpGoDocumentsPage(page) {
  _clientDocumentsPage = Math.max(1, Number(page) || 1)
  cpNavigate('cp-documents')
}

function cpGoActivityPage(page) {
  _clientActivityPage = Math.max(1, Number(page) || 1)
  cpNavigate('cp-activity')
}

function cpNavigate(page) {
  // Track history before navigating
  if (_clientPage !== page) {
    _clientHistory.push(_clientPage)
    updateCpBackButton()
  }
  _clientPage = page
  // Update nav active state
  document.querySelectorAll('.cp-nav-item').forEach(btn => {
    const isActive = btn.dataset.page === page
    btn.style.background = isActive ? 'rgba(99,102,241,.15)' : 'transparent'
    btn.style.color = isActive ? '#818cf8' : '#94a3b8'
  })
  // Update title
  const titles = {
    'cp-dashboard': 'Dashboard', 'cp-projects': 'My Projects', 'cp-kanban': 'Task Board',
    'cp-milestones': 'Milestones', 'cp-documents': 'Documents', 'cp-invoices': 'Invoices & Billing',
    'cp-activity': 'Activity Feed', 'cp-profile': 'My Profile'
  }
  const titleEl = document.getElementById('cp-page-title')
  if (titleEl) titleEl.textContent = titles[page] || page
  // Render page
  const main = document.getElementById('cp-main')
  if (!main) return
  main.innerHTML = `<div style="color:#64748b;padding:40px 0;text-align:center"><i class="fas fa-spinner fa-spin" style="font-size:24px"></i></div>`
  switch(page) {
    case 'cp-dashboard':   renderCpDashboard(main); break
    case 'cp-projects':    renderCpProjects(main); break
    case 'cp-kanban':      renderCpKanban(main); break
    case 'cp-milestones':  renderCpMilestones(main); break
    case 'cp-documents':   renderCpDocuments(main); break
    case 'cp-invoices':    renderCpInvoices(main); break
    case 'cp-activity':    renderCpActivity(main); break
    case 'cp-profile':     renderCpProfile(main); break
  }
}

function cpBack() {
  if (_clientHistory.length === 0) return
  _clientPage = _clientHistory.pop()
  updateCpBackButton()
  // Update nav active state
  document.querySelectorAll('.cp-nav-item').forEach(btn => {
    const isActive = btn.dataset.page === _clientPage
    btn.style.background = isActive ? 'rgba(99,102,241,.15)' : 'transparent'
    btn.style.color = isActive ? '#818cf8' : '#94a3b8'
  })
  // Update title
  const titles = {
    'cp-dashboard': 'Dashboard', 'cp-projects': 'My Projects', 'cp-kanban': 'Task Board',
    'cp-milestones': 'Milestones', 'cp-documents': 'Documents', 'cp-invoices': 'Invoices & Billing',
    'cp-activity': 'Activity Feed', 'cp-profile': 'My Profile'
  }
  const titleEl = document.getElementById('cp-page-title')
  if (titleEl) titleEl.textContent = titles[_clientPage] || _clientPage
  // Render page
  const main = document.getElementById('cp-main')
  if (!main) return
  main.innerHTML = `<div style="color:#64748b;padding:40px 0;text-align:center"><i class="fas fa-spinner fa-spin" style="font-size:24px"></i></div>`
  switch(_clientPage) {
    case 'cp-dashboard':   renderCpDashboard(main); break
    case 'cp-projects':    renderCpProjects(main); break
    case 'cp-kanban':      renderCpKanban(main); break
    case 'cp-milestones':  renderCpMilestones(main); break
    case 'cp-documents':   renderCpDocuments(main); break
    case 'cp-invoices':    renderCpInvoices(main); break
    case 'cp-activity':    renderCpActivity(main); break
    case 'cp-profile':     renderCpProfile(main); break
  }
}

function updateCpBackButton() {
  const backBtn = document.getElementById('cp-back-btn')
  if (backBtn) {
    backBtn.style.display = _clientHistory.length > 0 ? 'flex' : 'none'
  }
}

function clientLogout() {
  clearAuth()
  toast('Signed out successfully', 'info')
  setTimeout(() => { window.location.reload() }, 600)
}

/* ═══ CLIENT DASHBOARD ════════════════════════════════════ */
async function renderCpDashboard(el) {
  try {
    const clientId = _user.sub || _user.id
    const [clientData, invData, actData] = await Promise.all([
      ClientAPI.get('/clients/' + clientId),
      ClientAPI.get('/invoices?client_id=' + clientId + '&page=1&limit=4'),
      ClientAPI.get('/activity?limit=8&client_id=' + clientId).catch(() => ({ logs: [] }))
    ])
    const client = clientData.client || {}
    const projects = clientData.projects || []
    const invoices = invData.invoices || []
    const summary = invData.summary || {}
    const logs = actData.logs || []

    const totalBudget = projects.reduce((s, p) => s + (p.estimated_budget_hours || 0), 0)
    const consumedHrs = projects.reduce((s, p) => s + (p.consumed_hours || 0), 0)
    const allocHrs = projects.reduce((s, p) => s + (p.total_allocated_hours || 0), 0)
    const activeProjects = projects.filter(p => p.status === 'active').length
    const totalBilled = summary.total_value || 0
    const totalPaid = summary.total_paid || 0
    const pendingInvoices = summary.pending_count ?? invoices.filter(i => ['pending','sent','overdue'].includes(i.status)).length

    el.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Welcome back, ${_user.contact_name || _user.name}!</h1>
        <p class="page-subtitle">${_user.company_name || _user.company || ''} • Client Portal Overview</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-outline" onclick="cpNavigate('cp-projects')"><i class="fas fa-layer-group"></i>View Projects</button>
        <button class="btn btn-primary" onclick="cpNavigate('cp-invoices')"><i class="fas fa-file-invoice-dollar"></i>Billing</button>
      </div>
    </div>

    <!-- Stats row -->
    <div class="grid-4" style="margin-bottom:20px">
      <div class="card" style="padding:20px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between">
          <div>
            <div style="font-size:12px;color:#64748b;font-weight:500;text-transform:uppercase;letter-spacing:.04em">Active Projects</div>
            <div style="font-size:28px;font-weight:700;color:#e2e8f0;margin-top:6px">${activeProjects}</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:4px">${projects.length} total projects</div>
          </div>
          <div style="width:42px;height:42px;border-radius:10px;background:rgba(99,102,241,.12);display:flex;align-items:center;justify-content:center">
            <i class="fas fa-layer-group" style="color:#818cf8;font-size:16px"></i>
          </div>
        </div>
      </div>
      <div class="card" style="padding:20px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between">
          <div>
            <div style="font-size:12px;color:#64748b;font-weight:500;text-transform:uppercase;letter-spacing:.04em">Hours Consumed</div>
            <div style="font-size:28px;font-weight:700;color:#e2e8f0;margin-top:6px">${consumedHrs}</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:4px">${allocHrs}h allocated</div>
          </div>
          <div style="width:42px;height:42px;border-radius:10px;background:rgba(6,182,212,.1);display:flex;align-items:center;justify-content:center">
            <i class="fas fa-clock" style="color:#06b6d4;font-size:16px"></i>
          </div>
        </div>
      </div>
      <div class="card" style="padding:20px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between">
          <div>
            <div style="font-size:12px;color:#64748b;font-weight:500;text-transform:uppercase;letter-spacing:.04em">Total Billed</div>
            <div style="font-size:28px;font-weight:700;color:#10b981;margin-top:6px">₹${fmtNum(totalBilled)}</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:4px">₹${fmtNum(totalPaid)} paid</div>
          </div>
          <div style="width:42px;height:42px;border-radius:10px;background:rgba(16,185,129,.1);display:flex;align-items:center;justify-content:center">
            <i class="fas fa-indian-rupee-sign" style="color:#10b981;font-size:16px"></i>
          </div>
        </div>
      </div>
      <div class="card" style="padding:20px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between">
          <div>
            <div style="font-size:12px;color:#64748b;font-weight:500;text-transform:uppercase;letter-spacing:.04em">Pending Invoices</div>
            <div style="font-size:28px;font-weight:700;color:${pendingInvoices > 0 ? '#f59e0b' : '#10b981'};margin-top:6px">${pendingInvoices}</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:4px">${summary.total_invoices ?? invoices.length} total invoices</div>
          </div>
          <div style="width:42px;height:42px;border-radius:10px;background:rgba(245,158,11,.1);display:flex;align-items:center;justify-content:center">
            <i class="fas fa-file-invoice" style="color:#f59e0b;font-size:16px"></i>
          </div>
        </div>
      </div>
    </div>

    <div class="grid-2" style="margin-bottom:20px">
      <!-- Projects status -->
      <div class="card">
        <div class="card-header"><span style="font-weight:600">Project Status Overview</span><button class="btn btn-sm btn-outline" onclick="cpNavigate('cp-projects')">View All</button></div>
        <div class="card-body" style="padding:0">
          ${projects.length === 0 ? '<div class="empty-state"><i class="fas fa-layer-group"></i><p>No projects assigned yet</p></div>' :
          `<table class="data-table">
            <thead><tr><th>Project</th><th>Status</th><th>Progress</th></tr></thead>
            <tbody>${projects.map(p => {
              const burn = p.total_allocated_hours > 0 ? Math.round((p.consumed_hours / p.total_allocated_hours) * 100) : 0
              return `<tr>
                <td><div style="font-weight:500;color:#e2e8f0;font-size:13px">${p.name}</div><div style="font-size:11px;color:#64748b">${p.code}</div></td>
                <td>${cpStatusBadge(p.status)}</td>
                <td>
                  <div style="display:flex;align-items:center;gap:8px">
                    <div style="width:60px;height:4px;background:#1e1e45;border-radius:2px;overflow:hidden"><div style="height:100%;width:${Math.min(burn,100)}%;background:${burn>=90?'#f43f5e':burn>=70?'#f59e0b':'#10b981'};border-radius:2px"></div></div>
                    <span style="font-size:11px;color:#94a3b8">${burn}%</span>
                  </div>
                </td>
              </tr>`}).join('')}</tbody>
          </table>`}
        </div>
      </div>
      <!-- Recent activity -->
      <div class="card">
        <div class="card-header"><span style="font-weight:600">Recent Activity</span><button class="btn btn-sm btn-outline" onclick="cpNavigate('cp-activity')">View All</button></div>
        <div class="card-body" style="padding:12px">
          ${logs.length === 0 ? '<div class="empty-state"><i class="fas fa-bell"></i><p>No recent activity</p></div>' :
          logs.slice(0, 6).map(log => `
            <div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid #1e1e45">
              <div style="width:28px;height:28px;border-radius:50%;background:${cpActivityColor(log.action)};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:10px">
                <i class="fas ${cpActivityIcon(log.action)}" style="color:#fff"></i>
              </div>
              <div style="min-width:0;flex:1">
                <div style="font-size:12px;color:#e2e8f0;line-height:1.4">${log.description || (log.action + ' ' + (log.entity_type || ''))}</div>
                <div style="font-size:10px;color:#64748b;margin-top:2px">${fmtDateRelative(log.created_at)}</div>
              </div>
            </div>`).join('')}
        </div>
      </div>
    </div>

    <!-- Latest invoice -->
    ${invoices.length > 0 ? `
    <div class="card">
      <div class="card-header"><span style="font-weight:600">Recent Invoices</span><button class="btn btn-sm btn-outline" onclick="cpNavigate('cp-invoices')">View All</button></div>
      <div class="card-body" style="padding:0">
        <table class="data-table">
          <thead><tr><th>Invoice</th><th>Project</th><th>Amount</th><th>Due Date</th><th>Status</th></tr></thead>
          <tbody>${invoices.slice(0,4).map(i => `
            <tr>
              <td><div style="font-weight:500;color:#e2e8f0;font-size:13px">${i.invoice_number}</div><div style="font-size:11px;color:#64748b">${i.title||''}</div></td>
              <td style="font-size:12px;color:#94a3b8">${i.project_name||'—'}</td>
              <td style="font-weight:600;color:#10b981">${fmtCurrency(i.total_amount)}</td>
              <td style="font-size:12px;color:${new Date(i.due_date)<new Date()&&i.status!=='paid'?'#f43f5e':'#94a3b8'}">${fmtDate(i.due_date)}</td>
              <td><span class="badge ${cpInvoiceBadge(i.status)}">${i.status}</span></td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>` : ''}
    `
  } catch(e) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Failed to load dashboard: ${e.message}</p></div>`
  }
}

/* ═══ CLIENT PROJECTS ═════════════════════════════════════ */
async function renderCpProjects(el) {
  try {
    const clientId = _user.sub || _user.id
    const data = await ClientAPI.get('/clients/' + clientId)
    const projects = data.projects || []
    const pagination = paginateClient(projects, _clientProjectsPage, _clientProjectsLimit)
    _clientProjectsPage = pagination.page

    el.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">My Projects</h1><p class="page-subtitle">${pagination.total} project${pagination.total !== 1 ? 's' : ''} assigned to your account</p></div>
    </div>
    ${pagination.total === 0 ? '<div class="empty-state"><i class="fas fa-layer-group"></i><p>No projects assigned yet. Contact your project manager.</p></div>' :
    `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px">
      ${pagination.items.map(p => {
        const burn = p.total_allocated_hours > 0 ? Math.round((p.consumed_hours / p.total_allocated_hours) * 100) : 0
        const daysLeft = p.expected_end_date ? Math.ceil((new Date(p.expected_end_date) - new Date()) / 86400000) : null
        return `<div class="card" style="padding:20px;cursor:pointer;transition:.2s" onclick="cpViewProject('${p.id}')" onmouseover="this.style.borderColor='#6366f1'" onmouseout="this.style.borderColor='#1e1e45'">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px">
            <div>
              <div style="font-size:15px;font-weight:600;color:#e2e8f0">${p.name}</div>
              <div style="font-size:11px;color:#64748b;margin-top:2px">${p.code}</div>
            </div>
            ${cpStatusBadge(p.status)}
          </div>
          <p style="font-size:12px;color:#94a3b8;margin:0 0 14px;line-height:1.5">${(p.description || 'No description available.').substring(0, 100)}${(p.description||'').length > 100 ? '…' : ''}</p>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <span style="font-size:11px;color:#64748b">Hour Burn</span>
            <span style="font-size:11px;font-weight:600;color:${burn>=90?'#f43f5e':burn>=70?'#f59e0b':'#10b981'}">${burn}%</span>
          </div>
          <div style="width:100%;height:6px;background:#1e1e45;border-radius:3px;overflow:hidden;margin-bottom:14px">
            <div style="height:100%;width:${Math.min(burn,100)}%;background:${burn>=90?'linear-gradient(90deg,#ef4444,#f43f5e)':burn>=70?'linear-gradient(90deg,#d97706,#f59e0b)':'linear-gradient(90deg,#059669,#10b981)'};border-radius:3px;transition:.5s"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:#64748b">
            <span><i class="fas fa-clock" style="margin-right:4px"></i>${p.consumed_hours}h / ${p.total_allocated_hours}h</span>
            ${daysLeft !== null ? `<span style="color:${daysLeft<0?'#f43f5e':daysLeft<7?'#f59e0b':'#64748b'}"><i class="fas fa-calendar" style="margin-right:4px"></i>${daysLeft < 0 ? Math.abs(daysLeft)+'d overdue' : daysLeft+'d left'}</span>` : ''}
          </div>
        </div>`}).join('')}
    </div>
    ${renderPager(pagination, 'cpGoProjectsPage', 'cpGoProjectsPage', 'projects')}
    `}
    `
  } catch(e) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>`
  }
}

function cpViewProject(projectId) {
  cpNavigate('cp-kanban')
  setTimeout(() => { window._cpSelectedProject = projectId; renderCpKanban(document.getElementById('cp-main')) }, 100)
}

/* ═══ CLIENT KANBAN BOARD ════════════════════════════════= */
let _cpKanbanProject = null

async function renderCpKanban(el) {
  try {
    const clientId = _user.sub || _user.id
    const clientData = await ClientAPI.get('/clients/' + clientId)
    const projects = clientData.projects || []

    if (projects.length === 0) {
      el.innerHTML = '<div class="empty-state"><i class="fas fa-columns"></i><p>No projects to display tasks for.</p></div>'
      return
    }

    // Use pre-selected project or first project
    if (window._cpSelectedProject) {
      _cpKanbanProject = window._cpSelectedProject
      window._cpSelectedProject = null
    }
    if (!_cpKanbanProject) _cpKanbanProject = projects[0].id

    const tasks = await ClientAPI.get('/tasks?project_id=' + _cpKanbanProject)
    const taskList = (tasks.tasks || []).filter(t => t.is_client_visible !== 0)

    const columns = [
      { id: 'backlog', label: 'Backlog', icon: 'fa-inbox', color: '#64748b' },
      { id: 'todo', label: 'To Do', icon: 'fa-circle-dot', color: '#818cf8' },
      { id: 'in_progress', label: 'In Progress', icon: 'fa-spinner', color: '#06b6d4' },
      { id: 'review', label: 'Review', icon: 'fa-eye', color: '#f59e0b' },
      { id: 'qa', label: 'QA', icon: 'fa-bug', color: '#8b5cf6' },
      { id: 'done', label: 'Done', icon: 'fa-check-circle', color: '#10b981' },
      { id: 'blocked', label: 'Blocked', icon: 'fa-ban', color: '#f43f5e' },
    ]

    el.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Task Board</h1><p class="page-subtitle">Client-visible tasks for your projects</p></div>
      <div class="page-actions">
        <select class="form-select" style="min-width:200px" onchange="_cpKanbanProject=this.value;renderCpKanban(document.getElementById('cp-main'))">
          ${projects.map(p => `<option value="${p.id}" ${p.id === _cpKanbanProject ? 'selected' : ''}>${p.name}</option>`).join('')}
        </select>
      </div>
    </div>

    <div style="overflow-x:auto;padding-bottom:16px">
      <div style="display:flex;gap:14px;min-width:max-content">
        ${columns.map(col => {
          const colTasks = taskList.filter(t => t.status === col.id)
          return `<div style="width:260px;flex-shrink:0">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding:8px 12px;background:#111128;border-radius:8px;border-top:2px solid ${col.color}">
              <i class="fas ${col.icon}" style="color:${col.color};font-size:12px"></i>
              <span style="font-size:12px;font-weight:600;color:#e2e8f0">${col.label}</span>
              <span style="margin-left:auto;background:#1e1e45;color:#94a3b8;font-size:10px;font-weight:600;padding:2px 7px;border-radius:10px">${colTasks.length}</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;min-height:120px">
              ${colTasks.length === 0 ? `<div style="padding:16px;text-align:center;color:#334155;font-size:12px;border:1px dashed #1e1e45;border-radius:8px">No tasks</div>` :
              colTasks.map(t => `
                <div style="background:#111128;border:1px solid #1e1e45;border-radius:8px;padding:12px;cursor:pointer;transition:.2s" onclick="cpViewTask('${t.id}')" onmouseover="this.style.borderColor='${col.color}';this.style.boxShadow='0 4px 12px rgba(0,0,0,.3)'" onmouseout="this.style.borderColor='#1e1e45';this.style.boxShadow='none'">
                  <div style="font-size:10px;color:#64748b;margin-bottom:6px;display:flex;align-items:center;gap:6px">
                    <span style="font-family:monospace">${t.task_key||''}</span>
                    ${priorityBadge(t.priority)}
                  </div>
                  <div style="font-size:13px;font-weight:500;color:#e2e8f0;line-height:1.4;margin-bottom:8px">${t.title}</div>
                  ${t.description ? `<div style="font-size:11px;color:#64748b;line-height:1.4;margin-bottom:8px">${t.description.substring(0,80)}${t.description.length>80?'…':''}</div>` : ''}
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
                    <span style="font-size:10px;color:#64748b">${t.module_name||''}</span>
                    ${t.estimated_hours ? `<span style="font-size:10px;color:#94a3b8"><i class="fas fa-clock" style="margin-right:3px"></i>${t.estimated_hours}h</span>` : ''}
                  </div>
                </div>`).join('')}
            </div>
          </div>`}).join('')}
      </div>
    </div>`
  } catch(e) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>`
  }
}

async function cpViewTask(taskId) {
  try {
    const data = await ClientAPI.get('/tasks/' + taskId)
    const t = data.task || data
    const comments = data.comments || []
    showModal(`
    <div class="modal-header">
      <div>
        <div style="font-size:11px;color:#64748b;margin-bottom:4px">${t.task_key || ''}</div>
        <h3>${t.title}</h3>
      </div>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
        ${priorityBadge(t.priority)} ${statusBadge(t.status)}
        ${t.module_name ? `<span class="badge" style="background:rgba(139,92,246,.15);color:#a78bfa">${t.module_name}</span>` : ''}
        ${t.estimated_hours ? `<span style="font-size:12px;color:#94a3b8"><i class="fas fa-clock" style="margin-right:4px"></i>${t.estimated_hours}h estimated</span>` : ''}
      </div>
      ${t.description ? `<p style="font-size:13px;color:#94a3b8;line-height:1.6;margin-bottom:16px">${t.description}</p>` : ''}
      ${t.acceptance_criteria ? `<div style="margin-bottom:16px"><div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Acceptance Criteria</div><pre style="font-size:12px;color:#94a3b8;white-space:pre-wrap;font-family:inherit;line-height:1.5;padding:10px;background:#0a0a1a;border-radius:6px;border:1px solid #1e1e45">${t.acceptance_criteria}</pre></div>` : ''}

      <!-- Comments -->
      <div style="border-top:1px solid #1e1e45;padding-top:16px;margin-top:16px">
        <div style="font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.04em;margin-bottom:12px">Comments (${comments.length})</div>
        ${comments.filter(cm => !cm.is_internal).map(cm => `
          <div style="display:flex;gap:10px;margin-bottom:12px">
            <div style="width:28px;height:28px;border-radius:50%;background:${cm.author_color||'#6366f1'};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;flex-shrink:0">${initials(cm.author_name||'U')}</div>
            <div style="flex:1">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                <span style="font-size:12px;font-weight:600;color:#e2e8f0">${cm.author_name||'User'}</span>
                <span style="font-size:10px;color:#64748b">${fmtDateRelative(cm.created_at)}</span>
              </div>
              <div style="font-size:12px;color:#94a3b8;line-height:1.5">${cm.content}</div>
            </div>
          </div>`).join('') || '<div style="font-size:12px;color:#334155;text-align:center;padding:12px">No comments yet</div>'}
        <!-- Add comment -->
        <div style="display:flex;gap:8px;margin-top:12px">
          <textarea class="form-textarea" id="cp-comment-input" placeholder="Add a comment…" style="flex:1;min-height:60px;font-size:12px" rows="2"></textarea>
          <button class="btn btn-primary btn-sm" style="align-self:flex-end" onclick="cpSubmitComment('${t.id}')"><i class="fas fa-paper-plane"></i></button>
        </div>
      </div>
    </div>`, 'modal-lg')
  } catch(e) { toast(e.message, 'error') }
}

async function cpSubmitComment(taskId) {
  const content = document.getElementById('cp-comment-input')?.value.trim()
  if (!content) return toast('Enter a comment', 'error')
  try {
    await ClientAPI.post('/tasks/' + taskId + '/comments', { content, is_internal: false })
    toast('Comment added!', 'success')
    closeModal()
  } catch(e) { toast(e.message, 'error') }
}

/* ═══ CLIENT MILESTONES ═══════════════════════════════════ */
async function renderCpMilestones(el) {
  try {
    const clientId = _user.sub || _user.id
    const clientData = await ClientAPI.get('/clients/' + clientId)
    const projects = clientData.projects || []
    const projectIds = projects.map(p => p.id)

    if (projectIds.length === 0) {
      el.innerHTML = '<div class="empty-state"><i class="fas fa-flag"></i><p>No projects assigned yet.</p></div>'
      return
    }

    // Fetch milestones for all client projects
    const msData = await ClientAPI.get('/milestones?project_ids=' + projectIds.join(','))
    const milestones = msData.milestones || []
    const pagination = paginateClient(milestones, _clientMilestonesPage, _clientMilestonesLimit)
    _clientMilestonesPage = pagination.page

    el.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Milestones</h1><p class="page-subtitle">${pagination.total} project milestones and delivery timeline</p></div>
    </div>
    ${pagination.total === 0 ? '<div class="empty-state"><i class="fas fa-flag"></i><p>No milestones set yet.</p></div>' :
    pagination.items.map(m => {
      const pct = m.completion_percentage || 0
      const isOverdue = m.due_date && new Date(m.due_date) < new Date() && m.status !== 'completed'
      return `<div class="card" style="padding:20px;margin-bottom:14px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <div style="font-size:15px;font-weight:600;color:#e2e8f0">${m.title}</div>
              <span class="badge ${m.status==='completed'?'badge-done':m.status==='in_progress'?'badge-inprogress':isOverdue?'badge-blocked':'badge-todo'}">${m.status?.replace('_',' ')}</span>
              ${isOverdue ? '<span class="badge badge-blocked"><i class="fas fa-exclamation-triangle"></i>Overdue</span>' : ''}
            </div>
            <div style="font-size:12px;color:#64748b;margin-top:4px">${m.project_name || ''} ${m.due_date ? `• Due: ${fmtDate(m.due_date)}` : ''}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;margin-left:16px">
            <div style="font-size:22px;font-weight:700;color:${pct>=100?'#10b981':pct>=60?'#f59e0b':'#818cf8'}">${pct}%</div>
            <div style="font-size:10px;color:#64748b">complete</div>
          </div>
        </div>
        ${m.description ? `<p style="font-size:12px;color:#94a3b8;margin:0 0 12px;line-height:1.5">${m.description}</p>` : ''}
        <div style="width:100%;height:8px;background:#1e1e45;border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${Math.min(pct,100)}%;background:${pct>=100?'linear-gradient(90deg,#059669,#10b981)':pct>=60?'linear-gradient(90deg,#d97706,#f59e0b)':'linear-gradient(90deg,#4f46e5,#6366f1)'};border-radius:4px;transition:.5s"></div>
        </div>
        ${m.amount ? `<div style="margin-top:10px;font-size:12px;color:#94a3b8"><i class="fas fa-indian-rupee-sign" style="margin-right:4px;color:#10b981"></i>Billing milestone: <strong style="color:#10b981">${fmtCurrency(m.amount)}</strong></div>` : ''}
      </div>`}).join('')}
    ${renderPager(pagination, 'cpGoMilestonesPage', 'cpGoMilestonesPage', 'milestones')}
    `
  } catch(e) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>`
  }
}

/* ═══ CLIENT DOCUMENTS ════════════════════════════════════ */
async function renderCpDocuments(el) {
  try {
    const clientId = _user.sub || _user.id
    const clientData = await ClientAPI.get('/clients/' + clientId)
    const projects = clientData.projects || []

    let selectedProject = projects[0]?.id || ''
    const docsData = await ClientAPI.get('/documents?visibility=client' + (selectedProject ? '&project_id=' + selectedProject : ''))
    const docs = docsData.documents || []
    const categories = docsData.categories || []
    const pagination = paginateClient(docs, _clientDocumentsPage, _clientDocumentsLimit)
    _clientDocumentsPage = pagination.page

    const docsByCategory = {}
    pagination.items.forEach(d => {
      const cat = d.category || 'other'
      if (!docsByCategory[cat]) docsByCategory[cat] = []
      docsByCategory[cat].push(d)
    })

    const categoryLabels = {
      sow: 'Statement of Work', brd: 'Business Requirements', frd: 'Functional Requirements',
      uiux: 'UI/UX Design', wireframes: 'Wireframes', meeting_notes: 'Meeting Notes',
      technical: 'Technical Docs', test_report: 'Test Reports', release: 'Release Notes',
      billing: 'Billing', contract: 'Contracts', other: 'Other'
    }
    const categoryIcons = {
      sow: 'fa-handshake', brd: 'fa-clipboard-list', frd: 'fa-file-alt',
      uiux: 'fa-paint-brush', wireframes: 'fa-drafting-compass', meeting_notes: 'fa-comments',
      technical: 'fa-code', test_report: 'fa-bug', release: 'fa-rocket',
      billing: 'fa-file-invoice-dollar', contract: 'fa-file-contract', other: 'fa-file'
    }

    el.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Project Documents</h1><p class="page-subtitle">${pagination.total} document${pagination.total !== 1 ? 's' : ''} available</p></div>
      <div class="page-actions">
        <select class="form-select" style="min-width:200px" onchange="cpReloadDocs(this.value)">
          <option value="">All Projects</option>
          ${projects.map(p => `<option value="${p.id}" ${p.id === selectedProject ? 'selected' : ''}>${p.name}</option>`).join('')}
        </select>
      </div>
    </div>

    ${pagination.total === 0 ? '<div class="empty-state"><i class="fas fa-folder-open"></i><p>No documents available for your projects yet.</p></div>' :

    Object.keys(docsByCategory).map(cat => `
      <div style="margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #1e1e45">
          <div style="width:28px;height:28px;border-radius:7px;background:rgba(99,102,241,.12);display:flex;align-items:center;justify-content:center">
            <i class="fas ${categoryIcons[cat]||'fa-file'}" style="color:#818cf8;font-size:12px"></i>
          </div>
          <span style="font-size:13px;font-weight:600;color:#e2e8f0">${categoryLabels[cat]||cat}</span>
          <span style="background:#1e1e45;color:#94a3b8;font-size:10px;padding:2px 7px;border-radius:10px">${docsByCategory[cat].length}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px">
          ${docsByCategory[cat].map(doc => `
            <div class="card" style="padding:14px;transition:.2s" onmouseover="this.style.borderColor='#6366f1'" onmouseout="this.style.borderColor='#1e1e45'">
              <div style="display:flex;align-items:flex-start;gap:12px">
                <div style="width:36px;height:36px;border-radius:8px;background:${docFileColor(doc.file_type)};display:flex;align-items:center;justify-content:center;flex-shrink:0">
                  <i class="fas ${docFileIcon(doc.file_type)}" style="color:#fff;font-size:14px"></i>
                </div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:500;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${doc.title}</div>
                  <div style="font-size:11px;color:#64748b;margin-top:2px">${doc.project_name||''} • v${doc.version||'1.0'}</div>
                  ${doc.description ? `<div style="font-size:11px;color:#94a3b8;margin-top:4px;line-height:1.4">${doc.description.substring(0,60)}${doc.description.length>60?'…':''}</div>` : ''}
                  <div style="display:flex;align-items:center;gap:12px;margin-top:8px">
                    <span style="font-size:10px;color:#64748b"><i class="fas fa-user" style="margin-right:3px"></i>${doc.uploaded_by_name||'—'}</span>
                    <span style="font-size:10px;color:#64748b"><i class="fas fa-clock" style="margin-right:3px"></i>${fmtDate(doc.created_at)}</span>
                    <span style="font-size:10px;color:#64748b"><i class="fas fa-download" style="margin-right:3px"></i>${doc.download_count||0}</span>
                  </div>
                </div>
              </div>
              <div style="display:flex;gap:8px;margin-top:12px">
                <a href="${doc.file_url}" target="_blank" class="btn btn-sm btn-outline" style="flex:1;text-align:center;text-decoration:none" onclick="cpTrackDownload('${doc.id}')">
                  <i class="fas fa-eye"></i>Preview
                </a>
                <a href="${doc.file_url}" download="${doc.file_name}" class="btn btn-sm btn-primary" style="flex:1;text-align:center;text-decoration:none" onclick="cpTrackDownload('${doc.id}')">
                  <i class="fas fa-download"></i>Download
                </a>
              </div>
            </div>`).join('')}
        </div>
      </div>`).join('')}
    ${renderPager(pagination, 'cpGoDocumentsPage', 'cpGoDocumentsPage', 'documents')}
    `
    // Store for reload
    window._cpDocProject = selectedProject
  } catch(e) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>`
  }
}

async function cpReloadDocs(projectId) {
  window._cpDocProject = projectId
  _clientDocumentsPage = 1
  renderCpDocuments(document.getElementById('cp-main'))
}

async function cpTrackDownload(docId) {
  try { await ClientAPI.patch('/documents/' + docId + '/download', {}) } catch {}
}

function docFileIcon(type) {
  if (!type) return 'fa-file'
  if (type.includes('pdf')) return 'fa-file-pdf'
  if (type.includes('word') || type.includes('doc')) return 'fa-file-word'
  if (type.includes('sheet') || type.includes('excel') || type.includes('xls')) return 'fa-file-excel'
  if (type.includes('ppt') || type.includes('presentation')) return 'fa-file-powerpoint'
  if (type.includes('image') || type.includes('png') || type.includes('jpg')) return 'fa-file-image'
  if (type.includes('zip') || type.includes('rar')) return 'fa-file-archive'
  return 'fa-file-alt'
}
function docFileColor(type) {
  if (!type) return '#334155'
  if (type.includes('pdf')) return '#ef4444'
  if (type.includes('word') || type.includes('doc')) return '#3b82f6'
  if (type.includes('sheet') || type.includes('excel') || type.includes('xls')) return '#10b981'
  if (type.includes('ppt')) return '#f97316'
  if (type.includes('image')) return '#8b5cf6'
  return '#6366f1'
}

/* ═══ CLIENT INVOICES ═════════════════════════════════════ */
async function renderCpInvoices(el) {
  try {
    const clientId = _user.sub || _user.id
    const data = await ClientAPI.get('/invoices?client_id=' + clientId + '&page=' + _clientInvoicePage + '&limit=' + _clientInvoiceLimit)
    const invoices = data.invoices || []
    const summary = data.summary || {}
    const pagination = data.pagination || { total: invoices.length, page: _clientInvoicePage, limit: _clientInvoiceLimit, totalPages: 1, hasMore: false }
    _clientInvoicePage = pagination.page || _clientInvoicePage

    const totalAmount = summary.total_value || 0
    const totalPaid = summary.total_paid || 0
    const totalPending = summary.total_pending || 0
    const totalOverdue = summary.total_overdue || 0
    const start = pagination.total ? ((pagination.page - 1) * pagination.limit) + 1 : 0
    const end = Math.min(pagination.page * pagination.limit, pagination.total || 0)

    el.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Invoices & Billing</h1><p class="page-subtitle">Your billing history and payment status</p></div>
    </div>

    <div class="grid-4" style="margin-bottom:20px">
      <div class="card" style="padding:18px">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;font-weight:500">Total Invoiced</div>
        <div style="font-size:24px;font-weight:700;color:#e2e8f0;margin:6px 0">${fmtCurrency(totalAmount)}</div>
        <div style="font-size:11px;color:#94a3b8">${summary.total_invoices ?? invoices.length} invoice${(summary.total_invoices ?? invoices.length) !== 1 ? 's' : ''}</div>
      </div>
      <div class="card" style="padding:18px">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;font-weight:500">Paid</div>
        <div style="font-size:24px;font-weight:700;color:#10b981;margin:6px 0">${fmtCurrency(totalPaid)}</div>
        <div style="font-size:11px;color:#94a3b8">${summary.paid_count || invoices.filter(i=>i.status==='paid').length} invoices paid</div>
      </div>
      <div class="card" style="padding:18px">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;font-weight:500">Pending</div>
        <div style="font-size:24px;font-weight:700;color:#f59e0b;margin:6px 0">${fmtCurrency(totalPending)}</div>
        <div style="font-size:11px;color:#94a3b8">${summary.pending_count ?? invoices.filter(i=>['pending','sent'].includes(i.status)).length} awaiting payment</div>
      </div>
      <div class="card" style="padding:18px">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;font-weight:500">Overdue</div>
        <div style="font-size:24px;font-weight:700;color:${totalOverdue>0?'#f43f5e':'#94a3b8'};margin:6px 0">${fmtCurrency(totalOverdue)}</div>
        <div style="font-size:11px;color:#94a3b8">${summary.overdue_count || invoices.filter(i=>i.status==='overdue').length} overdue</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><span style="font-weight:600">Invoice History</span></div>
      <div class="card-body" style="padding:0">
        ${invoices.length === 0 ? '<div class="empty-state"><i class="fas fa-file-invoice"></i><p>No invoices yet.</p></div>' :
        `<table class="data-table">
          <thead><tr><th>Invoice #</th><th>Title</th><th>Project</th><th>Issue Date</th><th>Due Date</th><th>Amount</th><th>Paid</th><th>Status</th><th></th></tr></thead>
          <tbody>${invoices.map(inv => {
            const isOverdue = new Date(inv.due_date) < new Date() && !['paid','cancelled'].includes(inv.status)
            return `<tr>
              <td style="font-family:monospace;font-size:12px;color:#818cf8">${inv.invoice_number}</td>
              <td><div style="font-weight:500;color:#e2e8f0;font-size:13px">${inv.title||'—'}</div></td>
              <td style="font-size:12px;color:#94a3b8">${inv.project_name||'—'}</td>
              <td style="font-size:12px;color:#94a3b8">${fmtDate(inv.issue_date)}</td>
              <td style="font-size:12px;color:${isOverdue?'#f43f5e':'#94a3b8'}">${fmtDate(inv.due_date)}${isOverdue?' <span class="badge badge-blocked" style="font-size:9px">Overdue</span>':''}</td>
              <td style="font-weight:600;color:#e2e8f0">${fmtCurrency(inv.total_amount)}</td>
              <td style="color:${inv.paid_amount>0?'#10b981':'#64748b'}">${inv.paid_amount>0?fmtCurrency(inv.paid_amount):'—'}</td>
              <td><span class="badge ${cpInvoiceBadge(inv.status)}">${inv.status?.replace('_',' ')}</span></td>
              <td>
                <button class="btn btn-sm btn-outline" onclick="cpViewInvoice('${inv.id}')"><i class="fas fa-eye"></i></button>
              </td>
            </tr>`}).join('')}</tbody>
        </table>`}
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-top:1px solid #1e1e45;flex-wrap:wrap">
          <div style="font-size:12px;color:#94a3b8">
            ${pagination.total ? `Showing ${start}-${end} of ${pagination.total}` : 'No invoices found'}
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <button class="btn btn-sm btn-outline" ${pagination.page <= 1 ? 'disabled' : ''} onclick="cpGoInvoicePage(${pagination.page - 1})">Previous</button>
            <span style="font-size:12px;color:#64748b">Page ${pagination.page} of ${pagination.totalPages || 1}</span>
            <button class="btn btn-sm btn-outline" ${!pagination.hasMore ? 'disabled' : ''} onclick="cpGoInvoicePage(${pagination.page + 1})">Next</button>
          </div>
        </div>
      </div>
    </div>`
  } catch(e) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>`
  }
}

function cpGoInvoicePage(page) {
  const nextPage = Math.max(1, Number(page) || 1)
  if (nextPage === _clientInvoicePage) return
  _clientInvoicePage = nextPage
  const main = document.getElementById('cp-main')
  if (main) renderCpInvoices(main)
}

async function cpViewInvoice(invoiceId) {
  try {
    const data = await ClientAPI.get('/invoices/' + invoiceId)
    const inv = data.invoice || data
    const subtotal = inv.amount || 0
    const tax = inv.tax_amount || (subtotal * (inv.tax_pct || 0) / 100)
    const total = inv.total_amount || subtotal + tax

    showModal(`
    <div class="modal-header"><h3>Invoice ${inv.invoice_number}</h3><button class="close-btn" onclick="closeModal()">✕</button></div>
    <div class="modal-body">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding:16px;background:#0a0a1a;border-radius:8px">
        <div>
          <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.08em">Invoice</div>
          <div style="font-size:20px;font-weight:700;color:#818cf8;font-family:monospace">${inv.invoice_number}</div>
        </div>
        <span class="badge ${cpInvoiceBadge(inv.status)}" style="font-size:12px;padding:6px 12px">${inv.status?.replace('_',' ')}</span>
      </div>
      <div class="form-row" style="margin-bottom:16px">
        <div><div style="font-size:11px;color:#64748b">Issue Date</div><div style="font-size:13px;color:#e2e8f0">${fmtDate(inv.issue_date)}</div></div>
        <div><div style="font-size:11px;color:#64748b">Due Date</div><div style="font-size:13px;color:${new Date(inv.due_date)<new Date()&&inv.status!=='paid'?'#f43f5e':'#e2e8f0'}">${fmtDate(inv.due_date)}</div></div>
      </div>
      ${inv.title ? `<div style="margin-bottom:12px"><div style="font-size:11px;color:#64748b">Title</div><div style="font-size:14px;font-weight:600;color:#e2e8f0">${inv.title}</div></div>` : ''}
      ${inv.description ? `<div style="margin-bottom:16px;padding:12px;background:#0a0a1a;border-radius:8px;font-size:12px;color:#94a3b8;line-height:1.5">${inv.description}</div>` : ''}
      <!-- Amount breakdown -->
      <div style="background:#0a0a1a;border-radius:8px;overflow:hidden;margin-bottom:16px">
        <table style="width:100%;border-collapse:collapse">
          <tr style="border-bottom:1px solid #1e1e45"><td style="padding:10px 14px;font-size:12px;color:#94a3b8">Subtotal</td><td style="padding:10px 14px;text-align:right;font-size:12px;color:#e2e8f0">${fmtCurrency(subtotal)}</td></tr>
          <tr style="border-bottom:1px solid #1e1e45"><td style="padding:10px 14px;font-size:12px;color:#94a3b8">Tax (${inv.tax_pct||0}%)</td><td style="padding:10px 14px;text-align:right;font-size:12px;color:#e2e8f0">${fmtCurrency(tax)}</td></tr>
          <tr style="background:rgba(16,185,129,.05)"><td style="padding:12px 14px;font-size:14px;font-weight:700;color:#e2e8f0">Total</td><td style="padding:12px 14px;text-align:right;font-size:16px;font-weight:700;color:#10b981">${fmtCurrency(total)}</td></tr>
          ${inv.paid_amount > 0 ? `<tr><td style="padding:10px 14px;font-size:12px;color:#10b981">Amount Paid</td><td style="padding:10px 14px;text-align:right;font-size:12px;color:#10b981">${fmtCurrency(inv.paid_amount)}</td></tr>` : ''}
          ${(total - (inv.paid_amount||0)) > 0 && inv.status !== 'paid' ? `<tr><td style="padding:10px 14px;font-size:12px;color:#f59e0b">Balance Due</td><td style="padding:10px 14px;text-align:right;font-size:12px;color:#f59e0b">${fmtCurrency(total - (inv.paid_amount||0))}</td></tr>` : ''}
        </table>
      </div>
      ${inv.payment_terms ? `<div style="font-size:12px;color:#64748b"><strong>Payment Terms:</strong> ${inv.payment_terms}</div>` : ''}
      ${inv.notes ? `<div style="font-size:12px;color:#64748b;margin-top:8px"><strong>Notes:</strong> ${inv.notes}</div>` : ''}
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Close</button>
    </div>`, 'modal-lg')
  } catch(e) { toast(e.message, 'error') }
}

/* ═══ CLIENT ACTIVITY ═════════════════════════════════════ */
async function renderCpActivity(el) {
  try {
    const clientId = _user.sub || _user.id
    const data = await ClientAPI.get('/activity?client_id=' + clientId + '&limit=50').catch(() => ({ logs: [] }))
    const logs = data.logs || data.activity || []
    const pagination = paginateClient(logs, _clientActivityPage, _clientActivityLimit)
    _clientActivityPage = pagination.page

    el.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Activity Feed</h1><p class="page-subtitle">${pagination.total} latest updates on your projects</p></div>
    </div>
    <div class="card" style="padding:0">
      <div style="padding:16px;border-bottom:1px solid #1e1e45">
        <div style="font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.04em">Recent Activity</div>
      </div>
      ${pagination.total === 0 ? '<div class="empty-state"><i class="fas fa-bell"></i><p>No recent activity yet.</p></div>' :
      `<div style="padding:0">
        ${pagination.items.map((log, i) => `
          <div style="display:flex;gap:14px;padding:14px 16px;${i<pagination.items.length-1?'border-bottom:1px solid #1e1e45':''}">
            <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:0">
              <div style="width:32px;height:32px;border-radius:50%;background:${cpActivityColor(log.action)};display:flex;align-items:center;justify-content:center">
                <i class="fas ${cpActivityIcon(log.action)}" style="color:#fff;font-size:12px"></i>
              </div>
              ${i < logs.length-1 ? `<div style="width:1px;flex:1;background:#1e1e45;min-height:20px;margin-top:4px"></div>` : ''}
            </div>
            <div style="flex:1;min-width:0;padding-top:4px">
              <div style="font-size:13px;color:#e2e8f0;line-height:1.4">${log.description || (log.action + ' ' + (log.entity_type || ''))}</div>
              ${log.project_name ? `<div style="font-size:11px;color:#6366f1;margin-top:4px"><i class="fas fa-layer-group" style="margin-right:4px"></i>${log.project_name}</div>` : ''}
              <div style="font-size:11px;color:#64748b;margin-top:4px;display:flex;align-items:center;gap:10px">
                ${log.actor_name ? `<span><i class="fas fa-user" style="margin-right:3px"></i>${log.actor_name}</span>` : ''}
                <span>${fmtDateRelative(log.created_at)}</span>
              </div>
            </div>
          </div>`).join('')}
      </div>`}
      ${renderPager(pagination, 'cpGoActivityPage', 'cpGoActivityPage', 'activities')}
    </div>`
  } catch(e) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>`
  }
}

/* ═══ CLIENT PROFILE ══════════════════════════════════════ */
async function renderCpProfile(el) {
  try {
    const data = await ClientAPI.get('/client-auth/me')
    const client = data.client || {}

    el.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">My Profile</h1><p class="page-subtitle">Manage your account settings</p></div>
    </div>
    <div class="grid-2">
      <div class="card" style="padding:24px">
        <div style="text-align:center;margin-bottom:24px">
          <div style="width:72px;height:72px;border-radius:50%;background:${client.avatar_color||'#6366f1'};display:inline-flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:#fff;margin-bottom:12px">${initials(client.contact_name||'C')}</div>
          <div style="font-size:18px;font-weight:600;color:#e2e8f0">${client.contact_name||'—'}</div>
          <div style="font-size:13px;color:#64748b;margin-top:4px">${client.company_name||'—'}</div>
          <div style="margin-top:8px"><span class="badge badge-inprogress">Client</span></div>
        </div>
        <div style="space-y:12px">
          ${profileRow('fa-envelope','Email',client.email||'—')}
          ${profileRow('fa-building','Company',client.company_name||'—')}
          ${client.phone ? profileRow('fa-phone','Phone',client.phone) : ''}
          ${client.website ? profileRow('fa-globe','Website',`<a href="${client.website}" target="_blank" style="color:#6366f1">${client.website}</a>`) : ''}
          ${client.industry ? profileRow('fa-industry','Industry',client.industry) : ''}
        </div>
      </div>
      <div class="card" style="padding:24px">
        <h3 style="font-size:15px;font-weight:600;color:#e2e8f0;margin:0 0 16px">Change Password</h3>
        <form onsubmit="cpChangePassword();return false;" autocomplete="on">
        <div class="form-group">
          <label class="form-label">Current Password</label>
          <input class="form-input" id="cp-old-pass" type="password" placeholder="••••••••" autocomplete="current-password"/>
        </div>
        <div class="form-group">
          <label class="form-label">New Password</label>
          <input class="form-input" id="cp-new-pass" type="password" placeholder="Minimum 8 characters" autocomplete="new-password"/>
        </div>
        <div class="form-group">
          <label class="form-label">Confirm New Password</label>
          <input class="form-input" id="cp-confirm-pass" type="password" placeholder="Repeat new password" autocomplete="new-password"/>
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%"><i class="fas fa-lock"></i>Update Password</button>
        </form>
        <div style="margin-top:24px;padding-top:20px;border-top:1px solid #1e1e45">
          <button class="btn btn-outline" style="width:100%;border-color:#f43f5e;color:#f43f5e" onclick="if(confirm('Sign out?'))clientLogout()"><i class="fas fa-sign-out-alt"></i>Sign Out</button>
        </div>
      </div>
    </div>`
  } catch(e) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>`
  }
}

function profileRow(icon, label, value) {
  return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #1e1e45">
    <div style="width:32px;height:32px;border-radius:8px;background:rgba(99,102,241,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <i class="fas ${icon}" style="color:#818cf8;font-size:12px"></i>
    </div>
    <div>
      <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.04em">${label}</div>
      <div style="font-size:13px;color:#e2e8f0;margin-top:2px">${value}</div>
    </div>
  </div>`
}

async function cpChangePassword() {
  const oldPass = document.getElementById('cp-old-pass')?.value
  const newPass = document.getElementById('cp-new-pass')?.value
  const confirmPass = document.getElementById('cp-confirm-pass')?.value
  if (!oldPass || !newPass || !confirmPass) return toast('Fill all password fields', 'error')
  if (newPass !== confirmPass) return toast('New passwords do not match', 'error')
  if (newPass.length < 8) return toast('Password must be at least 8 characters', 'error')
  try {
    await ClientAPI.post('/auth/change-password', { current_password: oldPass, new_password: newPass })
    toast('Password updated successfully!', 'success')
    document.getElementById('cp-old-pass').value = ''
    document.getElementById('cp-new-pass').value = ''
    document.getElementById('cp-confirm-pass').value = ''
  } catch(e) { toast(e.message, 'error') }
}

/* ═══ NOTIFICATIONS ═══════════════════════════════════════ */
async function loadCpNotifications() {
  try {
    const clientId = _user.sub || _user.id
    const data = await ClientAPI.get('/clients/' + clientId + '/notifications').catch(() => ({ notifications: [] }))
    const notifs = data.notifications || []
    const unread = notifs.filter(n => !n.is_read).length
    const badge = document.getElementById('cp-notif-badge')
    if (badge) {
      badge.textContent = unread
      badge.style.display = unread > 0 ? 'flex' : 'none'
    }
    const list = document.getElementById('cp-notif-list')
    if (list) {
      list.innerHTML = notifs.length === 0 ?
        '<div style="padding:24px;text-align:center;font-size:12px;color:#64748b">No notifications</div>' :
        notifs.map(n => `
          <div style="padding:12px 16px;border-bottom:1px solid #1e1e45;${!n.is_read?'background:rgba(99,102,241,.04)':''}">
            <div style="font-size:12px;color:#e2e8f0;line-height:1.4">${n.message}</div>
            <div style="font-size:10px;color:#64748b;margin-top:4px">${fmtDateRelative(n.created_at)}</div>
          </div>`).join('')
    }
  } catch {}
}

function toggleCpNotifications() {
  const panel = document.getElementById('cp-notif-panel')
  if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none'
}

async function markAllCpNotifRead() {
  const badge = document.getElementById('cp-notif-badge')
  if (badge) badge.style.display = 'none'
  document.getElementById('cp-notif-panel').style.display = 'none'
}

/* ═══ UTILITY FUNCTIONS ══════════════════════════════════ */
function cpStatusBadge(s) {
  const map = { active:'badge-inprogress', completed:'badge-done', 'on-hold':'badge-review', cancelled:'badge-todo', paused:'badge-todo' }
  return `<span class="badge ${map[s]||'badge-todo'}">${s?.replace('-',' ')||'unknown'}</span>`
}

function cpInvoiceBadge(s) {
  return { paid:'badge-done', pending:'badge-todo', sent:'badge-inprogress', overdue:'badge-blocked', partially_paid:'badge-review', cancelled:'badge-todo' }[s] || 'badge-todo'
}

function cpActivityColor(action) {
  const map = { created:'#6366f1', updated:'#06b6d4', completed:'#10b981', commented:'#8b5cf6', uploaded:'#f59e0b', status_changed:'#f97316', deleted:'#f43f5e' }
  return map[action] || '#64748b'
}

function cpActivityIcon(action) {
  const map = { created:'fa-plus', updated:'fa-edit', completed:'fa-check', commented:'fa-comment', uploaded:'fa-upload', status_changed:'fa-refresh', deleted:'fa-trash' }
  return map[action] || 'fa-circle'
}

function fmtDateRelative(dateStr) {
  if (!dateStr) return '—'
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return Math.floor(diff/60) + 'm ago'
  if (diff < 86400) return Math.floor(diff/3600) + 'h ago'
  if (diff < 604800) return Math.floor(diff/86400) + 'd ago'
  return fmtDate(dateStr)
}

// Close notifications when clicking outside
document.addEventListener('click', (e) => {
  const panel = document.getElementById('cp-notif-panel')
  const btn = document.getElementById('cp-notif-btn')
  if (panel && btn && !panel.contains(e.target) && !btn.contains(e.target)) {
    panel.style.display = 'none'
  }
})
