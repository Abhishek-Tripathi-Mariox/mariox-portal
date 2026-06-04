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
// Activity filter is multi-select with AND logic — a lead must have EVERY
// selected activity kind in its history to appear in the filtered list. Empty
// array means "no activity filter applied".
let _leadsActivityFilter = []
let _leadsAssigneeOptionsCache = []

// Activity filter options — shown as a single high-level dropdown on the
// leads list. Each entry maps a human label to the activity-log `kind`
// recorded by the backend. Selecting one filters leads to those that have
// at least one matching activity in their history.
const LEAD_ACTIVITY_FILTER_OPTIONS = [
  ['note_added',       'Note added'],
  ['comment_added',    'Comment added'],
  ['portfolio_sent',   'Portfolio sent'],
  ['scope_sent',       'SOW / Scope sent'],
  ['quotation_sent',   'Quotation sent'],
  ['mail_sent',        'Mail sent'],
  ['followup_added',   'Follow-up scheduled'],
  ['followup_updated', 'Follow-up updated'],
  ['task_added',       'Task added'],
  ['status_changed',   'Status changed'],
  ['reassigned',       'Reassigned'],
  ['handover_credit',  'Revenue handover'],
  ['lead_closed',      'Lead closed'],
  // Imported follow-ups log their activity under this catch-all so a manager
  // can filter the leads list to "everything that came in via bulk import".
  ['other',            'Other (imported)'],
]

// Statuses are seeded on the server (5 defaults each) and editable via
// the "Manage Statuses" modal. Cached after the first fetch and refreshed
// whenever the user mutates them.
let LEAD_STATUS_META = {}
let LEAD_TASK_STATUS_META = {}
let _leadStatusOrder = []
let _leadTaskStatusOrder = []

const LEAD_BADGE_OPTIONS = ['todo', 'inprogress', 'review', 'done', 'critical', 'medium']

// Render a status badge. When the status carries a custom hex `color`, tint the
// badge with it (soft background + coloured text/border); otherwise fall back to
// the preset badge-<class> colours. `meta` is a LEAD_STATUS_META entry.
function statusBadgeHtml(meta, fallbackLabel) {
  const label = escapeHtml(meta?.label || fallbackLabel || '')
  const color = meta?.color
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) {
    const r = parseInt(color.slice(1, 3), 16)
    const g = parseInt(color.slice(3, 5), 16)
    const b = parseInt(color.slice(5, 7), 16)
    const style = `background:rgba(${r},${g},${b},.16);color:${color};border:1px solid rgba(${r},${g},${b},.4)`
    return `<span class="badge" style="${style}">${label}</span>`
  }
  return `<span class="badge badge-${meta?.badge || 'todo'}">${label}</span>`
}

