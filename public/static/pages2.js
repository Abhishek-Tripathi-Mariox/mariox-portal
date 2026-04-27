
// ============ TIMESHEET PAGE ============
router.register('timesheet', async (params) => {
  try {
    const [projRes, devsRes] = await Promise.all([
      API.get('/projects', { params: { status: 'active' } }),
      ['admin','pm'].includes(state.user?.role) ? API.get('/users', { params: { role: 'developer', active: 'true' } }) : Promise.resolve({ data: { data: [] } })
    ])
    const projects = projRes.data.data || []
    const developers = devsRes.data.data || []
    const isPM = ['admin','pm'].includes(state.user?.role)
    const today = new Date().toISOString().split('T')[0]

    document.getElementById('page-content').innerHTML = `
      <div class="animate-fade-in">
        <div class="page-header" style="display:flex;justify-content:space-between;align-items:center">
          <div><h1 class="page-title">Log Work Hours</h1><p class="page-subtitle">Record your daily work entries</p></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <!-- Entry Form -->
          <div class="glass-card" style="padding:24px">
            <h3 style="font-size:14px;font-weight:700;margin-bottom:16px"><i class="fas fa-plus-circle" style="color:var(--primary-light);margin-right:8px"></i>New Time Entry</h3>
            <div class="grid-2">
              <div class="form-group"><label class="form-label">Date *</label><input id="ts-date" class="form-input" type="date" value="${params.date || today}"/></div>
              <div class="form-group"><label class="form-label">Hours *</label><input id="ts-hours" class="form-input" type="number" step="0.5" min="0.5" max="16" value="8" placeholder="8.0"/></div>
            </div>
            ${isPM ? `<div class="form-group"><label class="form-label">Developer</label>
              <select id="ts-developer" class="form-select">
                <option value="">Self (${state.user.full_name})</option>
                ${developers.map(d=>`<option value="${d.id}">${d.full_name}</option>`).join('')}
              </select></div>` : ''}
            <div class="form-group"><label class="form-label">Project *</label>
              <select id="ts-project" class="form-select" onchange="loadModuleSuggestions()">
                <option value="">Select Project...</option>
                ${projects.map(p=>`<option value="${p.id}" ${params.project_id===p.id?'selected':''}>${p.name} (${p.code})</option>`).join('')}
              </select></div>
            <div class="form-group"><label class="form-label">Module/Feature</label>
              <input id="ts-module" class="form-input" value="${params.module||''}" placeholder="Authentication, Dashboard, API..."/></div>
            <div class="form-group"><label class="form-label">Task Description *</label>
              <textarea id="ts-task" class="form-textarea" rows="3" placeholder="Describe what you worked on in detail..."></textarea></div>
            <div class="grid-2">
              <div class="form-group"><label class="form-label">Status</label>
                <select id="ts-status" class="form-select">
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="blocked">Blocked</option>
                </select></div>
              <div class="form-group"><label class="form-label">Billable</label>
                <select id="ts-billable" class="form-select">
                  <option value="1">Yes (Billable)</option>
                  <option value="0">No (Non-Billable)</option>
                </select></div>
            </div>
            <div class="form-group" id="blocker-group" style="display:none">
              <label class="form-label">Blocker Details</label>
              <textarea id="ts-blocker" class="form-textarea" rows="2" placeholder="Describe the blocker..."></textarea>
            </div>
            <div class="form-group">
              <label class="form-label">Extra Hours Reason</label>
              <input id="ts-extra-reason" class="form-input" placeholder="If logging more than 8h, state reason..."/>
            </div>
            <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="submitTimesheet()">
              <i class="fas fa-save"></i> Submit Time Entry
            </button>
          </div>
          <!-- Today's Summary + Suggestions -->
          <div>
            <div class="glass-card" style="padding:20px;margin-bottom:16px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
                <h3 style="font-size:14px;font-weight:700">Today's Summary</h3>
                <input type="date" id="summary-date" class="form-input" style="width:auto" value="${today}" onchange="loadTodaySummary()"/>
              </div>
              <div id="today-summary">
                <div class="loading-spinner" style="margin:20px auto"></div>
              </div>
            </div>
            <div class="glass-card" style="padding:20px">
              <h3 style="font-size:14px;font-weight:700;margin-bottom:14px"><i class="fas fa-magic" style="color:var(--primary-light);margin-right:8px"></i>Quick Log Suggestions</h3>
              <div id="suggestions-list">
                <div class="loading-spinner" style="margin:20px auto"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `
    document.getElementById('ts-status').addEventListener('change', function() {
      document.getElementById('blocker-group').style.display = this.value === 'blocked' ? '' : 'none'
    })
    loadTodaySummary()
    loadSuggestions()
  } catch (e) { document.getElementById('page-content').innerHTML = `<div style="color:var(--danger);padding:20px">Error: ${e.message}</div>` }
})

