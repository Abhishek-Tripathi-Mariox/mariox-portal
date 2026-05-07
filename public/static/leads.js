// ═══════════════════════════════════════════════════════════════
// Leads — Admin/PM/PC create leads, Sales Agents follow up.
// Each new lead auto-creates a follow-up task in lead_tasks
// with due_date = lead created_at + 4 hours.
// ═══════════════════════════════════════════════════════════════

let _leadsPage = 1
let _leadsStatusFilter = ''

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

const LEAD_SOURCE_OPTIONS = ['PPC', 'SEO', 'Other']

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
    await loadLeadStatuses()
    const res = await API.get('/leads')
    const leads = res.data || res.leads || []
    const statusCounts = leads.reduce((acc, l) => {
      const key = String(l.status || 'new').toLowerCase()
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
    const filtered = _leadsStatusFilter
      ? leads.filter((l) => String(l.status || '').toLowerCase() === _leadsStatusFilter)
      : leads
    const pagination = paginateClient(filtered, _leadsPage, 10)
    _leadsPage = pagination.page
    const canManage = leadsCanManage()

    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Leads</h1>
          <p class="page-subtitle">${leads.length} total leads · ${pagination.total} shown</p>
        </div>
        ${canManage ? `<div class="page-actions" style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" onclick="openManageLeadStatusesModal()"><i class="fas fa-tags"></i> Manage Statuses</button>
          <button class="btn btn-primary btn-sm" onclick="openCreateLeadModal()"><i class="fas fa-plus"></i> New Lead</button>
        </div>` : ''}
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

function renderLeadRow(l, canManage) {
  const key = String(l.status || 'new').toLowerCase()
  const meta = LEAD_STATUS_META[key] || { label: key, badge: 'todo' }
  const openTask = (l.tasks || []).find((t) => t.status !== 'done' && t.status !== 'skipped')
  const due = openTask?.due_date ? fmtDateTime(openTask.due_date) : '—'
  const overdue = openTask?.due_date && new Date(openTask.due_date).getTime() < Date.now()
  return `<tr>
    <td>
      <div style="display:flex;align-items:center;gap:10px">
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
        <button class="btn btn-xs btn-outline" title="View" onclick="openLeadDetailModal('${l.id}')"><i class="fas fa-eye"></i></button>
        ${canManage ? `<button class="btn btn-xs btn-outline" title="Edit" onclick="openEditLeadModal('${l.id}')"><i class="fas fa-edit"></i></button>` : ''}
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
          <div class="form-hint" style="font-size:11px;color:#94a3b8;margin-top:6px">A follow-up task will be created automatically with a 4-hour due date.</div>
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
    toast('Lead created — follow-up task scheduled in 4h', 'success')
    closeModal()
    const el = document.getElementById('page-leads-view')
    if (el) { el.dataset.loaded = ''; loadPage('leads-view', el) }
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

async function openEditLeadModal(id) {
  try {
    await loadLeadStatuses()
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

async function openLeadDetailModal(id, opts = {}) {
  try {
    await loadLeadStatuses()
    const res = await API.get(`/leads/${id}`)
    const lead = res.data || res.lead
    if (!lead) { toast('Lead not found', 'error'); return }
    if (_leadDetailState.id !== id) {
      _leadDetailState = { id, tab: opts.tab || 'followups', attachments: [] }
    } else if (opts.tab) {
      _leadDetailState.tab = opts.tab
    }
    const leadKey = String(lead.status || 'new').toLowerCase()
    const meta = LEAD_STATUS_META[leadKey] || { label: leadKey, badge: 'todo' }
    const tab = _leadDetailState.tab
    const tabs = [
      ['followups', 'Follow-ups', 'fa-clock'],
      ['comments', 'Comments', 'fa-comments'],
      ['timeline', 'Timeline', 'fa-stream'],
    ]
    showModal(`
      <div class="modal-header">
        <h3><i class="fas fa-bullseye" style="color:#FF7A45;margin-right:8px"></i>${escapeHtml(lead.name)} <span class="badge badge-${meta.badge}" style="margin-left:8px">${escapeHtml(meta.label)}</span></h3>
        <button class="close-btn" onclick="closeLeadDetailModal()">✕</button>
      </div>
      <div class="modal-body">
        <div class="grid-2" style="gap:10px;margin-bottom:14px">
          <div><div style="font-size:11px;color:#64748b;text-transform:uppercase">Email</div><div style="font-size:13px">${escapeHtml(lead.email)}</div></div>
          <div><div style="font-size:11px;color:#64748b;text-transform:uppercase">Phone</div><div style="font-size:13px">${escapeHtml(lead.phone || '—')}</div></div>
          <div><div style="font-size:11px;color:#64748b;text-transform:uppercase">Source</div><div style="font-size:13px">${escapeHtml(lead.source || '—')}</div></div>
          <div><div style="font-size:11px;color:#64748b;text-transform:uppercase">Assigned To</div><div style="font-size:13px">${escapeHtml(lead.assigned_to_name || '—')}</div></div>
          <div style="grid-column:1/-1">
            <div style="font-size:11px;color:#64748b;text-transform:uppercase">Requirement</div>
            <div style="font-size:13px;white-space:pre-wrap">${escapeHtml(lead.requirement || '')}</div>
            ${lead.requirement_file?.url ? `<div style="margin-top:8px;font-size:12px"><i class="fas fa-paperclip"></i> <a href="${escapeHtml(lead.requirement_file.url)}" target="_blank" rel="noopener" style="color:#FF7A45">${escapeHtml(lead.requirement_file.name || 'attachment')}</a></div>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
          <button class="btn btn-sm btn-outline" onclick="openSendPortfolioModal('${lead.id}')"><i class="fas fa-briefcase"></i> Send Portfolio</button>
          <button class="btn btn-sm btn-outline" onclick="openSendMailModal('${lead.id}')"><i class="fas fa-paper-plane"></i> Send Mail</button>
          ${leadsCanManage() && !lead.client_id ? `<button class="btn btn-sm btn-success" onclick="openCloseLeadModal('${lead.id}')"><i class="fas fa-handshake"></i> Close &amp; Convert</button>` : ''}
          ${leadsCanManage() ? `<button class="btn btn-sm btn-primary" onclick="closeLeadDetailModal();openEditLeadModal('${lead.id}')"><i class="fas fa-edit"></i> Edit</button>` : ''}
        </div>
        <div style="display:flex;gap:6px;border-bottom:1px solid var(--border);margin-bottom:10px">
          ${tabs.map(([k,label,icon]) => `<button class="btn btn-sm ${tab===k?'btn-primary':'btn-outline'}" style="border-radius:6px 6px 0 0;border-bottom-color:${tab===k?'transparent':'var(--border)'}" onclick="switchLeadDetailTab('${lead.id}','${k}')"><i class="fas ${icon}"></i> ${label}</button>`).join('')}
        </div>
        <div id="lead-detail-tab-body" style="min-height:160px">${renderLeadDetailFollowups(lead)}</div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeLeadDetailModal()">Close</button>
        ${leadsCanManage() && lead.client_id ? `<span style="font-size:12px;color:#58C68A;align-self:center"><i class="fas fa-check-circle"></i> Client created</span>` : ''}
      </div>
    `, 'modal-lg')
    if (tab === 'comments') loadLeadComments(lead.id)
    if (tab === 'timeline') loadLeadTimeline(lead.id)
    if (tab === 'followups') {
      // Already rendered synchronously from cached lead.tasks data
    }
  } catch (e) {
    toast('Failed to load lead: ' + e.message, 'error')
  }
}

function closeLeadDetailModal() {
  _leadDetailState = { id: null, tab: 'followups', attachments: [] }
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

async function openSendOutboundModal(leadId, kind) {
  _outboundAttachments = []
  let lead = null
  try {
    const res = await API.get(`/leads/${leadId}`)
    lead = res.data || res.lead
  } catch (e) {
    toast('Failed to load lead: ' + e.message, 'error'); return
  }
  if (!lead) { toast('Lead not found', 'error'); return }
  const isPortfolio = kind === 'portfolio'
  const defaultSubject = isPortfolio
    ? `Mariox Software — Our Portfolio for ${lead.name}`
    : ''
  const defaultBody = isPortfolio
    ? `Hi ${lead.name},\n\nThanks for your time. As discussed, please find our company portfolio attached for your reference.\n\nLet us know if you have any questions or would like to schedule a follow-up.\n\nRegards,\n${_user?.full_name || _user?.name || 'Mariox Team'}`
    : ''
  showModal(`
    <div class="modal-header">
      <h3><i class="fas ${isPortfolio ? 'fa-briefcase' : 'fa-paper-plane'}" style="color:#FF7A45;margin-right:8px"></i>${isPortfolio ? 'Send Portfolio' : 'Send Mail'} — ${escapeHtml(lead.name)}</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group"><label class="form-label">To *</label><input id="om-to" class="form-input" value="${escapeHtml(lead.email || '')}"/></div>
      <div class="form-group"><label class="form-label">Cc (comma separated)</label><input id="om-cc" class="form-input" placeholder="optional"/></div>
      <div class="form-group"><label class="form-label">Subject *</label><input id="om-subject" class="form-input" value="${escapeHtml(defaultSubject)}"/></div>
      <div class="form-group"><label class="form-label">Message *</label>
        <textarea id="om-body" class="form-input" rows="8" style="font-family:inherit">${escapeHtml(defaultBody)}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Attachments ${isPortfolio ? '(attach your portfolio PDF)' : ''}</label>
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
    // Refresh detail modal so timeline shows the entry.
    openLeadDetailModal(leadId, { tab: 'timeline' })
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
  return `<div style="display:grid;grid-template-columns:1fr 110px;gap:6px">
    <input id="new-${kind}-status-label" class="form-input" placeholder="Label (e.g. On Hold)"/>
    <select id="new-${kind}-status-badge" class="form-select">
      ${LEAD_BADGE_OPTIONS.map((b) => `<option value="${b}">${b}</option>`).join('')}
    </select>
    <input id="new-${kind}-status-key" class="form-input" placeholder="Key (auto from label if empty)" style="grid-column:1/-1"/>
    <button class="btn btn-primary btn-sm" style="grid-column:1/-1" onclick="addLeadStatus('${kind}')"><i class="fas fa-plus"></i> Add Status</button>
  </div>`
}

async function addLeadStatus(kind) {
  const label = document.getElementById(`new-${kind}-status-label`).value.trim()
  const key = document.getElementById(`new-${kind}-status-key`).value.trim()
  const badge = document.getElementById(`new-${kind}-status-badge`).value
  if (!label) { toast('Label required', 'error'); return }
  try {
    await API.post(`/leads/statuses/${kind}`, { label, key: key || undefined, badge })
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