async function loadLeadStatuses(force = false) {
  if (!force && _leadStatusOrder.length && _leadTaskStatusOrder.length) return
  try {
    const res = await API.get('/leads/statuses')
    const lead = res.lead || res.data?.lead || []
    const task = res.task || res.data?.task || []
    LEAD_STATUS_META = {}
    _leadStatusOrder = []
    for (const s of lead) {
      LEAD_STATUS_META[s.key] = { label: s.label, badge: s.badge, color: s.color || null, id: s.id, is_system: s.is_system }
      _leadStatusOrder.push(s.key)
    }
    LEAD_TASK_STATUS_META = {}
    _leadTaskStatusOrder = []
    for (const s of task) {
      LEAD_TASK_STATUS_META[s.key] = { label: s.label, badge: s.badge, color: s.color || null, id: s.id, is_system: s.is_system }
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
  const role = String(_user?.role || '').toLowerCase()
  if (['admin', 'pm', 'pc', 'sales_manager', 'sales_tl'].includes(role)) return true
  // Anyone admin has explicitly granted a leads.* permission to (sales agents,
  // custom roles, etc.) can also create / manage leads from the UI. Backend
  // still enforces the same check, so missing the permission only hides UI
  // affordances.
  if (typeof hasAnyPermission === 'function' && hasAnyPermission(['leads.create', 'leads.edit', 'leads.delete'])) return true
  return false
}

// Delete is gated separately because leadsCanManage() is also true for users
// with only `leads.create` or `leads.edit` — those people shouldn't see the
// trash button. Backend enforces the same check.
function leadsCanDelete() {
  const role = String(_user?.role || '').toLowerCase()
  if (role === 'admin') return true
  if (['pm', 'pc'].includes(role)) return true
  return typeof hasAnyPermission === 'function' && hasAnyPermission(['leads.delete'])
}

// Manage Statuses / Sources buttons each have their own permission key now —
// admin/pm/pc remain default, anyone else needs the explicit grant.
// Trash permissions. View is required to see the page at all; restore + purge
// are checked separately to show/hide the corresponding row buttons. Admin
// always has all three; everyone else needs the explicit grant.
function leadsCanViewTrash() {
  const role = String(_user?.role || '').toLowerCase()
  if (role === 'admin') return true
  return typeof hasAnyPermission === 'function' && hasAnyPermission(['leads.trash.view'])
}
function leadsCanRestore() {
  const role = String(_user?.role || '').toLowerCase()
  if (role === 'admin') return true
  return typeof hasAnyPermission === 'function' && hasAnyPermission(['leads.trash.restore'])
}
function leadsCanPurge() {
  const role = String(_user?.role || '').toLowerCase()
  if (role === 'admin') return true
  return typeof hasAnyPermission === 'function' && hasAnyPermission(['leads.trash.purge'])
}

function leadsCanManageStatuses() {
  const role = String(_user?.role || '').toLowerCase()
  if (role === 'admin' || ['pm', 'pc'].includes(role)) return true
  return typeof hasAnyPermission === 'function' && hasAnyPermission(['leads.manage_statuses'])
}
function leadsCanManageSources() {
  const role = String(_user?.role || '').toLowerCase()
  if (role === 'admin' || ['pm', 'pc'].includes(role)) return true
  return typeof hasAnyPermission === 'function' && hasAnyPermission(['leads.manage_sources'])
}
function leadsCanManageTaskColumns() {
  const role = String(_user?.role || '').toLowerCase()
  if (role === 'admin') return true
  return typeof hasAnyPermission === 'function' && hasAnyPermission(['leads.manage_task_columns'])
}
// Lazily-created custom-columns registry for sales (lead) tasks.
function salesTaskColumns() {
  if (!window._salesTaskCols && typeof CustomColumns !== 'undefined') {
    window._salesTaskCols = CustomColumns.register('sales', {
      apiBase: '/lead-task-columns',
      idField: 'id',
      canManage: leadsCanManageTaskColumns,
      save: (task, customValues) => API.patch('/leads/tasks/' + task.id, { custom_values: customValues }),
      onChange: () => { const id = _leadDetailState?.id; if (id) openLeadDetailModal(id, { tab: 'followups' }) },
    })
  }
  return window._salesTaskCols
}

function leadsCanCreate() {
  const role = String(_user?.role || '').toLowerCase()
  if (['admin', 'pm', 'pc', 'sales_manager', 'sales_tl'].includes(role)) return true
  if (typeof hasAnyPermission === 'function' && hasAnyPermission(['leads.create'])) return true
  return false
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

// Stashed so the partial-refresh helpers (toggle a filter chip / activity
// kind) can re-render the table without re-fetching from /api/leads — that
// avoids the brief "Loading leads…" flash that flickered every time the user
// toggled a checkbox in the Activity dropdown.
let _leadsViewCache = { leads: [], assignees: [], el: null }

// ── Lead Trash module ──────────────────────────────────────────
// Soft-deleted leads land here with their deletion reason, deleter, and
// timestamp. Restore puts them back in the active list; purge removes them
// from the database permanently along with every related task/note/comment.
async function renderLeadsTrashPage(el) {
  if (!leadsCanViewTrash()) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-lock"></i><p>You don't have permission to view the Lead Trash.</p><small>Ask an admin to grant <code>leads.trash.view</code>.</small></div>`
    return
  }
  el.innerHTML = `<div style="padding:24px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Loading trash…</div>`
  try {
    const res = await API.get('/leads/trash/list')
    const rows = res.leads || res.data || []
    const canRestore = leadsCanRestore()
    const canPurge = leadsCanPurge()
    el.innerHTML = `
      <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding-bottom:8px">
        <div>
          <h2 style="margin:0"><i class="fas fa-trash-restore" style="color:#FF9F40;margin-right:8px"></i>Lead Trash</h2>
          <div style="font-size:12px;color:var(--text-muted);margin-top:4px">Soft-deleted leads. Restore brings them back; permanent delete removes them and every related task, note, comment, and activity.</div>
        </div>
        <button class="btn btn-outline btn-sm" onclick="(function(){ const e=document.getElementById('page-leads-trash'); if(e){e.dataset.loaded='';loadPage('leads-trash',e)} })()"><i class="fas fa-rotate"></i> Refresh</button>
      </div>
      ${rows.length ? `
      <div class="card" style="margin-top:12px;overflow:hidden">
        <table class="data-table" style="width:100%;border-collapse:collapse">
          <thead>
            <tr>
              <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#C9A7FF;text-transform:uppercase;letter-spacing:.5px;text-align:left">Lead</th>
              <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#C9A7FF;text-transform:uppercase;letter-spacing:.5px;text-align:left">Status</th>
              <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#C9A7FF;text-transform:uppercase;letter-spacing:.5px;text-align:left">Deleted by</th>
              <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#C9A7FF;text-transform:uppercase;letter-spacing:.5px;text-align:left">When</th>
              <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#C9A7FF;text-transform:uppercase;letter-spacing:.5px;text-align:left">Reason</th>
              <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#C9A7FF;text-transform:uppercase;letter-spacing:.5px;text-align:right">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((l) => `
              <tr style="border-bottom:1px solid rgba(255,255,255,.04)">
                <td style="padding:12px;vertical-align:top">
                  <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${escapeHtml(l.name || '—')}</div>
                  <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${escapeHtml(l.email || '')} ${l.phone ? '· ' + escapeHtml(l.phone) : ''}</div>
                  <div style="font-size:10px;color:#7E7E8F;margin-top:2px">${escapeHtml(l.id || '')}</div>
                </td>
                <td style="padding:12px;vertical-align:top;font-size:12px;color:var(--text-secondary)">${escapeHtml(l.status || '—')}</td>
                <td style="padding:12px;vertical-align:top;font-size:12px;color:var(--text-secondary)">${escapeHtml(l.deleted_by_name || '—')}</td>
                <td style="padding:12px;vertical-align:top;font-size:12px;color:var(--text-muted)">${l.deleted_at ? (typeof timeAgo === 'function' ? timeAgo(l.deleted_at) : fmtDate(l.deleted_at)) : '—'}</td>
                <td style="padding:12px;vertical-align:top;font-size:12px;color:var(--text-secondary);max-width:340px;white-space:pre-wrap;word-break:break-word">${escapeHtml(l.deleted_reason || '—')}</td>
                <td style="padding:12px;text-align:right;vertical-align:top;white-space:nowrap">
                  ${canRestore ? `<button class="btn btn-xs btn-primary" onclick="restoreLead('${escapeHtml(l.id)}','${escapeHtml((l.name || '').replace(/'/g, "\\'"))}')"><i class="fas fa-rotate-left"></i> Restore</button>` : ''}
                  ${canPurge ? `<button class="btn btn-xs btn-danger" style="margin-left:4px" onclick="confirmPurgeLead('${escapeHtml(l.id)}','${escapeHtml((l.name || '').replace(/'/g, "\\'"))}')"><i class="fas fa-trash"></i> Delete forever</button>` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>` : `
      <div class="empty-state" style="margin-top:24px">
        <i class="fas fa-trash-restore" style="color:#7E7E8F"></i>
        <p>Trash is empty</p>
        <small>Leads moved to Trash will appear here. Sales managers can restore them or purge them permanently.</small>
      </div>`}
    `
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${escapeHtml(e.message || 'Failed to load trash')}</p></div>`
  }
}
window.renderLeadsTrashPage = renderLeadsTrashPage

async function restoreLead(id, name) {
  if (!confirm(`Restore "${name || 'this lead'}" from Trash?`)) return
  try {
    await API.post(`/leads/${id}/restore`, {})
    toast('Lead restored', 'success')
    const el = document.getElementById('page-leads-trash')
    if (el) { el.dataset.loaded = ''; loadPage('leads-trash', el) }
  } catch (e) {
    toast('Restore failed: ' + (e?.message || ''), 'error')
  }
}
window.restoreLead = restoreLead

function confirmPurgeLead(id, name) {
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-triangle-exclamation" style="color:#FF5E3A;margin-right:6px"></i> Permanently delete lead</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:12px">
      <div style="padding:12px 14px;border-radius:10px;background:rgba(255,94,58,0.10);border:1px solid rgba(255,94,58,0.30);color:#FFB59E;font-size:13px;line-height:1.5">
        <strong>This cannot be undone.</strong> The lead <strong>${escapeHtml(name || '')}</strong> and every related follow-up, note, comment, and timeline event will be removed permanently.
      </div>
      <div class="form-group" style="margin:0">
        <label class="form-label">Type <code>DELETE</code> to confirm</label>
        <input id="lead-purge-confirm-input" class="form-input" placeholder="DELETE" autocomplete="off"/>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" id="lead-purge-btn" onclick="submitPurgeLead('${id}')"><i class="fas fa-trash"></i> Delete permanently</button>
    </div>
  `)
  setTimeout(() => document.getElementById('lead-purge-confirm-input')?.focus(), 50)
}
window.confirmPurgeLead = confirmPurgeLead

async function submitPurgeLead(id) {
  const v = String(document.getElementById('lead-purge-confirm-input')?.value || '').trim()
  if (v !== 'DELETE') { toast('Type DELETE in capitals to confirm', 'error'); return }
  const btn = document.getElementById('lead-purge-btn')
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting…' }
  try {
    await API.delete(`/leads/${id}/permanent`)
    toast('Lead permanently deleted', 'success')
    closeModal()
    const el = document.getElementById('page-leads-trash')
    if (el) { el.dataset.loaded = ''; loadPage('leads-trash', el) }
  } catch (e) {
    toast('Delete failed: ' + (e?.message || ''), 'error')
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-trash"></i> Delete permanently' }
  }
}
window.submitPurgeLead = submitPurgeLead

async function renderLeadsView(el) {
  el.innerHTML = `<div style="padding:24px;color:#7E7E8F"><i class="fas fa-spinner fa-spin"></i> Loading leads…</div>`
  try {
    await Promise.all([loadLeadStatuses(), loadLeadSources()])
    const [leadsRes, assignees] = await Promise.all([
      API.get('/leads'),
      fetchSalesAssignees().catch(() => []),
    ])
    _leadsAssigneeOptionsCache = assignees
    const leads = leadsRes.data || leadsRes.leads || []
    _leadsViewCache = { leads, assignees, el }
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
      (_leadsSourceFilter ? 1 : 0) +
      (_leadsStatusFilter ? 1 : 0) +
      (_leadsActivityFilter.length ? 1 : 0)

    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Leads</h1>
          <p class="page-subtitle">${leads.length} total leads · ${pagination.total} shown</p>
        </div>
        <div class="page-actions" style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" onclick="exportLeadsCsv()" title="Download filtered leads as CSV"><i class="fas fa-file-export"></i> Export</button>
          ${canManage ? `<button class="btn btn-secondary btn-sm" onclick="openImportLeadsModal()"><i class="fas fa-file-csv"></i> Import</button>` : ''}
          ${leadsCanManageStatuses() ? `<button class="btn btn-secondary btn-sm" onclick="openManageLeadStatusesModal()"><i class="fas fa-tags"></i> Manage Statuses</button>` : ''}
          ${leadsCanManageSources() ? `<button class="btn btn-secondary btn-sm" onclick="openManageLeadSourcesModal()"><i class="fas fa-bullhorn"></i> Manage Sources</button>` : ''}
          ${canManage ? `<button class="btn btn-primary btn-sm" onclick="openCreateLeadModal()"><i class="fas fa-plus"></i> New Lead</button>` : ''}
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
          <div class="form-group" style="margin:0;min-width:180px">
            <label class="form-label" style="font-size:11px">Status</label>
            <select id="leads-filter-status" class="form-select" onchange="onLeadsFilterChange()">
              <option value="">All statuses</option>
              ${_leadStatusOrder.map((k) => `<option value="${escapeHtml(k)}" ${_leadsStatusFilter === k ? 'selected' : ''}>${escapeHtml(LEAD_STATUS_META[k]?.label || k)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="margin:0;min-width:220px">
            <label class="form-label" style="font-size:11px">Activity</label>
            <button type="button" id="leads-filter-activity-btn" class="form-select" data-no-lock style="text-align:left;display:flex;align-items:center;justify-content:space-between;gap:6px;cursor:pointer" onclick="toggleLeadsActivityPanel(event)">
              <span id="leads-filter-activity-label" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_leadsActivityFilter.length
                ? escapeHtml(_leadsActivityLabel())
                : 'All activity'}</span>
              <i class="fas fa-chevron-down" style="font-size:10px;opacity:.6;flex-shrink:0"></i>
            </button>
          </div>
          ${activeFilterCount ? `<button class="btn btn-outline btn-sm" onclick="clearLeadsFilters()" style="margin-bottom:2px"><i class="fas fa-times"></i> Clear (${activeFilterCount})</button>` : ''}
        </div>
      </div>

      <div class="card">
        <div class="card-body p-0 table-wrap">
          <table class="data-table" id="leads-table">
            <thead><tr>
              <th>Name &amp; Contact</th>
              <th>Source</th>
              <th>Assigned To</th>
              <th>Status</th>
              <th>Last Note</th>
              <th>Follow-up Due</th>
              <th style="width:140px">Actions</th>
            </tr></thead>
            <tbody>
              ${pagination.items.map((l) => renderLeadRow(l, canManage)).join('') || `<tr><td colspan="7" style="text-align:center;color:#7E7E8F;padding:24px">No leads match the current filter.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
      <div id="leads-pager-wrap">${renderPager(pagination, 'goLeadsPage', 'goLeadsPage', 'leads', 'leads-view')}</div>
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
    if (_leadsActivityFilter.length) {
      // AND logic: lead must have EVERY selected kind in its history.
      const kinds = Array.isArray(l.activity_kinds) ? l.activity_kinds : []
      if (!_leadsActivityFilter.every((k) => kinds.includes(k))) return false
    }
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
  _leadsStatusFilter = document.getElementById('leads-filter-status')?.value || ''
  // Activity filter is managed by the custom panel — don't read from DOM here.
  _leadsPage = 1
  reloadLeadsView()
}

function clearLeadsFilters() {
  _leadsFromDate = ''
  _leadsToDate = ''
  _leadsAssigneeFilter = ''
  _leadsSourceFilter = ''
  _leadsStatusFilter = ''
  _leadsActivityFilter = []
  _leadsPage = 1
  reloadLeadsView()
}

// Build the label shown on the activity filter button. Compact "N selected"
// fallback once the user picks more than two kinds so it fits the dropdown.
function _leadsActivityLabel() {
  if (!_leadsActivityFilter.length) return 'All activity'
  if (_leadsActivityFilter.length <= 2) {
    const labelsByKey = Object.fromEntries(LEAD_ACTIVITY_FILTER_OPTIONS)
    return _leadsActivityFilter.map((k) => labelsByKey[k] || k).join(', ')
  }
  return `${_leadsActivityFilter.length} activities`
}

// Activity multi-select panel is rendered into <body> as a fixed-position
// overlay so it isn't clipped by any ancestor's overflow:hidden (the leads
// card body was eating the bottom rows when the panel was an absolutely
// positioned child).
let _leadsActivityPanelEl = null
let _leadsActivityPanelOutsideHandler = null
let _leadsActivityPanelReposition = null

function _renderLeadsActivityPanelHTML() {
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 14px;border-bottom:1px solid var(--border,#E5E7EB);font-size:11px;color:var(--text-muted);background:var(--surface-2,#F8F9FB);border-top-left-radius:8px;border-top-right-radius:8px">
      <span>${_leadsActivityFilter.length} selected · matches ALL</span>
      ${_leadsActivityFilter.length ? `<button type="button" class="btn btn-xs btn-outline" onclick="clearLeadsActivityFilter()">Clear</button>` : ''}
    </div>
    <div style="max-height:280px;overflow:auto">
      ${LEAD_ACTIVITY_FILTER_OPTIONS.map(([kind, label]) => {
        const checked = _leadsActivityFilter.includes(kind)
        return `<label style="display:flex;align-items:center;gap:8px;padding:8px 14px;cursor:pointer;font-size:13px;${checked ? 'background:rgba(169,112,255,0.10)' : ''}" onmouseover="this.style.background='rgba(169,112,255,0.08)'" onmouseout="this.style.background='${checked ? 'rgba(169,112,255,0.10)' : 'transparent'}'">
          <input type="checkbox" value="${kind}" ${checked ? 'checked' : ''} onchange="onLeadsActivityToggle('${kind}', this.checked)" style="margin:0;accent-color:#A970FF"/>
          <span>${escapeHtml(label)}</span>
        </label>`
      }).join('')}
    </div>`
}

function _positionLeadsActivityPanel() {
  const btn = document.getElementById('leads-filter-activity-btn')
  if (!btn || !_leadsActivityPanelEl) return
  const rect = btn.getBoundingClientRect()
  // Pin under the button, capped to viewport width minus a small gutter so
  // we never spill off the right edge.
  const minWidth = Math.max(rect.width, 240)
  const maxRight = window.innerWidth - 8
  const left = Math.min(rect.left, maxRight - minWidth)
  _leadsActivityPanelEl.style.top = `${rect.bottom + 4}px`
  _leadsActivityPanelEl.style.left = `${Math.max(8, left)}px`
  _leadsActivityPanelEl.style.minWidth = `${minWidth}px`
}

function toggleLeadsActivityPanel(ev) {
  if (ev) ev.stopPropagation()
  if (_leadsActivityPanelEl) { closeLeadsActivityPanel(); return }
  const panel = document.createElement('div')
  panel.id = 'leads-filter-activity-panel'
  panel.style.cssText = 'position:fixed;background:var(--surface,#fff);border:1px solid var(--border,#E5E7EB);border-radius:8px;box-shadow:0 16px 40px rgba(0,0,0,.30);z-index:10000;padding:0;overflow:visible'
  panel.innerHTML = _renderLeadsActivityPanelHTML()
  document.body.appendChild(panel)
  _leadsActivityPanelEl = panel
  _positionLeadsActivityPanel()
  // Outside-click closes the panel. Reposition on scroll / resize so the
  // panel sticks to the button as the user scrolls the leads card.
  _leadsActivityPanelOutsideHandler = (e) => {
    const btn = document.getElementById('leads-filter-activity-btn')
    if (panel.contains(e.target) || btn?.contains(e.target)) return
    closeLeadsActivityPanel()
  }
  _leadsActivityPanelReposition = () => _positionLeadsActivityPanel()
  // Defer the listener install one tick so the click that opened the panel
  // doesn't immediately close it.
  setTimeout(() => document.addEventListener('click', _leadsActivityPanelOutsideHandler), 0)
  window.addEventListener('scroll', _leadsActivityPanelReposition, true)
  window.addEventListener('resize', _leadsActivityPanelReposition)
}

function closeLeadsActivityPanel() {
  if (!_leadsActivityPanelEl) return
  _leadsActivityPanelEl.remove()
  _leadsActivityPanelEl = null
  if (_leadsActivityPanelOutsideHandler) {
    document.removeEventListener('click', _leadsActivityPanelOutsideHandler)
    _leadsActivityPanelOutsideHandler = null
  }
  if (_leadsActivityPanelReposition) {
    window.removeEventListener('scroll', _leadsActivityPanelReposition, true)
    window.removeEventListener('resize', _leadsActivityPanelReposition)
    _leadsActivityPanelReposition = null
  }
}

// Toggle a kind and refresh only the table — keeps the panel open and avoids
// the "Loading leads…" flicker that a full page-reload caused.
function onLeadsActivityToggle(kind, checked) {
  const idx = _leadsActivityFilter.indexOf(kind)
  if (checked && idx === -1) _leadsActivityFilter.push(kind)
  else if (!checked && idx !== -1) _leadsActivityFilter.splice(idx, 1)
  _leadsPage = 1
  refreshLeadsViewIncremental()
  // Re-render the panel content so the "N selected" header + row highlight
  // reflect the new state without re-creating the overlay.
  if (_leadsActivityPanelEl) {
    _leadsActivityPanelEl.innerHTML = _renderLeadsActivityPanelHTML()
    _positionLeadsActivityPanel()
  }
}

function clearLeadsActivityFilter() {
  _leadsActivityFilter = []
  _leadsPage = 1
  refreshLeadsViewIncremental()
  if (_leadsActivityPanelEl) {
    _leadsActivityPanelEl.innerHTML = _renderLeadsActivityPanelHTML()
    _positionLeadsActivityPanel()
  }
}

// Partial refresh: re-run the client-side filter on the cached leads and
// repaint the table body + count chips + filter button label. No fetch, no
// loading state — the panel stays open across the update.
function refreshLeadsViewIncremental() {
  const { leads, el } = _leadsViewCache
  if (!Array.isArray(leads) || !el) {
    // Fallback to a full reload if we don't have a cache (first paint, or
    // user landed here from a deep link before initial render finished).
    reloadLeadsView()
    return
  }
  const filtered = applyLeadsFilters(leads)
  const pagination = paginateClient(filtered, _leadsPage, 10)
  _leadsPage = pagination.page
  const canManage = leadsCanManage()
  // Rebuild table body.
  const tbody = el.querySelector('#leads-table tbody')
  if (tbody) {
    tbody.innerHTML = pagination.items.map((l) => renderLeadRow(l, canManage)).join('')
      || `<tr><td colspan="7" style="text-align:center;color:#7E7E8F;padding:24px">No leads match the current filter.</td></tr>`
  }
  // Update header subtitle ("N total · M shown").
  const subtitle = el.querySelector('.page-header .page-subtitle')
  if (subtitle) subtitle.textContent = `${leads.length} total leads · ${pagination.total} shown`
  // Update the activity button label.
  const labelEl = document.getElementById('leads-filter-activity-label')
  if (labelEl) labelEl.textContent = _leadsActivityFilter.length ? _leadsActivityLabel() : 'All activity'
  // Update the pager.
  const pagerWrap = el.querySelector('#leads-pager-wrap')
  if (pagerWrap && typeof renderPager === 'function') {
    pagerWrap.innerHTML = renderPager(pagination, 'goLeadsPage', 'goLeadsPage', 'leads', 'leads-view')
  }
}

window.toggleLeadsActivityPanel = toggleLeadsActivityPanel
window.onLeadsActivityToggle = onLeadsActivityToggle
window.clearLeadsActivityFilter = clearLeadsActivityFilter

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
  // Template matches the format sales teams already use in Excel: contact
  // basics, status + source, the qualification checkboxes (RFD / SOW /
  // Office visit), Requirement, Remarks, a Follow Up Remark cell for the
  // open action, and dedicated Last/Next Follow Up date columns that drive
  // the lead's created_at and the follow-up task's due_date respectively.
  const headerCells = [
    'Date', 'Name', 'Phone No', 'Email', 'Status', 'Source',
    'RFD Shared', 'SOW Sent', 'Office visit', 'Requirement', 'Remarks',
    'Follow Up Remark', 'Last Follow up Date', 'Next Follow Up date',
  ]
  const csvEscape = (v) => /[",\n\r]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v)
  const headers = headerCells.map(csvEscape).join(',')
  const sample = [
    '25/05/2026', 'Swarn Singh', '91-7589000918', 'doctorswarnsingh@gmail.com',
    'Under Process', 'PPC', 'No', 'PPC Call', 'No',
    'Would like to have App portal like Shadi.com',
    'Not answering portfolio shared / Not answering',
    "Had a word with him he'll ask his son to consider us",
    '26/05/2026', '29/05/2026',
  ].map(csvEscape).join(',')
  const csv = headers + '\n' + sample + '\n'
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
      <div style="padding:12px 14px;border-radius:10px;background:rgba(179,136,255,0.10);border:1px solid rgba(179,136,255,0.25);font-size:12.5px;line-height:1.55;color:var(--text-secondary)">
        <i class="fas fa-circle-info" style="color:var(--accent);margin-right:6px"></i>
        Upload a <strong>CSV file</strong> with a header row. Excel users: <em>File → Save As → CSV (UTF-8)</em>.<br/>
        <strong>Required columns:</strong> Name, Phone No, Email, Source, Requirement<br/>
        <strong>Optional:</strong> Date, Status, RFD Shared, SOW Sent, Office visit, Remarks, Follow Up Remark, Last Follow up Date, Next Follow Up date<br/>
        Every imported lead is <strong>assigned to you</strong> automatically.<br/>
        <strong>Last Follow up Date</strong> → sets the lead's creation date.<br/>
        <strong>Next Follow Up date</strong> → sets the follow-up task's due date (alarm trigger).<br/>
        <strong>Remarks</strong> → captured as a note in the lead's timeline.
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
    const followups = res.followups_created || 0
    const errCount = res.error_count || 0
    const errors = res.errors || []

    reloadLeadsView()

    const followupLine = followups > 0 ? ` · <strong>${followups}</strong> follow-up${followups === 1 ? '' : 's'} scheduled.` : ''
    if (errCount > 0) {
      const result = document.getElementById('leads-import-result')
      if (result) {
        result.style.display = ''
        result.innerHTML = `
          <div style="padding:12px 14px;border-radius:10px;background:rgba(88,198,138,0.10);border:1px solid rgba(88,198,138,0.30);color:#86E0A8;font-size:13px;margin-bottom:8px">
            <i class="fas fa-check-circle"></i> <strong>${created}</strong> leads imported successfully.${followupLine}
          </div>
          <div style="padding:12px 14px;border-radius:10px;background:rgba(255,94,58,0.10);border:1px solid rgba(255,94,58,0.30);color:#A970FF;font-size:12.5px;line-height:1.5">
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
      const msg = followups > 0
        ? `${created} lead${created === 1 ? '' : 's'} + ${followups} follow-up${followups === 1 ? '' : 's'} imported`
        : `${created} lead${created === 1 ? '' : 's'} imported successfully`
      toast(msg, 'success')
      closeModal()
    }
  } catch (e) {
    toast('Import failed: ' + (e.message || 'unknown'), 'error')
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-upload"></i> Import' }
  }
}

// Threshold above which the last-note cell collapses behind a "See more" link.
const LEAD_LAST_NOTE_PREVIEW_LEN = 90

// Per-row note cache keyed by lead id — lets openLeadNoteModal pull the full
// note text + author meta without poking at table cells (which only carry
// the truncated preview attributes).
window._leadNoteCache = window._leadNoteCache || {}

// Open the full last-note in a modal. Expanding inline made the table row
// blow up vertically and shoved every other column out of alignment, so we
// surface long notes in their own dialog instead.
function openLeadNoteModal(leadId) {
  const entry = window._leadNoteCache[leadId]
  if (!entry) return
  const meta = entry.created_at
    ? `${escapeHtml(entry.author_name || 'Unknown')} · ${escapeHtml(fmtRelative(entry.created_at))}`
    : ''
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-sticky-note" style="color:#C9A7FF;margin-right:6px"></i>Last note${entry.lead_name ? ` — ${escapeHtml(entry.lead_name)}` : ''}</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      ${meta ? `<div style="font-size:11.5px;color:var(--text-muted);margin-bottom:10px">${meta}</div>` : ''}
      <div style="font-size:13.5px;color:var(--text-primary);white-space:pre-wrap;word-break:break-word;line-height:1.55">${escapeHtml(entry.text || '')}</div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Close</button>
      ${entry.lead_id ? `<button class="btn btn-primary" onclick="closeModal();goLeadDetail('${entry.lead_id}')"><i class="fas fa-up-right-from-square"></i> Open lead</button>` : ''}
    </div>
  `)
}
window.openLeadNoteModal = openLeadNoteModal

// Copy a lead's email/phone straight from the list row. Looks the value up
// from the cached leads array so we never have to escape it into the inline
// onclick. stopPropagation keeps the row's "open detail" click from firing.
async function copyLeadField(leadId, field, ev) {
  if (ev) ev.stopPropagation()
  const lead = (_leadsViewCache?.leads || []).find((x) => String(x.id) === String(leadId))
  const val = lead ? String(lead[field] || '') : ''
  if (!val) return
  try {
    await navigator.clipboard.writeText(val)
    toast(`${field === 'phone' ? 'Phone' : 'Email'} copied`, 'success', 2000)
  } catch (e) {
    toast('Copy failed', 'error')
  }
}
window.copyLeadField = copyLeadField

// Update the last note without leaving the list. Pre-fills the current note;
// saving posts a new note (matching the detail page), which becomes the
// latest note shown in the column after the list refreshes.
function openEditLeadNoteModal(leadId) {
  const entry = window._leadNoteCache[leadId] || {}
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-pen" style="color:#C9A7FF;margin-right:6px"></i>Update last note${entry.lead_name ? ` — ${escapeHtml(entry.lead_name)}` : ''}</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group" style="margin:0">
        <label class="form-label">Note</label>
        <textarea id="edit-lead-note-text" class="form-input" rows="5" placeholder="Add a note about this lead…" autofocus>${escapeHtml(entry.text || '')}</textarea>
        <div class="form-hint">Saving adds a new note, which becomes the latest note shown in the list.</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitEditLeadNote('${leadId}')"><i class="fas fa-check"></i> Save note</button>
    </div>
  `)
}
window.openEditLeadNoteModal = openEditLeadNoteModal

async function submitEditLeadNote(leadId) {
  const ta = document.getElementById('edit-lead-note-text')
  const text = (ta?.value || '').trim()
  if (!text) { toast('Note cannot be empty', 'error'); return }
  try {
    await API.post(`/leads/${leadId}/notes`, { text })
    toast('Note updated', 'success')
    closeModal()
    reloadLeadsView()
  } catch (e) {
    toast('Failed to save note: ' + e.message, 'error')
  }
}
window.submitEditLeadNote = submitEditLeadNote

// Small chip showing the next-due row's Activity Type — labels match the
// dropdown in the Schedule + Edit Follow-up modals so what a user sees on
// the list is exactly what they pick when reclassifying.
// Schedule Follow-up writes titles as "<ActivityType>: <text>", and the
// import flow follows the same convention. When the Edit modal opens we
// want to show just the editable <text> portion so users don't end up
// typing inside their own prefix; the saver below re-adds the current
// type. Case-insensitive match guards against legacy lowercased prefixes.
function stripActivityTypePrefix(title) {
  const s = String(title || '')
  const m = s.match(/^\s*(Call|Email|Meeting|Other)\s*:\s*(.*)$/i)
  return m ? m[2] : s
}

const ACTIVITY_TYPE_META = {
  Call:    { label: 'Call',    color: '#3b82f6', bg: 'rgba(59,130,246,.14)' },
  Email:   { label: 'Email',   color: '#22c55e', bg: 'rgba(34,197,94,.14)'  },
  Meeting: { label: 'Meeting', color: '#FF9F40', bg: 'rgba(255,159,64,.16)' },
  Other:   { label: 'Other',   color: '#C9A7FF', bg: 'rgba(201,167,255,.16)' },
}

function renderLeadRow(l, canManage) {
  const key = String(l.status || 'new').toLowerCase()
  const meta = LEAD_STATUS_META[key] || { label: key, badge: 'todo' }
  const openTask = (l.tasks || []).find((t) => t.status !== 'done' && t.status !== 'skipped')
  const due = openTask?.due_date ? fmtDateTime(openTask.due_date) : '—'
  const overdue = openTask?.due_date && new Date(openTask.due_date).getTime() < Date.now()
  const taskActivityType = String(openTask?.activity_type || 'Other')
  const activityMeta = ACTIVITY_TYPE_META[taskActivityType] || { label: taskActivityType, color: '#7E7E8F', bg: 'rgba(126,126,143,.16)' }
  const kindChip = openTask
    ? `<span style="display:inline-block;font-size:10px;font-weight:600;padding:1px 7px;border-radius:999px;background:${activityMeta.bg};color:${activityMeta.color};margin-top:3px">${escapeHtml(activityMeta.label)}</span>`
    : ''
  // Latest "done" follow-up tells the user when the lead was last actually
  // contacted. Imports stamp this from the CSV's "Last Follow up Date" column;
  // manually-completed follow-ups update it implicitly as agents work the lead.
  const lastDoneTask = (l.tasks || [])
    .filter((t) => String(t.status).toLowerCase() === 'done' && t.due_date)
    .sort((a, b) => String(b.due_date || '').localeCompare(String(a.due_date || '')))[0]
  const lastContactedLine = lastDoneTask
    ? `<div style="font-size:10.5px;color:#7E7E8F;margin-top:3px"><i class="fas fa-check" style="color:#22c55e;margin-right:3px"></i>Last contacted: ${escapeHtml(fmtDateOnly(lastDoneTask.due_date))}</div>`
    : ''
  // Last note preview: prefer the history entry from leadNotes (set by
  // enrichLeads); fall back to the inline lead.notes blob if the lead is old
  // and has never had a history entry created.
  const lastNoteRaw = (l.latest_note && l.latest_note.text)
    ? String(l.latest_note.text)
    : String(l.notes || '')
  const isLong = lastNoteRaw.length > LEAD_LAST_NOTE_PREVIEW_LEN
  const lastNotePreview = isLong
    ? escapeHtml(lastNoteRaw.slice(0, LEAD_LAST_NOTE_PREVIEW_LEN - 3) + '…')
    : escapeHtml(lastNoteRaw || '—')
  // Stash the full note + author meta so openLeadNoteModal can surface them
  // in a dialog when the user clicks "See more" — keeps the table row tidy.
  window._leadNoteCache[l.id] = {
    text: lastNoteRaw,
    author_name: l.latest_note?.author_name || null,
    created_at: l.latest_note?.created_at || null,
    lead_name: l.name,
    lead_id: l.id,
  }
  const lastNoteMeta = l.latest_note?.created_at
    ? `${escapeHtml(l.latest_note.author_name || 'Unknown')} · ${escapeHtml(fmtRelative(l.latest_note.created_at))}`
    : ''
  return `<tr>
    <td>
      <div style="display:flex;align-items:center;gap:10px;cursor:pointer" onclick="goLeadDetail('${l.id}')" title="Open lead detail">
        ${avatar(l.name, '#A970FF', 'sm')}
        <div style="min-width:0">
          <div style="font-weight:600;color:#e2e8f0">${escapeHtml(l.name)}</div>
          <div style="font-size:12px;color:#7E7E8F">${l.email
            ? `<span onclick="copyLeadField('${l.id}','email',event)" title="Click to copy email" style="cursor:pointer;display:inline-flex;align-items:center;gap:4px">${escapeHtml(l.email)}<i class="fas fa-copy" style="font-size:9px;opacity:.45"></i></span>`
            : '—'}</div>
          ${l.phone
            ? `<div style="font-size:11px;color:#7E7E8F"><span onclick="copyLeadField('${l.id}','phone',event)" title="Click to copy phone" style="cursor:pointer;display:inline-flex;align-items:center;gap:4px">${escapeHtml(l.phone)}<i class="fas fa-copy" style="font-size:9px;opacity:.45"></i></span></div>`
            : ''}
        </div>
      </div>
    </td>
    <td><span style="font-size:12px;color:#7E7E8F">${escapeHtml(l.source || '—')}</span></td>
    <td>${l.assigned_to_name ? `<span style="font-size:12px">${escapeHtml(l.assigned_to_name)}</span>` : '<span style="color:#7E7E8F">—</span>'}</td>
    <td>${statusBadgeHtml(meta)}</td>
    <td style="max-width:260px">
      <div style="font-size:12px;color:#cbd5e1;white-space:pre-wrap;word-break:break-word">${lastNotePreview}</div>
      <div style="display:flex;gap:10px;align-items:center;margin-top:2px">
        ${isLong ? `<button type="button" onclick="openLeadNoteModal('${l.id}')" style="background:none;border:none;color:#A970FF;font-size:11px;padding:2px 0;cursor:pointer;font-weight:600">See more</button>` : ''}
        ${canManage ? `<button type="button" onclick="openEditLeadNoteModal('${l.id}')" title="Update last note" style="background:none;border:none;color:#A970FF;font-size:11px;padding:2px 0;cursor:pointer;font-weight:600"><i class="fas fa-pen" style="font-size:9px;margin-right:3px"></i>Edit</button>` : ''}
      </div>
      ${lastNoteMeta ? `<div style="font-size:10.5px;color:#7E7E8F;margin-top:2px">${lastNoteMeta}</div>` : ''}
    </td>
    <td>
      <span style="font-size:12px;${overdue ? 'color:#FF5E3A;font-weight:600' : 'color:#7E7E8F'}">${due}${overdue ? ' (overdue)' : ''}</span>
      ${kindChip ? `<div>${kindChip}</div>` : ''}
      ${lastContactedLine}
    </td>
    <td>
      <div style="display:flex;gap:4px">
        <button class="btn btn-xs btn-outline" title="Open detail page" onclick="goLeadDetail('${l.id}')"><i class="fas fa-up-right-from-square"></i></button>
        ${leadsCanDelete() ? `<button class="btn btn-xs btn-outline" title="Delete" onclick="confirmDeleteLead('${l.id}','${escapeHtml(l.name).replace(/'/g, "\\'")}')"><i class="fas fa-trash"></i></button>` : ''}
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
  reloadLeadsView()
}

function goLeadsPage(page) {
  _leadsPage = Math.max(1, Number(page) || 1)
  refreshLeadsViewIncremental()
}

async function openCreateLeadModal() {
  await Promise.all([loadLeadSources(), loadLeadStatuses()])
  const role = String(_user?.role || '').toLowerCase()
  // Show the assignee picker only to users with the leads.assign_to_others
  // permission (admin / PM / PC / sales_manager / sales_tl by default; admin
  // can grant it to anyone in Settings → Roles & Permissions). Everyone else
  // creates leads owned by themselves — the backend re-enforces this so a
  // stale UI can't bypass it.
  const canAssignOthers = role === 'admin'
    || (typeof hasAnyPermission === 'function' && hasAnyPermission(['leads.assign_to_others']))
  let assignees = []
  if (canAssignOthers) {
    assignees = await fetchSalesAssignees()
    if (!assignees.length) {
      toast('No sales agents available — create one first.', 'error')
      return
    }
  }
  const selfId = String(_user?.id || _user?.sub || '')
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-bullseye" style="color:#A970FF;margin-right:8px"></i>New Lead</h3>
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
        <div class="form-group"><label class="form-label">Status</label>
          <select id="lead-status" class="form-select">
            ${(_leadStatusOrder.length ? _leadStatusOrder : ['new']).filter((k) => k !== 'closed').map((k) => {
              const meta = LEAD_STATUS_META[k] || { label: k }
              return `<option value="${escapeHtml(k)}" ${k === 'new' ? 'selected' : ''}>${escapeHtml(meta.label || k)}</option>`
            }).join('')}
          </select>
          <div class="form-hint" style="font-size:11px;color:#7E7E8F;margin-top:4px">Optional — defaults to "New". "Closed" must use the Close &amp; Convert flow.</div>
        </div>
        <div class="form-group" style="grid-column:1/-1"><label class="form-label">Requirement *</label>
          <textarea id="lead-requirement" class="form-input" rows="3" placeholder="What is the lead looking for?"></textarea>
          <div style="margin-top:8px">
            <label class="form-label" style="font-size:12px;color:var(--text-muted)">Attach file (optional)</label>
            <input id="lead-file" type="file" class="form-input" style="padding:6px"/>
            <div class="form-hint" style="font-size:11px;color:#7E7E8F;margin-top:4px">PDFs, images, or docs — text and file are both supported.</div>
          </div>
        </div>
        ${canAssignOthers
          ? `<div class="form-group" style="grid-column:1/-1"><label class="form-label">Assign To *</label>
              <select id="lead-assigned-to" class="form-select">
                ${assignees.map((u) => `<option value="${u.id}">${escapeHtml(u.full_name)} — ${escapeHtml(u.role)}</option>`).join('')}
              </select>
              <div class="form-hint" style="font-size:11px;color:#7E7E8F;margin-top:6px">Schedule follow-ups manually from the lead detail page.</div>
            </div>`
          : `<input type="hidden" id="lead-assigned-to" value="${escapeHtml(selfId)}"/>`}

        <div style="grid-column:1/-1;margin-top:4px;padding-top:12px;border-top:1px solid var(--border)">
          <div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Initial activity (optional)</div>
          <div class="form-group"><label class="form-label">Note</label>
            <textarea id="lead-init-note" class="form-input" rows="2" placeholder="First note about this lead…"></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group" style="margin:0">
              <label class="form-label">Task</label>
              <input id="lead-init-task-title" class="form-input" placeholder="Task title"/>
              <div style="display:flex;gap:6px;margin-top:6px">
                <input id="lead-init-task-due" type="date" class="form-input" style="flex:1" title="Task due date"/>
                <select id="lead-init-task-priority" class="form-select" style="width:110px">
                  <option value="medium">Medium</option><option value="low">Low</option><option value="high">High</option><option value="critical">Critical</option>
                </select>
              </div>
            </div>
            <div class="form-group" style="margin:0">
              <label class="form-label">Follow-up</label>
              <input id="lead-init-fu-title" class="form-input" placeholder="Follow-up title"/>
              <div style="display:flex;gap:6px;margin-top:6px">
                <input id="lead-init-fu-due" type="datetime-local" class="form-input" style="flex:1" title="Follow-up date & time"/>
                <select id="lead-init-fu-type" class="form-select" style="width:110px">
                  <option value="Call">Call</option><option value="Email">Email</option><option value="Meeting">Meeting</option><option value="Other">Other</option>
                </select>
              </div>
            </div>
          </div>
          <div class="form-hint" style="font-size:11px;color:#7E7E8F;margin-top:6px">A task or follow-up needs a due date to be created. Everything here is optional.</div>
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
  const status = (document.getElementById('lead-status')?.value || 'new').trim() || 'new'
  const payload = {
    name: document.getElementById('lead-name').value.trim(),
    email: document.getElementById('lead-email').value.trim(),
    phone: document.getElementById('lead-phone').value.trim(),
    source,
    status,
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

  // Optional initial activity — gathered now, created against the new lead id
  // right after it's saved. Task/follow-up need a due date (backend requires it).
  const initNote = (document.getElementById('lead-init-note')?.value || '').trim()
  const taskTitle = (document.getElementById('lead-init-task-title')?.value || '').trim()
  const taskDue = document.getElementById('lead-init-task-due')?.value || ''
  const taskPriority = document.getElementById('lead-init-task-priority')?.value || 'medium'
  const fuTitle = (document.getElementById('lead-init-fu-title')?.value || '').trim()
  const fuDue = document.getElementById('lead-init-fu-due')?.value || ''
  const fuType = document.getElementById('lead-init-fu-type')?.value || 'Other'
  if (taskTitle && !taskDue) { toast('Set a due date for the initial task (or clear its title)', 'error'); return }
  if (fuTitle && !fuDue) { toast('Set a date for the initial follow-up (or clear its title)', 'error'); return }

  try {
    let file = null
    try { file = await resolveLeadRequirementFile(null) } catch { return }
    if (file) payload.requirement_file = file
    const res = await API.post('/leads', payload)
    const newId = res?.data?.id || res?.id || res?.lead?.id
    // Attach the optional note / task / follow-up to the freshly created lead.
    if (newId) {
      const jobs = []
      if (initNote) jobs.push(API.post(`/leads/${newId}/notes`, { text: initNote }))
      if (taskTitle && taskDue) jobs.push(API.post(`/leads/${newId}/tasks`, { title: taskTitle, due_date: taskDue, priority: taskPriority }))
      if (fuTitle && fuDue) jobs.push(API.post(`/leads/${newId}/followups`, { title: fuTitle, due_date: new Date(fuDue).toISOString(), activity_type: fuType }))
      if (jobs.length) {
        try { await Promise.all(jobs) } catch (e) { toast('Lead created, but some activity failed: ' + e.message, 'warning', 6000) }
      }
    }
    toast('Lead created', 'success')
    closeModal()
    reloadLeadsView()
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
        <h3><i class="fas fa-bullseye" style="color:#A970FF;margin-right:8px"></i>Edit Lead</h3>
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
            ${lead.status !== 'closed' ? '<div class="form-hint" style="font-size:11px;color:#7E7E8F;margin-top:4px">To close this lead, use <strong>Close &amp; Convert to Client</strong> from the detail view — it collects client info and emails credentials.</div>' : ''}
          </div>
          <div class="form-group"><label class="form-label">Assign To *</label>
            <select id="lead-assigned-to" class="form-select">
              ${(() => {
                // Same guard as the inline edit form: if the current assignee
                // isn't in the sales-only list (e.g. admin importer), prepend
                // them so the dropdown reflects reality and Save doesn't
                // silently reassign to the first sales user.
                const currentInList = assignees.some((u) => String(u.id) === String(lead.assigned_to))
                return (!currentInList && lead.assigned_to && lead.assigned_to_name)
                  ? `<option value="${lead.assigned_to}" selected>${escapeHtml(lead.assigned_to_name)} (current assignee)</option>`
                  : ''
              })()}
              ${assignees.map((u) => `<option value="${u.id}" ${String(lead.assigned_to) === String(u.id) ? 'selected' : ''}>${escapeHtml(u.full_name)} — ${escapeHtml(u.role)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="grid-column:1/-1"><label class="form-label">Requirement *</label>
            <textarea id="lead-requirement" class="form-input" rows="3">${escapeHtml(lead.requirement || '')}</textarea>
            <div style="margin-top:8px">
              <label class="form-label" style="font-size:12px;color:var(--text-muted)">Attach file (optional)</label>
              <div id="lead-existing-file-wrap" style="display:${lead.requirement_file?.url ? '' : 'none'};margin-bottom:6px;font-size:12px;color:#cbd5e1">
                <i class="fas fa-paperclip"></i>
                <a href="${lead.requirement_file?.url || ''}" target="_blank" rel="noopener" style="color:#A970FF">${escapeHtml(lead.requirement_file?.name || '')}</a>
                <button type="button" class="btn btn-xs btn-outline" style="margin-left:8px" onclick="removeLeadExistingFile()">Remove</button>
                <input type="hidden" id="lead-existing-file" value='${lead.requirement_file ? escapeHtml(JSON.stringify(lead.requirement_file)) : ''}'/>
              </div>
              <input id="lead-file" type="file" class="form-input" style="padding:6px"/>
              <div class="form-hint" style="font-size:11px;color:#7E7E8F;margin-top:4px">Pick a new file to replace the current attachment, or leave blank to keep it.</div>
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
    reloadLeadsView()
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
  const reg = (typeof salesTaskColumns === 'function') ? salesTaskColumns() : null
  const isTerminal = (k) => k === 'done' || k === 'skipped' || k === 'cancelled'
  const colsHeader = reg ? `<div style="display:flex;justify-content:flex-end;margin-bottom:8px">${reg.manageButton()}</div>` : ''
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
      <div style="font-size:12px;color:#7E7E8F">Due: <span style="${overdue ? 'color:#FF5E3A;font-weight:600' : ''}">${fmtDateTime(t.due_date)}${overdue ? ' (overdue)' : ''}</span> · Alarm ${snooze}m before</div>
      ${t.notes ? `<div style="font-size:12px;color:#cbd5e1;margin-top:6px;padding:6px;background:rgba(0,0,0,.2);border-radius:4px">${escapeHtml(t.notes)}</div>` : ''}
      ${canUpdate ? `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        ${_leadTaskStatusOrder.map((k) => `<button class="btn btn-xs ${t.status === k ? 'btn-primary' : 'btn-outline'}" onclick="updateLeadTaskStatus('${t.id}','${k}','${id}')">${escapeHtml(LEAD_TASK_STATUS_META[k]?.label || k)}</button>`).join('')}
        <span style="font-size:11px;color:#7E7E8F">Snooze:</span>
        <input type="number" min="0" max="1440" value="${snooze}" id="snooze-${t.id}" style="width:70px;padding:3px 6px;border-radius:4px;border:1px solid var(--border);background:rgba(0,0,0,.25);color:#e2e8f0;font-size:12px"/>
        <button class="btn btn-xs btn-outline" onclick="updateFollowupSnooze('${t.id}','${id}')"><i class="fas fa-bell"></i> Save</button>
      </div>` : ''}
      ${reg && canUpdate ? reg.fields(t) : ''}
    </div>`
  }).join('') || '<div style="font-size:12px;color:#7E7E8F;padding:8px">No follow-up tasks yet.</div>'

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
        <label style="font-size:11px;color:#7E7E8F">Alarm minutes before</label>
        <input id="new-followup-snooze" type="number" class="form-input" min="0" max="1440" value="10" style="width:90px"/>
        <button class="btn btn-sm btn-primary" style="margin-left:auto" onclick="submitNewFollowup('${id}')"><i class="fas fa-plus"></i> Schedule</button>
      </div>
    </div>` : ''

  return colsHeader + tasksHtml + addForm
}

async function switchLeadDetailTab(id, tab) {
  _leadDetailState.tab = tab
  // Update tab button styles in place (cheap re-render of just the tab body)
  const body = document.getElementById('lead-detail-tab-body')
  if (!body) return
  if (tab === 'followups') {
    try {
      const reg = salesTaskColumns()
      const [res] = await Promise.all([API.get(`/leads/${id}`), reg ? reg.load() : Promise.resolve()])
      const lead = res.data || res.lead
      body.innerHTML = renderLeadDetailFollowups(lead)
    } catch (e) { body.innerHTML = `<div style="color:#FF5E3A">${e.message}</div>` }
  } else if (tab === 'comments') {
    body.innerHTML = '<div style="color:#7E7E8F;font-size:12px;padding:8px"><i class="fas fa-spinner fa-spin"></i> Loading comments…</div>'
    loadLeadComments(id)
  } else if (tab === 'timeline') {
    body.innerHTML = '<div style="color:#7E7E8F;font-size:12px;padding:8px"><i class="fas fa-spinner fa-spin"></i> Loading timeline…</div>'
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
        <div style="display:flex;justify-content:space-between;font-size:11px;color:#7E7E8F;margin-bottom:4px">
          <span><strong style="color:#e2e8f0">${escapeHtml(c.author_name || 'Unknown')}</strong>${c.author_role ? ` <span style="color:#7E7E8F">· ${escapeHtml(c.author_role)}</span>` : ''}</span>
          <span>${fmtDateTime(c.created_at)}</span>
        </div>
        <div style="font-size:13px;color:#cbd5e1;white-space:pre-wrap">${escapeHtml(c.text || '')}</div>
      </div>
    `).join('') || '<div style="font-size:12px;color:#7E7E8F;padding:8px">No comments yet.</div>'
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
        <div style="width:28px;height:28px;border-radius:50%;background:rgba(169,112,255,.15);color:#A970FF;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <i class="fas ${iconFor(a.kind)}"></i>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;color:#e2e8f0">${escapeHtml(a.summary || a.kind || '')}</div>
          <div style="font-size:11px;color:#7E7E8F;margin-top:2px">
            <span>${escapeHtml(a.actor_name || 'system')}</span>${a.actor_role ? ` · <span>${escapeHtml(a.actor_role)}</span>` : ''} · <span>${fmtDateTime(a.created_at)}</span>
          </div>
        </div>
      </div>
    `).join('') || '<div style="font-size:12px;color:#7E7E8F;padding:8px">No activity yet.</div>'
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
  try {
    const isAdmin = String(_user?.role || '').toLowerCase() === 'admin'
    const [res, pmsRes, pcsRes, salesPersons] = await Promise.all([
      API.get(`/leads/${id}`),
      // Only admins pick PM/PC at close-time. For everyone else we skip these
      // fetches entirely — backend will queue an admin assignment task.
      isAdmin ? API.get('/users?role=pm').catch(() => ({ users: [] })) : Promise.resolve({ users: [] }),
      isAdmin ? API.get('/users?role=pc').catch(() => ({ users: [] })) : Promise.resolve({ users: [] }),
      fetchSalesAssignees(),
    ])
    const lead = res.data || res.lead
    if (!lead) { toast('Lead not found', 'error'); return }
    // Either user manages leads broadly, or owns this specific lead
    // (sales_agent on their assigned lead). Backend re-checks via
    // canUserAccessLead so this is just a courtesy guard.
    const userId = String(_user?.sub || _user?.id || '')
    const isOwner = String(lead.assigned_to || '') === userId
    if (!leadsCanManage() && !isOwner) {
      toast("You don't have access to close this lead", 'error')
      return
    }
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
    showModal(`
      <div class="modal-header">
        <h3><i class="fas fa-handshake" style="color:#58C68A;margin-right:8px"></i>Close Lead & Convert to Client</h3>
        <button class="close-btn" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <div style="padding:10px 12px;background:rgba(88,198,138,.08);border-left:3px solid #58C68A;border-radius:6px;margin-bottom:14px;font-size:12px;color:#cbd5e1">
          A new client account will be created and login credentials emailed to <strong>${escapeHtml(lead.email)}</strong>. The lead will be marked as <strong>Closed</strong>.
        </div>

        <div style="font-size:11px;color:#7E7E8F;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Company &amp; Contact</div>
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
          <div class="form-group"><label class="form-label">Avatar Color</label><input class="form-input" id="close-color" type="color" value="#A970FF" style="height:40px;padding:3px"/></div>
        </div>

        <div style="font-size:11px;color:#7E7E8F;text-transform:uppercase;letter-spacing:.05em;margin:14px 0 8px">Tax &amp; Address (used on invoices)</div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">GSTIN *</label><input class="form-input" id="close-gstin" placeholder="22AAAAA0000A1Z5" style="text-transform:uppercase" maxlength="15" required/></div>
          <div class="form-group"><label class="form-label">Country *</label><input class="form-input" id="close-country" placeholder="Enter Country" value="India" required/></div>
        </div>
        <div class="form-group"><label class="form-label">Company Address *</label><textarea class="form-textarea" id="close-address" placeholder="Building, Street, Locality" style="min-height:50px" required></textarea></div>
        <div style="display:grid;grid-template-columns:1fr 1.5fr 1fr;gap:10px">
          <div class="form-group" style="margin:0"><label class="form-label">City *</label><input class="form-input" id="close-city" placeholder="Mumbai" required/></div>
          <div class="form-group" style="margin:0"><label class="form-label">State *</label>
            <select class="form-select" id="close-state" onchange="onCloseStateChange(this)" required>
              <option value="">Select state…</option>
              ${stateOpts}
            </select>
          </div>
          <div class="form-group" style="margin:0"><label class="form-label">State Code</label><input class="form-input" id="close-state-code" placeholder="" maxlength="3" readonly style="background:rgba(11,11,13,.4)"/></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">PIN Code *</label><input class="form-input" id="close-pincode" placeholder="400001" maxlength="10" required/></div>
          <div class="form-group"></div>
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
    return `<div style="display:flex;align-items:center;gap:10px;padding:6px 10px;background:rgba(11,11,13,.5);border:1px solid rgba(179,136,255,.18);border-radius:8px">
      <i class="fas fa-file" style="color:#A970FF;font-size:14px"></i>
      <div style="flex:1;min-width:0">
        <div style="font-size:12.5px;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(f.name)}</div>
        <div style="font-size:10.5px;color:${tooBig ? '#FF5E3A' : '#7E7E8F'}">${sizeMb} MB${tooBig ? ' — exceeds 25 MB limit' : ''}</div>
      </div>
      <button type="button" class="btn btn-sm btn-outline" style="border-color:rgba(255,94,58,.4);color:#FF5E3A" onclick="closeProjRemoveFile(${i})"><i class="fas fa-times"></i></button>
    </div>`
  })
  const linkRows = _closeProjLinks.map((l, i) => `<div style="display:flex;align-items:center;gap:10px;padding:6px 10px;background:rgba(11,11,13,.5);border:1px solid rgba(179,136,255,.18);border-radius:8px">
    <i class="fas fa-link" style="color:#86E0A8;font-size:14px"></i>
    <div style="flex:1;min-width:0">
      <div style="font-size:12.5px;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(l.name)}</div>
      <div style="font-size:10.5px;color:#7E7E8F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener" style="color:#9F8678">${escapeHtml(l.url)}</a></div>
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
    avatar_color: document.getElementById('close-color')?.value || '#9D6CFF',
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
  // Tax & address fields became mandatory — these flow onto every invoice we
  // generate, so an incomplete client record creates billing pain later.
  // State Code is intentionally skipped (auto-filled from the State dropdown).
  if (!payload.gstin) { toast('GSTIN is required', 'error'); return }
  if (!/^[0-9A-Z]{15}$/.test(payload.gstin)) {
    toast('GSTIN must be 15 alphanumeric characters', 'error'); return
  }
  if (!payload.country) { toast('Country is required', 'error'); return }
  if (!payload.address_line) { toast('Company address is required', 'error'); return }
  if (!payload.city) { toast('City is required', 'error'); return }
  if (!payload.state) { toast('State is required', 'error'); return }
  if (!payload.pincode) { toast('PIN code is required', 'error'); return }
  if (!/^[0-9]{4,8}$/.test(payload.pincode)) {
    toast('PIN code must be numeric (4–8 digits)', 'error'); return
  }


  try {
    const res = await API.post(`/leads/${id}/close`, payload)
    const sent = res?.mail?.sent
    if (sent) {
      toast('Client created — credentials emailed', 'success', 6000)
    } else {
      const err = res?.mail?.error || 'unknown error'
      console.error('[leads] Email send failed:', err)
      alert(`Client was created but the credentials email failed to send:\n\n` + err + '\n\nCheck the server SMTP settings and re-send the credentials manually.')
    }
    closeModal()
    _closeProjFiles = []
    _closeProjLinks = []
    reloadLeadsView()
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
      <div class="form-hint" style="font-size:11px;color:#7E7E8F;margin-top:4px">
        ${_outboundPortfolios.length
          ? 'Anyone with Sales-Library permission (Settings → Roles & Permissions) can add new portfolios here.'
          : 'No portfolios in the library yet. Add one from Sales CRM → Portfolio (admins manage permissions in Settings).'}
      </div>
    </div>
  ` : ''

  showModal(`
    <div class="modal-header">
      <h3><i class="fas ${isPortfolio ? 'fa-briefcase' : 'fa-paper-plane'}" style="color:#A970FF;margin-right:8px"></i>${isPortfolio ? 'Send Portfolio' : 'Send Mail'} — ${escapeHtml(lead.name)}</h3>
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
        <div class="form-hint" style="font-size:11px;color:#7E7E8F;margin-top:4px">Up to 10 MB per file. Hold Ctrl/Cmd to select multiple files.</div>
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
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(att.filename)} <span style="color:#7E7E8F">· ${formatBytes(att.size)}</span></span>
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
      <h3><i class="fas fa-tags" style="color:#A970FF;margin-right:8px"></i>Manage Lead & Task Statuses</h3>
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
  if (!order.length) return '<div style="font-size:12px;color:#7E7E8F;padding:8px">No statuses defined.</div>'
  return order.map((k) => {
    const m = meta[k]
    const id = m?.id || ''
    const isSystem = Number(m?.is_system || 0) === 1
    return `<div id="lstatus-row-${id}" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;background:rgba(255,255,255,.02)">
      ${statusBadgeHtml(m, k)}
      <span style="font-size:11px;color:#7E7E8F;font-family:monospace">${escapeHtml(k)}</span>
      <span style="margin-left:auto;display:flex;gap:6px;align-items:center">
        ${isSystem ? '<span style="font-size:10px;color:#A970FF">SYSTEM</span>' : ''}
        <button class="btn btn-xs btn-outline" title="Edit label & colour" onclick="editLeadStatusInline('${kind}','${id}')"><i class="fas fa-pen"></i></button>
        ${isSystem ? '' : `<button class="btn btn-xs btn-outline" title="Delete" onclick="deleteLeadStatus('${kind}','${id}','${escapeHtml(m?.label || k).replace(/'/g, "\\'")}')"><i class="fas fa-trash"></i></button>`}
      </span>
    </div>`
  }).join('')
}

function rerenderStatusList(kind) {
  const listEl = document.getElementById(`${kind === 'lead' ? 'lead' : 'task'}-status-list`)
  if (listEl) listEl.innerHTML = renderStatusList(kind)
}
function editLeadStatusInline(kind, id) {
  const meta = kind === 'lead' ? LEAD_STATUS_META : LEAD_TASK_STATUS_META
  const entry = Object.entries(meta).find(([, m]) => String(m?.id) === String(id))
  if (!entry) return
  const [k, m] = entry
  const row = document.getElementById('lstatus-row-' + id)
  if (!row) return
  const hasColor = !!(m?.color && /^#[0-9a-fA-F]{6}$/.test(m.color))
  const initColor = hasColor ? m.color : '#a970ff'
  // System status labels are code-controlled (re-seeded on boot), so only their
  // colour/badge are editable here — the label is shown read-only.
  const isSystem = Number(m?.is_system || 0) === 1
  row.innerHTML = `
    <input id="el-label-${id}" class="form-input" style="flex:1;font-size:12px;padding:4px 8px${isSystem ? ';opacity:.6' : ''}" value="${escapeHtml(m?.label || k)}" ${isSystem ? 'readonly title="System label is fixed"' : ''}/>
    <select id="el-badge-${id}" class="form-select" style="font-size:12px;width:100px;padding:4px" title="Fallback badge style">${LEAD_BADGE_OPTIONS.map(b => `<option value="${b}" ${(m?.badge || 'todo') === b ? 'selected' : ''}>${b}</option>`).join('')}</select>
    <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:#7E7E8F;white-space:nowrap" title="Use a custom colour instead of the badge style">
      <input id="el-usecolor-${id}" type="checkbox" ${hasColor ? 'checked' : ''}/>
      <input id="el-color-${id}" type="color" value="${initColor}" style="width:34px;height:28px;padding:0;border:1px solid var(--border);border-radius:6px;background:none;cursor:pointer"/>
    </label>
    <button class="btn btn-xs btn-primary" title="Save" onclick="saveLeadStatusEdit('${kind}','${id}')"><i class="fas fa-check"></i></button>
    <button class="btn btn-xs btn-outline" title="Cancel" onclick="rerenderStatusList('${kind}')"><i class="fas fa-times"></i></button>`
}
async function saveLeadStatusEdit(kind, id) {
  const label = (document.getElementById('el-label-' + id)?.value || '').trim()
  const badge = document.getElementById('el-badge-' + id)?.value
  // Unchecking the toggle clears the custom colour (sends ''), so the badge
  // falls back to its preset style.
  const useColor = document.getElementById('el-usecolor-' + id)?.checked
  const color = useColor ? (document.getElementById('el-color-' + id)?.value || '') : ''
  if (!label) { toast('Label required', 'error'); return }
  try {
    await API.put(`/leads/statuses/${kind}/${id}`, { label, badge, color })
    toast('Status updated', 'success')
    await loadLeadStatuses(true)
    rerenderStatusList(kind)
  } catch (e) { toast('Failed: ' + e.message, 'error') }
}

function renderStatusForm(kind) {
  return `<div style="display:grid;grid-template-columns:1fr;gap:6px">
    <input id="new-${kind}-status-label" class="form-input" placeholder="Label (e.g. On Hold)"/>
    <input id="new-${kind}-status-key" class="form-input" placeholder="Key (auto from label if empty)"/>
    <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#7E7E8F">
      <input id="new-${kind}-status-usecolor" type="checkbox"/> Custom colour
      <input id="new-${kind}-status-color" type="color" value="#a970ff" style="width:34px;height:28px;padding:0;border:1px solid var(--border);border-radius:6px;background:none;cursor:pointer"/>
    </label>
    <button class="btn btn-primary btn-sm" onclick="addLeadStatus('${kind}')"><i class="fas fa-plus"></i> Add Status</button>
  </div>`
}

async function addLeadStatus(kind) {
  const label = document.getElementById(`new-${kind}-status-label`).value.trim()
  const key = document.getElementById(`new-${kind}-status-key`).value.trim()
  const useColor = document.getElementById(`new-${kind}-status-usecolor`)?.checked
  const color = useColor ? (document.getElementById(`new-${kind}-status-color`)?.value || '') : ''
  if (!label) { toast('Label required', 'error'); return }
  try {
    await API.post(`/leads/statuses/${kind}`, { label, key: key || undefined, color: color || undefined })
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
      <h3><i class="fas fa-bullhorn" style="color:#A970FF;margin-right:8px"></i>Manage Lead Sources</h3>
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
  if (!_leadSources.length) return '<div style="font-size:12px;color:#7E7E8F;padding:8px">No sources defined.</div>'
  return _leadSources.map((s) => {
    const isSystem = Number(s.is_system || 0) === 1
    return `<div id="lsource-row-${s.id}" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;background:rgba(255,255,255,.02)">
      <span style="font-weight:600;color:var(--text-primary)">${escapeHtml(s.label)}</span>
      <span style="font-size:11px;color:#7E7E8F;font-family:monospace">${escapeHtml(s.key)}</span>
      <span style="margin-left:auto;display:flex;gap:6px;align-items:center">
        ${isSystem ? '<span style="font-size:10px;color:#A970FF">SYSTEM</span>' : `
          <button class="btn btn-xs btn-outline" title="Edit" onclick="editLeadSourceInline('${s.id}')"><i class="fas fa-pen"></i></button>
          <button class="btn btn-xs btn-outline" title="Delete" onclick="deleteLeadSource('${s.id}','${escapeHtml(s.label).replace(/'/g, "\\'")}')"><i class="fas fa-trash"></i></button>`}
      </span>
    </div>`
  }).join('')
}

function rerenderSourceList() {
  const el = document.getElementById('lead-source-list')
  if (el) el.innerHTML = renderSourceList()
}
function editLeadSourceInline(id) {
  const s = _leadSources.find((x) => String(x.id) === String(id))
  if (!s) return
  const row = document.getElementById('lsource-row-' + id)
  if (!row) return
  row.innerHTML = `
    <input id="es-label-${id}" class="form-input" style="flex:1;font-size:12px;padding:4px 8px" value="${escapeHtml(s.label)}"/>
    <button class="btn btn-xs btn-primary" title="Save" onclick="saveLeadSourceEdit('${id}')"><i class="fas fa-check"></i></button>
    <button class="btn btn-xs btn-outline" title="Cancel" onclick="rerenderSourceList()"><i class="fas fa-times"></i></button>`
}
async function saveLeadSourceEdit(id) {
  const label = (document.getElementById('es-label-' + id)?.value || '').trim()
  if (!label) { toast('Label required', 'error'); return }
  try {
    await API.put('/leads/sources/' + id, { label })
    toast('Source updated', 'success')
    await loadLeadSources(true)
    rerenderSourceList()
  } catch (e) { toast('Failed: ' + e.message, 'error') }
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
  // After any lead change, land on the leads LIST. If we're on the lead detail
  // page (or anywhere that isn't the list), navigate there; otherwise just
  // refresh the list in place.
  const el = document.getElementById('page-leads-view')
  if (el) el.dataset.loaded = ''
  const onList = typeof Router !== 'undefined' && Router?.current?.page === 'leads-view'
  if (!onList && typeof Router !== 'undefined' && Router?.navigate) {
    Router.navigate('leads-view')
  } else if (el) {
    loadPage('leads-view', el)
  }
}

// Soft-delete now requires a reason so an audit trail exists in the Trash
// module. The lead moves to Trash where users with the trash.* permissions
// can restore it or purge it permanently.
function confirmDeleteLead(id, name) {
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-trash" style="color:#FF5E3A;margin-right:6px"></i> Move lead to Trash</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:12px;padding:18px">
      <div style="font-size:13px;color:var(--text-secondary)">
        You're about to move <strong>${escapeHtml(name || 'this lead')}</strong> to Trash. It can be restored from the Lead Trash module.
      </div>
      <div class="form-group" style="margin:0">
        <label class="form-label">Reason for deletion <span style="color:#FF5E3A">*</span></label>
        <textarea id="lead-delete-reason" class="form-textarea" rows="3" maxlength="500" placeholder="e.g. Duplicate of lead-xxx, junk lead, requested by client…" style="min-height:80px"></textarea>
        <div class="form-hint" style="font-size:11px;color:#7E7E8F;margin-top:4px">3–500 characters. Shown in the Trash module to anyone who looks up the history.</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" id="lead-delete-confirm" onclick="submitDeleteLead('${id}')"><i class="fas fa-trash"></i> Move to Trash</button>
    </div>
  `)
  setTimeout(() => document.getElementById('lead-delete-reason')?.focus(), 50)
}

async function submitDeleteLead(id) {
  const reason = String(document.getElementById('lead-delete-reason')?.value || '').trim()
  if (reason.length < 3) {
    toast('Please give a reason (at least 3 characters)', 'error')
    return
  }
  const btn = document.getElementById('lead-delete-confirm')
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Moving…' }
  try {
    await API.delete(`/leads/${id}`, { reason })
    toast('Lead moved to Trash', 'success')
    closeModal()
    reloadLeadsView()
    // If the user is currently on the lead detail page, send them back to
    // the list — the lead is no longer accessible to non-trash routes.
    if (typeof goLeadsList === 'function' && location.hash.includes('lead-detail')) goLeadsList()
  } catch (e) {
    toast('Delete failed: ' + (e?.message || ''), 'error')
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-trash"></i> Move to Trash' }
  }
}
window.submitDeleteLead = submitDeleteLead

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
      <div style="width:min(440px,92vw);background:#1A0E08;border:1px solid #A970FF;border-radius:12px;box-shadow:0 24px 64px rgba(0,0,0,.6);overflow:hidden">
        <div style="padding:14px 18px;background:linear-gradient(90deg,#A970FF,#FF5E3A);color:#fff;display:flex;align-items:center;gap:10px">
          <i class="fas fa-bell fa-shake" style="font-size:18px"></i>
          <div style="font-weight:700;letter-spacing:.5px">Follow-up Alarm</div>
        </div>
        <div style="padding:18px">
          <div style="font-size:14px;color:#e2e8f0;margin-bottom:8px">
            <strong>${escapeHtml(next.title || 'Follow up')}</strong>
          </div>
          <div style="font-size:13px;color:#cbd5e1;margin-bottom:6px">
            <i class="fas fa-user" style="color:#7E7E8F;margin-right:6px"></i>${escapeHtml(next.lead_name || '')}
          </div>
          ${next.lead_phone ? `<div style="font-size:12px;color:#7E7E8F;margin-bottom:4px"><i class="fas fa-phone" style="margin-right:6px"></i>${escapeHtml(next.lead_phone)}</div>` : ''}
          ${next.lead_email ? `<div style="font-size:12px;color:#7E7E8F;margin-bottom:4px"><i class="fas fa-envelope" style="margin-right:6px"></i>${escapeHtml(next.lead_email)}</div>` : ''}
          <div style="font-size:12px;color:#7E7E8F;margin-top:8px"><i class="fas fa-clock" style="margin-right:6px"></i>Due ${dueText}${overdueLabel}</div>
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
  contacted: { label: 'Contacted', color: '#A970FF' },
  qualified: { label: 'Qualified', color: '#22c55e' },
  proposal: { label: 'Proposal', color: '#8B5CFF' },
  negotiation: { label: 'Negotiation', color: '#ec4899' },
  closed: { label: 'Closed', color: '#10b981' },
  warm: { label: 'Warm', color: '#A970FF' },
  hot: { label: 'Hot', color: '#ef4444' },
  cold: { label: 'Cold', color: '#A970FF' },
}

function leadHeaderBadge(statusKey) {
  const key = String(statusKey || 'new').toLowerCase()
  const meta = LEAD_STATUS_META[key]
  const tone = LEAD_TEMP_BADGE[key] || { label: meta?.label || key, color: '#7E7E8F' }
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
    return d.toLocaleString(undefined, {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    })
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
  el.innerHTML = `<div class="loading-state" style="padding:40px;text-align:center;color:#7E7E8F"><i class="fas fa-spinner fa-spin"></i> Loading lead…</div>`
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
    // Anything that's not a manually-created sales "task" (kind='task') is a
    // follow-up for display purposes — covers the default 'followup' kind,
    // legacy untagged tasks, and 'other'-tagged imports from bulk CSV uploads.
    const followups = tasks.filter((t) => String(t.kind || 'followup') !== 'task')
    const generalTasks = tasks.filter((t) => t.kind === 'task')
    const notes = notesRes.data || notesRes.notes || []
    const timeline = timelineRes.data || timelineRes.timeline || []
    el.innerHTML = renderLeadDetailHTML(lead, followups, generalTasks, notes, timeline, assignees)
    if (timeline.length > LEAD_TIMELINE_PAGE_SIZE) _wireLeadTimelineAutoLoad(lead.id)
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
            ${avatar(lead.name, '#A970FF')}
            <div>
              <div style="font-size:18px;font-weight:700;color:#e2e8f0">${escape(lead.name)}</div>
              <div style="font-size:12px;color:#7E7E8F;margin-top:2px">${escape(lead.source || '—')} • ${escape(lead.id)}</div>
            </div>
          </div>
          ${leadHeaderBadge(lead.status)}
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;font-size:13px;color:#cbd5e1">
          <div><i class="fas fa-envelope" style="width:18px;color:#7E7E8F"></i> ${escape(lead.email || '—')}</div>
          <div><i class="fas fa-phone" style="width:18px;color:#7E7E8F"></i> ${escape(lead.phone || '—')}</div>
          <div><i class="fas fa-user" style="width:18px;color:#7E7E8F"></i> Assigned to: ${escape(lead.assigned_to_name || '—')}</div>
          <div><i class="fas fa-calendar" style="width:18px;color:#7E7E8F"></i> Created: ${fmtDateOnly(lead.created_at)}</div>
          ${lead.requirement ? `<div style="margin-top:6px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06)"><div style="font-size:11px;color:#7E7E8F;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Requirement</div><div style="white-space:pre-wrap">${escape(lead.requirement)}</div></div>` : ''}
          ${lead.requirement_file?.url ? `<div><i class="fas fa-paperclip"></i> <a href="${escape(lead.requirement_file.url)}" target="_blank" rel="noopener" style="color:#A970FF">${escape(lead.requirement_file.name || 'attachment')}</a></div>` : ''}
        </div>
      </div>
    `
  }

  // Editable mode — same logic as the old modal but inline.
  const isPresetSource = LEAD_SOURCE_OPTIONS.includes(lead.source) && lead.source !== 'Other'
  const sourceSelectVal = isPresetSource ? lead.source : 'Other'
  const sourceCustomVal = isPresetSource ? '' : (lead.source || '')
  // "Closed" is selectable here — but picking it doesn't just flip a flag.
  // The submit handler routes through the Close & Convert flow so a client
  // (and optional project) are created atomically with the close.
  const statusOptions = _leadStatusOrder
    .map((k) => `<option value="${k}" ${lead.status === k ? 'selected' : ''}>${escapeHtml(LEAD_STATUS_META[k]?.label || k)}</option>`)
    .join('')
  return `
    <div class="card" style="padding:18px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:8px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:10px">
          <i class="fas fa-bullseye" style="color:#A970FF"></i>
          <h4 style="margin:0;font-size:14px;color:#e2e8f0">Lead Information</h4>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          ${canEdit && !lead.client_id ? `<button class="btn btn-success btn-xs" onclick="openCloseLeadModal('${lead.id}')" title="Close lead and create a client + project"><i class="fas fa-handshake"></i> Close &amp; Convert</button>` : ''}
          ${lead.client_id ? '<span style="font-size:11px;color:#58C68A"><i class="fas fa-check-circle"></i> Client created</span>' : ''}
          <button class="btn btn-primary btn-xs" onclick="submitInlineLeadEdit('${lead.id}')"><i class="fas fa-save"></i> Save Changes</button>
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
        ${avatar(lead.name, '#A970FF')}
        <div style="flex:1;min-width:0">
          <input id="lead-inline-name" class="form-input" style="font-size:16px;font-weight:600" value="${escape(lead.name)}" placeholder="Full name *"/>
          <div style="font-size:11px;color:#7E7E8F;margin-top:4px">ID: ${escape(lead.id)} · Created: ${fmtDateOnly(lead.created_at)}</div>
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
          <select id="lead-inline-status" class="form-select"
                  data-original="${escape(lead.status || '')}"
                  data-has-client="${lead.client_id ? '1' : ''}"
                  ${lead.status === 'closed' ? 'disabled' : ''}>
            ${statusOptions}
          </select>
          ${lead.status !== 'closed' && !lead.client_id ? '<div class="form-hint" style="font-size:11px;color:#7E7E8F;margin-top:4px">Picking "Closed" opens the Close &amp; Convert form (client + project).</div>' : ''}
        </div>
        ${canManage ? (() => {
          // fetchSalesAssignees() only returns sales-role users. If a lead is
          // currently assigned to an admin/PM/PC (e.g. via the import flow,
          // where the importer is often admin), that user wouldn't be in the
          // dropdown — the <select> would silently fall through to the first
          // option, and a Save Changes click would reassign the lead away.
          // Prepend the current assignee as a synthetic option to keep the
          // dropdown honest and prevent accidental reassignment.
          const currentInList = assignees.some((u) => String(u.id) === String(lead.assigned_to))
          const fallbackOption = (!currentInList && lead.assigned_to && lead.assigned_to_name)
            ? `<option value="${escape(lead.assigned_to)}" selected>${escape(lead.assigned_to_name)} (current assignee)</option>`
            : ''
          return `
        <div class="form-group" style="margin:0;grid-column:1/-1">
          <label class="form-label" style="font-size:11px">Assigned to *</label>
          <select id="lead-inline-assigned-to" class="form-select">
            ${fallbackOption}
            ${assignees.map((u) => `<option value="${escape(u.id)}" ${String(lead.assigned_to) === String(u.id) ? 'selected' : ''}>${escape(u.full_name)} — ${escape(u.role)}</option>`).join('')}
          </select>
        </div>`
        })() : `
        <div style="grid-column:1/-1;font-size:12px;color:#7E7E8F;padding:6px 0">
          <i class="fas fa-user" style="width:16px"></i> Assigned to: ${escape(lead.assigned_to_name || '—')}
        </div>
        `}
        <div class="form-group" style="margin:0;grid-column:1/-1">
          <label class="form-label" style="font-size:11px">Requirement *</label>
          <textarea id="lead-inline-requirement" class="form-textarea" rows="3" style="min-height:80px;max-height:220px;resize:vertical">${escape(lead.requirement || '')}</textarea>
        </div>
        <div class="form-group" style="margin:0;grid-column:1/-1">
          <label class="form-label" style="font-size:11px">Attachment (optional)</label>
          <div id="lead-inline-existing-file-wrap" style="display:${lead.requirement_file?.url ? '' : 'none'};margin-bottom:6px;font-size:12px;color:#cbd5e1">
            <i class="fas fa-paperclip"></i>
            <a href="${lead.requirement_file?.url || ''}" target="_blank" rel="noopener" style="color:#A970FF">${escape(lead.requirement_file?.name || '')}</a>
            <button type="button" class="btn btn-xs btn-outline" style="margin-left:8px" onclick="removeInlineLeadExistingFile()">Remove</button>
            <input type="hidden" id="lead-inline-existing-file" value='${lead.requirement_file ? escape(JSON.stringify(lead.requirement_file)) : ''}'/>
          </div>
          <input id="lead-inline-file" type="file" class="form-input" style="padding:6px"/>
          <div class="form-hint" style="font-size:11px;color:#7E7E8F;margin-top:4px">Pick a new file to replace the current attachment, or leave blank to keep it.</div>
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
  // Special case: user switched Status to "closed" on a lead that isn't
  // closed yet and doesn't have a client. Route through the full Close &
  // Convert flow instead of a flat PUT so the client (and optional
  // project) get created atomically alongside the status flip.
  const statusEl = document.getElementById('lead-inline-status')
  const newStatus = statusEl?.value || ''
  const oldStatus = statusEl?.getAttribute('data-original') || ''
  const hasClient = statusEl?.getAttribute('data-has-client') === '1'
  if (newStatus === 'closed' && oldStatus !== 'closed' && !hasClient) {
    openCloseLeadModal(id)
    return
  }

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
  const isAdmin = role === 'admin'
  const isOwner = String(lead.assigned_to || '') === String(_user?.id || _user?.sub || '')
  const canEdit = canManage || isOwner
  const assigneeList = Array.isArray(assignees) ? assignees : []

  const followupsHTML = followups.length
    ? followups.map((t) => renderFollowupRowDetail(lead.id, t)).join('')
    : `<div style="padding:16px;color:#7E7E8F;font-size:13px;text-align:center">No follow-ups scheduled yet.</div>`
  const tasksHTML = generalTasks.length
    ? generalTasks.map((t) => renderTaskRowDetail(lead.id, t)).join('')
    : `<div style="padding:16px;color:#7E7E8F;font-size:13px;text-align:center">No tasks yet.</div>`
  const timelineHTML = timeline.length
    ? renderTimelineList(timeline, lead.id)
    : `<div style="padding:24px;color:#7E7E8F;font-size:13px;text-align:center">No activity yet.</div>`

  const handoverBanner = lead.revenue_credit_to
    ? `<div class="card" style="padding:10px 14px;margin-bottom:14px;border-left:3px solid #A970FF;background:rgba(169,112,255,0.08);display:flex;align-items:center;gap:10px;flex-wrap:wrap">
         <i class="fas fa-arrow-right-arrow-left" style="color:#C9A7FF"></i>
         <span style="font-size:13px">Revenue/incentive credit for this lead is handed over to <strong>${escapeHtml(lead.revenue_credit_to_name || '(user)')}</strong>. Lead assignment unchanged.</span>
         ${isAdmin ? `<button class="btn btn-xs btn-outline" style="margin-left:auto" onclick="openLeadHandoverModal('${lead.id}')">Change / clear</button>` : ''}
       </div>`
    : ''

  return `
  <div class="lead-detail-page" style="padding:0 4px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:18px;flex-wrap:wrap">
      <button class="btn btn-outline btn-sm" onclick="Router.navigate('leads-view')"><i class="fas fa-arrow-left"></i> Back to Leads</button>
      <div style="flex:1"></div>
      <button class="btn btn-outline btn-sm" onclick="openSendPortfolioModal('${lead.id}')"><i class="fas fa-briefcase"></i> Send Portfolio</button>
      <button class="btn btn-outline btn-sm" onclick="openSendMailModal('${lead.id}')"><i class="fas fa-paper-plane"></i> Send Mail</button>
      ${isAdmin ? `<button class="btn btn-outline btn-sm" onclick="openLeadHandoverModal('${lead.id}')" title="Hand over revenue/incentive credit"><i class="fas fa-arrow-right-arrow-left"></i> Handover credit</button>` : ''}
      ${canEdit && !lead.client_id ? `<button class="btn btn-success btn-sm" onclick="openCloseLeadModal('${lead.id}')"><i class="fas fa-handshake"></i> Close &amp; Convert</button>` : ''}
    </div>
    ${handoverBanner}

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
          <div style="font-size:11px;color:#7E7E8F;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Scheduled</div>
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
  return `<div style="padding:10px;border:1px solid ${overdue ? '#FF5E3A40' : '#121216'};border-radius:8px;background:${overdue ? '#FF5E3A10' : '#0f172a40'}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;color:#e2e8f0;font-weight:500">${escapeHtml(t.title || '')}</div>
        ${t.description ? `<div style="font-size:11px;color:#7E7E8F;margin-top:2px">${escapeHtml(t.description).slice(0, 120)}</div>` : ''}
        <div style="font-size:11px;color:${overdue ? '#FF5E3A' : '#7E7E8F'};margin-top:4px"><i class="fas fa-calendar"></i> ${fmtDateTime(t.due_date)}${overdue ? ' (Overdue)' : ''}</div>
      </div>
      <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
        <span class="badge badge-${meta.badge}" style="font-size:10px">${escapeHtml(meta.label)}</span>
        ${t.status !== 'done' ? `<button class="btn btn-xs btn-outline" title="Mark done" onclick="markLeadFollowupDone('${leadId}','${t.id}')"><i class="fas fa-check"></i></button>` : ''}
        <button class="btn btn-xs btn-outline" title="Edit" onclick="openEditLeadTaskModal('${leadId}','${t.id}')"><i class="fas fa-edit"></i></button>
        <button class="btn btn-xs btn-outline" style="color:#FF5E3A" title="Delete" onclick="confirmDeleteLeadTask('${leadId}','${t.id}','${escapeHtml(t.title || '').replace(/'/g, "\\'")}')"><i class="fas fa-trash"></i></button>
      </div>
    </div>
  </div>`
}

function renderTaskRowDetail(leadId, t) {
  const statusKey = String(t.status || 'pending').toLowerCase()
  const meta = LEAD_TASK_STATUS_META[statusKey] || { label: statusKey, badge: 'todo' }
  const priorityClass = ({ critical: 'badge-critical', high: 'badge-high', medium: 'badge-medium', low: 'badge-low' })[t.priority] || 'badge-medium'
  return `<div style="padding:10px;border:1px solid #121216;border-radius:8px;background:#0f172a40">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;color:#e2e8f0;font-weight:500">${escapeHtml(t.title || '')}</div>
        ${t.description ? `<div style="font-size:11px;color:#7E7E8F;margin-top:2px">${escapeHtml(t.description).slice(0, 120)}</div>` : ''}
        <div style="font-size:11px;color:#7E7E8F;margin-top:4px"><i class="fas fa-calendar"></i> ${fmtDateTime(t.due_date)}</div>
      </div>
      <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
        ${t.priority ? `<span class="badge ${priorityClass}" style="font-size:10px">${escapeHtml(t.priority)}</span>` : ''}
        <span class="badge badge-${meta.badge}" style="font-size:10px">${escapeHtml(meta.label)}</span>
        ${t.status !== 'done' ? `<button class="btn btn-xs btn-outline" title="Mark done" onclick="markLeadFollowupDone('${leadId}','${t.id}')"><i class="fas fa-check"></i></button>` : ''}
        <button class="btn btn-xs btn-outline" title="Edit" onclick="openEditLeadTaskModal('${leadId}','${t.id}')"><i class="fas fa-edit"></i></button>
        <button class="btn btn-xs btn-outline" style="color:#FF5E3A" title="Delete" onclick="confirmDeleteLeadTask('${leadId}','${t.id}','${escapeHtml(t.title || '').replace(/'/g, "\\'")}')"><i class="fas fa-trash"></i></button>
      </div>
    </div>
  </div>`
}

// How many timeline entries we show before the "Load more" sentinel kicks in.
// Auto-load-on-scroll fires once the sentinel scrolls into view, so the UX
// feels like infinite scroll without an upfront cost for long histories.
const LEAD_TIMELINE_PAGE_SIZE = 15

// In-memory store of the full timeline per lead detail render so the
// load-more click can hydrate the next page without re-fetching.
window._leadTimelineCache = window._leadTimelineCache || {}

function _renderTimelineItem(a) {
  return `
    <div style="display:flex;gap:12px">
      <div class="lead-timeline-icon" style="flex-shrink:0;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center"><i class="fas ${activityIcon(a.kind)}"></i></div>
      <div class="lead-timeline-card" style="flex:1;min-width:0;padding:10px 12px;border-radius:8px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div class="lead-timeline-actor" style="font-size:13px;font-weight:600">${escapeHtml(a.actor_name || 'System')}</div>
          <div class="lead-timeline-time" style="font-size:11px;white-space:nowrap" title="${escapeHtml(a.created_at || '')}">${fmtRelative(a.created_at)}</div>
        </div>
        <div class="lead-timeline-summary" style="font-size:13px;margin-top:4px">${escapeHtml(a.summary || '')}</div>
        <div style="margin-top:6px"><span class="badge badge-todo" style="font-size:10px">${escapeHtml(a.kind || 'event')}</span></div>
      </div>
    </div>`
}

function renderTimelineList(timeline, leadId) {
  const list = Array.isArray(timeline) ? timeline : []
  // Stash so loadMoreLeadTimeline() can fetch the next slice.
  if (leadId) window._leadTimelineCache[leadId] = list
  const total = list.length
  const initial = list.slice(0, LEAD_TIMELINE_PAGE_SIZE)
  const remaining = Math.max(0, total - initial.length)
  return `<div class="lead-timeline-list" data-lead-id="${escapeHtml(String(leadId || ''))}" data-shown="${initial.length}" data-total="${total}" style="display:flex;flex-direction:column;gap:14px;position:relative">
    <div class="lead-timeline-items" style="display:flex;flex-direction:column;gap:14px">
      ${initial.map(_renderTimelineItem).join('')}
    </div>
    ${remaining > 0 ? `<div class="lead-timeline-more-wrap" style="display:flex;justify-content:center;padding:6px 0 2px">
      <button type="button" class="btn btn-sm btn-outline lead-timeline-more" onclick="loadMoreLeadTimeline('${escapeHtml(String(leadId || ''))}')"><i class="fas fa-arrow-down"></i> Load ${Math.min(remaining, LEAD_TIMELINE_PAGE_SIZE)} more <span style="opacity:.6;margin-left:4px">(${remaining} hidden)</span></button>
    </div>` : ''}
  </div>`
}

// Click handler for the "Load more" button. Also fires automatically via
// IntersectionObserver — see _wireLeadTimelineAutoLoad below.
function loadMoreLeadTimeline(leadId) {
  const list = window._leadTimelineCache[leadId]
  if (!Array.isArray(list)) return
  const wrap = document.querySelector(`.lead-timeline-list[data-lead-id="${CSS.escape(String(leadId))}"]`)
  if (!wrap) return
  const itemsEl = wrap.querySelector('.lead-timeline-items')
  const moreWrap = wrap.querySelector('.lead-timeline-more-wrap')
  if (!itemsEl) return
  const shown = Number(wrap.dataset.shown || 0)
  const total = list.length
  const next = list.slice(shown, shown + LEAD_TIMELINE_PAGE_SIZE)
  if (!next.length) return
  itemsEl.insertAdjacentHTML('beforeend', next.map(_renderTimelineItem).join(''))
  const newShown = shown + next.length
  wrap.dataset.shown = String(newShown)
  const remaining = Math.max(0, total - newShown)
  if (remaining === 0) {
    if (moreWrap) moreWrap.remove()
  } else {
    const btn = moreWrap?.querySelector('.lead-timeline-more')
    if (btn) btn.innerHTML = `<i class="fas fa-arrow-down"></i> Load ${Math.min(remaining, LEAD_TIMELINE_PAGE_SIZE)} more <span style="opacity:.6;margin-left:4px">(${remaining} hidden)</span>`
  }
}
window.loadMoreLeadTimeline = loadMoreLeadTimeline

// Auto-fire "Load more" when the sentinel scrolls into view, so users get
// infinite-scroll feel without losing the explicit button.
function _wireLeadTimelineAutoLoad(leadId) {
  if (typeof IntersectionObserver === 'undefined') return
  const wrap = document.querySelector(`.lead-timeline-list[data-lead-id="${CSS.escape(String(leadId))}"]`)
  if (!wrap) return
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const button = entry.target.querySelector?.('.lead-timeline-more')
      if (button) loadMoreLeadTimeline(leadId)
    }
  }, { rootMargin: '120px 0px' })
  const observe = () => {
    const moreWrap = wrap.querySelector('.lead-timeline-more-wrap')
    if (moreWrap) io.observe(moreWrap)
  }
  observe()
  // Re-observe whenever loadMoreLeadTimeline replaces the button text.
  const mo = new MutationObserver(observe)
  mo.observe(wrap, { childList: true, subtree: true })
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

// Admin-only modal that re-attributes a lead's revenue/incentive credit to a
// different user without touching lead.assigned_to or any downstream
// ownership. Hits POST /leads/:id/handover.
async function openLeadHandoverModal(leadId) {
  let lead = null
  try {
    const res = await API.get(`/leads/${leadId}`)
    lead = res.data || res.lead || res
  } catch (e) {
    toast('Failed to load lead: ' + (e.message || ''), 'error'); return
  }
  const users = await fetchSalesAssignees()
  const currentCredit = String(lead.revenue_credit_to || '')
  const currentAssignee = String(lead.assigned_to || '')
  const options = users.map((u) => {
    const tag = String(u.id) === currentAssignee ? ' (current lead owner)' : ''
    const sel = String(u.id) === currentCredit ? ' selected' : ''
    return `<option value="${escapeHtml(String(u.id))}"${sel}>${escapeHtml(u.full_name || u.email || u.id)}${tag}</option>`
  }).join('')
  showModal(`
    <div class="modal-header"><h3>Handover revenue credit</h3><button class="close-btn" onclick="closeModal()">✕</button></div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:14px">
      <div style="font-size:13px;color:var(--text-secondary)">
        This only changes who gets <strong>sales-report and incentive credit</strong> for this lead and any projects it produced.
        The lead's actual assignee, client ownership, and project assignments stay unchanged.
      </div>
      <div class="form-group">
        <label class="form-label">Credit to</label>
        <select id="lead-handover-user" class="form-select">
          <option value="">— Use original assignee (clear handover) —</option>
          ${options}
        </select>
      </div>
      ${currentCredit ? `<div style="font-size:12px;color:var(--text-muted)">Currently credited to: <strong>${escapeHtml(lead.revenue_credit_to_name || currentCredit)}</strong></div>` : ''}
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitLeadHandover('${leadId}')"><i class="fas fa-check"></i> Save handover</button>
    </div>
  `, 'modal-sm')
}

async function submitLeadHandover(leadId) {
  const sel = document.getElementById('lead-handover-user')
  const value = sel ? sel.value : ''
  try {
    const res = await API.post(`/leads/${leadId}/handover`, { credit_to: value || null })
    toast(res?.message || 'Handover saved', 'success')
    closeModal()
    refreshLeadDetailPage(leadId)
  } catch (e) {
    toast('Failed to save handover: ' + (e.message || ''), 'error')
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

// Edit a follow-up or task row. Single modal that adapts to the task's
// `kind` — follow-ups expose time + alarm snooze, plain tasks just date.
// Title / description / priority / status are shared. We GET the task
// fresh so the form opens with the latest values instead of whatever the
// stale list cache holds.
async function openEditLeadTaskModal(leadId, taskId) {
  let t = null
  try {
    // The list endpoint already returns tasks inline on the lead, but we
    // fetch the lead again to get a definitely-current snapshot. Cheap.
    const r = await API.get(`/leads/${leadId}`)
    const lead = r.data || r.lead
    const tasks = (lead?.tasks || [])
    t = tasks.find((x) => String(x.id) === String(taskId)) || null
  } catch {}
  if (!t) { toast('Task not found', 'error'); return }
  const kind = String(t.kind || 'followup') === 'task' ? 'task' : 'followup'
  // currentActivityType is the user-facing classification (Call/Email/
  // Meeting/Other) — same enum as the Schedule Follow-up modal. Falls back
  // to 'Other' so legacy rows without the field still render a valid choice.
  const currentActivityType = String(t.activity_type || 'Other')
  // Strip the leading "<ActivityType>: " from the stored title before
  // showing it in the input — Schedule Follow-up writes titles in that
  // form, so without this the user sees redundant prefix text. The prefix
  // is re-added by submitEditLeadTask based on whichever activity type
  // they leave selected, keeping the stored title in sync with the chip.
  const titleDisplay = stripActivityTypePrefix(String(t.title || ''))
  const due = t.due_date ? new Date(t.due_date) : new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const dateStr = `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`
  const timeStr = `${pad(due.getHours())}:${pad(due.getMinutes())}`
  const priority = String(t.priority || 'medium').toLowerCase()
  const status = String(t.status || 'pending').toLowerCase()
  const statusOpts = (_leadTaskStatusOrder.length ? _leadTaskStatusOrder : ['pending', 'in_progress', 'done'])
    .map((k) => `<option value="${k}" ${status === k ? 'selected' : ''}>${escapeHtml(LEAD_TASK_STATUS_META[k]?.label || k)}</option>`)
    .join('')
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-edit" style="color:#A970FF;margin-right:6px"></i>Edit ${kind === 'task' ? 'Task' : 'Follow-up'}</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Activity Type</label>
        <select id="edt-activity-type" class="form-select">
          <option value="Call"    ${currentActivityType === 'Call'    ? 'selected' : ''}>Call</option>
          <option value="Email"   ${currentActivityType === 'Email'   ? 'selected' : ''}>Email</option>
          <option value="Meeting" ${currentActivityType === 'Meeting' ? 'selected' : ''}>Meeting</option>
          <option value="Other"   ${currentActivityType === 'Other'   ? 'selected' : ''}>Other</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Activity Note *</label>
        <textarea id="edt-desc" class="form-input" rows="3" placeholder="Discuss pricing options…">${escapeHtml(t.description || t.notes || titleDisplay)}</textarea>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Date *</label>
          <input id="edt-date" type="date" class="form-input" value="${dateStr}"/>
        </div>
        ${kind === 'followup' ? `
        <div class="form-group"><label class="form-label">Time</label>
          <input id="edt-time" type="time" class="form-input" value="${timeStr}"/>
        </div>` : `
        <div class="form-group"><label class="form-label">Priority</label>
          <select id="edt-priority" class="form-select">
            <option value="low" ${priority === 'low' ? 'selected' : ''}>Low</option>
            <option value="medium" ${priority === 'medium' ? 'selected' : ''}>Medium</option>
            <option value="high" ${priority === 'high' ? 'selected' : ''}>High</option>
            <option value="critical" ${priority === 'critical' ? 'selected' : ''}>Critical</option>
          </select>
        </div>`}
      </div>
      <div class="grid-2">
        ${kind === 'followup' ? `
        <div class="form-group"><label class="form-label">Priority</label>
          <select id="edt-priority" class="form-select">
            <option value="low" ${priority === 'low' ? 'selected' : ''}>Low</option>
            <option value="medium" ${priority === 'medium' ? 'selected' : ''}>Medium</option>
            <option value="high" ${priority === 'high' ? 'selected' : ''}>High</option>
            <option value="critical" ${priority === 'critical' ? 'selected' : ''}>Critical</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">Alarm minutes before</label>
          <input id="edt-snooze" type="number" class="form-input" min="0" max="1440" value="${Math.max(0, Math.min(1440, Math.round(Number(t.snooze_minutes) || 10)))}"/>
        </div>` : `
        <div class="form-group" style="grid-column:1/-1"><label class="form-label">Status</label>
          <select id="edt-status" class="form-select">${statusOpts}</select>
        </div>`}
      </div>
      ${kind === 'followup' ? `
      <div class="form-group"><label class="form-label">Status</label>
        <select id="edt-status" class="form-select">${statusOpts}</select>
      </div>` : ''}
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitEditLeadTask('${leadId}','${taskId}','${kind}')"><i class="fas fa-save"></i> Save</button>
    </div>
  `)
}

