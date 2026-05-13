// ═══════════════════════════════════════════════════════════════
// Leads — Admin/PM/PC create leads, Sales Agents follow up.
// Each new lead auto-creates a follow-up task in lead_tasks
// with due_date = lead created_at + 4 hours.
// ═══════════════════════════════════════════════════════════════

let _leadsPage = 1
let _leadsStatusFilter = ''
let _leadsFromDate = ''
let _leadsToDate = ''
let _leadsAssigneeFilter = ''
let _leadsSourceFilter = ''
let _leadsAssigneeOptionsCache = []

// Statuses are seeded on the server (5 defaults each) and editable via
// the "Manage Statuses" modal. Cached after the first fetch and refreshed
// whenever the user mutates them.
let LEAD_STATUS_META = {}
let LEAD_TASK_STATUS_META = {}
let _leadStatusOrder = []
let _leadTaskStatusOrder = []

const LEAD_BADGE_OPTIONS = ['todo', 'inprogress', 'review', 'done', 'critical', 'medium']

async function loadLeadStatuses(force = false) {
  if (!force && _leadStatusOrder.length && _leadTaskStatusOrder.length) return
  try {
    const res = await API.get('/leads/statuses')
    const lead = res.lead || res.data?.lead || []
    const task = res.task || res.data?.task || []
    LEAD_STATUS_META = {}
    _leadStatusOrder = []
    for (const s of lead) {
      LEAD_STATUS_META[s.key] = { label: s.label, badge: s.badge, id: s.id, is_system: s.is_system }
      _leadStatusOrder.push(s.key)
    }
    LEAD_TASK_STATUS_META = {}
    _leadTaskStatusOrder = []
    for (const s of task) {
      LEAD_TASK_STATUS_META[s.key] = { label: s.label, badge: s.badge, id: s.id, is_system: s.is_system }
      _leadTaskStatusOrder.push(s.key)
    }
  } catch (e) {
    if (!_leadStatusOrder.length) {
      LEAD_STATUS_META = { new: { label: 'New', badge: 'todo' } }
      _leadStatusOrder = ['new']
    }
    if (!_leadTaskStatusOrder.length) {
      LEAD_TASK_STATUS_META = { pending: { label: 'Pending', badge: 'todo' } }
      _leadTaskStatusOrder = ['pending']
    }
  }
}

// Backed by /leads/sources — populated on first use, refreshed when the user
// edits the catalog through the Manage Sources modal. The 'Other' suffix is
// always shown so a custom source can be typed in even when the catalog is
// short.
let LEAD_SOURCE_OPTIONS = ['Other']
let _leadSources = []

async function loadLeadSources(force = false) {
  if (!force && _leadSources.length) return
  try {
    const res = await API.get('/leads/sources')
    const list = res.sources || res.data || []
    _leadSources = list
    const labels = list.map((s) => s.label).filter(Boolean)
    LEAD_SOURCE_OPTIONS = labels.includes('Other') ? labels : [...labels, 'Other']
  } catch (e) {
    if (!_leadSources.length) {
      _leadSources = []
      LEAD_SOURCE_OPTIONS = ['PPC', 'SEO', 'Other']
    }
  }
}

function onLeadSourceChange(selectEl) {
  const wrap = document.getElementById('lead-source-other-wrap')
  const input = document.getElementById('lead-source-other')
  if (!wrap || !input) return
  if (selectEl.value === 'Other') {
    wrap.style.display = ''
    input.focus()
  } else {
    wrap.style.display = 'none'
    input.value = ''
  }
}

function uploadLeadFile(file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/uploads', true)
    const token = (window._token || (typeof _token !== 'undefined' && _token) || localStorage.getItem('token'))
    if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token)
    xhr.onload = () => {
      let data = {}
      try { data = JSON.parse(xhr.responseText) } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data)
      else reject(new Error(data?.error || `HTTP ${xhr.status}`))
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    const fd = new FormData()
    fd.append('file', file)
    xhr.send(fd)
  })
}

async function resolveLeadRequirementFile(currentFile) {
  const input = document.getElementById('lead-file')
  const f = input?.files?.[0]
  if (!f) {
    // No new file picked — keep existing (edit) or null (create)
    return currentFile || null
  }
  try {
    const res = await uploadLeadFile(f)
    return {
      url: res.url || res.file_url || '',
      name: res.original_name || res.name || f.name,
      mime: res.mime_type || res.mime || f.type,
      size: Number(res.size || f.size || 0),
    }
  } catch (e) {
    toast('File upload failed: ' + e.message, 'error')
    throw e
  }
}

function resolveLeadSource() {
  const selectEl = document.getElementById('lead-source')
  if (!selectEl) return ''
  if (selectEl.value === 'Other') {
    const custom = (document.getElementById('lead-source-other')?.value || '').trim()
    return custom
  }
  return selectEl.value
}

function leadsCanManage() {
  return ['admin', 'pm', 'pc', 'sales_manager', 'sales_tl'].includes(String(_user?.role || '').toLowerCase())
}

async function fetchSalesAssignees() {
  try {
    const res = await API.get('/users')
    const users = res.users || res.data || []
    return users
      .filter((u) => Number(u.is_active || 0) === 1)
      .filter((u) => ['sales_agent', 'sales_tl', 'sales_manager'].includes(String(u.role || '').toLowerCase()))
      .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')))
  } catch {
    return []
  }
}

