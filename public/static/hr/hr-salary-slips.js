// HR · Salary Slips
// Backed by /api/salary-slips. Manage permission: hr.salary_slips.manage.
// Employees see only their own slips (server filter); they can view + print
// but cannot generate or delete.

let _hrSlipPage = 1
let _hrSlipMonth = ''

async function renderSalarySlipsView(el) {
  el.innerHTML = hrLoadingHTML()
  try {
    const canManage = hrCanManage('salary_slips')
    const params = {}
    if (_hrSlipMonth) params.month = _hrSlipMonth
    const [slipRes, usersRes] = await Promise.all([
      API.get('/salary-slips', { params }),
      canManage ? hrFetchEmployees() : Promise.resolve({ users: [] }),
    ])
    const list = slipRes.salary_slips || slipRes.data || []
    window._hrEmployees = usersRes.users || usersRes.data || []
    window._hrSlipsById = Object.fromEntries(list.map(s => [s.id, s]))

    const pagination = paginateClient(list, _hrSlipPage, 12)
    _hrSlipPage = pagination.page

    const totalPay = list.reduce((sum, s) => sum + (Number(s.net_pay) || 0), 0)

    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">${canManage ? 'Salary Slips' : 'My Salary Slips'}</h1>
          <p class="page-subtitle">${canManage ? 'Generate, view and share monthly salary slips' : 'Your monthly payslips'}</p>
        </div>
        ${canManage ? `<div class="page-actions" style="display:flex;gap:8px">
          <button class="btn btn-outline" onclick="openBulkSlipModal()"><i class="fas fa-layer-group"></i> Bulk Generate</button>
          <button class="btn btn-primary" onclick="openSlipModal()"><i class="fas fa-plus"></i> Generate Slip</button>
        </div>` : ''}
      </div>

      <div class="grid-4" style="margin-bottom:16px">
        ${miniStatCard('Slips',         list.length, '#FF7A45', 'fa-money-check-dollar')}
        ${miniStatCard('Months',        new Set(list.map(s => s.month)).size, '#FFCB47', 'fa-calendar')}
        ${miniStatCard('Total net pay', hrFmtMoney(totalPay), '#58C68A', 'fa-coins')}
        ${miniStatCard('Latest month',  list[0]?.month || '—', '#A8C8FF', 'fa-clock')}
      </div>

      <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;align-items:center">
        <div class="form-group" style="margin:0">
          <label class="form-label" style="font-size:11px;margin-bottom:2px">Month</label>
          <input id="slip-filter-month" class="form-input" type="month" value="${_hrSlipMonth}" onchange="hrSlipSetMonth(this.value)" style="height:32px"/>
        </div>
        ${_hrSlipMonth ? `<button class="btn btn-sm btn-outline" onclick="hrSlipSetMonth('')" style="align-self:flex-end">Clear</button>` : ''}
      </div>

      <div class="card"><div class="card-body" style="padding:0">
        <table class="data-table">
          <thead><tr>
            ${canManage ? '<th>Employee</th>' : ''}
            <th>Month</th><th>Gross</th><th>Deductions</th><th>Tax</th><th>Net pay</th><th style="width:140px">Actions</th>
          </tr></thead>
          <tbody>
            ${pagination.total === 0
              ? hrEmptyRow(canManage ? 7 : 6, 'fa-money-check-dollar', 'No salary slips yet.')
              : pagination.items.map(s => renderSlipRow(s, canManage)).join('')}
          </tbody>
        </table>
        ${renderPager(pagination, 'hrSlipPage', 'hrSlipPage', 'slips')}
      </div></div>`
  } catch (e) {
    el.innerHTML = hrErrorHTML(e.message)
  }
}

function renderSlipRow(s, canManage) {
  const name = s.full_name || s.email || 'Unknown'
  return `<tr>
    ${canManage ? `<td><div style="display:flex;align-items:center;gap:8px">${avatar(name, s.avatar_color, 'sm')}<span style="font-size:12.5px;color:#FFF1E6">${escapeInbox(name)}</span></div></td>` : ''}
    <td style="font-size:12.5px;color:#FFF1E6;font-weight:600">${escapeInbox(s.month)}</td>
    <td style="font-size:12px;color:#E8D2BD">${hrFmtMoney(s.gross)}</td>
    <td style="font-size:12px;color:#FF8866">${hrFmtMoney(s.deductions)}</td>
    <td style="font-size:12px;color:#FF8866">${hrFmtMoney(s.tax)}</td>
    <td style="font-size:13px;color:#86E0A8;font-weight:700">${hrFmtMoney(s.net_pay)}</td>
    <td>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="btn btn-icon btn-xs" onclick="openSlipDetail('${s.id}')" title="View"><i class="fas fa-eye"></i></button>
        ${canManage ? `<button class="btn btn-icon btn-xs" onclick="deleteSlip('${s.id}')" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
      </div>
    </td>
  </tr>`
}

function hrSlipSetMonth(m) { _hrSlipMonth = m || ''; _hrSlipPage = 1; hrReloadPage('page-hr-salary-slips') }
function hrSlipPage(p) { _hrSlipPage = Math.max(1, Number(p) || 1); hrReloadPage('page-hr-salary-slips') }

function openSlipModal() {
  if (!hrCanManage('salary_slips')) { toast('Not allowed', 'error'); return }
  const numberField = (id, label) => `<div class="form-group"><label class="form-label">${label}</label><input id="${id}" class="form-input" type="number" value="0" min="0" step="0.01"/></div>`
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-money-check-dollar" style="color:var(--accent);margin-right:6px"></i>Generate Salary Slip</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Employee *</label><select id="slip-user" class="form-select">${hrEmployeeOptions(window._hrEmployees || [])}</select></div>
        <div class="form-group"><label class="form-label">Month *</label><input id="slip-month" class="form-input" type="month" value="${hrCurrentMonthISO()}"/></div>
      </div>
      <div class="grid-2">${numberField('slip-basic','Basic')}${numberField('slip-hra','HRA')}</div>
      <div class="grid-2">${numberField('slip-allow','Allowances')}${numberField('slip-bonus','Bonus')}</div>
      <div class="grid-2">${numberField('slip-ded','Deductions')}${numberField('slip-tax','Tax')}</div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Working days</label><input id="slip-wd" class="form-input" type="number" value="0" min="0" max="31"/></div>
        <div class="form-group"><label class="form-label">Paid days</label><input id="slip-pd" class="form-input" type="number" value="0" min="0" max="31"/></div>
      </div>
      <div class="form-group" style="margin-bottom:0"><label class="form-label">Notes</label><textarea id="slip-notes" class="form-textarea" rows="2" placeholder="Optional notes for the employee"></textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitSlip()"><i class="fas fa-save"></i> Generate</button>
    </div>
  `, 'modal-lg')
}

async function submitSlip() {
  const num = id => Number(document.getElementById(id)?.value) || 0
  const payload = {
    user_id:    document.getElementById('slip-user')?.value,
    month:      document.getElementById('slip-month')?.value,
    basic:        num('slip-basic'),
    hra:          num('slip-hra'),
    allowances:   num('slip-allow'),
    bonus:        num('slip-bonus'),
    deductions:   num('slip-ded'),
    tax:          num('slip-tax'),
    working_days: num('slip-wd'),
    paid_days:    num('slip-pd'),
    notes: document.getElementById('slip-notes')?.value.trim() || null,
  }
  if (!payload.user_id || !payload.month) { toast('Employee and month are required', 'error'); return }
  try { await API.post('/salary-slips', payload); toast('Salary slip saved', 'success'); closeModal(); hrReloadPage('page-hr-salary-slips') }
  catch (e) { toast('Failed: ' + e.message, 'error') }
}

function openSlipDetail(id) {
  const s = (window._hrSlipsById || {})[id]
  if (!s) { toast('Slip not found', 'error'); return }
  const name = s.full_name || s.email || 'Unknown'
  const row = (label, val, accent) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05)"><span style="color:#9F8678;font-size:12px">${label}</span><span style="color:${accent || '#FFF1E6'};font-size:13px;font-weight:600">${val}</span></div>`
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-money-check-dollar" style="color:var(--accent);margin-right:6px"></i>Salary Slip · ${escapeInbox(s.month)}</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:12px;background:rgba(255,122,69,0.06);border:1px solid rgba(255,122,69,0.2)">
        ${avatar(name, s.avatar_color, 'md')}
        <div>
          <div style="font-size:14px;font-weight:700;color:#FFF1E6">${escapeInbox(name)}</div>
          <div style="font-size:12px;color:#9F8678">${escapeInbox(s.designation || s.email || '')}</div>
        </div>
      </div>
      <div>
        <div style="font-size:11px;color:#9F8678;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Earnings</div>
        ${row('Basic', hrFmtMoney(s.basic))}
        ${row('HRA', hrFmtMoney(s.hra))}
        ${row('Allowances', hrFmtMoney(s.allowances))}
        ${row('Bonus', hrFmtMoney(s.bonus))}
        ${row('Gross', hrFmtMoney(s.gross), '#86E0A8')}
      </div>
      <div>
        <div style="font-size:11px;color:#9F8678;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Deductions</div>
        ${row('Deductions', hrFmtMoney(s.deductions), '#FF8866')}
        ${row('Tax', hrFmtMoney(s.tax), '#FF8866')}
      </div>
      <div>
        <div style="font-size:11px;color:#9F8678;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Days</div>
        ${row('Working days', s.working_days || 0)}
        ${row('Paid days', s.paid_days || 0)}
      </div>
      <div style="padding:14px;border-radius:12px;background:rgba(88,198,138,0.08);border:1px solid rgba(88,198,138,0.3);display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:13px;color:#9F8678">Net pay</span>
        <span style="font-size:20px;font-weight:800;color:#86E0A8">${hrFmtMoney(s.net_pay)}</span>
      </div>
      ${s.notes ? `<div><div style="font-size:11px;color:#9F8678;text-transform:uppercase;margin-bottom:4px">Notes</div><div style="font-size:13px;color:#FFF1E6;padding:10px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06)">${escapeInbox(s.notes)}</div></div>` : ''}
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Close</button>
      <button class="btn btn-primary" onclick="window.print()"><i class="fas fa-print"></i> Print</button>
    </div>
  `, 'modal-lg')
}

async function deleteSlip(id) {
  if (!confirm('Delete this salary slip?')) return
  try { await API.delete('/salary-slips/' + id); toast('Deleted', 'success'); hrReloadPage('page-hr-salary-slips') }
  catch (e) { toast('Failed: ' + e.message, 'error') }
}

// ── Bulk Generate ─────────────────────────────────────────────
// Opens a table modal listing every active employee. For each row admin can
// punch in the salary components for the target month; on submit we POST one
// payload to /salary-slips/bulk and the server upserts per-employee.
//
// We pre-fill each row with the previous month's slip when one exists,
// so the common "everyone's salary is the same as last month" case becomes
// a one-click action.
async function openBulkSlipModal() {
  if (!hrCanManage('salary_slips')) { toast('Not allowed', 'error'); return }
  const targetMonth = hrCurrentMonthISO()
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-layer-group" style="color:var(--accent);margin-right:6px"></i>Bulk Generate Salary Slips</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div class="grid-2">
        <div class="form-group" style="margin:0">
          <label class="form-label">Target month *</label>
          <input id="bulk-slip-month" class="form-input" type="month" value="${targetMonth}" onchange="hrBulkSlipLoad()"/>
        </div>
        <div class="form-group" style="margin:0;display:flex;align-items:flex-end">
          <button class="btn btn-outline" onclick="hrBulkSlipLoad()" style="width:100%"><i class="fas fa-rotate"></i> Reload prev month values</button>
        </div>
      </div>
      <div id="bulk-slip-table-wrap">${hrLoadingHTML()}</div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitBulkSlips()"><i class="fas fa-save"></i> Generate All</button>
    </div>
  `, 'modal-xl')
  await hrBulkSlipLoad()
}

async function hrBulkSlipLoad() {
  const wrap = document.getElementById('bulk-slip-table-wrap')
  if (!wrap) return
  wrap.innerHTML = hrLoadingHTML()
  try {
    const month = document.getElementById('bulk-slip-month')?.value || hrCurrentMonthISO()
    const prevMonth = hrPrevMonthISO(month)
    // Pull all active employees + the previous month's slips in parallel so we
    // can pre-fill the form with last month's components.
    const [usersRes, prevSlipsRes] = await Promise.all([
      hrFetchEmployees(),
      API.get('/salary-slips', { params: { month: prevMonth } }).catch(() => ({ salary_slips: [] })),
    ])
    const users = (usersRes.users || usersRes.data || []).filter(u => Number(u.is_active) !== 0)
    const prevSlips = prevSlipsRes.salary_slips || prevSlipsRes.data || []
    const prevByUser = Object.fromEntries(prevSlips.map(s => [s.user_id, s]))

    if (users.length === 0) {
      wrap.innerHTML = `<div class="empty-state"><i class="fas fa-users"></i><p>No active employees.</p></div>`
      return
    }

    const numCell = (uid, key, val) => `<input class="bulk-slip-input form-input" data-uid="${uid}" data-key="${key}" type="number" value="${val || 0}" min="0" step="0.01" style="width:90px;padding:4px 6px;height:28px;font-size:12px"/>`

    wrap.innerHTML = `
      <div style="font-size:11px;color:#9F8678;margin-bottom:6px"><i class="fas fa-info-circle"></i> Pre-filled from ${escapeInbox(prevMonth)}. Edit any cell, then "Generate All".</div>
      <div style="max-height:50vh;overflow:auto;border-radius:8px;border:1px solid rgba(255,255,255,0.06)">
        <table class="data-table" style="font-size:12px">
          <thead><tr>
            <th>Employee</th><th>Basic</th><th>HRA</th><th>Allow.</th><th>Bonus</th><th>Ded.</th><th>Tax</th><th>Days W/P</th>
            <th><label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-weight:600"><input type="checkbox" id="bulk-slip-all" checked/> Incl.</label></th>
          </tr></thead>
          <tbody>
            ${users.map(u => {
              const p = prevByUser[u.id] || {}
              return `<tr data-uid="${u.id}">
                <td><div style="display:flex;align-items:center;gap:8px">${avatar(u.full_name || u.email || '?', u.avatar_color, 'sm')}<div style="min-width:0"><div style="font-size:12px;color:#FFF1E6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px">${escapeInbox(u.full_name || u.email)}</div><div style="font-size:10.5px;color:#9F8678">${escapeInbox(u.designation || '')}</div></div></div></td>
                <td>${numCell(u.id, 'basic', p.basic)}</td>
                <td>${numCell(u.id, 'hra', p.hra)}</td>
                <td>${numCell(u.id, 'allowances', p.allowances)}</td>
                <td>${numCell(u.id, 'bonus', p.bonus)}</td>
                <td>${numCell(u.id, 'deductions', p.deductions)}</td>
                <td>${numCell(u.id, 'tax', p.tax)}</td>
                <td><div style="display:flex;gap:2px"><input class="bulk-slip-input form-input" data-uid="${u.id}" data-key="working_days" type="number" value="${p.working_days || 0}" min="0" max="31" style="width:40px;padding:4px 6px;height:28px;font-size:12px"/><input class="bulk-slip-input form-input" data-uid="${u.id}" data-key="paid_days" type="number" value="${p.paid_days || 0}" min="0" max="31" style="width:40px;padding:4px 6px;height:28px;font-size:12px"/></div></td>
                <td style="text-align:center"><input type="checkbox" class="bulk-slip-include" data-uid="${u.id}" checked/></td>
              </tr>`
            }).join('')}
          </tbody>
        </table>
      </div>`

    // Wire the "include all" checkbox to toggle every row checkbox.
    const allCb = document.getElementById('bulk-slip-all')
    if (allCb) {
      allCb.addEventListener('change', () => {
        document.querySelectorAll('.bulk-slip-include').forEach(cb => { cb.checked = allCb.checked })
      })
    }
  } catch (e) {
    wrap.innerHTML = hrErrorHTML(e.message)
  }
}

function hrPrevMonthISO(month) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

async function submitBulkSlips() {
  const month = document.getElementById('bulk-slip-month')?.value
  if (!month) { toast('Pick a month', 'error'); return }

  // Group inputs by user_id, only for rows whose include-checkbox is checked.
  const includedUids = new Set(
    Array.from(document.querySelectorAll('.bulk-slip-include')).filter(cb => cb.checked).map(cb => cb.dataset.uid),
  )
  if (includedUids.size === 0) { toast('Select at least one employee', 'error'); return }

  const byUser = {}
  document.querySelectorAll('.bulk-slip-input').forEach(input => {
    const uid = input.dataset.uid
    if (!includedUids.has(uid)) return
    if (!byUser[uid]) byUser[uid] = { user_id: uid }
    byUser[uid][input.dataset.key] = Number(input.value) || 0
  })
  const entries = Object.values(byUser)

  try {
    const res = await API.post('/salary-slips/bulk', { month, entries })
    const d = res.data || {}
    const failed = (d.errors || []).length
    toast(`Done · ${d.inserted || 0} new, ${d.updated || 0} updated${failed ? ', ' + failed + ' failed' : ''}`, failed ? 'info' : 'success')
    closeModal(); hrReloadPage('page-hr-salary-slips')
  } catch (e) { toast('Failed: ' + e.message, 'error') }
}