async function submitEditLeadTask(leadId, taskId, kind) {
  // Title field is gone — the Activity Note doubles as both the editable
  // description AND the source for the generated title ("<Type>: <note>"),
  // mirroring how Schedule Follow-up works. Defensive prefix-strip guards
  // against rows whose note is itself prefixed (e.g. legacy imports).
  const desc = (document.getElementById('edt-desc')?.value || '').trim()
  if (!desc) { toast('Activity note is required', 'error'); return }
  const titleBody = stripActivityTypePrefix(desc).trim()
  const dateStr = (document.getElementById('edt-date')?.value || '').trim()
  if (!dateStr) { toast('Date is required', 'error'); return }
  const priority = (document.getElementById('edt-priority')?.value || 'medium').trim().toLowerCase()
  const status = (document.getElementById('edt-status')?.value || 'pending').trim().toLowerCase()
  // Follow-ups carry a time-of-day and an alarm snooze; plain tasks just
  // use end-of-day so the existing date-only UX still works.
  let due
  if (kind === 'followup') {
    const timeStr = (document.getElementById('edt-time')?.value || '10:00').trim()
    due = new Date(`${dateStr}T${timeStr}:00`)
  } else {
    due = new Date(`${dateStr}T17:00:00`)
  }
  if (Number.isNaN(due.getTime())) { toast('Invalid date/time', 'error'); return }
  // Generate the title from "<ActivityType>: <note-prefix>" so it matches
  // exactly what Schedule Follow-up writes for new rows — same shape on the
  // list view, detail view, and timeline. 60-char clip prevents a long note
  // from blowing up the row layout.
  const selectedActivity = String(document.getElementById('edt-activity-type')?.value || 'Other').trim()
  const payload = {
    title: `${selectedActivity}: ${titleBody.slice(0, 60)}`,
    description: desc,
    due_date: due.toISOString(),
    priority,
    status,
  }
  if (kind === 'followup') {
    const snoozeRaw = Number(document.getElementById('edt-snooze')?.value)
    if (Number.isFinite(snoozeRaw)) payload.snooze_minutes = Math.max(0, Math.min(1440, Math.round(snoozeRaw)))
  }
  // Activity type change — backend whitelists the value, so an unexpected
  // string here just errors out cleanly instead of corrupting the row.
  const newActivityType = String(document.getElementById('edt-activity-type')?.value || '').trim()
  if (['Call', 'Email', 'Meeting', 'Other'].includes(newActivityType)) payload.activity_type = newActivityType
  try {
    await API.patch(`/leads/tasks/${taskId}`, payload)
    toast(kind === 'task' ? 'Task updated' : 'Follow-up updated', 'success')
    closeModal()
    refreshLeadDetailPage(leadId)
  } catch (e) {
    toast('Failed: ' + (e.message || 'unknown'), 'error')
  }
}

