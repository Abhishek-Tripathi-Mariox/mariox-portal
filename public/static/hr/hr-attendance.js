// HR · Attendance
// Backed by /api/attendance. Manage permission: hr.attendance.manage.
// Employees without the manage permission only see their own records (server
// enforces — we just hide the manager-only controls).

// `tab` switches between the daily log and the monthly summary view. We
// keep both behind the same page so admins don't lose filter context when
// flipping between them.
let _hrAttTab = 'log'  // 'log' | 'summary'
let _hrAttFilterDate = ''
let _hrAttFilterStatus = ''
let _hrAttPage = 1
let _hrAttSummaryMonth = ''

const ATT_STATUS_BADGE = {
  present:  '<span class="badge badge-green">Present</span>',
  absent:   '<span class="badge badge-red">Absent</span>',
  half_day: '<span class="badge badge-yellow">Half day</span>',
  late:     '<span class="badge badge-yellow">Late</span>',
  on_leave: '<span class="badge badge-blue">On leave</span>',
  holiday:  '<span class="badge badge-blue">Holiday</span>',
}

async function renderAttendanceView(el) {
  el.innerHTML = hrLoadingHTML()
  try {
    const canManage = hrCanManage('attendance')
    // Non-managers can only see the daily log of their own rows; summary view
    // is a company-wide aggregate that only makes sense for HR.
    if (!canManage) _hrAttTab = 'log'

    // Always preload the employee list for managers so the Bulk modal can
    // render employees as checkboxes without a second round-trip.
    const usersRes = canManage ? await hrFetchEmployees() : { users: [] }
    window._hrEmployees = usersRes.users || usersRes.data || []

    if (_hrAttTab === 'summary' && canManage) {
      await renderAttendanceSummaryTab(el)
      return
    }

    const params = {}
    if (_hrAttFilterDate) params.date = _hrAttFilterDate
    const rows = await API.get('/attendance', { params })
    const list = rows.attendance || rows.data || []

    const filtered = _hrAttFilterStatus ? list.filter(r => r.status === _hrAttFilterStatus) : list
    const pagination = paginateClient(filtered, _hrAttPage, 12)
    _hrAttPage = pagination.page

    const present = list.filter(r => r.status === 'present').length
    const absent  = list.filter(r => r.status === 'absent').length
    const late    = list.filter(r => r.status === 'late').length

    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Attendance</h1>
          <p class="page-subtitle">${canManage ? 'Track daily attendance for every employee' : 'Your daily attendance record'}</p>
        </div>
        ${canManage ? `<div class="page-actions" style="display:flex;gap:8px">
          <button class="btn btn-outline" onclick="openBulkAttendanceModal()"><i class="fas fa-users"></i> Bulk Mark</button>
          <button class="btn btn-primary" onclick="openAttendanceModal()"><i class="fas fa-plus"></i> Mark Attendance</button>
        </div>` : ''}
      </div>

      ${canManage ? `<div style="display:flex;gap:6px;margin-bottom:14px;border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:0">
        <button class="btn btn-sm ${_hrAttTab==='log'?'btn-primary':'btn-outline'}" onclick="hrAttSetTab('log')" style="border-radius:6px 6px 0 0"><i class="fas fa-list"></i> Daily Log</button>
        <button class="btn btn-sm ${_hrAttTab==='summary'?'btn-primary':'btn-outline'}" onclick="hrAttSetTab('summary')" style="border-radius:6px 6px 0 0"><i class="fas fa-chart-column"></i> Monthly Summary</button>
      </div>` : ''}

      <div class="grid-4" style="margin-bottom:16px">
        ${miniStatCard('Records', list.length, '#FF7A45', 'fa-user-clock')}
        ${miniStatCard('Present', present, '#58C68A', 'fa-check-circle')}
        ${miniStatCard('Absent',  absent,  '#FF5E3A', 'fa-times-circle')}
        ${miniStatCard('Late',    late,    '#FFCB47', 'fa-hourglass-half')}
      </div>

      <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;align-items:center">
        <div class="form-group" style="margin:0">
          <label class="form-label" style="font-size:11px;margin-bottom:2px">Date</label>
          <input type="date" class="form-input" value="${_hrAttFilterDate}" onchange="hrAttSetDate(this.value)" style="height:32px"/>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end">
          ${hrFilterButtons([
            { value: '',         label: 'All',       activeStyle: 'background:rgba(255,122,69,.15);color:#FFB347' },
            { value: 'present',  label: 'Present',   activeStyle: 'background:rgba(88,198,138,.15);color:#86E0A8' },
            { value: 'absent',   label: 'Absent',    activeStyle: 'background:rgba(255,94,58,.15);color:#FF8866' },
            { value: 'half_day', label: 'Half day',  activeStyle: 'background:rgba(255,203,71,.15);color:#FFD986' },
            { value: 'late',     label: 'Late',      activeStyle: 'background:rgba(255,203,71,.15);color:#FFD986' },
            { value: 'on_leave', label: 'On leave',  activeStyle: 'background:rgba(100,160,255,.15);color:#A8C8FF' },
          ], _hrAttFilterStatus, 'hrAttSetStatus')}
        </div>
      </div>

      <div class="card"><div class="card-body" style="padding:0">
        <table class="data-table">
          <thead><tr>
            ${canManage ? '<th>Employee</th>' : ''}
            <th>Date</th><th>Status</th><th>Check-in</th><th>Check-out</th><th>Note</th>${canManage ? '<th style="width:80px">Actions</th>' : ''}
          </tr></thead>
          <tbody>
            ${pagination.total === 0
              ? hrEmptyRow(canManage ? 7 : 5, 'fa-user-clock', 'No attendance records yet.')
              : pagination.items.map(r => renderAttendanceRow(r, canManage)).join('')}
          </tbody>
        </table>
        ${renderPager(pagination, 'hrAttPage', 'hrAttPage', 'records')}
      </div></div>`
  } catch (e) {
    el.innerHTML = hrErrorHTML(e.message)
  }
}

function renderAttendanceRow(r, canManage) {
  const name = r.full_name || r.email || 'Unknown'
  return `<tr>
    ${canManage ? `<td><div style="display:flex;align-items:center;gap:8px">${avatar(name, r.avatar_color, 'sm')}<span style="font-size:12.5px;color:#FFF1E6">${escapeInbox(name)}</span></div></td>` : ''}
    <td style="font-size:12px;color:#9F8678">${fmtDate(r.date)}</td>
    <td>${ATT_STATUS_BADGE[r.status] || `<span class="badge">${escapeInbox(r.status||'')}</span>`}</td>
    <td style="font-size:12px;color:#E8D2BD">${escapeInbox(r.check_in || '—')}</td>
    <td style="font-size:12px;color:#E8D2BD">${escapeInbox(r.check_out || '—')}</td>
    <td style="font-size:12px;color:#E8D2BD;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeInbox(r.note || '')}">${escapeInbox(r.note || '—')}</td>
    ${canManage ? `<td><button class="btn btn-icon btn-xs" onclick="deleteAttendance('${r.id}')" title="Delete"><i class="fas fa-trash"></i></button></td>` : ''}
  </tr>`
}

function hrAttSetDate(v) { _hrAttFilterDate = v || ''; _hrAttPage = 1; hrReloadPage('page-hr-attendance') }
function hrAttSetStatus(v) { _hrAttFilterStatus = v || ''; _hrAttPage = 1; hrReloadPage('page-hr-attendance') }
function hrAttPage(p) { _hrAttPage = Math.max(1, Number(p) || 1); hrReloadPage('page-hr-attendance') }

function openAttendanceModal() {
  if (!hrCanManage('attendance')) { toast('Not allowed', 'error'); return }
  const users = window._hrEmployees || []
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-user-clock" style="color:var(--accent);margin-right:6px"></i>Mark Attendance</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div class="form-group">
        <label class="form-label">Employee *</label>
        ${hrEmployeePicker('att-user', users)}
      </div>
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Date *</label>
          <input id="att-date" class="form-input" type="date" value="${hrTodayISO()}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Status *</label>
          <select id="att-status" class="form-select">
            <option value="present">Present</option>
            <option value="absent">Absent</option>
            <option value="half_day">Half day</option>
            <option value="late">Late</option>
            <option value="on_leave">On leave</option>
            <option value="holiday">Holiday</option>
          </select>
        </div>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Check-in</label><input id="att-in" class="form-input" type="time"/></div>
        <div class="form-group"><label class="form-label">Check-out</label><input id="att-out" class="form-input" type="time"/></div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">Note</label>
        <textarea id="att-note" class="form-textarea" rows="2" placeholder="Optional"></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitAttendance()"><i class="fas fa-save"></i> Save</button>
    </div>
  `, 'modal-lg')
}