async function loadTodaySummary() {
  const date = document.getElementById('summary-date')?.value || new Date().toISOString().split('T')[0]
  try {
    const res = await API.get('/timesheets', { params: { date, user_id: state.user.sub } })
    const logs = res.data.data || []
    const totalHours = logs.reduce((s, l) => s + parseFloat(l.hours_consumed), 0)
    const container = document.getElementById('today-summary')
    if (!container) return
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:12px;padding:10px;background:rgba(99,102,241,0.08);border-radius:10px">
        <span style="font-size:13px;font-weight:600">Total Hours</span>
        <span style="font-size:20px;font-weight:800;color:${totalHours>10?'#f87171':totalHours>=8?'#34d399':'#fbbf24'}">${totalHours.toFixed(1)}h</span>
      </div>
      ${logs.map(l=>`
      <div style="padding:10px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600">${l.project_name}</div>
          <div style="font-size:12px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.task_description}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:3px">${utils.approvalBadge(l.approval_status)}</div>
        </div>
        <div style="text-align:right;margin-left:10px">
          <div style="font-size:18px;font-weight:800;color:var(--accent)">${l.hours_consumed}h</div>
          ${(l.user_id === state.user.sub || ['admin','pm'].includes(state.user?.role)) && l.approval_status !== 'approved' ? 
            `<button class="btn btn-danger btn-xs" style="margin-top:4px" onclick="deleteLog('${l.id}')"><i class="fas fa-trash"></i></button>` : ''}
        </div>
      </div>`).join('') || '<div style="text-align:center;padding:20px;color:var(--text-muted)"><i class="fas fa-clock" style="font-size:28px;display:block;margin-bottom:8px"></i>No entries for this day</div>'}
    `
  } catch {}
}

async function loadSuggestions() {
  try {
    const res = await API.get('/timesheets/suggestions')
    const suggestions = res.data.data || []
    const container = document.getElementById('suggestions-list')
    if (!container) return
    if (suggestions.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);text-align:center;font-size:13px;padding:20px">No suggestions available</p>'
      return
    }
    container.innerHTML = suggestions.map(s=>`
      <div onclick="applySuggestion('${s.project_id}','${(s.module_name||'').replace(/'/g,'')}','${(s.task_description||'').replace(/'/g,'').replace(/"/g,'')}')" 
        style="padding:10px;background:rgba(99,102,241,0.06);border:1px dashed rgba(99,102,241,0.2);border-radius:10px;cursor:pointer;margin-bottom:8px;transition:all 0.2s"
        onmouseover="this.style.background='rgba(99,102,241,0.12)'" onmouseout="this.style.background='rgba(99,102,241,0.06)'">
        <div style="display:flex;justify-content:space-between">
          <span style="font-size:13px;font-weight:600;color:var(--primary-light)">${s.project_name}</span>
          <span style="font-size:12px;color:var(--warning)">${s.hours_consumed}h</span>
        </div>
        ${s.module_name ? `<div style="font-size:12px;color:var(--text-muted)">${s.module_name}</div>` : ''}
        <div style="font-size:11px;color:var(--text-secondary);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.task_description}</div>
      </div>`).join('')
  } catch {}
}

function applySuggestion(projId, module, task) {
  const select = document.getElementById('ts-project')
  if (select) { for (let i=0; i<select.options.length; i++) { if (select.options[i].value === projId) { select.selectedIndex = i; break } } }
  if (module) document.getElementById('ts-module').value = module
  if (task) document.getElementById('ts-task').value = task
}

function loadModuleSuggestions() {}

async function submitTimesheet() {
  const projectId = document.getElementById('ts-project').value
  const task = document.getElementById('ts-task').value
  const hours = parseFloat(document.getElementById('ts-hours').value)
  if (!projectId || !task || !hours) { utils.toast('Please fill all required fields', 'error'); return }
  try {
    const devSelect = document.getElementById('ts-developer')
    const payload = {
      user_id: devSelect?.value || null,
      project_id: projectId,
      date: document.getElementById('ts-date').value,
      module_name: document.getElementById('ts-module').value,
      task_description: task,
      hours_consumed: hours,
      is_billable: document.getElementById('ts-billable').value === '1',
      status: document.getElementById('ts-status').value,
      blocker_remarks: document.getElementById('ts-blocker')?.value || null,
      extra_hours_reason: document.getElementById('ts-extra-reason').value || null,
    }
    await API.post('/timesheets', payload)
    utils.toast('Time entry saved!', 'success')
    document.getElementById('ts-task').value = ''
    document.getElementById('ts-hours').value = '8'
    document.getElementById('ts-project').value = ''
    loadTodaySummary()
    loadApprovalCount()
  } catch (e) { utils.toast('Failed: ' + (e.response?.data?.error || e.message), 'error') }
}

async function deleteLog(id) {
  if (!utils.confirm('Delete this time entry?')) return
  try {
    await API.delete(`/timesheets/${id}`)
    utils.toast('Entry deleted', 'success')
    loadTodaySummary()
  } catch (e) { utils.toast('Failed: ' + e.message, 'error') }
}

// ============ MY LOGS PAGE ============
router.register('my-logs', async () => {
  try {
    const today = new Date().toISOString().split('T')[0]
    const monthStart = today.substring(0, 7) + '-01'
    const res = await API.get('/timesheets', { params: { date_from: monthStart, date_to: today } })
    const logs = res.data.data || []
    const totalHours = logs.reduce((s, l) => s + parseFloat(l.hours_consumed), 0)
    const billable = logs.filter(l => l.is_billable).reduce((s, l) => s + parseFloat(l.hours_consumed), 0)

    document.getElementById('page-content').innerHTML = `
      <div class="animate-fade-in">
        <div class="page-header" style="display:flex;justify-content:space-between;align-items:center">
          <div><h1 class="page-title">My Time Logs</h1><p class="page-subtitle">Your personal timesheet history</p></div>
          <button class="btn btn-primary" onclick="router.navigate('timesheet')"><i class="fas fa-plus"></i> Log Hours</button>
        </div>
        <div class="grid-3" style="margin-bottom:20px">
          ${statCard('Total Logged', utils.formatHours(totalHours), 'fa-clock', 'blue', 'This month', '')}
          ${statCard('Billable Hours', utils.formatHours(billable), 'fa-money-bill', 'green', `${totalHours > 0 ? Math.round(billable/totalHours*100) : 0}% billable`, '')}
          ${statCard('Entries', logs.length, 'fa-list', 'purple', 'This month', '')}
        </div>
        <div class="glass-card" style="padding:20px">
          <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
            <input type="date" id="log-from" class="form-input" style="width:auto" value="${monthStart}"/>
            <input type="date" id="log-to" class="form-input" style="width:auto" value="${today}"/>
            <select id="log-approval" class="form-select" style="width:auto">
              <option value="">All Status</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
            </select>
            <button class="btn btn-secondary" onclick="filterMyLogs()"><i class="fas fa-search"></i> Filter</button>
          </div>
          <div style="overflow-x:auto">
            <table class="data-table" id="my-logs-table">
              <thead><tr><th>Date</th><th>Project</th><th>Module</th><th>Task</th><th>Hours</th><th>Billable</th><th>Status</th><th>Approval</th><th>Actions</th></tr></thead>
              <tbody id="my-logs-body">
                ${renderLogsRows(logs)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `
  } catch (e) { document.getElementById('page-content').innerHTML = `<div style="color:var(--danger);padding:20px">Error: ${e.message}</div>` }
})

function renderLogsRows(logs) {
  return logs.map(l => `
    <tr>
      <td style="font-size:12px;color:var(--text-muted)">${utils.formatDate(l.date)}</td>
      <td><span style="font-size:12px;font-weight:600;color:var(--primary-light)">${l.project_name}</span></td>
      <td style="font-size:12px;color:var(--text-secondary)">${l.module_name||'-'}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--text-secondary)">${l.task_description}</td>
      <td><strong style="color:var(--accent)">${l.hours_consumed}h</strong></td>
      <td>${l.is_billable ? '<span class="badge badge-green">Yes</span>' : '<span class="badge badge-gray">No</span>'}</td>
      <td><span class="badge ${l.status==='completed'?'badge-green':l.status==='blocked'?'badge-red':'badge-yellow'}">${l.status}</span></td>
      <td>${utils.approvalBadge(l.approval_status)}</td>
      <td>
        ${l.approval_status !== 'approved' ? `
        <button class="btn btn-danger btn-xs" onclick="deleteLog('${l.id}')"><i class="fas fa-trash"></i></button>` : ''}
      </td>
    </tr>`).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:20px">No logs found</td></tr>'
}

async function filterMyLogs() {
  const from = document.getElementById('log-from').value
  const to = document.getElementById('log-to').value
  const approval = document.getElementById('log-approval').value
  try {
    const res = await API.get('/timesheets', { params: { date_from: from, date_to: to, approval_status: approval || undefined } })
    const tbody = document.getElementById('my-logs-body')
    if (tbody) tbody.innerHTML = renderLogsRows(res.data.data || [])
  } catch (e) { utils.toast('Filter failed', 'error') }
}

// ============ APPROVALS PAGE ============
router.register('approvals', async () => {
  try {
    const res = await API.get('/timesheets', { params: { approval_status: 'pending' } })
    const logs = res.data.data || []
    document.getElementById('page-content').innerHTML = `
      <div class="animate-fade-in">
        <div class="page-header" style="display:flex;justify-content:space-between;align-items:center">
          <div><h1 class="page-title">Timesheet Approvals</h1><p class="page-subtitle">${logs.length} pending approvals</p></div>
          <div style="display:flex;gap:10px">
            ${logs.length > 0 ? `<button class="btn btn-success" onclick="bulkApprove()"><i class="fas fa-check-double"></i> Approve All (${logs.length})</button>` : ''}
          </div>
        </div>
        <div class="glass-card" style="padding:20px">
          <div style="overflow-x:auto">
            <table class="data-table">
              <thead><tr>
                <th><input type="checkbox" id="select-all" onchange="toggleSelectAll(this)"/></th>
                <th>Developer</th><th>Date</th><th>Project</th><th>Task</th><th>Hours</th><th>Type</th><th>Actions</th>
              </tr></thead>
              <tbody>
                ${logs.map(l=>`
                <tr id="log-row-${l.id}">
                  <td><input type="checkbox" class="log-checkbox" value="${l.id}"/></td>
                  <td><div style="display:flex;align-items:center;gap:8px">
                    <div class="avatar avatar-sm" style="background:${l.avatar_color}">${utils.getInitials(l.full_name)}</div>
                    <span style="font-size:13px;font-weight:600">${l.full_name}</span>
                  </div></td>
                  <td style="font-size:12px;color:var(--text-muted)">${utils.formatDate(l.date)}</td>
                  <td><span style="font-size:12px;color:var(--primary-light)">${l.project_name}</span></td>
                  <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--text-secondary)" title="${l.task_description}">${l.task_description}</td>
                  <td><strong style="color:${l.hours_consumed>10?'#f87171':l.hours_consumed>=8?'#fbbf24':'var(--accent)'}">${l.hours_consumed}h</strong></td>
                  <td>${l.is_billable ? '<span class="badge badge-green">Billable</span>' : '<span class="badge badge-gray">Non-Bill</span>'}</td>
                  <td>
                    <div style="display:flex;gap:6px">
                      <button class="btn btn-success btn-xs" onclick="approveLog('${l.id}','approve')"><i class="fas fa-check"></i></button>
                      <button class="btn btn-danger btn-xs" onclick="approveLog('${l.id}','reject')"><i class="fas fa-times"></i></button>
                      <button class="btn btn-secondary btn-xs" onclick="viewLogDetail('${l.id}')"><i class="fas fa-eye"></i></button>
                    </div>
                  </td>
                </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:30px"><i class="fas fa-check-circle" style="font-size:32px;display:block;margin-bottom:8px;color:var(--success)"></i>All timesheets approved!</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `
  } catch (e) { document.getElementById('page-content').innerHTML = `<div style="color:var(--danger);padding:20px">Error: ${e.message}</div>` }
})

function toggleSelectAll(cb) {
  document.querySelectorAll('.log-checkbox').forEach(c => c.checked = cb.checked)
}

async function approveLog(id, action) {
  try {
    await API.patch(`/timesheets/${id}/approve`, { action })
    utils.toast(`Timesheet ${action === 'approve' ? 'approved' : 'rejected'}!`, action === 'approve' ? 'success' : 'warning')
    const row = document.getElementById(`log-row-${id}`)
    if (row) row.style.opacity = '0.3'
    setTimeout(() => { if (row) row.remove() }, 500)
    loadApprovalCount()
  } catch (e) { utils.toast('Failed: ' + e.message, 'error') }
}

