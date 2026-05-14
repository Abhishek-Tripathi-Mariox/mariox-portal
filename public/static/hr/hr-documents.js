// HR · Documents (letter generator)
// Backed by /api/hr-documents. Manage permission: hr.documents.manage.
// Stores the parameters used to generate offer letters, experience
// certificates, salary certificates, etc. The actual letter text is
// rendered client-side from those parameters so wording can be tweaked
// without touching the backend.

let _hrDocPage = 1
let _hrDocType = ''

const DOC_TYPE_LABEL = {
  offer_letter: 'Offer Letter',
  experience_certificate: 'Experience Certificate',
  salary_certificate: 'Salary Certificate',
  appointment_letter: 'Appointment Letter',
  relieving_letter: 'Relieving Letter',
}
const DOC_TYPE_ICON = {
  offer_letter: 'fa-file-signature',
  experience_certificate: 'fa-award',
  salary_certificate: 'fa-file-invoice-dollar',
  appointment_letter: 'fa-file-contract',
  relieving_letter: 'fa-door-open',
}

async function renderHrDocumentsView(el) {
  el.innerHTML = hrLoadingHTML()
  try {
    const canManage = hrCanManage('documents')
    const [docRes, usersRes] = await Promise.all([
      API.get('/hr-documents'),
      canManage ? hrFetchEmployees() : Promise.resolve({ users: [] }),
    ])
    const list = docRes.documents || docRes.data || []
    window._hrEmployees = usersRes.users || usersRes.data || []
    window._hrDocsById = Object.fromEntries(list.map(d => [d.id, d]))

    const filtered = _hrDocType ? list.filter(d => d.document_type === _hrDocType) : list
    const pagination = paginateClient(filtered, _hrDocPage, 12)
    _hrDocPage = pagination.page

    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">${canManage ? 'HR Documents' : 'My Documents'}</h1>
          <p class="page-subtitle">${canManage ? 'Generate offer letters, experience and salary certificates' : 'Letters and certificates issued to you'}</p>
        </div>
        ${canManage ? `<div class="page-actions">
          <button class="btn btn-primary" onclick="openDocModal()"><i class="fas fa-plus"></i> Generate Document</button>
        </div>` : ''}
      </div>

      <div class="grid-4" style="margin-bottom:16px">
        ${miniStatCard('Total',                   list.length, '#FF7A45', 'fa-folder-open')}
        ${miniStatCard('Offer letters',           list.filter(d => d.document_type === 'offer_letter').length, '#FFCB47', 'fa-file-signature')}
        ${miniStatCard('Experience certs',        list.filter(d => d.document_type === 'experience_certificate').length, '#58C68A', 'fa-award')}
        ${miniStatCard('Salary certs',            list.filter(d => d.document_type === 'salary_certificate').length, '#A8C8FF', 'fa-file-invoice-dollar')}
      </div>

      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        ${hrFilterButtons([
          { value: '',                        label: 'All',         activeStyle: 'background:rgba(255,122,69,.15);color:#FFB347' },
          { value: 'offer_letter',            label: 'Offer',       activeStyle: 'background:rgba(255,203,71,.15);color:#FFD986' },
          { value: 'experience_certificate',  label: 'Experience',  activeStyle: 'background:rgba(88,198,138,.15);color:#86E0A8' },
          { value: 'salary_certificate',      label: 'Salary',      activeStyle: 'background:rgba(100,160,255,.15);color:#A8C8FF' },
          { value: 'appointment_letter',      label: 'Appointment', activeStyle: 'background:rgba(255,150,80,.15);color:#FFC089' },
          { value: 'relieving_letter',        label: 'Relieving',   activeStyle: 'background:rgba(255,94,58,.15);color:#FF8866' },
        ], _hrDocType, 'hrDocSetType')}
      </div>

      <div class="card"><div class="card-body" style="padding:0">
        <table class="data-table">
          <thead><tr>
            ${canManage ? '<th>Employee</th>' : ''}
            <th>Type</th><th>Issued</th><th>Signed by</th>${canManage ? '<th style="width:140px">Actions</th>' : '<th style="width:80px">Actions</th>'}
          </tr></thead>
          <tbody>
            ${pagination.total === 0
              ? hrEmptyRow(canManage ? 5 : 4, 'fa-folder-open', 'No documents generated yet.')
              : pagination.items.map(d => renderDocRow(d, canManage)).join('')}
          </tbody>
        </table>
        ${renderPager(pagination, 'hrDocPage', 'hrDocPage', 'documents')}
      </div></div>`
  } catch (e) {
    el.innerHTML = hrErrorHTML(e.message)
  }
}

function renderDocRow(d, canManage) {
  const name = d.full_name || d.email || 'Unknown'
  return `<tr>
    ${canManage ? `<td><div style="display:flex;align-items:center;gap:8px">${avatar(name, d.avatar_color, 'sm')}<span style="font-size:12.5px;color:#FFF1E6">${escapeInbox(name)}</span></div></td>` : ''}
    <td><span class="badge badge-blue"><i class="fas ${DOC_TYPE_ICON[d.document_type] || 'fa-file'}"></i> ${escapeInbox(DOC_TYPE_LABEL[d.document_type] || d.document_type)}</span></td>
    <td style="font-size:12px;color:#9F8678">${fmtDate(d.issued_date)}</td>
    <td style="font-size:12px;color:#E8D2BD">${escapeInbox(d.signed_by || '—')}${d.signed_title ? `<div style="font-size:11px;color:#9F8678">${escapeInbox(d.signed_title)}</div>` : ''}</td>
    <td>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="btn btn-icon btn-xs" onclick="openDocPreview('${d.id}')" title="Preview / Print"><i class="fas fa-eye"></i></button>
        ${canManage ? `<button class="btn btn-icon btn-xs" onclick="deleteDoc('${d.id}')" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
      </div>
    </td>
  </tr>`
}

function hrDocSetType(t) { _hrDocType = t || ''; _hrDocPage = 1; hrReloadPage('page-hr-documents') }
function hrDocPage(p) { _hrDocPage = Math.max(1, Number(p) || 1); hrReloadPage('page-hr-documents') }

function openDocModal() {
  if (!hrCanManage('documents')) { toast('Not allowed', 'error'); return }
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-file-signature" style="color:var(--accent);margin-right:6px"></i>Generate Document</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Employee *</label>
          <select id="doc-user" class="form-select">${hrEmployeeOptions(window._hrEmployees || [])}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Document type *</label>
          <select id="doc-type" class="form-select" onchange="hrDocRenderFields()">
            ${Object.keys(DOC_TYPE_LABEL).map(k => `<option value="${k}">${DOC_TYPE_LABEL[k]}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Issued date *</label><input id="doc-issued" class="form-input" type="date" value="${hrTodayISO()}"/></div>
        <div class="form-group"><label class="form-label">Signed by</label><input id="doc-signed-by" class="form-input" placeholder="HR Manager name"/></div>
      </div>
      <div class="form-group">
        <label class="form-label">Signatory title</label>
        <input id="doc-signed-title" class="form-input" placeholder="e.g. Head of HR"/>
      </div>
      <div id="doc-extra-fields"></div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">Internal notes</label>
        <textarea id="doc-notes" class="form-textarea" rows="2" placeholder="Optional, not shown on the letter"></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitDoc()"><i class="fas fa-save"></i> Generate</button>
    </div>
  `, 'modal-lg')
  hrDocRenderFields()
}

// Per-type extra fields. Keeping them in code (not data-driven) so each
// document type's required inputs are explicit and reviewable.
function hrDocRenderFields() {
  const type = document.getElementById('doc-type')?.value
  const wrap = document.getElementById('doc-extra-fields')
  if (!wrap) return
  if (type === 'offer_letter' || type === 'appointment_letter') {
    wrap.innerHTML = `
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Designation *</label><input id="doc-x-designation" class="form-input" placeholder="e.g. Senior Engineer"/></div>
        <div class="form-group"><label class="form-label">Joining date *</label><input id="doc-x-joining" class="form-input" type="date"/></div>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Annual CTC *</label><input id="doc-x-ctc" class="form-input" type="number" min="0" step="1000" placeholder="e.g. 1200000"/></div>
        <div class="form-group"><label class="form-label">Location</label><input id="doc-x-location" class="form-input" placeholder="e.g. Mumbai office"/></div>
      </div>`
  } else if (type === 'experience_certificate' || type === 'relieving_letter') {
    wrap.innerHTML = `
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Designation at exit *</label><input id="doc-x-designation" class="form-input"/></div>
        <div class="form-group"><label class="form-label">Department</label><input id="doc-x-department" class="form-input"/></div>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">From *</label><input id="doc-x-from" class="form-input" type="date"/></div>
        <div class="form-group"><label class="form-label">To *</label><input id="doc-x-to" class="form-input" type="date"/></div>
      </div>`
  } else if (type === 'salary_certificate') {
    wrap.innerHTML = `
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Designation *</label><input id="doc-x-designation" class="form-input"/></div>
        <div class="form-group"><label class="form-label">Annual CTC *</label><input id="doc-x-ctc" class="form-input" type="number" min="0" step="1000"/></div>
      </div>
      <div class="form-group"><label class="form-label">Reason / purpose</label><input id="doc-x-purpose" class="form-input" placeholder="e.g. Bank loan application"/></div>`
  } else {
    wrap.innerHTML = ''
  }
}

function _getVal(id) { return document.getElementById(id)?.value.trim() || '' }

async function submitDoc() {
  const type = _getVal('doc-type')
  const payload = {
    user_id: _getVal('doc-user'),
    document_type: type,
    issued_date: _getVal('doc-issued'),
    signed_by: _getVal('doc-signed-by') || null,
    signed_title: _getVal('doc-signed-title') || null,
    notes: _getVal('doc-notes') || null,
    payload: {},
  }
  if (type === 'offer_letter' || type === 'appointment_letter') {
    payload.payload = {
      designation: _getVal('doc-x-designation'),
      joining_date: _getVal('doc-x-joining'),
      ctc: Number(_getVal('doc-x-ctc')) || 0,
      location: _getVal('doc-x-location') || null,
    }
    if (!payload.payload.designation || !payload.payload.joining_date || !payload.payload.ctc) {
      toast('Designation, joining date and CTC are required', 'error'); return
    }
  } else if (type === 'experience_certificate' || type === 'relieving_letter') {
    payload.payload = {
      designation: _getVal('doc-x-designation'),
      department: _getVal('doc-x-department') || null,
      from_date: _getVal('doc-x-from'),
      to_date: _getVal('doc-x-to'),
    }
    if (!payload.payload.designation || !payload.payload.from_date || !payload.payload.to_date) {
      toast('Designation and date range are required', 'error'); return
    }
  } else if (type === 'salary_certificate') {
    payload.payload = {
      designation: _getVal('doc-x-designation'),
      ctc: Number(_getVal('doc-x-ctc')) || 0,
      purpose: _getVal('doc-x-purpose') || null,
    }
    if (!payload.payload.designation || !payload.payload.ctc) {
      toast('Designation and CTC are required', 'error'); return
    }
  }
  if (!payload.user_id || !payload.issued_date) { toast('Employee and date are required', 'error'); return }
  try {
    await API.post('/hr-documents', payload)
    toast('Document generated', 'success'); closeModal(); hrReloadPage('page-hr-documents')
  } catch (e) { toast('Failed: ' + e.message, 'error') }
}

// Preview / Print — render the letter body from the stored payload. The
// generated HTML is plain printable text styled for white background so
// `window.print()` produces a clean letterhead-friendly page.
function openDocPreview(id) {
  const d = (window._hrDocsById || {})[id]
  if (!d) { toast('Document not found', 'error'); return }
  showModal(`
    <div class="modal-header">
      <h3><i class="fas ${DOC_TYPE_ICON[d.document_type] || 'fa-file'}" style="color:var(--accent);margin-right:6px"></i>${DOC_TYPE_LABEL[d.document_type] || 'Document'}</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:0;background:#fdfdf8">
      <div id="doc-print-area" style="padding:40px;color:#111;font-family:Georgia, serif;line-height:1.55;font-size:14px;min-height:60vh">
        ${renderDocBody(d)}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Close</button>
      <button class="btn btn-primary" onclick="hrDocPrint()"><i class="fas fa-print"></i> Print</button>
    </div>
  `, 'modal-lg')
}

function hrDocPrint() {
  const area = document.getElementById('doc-print-area')
  if (!area) { window.print(); return }
  // Open a clean print window so we don't drag the dark app chrome with us.
  const w = window.open('', '_blank', 'width=820,height=900')
  if (!w) { toast('Pop-up blocked — allow pop-ups to print', 'error'); return }
  w.document.write(`<!doctype html><html><head><title>Document</title>
    <style>body{font-family:Georgia,serif;color:#111;padding:40px;line-height:1.55;font-size:14px;max-width:780px;margin:0 auto}
      h2{margin-top:0;font-size:20px;text-align:center;text-transform:uppercase;letter-spacing:1px}
      .meta{color:#555;font-size:12px;margin-bottom:24px}
      .sign{margin-top:60px}
    </style></head><body>${area.innerHTML}</body></html>`)
  w.document.close()
  // Give the new window a tick to render before triggering print.
  setTimeout(() => { w.focus(); w.print() }, 200)
}

function renderDocBody(d) {
  const p = d.payload || {}
  const name = d.full_name || '[Employee Name]'
  const designation = p.designation || '[Designation]'
  const fmt = (iso) => iso ? fmtDate(iso) : '[Date]'
  const fmtMoney = (n) => hrFmtMoney(n || 0)
  const signature = `
    <div class="sign">
      <div>Sincerely,</div>
      <div style="margin-top:30px;font-weight:700">${escapeInbox(d.signed_by || '[Signatory]')}</div>
      <div style="font-size:12px;color:#555">${escapeInbox(d.signed_title || '')}</div>
    </div>`
  const header = `<div class="meta">Issued on ${fmt(d.issued_date)}</div>`

  if (d.document_type === 'offer_letter' || d.document_type === 'appointment_letter') {
    const title = d.document_type === 'offer_letter' ? 'Offer of Employment' : 'Appointment Letter'
    return `
      <h2>${title}</h2>
      ${header}
      <p>Dear ${escapeInbox(name)},</p>
      <p>We are pleased to offer you the position of <b>${escapeInbox(designation)}</b>${p.location ? ' at our ' + escapeInbox(p.location) : ''}. Your employment will commence on <b>${fmt(p.joining_date)}</b>, subject to the terms and conditions of the company.</p>
      <p>Your annual cost-to-company (CTC) will be <b>₹ ${fmtMoney(p.ctc)}</b>, inclusive of all statutory components and benefits. Detailed compensation structure will be shared on joining.</p>
      <p>You will be expected to abide by the company's policies, code of conduct, and any other rules that may be amended from time to time. This letter, together with the subsequent employment agreement, constitutes the complete understanding between you and the company.</p>
      <p>We look forward to your acceptance and to a long and rewarding association with you.</p>
      ${signature}`
  }
  if (d.document_type === 'experience_certificate' || d.document_type === 'relieving_letter') {
    const title = d.document_type === 'experience_certificate' ? 'Experience Certificate' : 'Relieving Letter'
    return `
      <h2>${title}</h2>
      ${header}
      <p>To whomsoever it may concern,</p>
      <p>This is to certify that <b>${escapeInbox(name)}</b> was employed with our organization in the position of <b>${escapeInbox(designation)}</b>${p.department ? ', ' + escapeInbox(p.department) + ' department' : ''} from <b>${fmt(p.from_date)}</b> to <b>${fmt(p.to_date)}</b>.</p>
      <p>During the tenure with us, we found ${escapeInbox(name)} to be sincere, hard-working, and professional in conduct. We wish them the very best in all future endeavours.</p>
      ${signature}`
  }
  if (d.document_type === 'salary_certificate') {
    return `
      <h2>Salary Certificate</h2>
      ${header}
      <p>To whomsoever it may concern,</p>
      <p>This is to certify that <b>${escapeInbox(name)}</b> is presently employed with our organization as <b>${escapeInbox(designation)}</b> and is in receipt of an annual cost-to-company of <b>₹ ${fmtMoney(p.ctc)}</b>.</p>
      ${p.purpose ? `<p>This certificate is being issued at the employee's request for the purpose of <b>${escapeInbox(p.purpose)}</b>.</p>` : `<p>This certificate is being issued at the employee's request for whatever purpose it may serve.</p>`}
      ${signature}`
  }
  return `<p>${escapeInbox(JSON.stringify(p))}</p>${signature}`
}

async function deleteDoc(id) {
  if (!confirm('Delete this document?')) return
  try { await API.delete('/hr-documents/' + id); toast('Deleted', 'success'); hrReloadPage('page-hr-documents') }
  catch (e) { toast('Failed: ' + e.message, 'error') }
}