async function confirmDeleteLeadTask(leadId, taskId, title) {
  if (!confirm(`Delete "${title}"? This cannot be undone.`)) return
  try {
    await API.delete(`/leads/tasks/${taskId}`)
    toast('Deleted', 'success')
    refreshLeadDetailPage(leadId)
  } catch (e) {
    toast('Failed: ' + (e.message || 'unknown'), 'error')
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
            <div style="font-size:11px;color:#7E7E8F;padding-top:6px">Lead + attendees auto-emailed</div>
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
          <div class="form-hint" style="font-size:11px;color:#7E7E8F;margin-top:4px">Alert pops at follow-up time minus these minutes; rings until you acknowledge.</div>
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
  if (!filtered.length) return '<div style="padding:6px;color:#7E7E8F;font-size:11px">No matches</div>'
  return filtered.map((u) => {
    const id = String(u.id)
    const checked = selected.has(id) ? 'checked' : ''
    return `<label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;font-size:12px">
      <input type="checkbox" value="${escapeHtml(id)}" ${checked} onchange="_fu2ToggleAttendee('${escapeHtml(id)}', this.checked)"/>
      <span style="flex:1;min-width:0;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(u.full_name || u.email || id)}${u.email ? ` <span style="color:#7E7E8F">· ${escapeHtml(u.email)}</span>` : ''}</span>
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
      activity_type: type,
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
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const nowTime = `${String(today.getHours()).padStart(2, '0')}:${String(today.getMinutes()).padStart(2, '0')}`
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
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Due Date *</label>
          <input id="task2-due" type="date" class="form-input" value="${todayStr}"/>
        </div>
        <div class="form-group"><label class="form-label">Time</label>
          <input id="task2-time" type="time" class="form-input" value="${nowTime}"/>
        </div>
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
  const time = document.getElementById('task2-time').value || '17:00'
  const priority = document.getElementById('task2-priority').value
  if (!title) { toast('Title is required', 'error'); return }
  if (!due) { toast('Due date is required', 'error'); return }
  try {
    await API.post(`/leads/${leadId}/tasks`, {
      title,
      description,
      due_date: new Date(`${due}T${time}:00`).toISOString(),
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
  el.innerHTML = `<div style="padding:24px;color:#7E7E8F"><i class="fas fa-spinner fa-spin"></i> Loading sale tracker…</div>`
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
        ${_trackerKpiCard('Total Leads', total, 'fa-bullseye', '#A970FF')}
        ${_trackerKpiCard('Open Pipeline', openCount, 'fa-stream', '#3b82f6')}
        ${_trackerKpiCard('Won', closedCount, 'fa-trophy', '#22c55e')}
        ${_trackerKpiCard('Lost / Cold', lostCount, 'fa-snowflake', '#7E7E8F')}
        ${_trackerKpiCard('Conversion', conversion + '%', 'fa-percent', '#C9A7FF')}
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
      <div style="font-size:11px;color:#7E7E8F;text-transform:uppercase;letter-spacing:.5px;font-weight:600">${label}</div>
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
          ${statusBadgeHtml(meta)}
          <span style="font-size:18px;font-weight:700;color:#e2e8f0">${items.length}</span>
        </div>
        <div style="height:6px;border-radius:3px;background:rgba(255,255,255,0.08);overflow:hidden;margin-bottom:10px">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#A970FF,#C9A7FF)"></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto">
          ${items.slice(0, 8).map((l) => `
            <div onclick="goLeadDetail('${l.id}')" style="cursor:pointer;padding:8px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06)">
              <div style="font-size:12.5px;font-weight:600;color:#e2e8f0">${escapeHtml(l.name)}</div>
              <div style="font-size:11px;color:#7E7E8F;margin-top:2px">${escapeHtml(l.assigned_to_name || '—')} · ${escapeHtml(l.source || '—')}</div>
            </div>`).join('') || `<div style="font-size:12px;color:#7E7E8F;padding:8px">No leads in this stage.</div>`}
          ${items.length > 8 ? `<div style="font-size:11px;color:#7E7E8F;text-align:center">+${items.length - 8} more</div>` : ''}
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
            <td style="color:#7E7E8F">${lost}</td>
            <td style="font-weight:600;color:${conv >= 30 ? '#22c55e' : conv >= 10 ? '#C9A7FF' : '#FF5E3A'}">${conv}%</td>
            <td style="min-width:160px"><div style="height:8px;border-radius:4px;background:rgba(255,255,255,0.06);overflow:hidden"><div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#A970FF,#C9A7FF)"></div></div></td>
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
            <td style="display:flex;align-items:center;gap:8px">${avatar(name, '#A970FF', 'sm')} <span style="font-weight:600;color:#e2e8f0">${escapeHtml(name)}</span></td>
            <td>${items.length}</td>
            <td style="color:#3b82f6">${open}</td>
            <td style="color:#22c55e">${won}</td>
            <td style="color:#7E7E8F">${lost}</td>
            <td style="font-weight:600;color:${conv >= 30 ? '#22c55e' : conv >= 10 ? '#C9A7FF' : '#FF5E3A'}">${conv}%</td>
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
            <td><div style="display:flex;align-items:center;gap:8px;cursor:pointer" onclick="goLeadDetail('${l.id}')">${avatar(l.name, '#A970FF', 'sm')}<div><div style="font-weight:600;color:#e2e8f0">${escapeHtml(l.name)}</div><div style="font-size:11px;color:#7E7E8F">${escapeHtml(l.email || '')}</div></div></div></td>
            <td>${statusBadgeHtml(meta)}</td>
            <td>${escapeHtml(l.assigned_to_name || '—')}</td>
            <td>${escapeHtml(l.source || '—')}</td>
            <td style="font-size:12px;color:#7E7E8F">${fmtDateTime(l.updated_at || l.created_at)}</td>
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
  <div class="loading-state" style="padding:40px;text-align:center;color:#7E7E8F"><i class="fas fa-spinner fa-spin"></i> Loading…</div>`
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
        <div style="font-size:12px;color:#7E7E8F;margin-top:2px">${all.length} total · ${overdueCount} overdue</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        ${['open', 'done', 'all'].map((f) => `<button class="btn btn-sm ${filter === f ? 'btn-primary' : 'btn-outline'}" onclick="setLeadListFilter('${filterKey}','${f}')">${f === 'open' ? 'Open' : f === 'done' ? 'Completed' : 'All'}</button>`).join('')}
      </div>
    </div>
    ${visible.length === 0
      ? `<div class="empty-state" style="padding:40px;text-align:center;color:#7E7E8F"><i class="fas ${opts.icon}" style="font-size:32px;color:#5A5A66"></i><p style="margin-top:10px">${opts.emptyMsg}</p></div>`
      : `<div class="card" style="padding:0;overflow:hidden">
          <table class="data-table" style="width:100%;border-collapse:collapse">
            <thead><tr style="background:#0f172a40">
              <th style="padding:10px 14px;text-align:left;font-size:11px;color:#7E7E8F;text-transform:uppercase">Title</th>
              <th style="padding:10px 14px;text-align:left;font-size:11px;color:#7E7E8F;text-transform:uppercase">Lead</th>
              <th style="padding:10px 14px;text-align:left;font-size:11px;color:#7E7E8F;text-transform:uppercase">Assignee</th>
              <th style="padding:10px 14px;text-align:left;font-size:11px;color:#7E7E8F;text-transform:uppercase">Due</th>
              <th style="padding:10px 14px;text-align:left;font-size:11px;color:#7E7E8F;text-transform:uppercase">Status</th>
              <th style="padding:10px 14px;text-align:right;font-size:11px;color:#7E7E8F;text-transform:uppercase">Actions</th>
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
  return `<tr style="border-top:1px solid #121216">
    <td style="padding:10px 14px">
      <div style="font-size:13px;color:#e2e8f0;font-weight:500">${escapeHtml(t.title || '')}</div>
      ${t.notes ? `<div style="font-size:11px;color:#7E7E8F;margin-top:2px">${escapeHtml(String(t.notes).slice(0, 80))}${t.notes.length > 80 ? '…' : ''}</div>` : ''}
    </td>
    <td style="padding:10px 14px">
      <a style="color:#A970FF;font-size:13px;cursor:pointer" onclick="goLeadDetail('${t.lead_id}')">${escapeHtml(t.lead_name || '—')}</a>
      ${t.lead_phone ? `<div style="font-size:11px;color:#7E7E8F">${escapeHtml(t.lead_phone)}</div>` : ''}
    </td>
    <td style="padding:10px 14px;font-size:13px;color:#cbd5e1">${escapeHtml(t.assignee_name || '—')}</td>
    <td style="padding:10px 14px;font-size:12px;${overdue ? 'color:#FF5E3A;font-weight:600' : 'color:#7E7E8F'}">${fmtDateTime(t.due_date)}${overdue ? ' (overdue)' : ''}</td>
    <td style="padding:10px 14px">${statusBadgeHtml(meta)}</td>
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