async function viewLogDetail(id) {
  try {
    const res = await API.get('/timesheets', { params: { id } })
    const list = res.timesheets || res.data || []
    const entry = list.find(t => String(t.id) === String(id)) || list[0]
    if (!entry) return utils.toast('Timesheet entry not found', 'error')
    const esc = (v = '') => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    showModal(`
      <div class="modal-header"><h3><i class="fas fa-clock"></i> Timesheet Detail</h3><button class="close-btn" onclick="closeModal()">✕</button></div>
      <div class="modal-body" style="padding:20px;display:flex;flex-direction:column;gap:10px">
        <div><strong>User:</strong> ${esc(entry.full_name || entry.user_name || entry.user_id)}</div>
        <div><strong>Project:</strong> ${esc(entry.project_name || entry.project_id)}</div>
        <div><strong>Date:</strong> ${esc(utils.formatDate(entry.date))}</div>
        <div><strong>Hours:</strong> ${esc(entry.hours_consumed)}h ${entry.is_billable ? '· Billable' : '· Non-billable'}</div>
        ${entry.module_name ? `<div><strong>Module:</strong> ${esc(entry.module_name)}</div>` : ''}
        <div><strong>Status:</strong> ${esc(entry.status || '')} · <strong>Approval:</strong> ${esc(entry.approval_status || 'pending')}</div>
        <div style="padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface-2);white-space:pre-wrap"><strong>Description:</strong><br/>${esc(entry.task_description || '—')}</div>
        ${entry.blocker_remarks ? `<div style="padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:rgba(239,68,68,.06);white-space:pre-wrap"><strong>Blocker:</strong><br/>${esc(entry.blocker_remarks)}</div>` : ''}
        ${entry.extra_hours_reason ? `<div style="padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:rgba(245,158,11,.06);white-space:pre-wrap"><strong>Extra hours:</strong><br/>${esc(entry.extra_hours_reason)}</div>` : ''}
        ${entry.pm_notes ? `<div style="padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:rgba(99,102,241,.06);white-space:pre-wrap"><strong>PM notes:</strong><br/>${esc(entry.pm_notes)}</div>` : ''}
      </div>
      <div class="modal-footer"><button class="btn btn-outline" onclick="closeModal()">Close</button></div>
    `, 'modal-lg')
  } catch (e) { utils.toast('Failed: ' + e.message, 'error') }
}

async function bulkApprove() {
  const selected = [...document.querySelectorAll('.log-checkbox:checked')].map(c => c.value)
  const ids = selected.length > 0 ? selected : [...document.querySelectorAll('.log-checkbox')].map(c => c.value)
  if (ids.length === 0) return
  if (!utils.confirm(`Approve ${ids.length} timesheets?`)) return
  try {
    await API.post('/timesheets/bulk-approve', { ids, action: 'approve' })
    utils.toast(`${ids.length} timesheets approved!`, 'success')
    router.navigate('approvals')
    loadApprovalCount()
  } catch (e) { utils.toast('Failed: ' + e.message, 'error') }
}

// ============ ALLOCATIONS PAGE ============
router.register('allocations', async () => {
  try {
    const [summaryRes, projsRes] = await Promise.all([
      API.get('/allocations/summary'),
      API.get('/projects', { params: { status: 'active' } })
    ])
    const summary = summaryRes.data.data || []
    const projects = projsRes.data.data || []

    document.getElementById('page-content').innerHTML = `
      <div class="animate-fade-in">
        <div class="page-header"><h1 class="page-title">Hour Allocation</h1><p class="page-subtitle">Manage developer hours across projects</p></div>
        <div style="margin-bottom:20px">
          <div class="tab-list" style="max-width:400px">
            <button class="tab-btn active" id="tab-summary" onclick="switchAllocTab('summary')">Developer Summary</button>
            <button class="tab-btn" id="tab-project" onclick="switchAllocTab('project')">By Project</button>
          </div>
        </div>
        <div id="alloc-summary" class="animate-fade-in">
          <div style="overflow-x:auto" class="glass-card" style="padding:20px">
            <table class="data-table">
              <thead><tr><th>Developer</th><th>Monthly Capacity</th><th>Total Allocated</th><th>Consumed</th><th>Idle Hours</th><th>Projects</th><th>Status</th></tr></thead>
              <tbody>
                ${summary.map(d => {
                  const allocPct = d.monthly_available_hours > 0 ? Math.round((d.total_allocated/d.monthly_available_hours)*100) : 0
                  return `<tr>
                    <td><div style="display:flex;align-items:center;gap:10px">
                      <div class="avatar avatar-sm" style="background:${d.avatar_color}">${utils.getInitials(d.full_name)}</div>
                      <div><div style="font-size:13px;font-weight:600">${d.full_name}</div><div style="font-size:11px;color:var(--text-muted)">${d.designation}</div></div>
                    </div></td>
                    <td><strong>${d.monthly_available_hours}h</strong></td>
                    <td>
                      <div style="display:flex;align-items:center;gap:8px">
                        <strong style="color:${d.is_overallocated?'#f87171':'inherit'}">${utils.formatNum(d.total_allocated,0)}h</strong>
                        <span style="font-size:11px;color:var(--text-muted)">(${allocPct}%)</span>
                      </div>
                      ${utils.progressBar(allocPct, d.is_overallocated ? 'red' : allocPct >= 90 ? 'yellow' : 'green')}
                    </td>
                    <td><span style="color:var(--accent)">${utils.formatNum(d.total_consumed,0)}h</span></td>
                    <td><span style="color:${parseFloat(d.idle_hours) < 0 ? '#f87171' : '#f59e0b'}">${utils.formatNum(Math.abs(d.idle_hours),0)}h ${parseFloat(d.idle_hours) < 0 ? '(OVER)' : 'idle'}</span></td>
                    <td><span class="badge badge-blue">${d.project_count} projects</span></td>
                    <td>${d.is_overallocated ? '<span class="badge badge-red"><i class="fas fa-exclamation-triangle"></i> Over-allocated</span>' : '<span class="badge badge-green">Normal</span>'}</td>
                  </tr>`}).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px">No data</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
        <div id="alloc-project" style="display:none">
          <div style="display:flex;gap:10px;margin-bottom:16px">
            <select id="alloc-proj-select" class="form-select" style="max-width:300px" onchange="loadProjectAlloc()">
              <option value="">Select Project...</option>
              ${projects.map(p=>`<option value="${p.id}">${p.name} (${p.code})</option>`).join('')}
            </select>
          </div>
          <div id="project-alloc-detail"></div>
        </div>
      </div>
    `
  } catch (e) { document.getElementById('page-content').innerHTML = `<div style="color:var(--danger);padding:20px">Error: ${e.message}</div>` }
})

function switchAllocTab(tab) {
  document.getElementById('tab-summary').classList.toggle('active', tab === 'summary')
  document.getElementById('tab-project').classList.toggle('active', tab === 'project')
  document.getElementById('alloc-summary').style.display = tab === 'summary' ? '' : 'none'
  document.getElementById('alloc-project').style.display = tab === 'project' ? '' : 'none'
}

async function loadProjectAlloc() {
  const projId = document.getElementById('alloc-proj-select').value
  if (!projId) return
  try {
    const [res, projRes] = await Promise.all([
      API.get('/allocations', { params: { project_id: projId } }),
      API.get(`/projects/${projId}`)
    ])
    const allocs = res.data.data || []
    const proj = projRes.data.data
    const container = document.getElementById('project-alloc-detail')
    container.innerHTML = `
      <div class="glass-card" style="padding:20px">
        <h3 style="font-size:14px;font-weight:700;margin-bottom:16px">${proj.name} — Developer Allocations</h3>
        <table class="data-table">
          <thead><tr><th>Developer</th><th>Role</th><th>Allocated</th><th>Logged</th><th>Progress</th><th>Monthly Capacity</th><th>Over-alloc</th><th>Actions</th></tr></thead>
          <tbody>
            ${allocs.map(a => {
              const pct = a.allocated_hours > 0 ? Math.round((a.logged_hours/a.allocated_hours)*100) : 0
              const overAlloc = a.total_allocated_for_dev > a.monthly_available_hours
              return `<tr>
                <td><div style="display:flex;align-items:center;gap:8px">
                  <div class="avatar avatar-sm" style="background:${a.avatar_color}">${utils.getInitials(a.full_name)}</div>
                  <div><div style="font-size:13px;font-weight:600">${a.full_name}</div><div style="font-size:11px;color:var(--text-muted)">${a.designation}</div></div>
                </div></td>
                <td><span class="badge badge-cyan">${a.role}</span></td>
                <td>
                  <input type="number" value="${a.allocated_hours}" style="width:70px;background:rgba(255,255,255,0.05);border:1px solid var(--border);border-radius:6px;padding:4px 8px;color:var(--text-primary)" id="alloc-hours-${a.user_id}" min="0"/>
                </td>
                <td style="color:var(--accent);font-weight:700">${utils.formatNum(a.logged_hours,0)}h</td>
                <td style="min-width:80px">${utils.progressBar(pct)}</td>
                <td style="font-size:12px;color:var(--text-muted)">${utils.formatNum(a.total_allocated_for_dev,0)}/${a.monthly_available_hours}h</td>
                <td>${overAlloc ? '<span class="badge badge-red"><i class="fas fa-warning"></i> Yes</span>' : '<span class="badge badge-green">No</span>'}</td>
                <td><button class="btn btn-primary btn-xs" onclick="updateAllocation('${projId}','${a.user_id}','${a.role}')"><i class="fas fa-save"></i></button></td>
              </tr>`
            }).join('') || '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text-muted)">No allocations</td></tr>'}
          </tbody>
        </table>
      </div>
    `
  } catch (e) { utils.toast('Failed to load allocations', 'error') }
}