async function submitAttendance() {
  const payload = {
    user_id:   document.getElementById('att-user')?.value,
    date:      document.getElementById('att-date')?.value,
    status:    document.getElementById('att-status')?.value,
    check_in:  document.getElementById('att-in')?.value || null,
    check_out: document.getElementById('att-out')?.value || null,
    note:      document.getElementById('att-note')?.value.trim() || null,
  }
  if (!payload.user_id || !payload.date || !payload.status) { toast('Employee, date, and status are required', 'error'); return }
  try {
    await API.post('/attendance', payload)
    toast('Attendance saved', 'success'); closeModal(); hrReloadPage('page-hr-attendance')
  } catch (e) { toast('Failed: ' + e.message, 'error') }
}

async function deleteAttendance(id) {
  if (!confirm('Delete this attendance record?')) return
  try { await API.delete('/attendance/' + id); toast('Deleted', 'success'); hrReloadPage('page-hr-attendance') }
  catch (e) { toast('Failed: ' + e.message, 'error') }
}

// ── Tab + Summary ──────────────────────────────────────────────
function hrAttSetTab(t) { _hrAttTab = (t === 'summary') ? 'summary' : 'log'; hrReloadPage('page-hr-attendance') }

async function renderAttendanceSummaryTab(el) {
  if (!_hrAttSummaryMonth) _hrAttSummaryMonth = hrCurrentMonthISO()
  el.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Attendance</h1>
        <p class="page-subtitle">Monthly summary by employee</p>
      </div>
      <div class="page-actions" style="display:flex;gap:8px">
        <button class="btn btn-outline" onclick="openBulkAttendanceModal()"><i class="fas fa-users"></i> Bulk Mark</button>
        <button class="btn btn-primary" onclick="openAttendanceModal()"><i class="fas fa-plus"></i> Mark Attendance</button>
      </div>
    </div>

    <div style="display:flex;gap:6px;margin-bottom:14px;border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:0">
      <button class="btn btn-sm btn-outline" onclick="hrAttSetTab('log')" style="border-radius:6px 6px 0 0"><i class="fas fa-list"></i> Daily Log</button>
      <button class="btn btn-sm btn-primary" onclick="hrAttSetTab('summary')" style="border-radius:6px 6px 0 0"><i class="fas fa-chart-column"></i> Monthly Summary</button>
    </div>

    <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;align-items:center">
      <div class="form-group" style="margin:0">
        <label class="form-label" style="font-size:11px;margin-bottom:2px">Month</label>
        <input type="month" class="form-input" value="${_hrAttSummaryMonth}" onchange="hrAttSummarySetMonth(this.value)" style="height:32px"/>
      </div>
    </div>

    <div id="hr-att-summary-body">${hrLoadingHTML()}</div>`

  try {
    const res = await API.get('/attendance/summary', { params: { month: _hrAttSummaryMonth } })
    const rows = res.summary || res.data || []
    const body = document.getElementById('hr-att-summary-body')
    if (!body) return
    body.innerHTML = `
      <div class="card"><div class="card-body" style="padding:0">
        <table class="data-table">
          <thead><tr>
            <th>Employee</th>
            <th style="text-align:center">Present</th>
            <th style="text-align:center">Half day</th>
            <th style="text-align:center">Late</th>
            <th style="text-align:center">Absent</th>
            <th style="text-align:center">On leave</th>
            <th style="text-align:center">Holiday</th>
            <th style="text-align:center">Marked</th>
          </tr></thead>
          <tbody>
            ${rows.length === 0
              ? hrEmptyRow(8, 'fa-chart-column', 'No employees found.')
              : rows.map(s => `<tr>
                  <td><div style="display:flex;align-items:center;gap:8px">${avatar(s.full_name || s.email || '?', s.avatar_color, 'sm')}<div><div style="font-size:12.5px;color:#FFF1E6">${escapeInbox(s.full_name || '—')}</div><div style="font-size:11px;color:#9F8678">${escapeInbox(s.designation || s.email || '')}</div></div></div></td>
                  <td style="text-align:center;color:#86E0A8;font-weight:700">${s.present}</td>
                  <td style="text-align:center;color:#FFD986">${s.half_day}</td>
                  <td style="text-align:center;color:#FFD986">${s.late}</td>
                  <td style="text-align:center;color:#FF8866;font-weight:700">${s.absent}</td>
                  <td style="text-align:center;color:#A8C8FF">${s.on_leave}</td>
                  <td style="text-align:center;color:#A8C8FF">${s.holiday}</td>
                  <td style="text-align:center;color:#9F8678">${s.total}</td>
                </tr>`).join('')}
          </tbody>
        </table>
      </div></div>`
  } catch (e) {
    const body = document.getElementById('hr-att-summary-body')
    if (body) body.innerHTML = hrErrorHTML(e.message)
  }
}

function hrAttSummarySetMonth(m) { _hrAttSummaryMonth = m || hrCurrentMonthISO(); hrReloadPage('page-hr-attendance') }

// ── Bulk Mark ─────────────────────────────────────────────────
function openBulkAttendanceModal() {
  if (!hrCanManage('attendance')) { toast('Not allowed', 'error'); return }
  const users = window._hrEmployees || []
  const activeUsers = users.filter(u => Number(u.is_active) !== 0)
  const rows = activeUsers.map(u => `
    <label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;background:rgba(255,255,255,0.02)" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='rgba(255,255,255,0.02)'">
      <input type="checkbox" class="att-bulk-user" value="${u.id}" checked/>
      ${avatar(u.full_name || u.email || '?', u.avatar_color, 'sm')}
      <div style="flex:1;min-width:0">
        <div style="font-size:12.5px;color:#FFF1E6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeInbox(u.full_name || u.email || '?')}</div>
        <div style="font-size:11px;color:#9F8678;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeInbox(u.designation || u.email || '')}</div>
      </div>
    </label>`).join('')

  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-users" style="color:var(--accent);margin-right:6px"></i>Bulk Mark Attendance</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Date *</label>
          <input id="bulk-att-date" class="form-input" type="date" value="${hrTodayISO()}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Status *</label>
          <select id="bulk-att-status" class="form-select">
            <option value="present">Present</option>
            <option value="absent">Absent</option>
            <option value="half_day">Half day</option>
            <option value="late">Late</option>
            <option value="on_leave">On leave</option>
            <option value="holiday">Holiday</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Note</label>
        <input id="bulk-att-note" class="form-input" placeholder="Optional — applied to all selected rows"/>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:11px;color:#9F8678;text-transform:uppercase;letter-spacing:.5px">Employees (${activeUsers.length})</div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-xs btn-outline" onclick="hrBulkToggleAll(true)">Select all</button>
          <button class="btn btn-xs btn-outline" onclick="hrBulkToggleAll(false)">Clear</button>
        </div>
      </div>
      <div style="max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;padding:4px;border-radius:8px;background:rgba(0,0,0,0.15)">
        ${activeUsers.length === 0 ? '<div style="padding:20px;text-align:center;color:#9F8678">No active employees</div>' : rows}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitBulkAttendance()"><i class="fas fa-save"></i> Save All</button>
    </div>
  `, 'modal-lg')
}

function hrBulkToggleAll(checked) {
  document.querySelectorAll('.att-bulk-user').forEach(cb => { cb.checked = checked })
}

async function submitBulkAttendance() {
  const date = document.getElementById('bulk-att-date')?.value
  const status = document.getElementById('bulk-att-status')?.value
  const note = document.getElementById('bulk-att-note')?.value.trim() || null
  const user_ids = Array.from(document.querySelectorAll('.att-bulk-user'))
    .filter(cb => cb.checked).map(cb => cb.value)
  if (!date || !status) { toast('Date and status are required', 'error'); return }
  if (user_ids.length === 0) { toast('Select at least one employee', 'error'); return }
  try {
    const res = await API.post('/attendance/bulk', { date, status, note, user_ids })
    const d = res.data || {}
    toast(`Saved · ${d.inserted || 0} new, ${d.updated || 0} updated`, 'success')
    closeModal(); hrReloadPage('page-hr-attendance')
  } catch (e) { toast('Failed: ' + e.message, 'error') }
}