async function renderLeadsView(el) {
  el.innerHTML = `<div style="padding:24px;color:#64748b"><i class="fas fa-spinner fa-spin"></i> Loading leads…</div>`
  try {
    await Promise.all([loadLeadStatuses(), loadLeadSources()])
    const [leadsRes, assignees] = await Promise.all([
      API.get('/leads'),
      fetchSalesAssignees().catch(() => []),
    ])
    _leadsAssigneeOptionsCache = assignees
    const leads = leadsRes.data || leadsRes.leads || []
    const statusCounts = leads.reduce((acc, l) => {
      const key = String(l.status || 'new').toLowerCase()
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})

    const filtered = applyLeadsFilters(leads)
    const pagination = paginateClient(filtered, _leadsPage, 10)
    _leadsPage = pagination.page
    const canManage = leadsCanManage()
    const activeFilterCount =
      (_leadsFromDate ? 1 : 0) +
      (_leadsToDate ? 1 : 0) +
      (_leadsAssigneeFilter ? 1 : 0) +
      (_leadsSourceFilter ? 1 : 0)

    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Leads</h1>
          <p class="page-subtitle">${leads.length} total leads · ${pagination.total} shown</p>
        </div>
        <div class="page-actions" style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" onclick="exportLeadsCsv()" title="Download filtered leads as CSV"><i class="fas fa-file-export"></i> Export</button>
          ${canManage ? `<button class="btn btn-secondary btn-sm" onclick="openImportLeadsModal()"><i class="fas fa-file-csv"></i> Import</button>` : ''}
          ${canManage ? `<button class="btn btn-secondary btn-sm" onclick="openManageLeadStatusesModal()"><i class="fas fa-tags"></i> Manage Statuses</button>
          <button class="btn btn-secondary btn-sm" onclick="openManageLeadSourcesModal()"><i class="fas fa-bullhorn"></i> Manage Sources</button>
          <button class="btn btn-primary btn-sm" onclick="openCreateLeadModal()"><i class="fas fa-plus"></i> New Lead</button>` : ''}
        </div>
      </div>

      <div class="card" style="margin-bottom:12px">
        <div class="card-body" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:12px 16px">
          <div class="search-wrap" style="flex:1;min-width:240px">
            <i class="fas fa-search"></i>
            <input class="search-bar" placeholder="Search leads…" oninput="filterTable(this.value,'leads-table')"/>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${['', ..._leadStatusOrder].map((s) => {
              const meta = s ? LEAD_STATUS_META[s] : { label: 'All' }
              const count = s ? (statusCounts[s] || 0) : leads.length
              const active = _leadsStatusFilter === s
              return `<button class="btn btn-sm ${active ? 'btn-primary' : 'btn-outline'}" onclick="filterLeadsByStatus('${s}')">${meta?.label || s} <span style="opacity:.7;margin-left:4px">${count}</span></button>`
            }).join('')}
          </div>
        </div>
        <div class="card-body" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;padding:0 16px 12px">
          <div class="form-group" style="margin:0;min-width:160px">
            <label class="form-label" style="font-size:11px">From date</label>
            <input id="leads-filter-from" type="date" class="form-input" value="${_leadsFromDate}" onchange="onLeadsFilterChange()"/>
          </div>
          <div class="form-group" style="margin:0;min-width:160px">
            <label class="form-label" style="font-size:11px">To date</label>
            <input id="leads-filter-to" type="date" class="form-input" value="${_leadsToDate}" onchange="onLeadsFilterChange()"/>
          </div>
          <div class="form-group" style="margin:0;min-width:200px">
            <label class="form-label" style="font-size:11px">Assigned to</label>
            <select id="leads-filter-assignee" class="form-select" onchange="onLeadsFilterChange()">
              <option value="">All assignees</option>
              ${assignees.map((u) => `<option value="${u.id}" ${_leadsAssigneeFilter === u.id ? 'selected' : ''}>${escapeHtml(u.full_name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="margin:0;min-width:180px">
            <label class="form-label" style="font-size:11px">Source</label>
            <select id="leads-filter-source" class="form-select" onchange="onLeadsFilterChange()">
              <option value="">All sources</option>
              ${LEAD_SOURCE_OPTIONS.filter((s) => s !== 'Other').map((s) => `<option value="${escapeHtml(s)}" ${_leadsSourceFilter === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
            </select>
          </div>
          ${activeFilterCount ? `<button class="btn btn-outline btn-sm" onclick="clearLeadsFilters()" style="margin-bottom:2px"><i class="fas fa-times"></i> Clear (${activeFilterCount})</button>` : ''}
        </div>
      </div>

      <div class="card">
        <div class="card-body p-0 table-wrap">
          <table class="data-table" id="leads-table">
            <thead><tr>
              <th>Name</th>
              <th>Contact</th>
              <th>Source</th>
              <th>Assigned To</th>
              <th>Status</th>
              <th>Follow-up Due</th>
              <th style="width:140px">Actions</th>
            </tr></thead>
            <tbody>
              ${pagination.items.map((l) => renderLeadRow(l, canManage)).join('') || `<tr><td colspan="7" style="text-align:center;color:#64748b;padding:24px">No leads match the current filter.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
      ${renderPager(pagination, 'goLeadsPage', 'goLeadsPage', 'leads', 'leads-view')}
    `
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>`
  }
}

function applyLeadsFilters(leads) {
  return leads.filter((l) => {
    if (_leadsStatusFilter && String(l.status || '').toLowerCase() !== _leadsStatusFilter) return false
    if (_leadsAssigneeFilter && String(l.assigned_to || '') !== String(_leadsAssigneeFilter)) return false
    if (_leadsSourceFilter && String(l.source || '') !== _leadsSourceFilter) return false
    if (_leadsFromDate) {
      const created = l.created_at ? new Date(l.created_at).getTime() : 0
      const from = new Date(_leadsFromDate + 'T00:00:00').getTime()
      if (created < from) return false
    }
    if (_leadsToDate) {
      const created = l.created_at ? new Date(l.created_at).getTime() : 0
      const to = new Date(_leadsToDate + 'T23:59:59').getTime()
      if (created > to) return false
    }
    return true
  })
}

function onLeadsFilterChange() {
  _leadsFromDate = document.getElementById('leads-filter-from')?.value || ''
  _leadsToDate = document.getElementById('leads-filter-to')?.value || ''
  _leadsAssigneeFilter = document.getElementById('leads-filter-assignee')?.value || ''
  _leadsSourceFilter = document.getElementById('leads-filter-source')?.value || ''
  _leadsPage = 1
  const el = document.getElementById('page-leads-view')
  if (el) { el.dataset.loaded = ''; loadPage('leads-view', el) }
}

function clearLeadsFilters() {
  _leadsFromDate = ''
  _leadsToDate = ''
  _leadsAssigneeFilter = ''
  _leadsSourceFilter = ''
  _leadsPage = 1
  const el = document.getElementById('page-leads-view')
  if (el) { el.dataset.loaded = ''; loadPage('leads-view', el) }
}

// ── CSV Export ──────────────────────────────────────────────
async function exportLeadsCsv() {
  try {
    const res = await API.get('/leads')
    const all = res.data || res.leads || []
    const leads = applyLeadsFilters(all)
    if (!leads.length) { toast('No leads match the current filter', 'info'); return }

    const headers = ['name', 'email', 'phone', 'source', 'status', 'requirement', 'assigned_to_name', 'assigned_to_email', 'created_at']
    const csvEscape = (v) => {
      const s = v === null || v === undefined ? '' : String(v)
      if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
      return s
    }
    const lines = [headers.join(',')]
    for (const l of leads) {
      lines.push([
        l.name,
        l.email,
        l.phone,
        l.source,
        l.status,
        l.requirement,
        l.assigned_to_name || '',
        l.assigned_to_email || '',
        l.created_at,
      ].map(csvEscape).join(','))
    }
    const csv = lines.join('\n') + '\n'
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `leads_export_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast(`Exported ${leads.length} lead${leads.length === 1 ? '' : 's'}`, 'success')
  } catch (e) {
    toast('Export failed: ' + (e.message || 'unknown'), 'error')
  }
}

// ── CSV Import ──────────────────────────────────────────────
function downloadLeadsImportTemplate() {
  const headers = 'name,email,phone,source,requirement,assigned_to_name,status'
  // Pre-fill the sample with a real assignee from the current sales team so the
  // template is import-ready out of the box. Falls back to a placeholder name
  // if the cache hasn't been populated yet.
  const sampleAssignee = (_leadsAssigneeOptionsCache && _leadsAssigneeOptionsCache[0]?.full_name) || 'Sales Agent Name'
  const csvEscape = (v) => /[",\n\r]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v)
  const rows = [
    ['Rahul Sharma', 'rahul@acme.com', '+91-9876543210', 'PPC', 'Looking for a website rebuild', sampleAssignee, 'new'].map(csvEscape).join(','),
    ['Priya Verma', 'priya@globex.com', '+91-9876500001', 'SEO', 'Needs an iOS + Android app', sampleAssignee, 'contacted'].map(csvEscape).join(','),
    ['Aman Singh', 'aman@initech.com', '+91-9876500002', 'Referral', 'Custom CRM dashboard', sampleAssignee, 'qualified'].map(csvEscape).join(','),
  ]
  const csv = [headers, ...rows].join('\n') + '\n'
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'leads_import_template.csv'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function openImportLeadsModal() {
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-file-csv" style="color:var(--accent);margin-right:6px"></i>Import Leads</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div style="padding:12px 14px;border-radius:10px;background:rgba(255,180,120,0.10);border:1px solid rgba(255,180,120,0.25);font-size:12.5px;line-height:1.55;color:var(--text-secondary)">
        <i class="fas fa-circle-info" style="color:var(--accent);margin-right:6px"></i>
        Upload a <strong>CSV file</strong> with a header row. Excel users: <em>File → Save As → CSV (UTF-8)</em>.<br/>
        <strong>Required columns:</strong> name, email, phone, source, requirement, assigned_to_name<br/>
        <strong>Optional:</strong> status (defaults to <code>new</code>)<br/>
        <strong>assigned_to_name</strong> must match the full name of an existing sales user (case-insensitive) — unmatched rows are skipped.
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn btn-outline btn-sm" onclick="downloadLeadsImportTemplate()"><i class="fas fa-download"></i> Download sample template</button>
      </div>

      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">CSV File *</label>
        <input id="leads-import-file" type="file" accept=".csv,text/csv" class="form-input" style="padding:10px"/>
        <div class="form-hint">Pick a .csv file (Excel users: File → Save As → CSV UTF-8).</div>
      </div>

      <div id="leads-import-result" style="display:none"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="leads-import-submit" onclick="submitImportLeads()"><i class="fas fa-upload"></i> Import</button>
    </div>
  `, 'modal-lg')
}

async function submitImportLeads() {
  const fileInput = document.getElementById('leads-import-file')
  const submitBtn = document.getElementById('leads-import-submit')
  const file = fileInput?.files?.[0]
  if (!file) { toast('Please choose a CSV file', 'error'); return }
  if (!/\.csv$/i.test(file.name || '')) {
    toast('Invalid file format — please upload a .csv file', 'error')
    return
  }
  const csv = (await file.text()).trim()
  if (!csv) { toast('CSV file is empty', 'error'); return }

  if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing…' }
  try {
    const res = await API.post('/leads/import', { csv })
    const created = res.created_count || 0
    const errCount = res.error_count || 0
    const errors = res.errors || []

    const el = document.getElementById('page-leads-view')
    if (el) { el.dataset.loaded = ''; loadPage('leads-view', el) }

    if (errCount > 0) {
      const result = document.getElementById('leads-import-result')
      if (result) {
        result.style.display = ''
        result.innerHTML = `
          <div style="padding:12px 14px;border-radius:10px;background:rgba(88,198,138,0.10);border:1px solid rgba(88,198,138,0.30);color:#86E0A8;font-size:13px;margin-bottom:8px">
            <i class="fas fa-check-circle"></i> <strong>${created}</strong> leads imported successfully.
          </div>
          <div style="padding:12px 14px;border-radius:10px;background:rgba(255,94,58,0.10);border:1px solid rgba(255,94,58,0.30);color:#FF8866;font-size:12.5px;line-height:1.5">
            <i class="fas fa-triangle-exclamation"></i> <strong>${errCount}</strong> rows skipped:
            <ul style="margin:6px 0 0 18px;padding:0">
              ${errors.slice(0, 25).map(e => `<li>Row ${e.row}${e.email ? ' (' + escapeHtml(e.email) + ')' : ''}: ${escapeHtml(e.error)}</li>`).join('')}
              ${errors.length > 25 ? `<li>…and ${errors.length - 25} more</li>` : ''}
            </ul>
          </div>
        `
      }
      toast(`${created} imported, ${errCount} skipped`, 'warning')
    } else {
      toast(`${created} lead${created === 1 ? '' : 's'} imported successfully`, 'success')
      closeModal()
    }
  } catch (e) {
    toast('Import failed: ' + (e.message || 'unknown'), 'error')
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-upload"></i> Import' }
  }
}

function renderLeadRow(l, canManage) {
  const key = String(l.status || 'new').toLowerCase()
  const meta = LEAD_STATUS_META[key] || { label: key, badge: 'todo' }
  const openTask = (l.tasks || []).find((t) => t.status !== 'done' && t.status !== 'skipped')
  const due = openTask?.due_date ? fmtDateTime(openTask.due_date) : '—'
  const overdue = openTask?.due_date && new Date(openTask.due_date).getTime() < Date.now()
  return `<tr>
    <td>
      <div style="display:flex;align-items:center;gap:10px;cursor:pointer" onclick="goLeadDetail('${l.id}')" title="Open lead detail">
        ${avatar(l.name, '#FF7A45', 'sm')}
        <div>
          <div style="font-weight:600;color:#e2e8f0">${escapeHtml(l.name)}</div>
          <div style="font-size:11px;color:#64748b">${escapeHtml(String(l.requirement || '').slice(0, 80))}${(l.requirement || '').length > 80 ? '…' : ''}</div>
        </div>
      </div>
    </td>
    <td>
      <div style="font-size:12px;color:#94a3b8">${escapeHtml(l.email || '—')}</div>
      <div style="font-size:11px;color:#64748b">${escapeHtml(l.phone || '')}</div>
    </td>
    <td><span style="font-size:12px;color:#94a3b8">${escapeHtml(l.source || '—')}</span></td>
    <td>${l.assigned_to_name ? `<span style="font-size:12px">${escapeHtml(l.assigned_to_name)}</span>` : '<span style="color:#64748b">—</span>'}</td>
    <td><span class="badge badge-${meta.badge}">${escapeHtml(meta.label)}</span></td>
    <td><span style="font-size:12px;${overdue ? 'color:#FF5E3A;font-weight:600' : 'color:#94a3b8'}">${due}${overdue ? ' (overdue)' : ''}</span></td>
    <td>
      <div style="display:flex;gap:4px">
        <button class="btn btn-xs btn-outline" title="Open detail page" onclick="goLeadDetail('${l.id}')"><i class="fas fa-up-right-from-square"></i></button>
        ${canManage ? `<button class="btn btn-xs btn-outline" title="Delete" onclick="confirmDeleteLead('${l.id}','${escapeHtml(l.name).replace(/'/g, "\\'")}')"><i class="fas fa-trash"></i></button>` : ''}
      </div>
    </td>
  </tr>`
}

function fmtDateTime(value) {
  if (!value) return '—'
  try {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return '—'
    const pad = (n) => String(n).padStart(2, '0')
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return '—'
  }
}

function filterLeadsByStatus(status) {
  _leadsStatusFilter = status || ''
  _leadsPage = 1
  const el = document.getElementById('page-leads-view')
  if (el) { el.dataset.loaded = ''; loadPage('leads-view', el) }
}

function goLeadsPage(page) {
  _leadsPage = Math.max(1, Number(page) || 1)
  const el = document.getElementById('page-leads-view')
  if (el) { el.dataset.loaded = ''; loadPage('leads-view', el) }
}

async function openCreateLeadModal() {
  await loadLeadSources()
  const assignees = await fetchSalesAssignees()
  if (!assignees.length) {
    toast('No sales agents available — create one first.', 'error')
    return
  }
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-bullseye" style="color:#FF7A45;margin-right:8px"></i>New Lead</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Full Name *</label><input id="lead-name" class="form-input" placeholder="Lead name" autofocus/></div>
        <div class="form-group"><label class="form-label">Email *</label><input id="lead-email" type="email" class="form-input" placeholder="lead@company.com"/></div>
        <div class="form-group"><label class="form-label">Phone *</label><input id="lead-phone" class="form-input" placeholder="+91…"/></div>
        <div class="form-group"><label class="form-label">Source *</label>
          <select id="lead-source" class="form-select" onchange="onLeadSourceChange(this)">
            ${LEAD_SOURCE_OPTIONS.map((s) => `<option value="${s}">${s}</option>`).join('')}
          </select>
          <div id="lead-source-other-wrap" style="display:none;margin-top:8px">
            <input id="lead-source-other" class="form-input" placeholder="Specify source"/>
          </div>
        </div>
        <div class="form-group" style="grid-column:1/-1"><label class="form-label">Requirement *</label>
          <textarea id="lead-requirement" class="form-input" rows="3" placeholder="What is the lead looking for?"></textarea>
          <div style="margin-top:8px">
            <label class="form-label" style="font-size:12px;color:var(--text-muted)">Attach file (optional)</label>
            <input id="lead-file" type="file" class="form-input" style="padding:6px"/>
            <div class="form-hint" style="font-size:11px;color:#94a3b8;margin-top:4px">PDFs, images, or docs — text and file are both supported.</div>
          </div>
        </div>
        <div class="form-group" style="grid-column:1/-1"><label class="form-label">Assign To *</label>
          <select id="lead-assigned-to" class="form-select">
            ${assignees.map((u) => `<option value="${u.id}">${escapeHtml(u.full_name)} — ${escapeHtml(u.role)}</option>`).join('')}
          </select>
          <div class="form-hint" style="font-size:11px;color:#94a3b8;margin-top:6px">Schedule follow-ups manually from the lead detail page.</div>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitNewLead()"><i class="fas fa-save"></i> Create Lead</button>
    </div>
  `, 'modal-lg')
}

async function submitNewLead() {
  const source = resolveLeadSource()
  const payload = {
    name: document.getElementById('lead-name').value.trim(),
    email: document.getElementById('lead-email').value.trim(),
    phone: document.getElementById('lead-phone').value.trim(),
    source,
    requirement: document.getElementById('lead-requirement').value.trim(),
    assigned_to: document.getElementById('lead-assigned-to').value,
  }
  if (!payload.name || !payload.email || !payload.phone || !payload.assigned_to) {
    toast('Please fill in all required fields', 'error')
    return
  }
  if (!source) {
    toast('Please specify the source', 'error')
    return
  }
  // Either text or file (or both) must be provided.
  const hasFile = !!document.getElementById('lead-file')?.files?.[0]
  if (!payload.requirement && !hasFile) {
    toast('Add a requirement description or attach a file', 'error')
    return
  }
  if (!payload.requirement) payload.requirement = hasFile ? '(see attached file)' : ''
  try {
    let file = null
    try { file = await resolveLeadRequirementFile(null) } catch { return }
    if (file) payload.requirement_file = file
    await API.post('/leads', payload)
    toast('Lead created', 'success')
    closeModal()
    const el = document.getElementById('page-leads-view')
    if (el) { el.dataset.loaded = ''; loadPage('leads-view', el) }
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

async function openEditLeadModal(id) {
  try {
    await Promise.all([loadLeadStatuses(), loadLeadSources()])
    const [leadRes, assignees] = await Promise.all([
      API.get(`/leads/${id}`),
      fetchSalesAssignees(),
    ])
    const lead = leadRes.data || leadRes.lead
    if (!lead) { toast('Lead not found', 'error'); return }
    showModal(`
      <div class="modal-header">
        <h3><i class="fas fa-bullseye" style="color:#FF7A45;margin-right:8px"></i>Edit Lead</h3>
        <button class="close-btn" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <div class="grid-2">
          <div class="form-group"><label class="form-label">Full Name *</label><input id="lead-name" class="form-input" value="${escapeHtml(lead.name)}"/></div>
          <div class="form-group"><label class="form-label">Email *</label><input id="lead-email" type="email" class="form-input" value="${escapeHtml(lead.email)}"/></div>
          <div class="form-group"><label class="form-label">Phone *</label><input id="lead-phone" class="form-input" value="${escapeHtml(lead.phone || '')}"/></div>
          <div class="form-group"><label class="form-label">Source *</label>
            ${(() => {
              const isPreset = LEAD_SOURCE_OPTIONS.includes(lead.source) && lead.source !== 'Other'
              const selectVal = isPreset ? lead.source : 'Other'
              const customVal = isPreset ? '' : (lead.source || '')
              return `
                <select id="lead-source" class="form-select" onchange="onLeadSourceChange(this)">
                  ${LEAD_SOURCE_OPTIONS.map((s) => `<option value="${s}" ${selectVal === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
                <div id="lead-source-other-wrap" style="display:${selectVal === 'Other' ? '' : 'none'};margin-top:8px">
                  <input id="lead-source-other" class="form-input" placeholder="Specify source" value="${escapeHtml(customVal)}"/>
                </div>
              `
            })()}
          </div>
          <div class="form-group"><label class="form-label">Status</label>
            <select id="lead-status" class="form-select" ${lead.status === 'closed' ? 'disabled' : ''}>
              ${_leadStatusOrder
                .filter((k) => k !== 'closed' || lead.status === 'closed')
                .map((k) => `<option value="${k}" ${lead.status === k ? 'selected' : ''}>${escapeHtml(LEAD_STATUS_META[k]?.label || k)}</option>`)
                .join('')}
            </select>
            ${lead.status !== 'closed' ? '<div class="form-hint" style="font-size:11px;color:#94a3b8;margin-top:4px">To close this lead, use <strong>Close &amp; Convert to Client</strong> from the detail view — it collects client info and emails credentials.</div>' : ''}
          </div>
          <div class="form-group"><label class="form-label">Assign To *</label>
            <select id="lead-assigned-to" class="form-select">
              ${assignees.map((u) => `<option value="${u.id}" ${String(lead.assigned_to) === String(u.id) ? 'selected' : ''}>${escapeHtml(u.full_name)} — ${escapeHtml(u.role)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="grid-column:1/-1"><label class="form-label">Requirement *</label>
            <textarea id="lead-requirement" class="form-input" rows="3">${escapeHtml(lead.requirement || '')}</textarea>
            <div style="margin-top:8px">
              <label class="form-label" style="font-size:12px;color:var(--text-muted)">Attach file (optional)</label>
              <div id="lead-existing-file-wrap" style="display:${lead.requirement_file?.url ? '' : 'none'};margin-bottom:6px;font-size:12px;color:#cbd5e1">
                <i class="fas fa-paperclip"></i>
                <a href="${lead.requirement_file?.url || ''}" target="_blank" rel="noopener" style="color:#FF7A45">${escapeHtml(lead.requirement_file?.name || '')}</a>
                <button type="button" class="btn btn-xs btn-outline" style="margin-left:8px" onclick="removeLeadExistingFile()">Remove</button>
                <input type="hidden" id="lead-existing-file" value='${lead.requirement_file ? escapeHtml(JSON.stringify(lead.requirement_file)) : ''}'/>
              </div>
              <input id="lead-file" type="file" class="form-input" style="padding:6px"/>
              <div class="form-hint" style="font-size:11px;color:#94a3b8;margin-top:4px">Pick a new file to replace the current attachment, or leave blank to keep it.</div>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        ${!lead.client_id ? `<button class="btn btn-success" onclick="closeModal();openCloseLeadModal('${lead.id}')"><i class="fas fa-handshake"></i> Close &amp; Convert to Client</button>` : '<span style="font-size:12px;color:#58C68A;align-self:center"><i class="fas fa-check-circle"></i> Client created</span>'}
        <button class="btn btn-primary" onclick="submitEditLead('${lead.id}')"><i class="fas fa-save"></i> Update Lead</button>
      </div>
    `, 'modal-lg')
  } catch (e) {
    toast('Failed to load lead: ' + e.message, 'error')
  }
}

function removeLeadExistingFile() {
  const wrap = document.getElementById('lead-existing-file-wrap')
  const hidden = document.getElementById('lead-existing-file')
  if (wrap) wrap.style.display = 'none'
  if (hidden) hidden.value = ''
}

async function submitEditLead(id) {
  const source = resolveLeadSource()
  if (!source) { toast('Please specify the source', 'error'); return }
  let existingFile = null
  try {
    const raw = document.getElementById('lead-existing-file')?.value
    if (raw) existingFile = JSON.parse(raw)
  } catch {}
  let file
  try { file = await resolveLeadRequirementFile(existingFile) } catch { return }
  const requirementText = document.getElementById('lead-requirement').value.trim()
  if (!requirementText && !file) {
    toast('Add a requirement description or attach a file', 'error')
    return
  }
  const payload = {
    name: document.getElementById('lead-name').value.trim(),
    email: document.getElementById('lead-email').value.trim(),
    phone: document.getElementById('lead-phone').value.trim(),
    source,
    status: document.getElementById('lead-status').value,
    requirement: requirementText || '(see attached file)',
    requirement_file: file,
    assigned_to: document.getElementById('lead-assigned-to').value,
  }
  try {
    await API.put(`/leads/${id}`, payload)
    toast('Lead updated', 'success')
    closeModal()
    const el = document.getElementById('page-leads-view')
    if (el) { el.dataset.loaded = ''; loadPage('leads-view', el) }
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

// Tracks the active tab and any in-flight attachments for the current lead
// detail modal so re-renders can preserve selection.
let _leadDetailState = { id: null, tab: 'followups', attachments: [] }

// Quick-view modal removed — every caller (alarm popups, row clicks, tab
// shortcuts) now routes to the full lead detail page instead.
function openLeadDetailModal(id, _opts = {}) {
  goLeadDetail(id)
}

function closeLeadDetailModal() {
  // Kept as a no-op for any stale callers; the modal no longer exists.
  closeModal()
}

function renderLeadDetailFollowups(lead) {
  const id = lead.id
  const isTerminal = (k) => k === 'done' || k === 'skipped' || k === 'cancelled'
  const tasksHtml = (lead.tasks || []).map((t) => {
    const tkey = String(t.status || 'pending').toLowerCase()
    const tmeta = LEAD_TASK_STATUS_META[tkey] || { label: tkey, badge: 'todo' }
    const overdue = t.due_date && !isTerminal(tkey) && new Date(t.due_date).getTime() < Date.now()
    const canUpdate = leadsCanManage() || String(t.assigned_to) === String(_user?.sub || _user?.id || '')
    const snooze = Number(t.snooze_minutes ?? 10)
    return `<div style="padding:12px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;background:rgba(255,255,255,.02)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
        <strong style="font-size:13px">${escapeHtml(t.title)}</strong>
        <span class="badge badge-${tmeta.badge}">${escapeHtml(tmeta.label)}</span>
      </div>
      <div style="font-size:12px;color:#94a3b8">Due: <span style="${overdue ? 'color:#FF5E3A;font-weight:600' : ''}">${fmtDateTime(t.due_date)}${overdue ? ' (overdue)' : ''}</span> · Alarm ${snooze}m before</div>
      ${t.notes ? `<div style="font-size:12px;color:#cbd5e1;margin-top:6px;padding:6px;background:rgba(0,0,0,.2);border-radius:4px">${escapeHtml(t.notes)}</div>` : ''}
      ${canUpdate ? `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        ${_leadTaskStatusOrder.map((k) => `<button class="btn btn-xs ${t.status === k ? 'btn-primary' : 'btn-outline'}" onclick="updateLeadTaskStatus('${t.id}','${k}','${id}')">${escapeHtml(LEAD_TASK_STATUS_META[k]?.label || k)}</button>`).join('')}
        <span style="font-size:11px;color:#64748b">Snooze:</span>
        <input type="number" min="0" max="1440" value="${snooze}" id="snooze-${t.id}" style="width:70px;padding:3px 6px;border-radius:4px;border:1px solid var(--border);background:rgba(0,0,0,.25);color:#e2e8f0;font-size:12px"/>
        <button class="btn btn-xs btn-outline" onclick="updateFollowupSnooze('${t.id}','${id}')"><i class="fas fa-bell"></i> Save</button>
      </div>` : ''}
    </div>`
  }).join('') || '<div style="font-size:12px;color:#64748b;padding:8px">No follow-up tasks yet.</div>'

  const canAdd = leadsCanManage() || String(lead.assigned_to) === String(_user?.sub || _user?.id || '')
  const addForm = canAdd ? `
    <div style="margin-top:12px;padding:10px;border:1px dashed var(--border);border-radius:8px">
      <div style="font-size:12px;font-weight:600;margin-bottom:6px">Schedule new follow-up</div>
      <div class="grid-2" style="gap:8px">
        <div class="form-group" style="margin:0">
          <input id="new-followup-title" class="form-input" placeholder="Title (e.g. Call back tomorrow)"/>
        </div>
        <div class="form-group" style="margin:0">
          <input id="new-followup-due" class="form-input" type="datetime-local"/>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
        <label style="font-size:11px;color:#64748b">Alarm minutes before</label>
        <input id="new-followup-snooze" type="number" class="form-input" min="0" max="1440" value="10" style="width:90px"/>
        <button class="btn btn-sm btn-primary" style="margin-left:auto" onclick="submitNewFollowup('${id}')"><i class="fas fa-plus"></i> Schedule</button>
      </div>
    </div>` : ''

  return tasksHtml + addForm
}

async function switchLeadDetailTab(id, tab) {
  _leadDetailState.tab = tab
  // Update tab button styles in place (cheap re-render of just the tab body)
  const body = document.getElementById('lead-detail-tab-body')
  if (!body) return
  if (tab === 'followups') {
    try {
      const res = await API.get(`/leads/${id}`)
      const lead = res.data || res.lead
      body.innerHTML = renderLeadDetailFollowups(lead)
    } catch (e) { body.innerHTML = `<div style="color:#FF5E3A">${e.message}</div>` }
  } else if (tab === 'comments') {
    body.innerHTML = '<div style="color:#64748b;font-size:12px;padding:8px"><i class="fas fa-spinner fa-spin"></i> Loading comments…</div>'
    loadLeadComments(id)
  } else if (tab === 'timeline') {
    body.innerHTML = '<div style="color:#64748b;font-size:12px;padding:8px"><i class="fas fa-spinner fa-spin"></i> Loading timeline…</div>'
    loadLeadTimeline(id)
  }
  // Re-render tab buttons by reopening — cheaper than threading a partial diff.
  // We rely on the modal already being on screen so no flicker happens.
  const tabs = document.querySelectorAll('.modal-body > div:nth-of-type(3) button')
  tabs.forEach((btn) => {
    const isActive = btn.textContent.trim().toLowerCase().includes(tab.replace('s',''))
    if (!isActive) return
    btn.classList.add('btn-primary'); btn.classList.remove('btn-outline')
  })
  // Simpler approach — just re-open the modal so all tab styles refresh.
  openLeadDetailModal(id, { tab })
}

async function loadLeadComments(id) {
  const body = document.getElementById('lead-detail-tab-body')
  if (!body) return
  try {
    const res = await API.get(`/leads/${id}/comments`)
    const comments = res.data || res.comments || []
    const list = comments.map((c) => `
      <div style="padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;background:rgba(255,255,255,.02)">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;margin-bottom:4px">
          <span><strong style="color:#e2e8f0">${escapeHtml(c.author_name || 'Unknown')}</strong>${c.author_role ? ` <span style="color:#64748b">· ${escapeHtml(c.author_role)}</span>` : ''}</span>
          <span>${fmtDateTime(c.created_at)}</span>
        </div>
        <div style="font-size:13px;color:#cbd5e1;white-space:pre-wrap">${escapeHtml(c.text || '')}</div>
      </div>
    `).join('') || '<div style="font-size:12px;color:#64748b;padding:8px">No comments yet.</div>'
    body.innerHTML = `
      ${list}
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
        <textarea id="lead-comment-input" class="form-input" rows="2" placeholder="Write a comment…" style="resize:vertical"></textarea>
        <div style="display:flex;justify-content:flex-end;margin-top:6px">
          <button class="btn btn-sm btn-primary" onclick="submitLeadComment('${id}')"><i class="fas fa-paper-plane"></i> Post Comment</button>
        </div>
      </div>
    `
  } catch (e) {
    body.innerHTML = `<div style="color:#FF5E3A">${escapeHtml(e.message)}</div>`
  }
}

async function submitLeadComment(id) {
  const ta = document.getElementById('lead-comment-input')
  if (!ta) return
  const text = (ta.value || '').trim()
  if (!text) { toast('Write something first', 'error'); return }
  try {
    await API.post(`/leads/${id}/comments`, { text })
    toast('Comment added', 'success')
    loadLeadComments(id)
  } catch (e) { toast('Failed: ' + e.message, 'error') }
}

async function loadLeadTimeline(id) {
  const body = document.getElementById('lead-detail-tab-body')
  if (!body) return
  try {
    const res = await API.get(`/leads/${id}/timeline`)
    const items = res.data || res.timeline || []
    const iconFor = (k) => ({
      lead_created: 'fa-bullseye',
      status_changed: 'fa-tag',
      reassigned: 'fa-user-pen',
      followup_added: 'fa-clock',
      followup_updated: 'fa-clock-rotate-left',
      followup_acknowledged: 'fa-bell-slash',
      comment_added: 'fa-comment',
      mail_sent: 'fa-paper-plane',
      portfolio_sent: 'fa-briefcase',
      scope_sent: 'fa-file-lines',
      quotation_sent: 'fa-file-invoice-dollar',
      lead_closed: 'fa-handshake',
    }[k] || 'fa-circle')
    body.innerHTML = items.map((a) => `
      <div style="display:flex;gap:10px;padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;background:rgba(255,255,255,.02)">
        <div style="width:28px;height:28px;border-radius:50%;background:rgba(255,122,69,.15);color:#FF7A45;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <i class="fas ${iconFor(a.kind)}"></i>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;color:#e2e8f0">${escapeHtml(a.summary || a.kind || '')}</div>
          <div style="font-size:11px;color:#64748b;margin-top:2px">
            <span>${escapeHtml(a.actor_name || 'system')}</span>${a.actor_role ? ` · <span>${escapeHtml(a.actor_role)}</span>` : ''} · <span>${fmtDateTime(a.created_at)}</span>
          </div>
        </div>
      </div>
    `).join('') || '<div style="font-size:12px;color:#64748b;padding:8px">No activity yet.</div>'
  } catch (e) {
    body.innerHTML = `<div style="color:#FF5E3A">${escapeHtml(e.message)}</div>`
  }
}

async function updateFollowupSnooze(taskId, leadId) {
  const input = document.getElementById('snooze-' + taskId)
  if (!input) return
  const minutes = Math.max(0, Math.min(1440, parseInt(input.value || '10', 10)))
  try {
    await API.patch(`/leads/tasks/${taskId}`, { snooze_minutes: minutes })
    toast('Snooze updated', 'success')
    openLeadDetailModal(leadId, { tab: 'followups' })
  } catch (e) { toast('Failed: ' + e.message, 'error') }
}

async function submitNewFollowup(leadId) {
  const titleEl = document.getElementById('new-followup-title')
  const dueEl = document.getElementById('new-followup-due')
  const snoozeEl = document.getElementById('new-followup-snooze')
  const title = (titleEl?.value || '').trim()
  const due = dueEl?.value
  const snooze = parseInt(snoozeEl?.value || '10', 10)
  if (!due) { toast('Pick a due date/time', 'error'); return }
  try {
    await API.post(`/leads/${leadId}/followups`, {
      title: title || undefined,
      due_date: new Date(due).toISOString(),
      snooze_minutes: snooze,
    })
    toast('Follow-up scheduled', 'success')
    openLeadDetailModal(leadId, { tab: 'followups' })
  } catch (e) { toast('Failed: ' + e.message, 'error') }
}

async function openCloseLeadModal(id) {
  if (!leadsCanManage()) { toast('Only admin/PM/PC can close leads', 'error'); return }
  try {
    const [res, pmsRes, pcsRes, salesPersons] = await Promise.all([
      API.get(`/leads/${id}`),
      API.get('/users?role=pm').catch(() => ({ users: [] })),
      API.get('/users?role=pc').catch(() => ({ users: [] })),
      fetchSalesAssignees(),
    ])
    const lead = res.data || res.lead
    if (!lead) { toast('Lead not found', 'error'); return }
    if (lead.client_id) {
      toast('A client has already been created for this lead', 'info')
      return
    }
    const stateOpts = (typeof INDIAN_STATES !== 'undefined' ? INDIAN_STATES : [])
      .map(([n, c]) => `<option value="${n}" data-code="${c}">${n} (${c})</option>`)
      .join('')
    const pms = (pmsRes.users || pmsRes.data || []).filter(u => String(u.role || '').toLowerCase() === 'pm' && Number(u.is_active ?? 1) === 1)
    const pcs = (pcsRes.users || pcsRes.data || []).filter(u => String(u.role || '').toLowerCase() === 'pc' && Number(u.is_active ?? 1) === 1)
    // Sold By defaults to whoever the lead is assigned to — that's the
    // person who actually closed the deal.
    const defaultSoldBy = lead.assigned_to_name || _user?.full_name || _user?.name || ''
    const isAdmin = String(_user?.role || '').toLowerCase() === 'admin'
    showModal(`
      <div class="modal-header">
        <h3><i class="fas fa-handshake" style="color:#58C68A;margin-right:8px"></i>Close Lead & Convert to Client</h3>
        <button class="close-btn" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <div style="padding:10px 12px;background:rgba(88,198,138,.08);border-left:3px solid #58C68A;border-radius:6px;margin-bottom:14px;font-size:12px;color:#cbd5e1">
          A new client account will be created and login credentials emailed to <strong>${escapeHtml(lead.email)}</strong>. The lead will be marked as <strong>Closed</strong>.
        </div>

        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Company &amp; Contact</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Company Name *</label><input class="form-input" id="close-company-name" placeholder="Enter Company Name"/></div>
          <div class="form-group"><label class="form-label">Contact Name *</label><input class="form-input" id="close-contact-name" placeholder="Enter Contact Name" value="${escapeHtml(lead.name || '')}"/></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Email *</label><input class="form-input" id="close-email" type="email" placeholder="Enter Email" value="${escapeHtml(lead.email || '')}"/></div>
          <div class="form-group"><label class="form-label">Password *</label>
            <div style="display:flex;gap:6px">
              <input class="form-input" id="close-password" type="text" placeholder="Enter Your Password"/>
              <button type="button" class="btn btn-outline" onclick="generateClientPassword()" title="Generate strong password"><i class="fas fa-dice"></i></button>
            </div>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Phone</label><input class="form-input" id="close-phone" placeholder="Enter Phone Number" value="${escapeHtml(lead.phone || '')}"/></div>
          <div class="form-group"><label class="form-label">Website</label><input class="form-input" id="close-website" placeholder="Enter Website"/></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Industry</label><input class="form-input" id="close-industry" placeholder="Enter Industry"/></div>
          <div class="form-group"><label class="form-label">Avatar Color</label><input class="form-input" id="close-color" type="color" value="#FF7A45" style="height:40px;padding:3px"/></div>
        </div>

        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin:14px 0 8px">Tax &amp; Address (used on invoices)</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">GSTIN</label><input class="form-input" id="close-gstin" placeholder="Enter GSTIN" style="text-transform:uppercase" maxlength="15"/></div>
          <div class="form-group"><label class="form-label">Country</label><input class="form-input" id="close-country" placeholder="Enter Country" value="India"/></div>
        </div>
        <div class="form-group"><label class="form-label">Company Address</label><textarea class="form-textarea" id="close-address" placeholder="Enter Company Address" style="min-height:50px"></textarea></div>
        <div style="display:grid;grid-template-columns:1fr 1.5fr 1fr;gap:10px">
          <div class="form-group" style="margin:0"><label class="form-label">City</label><input class="form-input" id="close-city" placeholder="City"/></div>
          <div class="form-group" style="margin:0"><label class="form-label">State</label>
            <select class="form-select" id="close-state" onchange="onCloseStateChange(this)">
              <option value="">Select state…</option>
              ${stateOpts}
            </select>
          </div>
          <div class="form-group" style="margin:0"><label class="form-label">State Code</label><input class="form-input" id="close-state-code" placeholder="" maxlength="3" readonly style="background:rgba(15,23,42,.4)"/></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">PIN Code</label><input class="form-input" id="close-pincode" placeholder="Pincode" maxlength="10"/></div>
          <div class="form-group"></div>
        </div>

        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin:14px 0 8px;display:flex;align-items:center;gap:10px">
          <span>Project (optional)</span>
          <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;text-transform:none;color:#cbd5e1;font-weight:500;letter-spacing:0">
            <input type="checkbox" id="close-create-project" onchange="onToggleCloseProject(this.checked)" checked/>
            Create a project for this client
          </label>
        </div>
        <div id="close-project-fields">
          <div class="form-row">
            <div class="form-group"><label class="form-label">Project Name *</label><input class="form-input" id="close-proj-name" placeholder="e.g. ${escapeHtml(lead.name)} — Website Revamp" value="${escapeHtml(lead.requirement ? `${lead.name} — ${String(lead.requirement).slice(0, 60)}` : lead.name)}"/></div>
            <div class="form-group"><label class="form-label">Delivery Kind *</label>
              <select class="form-select" id="close-proj-delivery" onchange="onCloseProjDeliveryChange(this.value)">
                <option value="">— Select —</option>
                <option value="app">App (APP-prefixed code)</option>
                <option value="web">Web (WB-prefixed code)</option>
                <option value="both">Both (BTH-prefixed code)</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Project Code *</label>
              <div style="display:flex;gap:6px">
                <input class="form-input" id="close-proj-code" placeholder="Pick a delivery kind to auto-fill" style="flex:1;text-transform:uppercase" maxlength="40"/>
                <button type="button" class="btn btn-outline btn-sm" onclick="autoFillCloseProjCode()" title="Suggest next code"><i class="fas fa-wand-magic-sparkles"></i></button>
              </div>
            </div>
            <div class="form-group"><label class="form-label">Status</label>
              <select class="form-select" id="close-proj-status">
                <option value="active" selected>Active</option>
                <option value="on_hold">On Hold</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Project Type</label>
              <select class="form-select" id="close-proj-type">
                <option value="development" selected>Development</option>
                <option value="maintenance">Maintenance</option>
                <option value="support">Support</option>
                <option value="consulting">Consulting</option>
              </select>
            </div>
            <div class="form-group"><label class="form-label">Priority</label>
              <select class="form-select" id="close-proj-priority">
                <option value="low">Low</option>
                <option value="medium" selected>Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Start Date *</label><input class="form-input" id="close-proj-start" type="date" value="${new Date().toISOString().slice(0,10)}"/></div>
            <div class="form-group"><label class="form-label">Expected End Date</label><input class="form-input" id="close-proj-end" type="date"/></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Project Manager</label>
              <select class="form-select" id="close-proj-pm">
                <option value="">— None —</option>
                ${pms.map(p => `<option value="${p.id}">${escapeHtml(p.full_name)} (${escapeHtml(String(p.role || '').toUpperCase())})</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label class="form-label">Product Coordinator</label>
              <select class="form-select" id="close-proj-pc">
                <option value="">— None —</option>
                ${pcs.map(c => `<option value="${c.id}">${escapeHtml(c.full_name)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Project Amount (₹)</label><input class="form-input" id="close-proj-amount" type="number" min="0" step="0.01" placeholder="optional"/></div>
            <div class="form-group"><label class="form-label">Billable</label>
              <select class="form-select" id="close-proj-billable">
                <option value="1" selected>Yes</option>
                <option value="0">No</option>
              </select>
            </div>
          </div>
          <div class="form-group"><label class="form-label">Sold By</label>
            <select class="form-select" id="close-proj-sold-by" onchange="onCloseSoldByChange(this.value)">
              <option value="">— Select sales person —</option>
              ${salesPersons.map(p => `<option value="${escapeHtml(p.full_name)}" ${p.full_name === defaultSoldBy ? 'selected' : ''}>${escapeHtml(p.full_name)} · ${escapeHtml(String(p.role || '').replace('sales_','').toUpperCase())}</option>`).join('')}
              ${defaultSoldBy && !salesPersons.some(p => p.full_name === defaultSoldBy) ? `<option value="${escapeHtml(defaultSoldBy)}" selected>${escapeHtml(defaultSoldBy)} (lead assignee)</option>` : ''}
              <option value="__custom__">Other / custom name…</option>
            </select>
            <input class="form-input" id="close-proj-sold-by-custom" placeholder="Type a custom name" style="margin-top:6px;display:none"/>
          </div>
          <div class="form-group"><label class="form-label">Project Description</label>
            <textarea class="form-textarea" id="close-proj-desc" placeholder="Scope, deliverables, notes…" style="min-height:60px">${escapeHtml(lead.requirement || '')}</textarea>
          </div>
          <div class="form-group"><label class="form-label">Remarks</label>
            <textarea class="form-textarea" id="close-proj-remarks" placeholder="Internal remarks (optional)" style="min-height:50px"></textarea>
          </div>

          ${isAdmin ? `<div style="margin-top:10px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:rgba(255,255,255,.02)">
            <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Commercial visibility (admin only)</div>
            <div style="font-size:11px;color:#94a3b8;margin-bottom:8px">Admin always sees Project Amount and Sold By. Pick which other roles can see these.</div>
            <div style="display:flex;gap:14px;flex-wrap:wrap">
              ${['pm','pc','developer','team','client'].map(r => `<label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#cbd5e1;cursor:pointer">
                <input type="checkbox" class="close-proj-commercial-role" value="${r}" style="accent-color:#FF7A45"/>${r.toUpperCase()}
              </label>`).join('')}
            </div>
          </div>` : ''}

          <div style="margin-top:10px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:rgba(255,255,255,.02)">
            <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Attachments <span style="color:#94a3b8;text-transform:none;letter-spacing:0">(25 MB / file)</span></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <input id="close-proj-files-input" type="file" multiple style="display:none" onchange="closeProjAddFiles(this.files);this.value=''"/>
              <button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById('close-proj-files-input').click()"><i class="fas fa-upload"></i> Choose files</button>
              <span style="color:#475569;font-size:11px">— or —</span>
              <input id="close-proj-link-url" class="form-input" type="url" placeholder="Paste a document URL" style="flex:1;min-width:200px;padding:6px 10px;font-size:12.5px"/>
              <input id="close-proj-link-name" class="form-input" type="text" placeholder="Label" style="width:140px;padding:6px 10px;font-size:12.5px"/>
              <button type="button" class="btn btn-outline btn-sm" onclick="closeProjAddLink()"><i class="fas fa-link"></i> Add link</button>
            </div>
            <div id="close-proj-files-list" style="display:flex;flex-direction:column;gap:6px;margin-top:8px"></div>
          </div>
          ${lead.requirement_file?.url ? `<div style="margin-top:8px;font-size:12px;color:#cbd5e1;padding:8px;background:rgba(255,122,69,.08);border-radius:6px"><i class="fas fa-paperclip"></i> The lead's attached file (<a href="${escapeHtml(lead.requirement_file.url)}" target="_blank" rel="noopener" style="color:#FF7A45">${escapeHtml(lead.requirement_file.name || 'attachment')}</a>) is auto-added to the project's documents.</div>` : ''}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-success" onclick="submitCloseLead('${lead.id}')"><i class="fas fa-handshake"></i> Close & Send Credentials</button>
      </div>
    `, 'modal-lg')
  } catch (e) {
    toast('Failed to open close form: ' + e.message, 'error')
  }
}

function onToggleCloseProject(checked) {
  const wrap = document.getElementById('close-project-fields')
  if (wrap) wrap.style.display = checked ? '' : 'none'
}

async function onCloseProjDeliveryChange(kind) {
  if (!kind) return
  const codeInput = document.getElementById('close-proj-code')
  if (!codeInput) return
  // Don't clobber a user-typed code unless it still looks auto-filled.
  const cur = (codeInput.value || '').trim().toUpperCase()
  const looksAuto = !cur || ['APP','WB','BTH'].some(p => cur.startsWith(p))
  if (!looksAuto) return
  await fetchAndFillCloseProjCode(kind)
}

async function autoFillCloseProjCode() {
  const kind = document.getElementById('close-proj-delivery')?.value
  if (!kind) { toast('Pick a delivery kind first', 'error'); return }
  await fetchAndFillCloseProjCode(kind)
}

async function fetchAndFillCloseProjCode(kind) {
  const codeInput = document.getElementById('close-proj-code')
  if (!codeInput) return
  try {
    const res = await API.get('/projects/next-code?kind=' + encodeURIComponent(kind))
    if (res.code) codeInput.value = res.code
  } catch (e) {
    toast('Could not suggest a code: ' + e.message, 'error')
  }
}

// ── Close-lead project attachments + sold_by handlers ────────
let _closeProjFiles = []  // staged File objects
let _closeProjLinks = []  // [{ url, name }]

function closeProjAddFiles(fileList) {
  for (const f of fileList) _closeProjFiles.push(f)
  closeProjRenderFilesList()
}

function closeProjRemoveFile(idx) {
  _closeProjFiles.splice(idx, 1)
  closeProjRenderFilesList()
}

function closeProjAddLink() {
  const urlEl = document.getElementById('close-proj-link-url')
  const nameEl = document.getElementById('close-proj-link-name')
  const url = (urlEl?.value || '').trim()
  if (!url) { toast('Paste a URL first', 'error'); return }
  if (!/^https?:\/\//i.test(url)) { toast('URL must start with http:// or https://', 'error'); return }
  let display = (nameEl?.value || '').trim()
  if (!display) {
    try { const u = new URL(url); display = u.hostname + (u.pathname && u.pathname !== '/' ? u.pathname : '') }
    catch { display = url }
  }
  _closeProjLinks.push({ url, name: display })
  if (urlEl) urlEl.value = ''
  if (nameEl) nameEl.value = ''
  closeProjRenderFilesList()
}

function closeProjRemoveLink(idx) {
  _closeProjLinks.splice(idx, 1)
  closeProjRenderFilesList()
}

function closeProjRenderFilesList() {
  const wrap = document.getElementById('close-proj-files-list')
  if (!wrap) return
  if (!_closeProjFiles.length && !_closeProjLinks.length) { wrap.innerHTML = ''; return }
  const fileRows = _closeProjFiles.map((f, i) => {
    const sizeMb = (f.size / (1024 * 1024)).toFixed(2)
    const tooBig = f.size > 25 * 1024 * 1024
    return `<div style="display:flex;align-items:center;gap:10px;padding:6px 10px;background:rgba(15,23,42,.5);border:1px solid rgba(148,163,184,.18);border-radius:8px">
      <i class="fas fa-file" style="color:#FF7A45;font-size:14px"></i>
      <div style="flex:1;min-width:0">
        <div style="font-size:12.5px;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(f.name)}</div>
        <div style="font-size:10.5px;color:${tooBig ? '#FF5E3A' : '#64748b'}">${sizeMb} MB${tooBig ? ' — exceeds 25 MB limit' : ''}</div>
      </div>
      <button type="button" class="btn btn-sm btn-outline" style="border-color:rgba(255,94,58,.4);color:#FF5E3A" onclick="closeProjRemoveFile(${i})"><i class="fas fa-times"></i></button>
    </div>`
  })
  const linkRows = _closeProjLinks.map((l, i) => `<div style="display:flex;align-items:center;gap:10px;padding:6px 10px;background:rgba(15,23,42,.5);border:1px solid rgba(148,163,184,.18);border-radius:8px">
    <i class="fas fa-link" style="color:#86E0A8;font-size:14px"></i>
    <div style="flex:1;min-width:0">
      <div style="font-size:12.5px;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(l.name)}</div>
      <div style="font-size:10.5px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener" style="color:#9F8678">${escapeHtml(l.url)}</a></div>
    </div>
    <button type="button" class="btn btn-sm btn-outline" style="border-color:rgba(255,94,58,.4);color:#FF5E3A" onclick="closeProjRemoveLink(${i})"><i class="fas fa-times"></i></button>
  </div>`)
  wrap.innerHTML = [...fileRows, ...linkRows].join('')
}

// Resolves the Sold By dropdown value, falling back to the custom text
// box when "Other / custom name…" is selected.
function onCloseSoldByChange(value) {
  const custom = document.getElementById('close-proj-sold-by-custom')
  if (!custom) return
  if (value === '__custom__') {
    custom.style.display = ''
    custom.focus()
  } else {
    custom.style.display = 'none'
    custom.value = ''
  }
}

function readCloseProjSoldBy() {
  const sel = document.getElementById('close-proj-sold-by')
  const custom = document.getElementById('close-proj-sold-by-custom')
  if (!sel) return null
  if (sel.value === '__custom__') return (custom?.value || '').trim() || null
  return sel.value || null
}

function onCloseStateChange(sel) {
  const opt = sel.selectedOptions[0]
  const code = opt?.dataset?.code || ''
  const codeEl = document.getElementById('close-state-code')
  if (codeEl) codeEl.value = code
}

function generateClientPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghjkmnpqrstuvwxyz'
  const digits = '23456789'
  const special = '!@#$%^&*'
  const all = upper + lower + digits + special
  const pick = (set) => set[Math.floor(Math.random() * set.length)]
  let pw = pick(upper) + pick(lower) + pick(digits) + pick(special)
  for (let i = 0; i < 8; i++) pw += pick(all)
  pw = pw.split('').sort(() => Math.random() - 0.5).join('')
  const input = document.getElementById('close-password')
  if (input) input.value = pw
}

async function submitCloseLead(id) {
  const payload = {
    contact_name: document.getElementById('close-contact-name').value.trim(),
    email: document.getElementById('close-email').value.trim(),
    phone: document.getElementById('close-phone').value.trim(),
    company_name: document.getElementById('close-company-name').value.trim(),
    website: document.getElementById('close-website').value.trim(),
    industry: document.getElementById('close-industry').value.trim(),
    avatar_color: document.getElementById('close-color')?.value || '#6366f1',
    gstin: document.getElementById('close-gstin').value.trim().toUpperCase(),
    country: document.getElementById('close-country').value.trim(),
    address_line: document.getElementById('close-address').value.trim(),
    city: document.getElementById('close-city').value.trim(),
    state: document.getElementById('close-state').value.trim(),
    state_code: document.getElementById('close-state-code').value.trim(),
    pincode: document.getElementById('close-pincode').value.trim(),
    password: document.getElementById('close-password').value,
  }
  if (!payload.contact_name || !payload.email || !payload.company_name || !payload.password) {
    toast('Company name, contact name, email and password are required', 'error')
    return
  }
  if (payload.gstin && !/^[0-9A-Z]{15}$/.test(payload.gstin)) {
    toast('GSTIN must be 15 alphanumeric characters', 'error')
    return
  }
  if (payload.pincode && !/^[0-9]{4,8}$/.test(payload.pincode)) {
    toast('PIN code must be numeric (4–8 digits)', 'error')
    return
  }

  const wantsProject = document.getElementById('close-create-project')?.checked
  if (wantsProject) {
    const pname = (document.getElementById('close-proj-name')?.value || '').trim()
    const pcode = (document.getElementById('close-proj-code')?.value || '').trim().toUpperCase()
    const pstart = (document.getElementById('close-proj-start')?.value || '').trim()
    const pdelivery = (document.getElementById('close-proj-delivery')?.value || '').trim()
    if (!pname) { toast('Project name is required', 'error'); return }
    if (!pdelivery) { toast('Delivery kind is required', 'error'); return }
    if (!pcode) { toast('Project code is required', 'error'); return }
    if (!/^[A-Z0-9_-]{2,40}$/.test(pcode)) {
      toast('Project code may only contain letters, numbers, underscore or hyphen', 'error'); return
    }
    if (!pstart) { toast('Project start date is required', 'error'); return }
    const pend = (document.getElementById('close-proj-end')?.value || '').trim()
    if (pend && pend < pstart) { toast('Project end date must be after start date', 'error'); return }
    const amt = (document.getElementById('close-proj-amount')?.value || '').trim()
    // Validate file sizes early so we don't half-create the project before
    // hitting the upload limit.
    for (const f of _closeProjFiles) {
      if (f.size > 25 * 1024 * 1024) { toast(`"${f.name}" exceeds the 25 MB limit`, 'error'); return }
    }
    const commercialRoles = Array.from(document.querySelectorAll('.close-proj-commercial-role:checked'))
      .map(el => el.value)
    payload.project = {
      name: pname,
      code: pcode,
      delivery_kind: pdelivery,
      status: document.getElementById('close-proj-status')?.value || 'active',
      project_type: document.getElementById('close-proj-type')?.value || 'development',
      priority: document.getElementById('close-proj-priority')?.value || 'medium',
      start_date: pstart,
      expected_end_date: pend || null,
      pm_id: document.getElementById('close-proj-pm')?.value || null,
      pc_id: document.getElementById('close-proj-pc')?.value || null,
      project_amount: amt ? Number(amt) : null,
      billable: (document.getElementById('close-proj-billable')?.value || '1') === '1',
      sold_by: readCloseProjSoldBy(),
      commercial_visible_to: commercialRoles,
      description: (document.getElementById('close-proj-desc')?.value || '').trim() || null,
      remarks: (document.getElementById('close-proj-remarks')?.value || '').trim() || null,
    }

    // Upload any user-picked files first; pasted links ride along as
    // link-only attachments. Backend wires these onto the new project as
    // documents alongside the lead's auto-attached requirement file.
    const attachments = []
    for (const f of _closeProjFiles) {
      try {
        const uploaded = await uploadLeadFile(f)
        attachments.push({
          file_name: uploaded.original_name || uploaded.name || f.name,
          file_url: uploaded.url || uploaded.file_url,
          file_type: uploaded.mime_type || uploaded.mime || f.type || null,
          file_size: Number(uploaded.size) || f.size || 0,
        })
      } catch (e) {
        toast(`"${f.name}" upload failed: ${e.message}`, 'error')
        return
      }
    }
    for (const l of _closeProjLinks) {
      attachments.push({ file_name: l.name, file_url: l.url, file_type: 'link', file_size: 0 })
    }
    if (attachments.length) payload.project.attachments = attachments
  }

  try {
    const res = await API.post(`/leads/${id}/close`, payload)
    const sent = res?.mail?.sent
    const projInfo = res?.project ? ` + project ${res.project.code}` : ''
    if (sent) {
      toast(`Client created${projInfo} — credentials emailed`, 'success', 6000)
    } else {
      const err = res?.mail?.error || 'unknown error'
      console.error('[leads] Email send failed:', err)
      alert(`Client was created${projInfo} but the credentials email failed to send:\n\n` + err + '\n\nCheck the server SMTP settings and re-send the credentials manually.')
    }
    closeModal()
    _closeProjFiles = []
    _closeProjLinks = []
    const el = document.getElementById('page-leads-view')
    if (el) { el.dataset.loaded = ''; loadPage('leads-view', el) }
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

// ── Send Mail / Send Portfolio ─────────────────────────────
// Both share the same modal and submit function — `kind` toggles the
// default subject/body and the API endpoint.
function openSendMailModal(leadId) {
  openSendOutboundModal(leadId, 'mail')
}

function openSendPortfolioModal(leadId) {
  openSendOutboundModal(leadId, 'portfolio')
}

let _outboundAttachments = [] // [{ filename, contentType, content (base64) }]
let _outboundPortfolios = []  // cached library list for the active modal
let _outboundPickedPortfolioId = '' // '' = none / custom file mode

async function openSendOutboundModal(leadId, kind) {
  _outboundAttachments = []
  _outboundPickedPortfolioId = ''
  _outboundPortfolios = []
  let lead = null
  try {
    const res = await API.get(`/leads/${leadId}`)
    lead = res.data || res.lead
  } catch (e) {
    toast('Failed to load lead: ' + e.message, 'error'); return
  }
  if (!lead) { toast('Lead not found', 'error'); return }
  const isPortfolio = kind === 'portfolio'

  // Pull the portfolio library up-front when this is a portfolio send so the
  // user can pick an existing entry rather than re-uploading the same file.
  if (isPortfolio) {
    try {
      const res = await API.get('/portfolios')
      _outboundPortfolios = res.data || res.portfolios || []
    } catch { _outboundPortfolios = [] }
  }

  const defaultSubject = isPortfolio
    ? `Mariox Software — Our Portfolio for ${lead.name}`
    : ''
  const defaultBody = isPortfolio
    ? `Hi ${lead.name},\n\nThanks for your time. As discussed, please find our company portfolio attached for your reference.\n\nLet us know if you have any questions or would like to schedule a follow-up.\n\nRegards,\n${_user?.full_name || _user?.name || 'Mariox Team'}`
    : ''

  const portfolioPickerHtml = isPortfolio ? `
    <div class="form-group">
      <label class="form-label">Pick from portfolio library</label>
      <select id="om-portfolio" class="form-select" onchange="onOutboundPortfolioPick(this.value)">
        <option value="">— Custom (attach files manually) —</option>
        ${_outboundPortfolios.map((p) => `<option value="${p.id}">${escapeHtml(p.title)}${p.file?.name ? ' · ' + escapeHtml(p.file.name) : ''}</option>`).join('')}
      </select>
      <div class="form-hint" style="font-size:11px;color:#94a3b8;margin-top:4px">
        ${_outboundPortfolios.length
          ? 'Anyone with Sales-Library permission (Settings → Roles & Permissions) can add new portfolios here.'
          : 'No portfolios in the library yet. Add one from Sales CRM → Portfolio (admins manage permissions in Settings).'}
      </div>
    </div>
  ` : ''

  showModal(`
    <div class="modal-header">
      <h3><i class="fas ${isPortfolio ? 'fa-briefcase' : 'fa-paper-plane'}" style="color:#FF7A45;margin-right:8px"></i>${isPortfolio ? 'Send Portfolio' : 'Send Mail'} — ${escapeHtml(lead.name)}</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      ${portfolioPickerHtml}
      <div class="form-group"><label class="form-label">To *</label><input id="om-to" class="form-input" value="${escapeHtml(lead.email || '')}"/></div>
      <div class="form-group"><label class="form-label">Cc (comma separated)</label><input id="om-cc" class="form-input" placeholder="optional"/></div>
      <div class="form-group"><label class="form-label">Subject *</label><input id="om-subject" class="form-input" value="${escapeHtml(defaultSubject)}"/></div>
      <div class="form-group"><label class="form-label">Message *</label>
        <textarea id="om-body" class="form-input" rows="8" style="font-family:inherit">${escapeHtml(defaultBody)}</textarea>
      </div>
      <div class="form-group" id="om-attach-wrap">
        <label class="form-label">Attachments ${isPortfolio ? '(only needed in Custom mode)' : ''}</label>
        <input id="om-files" type="file" class="form-input" multiple style="padding:6px" onchange="handleOutboundAttachments(this.files)"/>
        <div id="om-attachment-list" style="margin-top:6px"></div>
        <div class="form-hint" style="font-size:11px;color:#94a3b8;margin-top:4px">Up to 10 MB per file. Hold Ctrl/Cmd to select multiple files.</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitOutboundMail('${leadId}','${kind}')"><i class="fas fa-paper-plane"></i> Send</button>
    </div>
  `, 'modal-lg')
}

// Picking a library portfolio replaces the manual attachment flow: the file is
// fetched server-side and the subject defaults to the portfolio's title so the
// user only has to confirm the recipient + message.
function onOutboundPortfolioPick(portfolioId) {
  _outboundPickedPortfolioId = portfolioId || ''
  const attachWrap = document.getElementById('om-attach-wrap')
  const subjectEl = document.getElementById('om-subject')
  const p = _outboundPortfolios.find((x) => String(x.id) === String(portfolioId))
  if (p) {
    if (subjectEl) subjectEl.value = `Mariox Software — ${p.title}`
    if (attachWrap) attachWrap.style.display = 'none'
    _outboundAttachments = []
    renderOutboundAttachmentList()
  } else {
    if (attachWrap) attachWrap.style.display = ''
  }
}

function renderOutboundAttachmentList() {
  const wrap = document.getElementById('om-attachment-list')
  if (!wrap) return
  if (!_outboundAttachments.length) { wrap.innerHTML = ''; return }
  wrap.innerHTML = _outboundAttachments.map((att, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;margin-bottom:4px;background:rgba(255,255,255,.02);font-size:12px">
      <i class="fas fa-paperclip"></i>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(att.filename)} <span style="color:#64748b">· ${formatBytes(att.size)}</span></span>
      <button class="btn btn-xs btn-outline" onclick="removeOutboundAttachment(${i})"><i class="fas fa-times"></i></button>
    </div>
  `).join('')
}

function formatBytes(n) {
  if (!n) return '0 B'
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / (1024 * 1024)).toFixed(1) + ' MB'
}

function removeOutboundAttachment(idx) {
  _outboundAttachments.splice(idx, 1)
  renderOutboundAttachmentList()
}

async function handleOutboundAttachments(fileList) {
  const limit = 10 * 1024 * 1024
  const files = Array.from(fileList || [])
  for (const f of files) {
    if (f.size > limit) { toast(`"${f.name}" exceeds 10 MB`, 'error'); continue }
    try {
      const b64 = await fileToBase64(f)
      _outboundAttachments.push({
        filename: f.name,
        contentType: f.type || 'application/octet-stream',
        size: f.size,
        content: b64,
      })
    } catch (e) {
      toast(`Failed to read "${f.name}"`, 'error')
    }
  }
  renderOutboundAttachmentList()
  // Clear the input so the same file can be re-picked if removed.
  const input = document.getElementById('om-files')
  if (input) input.value = ''
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const base64 = result.split(',')[1] || ''
      resolve(base64)
    }
    reader.onerror = () => reject(reader.error || new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

async function submitOutboundMail(leadId, kind) {
  const to = (document.getElementById('om-to').value || '').trim()
  const ccRaw = (document.getElementById('om-cc').value || '').trim()
  const subject = (document.getElementById('om-subject').value || '').trim()
  const text = (document.getElementById('om-body').value || '').trim()
  if (!to) { toast('Recipient is required', 'error'); return }
  if (!subject) { toast('Subject is required', 'error'); return }
  if (!text) { toast('Message body is required', 'error'); return }
  const cc = ccRaw ? ccRaw.split(',').map(s => s.trim()).filter(Boolean) : []

  // Library mode — let the portfolio endpoint fetch the stored file and log
  // the send into portfolio_sends + the lead timeline (same path the Portfolio
  // tab's own Send button uses).
  if (kind === 'portfolio' && _outboundPickedPortfolioId) {
    try {
      await API.post(`/portfolios/${_outboundPickedPortfolioId}/send/${leadId}`, {
        to, cc, subject, text,
      })
      toast('Portfolio sent', 'success')
      _outboundAttachments = []
      _outboundPickedPortfolioId = ''
      closeModal()
      if (typeof openLeadDetailModal === 'function') openLeadDetailModal(leadId, { tab: 'timeline' })
      return
    } catch (e) {
      toast('Failed: ' + (e.message || 'unknown'), 'error')
      return
    }
  }

  // Custom mode — original behavior with manually attached files.
  const html = `<pre style="font-family:Arial,Helvetica,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>`
  const payload = {
    to, cc, subject, text, html,
    attachments: _outboundAttachments.map(a => ({
      filename: a.filename,
      contentType: a.contentType,
      content: a.content,
    })),
  }
  try {
    const path = kind === 'portfolio' ? 'send-portfolio' : 'send-mail'
    await API.post(`/leads/${leadId}/${path}`, payload)
    toast(kind === 'portfolio' ? 'Portfolio sent' : 'Mail sent', 'success')
    _outboundAttachments = []
    closeModal()
    if (typeof openLeadDetailModal === 'function') openLeadDetailModal(leadId, { tab: 'timeline' })
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

async function updateLeadTaskStatus(taskId, status, leadId) {
  try {
    await API.patch(`/leads/tasks/${taskId}`, { status })
    toast('Task updated', 'success')
    if (leadId) openLeadDetailModal(leadId, { tab: 'followups' })
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

async function openManageLeadStatusesModal() {
  if (!leadsCanManage()) {
    toast('Only admin/PM/PC can manage statuses', 'error')
    return
  }
  await loadLeadStatuses(true)
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-tags" style="color:#FF7A45;margin-right:8px"></i>Manage Lead & Task Statuses</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div>
          <h4 style="font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin:0 0 8px">Lead Statuses</h4>
          <div id="lead-status-list">${renderStatusList('lead')}</div>
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
            <div style="font-size:12px;font-weight:600;margin-bottom:6px">Add new lead status</div>
            ${renderStatusForm('lead')}
          </div>
        </div>
        <div>
          <h4 style="font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin:0 0 8px">Task Statuses</h4>
          <div id="task-status-list">${renderStatusList('task')}</div>
          <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
            <div style="font-size:12px;font-weight:600;margin-bottom:6px">Add new task status</div>
            ${renderStatusForm('task')}
          </div>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary" onclick="closeModal();reloadLeadsView()">Done</button>
    </div>
  `, 'modal-lg')
}

function renderStatusList(kind) {
  const order = kind === 'lead' ? _leadStatusOrder : _leadTaskStatusOrder
  const meta = kind === 'lead' ? LEAD_STATUS_META : LEAD_TASK_STATUS_META
  if (!order.length) return '<div style="font-size:12px;color:#64748b;padding:8px">No statuses defined.</div>'
  return order.map((k) => {
    const m = meta[k]
    const id = m?.id || ''
    const isSystem = Number(m?.is_system || 0) === 1
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;background:rgba(255,255,255,.02)">
      <span class="badge badge-${m?.badge || 'todo'}">${escapeHtml(m?.label || k)}</span>
      <span style="font-size:11px;color:#64748b;font-family:monospace">${escapeHtml(k)}</span>
      ${isSystem ? '<span style="font-size:10px;color:#FF7A45;margin-left:auto">SYSTEM</span>' : `<button class="btn btn-xs btn-outline" style="margin-left:auto" onclick="deleteLeadStatus('${kind}','${id}','${escapeHtml(m?.label || k).replace(/'/g, "\\'")}')"><i class="fas fa-trash"></i></button>`}
    </div>`
  }).join('')
}

function renderStatusForm(kind) {
  return `<div style="display:grid;grid-template-columns:1fr;gap:6px">
    <input id="new-${kind}-status-label" class="form-input" placeholder="Label (e.g. On Hold)"/>
    <input id="new-${kind}-status-key" class="form-input" placeholder="Key (auto from label if empty)"/>
    <button class="btn btn-primary btn-sm" onclick="addLeadStatus('${kind}')"><i class="fas fa-plus"></i> Add Status</button>
  </div>`
}

async function addLeadStatus(kind) {
  const label = document.getElementById(`new-${kind}-status-label`).value.trim()
  const key = document.getElementById(`new-${kind}-status-key`).value.trim()
  if (!label) { toast('Label required', 'error'); return }
  try {
    await API.post(`/leads/statuses/${kind}`, { label, key: key || undefined })
    toast('Status added', 'success')
    await loadLeadStatuses(true)
    const listEl = document.getElementById(`${kind === 'lead' ? 'lead' : 'task'}-status-list`)
    if (listEl) listEl.innerHTML = renderStatusList(kind)
    document.getElementById(`new-${kind}-status-label`).value = ''
    document.getElementById(`new-${kind}-status-key`).value = ''
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

async function deleteLeadStatus(kind, id, label) {
  if (!confirm(`Delete status "${label}"?`)) return
  try {
    await API.delete(`/leads/statuses/${kind}/${id}`)
    toast('Status deleted', 'success')
    await loadLeadStatuses(true)
    const listEl = document.getElementById(`${kind === 'lead' ? 'lead' : 'task'}-status-list`)
    if (listEl) listEl.innerHTML = renderStatusList(kind)
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

async function openManageLeadSourcesModal() {
  if (!leadsCanManage()) {
    toast('Only admin/PM/PC can manage sources', 'error')
    return
  }
  await loadLeadSources(true)
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-bullhorn" style="color:#FF7A45;margin-right:8px"></i>Manage Lead Sources</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <h4 style="font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin:0 0 8px">Lead Sources</h4>
      <div id="lead-source-list">${renderSourceList()}</div>
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
        <div style="font-size:12px;font-weight:600;margin-bottom:6px">Add new source</div>
        <div style="display:grid;grid-template-columns:1fr;gap:6px">
          <input id="new-source-label" class="form-input" placeholder="Label (e.g. LinkedIn)"/>
          <input id="new-source-key" class="form-input" placeholder="Key (auto from label if empty)"/>
          <button class="btn btn-primary btn-sm" onclick="addLeadSource()"><i class="fas fa-plus"></i> Add Source</button>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary" onclick="closeModal();reloadLeadsView()">Done</button>
    </div>
  `, 'modal-md')
}

function renderSourceList() {
  if (!_leadSources.length) return '<div style="font-size:12px;color:#64748b;padding:8px">No sources defined.</div>'
  return _leadSources.map((s) => {
    const isSystem = Number(s.is_system || 0) === 1
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;background:rgba(255,255,255,.02)">
      <span style="font-weight:600;color:var(--text-primary)">${escapeHtml(s.label)}</span>
      <span style="font-size:11px;color:#64748b;font-family:monospace">${escapeHtml(s.key)}</span>
      ${isSystem ? '<span style="font-size:10px;color:#FF7A45;margin-left:auto">SYSTEM</span>' : `<button class="btn btn-xs btn-outline" style="margin-left:auto" onclick="deleteLeadSource('${s.id}','${escapeHtml(s.label).replace(/'/g, "\\'")}')"><i class="fas fa-trash"></i></button>`}
    </div>`
  }).join('')
}

async function addLeadSource() {
  const label = document.getElementById('new-source-label').value.trim()
  const key = document.getElementById('new-source-key').value.trim()
  if (!label) { toast('Label required', 'error'); return }
  try {
    await API.post('/leads/sources', { label, key: key || undefined })
    toast('Source added', 'success')
    await loadLeadSources(true)
    const listEl = document.getElementById('lead-source-list')
    if (listEl) listEl.innerHTML = renderSourceList()
    document.getElementById('new-source-label').value = ''
    document.getElementById('new-source-key').value = ''
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

async function deleteLeadSource(id, label) {
  if (!confirm(`Delete source "${label}"?`)) return
  try {
    await API.delete(`/leads/sources/${id}`)
    toast('Source deleted', 'success')
    await loadLeadSources(true)
    const listEl = document.getElementById('lead-source-list')
    if (listEl) listEl.innerHTML = renderSourceList()
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

function reloadLeadsView() {
  const el = document.getElementById('page-leads-view')
  if (el) { el.dataset.loaded = ''; loadPage('leads-view', el) }
}

async function confirmDeleteLead(id, name) {
  if (!confirm(`Delete lead "${name}"? This also removes all follow-up tasks.`)) return
  try {
    await API.delete(`/leads/${id}`)
    toast('Lead deleted', 'success')
    const el = document.getElementById('page-leads-view')
    if (el) { el.dataset.loaded = ''; loadPage('leads-view', el) }
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

// ════════════════════════════════════════════════════════════
// Follow-up alarms — polls /leads/followups/upcoming and pops a
// modal with a looping ringtone that the user must dismiss manually.
// ════════════════════════════════════════════════════════════

const _alarmState = {
  pollMs: 30_000,
  timer: null,
  audio: null,
  // Stack of alarms currently visible — we always show the topmost one
  // and only acknowledge the rest once the user closes the active modal.
  queue: [],
  active: null,
  // Tracks ids we've already shown in this session so a single alarm doesn't
  // re-pop on every poll while it sits on screen unacknowledged.
  shown: new Set(),
}

function startFollowupAlarmPoller() {
  if (_alarmState.timer) return
  if (!_user || !_token) return
  // Only poll for users who can act on follow-ups.
  const role = String(_user.role || '').toLowerCase()
  if (!['admin','pm','pc','sales_manager','sales_tl','sales_agent'].includes(role)) return
  pollFollowupAlarms() // immediate kick-off
  _alarmState.timer = setInterval(pollFollowupAlarms, _alarmState.pollMs)
}

function stopFollowupAlarmPoller() {
  if (_alarmState.timer) clearInterval(_alarmState.timer)
  _alarmState.timer = null
  stopAlarmRingtone()
  _alarmState.queue = []
  _alarmState.active = null
  _alarmState.shown.clear()
}

async function pollFollowupAlarms() {
  if (!_user || !_token) return
  try {
    const res = await API.get('/leads/followups/upcoming')
    const alarms = res.data || res.alarms || []
    for (const a of alarms) {
      if (_alarmState.shown.has(a.id)) continue
      _alarmState.shown.add(a.id)
      _alarmState.queue.push(a)
    }
    if (!_alarmState.active && _alarmState.queue.length) {
      showNextFollowupAlarm()
    }
  } catch {
    // Silent — poller will retry on next tick.
  }
}

function showNextFollowupAlarm() {
  const next = _alarmState.queue.shift()
  if (!next) { _alarmState.active = null; return }
  _alarmState.active = next
  const dueText = fmtDateTime(next.due_date)
  const overdueLabel = next.overdue ? ' <span style="color:#FF5E3A">(overdue)</span>' : ''
  const html = `
    <div id="followup-alarm-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.65);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;z-index:9999">
      <div style="width:min(440px,92vw);background:#1A0E08;border:1px solid #FF7A45;border-radius:12px;box-shadow:0 24px 64px rgba(0,0,0,.6);overflow:hidden">
        <div style="padding:14px 18px;background:linear-gradient(90deg,#FF7A45,#FF5E3A);color:#fff;display:flex;align-items:center;gap:10px">
          <i class="fas fa-bell fa-shake" style="font-size:18px"></i>
          <div style="font-weight:700;letter-spacing:.5px">Follow-up Alarm</div>
        </div>
        <div style="padding:18px">
          <div style="font-size:14px;color:#e2e8f0;margin-bottom:8px">
            <strong>${escapeHtml(next.title || 'Follow up')}</strong>
          </div>
          <div style="font-size:13px;color:#cbd5e1;margin-bottom:6px">
            <i class="fas fa-user" style="color:#94a3b8;margin-right:6px"></i>${escapeHtml(next.lead_name || '')}
          </div>
          ${next.lead_phone ? `<div style="font-size:12px;color:#94a3b8;margin-bottom:4px"><i class="fas fa-phone" style="margin-right:6px"></i>${escapeHtml(next.lead_phone)}</div>` : ''}
          ${next.lead_email ? `<div style="font-size:12px;color:#94a3b8;margin-bottom:4px"><i class="fas fa-envelope" style="margin-right:6px"></i>${escapeHtml(next.lead_email)}</div>` : ''}
          <div style="font-size:12px;color:#94a3b8;margin-top:8px"><i class="fas fa-clock" style="margin-right:6px"></i>Due ${dueText}${overdueLabel}</div>
        </div>
        <div style="padding:12px 18px;background:rgba(255,255,255,.03);display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--border)">
          <button class="btn btn-outline btn-sm" onclick="openLeadFromAlarm('${next.lead_id}')"><i class="fas fa-eye"></i> Open Lead</button>
          <button class="btn btn-primary btn-sm" onclick="acknowledgeFollowupAlarm()"><i class="fas fa-check"></i> Acknowledge</button>
        </div>
      </div>
    </div>
  `
  let host = document.getElementById('followup-alarm-host')
  if (!host) {
    host = document.createElement('div')
    host.id = 'followup-alarm-host'
    document.body.appendChild(host)
  }
  host.innerHTML = html
  startAlarmRingtone()
}

function startAlarmRingtone() {
  try {
    if (!_alarmState.audio) {
      _alarmState.audio = new Audio('/static/sounds/task.wav')
      _alarmState.audio.loop = true
      _alarmState.audio.volume = 0.8
    }
    const p = _alarmState.audio.play()
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // Browser autoplay policy may have blocked us — surface the alarm
        // visually anyway and rely on the user clicking "Acknowledge".
      })
    }
  } catch {}
}

function stopAlarmRingtone() {
  if (_alarmState.audio) {
    try { _alarmState.audio.pause(); _alarmState.audio.currentTime = 0 } catch {}
  }
}

async function acknowledgeFollowupAlarm() {
  const cur = _alarmState.active
  if (!cur) return
  try {
    await API.post(`/leads/tasks/${cur.id}/acknowledge`, {})
  } catch (e) {
    // Even if the server call fails we still close the modal so the agent
    // isn't trapped — the next poll will resurface it if truly unacknowledged.
    console.warn('[alarm] acknowledge failed', e)
  }
  closeFollowupAlarm()
}

function closeFollowupAlarm() {
  stopAlarmRingtone()
  const host = document.getElementById('followup-alarm-host')
  if (host) host.innerHTML = ''
  _alarmState.active = null
  if (_alarmState.queue.length) showNextFollowupAlarm()
}

function openLeadFromAlarm(leadId) {
  // Acknowledge then jump to the detail view in the followups tab.
  acknowledgeFollowupAlarm().finally(() => {
    if (typeof Router !== 'undefined' && Router?.navigate) Router.navigate('leads-view')
    setTimeout(() => openLeadDetailModal(leadId, { tab: 'followups' }), 200)
  })
}

// Boot the poller as soon as the page is interactive AND a session exists.
function _bootFollowupAlarms() {
  if (typeof _user === 'undefined' || !_user) {
    setTimeout(_bootFollowupAlarms, 1000)
    return
  }
  startFollowupAlarmPoller()
}
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(_bootFollowupAlarms, 800)
} else {
  document.addEventListener('DOMContentLoaded', () => setTimeout(_bootFollowupAlarms, 800))
}
window.addEventListener('storage', () => {
  if (!localStorage.getItem('devportal_token')) stopFollowupAlarmPoller()
})

// ═══════════════════════════════════════════════════════════════
// Lead Detail — full-page view (matches SalesCRM layout).
// Navigates via Router.navigate('lead-detail', { id }). Renders left
// column (info + notes + follow-ups + tasks) and right column
// (Activity Timeline). All sub-actions go through dedicated modals.
// ═══════════════════════════════════════════════════════════════

function goLeadDetail(id) {
  const el = document.getElementById('page-lead-detail')
  if (el) el.dataset.loaded = ''
  Router.navigate('lead-detail', { id })
}

const LEAD_TEMP_BADGE = {
  new: { label: 'New', color: '#3b82f6' },
  contacted: { label: 'Contacted', color: '#f59e0b' },
  qualified: { label: 'Qualified', color: '#22c55e' },
  proposal: { label: 'Proposal', color: '#8b5cf6' },
  negotiation: { label: 'Negotiation', color: '#ec4899' },
  closed: { label: 'Closed', color: '#10b981' },
  warm: { label: 'Warm', color: '#f59e0b' },
  hot: { label: 'Hot', color: '#ef4444' },
  cold: { label: 'Cold', color: '#60a5fa' },
}

function leadHeaderBadge(statusKey) {
  const key = String(statusKey || 'new').toLowerCase()
  const meta = LEAD_STATUS_META[key]
  const tone = LEAD_TEMP_BADGE[key] || { label: meta?.label || key, color: '#94a3b8' }
  return `<span class="badge" style="background:${tone.color}20;color:${tone.color};border:1px solid ${tone.color}40;padding:6px 12px;border-radius:999px;font-weight:600;font-size:12px">${escapeHtml(meta?.label || tone.label)}</span>`
}

function fmtDateOnly(value) {
  if (!value) return '—'
  try {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return '—'
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return '—' }
}

function fmtRelative(value) {
  if (!value) return ''
  try {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return ''
    const diff = Date.now() - d.getTime()
    const mins = Math.round(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins} min ago`
    const hrs = Math.round(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.round(hrs / 24)
    if (days < 30) return `${days}d ago`
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return '' }
}

const ACTIVITY_KIND_ICONS = {
  lead_created: 'fa-plus-circle',
  status_changed: 'fa-exchange-alt',
  reassigned: 'fa-user-tag',
  comment_added: 'fa-comment',
  note_added: 'fa-sticky-note',
  note: 'fa-sticky-note',
  call: 'fa-phone',
  email: 'fa-envelope',
  meeting: 'fa-calendar',
  followup_added: 'fa-bell',
  followup_updated: 'fa-bell',
  followup_acknowledged: 'fa-bell-slash',
  task_added: 'fa-tasks',
  mail_sent: 'fa-paper-plane',
  portfolio_sent: 'fa-folder-open',
  scope_sent: 'fa-file-lines',
  quotation_sent: 'fa-file-invoice-dollar',
}

function activityIcon(kind) {
  return ACTIVITY_KIND_ICONS[kind] || 'fa-circle-info'
}

async function renderLeadDetailPage(el, id) {
  if (!id) {
    el.innerHTML = `<div class="empty-state"><p>No lead selected.</p><button class="btn btn-outline" onclick="Router.navigate('leads-view')"><i class="fas fa-arrow-left"></i> Back to Leads</button></div>`
    return
  }
  el.innerHTML = `<div class="loading-state" style="padding:40px;text-align:center;color:#94a3b8"><i class="fas fa-spinner fa-spin"></i> Loading lead…</div>`
  try {
    // Sources + assignees are needed by the now-inline edit fields. Cheap
    // to load alongside the lead so the detail page can render in a single
    // pass without a follow-up fetch when the user starts editing.
    await Promise.all([loadLeadStatuses(), loadLeadSources()])
    const [leadRes, notesRes, timelineRes, assignees] = await Promise.all([
      API.get(`/leads/${id}`),
      API.get(`/leads/${id}/notes`).catch(() => ({ data: [] })),
      API.get(`/leads/${id}/timeline`).catch(() => ({ data: [] })),
      fetchSalesAssignees().catch(() => []),
    ])
    const lead = leadRes.data || leadRes.lead
    if (!lead) {
      el.innerHTML = `<div class="empty-state"><p>Lead not found.</p><button class="btn btn-outline" onclick="Router.navigate('leads-view')">Back to Leads</button></div>`
      return
    }
    const tasks = lead.tasks || []
    const followups = tasks.filter((t) => (t.kind || 'followup') === 'followup')
    const generalTasks = tasks.filter((t) => t.kind === 'task')
    const notes = notesRes.data || notesRes.notes || []
    const timeline = timelineRes.data || timelineRes.timeline || []
    el.innerHTML = renderLeadDetailHTML(lead, followups, generalTasks, notes, timeline, assignees)
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${escapeHtml(e.message)}</p><button class="btn btn-outline" onclick="Router.navigate('leads-view')">Back to Leads</button></div>`
  }
}

// Inline lead-info card replaces the read-only header + contact cards and
// the separate "Edit Lead" modal. All editable fields live on the detail
// page and submit through one Save button. Read-only viewers (no canEdit)
// see the same data formatted as static text.
function renderLeadInfoCardInline(lead, assignees, canEdit, canManage) {
  const escape = (v) => escapeHtml(v == null ? '' : String(v))
  if (!canEdit) {
    return `
      <div class="card" style="padding:18px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px">
          <div style="display:flex;align-items:center;gap:12px">
            ${avatar(lead.name, '#FF7A45')}
            <div>
              <div style="font-size:18px;font-weight:700;color:#e2e8f0">${escape(lead.name)}</div>
              <div style="font-size:12px;color:#64748b;margin-top:2px">${escape(lead.source || '—')} • ${escape(lead.id)}</div>
            </div>
          </div>
          ${leadHeaderBadge(lead.status)}
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;font-size:13px;color:#cbd5e1">
          <div><i class="fas fa-envelope" style="width:18px;color:#94a3b8"></i> ${escape(lead.email || '—')}</div>
          <div><i class="fas fa-phone" style="width:18px;color:#94a3b8"></i> ${escape(lead.phone || '—')}</div>
          <div><i class="fas fa-user" style="width:18px;color:#94a3b8"></i> Assigned to: ${escape(lead.assigned_to_name || '—')}</div>
          <div><i class="fas fa-calendar" style="width:18px;color:#94a3b8"></i> Created: ${fmtDateOnly(lead.created_at)}</div>
          ${lead.requirement ? `<div style="margin-top:6px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06)"><div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Requirement</div><div style="white-space:pre-wrap">${escape(lead.requirement)}</div></div>` : ''}
          ${lead.requirement_file?.url ? `<div><i class="fas fa-paperclip"></i> <a href="${escape(lead.requirement_file.url)}" target="_blank" rel="noopener" style="color:#FF7A45">${escape(lead.requirement_file.name || 'attachment')}</a></div>` : ''}
        </div>
      </div>
    `
  }

  // Editable mode — same logic as the old modal but inline.
  const isPresetSource = LEAD_SOURCE_OPTIONS.includes(lead.source) && lead.source !== 'Other'
  const sourceSelectVal = isPresetSource ? lead.source : 'Other'
  const sourceCustomVal = isPresetSource ? '' : (lead.source || '')
  const statusOptions = _leadStatusOrder
    .filter((k) => k !== 'closed' || lead.status === 'closed')
    .map((k) => `<option value="${k}" ${lead.status === k ? 'selected' : ''}>${escapeHtml(LEAD_STATUS_META[k]?.label || k)}</option>`)
    .join('')
  return `
    <div class="card" style="padding:18px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:10px">
          <i class="fas fa-bullseye" style="color:#FF7A45"></i>
          <h4 style="margin:0;font-size:14px;color:#e2e8f0">Lead Information</h4>
        </div>
        <button class="btn btn-primary btn-xs" onclick="submitInlineLeadEdit('${lead.id}')"><i class="fas fa-save"></i> Save Changes</button>
      </div>

      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
        ${avatar(lead.name, '#FF7A45')}
        <div style="flex:1;min-width:0">
          <input id="lead-inline-name" class="form-input" style="font-size:16px;font-weight:600" value="${escape(lead.name)}" placeholder="Full name *"/>
          <div style="font-size:11px;color:#64748b;margin-top:4px">ID: ${escape(lead.id)} · Created: ${fmtDateOnly(lead.created_at)}</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="form-group" style="margin:0">
          <label class="form-label" style="font-size:11px">Email *</label>
          <input id="lead-inline-email" type="email" class="form-input" value="${escape(lead.email || '')}"/>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label" style="font-size:11px">Phone *</label>
          <input id="lead-inline-phone" class="form-input" value="${escape(lead.phone || '')}"/>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label" style="font-size:11px">Source *</label>
          <select id="lead-inline-source" class="form-select" onchange="onInlineLeadSourceChange(this)">
            ${LEAD_SOURCE_OPTIONS.map((s) => `<option value="${s}" ${sourceSelectVal === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
          <div id="lead-inline-source-other-wrap" style="display:${sourceSelectVal === 'Other' ? '' : 'none'};margin-top:6px">
            <input id="lead-inline-source-other" class="form-input" placeholder="Specify source" value="${escape(sourceCustomVal)}"/>
          </div>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label" style="font-size:11px">Status</label>
          <select id="lead-inline-status" class="form-select" ${lead.status === 'closed' ? 'disabled' : ''}>
            ${statusOptions}
          </select>
        </div>
        ${canManage ? `
        <div class="form-group" style="margin:0;grid-column:1/-1">
          <label class="form-label" style="font-size:11px">Assigned to *</label>
          <select id="lead-inline-assigned-to" class="form-select">
            ${assignees.map((u) => `<option value="${escape(u.id)}" ${String(lead.assigned_to) === String(u.id) ? 'selected' : ''}>${escape(u.full_name)} — ${escape(u.role)}</option>`).join('')}
          </select>
        </div>
        ` : `
        <div style="grid-column:1/-1;font-size:12px;color:#94a3b8;padding:6px 0">
          <i class="fas fa-user" style="width:16px"></i> Assigned to: ${escape(lead.assigned_to_name || '—')}
        </div>
        `}
        <div class="form-group" style="margin:0;grid-column:1/-1">
          <label class="form-label" style="font-size:11px">Requirement *</label>
          <textarea id="lead-inline-requirement" class="form-input" rows="3">${escape(lead.requirement || '')}</textarea>
        </div>
        <div class="form-group" style="margin:0;grid-column:1/-1">
          <label class="form-label" style="font-size:11px">Attachment (optional)</label>
          <div id="lead-inline-existing-file-wrap" style="display:${lead.requirement_file?.url ? '' : 'none'};margin-bottom:6px;font-size:12px;color:#cbd5e1">
            <i class="fas fa-paperclip"></i>
            <a href="${lead.requirement_file?.url || ''}" target="_blank" rel="noopener" style="color:#FF7A45">${escape(lead.requirement_file?.name || '')}</a>
            <button type="button" class="btn btn-xs btn-outline" style="margin-left:8px" onclick="removeInlineLeadExistingFile()">Remove</button>
            <input type="hidden" id="lead-inline-existing-file" value='${lead.requirement_file ? escape(JSON.stringify(lead.requirement_file)) : ''}'/>
          </div>
          <input id="lead-inline-file" type="file" class="form-input" style="padding:6px"/>
          <div class="form-hint" style="font-size:11px;color:#94a3b8;margin-top:4px">Pick a new file to replace the current attachment, or leave blank to keep it.</div>
        </div>
      </div>
    </div>
  `
}

function onInlineLeadSourceChange(selectEl) {
  const wrap = document.getElementById('lead-inline-source-other-wrap')
  if (!wrap) return
  wrap.style.display = String(selectEl.value || '') === 'Other' ? '' : 'none'
}

function removeInlineLeadExistingFile() {
  const wrap = document.getElementById('lead-inline-existing-file-wrap')
  const hidden = document.getElementById('lead-inline-existing-file')
  if (wrap) wrap.style.display = 'none'
  if (hidden) hidden.value = ''
}

async function submitInlineLeadEdit(id) {
  // Source resolution mirrors the old modal's resolveLeadSource, but uses
  // the inline IDs so it doesn't clash if both forms ever co-exist.
  const select = document.getElementById('lead-inline-source')
  const otherInput = document.getElementById('lead-inline-source-other')
  const selVal = select?.value || ''
  const source = selVal === 'Other' ? (otherInput?.value || '').trim() : selVal
  if (!source) { toast('Please specify the source', 'error'); return }

  let existingFile = null
  try {
    const raw = document.getElementById('lead-inline-existing-file')?.value
    if (raw) existingFile = JSON.parse(raw)
  } catch {}
  // Re-use the existing helper that handles fresh file uploads + size
  // checks. It looks for the file input by id 'lead-file' — we have a
  // different id, so we temporarily mirror the element id for compat.
  const fileInput = document.getElementById('lead-inline-file')
  const shim = document.createElement('input')
  shim.type = 'file'
  shim.id = 'lead-file'
  shim.style.display = 'none'
  // Files can't be moved between inputs directly; transfer via DataTransfer.
  if (fileInput?.files?.length) {
    const dt = new DataTransfer()
    dt.items.add(fileInput.files[0])
    shim.files = dt.files
  }
  document.body.appendChild(shim)
  let file
  try { file = await resolveLeadRequirementFile(existingFile) } catch { shim.remove(); return }
  shim.remove()

  const requirementText = (document.getElementById('lead-inline-requirement')?.value || '').trim()
  if (!requirementText && !file) {
    toast('Add a requirement description or attach a file', 'error')
    return
  }
  const assignedInput = document.getElementById('lead-inline-assigned-to')
  const payload = {
    name: (document.getElementById('lead-inline-name')?.value || '').trim(),
    email: (document.getElementById('lead-inline-email')?.value || '').trim(),
    phone: (document.getElementById('lead-inline-phone')?.value || '').trim(),
    source,
    status: document.getElementById('lead-inline-status')?.value,
    requirement: requirementText || '(see attached file)',
    requirement_file: file,
  }
  // Only send assigned_to if the field exists (managers only) — otherwise
  // server keeps the current owner unchanged.
  if (assignedInput) payload.assigned_to = assignedInput.value
  try {
    await API.put(`/leads/${id}`, payload)
    toast('Lead updated', 'success')
    const el = document.getElementById('page-lead-detail')
    if (el) { el.dataset.loaded = ''; loadPage('lead-detail', el) }
  } catch (e) {
    toast('Failed: ' + (e.message || 'unknown'), 'error')
  }
}

function renderLeadDetailHTML(lead, followups, generalTasks, notes, timeline, assignees) {
  const role = String(_user?.role || '').toLowerCase()
  const canManage = ['admin', 'pm', 'pc', 'sales_manager', 'sales_tl'].includes(role)
  const isOwner = String(lead.assigned_to || '') === String(_user?.id || _user?.sub || '')
  const canEdit = canManage || isOwner
  const assigneeList = Array.isArray(assignees) ? assignees : []

  const followupsHTML = followups.length
    ? followups.map((t) => renderFollowupRowDetail(lead.id, t)).join('')
    : `<div style="padding:16px;color:#64748b;font-size:13px;text-align:center">No follow-ups scheduled yet.</div>`
  const tasksHTML = generalTasks.length
    ? generalTasks.map((t) => renderTaskRowDetail(lead.id, t)).join('')
    : `<div style="padding:16px;color:#64748b;font-size:13px;text-align:center">No tasks yet.</div>`
  const timelineHTML = timeline.length
    ? renderTimelineList(timeline)
    : `<div style="padding:24px;color:#64748b;font-size:13px;text-align:center">No activity yet.</div>`

  return `
  <div class="lead-detail-page" style="padding:0 4px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:18px;flex-wrap:wrap">
      <button class="btn btn-outline btn-sm" onclick="Router.navigate('leads-view')"><i class="fas fa-arrow-left"></i> Back to Leads</button>
      <div style="flex:1"></div>
      <button class="btn btn-outline btn-sm" onclick="openSendPortfolioModal('${lead.id}')"><i class="fas fa-briefcase"></i> Send Portfolio</button>
      <button class="btn btn-outline btn-sm" onclick="openSendMailModal('${lead.id}')"><i class="fas fa-paper-plane"></i> Send Mail</button>
      ${canManage && !lead.client_id ? `<button class="btn btn-success btn-sm" onclick="openCloseLeadModal('${lead.id}')"><i class="fas fa-handshake"></i> Close &amp; Convert</button>` : ''}
    </div>

    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:20px">
      <!-- LEFT COLUMN -->
      <div style="display:flex;flex-direction:column;gap:16px">
        <!-- Lead Information (inline-editable) -->
        ${renderLeadInfoCardInline(lead, assigneeList, canEdit, canManage)}

        <!-- Notes card -->
        <div class="card" style="padding:18px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <h4 style="margin:0;font-size:14px;color:#e2e8f0">Notes</h4>
            ${canEdit ? `<button class="btn btn-xs btn-outline" onclick="saveLeadInlineNotes('${lead.id}')"><i class="fas fa-save"></i> Save</button>` : ''}
          </div>
          ${canEdit
            ? `<textarea id="lead-detail-notes" class="form-input" rows="3" placeholder="Add a note about this lead…">${escapeHtml(lead.notes || '')}</textarea>`
            : `<div style="font-size:13px;color:#cbd5e1;white-space:pre-wrap">${escapeHtml(lead.notes || '—')}</div>`
          }
        </div>

        <!-- Follow-ups card -->
        <div class="card" style="padding:18px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <div style="display:flex;align-items:center;gap:8px"><i class="fas fa-calendar-check" style="color:#3b82f6"></i><h4 style="margin:0;font-size:14px;color:#e2e8f0">Follow-ups (${followups.length})</h4></div>
            ${canEdit ? `<button class="btn btn-xs btn-primary" onclick="openScheduleFollowupModal2('${lead.id}')"><i class="fas fa-plus"></i></button>` : ''}
          </div>
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Scheduled</div>
          <div style="display:flex;flex-direction:column;gap:8px">${followupsHTML}</div>
        </div>

        <!-- Tasks card -->
        <div class="card" style="padding:18px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <div style="display:flex;align-items:center;gap:8px"><i class="fas fa-list-check" style="color:#22c55e"></i><h4 style="margin:0;font-size:14px;color:#e2e8f0">Tasks (${generalTasks.length})</h4></div>
            ${canEdit ? `<button class="btn btn-xs btn-primary" onclick="openAddTaskModal('${lead.id}')"><i class="fas fa-plus"></i></button>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">${tasksHTML}</div>
        </div>
      </div>

      <!-- RIGHT COLUMN: Activity Timeline -->
      <div class="card" style="padding:18px;align-self:start">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <h4 style="margin:0;font-size:15px;color:#e2e8f0">Activity Timeline</h4>
        </div>
        <div id="lead-timeline-body">${timelineHTML}</div>
      </div>
    </div>
  </div>`
}

function renderFollowupRowDetail(leadId, t) {
  const overdue = t.due_date && new Date(t.due_date).getTime() < Date.now() && t.status !== 'done'
  const statusKey = String(t.status || 'pending').toLowerCase()
  const meta = LEAD_TASK_STATUS_META[statusKey] || { label: statusKey, badge: 'todo' }
  return `<div style="padding:10px;border:1px solid ${overdue ? '#FF5E3A40' : '#1e293b'};border-radius:8px;background:${overdue ? '#FF5E3A10' : '#0f172a40'}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;color:#e2e8f0;font-weight:500">${escapeHtml(t.title || '')}</div>
        ${t.description ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px">${escapeHtml(t.description).slice(0, 120)}</div>` : ''}
        <div style="font-size:11px;color:${overdue ? '#FF5E3A' : '#64748b'};margin-top:4px"><i class="fas fa-calendar"></i> ${fmtDateTime(t.due_date)}${overdue ? ' (Overdue)' : ''}</div>
      </div>
      <div style="display:flex;gap:4px;align-items:center">
        <span class="badge badge-${meta.badge}" style="font-size:10px">${escapeHtml(meta.label)}</span>
        ${t.status !== 'done' ? `<button class="btn btn-xs btn-outline" title="Mark done" onclick="markLeadFollowupDone('${leadId}','${t.id}')"><i class="fas fa-check"></i></button>` : ''}
      </div>
    </div>
  </div>`
}

function renderTaskRowDetail(leadId, t) {
  const statusKey = String(t.status || 'pending').toLowerCase()
  const meta = LEAD_TASK_STATUS_META[statusKey] || { label: statusKey, badge: 'todo' }
  const priorityClass = ({ critical: 'badge-critical', high: 'badge-high', medium: 'badge-medium', low: 'badge-low' })[t.priority] || 'badge-medium'
  return `<div style="padding:10px;border:1px solid #1e293b;border-radius:8px;background:#0f172a40">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;color:#e2e8f0;font-weight:500">${escapeHtml(t.title || '')}</div>
        ${t.description ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px">${escapeHtml(t.description).slice(0, 120)}</div>` : ''}
        <div style="font-size:11px;color:#64748b;margin-top:4px"><i class="fas fa-calendar"></i> ${fmtDateTime(t.due_date)}</div>
      </div>
      <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
        ${t.priority ? `<span class="badge ${priorityClass}" style="font-size:10px">${escapeHtml(t.priority)}</span>` : ''}
        <span class="badge badge-${meta.badge}" style="font-size:10px">${escapeHtml(meta.label)}</span>
        ${t.status !== 'done' ? `<button class="btn btn-xs btn-outline" title="Mark done" onclick="markLeadFollowupDone('${leadId}','${t.id}')"><i class="fas fa-check"></i></button>` : ''}
      </div>
    </div>
  </div>`
}

function renderTimelineList(timeline) {
  return `<div style="display:flex;flex-direction:column;gap:14px;position:relative">
    ${timeline.map((a) => `
      <div style="display:flex;gap:12px">
        <div style="flex-shrink:0;width:34px;height:34px;border-radius:50%;background:#1e293b;display:flex;align-items:center;justify-content:center;color:#94a3b8;border:1px solid #334155"><i class="fas ${activityIcon(a.kind)}"></i></div>
        <div style="flex:1;min-width:0;padding:10px 12px;border-radius:8px;background:#0f172a40;border:1px solid #1e293b">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div style="font-size:13px;color:#e2e8f0;font-weight:600">${escapeHtml(a.actor_name || 'System')}</div>
            <div style="font-size:11px;color:#64748b;white-space:nowrap" title="${escapeHtml(a.created_at || '')}">${fmtRelative(a.created_at)}</div>
          </div>
          <div style="font-size:13px;color:#cbd5e1;margin-top:4px">${escapeHtml(a.summary || '')}</div>
          <div style="margin-top:6px"><span class="badge badge-todo" style="font-size:10px">${escapeHtml(a.kind || 'event')}</span></div>
        </div>
      </div>
    `).join('')}
  </div>`
}

async function saveLeadInlineNotes(leadId) {
  const ta = document.getElementById('lead-detail-notes')
  if (!ta) return
  try {
    await API.put(`/leads/${leadId}`, { notes: ta.value })
    toast('Notes saved', 'success')
  } catch (e) {
    toast('Failed to save notes: ' + e.message, 'error')
  }
}

async function markLeadFollowupDone(leadId, taskId) {
  try {
    await API.patch(`/leads/tasks/${taskId}`, { status: 'done' })
    toast('Marked done', 'success')
    refreshLeadDetailPage(leadId)
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

function refreshLeadDetailPage(id) {
  const el = document.getElementById('page-lead-detail')
  if (!el) return
  if (Router.current?.page === 'lead-detail' && String(Router.current?.params?.id) === String(id)) {
    renderLeadDetailPage(el, id)
  }
}

// ── Schedule Follow-up modal (matches screenshot 2) ─────────
// State for the Schedule Follow-up modal. When Activity Type = Meeting we
// also create a real meeting record (linked to the lead) and surface the
// attendees / link / duration controls. Reset every time the modal opens.
let _fu2State = { attendees: [], users: null }

async function openScheduleFollowupModal2(leadId) {
  await loadLeadStatuses()
  // Eagerly load active users for the attendees picker — cheap, and lets
  // the meeting block render immediately when the user toggles type.
  if (!_fu2State.users) {
    try {
      const res = await API.get('/users')
      _fu2State.users = (res.users || res.data || []).filter((u) => Number(u.is_active || 0) === 1)
    } catch { _fu2State.users = [] }
  }
  _fu2State.attendees = []
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const nowTime = `${String(today.getHours()).padStart(2, '0')}:${String(today.getMinutes()).padStart(2, '0')}`
  showModal(`
    <div class="modal-header">
      <h3>Schedule Follow-up</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">Activity Type</label>
        <select id="fu2-type" class="form-select" onchange="_fu2OnTypeChange(this.value)">
          <option value="Call">Call</option>
          <option value="Email">Email</option>
          <option value="Meeting">Meeting</option>
          <option value="Other">Other</option>
        </select>
      </div>

      <!-- Meeting-only block: revealed when type=Meeting. Submit handler
           creates a real meeting + emails lead/attendees if SMTP is set. -->
      <div id="fu2-meeting-block" style="display:none;padding:12px 14px;background:rgba(167,139,250,0.08);border-left:3px solid #a78bfa;border-radius:0 6px 6px 0;margin:8px 0">
        <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#a78bfa;margin-bottom:10px">
          <i class="fas fa-video"></i> A meeting will also be created and visible in Meet Setup.
        </div>
        <div class="form-group" style="margin-bottom:8px">
          <label class="form-label" style="font-size:11px">Meeting link</label>
          <div style="display:flex;gap:6px;align-items:stretch">
            <input id="fu2-link" class="form-input" style="flex:1" placeholder="https://meet.jit.si/… or paste Google Meet / Zoom URL"/>
            <button type="button" class="btn btn-outline btn-sm" onclick="_fu2GenerateLink()" title="Generate free Jitsi link"><i class="fas fa-wand-magic-sparkles"></i> Generate</button>
          </div>
        </div>
        <div class="grid-2" style="margin-bottom:8px">
          <div class="form-group" style="margin:0">
            <label class="form-label" style="font-size:11px">Duration (min)</label>
            <input id="fu2-duration" type="number" min="5" max="600" class="form-input" value="30"/>
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label" style="font-size:11px">&nbsp;</label>
            <div style="font-size:11px;color:#94a3b8;padding-top:6px">Lead + attendees auto-emailed</div>
          </div>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label" style="font-size:11px">Internal attendees (optional)</label>
          <input class="form-input" placeholder="Filter team members…" oninput="_fu2FilterAttendees(this.value)" style="margin-bottom:6px;font-size:12px"/>
          <div id="fu2-attendees-list" style="max-height:140px;overflow:auto;border:1px solid rgba(255,255,255,0.10);border-radius:6px;padding:4px 8px">
            ${_fu2RenderAttendeeOptions(_fu2State.users || [], '')}
          </div>
        </div>
      </div>

      <div class="form-group"><label class="form-label">Activity Note *</label>
        <textarea id="fu2-note" class="form-input" rows="3" placeholder="Discuss pricing options…"></textarea>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Date *</label><input id="fu2-date" type="date" class="form-input" value="${todayStr}"/></div>
        <div class="form-group"><label class="form-label">Time</label><input id="fu2-time" type="time" class="form-input" value="${nowTime}"/></div>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Priority</label>
          <select id="fu2-priority" class="form-select">
            <option value="low">Low</option>
            <option value="medium" selected>Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">Alarm minutes before</label>
          <input id="fu2-snooze" type="number" class="form-input" min="0" max="1440" value="10"/>
          <div class="form-hint" style="font-size:11px;color:#94a3b8;margin-top:4px">Alert pops at follow-up time minus these minutes; rings until you acknowledge.</div>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitScheduleFollowup2('${leadId}')">Schedule</button>
    </div>
  `)
}

function _fu2OnTypeChange(type) {
  const block = document.getElementById('fu2-meeting-block')
  if (block) block.style.display = String(type) === 'Meeting' ? '' : 'none'
}

function _fu2RenderAttendeeOptions(users, filter) {
  const f = String(filter || '').toLowerCase()
  const selected = new Set((_fu2State.attendees || []).map(String))
  const filtered = (users || []).filter((u) => {
    if (!f) return true
    return `${u.full_name || ''} ${u.email || ''} ${u.designation || ''}`.toLowerCase().includes(f)
  })
  if (!filtered.length) return '<div style="padding:6px;color:#64748b;font-size:11px">No matches</div>'
  return filtered.map((u) => {
    const id = String(u.id)
    const checked = selected.has(id) ? 'checked' : ''
    return `<label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;font-size:12px">
      <input type="checkbox" value="${escapeHtml(id)}" ${checked} onchange="_fu2ToggleAttendee('${escapeHtml(id)}', this.checked)"/>
      <span style="flex:1;min-width:0;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(u.full_name || u.email || id)}${u.email ? ` <span style="color:#64748b">· ${escapeHtml(u.email)}</span>` : ''}</span>
    </label>`
  }).join('')
}

function _fu2FilterAttendees(q) {
  const box = document.getElementById('fu2-attendees-list')
  if (box) box.innerHTML = _fu2RenderAttendeeOptions(_fu2State.users || [], q)
}

function _fu2ToggleAttendee(id, checked) {
  const set = new Set((_fu2State.attendees || []).map(String))
  if (checked) set.add(String(id))
  else set.delete(String(id))
  _fu2State.attendees = Array.from(set)
}

function _fu2GenerateLink() {
  // Same Jitsi room-id logic as Meet Setup's Generate button — but uses
  // the activity note as the slug so the URL is readable.
  let rand = ''
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      rand = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    } else if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const bytes = new Uint8Array(12)
      crypto.getRandomValues(bytes)
      rand = Array.from(bytes).map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16)
    }
  } catch {}
  if (!rand) rand = Math.random().toString(36).slice(2, 14) + Math.random().toString(36).slice(2, 6)
  const note = (document.getElementById('fu2-note')?.value || '').trim()
  const slug = (note || 'Followup').replace(/[^a-zA-Z0-9]+/g, '').slice(0, 20) || 'Followup'
  const url = `https://meet.jit.si/Mariox-${slug}-${rand}`
  const input = document.getElementById('fu2-link')
  if (input) input.value = url
  toast('Jitsi Meet link generated', 'success')
}

async function submitScheduleFollowup2(leadId) {
  const type = document.getElementById('fu2-type').value
  const note = document.getElementById('fu2-note').value.trim()
  const date = document.getElementById('fu2-date').value
  const time = document.getElementById('fu2-time').value || '10:00'
  const priority = document.getElementById('fu2-priority').value
  const snoozeRaw = Number(document.getElementById('fu2-snooze')?.value)
  const snooze = Number.isFinite(snoozeRaw) ? Math.max(0, Math.min(1440, Math.round(snoozeRaw))) : 10
  if (!note) { toast('Activity note is required', 'error'); return }
  if (!date) { toast('Date is required', 'error'); return }
  const due = new Date(`${date}T${time}:00`)
  if (Number.isNaN(due.getTime())) { toast('Invalid date/time', 'error'); return }
  try {
    await API.post(`/leads/${leadId}/followups`, {
      title: `${type}: ${note.slice(0, 60)}`,
      notes: note,
      due_date: due.toISOString(),
      snooze_minutes: snooze,
      priority,
    })

    // If the user picked "Meeting", also create a real meeting tied to
    // this lead. Failures here are surfaced as a warning but don't roll
    // back the follow-up — that part already succeeded.
    let suffix = ''
    let toastKind = 'success'
    if (type === 'Meeting') {
      const meetingLink = (document.getElementById('fu2-link')?.value || '').trim()
      const durationRaw = Number(document.getElementById('fu2-duration')?.value)
      const duration_mins = Number.isFinite(durationRaw) ? Math.max(5, Math.min(600, Math.round(durationRaw))) : 30
      const meetingTitle = note.length > 80 ? `${note.slice(0, 77)}…` : (note || 'Meeting with lead')
      try {
        const res = await API.post('/meetings', {
          title: meetingTitle,
          lead_id: leadId,
          scheduled_at: due.toISOString(),
          duration_mins,
          meeting_link: meetingLink,
          agenda: note,
          attendees: Array.from(_fu2State.attendees || []),
        })
        const inv = res?.invites
        if (inv?.skipped) { suffix = ' · meeting created (SMTP off, no emails)'; toastKind = 'warning' }
        else if (inv?.sent && inv.failed) { suffix = ` · meeting created (${inv.sent} sent, ${inv.failed} failed)`; toastKind = 'warning' }
        else if (inv?.sent) suffix = ` · meeting created, invite sent to ${inv.sent}`
        else suffix = ' · meeting created'
      } catch (e) {
        suffix = ` · meeting create failed: ${e.message || 'check permissions'}`
        toastKind = 'warning'
      }
    }
    toast(`Follow-up scheduled${suffix}`, toastKind)
    closeModal()
    refreshLeadDetailPage(leadId)
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

// ── Add Task modal (matches screenshot 3) ───────────────────
function openAddTaskModal(leadId) {
  const todayStr = new Date().toISOString().slice(0, 10)
  showModal(`
    <div class="modal-header">
      <h3>Add Task</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">Title *</label>
        <input id="task2-title" class="form-input" placeholder="Follow up call, Send proposal…" autofocus/>
      </div>
      <div class="form-group"><label class="form-label">Description</label>
        <textarea id="task2-desc" class="form-input" rows="3" placeholder="Additional details…"></textarea>
      </div>
      <div class="form-group"><label class="form-label">Due Date *</label>
        <input id="task2-due" type="date" class="form-input" value="${todayStr}"/>
      </div>
      <div class="form-group"><label class="form-label">Priority</label>
        <select id="task2-priority" class="form-select">
          <option value="low">Low</option>
          <option value="medium" selected>Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitAddTask('${leadId}')">Create</button>
    </div>
  `)
}

async function submitAddTask(leadId) {
  const title = document.getElementById('task2-title').value.trim()
  const description = document.getElementById('task2-desc').value.trim()
  const due = document.getElementById('task2-due').value
  const priority = document.getElementById('task2-priority').value
  if (!title) { toast('Title is required', 'error'); return }
  if (!due) { toast('Due date is required', 'error'); return }
  try {
    await API.post(`/leads/${leadId}/tasks`, {
      title,
      description,
      due_date: new Date(`${due}T17:00:00`).toISOString(),
      priority,
    })
    toast('Task created', 'success')
    closeModal()
    refreshLeadDetailPage(leadId)
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

// ── Add Activity modal (matches screenshot 4) ───────────────
function openAddActivityModal(leadId) {
  showModal(`
    <div class="modal-header">
      <h3>Add Activity</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">Type</label>
        <select id="act2-type" class="form-select">
          <option value="note" selected>Note</option>
          <option value="call">Call</option>
          <option value="email">Email</option>
          <option value="meeting">Meeting</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Content *</label>
        <textarea id="act2-content" class="form-input" rows="4" placeholder="Add your note…" autofocus></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitAddActivity('${leadId}')">Add</button>
    </div>
  `)
}

async function submitAddActivity(leadId) {
  const kind = document.getElementById('act2-type').value
  const content = document.getElementById('act2-content').value.trim()
  if (!content) { toast('Content is required', 'error'); return }
  try {
    if (kind === 'note') {
      // Persist as a real note (so it shows in /notes endpoint too) and also
      // produces a note_added activity entry.
      await API.post(`/leads/${leadId}/notes`, { text: content })
    } else {
      await API.post(`/leads/${leadId}/activities`, { kind, content })
    }
    toast('Added', 'success')
    closeModal()
    refreshLeadDetailPage(leadId)
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

// ═══════════════════════════════════════════════════════════════
// Cross-lead list pages — Follow-ups and Tasks sidebar items.
// Each renders a flat table of every visible lead's tasks of that
// kind (followup vs task), with quick filters and direct links to
// the lead detail page.
// ═══════════════════════════════════════════════════════════════

let _leadListFilter = { followups: 'open', tasks: 'open' }

async function renderLeadFollowupsPage(el) {
  return renderLeadTaskListPage(el, {
    kind: 'followup',
    title: 'Follow-ups',
    icon: 'fa-calendar-check',
    iconColor: '#3b82f6',
    emptyMsg: 'No follow-ups scheduled across your leads yet.',
  })
}

async function renderLeadTasksPage(el) {
  return renderLeadTaskListPage(el, {
    kind: 'task',
    title: 'Lead Tasks',
    icon: 'fa-list-check',
    iconColor: '#22c55e',
    emptyMsg: 'No lead tasks created yet.',
  })
}

// ── Sale Tracker ────────────────────────────────────────────
// Cross-cut view of every lead grouped by stage, source, assignee, and
// recency. Built so a manager can answer "where is the pipeline stuck?"
// without clicking into individual leads.
let _salesTrackerView = 'pipeline' // pipeline | source | assignee | recent
let _salesTrackerFrom = ''
let _salesTrackerTo = ''

async function renderSalesTrackerPage(el) {
  el.innerHTML = `<div style="padding:24px;color:#94a3b8"><i class="fas fa-spinner fa-spin"></i> Loading sale tracker…</div>`
  try {
    await Promise.all([loadLeadStatuses(), loadLeadSources()])
    const res = await API.get('/leads')
    const allLeads = res.data || res.leads || []
    const leads = _salesTrackerFilter(allLeads)

    const total = leads.length
    const byStatus = _groupBy(leads, (l) => String(l.status || 'new').toLowerCase())
    const closedKeys = ['closed', 'won', 'closed_won']
    const lostKeys = ['lost', 'closed_lost', 'cold']
    const closedCount = closedKeys.reduce((n, k) => n + (byStatus[k]?.length || 0), 0)
    const lostCount = lostKeys.reduce((n, k) => n + (byStatus[k]?.length || 0), 0)
    const openCount = total - closedCount - lostCount
    const conversion = total ? Math.round((closedCount / total) * 100) : 0

    const tabBtn = (key, label, icon) => `
      <button class="btn btn-sm ${_salesTrackerView === key ? 'btn-primary' : 'btn-outline'}"
        onclick="switchSalesTrackerView('${key}')"><i class="fas ${icon}"></i> ${label}</button>`

    let bodyHtml = ''
    if (_salesTrackerView === 'pipeline')      bodyHtml = _renderTrackerPipeline(leads, byStatus)
    else if (_salesTrackerView === 'source')   bodyHtml = _renderTrackerBySource(leads)
    else if (_salesTrackerView === 'assignee') bodyHtml = _renderTrackerByAssignee(leads)
    else                                       bodyHtml = _renderTrackerRecent(leads)

    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title"><i class="fas fa-chart-line" style="color:#22c55e;margin-right:8px"></i>Sale Tracker</h1>
          <p class="page-subtitle">Track the pipeline by stage, source, owner, and activity.</p>
        </div>
        <div class="page-actions" style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" onclick="exportSalesTrackerCsv()" title="Export current view as CSV"><i class="fas fa-file-export"></i> Export</button>
        </div>
      </div>

      <div class="card" style="margin-bottom:14px">
        <div class="card-body" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;padding:12px 16px">
          <div class="form-group" style="margin:0;min-width:160px">
            <label class="form-label" style="font-size:11px">From date</label>
            <input id="tracker-from" type="date" class="form-input" value="${_salesTrackerFrom}" onchange="onTrackerDateChange()"/>
          </div>
          <div class="form-group" style="margin:0;min-width:160px">
            <label class="form-label" style="font-size:11px">To date</label>
            <input id="tracker-to" type="date" class="form-input" value="${_salesTrackerTo}" onchange="onTrackerDateChange()"/>
          </div>
          ${(_salesTrackerFrom || _salesTrackerTo) ? `<button class="btn btn-outline btn-sm" onclick="clearTrackerDates()" style="margin-bottom:2px"><i class="fas fa-times"></i> Clear</button>` : ''}
          <div style="flex:1"></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            ${tabBtn('pipeline', 'Pipeline', 'fa-stream')}
            ${tabBtn('source', 'By Source', 'fa-bullhorn')}
            ${tabBtn('assignee', 'By Owner', 'fa-user-tie')}
            ${tabBtn('recent', 'Recent Activity', 'fa-clock')}
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:14px">
        ${_trackerKpiCard('Total Leads', total, 'fa-bullseye', '#FF7A45')}
        ${_trackerKpiCard('Open Pipeline', openCount, 'fa-stream', '#3b82f6')}
        ${_trackerKpiCard('Won', closedCount, 'fa-trophy', '#22c55e')}
        ${_trackerKpiCard('Lost / Cold', lostCount, 'fa-snowflake', '#94a3b8')}
        ${_trackerKpiCard('Conversion', conversion + '%', 'fa-percent', '#FFB347')}
      </div>

      ${bodyHtml}
    `
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>`
  }
}

function _salesTrackerFilter(leads) {
  return leads.filter((l) => {
    const created = l.created_at ? new Date(l.created_at).getTime() : 0
    if (_salesTrackerFrom) {
      const from = new Date(_salesTrackerFrom + 'T00:00:00').getTime()
      if (created < from) return false
    }
    if (_salesTrackerTo) {
      const to = new Date(_salesTrackerTo + 'T23:59:59').getTime()
      if (created > to) return false
    }
    return true
  })
}

function _trackerKpiCard(label, value, icon, color) {
  return `<div class="card"><div class="card-body" style="padding:14px 16px;display:flex;align-items:center;gap:12px">
    <div style="width:42px;height:42px;border-radius:12px;background:${color}22;display:flex;align-items:center;justify-content:center;color:${color};font-size:18px"><i class="fas ${icon}"></i></div>
    <div>
      <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;font-weight:600">${label}</div>
      <div style="font-size:22px;font-weight:700;color:#e2e8f0">${value}</div>
    </div>
  </div></div>`
}

function _groupBy(items, keyFn) {
  const out = {}
  for (const it of items) {
    const k = keyFn(it)
    if (!out[k]) out[k] = []
    out[k].push(it)
  }
  return out
}

function _renderTrackerPipeline(leads, byStatus) {
  const order = _leadStatusOrder.length ? _leadStatusOrder : Object.keys(byStatus)
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">
    ${order.map((key) => {
      const meta = LEAD_STATUS_META[key] || { label: key, badge: 'todo' }
      const items = byStatus[key] || []
      const pct = leads.length ? Math.round((items.length / leads.length) * 100) : 0
      return `<div class="card"><div class="card-body" style="padding:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <span class="badge badge-${meta.badge}">${escapeHtml(meta.label)}</span>
          <span style="font-size:18px;font-weight:700;color:#e2e8f0">${items.length}</span>
        </div>
        <div style="height:6px;border-radius:3px;background:rgba(255,255,255,0.08);overflow:hidden;margin-bottom:10px">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#FF7A45,#FFB347)"></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto">
          ${items.slice(0, 8).map((l) => `
            <div onclick="goLeadDetail('${l.id}')" style="cursor:pointer;padding:8px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06)">
              <div style="font-size:12.5px;font-weight:600;color:#e2e8f0">${escapeHtml(l.name)}</div>
              <div style="font-size:11px;color:#94a3b8;margin-top:2px">${escapeHtml(l.assigned_to_name || '—')} · ${escapeHtml(l.source || '—')}</div>
            </div>`).join('') || `<div style="font-size:12px;color:#64748b;padding:8px">No leads in this stage.</div>`}
          ${items.length > 8 ? `<div style="font-size:11px;color:#64748b;text-align:center">+${items.length - 8} more</div>` : ''}
        </div>
      </div></div>`
    }).join('')}
  </div>`
}

function _renderTrackerBySource(leads) {
  const groups = _groupBy(leads, (l) => l.source || 'Unknown')
  const sorted = Object.entries(groups).sort((a, b) => b[1].length - a[1].length)
  if (!sorted.length) return `<div class="empty-state"><i class="fas fa-inbox"></i><p>No leads to analyze yet.</p></div>`
  return `<div class="card"><div class="card-body" style="padding:0">
    <table class="data-table">
      <thead><tr><th>Source</th><th>Total</th><th>Won</th><th>Lost / Cold</th><th>Conversion</th><th>Distribution</th></tr></thead>
      <tbody>
        ${sorted.map(([src, items]) => {
          const won = items.filter((l) => ['closed', 'won', 'closed_won'].includes(String(l.status || '').toLowerCase())).length
          const lost = items.filter((l) => ['lost', 'closed_lost', 'cold'].includes(String(l.status || '').toLowerCase())).length
          const conv = items.length ? Math.round((won / items.length) * 100) : 0
          const pct = leads.length ? (items.length / leads.length) * 100 : 0
          return `<tr>
            <td style="font-weight:600;color:#e2e8f0">${escapeHtml(src)}</td>
            <td>${items.length}</td>
            <td style="color:#22c55e">${won}</td>
            <td style="color:#94a3b8">${lost}</td>
            <td style="font-weight:600;color:${conv >= 30 ? '#22c55e' : conv >= 10 ? '#FFB347' : '#FF5E3A'}">${conv}%</td>
            <td style="min-width:160px"><div style="height:8px;border-radius:4px;background:rgba(255,255,255,0.06);overflow:hidden"><div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#FF7A45,#FFB347)"></div></div></td>
          </tr>`
        }).join('')}
      </tbody>
    </table>
  </div></div>`
}

function _renderTrackerByAssignee(leads) {
  const groups = _groupBy(leads, (l) => l.assigned_to_name || 'Unassigned')
  const sorted = Object.entries(groups).sort((a, b) => b[1].length - a[1].length)
  if (!sorted.length) return `<div class="empty-state"><i class="fas fa-inbox"></i><p>No leads to analyze yet.</p></div>`
  return `<div class="card"><div class="card-body" style="padding:0">
    <table class="data-table">
      <thead><tr><th>Owner</th><th>Total</th><th>Open</th><th>Won</th><th>Lost / Cold</th><th>Conversion</th></tr></thead>
      <tbody>
        ${sorted.map(([name, items]) => {
          const won = items.filter((l) => ['closed', 'won', 'closed_won'].includes(String(l.status || '').toLowerCase())).length
          const lost = items.filter((l) => ['lost', 'closed_lost', 'cold'].includes(String(l.status || '').toLowerCase())).length
          const open = items.length - won - lost
          const conv = items.length ? Math.round((won / items.length) * 100) : 0
          return `<tr>
            <td style="display:flex;align-items:center;gap:8px">${avatar(name, '#FF7A45', 'sm')} <span style="font-weight:600;color:#e2e8f0">${escapeHtml(name)}</span></td>
            <td>${items.length}</td>
            <td style="color:#3b82f6">${open}</td>
            <td style="color:#22c55e">${won}</td>
            <td style="color:#94a3b8">${lost}</td>
            <td style="font-weight:600;color:${conv >= 30 ? '#22c55e' : conv >= 10 ? '#FFB347' : '#FF5E3A'}">${conv}%</td>
          </tr>`
        }).join('')}
      </tbody>
    </table>
  </div></div>`
}

function _renderTrackerRecent(leads) {
  const sorted = leads.slice().sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))
  const items = sorted.slice(0, 30)
  if (!items.length) return `<div class="empty-state"><i class="fas fa-inbox"></i><p>No recent activity to show.</p></div>`
  return `<div class="card"><div class="card-body" style="padding:0">
    <table class="data-table">
      <thead><tr><th>Lead</th><th>Status</th><th>Owner</th><th>Source</th><th>Last Updated</th><th style="width:70px"></th></tr></thead>
      <tbody>
        ${items.map((l) => {
          const key = String(l.status || 'new').toLowerCase()
          const meta = LEAD_STATUS_META[key] || { label: key, badge: 'todo' }
          return `<tr>
            <td><div style="display:flex;align-items:center;gap:8px;cursor:pointer" onclick="goLeadDetail('${l.id}')">${avatar(l.name, '#FF7A45', 'sm')}<div><div style="font-weight:600;color:#e2e8f0">${escapeHtml(l.name)}</div><div style="font-size:11px;color:#64748b">${escapeHtml(l.email || '')}</div></div></div></td>
            <td><span class="badge badge-${meta.badge}">${escapeHtml(meta.label)}</span></td>
            <td>${escapeHtml(l.assigned_to_name || '—')}</td>
            <td>${escapeHtml(l.source || '—')}</td>
            <td style="font-size:12px;color:#94a3b8">${fmtDateTime(l.updated_at || l.created_at)}</td>
            <td><button class="btn btn-xs btn-outline" onclick="goLeadDetail('${l.id}')"><i class="fas fa-up-right-from-square"></i></button></td>
          </tr>`
        }).join('')}
      </tbody>
    </table>
  </div></div>`
}

function switchSalesTrackerView(view) {
  _salesTrackerView = view
  const el = document.getElementById('page-sales-tracker')
  if (el) { el.dataset.loaded = ''; loadPage('sales-tracker', el) }
}

function onTrackerDateChange() {
  _salesTrackerFrom = document.getElementById('tracker-from')?.value || ''
  _salesTrackerTo = document.getElementById('tracker-to')?.value || ''
  const el = document.getElementById('page-sales-tracker')
  if (el) { el.dataset.loaded = ''; loadPage('sales-tracker', el) }
}

function clearTrackerDates() {
  _salesTrackerFrom = ''
  _salesTrackerTo = ''
  const el = document.getElementById('page-sales-tracker')
  if (el) { el.dataset.loaded = ''; loadPage('sales-tracker', el) }
}

async function exportSalesTrackerCsv() {
  try {
    const res = await API.get('/leads')
    const all = res.data || res.leads || []
    const leads = _salesTrackerFilter(all)
    if (!leads.length) { toast('No leads in the current date range', 'info'); return }

    const headers = ['name', 'email', 'phone', 'source', 'status', 'assigned_to_name', 'created_at', 'updated_at']
    const csvEscape = (v) => {
      const s = v === null || v === undefined ? '' : String(v)
      if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
      return s
    }
    const lines = [headers.join(',')]
    for (const l of leads) {
      lines.push([
        l.name, l.email, l.phone, l.source, l.status,
        l.assigned_to_name || '', l.created_at, l.updated_at,
      ].map(csvEscape).join(','))
    }
    const csv = lines.join('\n') + '\n'
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sales_tracker_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast(`Exported ${leads.length} lead${leads.length === 1 ? '' : 's'}`, 'success')
  } catch (e) {
    toast('Export failed: ' + (e.message || 'unknown'), 'error')
  }
}

async function renderLeadTaskListPage(el, opts) {
  const filterKey = opts.kind === 'task' ? 'tasks' : 'followups'
  const filter = _leadListFilter[filterKey] || 'open'
  el.innerHTML = `<div class="page-header">
    <h1 class="page-title"><i class="fas ${opts.icon}" style="color:${opts.iconColor};margin-right:8px"></i>${opts.title}</h1>
  </div>
  <div class="loading-state" style="padding:40px;text-align:center;color:#94a3b8"><i class="fas fa-spinner fa-spin"></i> Loading…</div>`
  try {
    await loadLeadStatuses()
    const res = await API.get(`/leads/tasks-list?kind=${encodeURIComponent(opts.kind)}`)
    const all = res.data || res.tasks || []
    const visible = all.filter((t) => {
      const s = String(t.status || 'pending').toLowerCase()
      const isTerminal = s === 'done' || s === 'skipped' || s === 'cancelled'
      if (filter === 'open') return !isTerminal
      if (filter === 'done') return isTerminal
      return true // 'all'
    })
    const overdueCount = all.filter((t) => {
      const s = String(t.status || 'pending').toLowerCase()
      const isTerminal = s === 'done' || s === 'skipped' || s === 'cancelled'
      return !isTerminal && t.due_date && new Date(t.due_date).getTime() < Date.now()
    }).length

    el.innerHTML = `<div class="page-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
      <div>
        <h1 class="page-title"><i class="fas ${opts.icon}" style="color:${opts.iconColor};margin-right:8px"></i>${opts.title}</h1>
        <div style="font-size:12px;color:#94a3b8;margin-top:2px">${all.length} total · ${overdueCount} overdue</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        ${['open', 'done', 'all'].map((f) => `<button class="btn btn-sm ${filter === f ? 'btn-primary' : 'btn-outline'}" onclick="setLeadListFilter('${filterKey}','${f}')">${f === 'open' ? 'Open' : f === 'done' ? 'Completed' : 'All'}</button>`).join('')}
      </div>
    </div>
    ${visible.length === 0
      ? `<div class="empty-state" style="padding:40px;text-align:center;color:#64748b"><i class="fas ${opts.icon}" style="font-size:32px;color:#475569"></i><p style="margin-top:10px">${opts.emptyMsg}</p></div>`
      : `<div class="card" style="padding:0;overflow:hidden">
          <table class="data-table" style="width:100%;border-collapse:collapse">
            <thead><tr style="background:#0f172a40">
              <th style="padding:10px 14px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase">Title</th>
              <th style="padding:10px 14px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase">Lead</th>
              <th style="padding:10px 14px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase">Assignee</th>
              <th style="padding:10px 14px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase">Due</th>
              <th style="padding:10px 14px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase">Status</th>
              <th style="padding:10px 14px;text-align:right;font-size:11px;color:#64748b;text-transform:uppercase">Actions</th>
            </tr></thead>
            <tbody>${visible.map((t) => renderLeadTaskListRow(t)).join('')}</tbody>
          </table>
        </div>`
    }`
  } catch (e) {
    el.innerHTML = `<div class="page-header"><h1 class="page-title">${opts.title}</h1></div>
      <div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${escapeHtml(e.message)}</p></div>`
  }
}

function renderLeadTaskListRow(t) {
  const statusKey = String(t.status || 'pending').toLowerCase()
  const meta = LEAD_TASK_STATUS_META[statusKey] || { label: statusKey, badge: 'todo' }
  const isTerminal = statusKey === 'done' || statusKey === 'skipped' || statusKey === 'cancelled'
  const overdue = t.due_date && !isTerminal && new Date(t.due_date).getTime() < Date.now()
  return `<tr style="border-top:1px solid #1e293b">
    <td style="padding:10px 14px">
      <div style="font-size:13px;color:#e2e8f0;font-weight:500">${escapeHtml(t.title || '')}</div>
      ${t.notes ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px">${escapeHtml(String(t.notes).slice(0, 80))}${t.notes.length > 80 ? '…' : ''}</div>` : ''}
    </td>
    <td style="padding:10px 14px">
      <a style="color:#FF7A45;font-size:13px;cursor:pointer" onclick="goLeadDetail('${t.lead_id}')">${escapeHtml(t.lead_name || '—')}</a>
      ${t.lead_phone ? `<div style="font-size:11px;color:#64748b">${escapeHtml(t.lead_phone)}</div>` : ''}
    </td>
    <td style="padding:10px 14px;font-size:13px;color:#cbd5e1">${escapeHtml(t.assignee_name || '—')}</td>
    <td style="padding:10px 14px;font-size:12px;${overdue ? 'color:#FF5E3A;font-weight:600' : 'color:#94a3b8'}">${fmtDateTime(t.due_date)}${overdue ? ' (overdue)' : ''}</td>
    <td style="padding:10px 14px"><span class="badge badge-${meta.badge}">${escapeHtml(meta.label)}</span></td>
    <td style="padding:10px 14px;text-align:right">
      <div style="display:inline-flex;gap:4px">
        <button class="btn btn-xs btn-outline" title="Open lead" onclick="goLeadDetail('${t.lead_id}')"><i class="fas fa-up-right-from-square"></i></button>
        ${!isTerminal ? `<button class="btn btn-xs btn-outline" title="Mark done" onclick="markLeadTaskDoneFromList('${t.id}','${t.lead_id}')"><i class="fas fa-check"></i></button>` : ''}
      </div>
    </td>
  </tr>`
}

function setLeadListFilter(kind, filter) {
  _leadListFilter[kind] = filter
  const pageId = kind === 'tasks' ? 'page-lead-tasks' : 'page-lead-followups'
  const el = document.getElementById(pageId)
  if (el) { el.dataset.loaded = ''; loadPage(pageId.replace(/^page-/, ''), el) }
}

async function markLeadTaskDoneFromList(taskId, leadId) {
  try {
    await API.patch(`/leads/tasks/${taskId}`, { status: 'done' })
    toast('Marked done', 'success')
    // Refresh whichever list page is currently active.
    const active = document.querySelector('.page.active')
    if (active && active.id?.startsWith('page-')) {
      active.dataset.loaded = ''
      loadPage(active.id.replace(/^page-/, ''), active)
    }
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}