async function updateAllocation(projId, userId, role) {
  const hours = parseFloat(document.getElementById(`alloc-hours-${userId}`)?.value)||0
  try {
    await API.patch(`/projects/${projId}/assign/${userId}`, { allocated_hours: hours, role })
    utils.toast('Allocation updated!', 'success')
  } catch (e) { utils.toast('Failed: ' + e.message, 'error') }
}

// ============ REPORTS PAGE ============
router.register('reports', async () => {
  const currentMonth = new Date().toISOString().slice(0, 7)
  try {
    const [devsRes, projsRes] = await Promise.all([
      API.get('/users', { params: { role: 'developer' } }),
      API.get('/projects')
    ])
    const devs = devsRes.data.data || []
    const projs = projsRes.data.data || []

    document.getElementById('page-content').innerHTML = `
      <div class="animate-fade-in">
        <div class="page-header"><h1 class="page-title">Reports & Analytics</h1><p class="page-subtitle">Comprehensive data insights and exports</p></div>
        <div class="tab-list" style="max-width:500px;margin-bottom:20px">
          <button class="tab-btn active" id="rt-team" onclick="switchReportTab('team')">Team Utilization</button>
          <button class="tab-btn" id="rt-dev" onclick="switchReportTab('dev')">Developer Report</button>
          <button class="tab-btn" id="rt-proj" onclick="switchReportTab('proj')">Project Report</button>
        </div>
        <!-- Team Report -->
        <div id="report-team">
          <div style="display:flex;gap:10px;margin-bottom:16px;align-items:center">
            <input type="month" id="team-month" class="form-input" style="width:auto" value="${currentMonth}"/>
            <button class="btn btn-primary" onclick="loadTeamReport()"><i class="fas fa-chart-bar"></i> Load Report</button>
            <button class="btn btn-secondary" onclick="exportCSV()"><i class="fas fa-download"></i> Export CSV</button>
          </div>
          <div id="team-report-content"></div>
        </div>
        <!-- Dev Report -->
        <div id="report-dev" style="display:none">
          <div style="display:flex;gap:10px;margin-bottom:16px;align-items:center">
            <select id="report-dev-select" class="form-select" style="max-width:240px">
              ${devs.map(d=>`<option value="${d.id}">${d.full_name}</option>`).join('')}
            </select>
            <input type="month" id="dev-report-month" class="form-input" style="width:auto" value="${currentMonth}"/>
            <button class="btn btn-primary" onclick="loadDevReport()"><i class="fas fa-chart-bar"></i> Load</button>
          </div>
          <div id="dev-report-content"></div>
        </div>
        <!-- Project Report -->
        <div id="report-proj" style="display:none">
          <div style="display:flex;gap:10px;margin-bottom:16px;align-items:center">
            <select id="report-proj-select" class="form-select" style="max-width:300px">
              ${projs.map(p=>`<option value="${p.id}">${p.name} (${p.code})</option>`).join('')}
            </select>
            <button class="btn btn-primary" onclick="loadProjReport()"><i class="fas fa-chart-bar"></i> Load</button>
          </div>
          <div id="proj-report-content"></div>
        </div>
      </div>
    `
    loadTeamReport()
  } catch (e) { document.getElementById('page-content').innerHTML = `<div style="color:var(--danger);padding:20px">Error: ${e.message}</div>` }
})

function switchReportTab(tab) {
  ['team','dev','proj'].forEach(t => {
    document.getElementById(`rt-${t}`)?.classList.toggle('active', t === tab)
    document.getElementById(`report-${t}`)?.style && (document.getElementById(`report-${t}`).style.display = t === tab ? '' : 'none')
  })
}

