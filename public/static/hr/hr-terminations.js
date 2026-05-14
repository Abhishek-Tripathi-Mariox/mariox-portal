// HR · Terminations
// Backed by /api/terminations. Manage permission: hr.terminations.manage.
// Marking a termination "completed" deactivates the user account on the server.

let _hrTermPage = 1
let _hrTermStatus = ''

const TERM_STATUS_BADGE = {
  initiated:     '<span class="badge badge-yellow">Initiated</span>',
  notice_period: '<span class="badge badge-blue">Notice period</span>',
  completed:     '<span class="badge badge-red">Completed</span>',
  cancelled:     '<span class="badge">Cancelled</span>',
}

async function renderTerminationsView(el) {
  el.innerHTML = hrLoadingHTML()
  try {
    const canManage = hrCanManage('terminations')
    const [termRes, usersRes] = await Promise.all([
      API.get('/terminations'),
      canManage ? hrFetchEmployees() : Promise.resolve({ users: [] }),
    ])
    const list = termRes.terminations || termRes.data || []
    window._hrEmployees = usersRes.users || usersRes.data || []
    window._hrTermsById = Object.fromEntries(list.map(t => [t.id, t]))

    const filtered = _hrTermStatus ? list.filter(t => t.status === _hrTermStatus) : list
    const pagination = paginateClient(filtered, _hrTermPage, 12)
    _hrTermPage = pagination.page

    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">${canManage ? 'Terminations' : 'My Termination'}</h1>
          <p class="page-subtitle">${canManage ? 'Track offboarding and exit records' : 'Your exit record (if any)'}</p>
        </div>
        ${canManage ? `<div class="page-actions">
          <button class="btn btn-primary" onclick="openTermModal()"><i class="fas fa-plus"></i> Record Termination</button>
        </div>` : ''}
      </div>

      <div class="grid-4" style="margin-bottom:16px">
        ${miniStatCard('Total',         list.length, '#FF7A45', 'fa-user-slash')}
        ${miniStatCard('Initiated',     list.filter(t => t.status === 'initiated').length, '#FFCB47', 'fa-hourglass-half')}
        ${miniStatCard('Notice period', list.filter(t => t.status === 'notice_period').length, '#A8C8FF', 'fa-stopwatch')}
        ${miniStatCard('Completed',     list.filter(t => t.status === 'completed').length, '#FF5E3A', 'fa-check')}
      </div>

      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        ${hrFilterButtons([
          { value: '',              label: 'All',       activeStyle: 'background:rgba(255,122,69,.15);color:#FFB347' },
          { value: 'initiated',     label: 'Initiated', activeStyle: 'background:rgba(255,203,71,.15);color:#FFD986' },
          { value: 'notice_period', label: 'Notice',    activeStyle: 'background:rgba(100,160,255,.15);color:#A8C8FF' },
          { value: 'completed',     label: 'Completed', activeStyle: 'background:rgba(255,94,58,.15);color:#FF8866' },
          { value: 'cancelled',     label: 'Cancelled', activeStyle: 'background:rgba(255,255,255,.07)' },
        ], _hrTermStatus, 'hrTermSetStatus')}
      </div>

      <div class="card"><div class="card-body" style="padding:0">
        <table class="data-table">
          <thead><tr>
            ${canManage ? '<th>Employee</th>' : ''}
            <th>Type</th><th>Notice date</th><th>Termination date</th><th>Status</th><th style="width:140px">Actions</th>
          </tr></thead>
          <tbody>
            ${pagination.total === 0
              ? hrEmptyRow(canManage ? 6 : 5, 'fa-user-slash', 'No termination records.')
              : pagination.items.map(t => renderTermRow(t, canManage)).join('')}
          </tbody>
        </table>
        ${renderPager(pagination, 'hrTermPage', 'hrTermPage', 'records')}
      </div></div>`
  } catch (e) {
    el.innerHTML = hrErrorHTML(e.message)
  }
}

function renderTermRow(t, canManage) {
  const name = t.full_name || t.email || 'Unknown'
  return `<tr>
    ${canManage ? `<td><div style="display:flex;align-items:center;gap:8px">${avatar(name, t.avatar_color, 'sm')}<span style="font-size:12.5px;color:#FFF1E6">${escapeInbox(name)}</span></div></td>` : ''}
    <td><span class="badge badge-blue">${escapeInbox((t.termination_type || '').replace('_',' '))}</span></td>
    <td style="font-size:12px;color:#9F8678">${t.notice_date ? fmtDate(t.notice_date) : '—'}</td>
    <td style="font-size:12px;color:#9F8678">${fmtDate(t.termination_date)}</td>
    <td>${TERM_STATUS_BADGE[t.status] || `<span class="badge">${escapeInbox(t.status)}</span>`}</td>
    <td>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="btn btn-icon btn-xs" onclick="openTermDetail('${t.id}')" title="View"><i class="fas fa-eye"></i></button>
        ${canManage ? `<button class="btn btn-icon btn-xs" onclick="deleteTerm('${t.id}')" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
      </div>
    </td>
  </tr>`
}

function hrTermSetStatus(s) { _hrTermStatus = s || ''; _hrTermPage = 1; hrReloadPage('page-hr-terminations') }
function hrTermPage(p) { _hrTermPage = Math.max(1, Number(p) || 1); hrReloadPage('page-hr-terminations') }

function openTermModal() {
  if (!hrCanManage('terminations')) { toast('Not allowed', 'error'); return }
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-user-slash" style="color:#FF8866;margin-right:6px"></i>Record Termination</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div class="form-group"><label class="form-label">Employee *</label><select id="term-user" class="form-select">${hrEmployeeOptions(window._hrEmployees || [])}</select></div>
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Type *</label>
          <select id="term-type" class="form-select">
            <option value="resignation">Resignation</option>
            <option value="dismissal">Dismissal</option>
            <option value="layoff">Layoff</option>
            <option value="retirement">Retirement</option>
            <option value="contract_end">Contract end</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Status</label>
          <select id="term-status" class="form-select">
            <option value="initiated">Initiated</option>
            <option value="notice_period">Notice period</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Notice date</label><input id="term-notice" class="form-input" type="date"/></div>
        <div class="form-group"><label class="form-label">Termination date *</label><input id="term-date" class="form-input" type="date" value="${hrTodayISO()}"/></div>
      </div>
      <div class="form-group"><label class="form-label">Reason *</label><textarea id="term-reason" class="form-textarea" rows="3" placeholder="Why is this employee leaving?"></textarea></div>
      <div class="form-group"><label class="form-label">Handover notes</label><textarea id="term-handover" class="form-textarea" rows="2" placeholder="Open tasks, replacements, knowledge transfer"></textarea></div>
      <div class="form-group" style="margin-bottom:0"><label class="form-label">Exit notes</label><textarea id="term-exit" class="form-textarea" rows="2" placeholder="Feedback from exit interview"></textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitTerm()"><i class="fas fa-save"></i> Save</button>
    </div>
  `, 'modal-lg')
}

async function submitTerm() {
  const payload = {
    user_id:          document.getElementById('term-user')?.value,
    termination_type: document.getElementById('term-type')?.value,
    status:           document.getElementById('term-status')?.value,
    notice_date:      document.getElementById('term-notice')?.value || null,
    termination_date: document.getElementById('term-date')?.value,
    reason:           document.getElementById('term-reason')?.value.trim(),
    handover_notes:   document.getElementById('term-handover')?.value.trim() || null,
    exit_notes:       document.getElementById('term-exit')?.value.trim() || null,
  }
  if (!payload.user_id || !payload.termination_date || !payload.reason) {
    toast('Employee, date and reason are required', 'error'); return
  }
  try { await API.post('/terminations', payload); toast('Termination recorded', 'success'); closeModal(); hrReloadPage('page-hr-terminations') }
  catch (e) { toast('Failed: ' + e.message, 'error') }
}

// Standardized offboarding checklist. Order matters — items at the top are
// usually completed first. Keys must match the server's allow-list in
// terminations.ts (PATCH /:id/checklist).
const TERM_CHECKLIST_ITEMS = [
  { key: 'access_revoked',       label: 'Email / system access revoked' },
  { key: 'laptop_returned',      label: 'Laptop / hardware returned' },
  { key: 'nda_signed',           label: 'Exit NDA / non-compete signed' },
  { key: 'handover_done',        label: 'Knowledge transfer / handover completed' },
  { key: 'exit_interview_done',  label: 'Exit interview conducted' },
  { key: 'dues_cleared',         label: 'Reimbursements / dues cleared' },
  { key: 'final_settlement_paid',label: 'Full & final settlement paid' },
]

function _renderTermChecklist(t, canManage) {
  const current = (t && typeof t.checklist === 'object' && t.checklist) ? t.checklist : {}
  const completed = TERM_CHECKLIST_ITEMS.filter(it => current[it.key]).length
  const total = TERM_CHECKLIST_ITEMS.length
  const pct = total ? Math.round((completed / total) * 100) : 0
  return `
    <div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div style="font-size:11px;color:#9F8678;text-transform:uppercase;letter-spacing:.5px">Exit checklist</div>
        <div style="font-size:11px;color:#9F8678">${completed} / ${total} · ${pct}%</div>
      </div>
      <div style="height:6px;background:rgba(255,255,255,0.05);border-radius:6px;overflow:hidden;margin-bottom:10px">
        <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#FF7A45,#86E0A8);transition:width .3s"></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;padding:10px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06)">
        ${TERM_CHECKLIST_ITEMS.map(it => {
          const checked = !!current[it.key]
          const fontStyle = checked ? 'color:#86E0A8;text-decoration:line-through' : 'color:#FFF1E6'
          if (canManage) {
            return `<label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:4px 2px">
              <input type="checkbox" class="term-checklist-cb" data-key="${it.key}" ${checked ? 'checked' : ''}/>
              <span style="font-size:13px;${fontStyle}">${escapeInbox(it.label)}</span>
            </label>`
          }
          return `<div style="display:flex;align-items:center;gap:10px;padding:4px 2px">
            <i class="fas fa-${checked ? 'check-square' : 'square'}" style="color:${checked ? '#86E0A8' : '#9F8678'};width:14px"></i>
            <span style="font-size:13px;${fontStyle}">${escapeInbox(it.label)}</span>
          </div>`
        }).join('')}
      </div>
      ${canManage ? `<button class="btn btn-sm btn-outline" onclick="saveTermChecklist('${t.id}')" style="margin-top:8px"><i class="fas fa-save"></i> Save checklist</button>` : ''}
    </div>`
}

async function saveTermChecklist(id) {
  const checklist = {}
  document.querySelectorAll('.term-checklist-cb').forEach(cb => { checklist[cb.dataset.key] = cb.checked })
  try {
    await API.patch('/terminations/' + id + '/checklist', { checklist })
    toast('Checklist saved', 'success')
    // Update the cached row so the modal re-renders with the new state next time.
    if (window._hrTermsById && window._hrTermsById[id]) window._hrTermsById[id].checklist = checklist
  } catch (e) { toast('Failed: ' + e.message, 'error') }
}

function openTermDetail(id) {
  const t = (window._hrTermsById || {})[id]
  if (!t) { toast('Record not found', 'error'); return }
  const name = t.full_name || t.email || 'Unknown'
  const canManage = hrCanManage('terminations')
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-user-slash" style="color:#FF8866;margin-right:6px"></i>Termination</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:12px;background:rgba(255,122,69,0.06);border:1px solid rgba(255,122,69,0.2)">
        ${avatar(name, t.avatar_color, 'md')}
        <div>
          <div style="font-size:14px;font-weight:700;color:#FFF1E6">${escapeInbox(name)}</div>
          <div style="font-size:12px;color:#9F8678">${escapeInbox(t.designation || t.email || '')}</div>
        </div>
        <div style="margin-left:auto">${TERM_STATUS_BADGE[t.status] || ''}</div>
      </div>
      <div class="grid-2">
        <div><div style="font-size:11px;color:#9F8678;text-transform:uppercase">Type</div><div style="font-size:13px;color:#FFF1E6">${escapeInbox((t.termination_type || '').replace('_',' '))}</div></div>
        <div><div style="font-size:11px;color:#9F8678;text-transform:uppercase">Termination date</div><div style="font-size:13px;color:#FFF1E6">${fmtDate(t.termination_date)}</div></div>
        ${t.notice_date ? `<div><div style="font-size:11px;color:#9F8678;text-transform:uppercase">Notice date</div><div style="font-size:13px;color:#FFF1E6">${fmtDate(t.notice_date)}</div></div>` : ''}
        ${t.initiated_by_name ? `<div><div style="font-size:11px;color:#9F8678;text-transform:uppercase">Initiated by</div><div style="font-size:13px;color:#FFF1E6">${escapeInbox(t.initiated_by_name)}</div></div>` : ''}
      </div>
      <div><div style="font-size:11px;color:#9F8678;text-transform:uppercase;margin-bottom:4px">Reason</div><div style="font-size:13px;color:#FFF1E6;padding:10px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06)">${escapeInbox(t.reason)}</div></div>
      ${t.handover_notes ? `<div><div style="font-size:11px;color:#9F8678;text-transform:uppercase;margin-bottom:4px">Handover</div><div style="font-size:13px;color:#FFF1E6;padding:10px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06)">${escapeInbox(t.handover_notes)}</div></div>` : ''}
      ${t.exit_notes ? `<div><div style="font-size:11px;color:#9F8678;text-transform:uppercase;margin-bottom:4px">Exit notes</div><div style="font-size:13px;color:#FFF1E6;padding:10px;border-radius:8px;background:rgba(255,122,69,0.05);border:1px solid rgba(255,122,69,0.18)">${escapeInbox(t.exit_notes)}</div></div>` : ''}
      ${_renderTermChecklist(t, canManage)}
      ${canManage ? `
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">Update status</label>
          <select id="term-new-status" class="form-select">
            ${['initiated','notice_period','completed','cancelled'].map(s => `<option value="${s}"${t.status===s?' selected':''}>${s.replace('_',' ')}</option>`).join('')}
          </select>
          <div style="font-size:11px;color:#9F8678;margin-top:4px"><i class="fas fa-info-circle"></i> Marking as <b>completed</b> will deactivate the user account.</div>
        </div>` : ''}
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Close</button>
      ${canManage ? `<button class="btn btn-primary" onclick="updateTerm('${t.id}')"><i class="fas fa-save"></i> Save</button>` : ''}
    </div>
  `, 'modal-lg')
}

async function updateTerm(id) {
  const status = document.getElementById('term-new-status')?.value
  if (status === 'completed' && !confirm('Marking as completed will deactivate the employee. Continue?')) return
  try { await API.patch('/terminations/' + id, { status }); toast('Updated', 'success'); closeModal(); hrReloadPage('page-hr-terminations') }
  catch (e) { toast('Failed: ' + e.message, 'error') }
}

async function deleteTerm(id) {
  if (!confirm('Delete this termination record?')) return
  try { await API.delete('/terminations/' + id); toast('Deleted', 'success'); hrReloadPage('page-hr-terminations') }
  catch (e) { toast('Failed: ' + e.message, 'error') }
}
