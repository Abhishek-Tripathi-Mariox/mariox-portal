// HR · Performance Improvement Plans
// Backed by /api/pips. Manage permission: hr.pips.manage.

let _hrPipPage = 1
let _hrPipStatus = ''

const PIP_STATUS_BADGE = {
  draft:     '<span class="badge">Draft</span>',
  active:    '<span class="badge badge-yellow">Active</span>',
  completed: '<span class="badge badge-green">Completed</span>',
  extended:  '<span class="badge badge-blue">Extended</span>',
  failed:    '<span class="badge badge-red">Failed</span>',
  cancelled: '<span class="badge">Cancelled</span>',
}

async function renderPipsView(el) {
  el.innerHTML = hrLoadingHTML()
  try {
    const canManage = hrCanManage('pips')
    const [pipRes, usersRes] = await Promise.all([
      API.get('/pips'),
      canManage ? hrFetchEmployees() : Promise.resolve({ users: [] }),
    ])
    const list = pipRes.pips || pipRes.data || []
    window._hrEmployees = usersRes.users || usersRes.data || []
    window._hrPipsById = Object.fromEntries(list.map(p => [p.id, p]))

    const filtered = _hrPipStatus ? list.filter(p => p.status === _hrPipStatus) : list
    const pagination = paginateClient(filtered, _hrPipPage, 12)
    _hrPipPage = pagination.page

    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">${canManage ? 'Performance Improvement Plans' : 'My PIPs'}</h1>
          <p class="page-subtitle">${canManage ? 'Create and manage PIPs for under-performing employees' : 'PIPs assigned to you'}</p>
        </div>
        ${canManage ? `<div class="page-actions">
          <button class="btn btn-primary" onclick="openPipModal()"><i class="fas fa-plus"></i> New PIP</button>
        </div>` : ''}
      </div>

      <div class="grid-4" style="margin-bottom:16px">
        ${miniStatCard('Total',     list.length, '#FF7A45', 'fa-clipboard-list')}
        ${miniStatCard('Active',    list.filter(p => p.status === 'active').length, '#FFCB47', 'fa-bolt')}
        ${miniStatCard('Completed', list.filter(p => p.status === 'completed').length, '#58C68A', 'fa-check-circle')}
        ${miniStatCard('Failed',    list.filter(p => p.status === 'failed').length, '#FF5E3A', 'fa-circle-xmark')}
      </div>

      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        ${hrFilterButtons([
          { value: '',          label: 'All',       activeStyle: 'background:rgba(255,122,69,.15);color:#FFB347' },
          { value: 'active',    label: 'Active',    activeStyle: 'background:rgba(255,203,71,.15);color:#FFD986' },
          { value: 'completed', label: 'Completed', activeStyle: 'background:rgba(88,198,138,.15);color:#86E0A8' },
          { value: 'failed',    label: 'Failed',    activeStyle: 'background:rgba(255,94,58,.15);color:#FF8866' },
          { value: 'cancelled', label: 'Cancelled', activeStyle: 'background:rgba(255,255,255,.07)' },
        ], _hrPipStatus, 'hrPipSetStatus')}
      </div>

      <div class="card"><div class="card-body" style="padding:0">
        <table class="data-table">
          <thead><tr>
            ${canManage ? '<th>Employee</th>' : ''}
            <th>Title</th><th>From</th><th>To</th><th>Status</th><th style="width:160px">Actions</th>
          </tr></thead>
          <tbody>
            ${pagination.total === 0
              ? hrEmptyRow(canManage ? 6 : 5, 'fa-clipboard-list', 'No PIPs yet.')
              : pagination.items.map(p => renderPipRow(p, canManage)).join('')}
          </tbody>
        </table>
        ${renderPager(pagination, 'hrPipPage', 'hrPipPage', 'PIPs')}
      </div></div>`
  } catch (e) {
    el.innerHTML = hrErrorHTML(e.message)
  }
}

function renderPipRow(p, canManage) {
  const name = p.full_name || p.email || 'Unknown'
  return `<tr>
    ${canManage ? `<td><div style="display:flex;align-items:center;gap:8px">${avatar(name, p.avatar_color, 'sm')}<span style="font-size:12.5px;color:#FFF1E6">${escapeInbox(name)}</span></div></td>` : ''}
    <td style="font-size:12.5px;color:#FFF1E6;font-weight:600">${escapeInbox(p.title)}</td>
    <td style="font-size:12px;color:#9F8678">${fmtDate(p.start_date)}</td>
    <td style="font-size:12px;color:#9F8678">${fmtDate(p.end_date)}</td>
    <td>${PIP_STATUS_BADGE[p.status] || `<span class="badge">${escapeInbox(p.status)}</span>`}</td>
    <td>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="btn btn-icon btn-xs" onclick="openPipDetail('${p.id}')" title="View"><i class="fas fa-eye"></i></button>
        ${canManage ? `<button class="btn btn-icon btn-xs" onclick="deletePip('${p.id}')" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
      </div>
    </td>
  </tr>`
}

function hrPipSetStatus(s) { _hrPipStatus = s || ''; _hrPipPage = 1; hrReloadPage('page-hr-pips') }
function hrPipPage(p) { _hrPipPage = Math.max(1, Number(p) || 1); hrReloadPage('page-hr-pips') }

function openPipModal() {
  if (!hrCanManage('pips')) { toast('Not allowed', 'error'); return }
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-clipboard-list" style="color:var(--accent);margin-right:6px"></i>New PIP</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div class="form-group"><label class="form-label">Employee *</label>${hrEmployeePicker('pip-user', window._hrEmployees || [])}</div>
      <div class="form-group"><label class="form-label">Title *</label><input id="pip-title" class="form-input" placeholder="e.g. Q2 Performance Improvement Plan"/></div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Start date *</label><input id="pip-from" class="form-input" type="date" value="${hrTodayISO()}"/></div>
        <div class="form-group"><label class="form-label">End date *</label><input id="pip-to" class="form-input" type="date"/></div>
      </div>
      <div class="form-group"><label class="form-label">Reason *</label><textarea id="pip-reason" class="form-textarea" rows="3" placeholder="Why is this employee being placed on a PIP?"></textarea></div>
      <div class="form-group"><label class="form-label">Expectations *</label><textarea id="pip-exp" class="form-textarea" rows="3" placeholder="Specific, measurable expectations"></textarea></div>
      <div class="form-group" style="margin-bottom:0"><label class="form-label">Support plan</label><textarea id="pip-support" class="form-textarea" rows="2" placeholder="What the company / manager will provide"></textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitPip()"><i class="fas fa-save"></i> Create</button>
    </div>
  `, 'modal-lg')
}

async function submitPip() {
  const payload = {
    user_id:      document.getElementById('pip-user')?.value,
    title:        document.getElementById('pip-title')?.value.trim(),
    start_date:   document.getElementById('pip-from')?.value,
    end_date:     document.getElementById('pip-to')?.value,
    reason:       document.getElementById('pip-reason')?.value.trim(),
    expectations: document.getElementById('pip-exp')?.value.trim(),
    support_plan: document.getElementById('pip-support')?.value.trim() || null,
  }
  if (!payload.user_id || !payload.title || !payload.start_date || !payload.end_date || !payload.reason || !payload.expectations) {
    toast('Employee, title, dates, reason and expectations are required', 'error'); return
  }
  try { await API.post('/pips', payload); toast('PIP created', 'success'); closeModal(); hrReloadPage('page-hr-pips') }
  catch (e) { toast('Failed: ' + e.message, 'error') }
}

function openPipDetail(id) {
  const p = (window._hrPipsById || {})[id]
  if (!p) { toast('PIP not found', 'error'); return }
  const canManage = hrCanManage('pips')
  const name = p.full_name || p.email || 'Unknown'
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-clipboard-list" style="color:var(--accent);margin-right:6px"></i>Performance Improvement Plan</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:12px;background:rgba(255,122,69,0.06);border:1px solid rgba(255,122,69,0.2)">
        ${avatar(name, p.avatar_color, 'md')}
        <div>
          <div style="font-size:14px;font-weight:700;color:#FFF1E6">${escapeInbox(name)}</div>
          <div style="font-size:12px;color:#9F8678">${escapeInbox(p.designation || p.email || '')}</div>
        </div>
        <div style="margin-left:auto">${PIP_STATUS_BADGE[p.status] || ''}</div>
      </div>
      <div><div style="font-size:11px;color:#9F8678;text-transform:uppercase">Title</div><div style="font-size:14px;color:#FFF1E6;font-weight:600">${escapeInbox(p.title)}</div></div>
      <div class="grid-2">
        <div><div style="font-size:11px;color:#9F8678;text-transform:uppercase">Start</div><div style="font-size:13px;color:#FFF1E6">${fmtDate(p.start_date)}</div></div>
        <div><div style="font-size:11px;color:#9F8678;text-transform:uppercase">End</div><div style="font-size:13px;color:#FFF1E6">${fmtDate(p.end_date)}</div></div>
      </div>
      <div><div style="font-size:11px;color:#9F8678;text-transform:uppercase;margin-bottom:4px">Reason</div><div style="font-size:13px;color:#FFF1E6;padding:10px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06)">${escapeInbox(p.reason)}</div></div>
      <div><div style="font-size:11px;color:#9F8678;text-transform:uppercase;margin-bottom:4px">Expectations</div><div style="font-size:13px;color:#FFF1E6;padding:10px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06)">${escapeInbox(p.expectations)}</div></div>
      ${p.support_plan ? `<div><div style="font-size:11px;color:#9F8678;text-transform:uppercase;margin-bottom:4px">Support plan</div><div style="font-size:13px;color:#FFF1E6;padding:10px;border-radius:8px;background:rgba(88,198,138,0.06);border:1px solid rgba(88,198,138,0.2)">${escapeInbox(p.support_plan)}</div></div>` : ''}
      ${p.outcome ? `<div><div style="font-size:11px;color:#9F8678;text-transform:uppercase;margin-bottom:4px">Outcome</div><div style="font-size:13px;color:#FFF1E6;padding:10px;border-radius:8px;background:rgba(255,122,69,0.05);border:1px solid rgba(255,122,69,0.18)">${escapeInbox(p.outcome)}</div></div>` : ''}
      ${canManage ? `
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">Update status</label>
          <select id="pip-new-status" class="form-select">
            ${['active','completed','extended','failed','cancelled'].map(s => `<option value="${s}"${p.status===s?' selected':''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">Outcome note</label>
          <textarea id="pip-outcome" class="form-textarea" rows="2" placeholder="Optional final note">${escapeInbox(p.outcome || '')}</textarea>
        </div>` : ''}
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Close</button>
      ${canManage ? `<button class="btn btn-primary" onclick="updatePip('${p.id}')"><i class="fas fa-save"></i> Save</button>` : ''}
    </div>
  `, 'modal-lg')
}

async function updatePip(id) {
  const status = document.getElementById('pip-new-status')?.value
  const outcome = document.getElementById('pip-outcome')?.value.trim() || null
  try { await API.patch('/pips/' + id, { status, outcome }); toast('PIP updated', 'success'); closeModal(); hrReloadPage('page-hr-pips') }
  catch (e) { toast('Failed: ' + e.message, 'error') }
}

async function deletePip(id) {
  if (!confirm('Delete this PIP?')) return
  try { await API.delete('/pips/' + id); toast('Deleted', 'success'); hrReloadPage('page-hr-pips') }
  catch (e) { toast('Failed: ' + e.message, 'error') }
}