async function loadTeamReport() {
  const month = document.getElementById('team-month')?.value || new Date().toISOString().slice(0, 7)
  try {
    const res = await API.get('/reports/team', { params: { month } })
    const data = res.data.data || []
    const container = document.getElementById('team-report-content')
    const totalHours = data.reduce((s,d) => s + parseFloat(d.logged_hours||0), 0)
    const totalBillable = data.reduce((s,d) => s + parseFloat(d.billable_hours||0), 0)
    container.innerHTML = `
      <div class="grid-4" style="margin-bottom:16px">
        ${statCard('Total Hours', utils.formatHours(totalHours), 'fa-clock', 'blue', month, '')}
        ${statCard('Billable Hours', utils.formatHours(totalBillable), 'fa-money-bill', 'green', `${totalHours > 0 ? Math.round(totalBillable/totalHours*100) : 0}%`, '')}
        ${statCard('Team Members', data.length, 'fa-users', 'purple', 'Active devs', '')}
        ${statCard('Avg Utilization', Math.round(data.reduce((s,d) => s + parseFloat(d.utilization_pct||0), 0) / (data.length||1)) + '%', 'fa-tachometer-alt', 'orange', 'Team average', '')}
      </div>
      <div class="glass-card" style="padding:20px;margin-bottom:16px">
        <div class="chart-container lg"><canvas id="teamUtilChart"></canvas></div>
      </div>
      <div class="glass-card" style="padding:20px">
        <table class="data-table">
          <thead><tr><th>Developer</th><th>Capacity</th><th>Allocated</th><th>Logged</th><th>Billable</th><th>Projects</th><th>Utilization</th></tr></thead>
          <tbody>
            ${data.map(d => `<tr>
              <td><div style="display:flex;align-items:center;gap:8px">
                <div class="avatar avatar-sm" style="background:${d.avatar_color}">${utils.getInitials(d.full_name)}</div>
                <div><div style="font-size:13px;font-weight:600">${d.full_name}</div><div style="font-size:11px;color:var(--text-muted)">${d.designation}</div></div>
              </div></td>
              <td>${d.monthly_available_hours}h</td>
              <td>${utils.formatNum(d.allocated_hours,0)}h</td>
              <td style="color:var(--accent);font-weight:700">${utils.formatNum(d.logged_hours,0)}h</td>
              <td style="color:var(--success)">${utils.formatNum(d.billable_hours,0)}h</td>
              <td>${d.projects_worked}</td>
              <td>${utils.utilizationBadge(Math.round(d.utilization_pct||0))}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `
    // Utilization chart
    const ctx = document.getElementById('teamUtilChart')
    if (ctx && data.length > 0) {
      new Chart(ctx, {
        type: 'bar',
        data: {
          labels: data.map(d => d.full_name.split(' ')[0]),
          datasets: [
            { label: 'Capacity', data: data.map(d => d.monthly_available_hours), backgroundColor: 'rgba(100,116,139,0.3)', borderColor: '#64748b', borderWidth: 1 },
            { label: 'Allocated', data: data.map(d => parseFloat(d.allocated_hours||0)), backgroundColor: 'rgba(99,102,241,0.6)', borderColor: '#6366f1', borderWidth: 2, borderRadius: 4 },
            { label: 'Logged', data: data.map(d => parseFloat(d.logged_hours||0)), backgroundColor: 'rgba(16,185,129,0.7)', borderColor: '#10b981', borderWidth: 2, borderRadius: 4 },
          ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#94a3b8' } } }, scales: { x: { grid: { display: false }, ticks: { color: '#64748b' } }, y: { grid: { color: 'rgba(45,45,107,0.5)' }, ticks: { color: '#64748b', callback: v => v + 'h' } } } }
      })
    }
  } catch (e) { utils.toast('Failed to load report', 'error') }
}

async function loadDevReport() {
  const userId = document.getElementById('report-dev-select').value
  const month = document.getElementById('dev-report-month').value
  if (!userId) { utils.toast('Select a developer', 'error'); return }
  try {
    const res = await API.get(`/reports/developer/${userId}`, { params: { month } })
    const d = res.data.data
    const container = document.getElementById('dev-report-content')
    const total = parseFloat(d.billable_summary?.total || 0)
    const billable = parseFloat(d.billable_summary?.billable || 0)
    container.innerHTML = `
      <div class="grid-3" style="margin-bottom:16px">
        ${statCard('Total Hours', utils.formatHours(total), 'fa-clock', 'blue', month, '')}
        ${statCard('Billable', utils.formatHours(billable), 'fa-money-bill', 'green', `${total > 0 ? Math.round(billable/total*100) : 0}%`, '')}
        ${statCard('Projects', d.project_breakdown?.length || 0, 'fa-folder', 'purple', 'Worked on', '')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="glass-card" style="padding:20px">
          <h3 style="font-size:14px;font-weight:700;margin-bottom:16px">Project Breakdown</h3>
          <div class="chart-container"><canvas id="devProjChart"></canvas></div>
        </div>
        <div class="glass-card" style="padding:20px">
          <h3 style="font-size:14px;font-weight:700;margin-bottom:16px">Daily Hours</h3>
          <div class="chart-container"><canvas id="devDailyChart"></canvas></div>
        </div>
      </div>
    `
    if (d.project_breakdown?.length > 0) {
      const colors = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6']
      new Chart(document.getElementById('devProjChart'), {
        type: 'doughnut',
        data: { labels: d.project_breakdown.map(p=>p.name), datasets: [{ data: d.project_breakdown.map(p=>parseFloat(p.hours||0)), backgroundColor: colors, borderColor: '#1a1a3e', borderWidth: 3 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { labels: { color: '#94a3b8' } } } }
      })
    }
    if (d.daily_hours?.length > 0) {
      new Chart(document.getElementById('devDailyChart'), {
        type: 'bar',
        data: { labels: d.daily_hours.map(x=>x.date.slice(5)), datasets: [{ data: d.daily_hours.map(x=>parseFloat(x.hours||0)), backgroundColor: 'rgba(99,102,241,0.7)', borderColor: '#6366f1', borderWidth: 2, borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: '#64748b' } }, y: { grid: { color: 'rgba(45,45,107,0.5)' }, ticks: { color: '#64748b', callback: v => v + 'h' } } } }
      })
    }
  } catch (e) { utils.toast('Failed to load report', 'error') }
}

async function loadProjReport() {
  const projId = document.getElementById('report-proj-select').value
  if (!projId) { utils.toast('Select a project', 'error'); return }
  try {
    const res = await API.get(`/reports/project/${projId}`)
    const d = res.data.data
    const container = document.getElementById('proj-report-content')
    container.innerHTML = `
      <div class="glass-card" style="padding:20px;margin-bottom:16px">
        <div class="chart-container"><canvas id="projMonthlyChart"></canvas></div>
      </div>
      <div class="glass-card" style="padding:20px">
        <h3 style="font-size:14px;font-weight:700;margin-bottom:16px">Developer Contributions</h3>
        <table class="data-table">
          <thead><tr><th>Developer</th><th>Role</th><th>Allocated</th><th>Logged</th><th>Billable</th><th>Contribution%</th></tr></thead>
          <tbody>
            ${(d.developer_contributions||[]).map(dc => {
              const totalProj = (d.developer_contributions||[]).reduce((s,x) => s + parseFloat(x.logged_hours||0), 0)
              const contribPct = totalProj > 0 ? Math.round((dc.logged_hours/totalProj)*100) : 0
              return `<tr>
                <td><div style="display:flex;align-items:center;gap:8px">
                  <div class="avatar avatar-sm" style="background:${dc.avatar_color}">${utils.getInitials(dc.full_name)}</div>
                  <span style="font-size:13px;font-weight:600">${dc.full_name}</span>
                </div></td>
                <td>${dc.role}</td>
                <td>${utils.formatNum(dc.allocated_hours,0)}h</td>
                <td style="color:var(--accent);font-weight:700">${utils.formatNum(dc.logged_hours,0)}h</td>
                <td style="color:var(--success)">${utils.formatNum(dc.billable||0,0)}h</td>
                <td><div style="display:flex;align-items:center;gap:8px"><span>${contribPct}%</span>${utils.progressBar(contribPct)}</div></td>
              </tr>`
            }).join('')}
          </tbody>
        </table>
      </div>
    `
    if (d.weekly_burn?.length > 0) {
      new Chart(document.getElementById('projMonthlyChart'), {
        type: 'bar',
        data: { labels: d.weekly_burn.map(x=>x.month), datasets: [{ label: 'Hours', data: d.weekly_burn.map(x=>parseFloat(x.hours||0)), backgroundColor: 'rgba(245,158,11,0.7)', borderColor: '#f59e0b', borderWidth: 2, borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: '#64748b' } }, y: { grid: { color: 'rgba(45,45,107,0.5)' }, ticks: { color: '#64748b', callback: v => v + 'h' } } } }
      })
    }
  } catch (e) { utils.toast('Failed to load project report', 'error') }
}

function exportCSV() {
  const month = document.getElementById('team-month')?.value || new Date().toISOString().slice(0, 7)
  window.location.href = `/api/reports/export/timesheets?month=${month}`
}

// ============ ALERTS PAGE ============
router.register('alerts', async () => {
  try {
    const res = await API.get('/alerts')
    const alerts = res.data.data || []
    document.getElementById('page-content').innerHTML = `
      <div class="animate-fade-in">
        <div class="page-header" style="display:flex;justify-content:space-between;align-items:center">
          <div><h1 class="page-title">Alerts & Notifications</h1><p class="page-subtitle">${alerts.length} active alerts</p></div>
          <div style="display:flex;gap:10px">
            <button class="btn btn-secondary btn-sm" onclick="markAllRead()"><i class="fas fa-check"></i> Mark All Read</button>
            ${['admin','pm'].includes(state.user?.role) ? `<button class="btn btn-primary btn-sm" onclick="generateAlerts()"><i class="fas fa-bell"></i> Generate Alerts</button>` : ''}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px" id="alerts-list">
          ${alerts.length === 0 ? `
            <div class="glass-card" style="padding:40px;text-align:center">
              <i class="fas fa-bell" style="font-size:48px;color:var(--success);margin-bottom:16px;display:block"></i>
              <h3 style="font-size:18px;font-weight:700;margin-bottom:8px">All Clear!</h3>
              <p style="color:var(--text-muted)">No active alerts at this time</p>
            </div>` :
          alerts.map(a => `
            <div class="alert-card ${a.severity}" id="alert-${a.id}" style="${a.is_read ? 'opacity:0.7' : ''}">
              <div style="display:flex;justify-content:space-between;align-items:flex-start">
                <div style="display:flex;align-items:flex-start;gap:12px">
                  <div style="width:36px;height:36px;border-radius:10px;background:${a.severity==='critical'?'rgba(239,68,68,0.15)':a.severity==='warning'?'rgba(245,158,11,0.15)':'rgba(14,165,233,0.15)'};display:flex;align-items:center;justify-content:center;font-size:16px">
                    ${a.severity==='critical'?'🔴':a.severity==='warning'?'⚠️':'ℹ️'}
                  </div>
                  <div>
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                      <span style="font-size:14px;font-weight:700">${a.title}</span>
                      ${!a.is_read ? '<span class="badge badge-blue" style="font-size:10px">NEW</span>' : ''}
                      <span class="badge ${a.severity==='critical'?'badge-red':a.severity==='warning'?'badge-yellow':'badge-cyan'}">${a.severity}</span>
                    </div>
                    <p style="font-size:13px;color:var(--text-secondary)">${a.message}</p>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
                      ${a.user_name ? `<span><i class="fas fa-user" style="margin-right:4px"></i>${a.user_name}</span>` : ''}
                      ${a.project_name ? `<span style="margin-left:8px"><i class="fas fa-folder" style="margin-right:4px"></i>${a.project_name}</span>` : ''}
                      <span style="margin-left:8px">${utils.formatRelative(a.created_at)}</span>
                    </div>
                  </div>
                </div>
                <div style="display:flex;gap:6px">
                  ${!a.is_read ? `<button class="btn btn-secondary btn-xs" onclick="markAlertRead('${a.id}')"><i class="fas fa-check"></i></button>` : ''}
                  <button class="btn btn-secondary btn-xs" onclick="dismissAlert('${a.id}')"><i class="fas fa-times"></i></button>
                </div>
              </div>
            </div>`).join('')}
        </div>
      </div>
    `
    loadAlertCount()
  } catch (e) { document.getElementById('page-content').innerHTML = `<div style="color:var(--danger);padding:20px">Error: ${e.message}</div>` }
})

async function markAlertRead(id) {
  try {
    await API.patch(`/alerts/${id}/read`)
    document.getElementById(`alert-${id}`)?.style && (document.getElementById(`alert-${id}`).style.opacity = '0.7')
    loadAlertCount()
  } catch {}
}

async function dismissAlert(id) {
  try {
    await API.patch(`/alerts/${id}/dismiss`)
    const el = document.getElementById(`alert-${id}`)
    if (el) { el.style.animation = 'fadeIn 0.3s reverse'; setTimeout(() => el.remove(), 300) }
    loadAlertCount()
  } catch {}
}

async function markAllRead() {
  try { await API.post('/alerts/mark-all-read'); utils.toast('All alerts marked as read', 'success'); router.navigate('alerts') } catch {}
}

async function generateAlerts() {
  try {
    const res = await API.post('/alerts/generate')
    utils.toast(`${res.data.count} new alerts generated!`, 'success')
    router.navigate('alerts')
  } catch (e) { utils.toast('Failed', 'error') }
}

// ============ SETTINGS PAGE ============
router.register('settings', async () => {
  try {
    const res = await API.get('/settings')
    const { config, holidays, tech_stacks } = res.data.data
    document.getElementById('page-content').innerHTML = `
      <div class="animate-fade-in">
        <div class="page-header"><h1 class="page-title">Settings</h1><p class="page-subtitle">System configuration and master data</p></div>
        <div class="tab-list" style="max-width:500px;margin-bottom:20px">
          <button class="tab-btn active" id="set-company" onclick="switchSettingTab('company')">Company</button>
          <button class="tab-btn" id="set-holidays" onclick="switchSettingTab('holidays')">Holidays</button>
          <button class="tab-btn" id="set-tech" onclick="switchSettingTab('tech')">Tech Stacks</button>
        </div>
        <!-- Company Settings -->
        <div id="settings-company">
          <div class="glass-card" style="padding:24px;max-width:600px">
            <h3 style="font-size:14px;font-weight:700;margin-bottom:16px">Company Configuration</h3>
            <div class="form-group"><label class="form-label">Company Name</label><input id="set-company-name" class="form-input" value="${config?.company_name||''}"/></div>
            <div class="grid-2">
              <div class="form-group"><label class="form-label">Default Daily Hours</label><input id="set-daily-hrs" class="form-input" type="number" value="${config?.default_daily_hours||8}"/></div>
              <div class="form-group"><label class="form-label">Default Working Days/Month</label><input id="set-work-days" class="form-input" type="number" value="${config?.default_working_days||22}"/></div>
              <div class="form-group"><label class="form-label">Alert Threshold (%)</label><input id="set-alert-thresh" class="form-input" type="number" value="${Math.round((config?.alert_threshold_hours||0.8)*100)}"/></div>
              <div class="form-group"><label class="form-label">Overtime Threshold (h/day)</label><input id="set-overtime" class="form-input" type="number" value="${config?.overtime_threshold||10}"/></div>
              <div class="form-group"><label class="form-label">Inactivity Days Alert</label><input id="set-inactive" class="form-input" type="number" value="${config?.inactivity_days||3}"/></div>
            </div>
            <button class="btn btn-primary" onclick="saveCompanySettings()"><i class="fas fa-save"></i> Save Settings</button>
          </div>
        </div>
        <!-- Holidays -->
        <div id="settings-holidays" style="display:none">
          <div class="glass-card" style="padding:20px;max-width:700px">
            <div style="display:flex;justify-content:space-between;margin-bottom:16px">
              <h3 style="font-size:14px;font-weight:700">Company Holidays (${holidays.length})</h3>
              <button class="btn btn-primary btn-sm" onclick="openAddHolidayModal()"><i class="fas fa-plus"></i> Add Holiday</button>
            </div>
            <table class="data-table">
              <thead><tr><th>Name</th><th>Date</th><th>Type</th><th>Actions</th></tr></thead>
              <tbody>
                ${holidays.map(h=>`<tr>
                  <td style="font-size:13px;font-weight:600">${h.name}</td>
                  <td style="font-size:13px;color:var(--text-muted)">${utils.formatDate(h.date)}</td>
                  <td><span class="badge badge-blue">${h.type}</span></td>
                  <td><button class="btn btn-danger btn-xs" onclick="deleteHoliday('${h.id}')"><i class="fas fa-trash"></i></button></td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
        <!-- Tech Stacks -->
        <div id="settings-tech" style="display:none">
          <div class="glass-card" style="padding:20px;max-width:700px">
            <div style="display:flex;justify-content:space-between;margin-bottom:16px">
              <h3 style="font-size:14px;font-weight:700">Tech Stacks Master (${tech_stacks.length})</h3>
              <button class="btn btn-primary btn-sm" onclick="openAddTechModal()"><i class="fas fa-plus"></i> Add Tech</button>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              ${tech_stacks.map(t=>`<span class="tag" style="font-size:13px;padding:4px 12px">${t.name} <small style="color:var(--text-muted)">(${t.category})</small></span>`).join('')}
            </div>
          </div>
        </div>
      </div>
    `
  } catch (e) { document.getElementById('page-content').innerHTML = `<div style="color:var(--danger);padding:20px">Error: ${e.message}</div>` }
})

function switchSettingTab(tab) {
  ['company','holidays','tech'].forEach(t => {
    document.getElementById(`set-${t}`)?.classList.toggle('active', t === tab)
    document.getElementById(`settings-${t}`)?.style && (document.getElementById(`settings-${t}`).style.display = t === tab ? '' : 'none')
  })
}

async function saveCompanySettings() {
  try {
    const payload = {
      company_name: document.getElementById('set-company-name').value,
      default_daily_hours: parseFloat(document.getElementById('set-daily-hrs').value),
      default_working_days: parseInt(document.getElementById('set-work-days').value),
      alert_threshold_hours: parseFloat(document.getElementById('set-alert-thresh').value) / 100,
      overtime_threshold: parseFloat(document.getElementById('set-overtime').value),
      inactivity_days: parseInt(document.getElementById('set-inactive').value),
    }
    await API.put('/settings/company', payload)
    utils.toast('Settings saved!', 'success')
  } catch (e) { utils.toast('Failed: ' + e.message, 'error') }
}

function openAddHolidayModal() {
  const modal = document.createElement('div')
  modal.className = 'modal-overlay'
  modal.id = 'holiday-modal'
  modal.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <h2 style="font-size:16px;font-weight:700">Add Holiday</h2>
        <button onclick="document.getElementById('holiday-modal').remove()" style="background:none;border:none;color:var(--text-muted);font-size:18px;cursor:pointer"><i class="fas fa-times"></i></button>
      </div>
      <div class="modal-body">
        <div class="form-group"><label class="form-label">Name *</label><input id="hol-name" class="form-input" placeholder="Diwali"/></div>
        <div class="form-group"><label class="form-label">Date *</label><input id="hol-date" class="form-input" type="date"/></div>
        <div class="form-group"><label class="form-label">Type</label>
          <select id="hol-type" class="form-select"><option value="national">National</option><option value="optional">Optional</option><option value="company">Company</option></select></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('holiday-modal').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="addHoliday()">Add Holiday</button>
      </div>
    </div>
  `
  document.body.appendChild(modal)
}

async function addHoliday() {
  try {
    await API.post('/settings/holidays', { name: document.getElementById('hol-name').value, date: document.getElementById('hol-date').value, type: document.getElementById('hol-type').value })
    utils.toast('Holiday added!', 'success')
    document.getElementById('holiday-modal')?.remove()
    router.navigate('settings')
  } catch (e) { utils.toast('Failed', 'error') }
}

async function deleteHoliday(id) {
  if (!utils.confirm('Delete this holiday?')) return
  try { await API.delete(`/settings/holidays/${id}`); utils.toast('Deleted!', 'success'); router.navigate('settings') } catch {}
}

function openAddTechModal() {
  const modal = document.createElement('div')
  modal.className = 'modal-overlay'
  modal.id = 'tech-modal'
  modal.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <h2 style="font-size:16px;font-weight:700">Add Tech Stack</h2>
        <button onclick="document.getElementById('tech-modal').remove()" style="background:none;border:none;color:var(--text-muted);font-size:18px;cursor:pointer"><i class="fas fa-times"></i></button>
      </div>
      <div class="modal-body">
        <div class="form-group"><label class="form-label">Name *</label><input id="tech-name" class="form-input" placeholder="Rust"/></div>
        <div class="form-group"><label class="form-label">Category</label><input id="tech-cat" class="form-input" placeholder="Language / Backend / Frontend..."/></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('tech-modal').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="addTechStack()">Add</button>
      </div>
    </div>
  `
  document.body.appendChild(modal)
}

async function addTechStack() {
  try {
    await API.post('/settings/tech-stacks', { name: document.getElementById('tech-name').value, category: document.getElementById('tech-cat').value })
    utils.toast('Tech stack added!', 'success')
    document.getElementById('tech-modal')?.remove()
    router.navigate('settings')
  } catch (e) { utils.toast('Failed', 'error') }
}

// ============ EXECUTIVE DASHBOARD ============
router.register('executive', async () => {
  try {
    const res = await API.get('/dashboard/executive')
    const d = res.data.data
    const cap = d.team_capacity || {}

    document.getElementById('page-content').innerHTML = `
      <div class="animate-fade-in">
        <div class="page-header"><h1 class="page-title">Executive Overview</h1><p class="page-subtitle">Company-level performance metrics</p></div>
        <div class="grid-4" style="margin-bottom:20px">
          ${statCard('Total Capacity', utils.formatHours(cap.total_capacity||0), 'fa-battery-full', 'blue', `${cap.total_devs||0} developers`, '')}
          ${statCard('Active Capacity', utils.formatHours(cap.active_capacity||0), 'fa-users', 'green', 'Active developers', '')}
          ${statCard('Projects', d.project_costs?.length||0, 'fa-folder-open', 'purple', 'Active/completed', '')}
          ${statCard('Top Dev Hours', utils.formatHours(d.top_developers?.[0]?.total_logged||0), 'fa-star', 'orange', d.top_developers?.[0]?.full_name||'-', '')}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
          <div class="glass-card" style="padding:20px">
            <h3 style="font-size:14px;font-weight:700;margin-bottom:16px">Monthly Team Hours Trend</h3>
            <div class="chart-container"><canvas id="execTrendChart"></canvas></div>
          </div>
          <div class="glass-card" style="padding:20px">
            <h3 style="font-size:14px;font-weight:700;margin-bottom:16px">Project Profitability</h3>
            <div style="overflow-y:auto;max-height:280px">
              <table class="data-table">
                <thead><tr><th>Project</th><th>Revenue</th><th>Effort Cost</th><th>Profit</th></tr></thead>
                <tbody>
                  ${(d.project_costs||[]).map(p => {
                    const profit = parseFloat(p.revenue||0) - parseFloat(p.effort_cost||0)
                    return `<tr>
                      <td style="font-size:13px;font-weight:600">${p.name}</td>
                      <td style="color:var(--success)">₹${parseFloat(p.revenue||0).toLocaleString()}</td>
                      <td style="color:var(--warning)">₹${parseFloat(p.effort_cost||0).toLocaleString()}</td>
                      <td style="color:${profit>=0?'#34d399':'#f87171'};font-weight:700">₹${profit.toLocaleString()}</td>
                    </tr>`}).join('') || '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-muted)">No data</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="glass-card" style="padding:20px">
          <h3 style="font-size:14px;font-weight:700;margin-bottom:16px">Developer Leaderboard</h3>
          <div style="overflow-x:auto">
            <table class="data-table">
              <thead><tr><th>#</th><th>Developer</th><th>Total Hours</th><th>Billable Hours</th><th>Projects</th><th>Effort Cost</th><th>Productivity Score</th></tr></thead>
              <tbody>
                ${(d.top_developers||[]).map((dev,i) => {
                  const prodScore = Math.min(100, Math.round(parseFloat(dev.total_logged||0) / 160 * 100))
                  const effortCost = parseFloat(dev.total_logged||0) * parseFloat(dev.hourly_cost||0)
                  return `<tr>
                    <td><div style="width:28px;height:28px;border-radius:50%;background:${i===0?'#f59e0b':i===1?'#94a3b8':i===2?'#f97316':'var(--bg-hover)'};display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:800">${i+1}</div></td>
                    <td><div style="display:flex;align-items:center;gap:8px">
                      <div class="avatar avatar-sm" style="background:${dev.avatar_color}">${utils.getInitials(dev.full_name)}</div>
                      <div><div style="font-size:13px;font-weight:600">${dev.full_name}</div><div style="font-size:11px;color:var(--text-muted)">${dev.designation}</div></div>
                    </div></td>
                    <td style="font-weight:700;color:var(--accent)">${utils.formatNum(dev.total_logged,0)}h</td>
                    <td style="color:var(--success)">${utils.formatNum(dev.billable_hours,0)}h</td>
                    <td>${dev.projects_worked}</td>
                    <td style="color:var(--warning)">₹${effortCost.toLocaleString()}</td>
                    <td>
                      <div style="display:flex;align-items:center;gap:8px">
                        <div style="flex:1;max-width:80px">${utils.progressBar(prodScore)}</div>
                        <span style="font-size:12px;font-weight:700">${prodScore}%</span>
                      </div>
                    </td>
                  </tr>`}).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `
    if (d.monthly_trend?.length > 0) {
      new Chart(document.getElementById('execTrendChart'), {
        type: 'line',
        data: {
          labels: d.monthly_trend.map(x=>x.month),
          datasets: [
            { label: 'Total Hours', data: d.monthly_trend.map(x=>parseFloat(x.total_hours||0)), borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.1)', fill: true, tension: 0.4, pointRadius: 4 },
            { label: 'Billable', data: d.monthly_trend.map(x=>parseFloat(x.billable_hours||0)), borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.05)', fill: true, tension: 0.4, pointRadius: 4 },
          ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#94a3b8' } } }, scales: { x: { grid: { display: false }, ticks: { color: '#64748b' } }, y: { grid: { color: 'rgba(45,45,107,0.5)' }, ticks: { color: '#64748b', callback: v => v + 'h' } } } }
      })
    }
  } catch (e) { document.getElementById('page-content').innerHTML = `<div style="color:var(--danger);padding:20px">Error: ${e.message}</div>` }
})

// ============ MY PROFILE ============
router.register('my-profile', async () => {
  try {
    const [userRes, utilRes] = await Promise.all([
      API.get(`/users/${state.user.id || state.user.sub}`),
      API.get(`/users/${state.user.id || state.user.sub}/utilization`)
    ])
    const d = userRes.data.data
    const util = utilRes.data.data
    document.getElementById('page-content').innerHTML = `
      <div class="animate-fade-in">
        <div class="page-header"><h1 class="page-title">My Profile</h1></div>
        <div style="display:grid;grid-template-columns:340px 1fr;gap:16px">
          <div>
            <div class="glass-card" style="padding:24px;margin-bottom:16px;text-align:center">
              <div class="avatar avatar-xl" style="background:${d.avatar_color||'#6366f1'};margin:0 auto 12px">${utils.getInitials(d.full_name)}</div>
              <div style="font-size:20px;font-weight:800">${d.full_name}</div>
              <div style="color:var(--text-muted);font-size:13px;margin:4px 0">${d.designation||d.role}</div>
              <div style="margin:8px 0">${d.is_active ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-gray">Inactive</span>'}</div>
              <div style="margin-top:12px;font-size:13px;color:var(--text-secondary)">${d.email}</div>
            </div>
            <div class="glass-card" style="padding:20px">
              <h3 style="font-size:13px;font-weight:700;margin-bottom:14px">Change Password</h3>
              <div class="form-group"><label class="form-label">Current Password</label><input id="cur-pass" class="form-input" type="password"/></div>
              <div class="form-group"><label class="form-label">New Password</label><input id="new-pass" class="form-input" type="password"/></div>
              <button class="btn btn-primary btn-sm" onclick="changePassword()"><i class="fas fa-lock"></i> Update Password</button>
            </div>
          </div>
          <div>
            <div class="grid-3" style="margin-bottom:16px">
              ${statCard('Capacity', utils.formatHours(util?.capacity_hours||0), 'fa-battery-full', 'blue', 'This month', '')}
              ${statCard('Logged', utils.formatHours(util?.logged_hours||0), 'fa-clock', 'green', 'This month', '')}
              ${statCard('Utilization', (util?.utilization_percent||0) + '%', 'fa-tachometer-alt', (util?.utilization_percent||0) >= 100 ? 'red' : 'purple', util?.status || '', '')}
            </div>
            <div class="glass-card" style="padding:20px">
              <h3 style="font-size:14px;font-weight:700;margin-bottom:16px">My Assignments</h3>
              <table class="data-table">
                <thead><tr><th>Project</th><th>Role</th><th>Allocated</th><th>Logged</th><th>Progress</th></tr></thead>
                <tbody>
                  ${(d.assignments||[]).map(a => {
                    const pct = a.allocated_hours > 0 ? Math.round((a.logged_hours/a.allocated_hours)*100) : 0
                    return `<tr>
                      <td onclick="router.navigate('project-detail',{id:'${a.project_id}'})" style="cursor:pointer;color:var(--primary-light);font-weight:600;font-size:13px">${a.project_name}</td>
                      <td><span class="badge badge-blue">${a.role}</span></td>
                      <td>${utils.formatHours(a.allocated_hours)}</td>
                      <td style="color:var(--accent);font-weight:700">${utils.formatHours(a.logged_hours)}</td>
                      <td style="min-width:100px">${utils.progressBar(pct)}<span style="font-size:10px;color:var(--text-muted)">${pct}%</span></td>
                    </tr>`}).join('') || '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted)">No assignments</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `
  } catch (e) { document.getElementById('page-content').innerHTML = `<div style="color:var(--danger);padding:20px">Error: ${e.message}</div>` }
})

async function changePassword() {
  const cur = document.getElementById('cur-pass').value
  const nw = document.getElementById('new-pass').value
  if (!cur || !nw) { utils.toast('Please fill both fields', 'error'); return }
  try {
    await API.post('/auth/change-password', { current_password: cur, new_password: nw })
    utils.toast('Password updated!', 'success')
    document.getElementById('cur-pass').value = ''
    document.getElementById('new-pass').value = ''
  } catch (e) { utils.toast(e.response?.data?.error || 'Failed', 'error') }
}

// ============ LEAVES ============
router.register('leaves', async () => {
  try {
    const res = await API.get('/leaves')
    const leaves = res.data.data || []
    const devsRes = await API.get('/users', { params: { role: 'developer', active: 'true' } })
    const devs = devsRes.data.data || []
    document.getElementById('page-content').innerHTML = `
      <div class="animate-fade-in">
        <div class="page-header" style="display:flex;justify-content:space-between">
          <div><h1 class="page-title">Leave Management</h1></div>
          <button class="btn btn-primary" onclick="openLeaveModal(null,${JSON.stringify(devs).replace(/"/g,'&quot;')})"><i class="fas fa-plus"></i> Add Leave</button>
        </div>
        <div class="glass-card" style="padding:20px">
          <table class="data-table">
            <thead><tr><th>Developer</th><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Reason</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              ${leaves.map(l=>`<tr>
                <td><div style="display:flex;align-items:center;gap:8px">
                  <div class="avatar avatar-sm" style="background:${l.avatar_color}">${utils.getInitials(l.full_name)}</div>
                  <span style="font-size:13px;font-weight:600">${l.full_name}</span>
                </div></td>
                <td><span class="badge badge-blue">${l.leave_type}</span></td>
                <td style="font-size:12px;color:var(--text-muted)">${utils.formatDate(l.start_date)}</td>
                <td style="font-size:12px;color:var(--text-muted)">${utils.formatDate(l.end_date)}</td>
                <td><strong>${l.days_count}</strong></td>
                <td style="font-size:12px;color:var(--text-secondary);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.reason||'-'}</td>
                <td><span class="badge ${l.status==='approved'?'badge-green':l.status==='rejected'?'badge-red':'badge-yellow'}">${l.status}</span></td>
                <td>
                  ${l.status === 'pending' ? `
                  <button class="btn btn-success btn-xs" onclick="approveLeave('${l.id}','approved')"><i class="fas fa-check"></i></button>
                  <button class="btn btn-danger btn-xs" onclick="approveLeave('${l.id}','rejected')"><i class="fas fa-times"></i></button>` : ''}
                  <button class="btn btn-danger btn-xs" onclick="deleteLeave('${l.id}')"><i class="fas fa-trash"></i></button>
                </td>
              </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:20px">No leaves found</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `
  } catch (e) { document.getElementById('page-content').innerHTML = `<div style="color:var(--danger);padding:20px">Error: ${e.message}</div>` }
})

function openLeaveModal(leave, devs) {
  const modal = document.createElement('div')
  modal.className = 'modal-overlay'
  modal.id = 'leave-modal'
  modal.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <h2 style="font-size:16px;font-weight:700">Add Leave</h2>
        <button onclick="document.getElementById('leave-modal').remove()" style="background:none;border:none;color:var(--text-muted);font-size:18px;cursor:pointer"><i class="fas fa-times"></i></button>
      </div>
      <div class="modal-body">
        <div class="form-group"><label class="form-label">Developer *</label>
          <select id="lv-user" class="form-select"><option value="">Select Developer</option>${(devs||[]).map(d=>`<option value="${d.id}">${d.full_name}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Leave Type</label>
          <select id="lv-type" class="form-select"><option value="sick">Sick</option><option value="casual">Casual</option><option value="earned">Earned</option><option value="unpaid">Unpaid</option></select></div>
        <div class="grid-2">
          <div class="form-group"><label class="form-label">From *</label><input id="lv-from" class="form-input" type="date"/></div>
          <div class="form-group"><label class="form-label">To *</label><input id="lv-to" class="form-input" type="date" onchange="calcDays()"/></div>
        </div>
        <div class="form-group"><label class="form-label">Days Count</label><input id="lv-days" class="form-input" type="number" value="1" min="0.5" step="0.5"/></div>
        <div class="form-group"><label class="form-label">Reason</label><textarea id="lv-reason" class="form-textarea" rows="2"></textarea></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('leave-modal').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="submitLeave()">Add Leave</button>
      </div>
    </div>
  `
  document.body.appendChild(modal)
}

function calcDays() {
  const from = document.getElementById('lv-from').value
  const to = document.getElementById('lv-to').value
  if (from && to) {
    const diff = Math.ceil((new Date(to) - new Date(from)) / (1000*60*60*24)) + 1
    document.getElementById('lv-days').value = Math.max(1, diff)
  }
}

async function submitLeave() {
  const userId = document.getElementById('lv-user').value
  const from = document.getElementById('lv-from').value
  const to = document.getElementById('lv-to').value
  if (!userId || !from || !to) { utils.toast('Please fill required fields', 'error'); return }
  try {
    await API.post('/leaves', { user_id: userId, leave_type: document.getElementById('lv-type').value, start_date: from, end_date: to, days_count: parseFloat(document.getElementById('lv-days').value), reason: document.getElementById('lv-reason').value })
    utils.toast('Leave added!', 'success')
    document.getElementById('leave-modal').remove()
    router.navigate('leaves')
  } catch (e) { utils.toast('Failed: ' + e.message, 'error') }
}

async function approveLeave(id, status) {
  try { await API.patch(`/leaves/${id}/approve`, { status }); utils.toast(`Leave ${status}!`, 'success'); router.navigate('leaves') } catch {}
}

async function deleteLeave(id) {
  if (!utils.confirm('Delete this leave?')) return
  try { await API.delete(`/leaves/${id}`); utils.toast('Deleted!', 'success'); router.navigate('leaves') } catch {}
}

// ============ RESOURCE PLANNER ============
router.register('resource-planner', async () => {
  try {
    const [devsRes, projsRes] = await Promise.all([
      API.get('/users', { params: { role: 'developer', active: 'true' } }),
      API.get('/projects', { params: { status: 'active' } })
    ])
    const devs = devsRes.data.data || []
    const projects = projsRes.data.data || []
    const today = new Date()
    const weekStart = new Date(today)
    weekStart.setDate(today.getDate() - today.getDay() + 1)

    const weekDays = Array.from({length: 5}, (_, i) => {
      const d = new Date(weekStart)
      d.setDate(weekStart.getDate() + i)
      return { date: d.toISOString().split('T')[0], label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }
    })

    document.getElementById('page-content').innerHTML = `
      <div class="animate-fade-in">
        <div class="page-header" style="display:flex;justify-content:space-between">
          <div><h1 class="page-title">Resource Planner</h1><p class="page-subtitle">Weekly team planning & allocation</p></div>
          <div style="display:flex;gap:10px;align-items:center">
            <span style="font-size:13px;color:var(--text-muted)">Week of ${weekDays[0].label}</span>
          </div>
        </div>
        <div class="glass-card" style="padding:20px;overflow-x:auto">
          <table class="data-table" style="min-width:900px">
            <thead>
              <tr>
                <th style="width:180px">Developer</th>
                ${weekDays.map(d=>`<th style="text-align:center">${d.label}</th>`).join('')}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${devs.map(dev => {
                const totalHours = 40 // placeholder
                return `<tr>
                  <td>
                    <div style="display:flex;align-items:center;gap:8px">
                      <div class="avatar avatar-sm" style="background:${dev.avatar_color}">${utils.getInitials(dev.full_name)}</div>
                      <div><div style="font-size:13px;font-weight:600">${dev.full_name.split(' ')[0]}</div><div style="font-size:10px;color:var(--text-muted)">${dev.designation||'Dev'}</div></div>
                    </div>
                  </td>
                  ${weekDays.map(d => `
                  <td>
                    <div class="planner-cell" onclick="openPlannerEntry('${dev.id}','${dev.full_name}','${d.date}')">
                      <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">${d.date}</div>
                      <div class="planner-task" id="plan-${dev.id}-${d.date}" style="display:none"></div>
                    </div>
                  </td>`).join('')}
                  <td style="text-align:center">
                    <span class="badge badge-blue" id="plan-total-${dev.id}">0h</span>
                  </td>
                </tr>`}).join('')}
            </tbody>
          </table>
        </div>
        <div style="margin-top:16px;padding:14px;background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.2);border-radius:12px;font-size:13px;color:var(--text-secondary)">
          <i class="fas fa-info-circle" style="color:var(--primary-light);margin-right:8px"></i>
          Click on any cell to plan developer tasks for that day. This is a visual planning tool to coordinate team workload.
        </div>
      </div>
    `
    // Load existing logs for the week
    for (const dev of devs) {
      for (const day of weekDays) {
        try {
          const res = await API.get('/timesheets', { params: { user_id: dev.id, date: day.date } })
          const logs = res.data.data || []
          if (logs.length > 0) {
            const totalH = logs.reduce((s,l)=>s+parseFloat(l.hours_consumed),0)
            const el = document.getElementById(`plan-${dev.id}-${day.date}`)
            if (el) { el.style.display = ''; el.textContent = `${logs[0].project_name} - ${totalH}h` }
          }
        } catch {}
      }
    }
  } catch (e) { document.getElementById('page-content').innerHTML = `<div style="color:var(--danger);padding:20px">Error: ${e.message}</div>` }
})

function openPlannerEntry(devId, devName, date) {
  router.navigate('timesheet', { user_id: devId, date })
}

// ============ INIT ============
// pages2.js is a legacy module – initialization is handled by app.js
// The auth, renderLogin, renderLayout calls are no-ops in the new system
// All functions here are called directly by enterprise2.js and other modules
