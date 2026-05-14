// HR · Warnings
// Backed by /api/warnings. Manage permission: hr.warnings.manage.
// Employees without manage permission see only their own warnings, can
// acknowledge them, and never see the Issue/Delete controls.

let _hrWarnPage = 1
let _hrWarnSeverity = ''

const WARN_BADGE = {
  verbal:  '<span class="badge badge-yellow">Verbal</span>',
  written: '<span class="badge" style="background:rgba(255,150,80,.15);color:#FFC089">Written</span>',
  final:   '<span class="badge badge-red">Final</span>',
}

async function renderWarningsView(el) {
  el.innerHTML = hrLoadingHTML()
  try {
    const canManage = hrCanManage('warnings')
    const [warnRes, usersRes] = await Promise.all([
      API.get('/warnings'),
      canManage ? hrFetchEmployees() : Promise.resolve({ users: [] }),
    ])
    const list = warnRes.warnings || warnRes.data || []
    window._hrEmployees = usersRes.users || usersRes.data || []
    window._hrWarningsById = Object.fromEntries(list.map(w => [w.id, w]))

    const filtered = _hrWarnSeverity ? list.filter(w => w.severity === _hrWarnSeverity) : list
    const pagination = paginateClient(filtered, _hrWarnPage, 12)
    _hrWarnPage = pagination.page

    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">${canManage ? 'Warnings' : 'My Warnings'}</h1>
          <p class="page-subtitle">${canManage ? 'Issue and track disciplinary warnings' : 'Warnings issued to you — acknowledge after review'}</p>
        </div>
        ${canManage ? `<div class="page-actions">
          <button class="btn btn-primary" onclick="openWarningModal()"><i class="fas fa-plus"></i> Issue Warning</button>
        </div>` : ''}
      </div>

      <div class="grid-4" style="margin-bottom:16px">
        ${miniStatCard('Total',   list.length, '#FF7A45', 'fa-triangle-exclamation')}
        ${miniStatCard('Verbal',  list.filter(w => w.severity === 'verbal').length, '#FFCB47', 'fa-comment-dots')}
        ${miniStatCard('Written', list.filter(w => w.severity === 'written').length, '#FFA94D', 'fa-file-pen')}
        ${miniStatCard('Final',   list.filter(w => w.severity === 'final').length, '#FF5E3A', 'fa-fire')}
      </div>

      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        ${hrFilterButtons([
          { value: '',        label: 'All',     activeStyle: 'background:rgba(255,122,69,.15);color:#FFB347' },
          { value: 'verbal',  label: 'Verbal',  activeStyle: 'background:rgba(255,203,71,.15);color:#FFD986' },
          { value: 'written', label: 'Written', activeStyle: 'background:rgba(255,169,77,.15);color:#FFC089' },
          { value: 'final',   label: 'Final',   activeStyle: 'background:rgba(255,94,58,.15);color:#FF8866' },
        ], _hrWarnSeverity, 'hrWarnSetSev')}
      </div>

      <div class="card"><div class="card-body" style="padding:0">
        <table class="data-table">
          <thead><tr>
            ${canManage ? '<th>Employee</th>' : ''}
            <th>Severity</th><th>Subject</th><th>Date</th><th>Status</th><th style="width:140px">Actions</th>
          </tr></thead>
          <tbody>
            ${pagination.total === 0
              ? hrEmptyRow(canManage ? 6 : 5, 'fa-triangle-exclamation', 'No warnings yet.')
              : pagination.items.map(w => renderWarningRow(w, canManage)).join('')}
          </tbody>
        </table>
        ${renderPager(pagination, 'hrWarnPage', 'hrWarnPage', 'warnings')}
      </div></div>`
  } catch (e) {
    el.innerHTML = hrErrorHTML(e.message)
  }
}

function renderWarningRow(w, canManage) {
  const name = w.full_name || w.email || 'Unknown'
  return `<tr>
    ${canManage ? `<td><div style="display:flex;align-items:center;gap:8px">${avatar(name, w.avatar_color, 'sm')}<span style="font-size:12.5px;color:#FFF1E6">${escapeInbox(name)}</span></div></td>` : ''}
    <td>${WARN_BADGE[w.severity] || `<span class="badge">${escapeInbox(w.severity)}</span>`}</td>
    <td style="font-size:12.5px;color:#FFF1E6;font-weight:600">${escapeInbox(w.subject)}</td>
    <td style="font-size:12px;color:#9F8678">${fmtDate(w.warning_date)}</td>
    <td>${Number(w.acknowledged) === 1 ? '<span class="badge badge-green">Acknowledged</span>' : '<span class="badge badge-yellow">Pending</span>'}</td>
    <td>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="btn btn-icon btn-xs" onclick="openWarningDetail('${w.id}')" title="View"><i class="fas fa-eye"></i></button>
        ${canManage ? `<button class="btn btn-icon btn-xs" onclick="deleteWarning('${w.id}')" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
      </div>
    </td>
  </tr>`
}

function hrWarnSetSev(s) { _hrWarnSeverity = s || ''; _hrWarnPage = 1; hrReloadPage('page-hr-warnings') }
function hrWarnPage(p) { _hrWarnPage = Math.max(1, Number(p) || 1); hrReloadPage('page-hr-warnings') }

function openWarningModal() {
  if (!hrCanManage('warnings')) { toast('Not allowed', 'error'); return }
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-triangle-exclamation" style="color:#FF8866;margin-right:6px"></i>Issue Warning</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div class="form-group"><label class="form-label">Employee *</label><select id="warn-user" class="form-select">${hrEmployeeOptions(window._hrEmployees || [])}</select></div>
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Severity *</label>
          <select id="warn-sev" class="form-select">
            <option value="verbal">Verbal</option><option value="written">Written</option><option value="final">Final</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">Date *</label><input id="warn-date" class="form-input" type="date" value="${hrTodayISO()}"/></div>
      </div>
      <div class="form-group"><label class="form-label">Subject *</label><input id="warn-subject" class="form-input" placeholder="Short summary"/></div>
      <div class="form-group"><label class="form-label">Description *</label><textarea id="warn-desc" class="form-textarea" rows="4" placeholder="What happened and when"></textarea></div>
      <div class="form-group" style="margin-bottom:0"><label class="form-label">Action required</label><textarea id="warn-action" class="form-textarea" rows="2" placeholder="Expected corrective action"></textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitWarning()"><i class="fas fa-paper-plane"></i> Issue</button>
    </div>
  `, 'modal-lg')
}

async function submitWarning() {
  const payload = {
    user_id:         document.getElementById('warn-user')?.value,
    severity:        document.getElementById('warn-sev')?.value,
    warning_date:    document.getElementById('warn-date')?.value,
    subject:         document.getElementById('warn-subject')?.value.trim(),
    description:     document.getElementById('warn-desc')?.value.trim(),
    action_required: document.getElementById('warn-action')?.value.trim() || null,
  }
  if (!payload.user_id || !payload.subject || !payload.description) { toast('Employee, subject and description are required', 'error'); return }
  try { await API.post('/warnings', payload); toast('Warning issued', 'success'); closeModal(); hrReloadPage('page-hr-warnings') }
  catch (e) { toast('Failed: ' + e.message, 'error') }
}

function openWarningDetail(id) {
  const w = (window._hrWarningsById || {})[id]
  if (!w) { toast('Warning not found', 'error'); return }
  const myId = _user?.sub || _user?.id
  const isRecipient = w.user_id === myId
  const canAck = isRecipient && Number(w.acknowledged) !== 1
  // Recipient can write/update their response any time. Once submitted we
  // still show the form (read-only-ish) so they can edit clarifications.
  const canRespond = isRecipient
  const name = w.full_name || w.email || 'Unknown'

  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-triangle-exclamation" style="color:#FF8866;margin-right:6px"></i>Warning</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:12px;background:rgba(255,122,69,0.06);border:1px solid rgba(255,122,69,0.2)">
        ${avatar(name, w.avatar_color, 'md')}
        <div>
          <div style="font-size:14px;font-weight:700;color:#FFF1E6">${escapeInbox(name)}</div>
          <div style="font-size:12px;color:#9F8678">${escapeInbox(w.designation || w.email || '')}</div>
        </div>
        <div style="margin-left:auto">${WARN_BADGE[w.severity] || ''}</div>
      </div>
      <div><div style="font-size:11px;color:#9F8678;text-transform:uppercase">Subject</div><div style="font-size:14px;color:#FFF1E6;font-weight:600">${escapeInbox(w.subject)}</div></div>
      <div><div style="font-size:11px;color:#9F8678;text-transform:uppercase;margin-bottom:4px">Description</div><div style="font-size:13px;color:#FFF1E6;padding:10px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06)">${escapeInbox(w.description)}</div></div>
      ${w.action_required ? `<div><div style="font-size:11px;color:#9F8678;text-transform:uppercase;margin-bottom:4px">Action required</div><div style="font-size:13px;color:#FFF1E6;padding:10px;border-radius:8px;background:rgba(255,122,69,0.05);border:1px solid rgba(255,122,69,0.18)">${escapeInbox(w.action_required)}</div></div>` : ''}

      ${w.response ? `
        <div>
          <div style="font-size:11px;color:#9F8678;text-transform:uppercase;margin-bottom:4px">Employee response${w.responded_at ? ' · ' + fmtDate(w.responded_at) : ''}</div>
          <div style="font-size:13px;color:#FFF1E6;padding:10px;border-radius:8px;background:rgba(88,198,138,0.06);border:1px solid rgba(88,198,138,0.2)">${escapeInbox(w.response)}</div>
        </div>` : ''}

      ${canRespond ? `
        <div>
          <div style="font-size:11px;color:#9F8678;text-transform:uppercase;margin-bottom:4px">${w.response ? 'Update your response' : 'Your response'}</div>
          <textarea id="warn-response" class="form-textarea" rows="4" placeholder="Explain your side, agree / disagree, or share corrective steps you're taking…">${escapeInbox(w.response || '')}</textarea>
        </div>` : ''}

      <div style="font-size:12px;color:#9F8678">
        Issued ${fmtDate(w.warning_date)}${w.issued_by_name ? ' by ' + escapeInbox(w.issued_by_name) : ''}
        ${Number(w.acknowledged) === 1 && w.acknowledged_at ? ' · Acknowledged ' + fmtDate(w.acknowledged_at) : ''}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Close</button>
      ${canAck ? `<button class="btn btn-success" onclick="ackWarning('${w.id}')"><i class="fas fa-check"></i> Acknowledge</button>` : ''}
      ${canRespond ? `<button class="btn btn-primary" onclick="submitWarningResponse('${w.id}')"><i class="fas fa-paper-plane"></i> ${w.response ? 'Update response' : 'Submit response'}</button>` : ''}
    </div>
  `, 'modal-lg')
}

async function submitWarningResponse(id) {
  const response = document.getElementById('warn-response')?.value.trim() || ''
  if (!response) { toast('Type your response first', 'error'); return }
  try {
    await API.patch('/warnings/' + id + '/respond', { response })
    toast('Response submitted', 'success')
    // Update the cached row so a re-render reflects the new state immediately.
    if (window._hrWarningsById && window._hrWarningsById[id]) {
      window._hrWarningsById[id].response = response
      window._hrWarningsById[id].responded_at = new Date().toISOString()
      window._hrWarningsById[id].acknowledged = 1
    }
    closeModal()
    hrReloadPage('page-hr-warnings')
  } catch (e) { toast('Failed: ' + e.message, 'error') }
}

async function ackWarning(id) {
  try { await API.patch('/warnings/' + id + '/acknowledge', {}); toast('Acknowledged', 'success'); closeModal(); hrReloadPage('page-hr-warnings') }
  catch (e) { toast('Failed: ' + e.message, 'error') }
}

async function deleteWarning(id) {
  if (!confirm('Delete this warning?')) return
  try { await API.delete('/warnings/' + id); toast('Deleted', 'success'); hrReloadPage('page-hr-warnings') }
  catch (e) { toast('Failed: ' + e.message, 'error') }
}
