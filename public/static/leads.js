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
  return ['admin', 'pm', 'pc'].includes(String(_user?.role || '').toLowerCase())
}

async function fetchSalesAssignees() {
  try {
    const res = await API.get('/users')
    const users = res.users || res.data || []
    return users
      .filter((u) => Number(u.is_active || 0) === 1)
      .filter((u) => String(u.role || '').toLowerCase() === 'sales_agent')
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

async function openLeadDetailModal(id) {
  try {
    await loadLeadStatuses()
    const res = await API.get(`/leads/${id}`)
    const lead = res.data || res.lead
    if (!lead) { toast('Lead not found', 'error'); return }
    const leadKey = String(lead.status || 'new').toLowerCase()
    const meta = LEAD_STATUS_META[leadKey] || { label: leadKey, badge: 'todo' }
    const isTerminalTaskStatus = (k) => k === 'done' || k === 'skipped' || k === 'cancelled'
    const tasksHtml = (lead.tasks || []).map((t) => {
      const tkey = String(t.status || 'pending').toLowerCase()
      const tmeta = LEAD_TASK_STATUS_META[tkey] || { label: tkey, badge: 'todo' }
      const overdue = t.due_date && !isTerminalTaskStatus(tkey) && new Date(t.due_date).getTime() < Date.now()
      const canUpdate = leadsCanManage() || String(t.assigned_to) === String(_user?.sub || _user?.id || '')
      return `<div style="padding:12px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;background:rgba(255,255,255,.02)">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
          <strong style="font-size:13px">${escapeHtml(t.title)}</strong>
          <span class="badge badge-${tmeta.badge}">${escapeHtml(tmeta.label)}</span>
        </div>
        <div style="font-size:12px;color:#94a3b8">Due: <span style="${overdue ? 'color:#FF5E3A;font-weight:600' : ''}">${fmtDateTime(t.due_date)}${overdue ? ' (overdue)' : ''}</span></div>
        ${t.notes ? `<div style="font-size:12px;color:#cbd5e1;margin-top:6px;padding:6px;background:rgba(0,0,0,.2);border-radius:4px">${escapeHtml(t.notes)}</div>` : ''}
        ${canUpdate ? `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
          ${_leadTaskStatusOrder.map((k) => `<button class="btn btn-xs ${t.status === k ? 'btn-primary' : 'btn-outline'}" onclick="updateLeadTaskStatus('${t.id}','${k}','${id}')">${escapeHtml(LEAD_TASK_STATUS_META[k]?.label || k)}</button>`).join('')}
        </div>` : ''}
      </div>`
    }).join('') || '<div style="font-size:12px;color:#64748b;padding:8px">No follow-up tasks yet.</div>'

    showModal(`
      <div class="modal-header">
        <h3><i class="fas fa-bullseye" style="color:#FF7A45;margin-right:8px"></i>${escapeHtml(lead.name)} <span class="badge badge-${meta.badge}" style="margin-left:8px">${escapeHtml(meta.label)}</span></h3>
        <button class="close-btn" onclick="closeModal()">✕</button>
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
        <h4 style="font-size:13px;margin:16px 0 8px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted)">Follow-up Tasks</h4>
        ${tasksHtml}
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Close</button>
        ${leadsCanManage() && !lead.client_id ? `<button class="btn btn-success" onclick="openCloseLeadModal('${lead.id}')"><i class="fas fa-handshake"></i> Close &amp; Convert to Client</button>` : ''}
        ${leadsCanManage() && lead.client_id ? `<span style="font-size:12px;color:#58C68A;align-self:center"><i class="fas fa-check-circle"></i> Client created</span>` : ''}
        ${leadsCanManage() ? `<button class="btn btn-primary" onclick="closeModal();openEditLeadModal('${lead.id}')"><i class="fas fa-edit"></i> Edit</button>` : ''}
      </div>
    `, 'modal-lg')
  } catch (e) {
    toast('Failed to load lead: ' + e.message, 'error')
  }
}

async function openCloseLeadModal(id) {
  if (!leadsCanManage()) { toast('Only admin/PM/PC can close leads', 'error'); return }
  try {
    const res = await API.get(`/leads/${id}`)
    const lead = res.data || res.lead
    if (!lead) { toast('Lead not found', 'error'); return }
    if (lead.client_id) {
      toast('A client has already been created for this lead', 'info')
      return
    }
    const stateOpts = (typeof INDIAN_STATES !== 'undefined' ? INDIAN_STATES : [])
      .map(([n, c]) => `<option value="${n}" data-code="${c}">${n} (${c})</option>`)
      .join('')
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
  try {
    const res = await API.post(`/leads/${id}/close`, payload)
    const sent = res?.mail?.sent
    if (sent) {
      toast('Client created — credentials emailed', 'success', 6000)
    } else {
      const err = res?.mail?.error || 'unknown error'
      console.error('[leads] Email send failed:', err)
      alert('Client was created but the credentials email failed to send:\n\n' + err + '\n\nCheck the server SMTP settings and re-send the credentials manually.')
    }
    closeModal()
    const el = document.getElementById('page-leads-view')
    if (el) { el.dataset.loaded = ''; loadPage('leads-view', el) }
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

async function updateLeadTaskStatus(taskId, status, leadId) {
  try {
    await API.patch(`/leads/tasks/${taskId}`, { status })
    toast('Task updated', 'success')
    if (leadId) openLeadDetailModal(leadId)
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
