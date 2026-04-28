// ═══════════════════════════════════════════════════════════
// enterprise2.js  – Documents, Timesheets, Reports, Alerts, Settings
// ═══════════════════════════════════════════════════════════

let _documentsCenterPage = 1
let _timesheetsViewPage = 1
let _alertsViewPage = 1
let _holidaysPage = 1
let _alertsSeverityFilter = ''

/* ── DOCUMENTS CENTER ──────────────────────────────────── */
async function renderDocumentsCenter(el) {
  el.innerHTML = `<div style="padding:40px;text-align:center;color:#64748b"><i class="fas fa-spinner fa-spin" style="font-size:24px"></i></div>`
  try {
    const [docsData, projectsData] = await Promise.all([
      API.get('/documents'),
      API.get('/projects')
    ])
    const docs = docsData.documents || []
    const projects = projectsData.projects || projectsData || []
    const categories = docsData.categories || ['sow','brd','frd','uiux','wireframes','meeting_notes','technical','test_report','release','billing','contract','other']
    _documentsCenterPage = 1

    const categoryLabels = {
      sow:'Statement of Work', brd:'Business Requirements', frd:'Functional Requirements',
      uiux:'UI/UX Design', wireframes:'Wireframes', meeting_notes:'Meeting Notes',
      technical:'Technical Docs', test_report:'Test Reports', release:'Release Notes',
      billing:'Billing', contract:'Contracts', other:'Other'
    }

    let filterProject = '', filterCategory = '', filterSearch = ''

    function buildDocGrid(filteredDocs) {
      if (filteredDocs.length === 0) return '<div class="empty-state"><i class="fas fa-folder-open"></i><p>No documents found</p></div>'
      const byCat = {}
      filteredDocs.forEach(d => { const c = d.category||'other'; if(!byCat[c]) byCat[c]=[]; byCat[c].push(d) })
      return Object.entries(byCat).map(([cat, catDocs]) => `
        <div style="margin-bottom:24px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #2A1812">
            <span style="font-size:18px">${docCategoryIcon(cat)}</span>
            <span style="font-size:13px;font-weight:600;color:#e2e8f0">${categoryLabels[cat]||cat}</span>
            <span style="background:#2A1812;color:#94a3b8;font-size:10px;padding:2px 7px;border-radius:10px">${catDocs.length}</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px">
            ${catDocs.map(doc => `
              <div class="card" style="padding:14px;transition:.2s" onmouseover="this.style.borderColor='${docCategoryColor(doc.category)}'" onmouseout="this.style.borderColor='#2A1812'">
                <div style="display:flex;align-items:flex-start;gap:10px">
                  <div style="width:36px;height:36px;border-radius:8px;background:${docCategoryColor(doc.category)};display:flex;align-items:center;justify-content:center;flex-shrink:0">
                    <i class="fas ${docFTypeIcon(doc.file_type)}" style="color:#fff;font-size:14px"></i>
                  </div>
                  <div style="flex:1;min-width:0">
                    <div style="font-size:13px;font-weight:600;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${doc.title}</div>
                    <div style="font-size:11px;color:#64748b;margin-top:2px">${doc.project_name||'—'} • v${doc.version||'1.0'}</div>
                    ${doc.description ? `<div style="font-size:11px;color:#94a3b8;margin-top:4px;line-height:1.4">${doc.description.substring(0,60)}${doc.description.length>60?'…':''}</div>` : ''}
                    <div style="display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap">
                      <span style="font-size:10px;color:#64748b"><i class="fas fa-user" style="margin-right:3px"></i>${doc.uploaded_by_name||'—'}</span>
                      <span style="font-size:10px;color:#64748b"><i class="fas fa-clock" style="margin-right:3px"></i>${fmtDate(doc.created_at)}</span>
                      <span class="badge ${doc.visibility==='all'?'badge-done':doc.visibility==='client'?'badge-inprogress':'badge-review'}" style="font-size:9px">${doc.visibility||'all'}</span>
                    </div>
                  </div>
                </div>
                <div style="display:flex;gap:6px;margin-top:12px">
                  <a href="${doc.file_url||'#'}" target="_blank" class="btn btn-sm btn-outline" style="flex:1;text-align:center;text-decoration:none">
                    <i class="fas fa-eye"></i>View
                  </a>
                  <a href="${doc.file_url||'#'}" download class="btn btn-sm btn-primary" style="flex:1;text-align:center;text-decoration:none">
                    <i class="fas fa-download"></i>Download
                  </a>
                  ${['admin','pm'].includes(_user.role) ? `<button class="btn btn-sm btn-outline" onclick="deleteDoc('${doc.id}')" style="color:#FF5E3A;border-color:#FF5E3A"><i class="fas fa-trash"></i></button>` : ''}
                </div>
              </div>`).join('')}
          </div>
        </div>`).join('')
    }

    function renderFilteredDocs(filteredDocs) {
      const pagination = paginateClient(filteredDocs, _documentsCenterPage, 8)
      _documentsCenterPage = pagination.page
      const grid = document.getElementById('doc-grid')
      const pager = document.getElementById('doc-pager')
      if (grid) grid.innerHTML = buildDocGrid(pagination.items)
      if (pager) pager.innerHTML = renderPager(pagination, 'goDocumentsCenterPage', 'goDocumentsCenterPage', 'documents')
    }

    function applyFilter() {
      let filtered = docs
      if (filterProject) filtered = filtered.filter(d => d.project_id === filterProject)
      if (filterCategory) filtered = filtered.filter(d => d.category === filterCategory)
      if (filterSearch) filtered = filtered.filter(d => d.title.toLowerCase().includes(filterSearch) || (d.description||'').toLowerCase().includes(filterSearch))
      renderFilteredDocs(filtered)
    }

    el.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Document Center</h1><p class="page-subtitle">${docs.length} documents across all projects</p></div>
      <div class="page-actions">
        ${['admin','pm'].includes(_user.role) ? `<button class="btn btn-primary" onclick="showUploadDocModal()"><i class="fas fa-upload"></i>Upload Document</button>` : ''}
      </div>
    </div>

    <!-- Filters -->
    <div class="card" style="padding:14px;margin-bottom:16px">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <input class="form-input" placeholder="Search documents…" oninput="window._docFilter=this.value.toLowerCase();applyDocFilter()" style="width:100%"/>
        </div>
        <select class="form-select" style="min-width:180px" onchange="window._docProject=this.value;applyDocFilter()">
          <option value="">All Projects</option>
          ${projects.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}
        </select>
        <select class="form-select" style="min-width:160px" onchange="window._docCategory=this.value;applyDocFilter()">
          <option value="">All Categories</option>
          ${categories.map(c=>`<option value="${c}">${categoryLabels[c]||c}</option>`).join('')}
        </select>
      </div>
    </div>

    <div id="doc-grid"></div>
    <div id="doc-pager"></div>`

    // Store filter state globally
    window._allDocs = docs
    window._docFilter = ''
    window._docProject = ''
    window._docCategory = ''
    window._docPage = 1
    window.applyDocFilter = function() {
      _documentsCenterPage = 1
      let filtered = window._allDocs
      if (window._docProject) filtered = filtered.filter(d => d.project_id === window._docProject)
      if (window._docCategory) filtered = filtered.filter(d => d.category === window._docCategory)
      if (window._docFilter) filtered = filtered.filter(d => d.title.toLowerCase().includes(window._docFilter) || (d.description||'').toLowerCase().includes(window._docFilter))
      renderFilteredDocs(filtered)
    }
    window.goDocumentsCenterPage = function(page) {
      _documentsCenterPage = Math.max(1, Number(page) || 1)
      window.applyDocFilter()
    }
    window.applyDocFilter()

  } catch(e) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Failed: ${e.message}</p></div>`
  }
}

function docFTypeIcon(type) {
  if (!type) return 'fa-file-alt'
  if (type.includes('pdf')) return 'fa-file-pdf'
  if (type.includes('word') || type.includes('doc')) return 'fa-file-word'
  if (type.includes('sheet') || type.includes('excel') || type.includes('xls')) return 'fa-file-excel'
  if (type.includes('ppt')) return 'fa-file-powerpoint'
  if (type.includes('image') || type.includes('png') || type.includes('jpg')) return 'fa-file-image'
  if (type.includes('zip') || type.includes('rar')) return 'fa-file-archive'
  return 'fa-file-alt'
}

async function showUploadDocModal() {
  const projData = await API.get('/projects')
  const projects = projData.projects || projData || []
  const catOpts = [
    {v:'sow',l:'Statement of Work'}, {v:'brd',l:'Business Requirements'}, {v:'frd',l:'Functional Requirements'},
    {v:'uiux',l:'UI/UX Design'}, {v:'wireframes',l:'Wireframes'}, {v:'meeting_notes',l:'Meeting Notes'},
    {v:'technical',l:'Technical Docs'}, {v:'test_report',l:'Test Reports'}, {v:'release',l:'Release Notes'},
    {v:'billing',l:'Billing'}, {v:'contract',l:'Contracts'}, {v:'other',l:'Other'}
  ]
  showModal(`
  <div class="modal-header"><h3>Upload Document</h3><button class="close-btn" onclick="closeModal()">✕</button></div>
  <div class="modal-body">
    <div class="form-row">
      <div class="form-group"><label class="form-label">Project *</label>
        <select class="form-select" id="ud-project"><option value="">Select…</option>${projects.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Category *</label>
        <select class="form-select" id="ud-category">${catOpts.map(c=>`<option value="${c.v}">${c.l}</option>`).join('')}</select></div>
    </div>
    <div class="form-group"><label class="form-label">Document Title *</label><input class="form-input" id="ud-title" placeholder="e.g., Sprint 2 - SRS Document"/></div>
    <div class="form-group"><label class="form-label">Description</label><textarea class="form-textarea" id="ud-desc" style="min-height:60px" placeholder="Brief description…"></textarea></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">File URL (Google Drive, S3, etc.) *</label><input class="form-input" id="ud-url" placeholder="https://drive.google.com/file/…"/></div>
      <div class="form-group"><label class="form-label">File Name *</label><input class="form-input" id="ud-filename" placeholder="document.pdf"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">File Type</label><input class="form-input" id="ud-filetype" placeholder="application/pdf"/></div>
      <div class="form-group"><label class="form-label">Version</label><input class="form-input" id="ud-version" value="1.0" placeholder="1.0"/></div>
    </div>
    <div class="form-group"><label class="form-label">Visibility</label>
      <select class="form-select" id="ud-visibility">
        <option value="all">All (Internal + Client)</option>
        <option value="client">Client Visible Only</option>
        <option value="internal">Internal Only</option>
      </select>
    </div>
    <div class="form-group"><label class="form-label">Tags (comma separated)</label><input class="form-input" id="ud-tags" placeholder="sow, phase1, delivery"/></div>
  </div>
  <div class="modal-footer">
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="doUploadDoc()"><i class="fas fa-upload"></i>Upload Document</button>
  </div>`, 'modal-lg')
}

async function doUploadDoc() {
  const body = {
    project_id: document.getElementById('ud-project')?.value,
    title: document.getElementById('ud-title')?.value.trim(),
    description: document.getElementById('ud-desc')?.value.trim(),
    category: document.getElementById('ud-category')?.value,
    file_url: document.getElementById('ud-url')?.value.trim(),
    file_name: document.getElementById('ud-filename')?.value.trim(),
    file_type: document.getElementById('ud-filetype')?.value.trim(),
    version: document.getElementById('ud-version')?.value.trim() || '1.0',
    visibility: document.getElementById('ud-visibility')?.value,
    is_client_visible: document.getElementById('ud-visibility')?.value !== 'internal' ? 1 : 0,
    tags: document.getElementById('ud-tags')?.value.split(',').map(t=>t.trim()).filter(Boolean)
  }
  if (!body.project_id || !body.title || !body.file_url || !body.file_name)
    return toast('Fill all required fields', 'error')
  try {
    await API.post('/documents', body)
    toast('Document uploaded!', 'success')
    closeModal()
    const docEl = document.getElementById('page-documents-center'); if (docEl) { docEl.dataset.loaded=''; renderDocumentsCenter(docEl) }
  } catch(e) { toast(e.message, 'error') }
}

async function deleteDoc(id) {
  if (!confirm('Delete this document?')) return
  try { await API.delete('/documents/' + id); toast('Deleted', 'success')
    const docEl = document.getElementById('page-documents-center'); if (docEl) { docEl.dataset.loaded=''; renderDocumentsCenter(docEl) } }
  catch(e) { toast(e.message, 'error') }
}

/* ── TIMESHEETS VIEW ───────────────────────────────────── */
async function renderTimesheetsView(el) {
  el.innerHTML = `<div style="padding:40px;text-align:center;color:#64748b"><i class="fas fa-spinner fa-spin" style="font-size:24px"></i></div>`
  try {
    const [projData, userData] = await Promise.all([
      API.get('/projects'),
      _user.role !== 'developer' ? API.get('/users') : Promise.resolve({ users: [] })
    ])
    const projects = projData.projects || projData || []
    const allUsers = userData.users || []
    const devs = allUsers.filter(u => ['developer','pm'].includes(u.role))
    const isManager = ['admin','pm'].includes(_user.role)
    const today = dayjs().format('YYYY-MM-DD')
    const monthStart = dayjs().startOf('month').format('YYYY-MM-DD')

    el.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Timesheet Log</h1><p class="page-subtitle">Track and manage daily work entries</p></div>
      <div class="page-actions">
        <button class="btn btn-primary" onclick="showLogTimeModal()"><i class="fas fa-plus"></i>Log Time</button>
        <button class="btn btn-outline" onclick="exportTimesheetCSV()"><i class="fas fa-download"></i>Export CSV</button>
      </div>
    </div>

    <!-- Quick Log Form (collapsed by default) -->
    <div id="ts-quick-form" style="display:none;margin-bottom:16px">
      <div class="card" style="padding:20px">
        <div style="display:flex;justify-content:space-between;margin-bottom:14px">
          <h3 style="font-size:14px;font-weight:600;color:#e2e8f0;margin:0"><i class="fas fa-plus" style="color:#FF7A45;margin-right:8px"></i>New Time Entry</h3>
          <button onclick="document.getElementById('ts-quick-form').style.display='none'" style="background:none;border:none;color:#64748b;cursor:pointer">✕</button>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Date *</label><input class="form-input" id="ts-date" type="date" value="${today}"/></div>
          <div class="form-group"><label class="form-label">Hours *</label><input class="form-input" id="ts-hours" type="number" step="0.5" min="0.5" max="16" value="8" placeholder="8.0"/></div>
        </div>
        ${isManager && devs.length > 0 ? `<div class="form-group"><label class="form-label">Developer</label><select class="form-select" id="ts-user"><option value="">Self</option>${devs.map(d=>`<option value="${d.id}">${d.full_name}</option>`).join('')}</select></div>` : ''}
        <div class="form-row">
          <div class="form-group"><label class="form-label">Project *</label>
            <select class="form-select" id="ts-project"><option value="">Select Project…</option>${projects.map(p=>`<option value="${p.id}">${p.name} (${p.code})</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">Module/Feature</label><input class="form-input" id="ts-module" placeholder="Authentication, Dashboard…"/></div>
        </div>
        <div class="form-group"><label class="form-label">Task Description *</label><textarea class="form-textarea" id="ts-task" style="min-height:70px" placeholder="Describe what you worked on…"></textarea></div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Status</label>
            <select class="form-select" id="ts-status" onchange="document.getElementById('ts-blocker-row').style.display=this.value==='blocked'?'':'none'">
              <option value="in_progress">In Progress</option><option value="completed">Completed</option><option value="blocked">Blocked</option>
            </select></div>
          <div class="form-group"><label class="form-label">Billable</label>
            <select class="form-select" id="ts-billable"><option value="1">Yes (Billable)</option><option value="0">No (Non-Billable)</option></select></div>
        </div>
        <div id="ts-blocker-row" class="form-group" style="display:none"><label class="form-label">Blocker Details</label><textarea class="form-textarea" id="ts-blocker" style="min-height:50px" placeholder="Describe the blocker…"></textarea></div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-outline" onclick="document.getElementById('ts-quick-form').style.display='none'">Cancel</button>
          <button class="btn btn-primary" onclick="submitTsEntry()"><i class="fas fa-save"></i>Submit Entry</button>
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="card" style="padding:14px;margin-bottom:16px">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <div class="form-group" style="margin:0;flex:1;min-width:160px">
          <label class="form-label" style="margin-bottom:4px">From</label>
          <input class="form-input" type="date" id="ts-from" value="${monthStart}" onchange="loadTimesheetData()"/>
        </div>
        <div class="form-group" style="margin:0;flex:1;min-width:160px">
          <label class="form-label" style="margin-bottom:4px">To</label>
          <input class="form-input" type="date" id="ts-to" value="${today}" onchange="loadTimesheetData()"/>
        </div>
        <div class="form-group" style="margin:0;flex:1;min-width:160px">
          <label class="form-label" style="margin-bottom:4px">Project</label>
          <select class="form-select" id="ts-filter-proj" onchange="loadTimesheetData()">
            <option value="">All Projects</option>${projects.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}
          </select>
        </div>
        ${isManager ? `<div class="form-group" style="margin:0;flex:1;min-width:160px">
          <label class="form-label" style="margin-bottom:4px">Developer</label>
          <select class="form-select" id="ts-filter-dev" onchange="loadTimesheetData()">
            <option value="">All Developers</option>${devs.map(d=>`<option value="${d.id}">${d.full_name}</option>`).join('')}
          </select>
        </div>` : ''}
        <div class="form-group" style="margin:0;flex:1;min-width:140px">
          <label class="form-label" style="margin-bottom:4px">Status</label>
          <select class="form-select" id="ts-filter-status" onchange="loadTimesheetData()">
            <option value="">All Status</option><option value="pending">Pending Approval</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Summary cards -->
    <div id="ts-summary" class="grid-4" style="margin-bottom:16px"></div>

    <!-- Table -->
    <div class="card">
      <div class="card-header">
        <span style="font-weight:600">Time Entries</span>
        ${isManager ? `<div style="display:flex;gap:8px"><button class="btn btn-sm btn-outline" onclick="bulkApproveTsSelected()"><i class="fas fa-check"></i>Approve Selected</button></div>` : ''}
      </div>
      <div class="card-body" style="padding:0">
        <div id="ts-table-wrap"><div style="padding:24px;text-align:center;color:#64748b"><i class="fas fa-spinner fa-spin"></i> Loading…</div></div>
      </div>
    </div>`

    loadTimesheetData()

  } catch(e) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>`
  }
}

function showLogTimeModal() {
  const form = document.getElementById('ts-quick-form')
  if (form) { form.style.display = 'block'; form.scrollIntoView({ behavior: 'smooth' }) }
}

async function loadTimesheetData() {
  const from = document.getElementById('ts-from')?.value
  const to = document.getElementById('ts-to')?.value
  const projId = document.getElementById('ts-filter-proj')?.value
  const devId = document.getElementById('ts-filter-dev')?.value
  const status = document.getElementById('ts-filter-status')?.value
  const isManager = ['admin','pm'].includes(_user.role)

  let url = '/timesheets?'
  if (from) url += 'from=' + from + '&'
  if (to) url += 'to=' + to + '&'
  if (projId) url += 'project_id=' + projId + '&'
  if (devId) url += 'user_id=' + devId + '&'
  else if (!isManager) url += 'user_id=' + (_user.sub || _user.id) + '&'
  if (status) url += 'approval_status=' + status + '&'

  const wrap = document.getElementById('ts-table-wrap')
  const summaryEl = document.getElementById('ts-summary')
  if (wrap) wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#64748b"><i class="fas fa-spinner fa-spin"></i></div>'

  try {
    const data = await API.get(url.replace(/&$/, ''))
    const logs = data.timesheets || data.logs || data || []
    const pagination = paginateClient(logs, _timesheetsViewPage, 10)
    _timesheetsViewPage = pagination.page
    const total = logs.reduce((s, l) => s + (parseFloat(l.hours_consumed) || 0), 0)
    const billable = logs.filter(l => l.is_billable).reduce((s, l) => s + (parseFloat(l.hours_consumed) || 0), 0)
    const pending = logs.filter(l => l.approval_status === 'pending').length
    const approved = logs.filter(l => l.approval_status === 'approved').reduce((s, l) => s + (parseFloat(l.hours_consumed) || 0), 0)

    if (summaryEl) {
      summaryEl.innerHTML = `
        ${miniStatCard('Total Hours', total.toFixed(1)+'h', '#FF7A45','fa-clock')}
        ${miniStatCard('Billable', billable.toFixed(1)+'h', '#58C68A','fa-check-circle')}
        ${miniStatCard('Non-Billable', (total-billable).toFixed(1)+'h', '#64748b','fa-ban')}
        ${miniStatCard('Pending Approval', pending, '#FFCB47','fa-hourglass-half')}`
    }

    if (!wrap) return
    if (pagination.total === 0) {
      wrap.innerHTML = '<div class="empty-state"><i class="fas fa-clock"></i><p>No timesheet entries found for the selected filters.</p></div>'
      return
    }

    wrap.innerHTML = `<div style="overflow-x:auto">
      <table class="data-table">
        <thead><tr>
          ${isManager ? '<th style="width:32px"><input type="checkbox" id="ts-select-all" onchange="toggleTsSelectAll(this)"/></th>' : ''}
          <th>Date</th><th>Developer</th><th>Project</th><th>Module</th><th>Task</th><th>Hours</th><th>Status</th><th>Approval</th>
          ${isManager ? '<th>Actions</th>' : ''}
        </tr></thead>
        <tbody>${pagination.items.map(l => {
          const statusColors = { in_progress:'badge-inprogress', completed:'badge-done', blocked:'badge-blocked' }
          const approvalColors = { pending:'badge-todo', approved:'badge-done', rejected:'badge-blocked' }
          return `<tr>
            ${isManager ? `<td><input type="checkbox" class="ts-check" value="${l.id}"/></td>` : ''}
            <td style="font-size:12px;white-space:nowrap">${fmtDate(l.date||l.created_at)}</td>
            <td><div style="font-size:12px;color:#e2e8f0">${l.full_name||l.user_name||'—'}</div></td>
            <td><div style="font-size:12px;color:#94a3b8;white-space:nowrap">${l.project_name||'—'}</div><div style="font-size:10px;color:#64748b">${l.project_code||''}</div></td>
            <td style="font-size:12px;color:#94a3b8">${l.module_name||'—'}</td>
            <td style="max-width:200px"><div style="font-size:12px;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${l.task_description||''}">${(l.task_description||'—').substring(0,60)}${(l.task_description||'').length>60?'…':''}</div>${l.blocker_remarks?`<div style="font-size:10px;color:#FF5E3A;margin-top:2px"><i class="fas fa-exclamation-triangle" style="margin-right:3px"></i>${l.blocker_remarks.substring(0,40)}</div>`:''}</td>
            <td style="font-weight:600;color:${(l.hours_consumed||0)>8?'#FFCB47':'#e2e8f0'}">${parseFloat(l.hours_consumed||0).toFixed(1)}h${l.is_billable?'':' <span style="font-size:9px;color:#64748b">(NB)</span>'}</td>
            <td><span class="badge ${statusColors[l.status]||'badge-todo'}">${l.status||'—'}</span></td>
            <td><span class="badge ${approvalColors[l.approval_status]||'badge-todo'}">${l.approval_status||'pending'}</span>${l.pm_notes?`<div style="font-size:10px;color:#94a3b8;margin-top:2px">${l.pm_notes.substring(0,30)}</div>`:''}</td>
            ${isManager ? `<td style="white-space:nowrap">
              ${l.approval_status==='pending'?`<button class="btn btn-sm btn-outline" style="color:#58C68A;border-color:#58C68A" onclick="approveTsEntry('${l.id}','approved')"><i class="fas fa-check"></i></button>
              <button class="btn btn-sm btn-outline" style="color:#FF5E3A;border-color:#FF5E3A;margin-left:4px" onclick="approveTsEntry('${l.id}','rejected')"><i class="fas fa-times"></i></button>`:'—'}
            </td>` : ''}
          </tr>`}).join('')}
        </tbody>
      </table>
    </div>
    ${renderPager(pagination, 'goTimesheetPage', 'goTimesheetPage', 'entries')}
    `
  } catch(e) {
    if (wrap) wrap.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>`
  }
}

function goTimesheetPage(page) {
  _timesheetsViewPage = Math.max(1, Number(page) || 1)
  loadTimesheetData()
}

function miniStatCard(label, value, color, icon) {
  return `<div class="card" style="padding:16px">
    <div style="display:flex;align-items:center;gap:10px">
      <div style="width:36px;height:36px;border-radius:8px;background:${color}22;display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <i class="fas ${icon}" style="color:${color};font-size:14px"></i>
      </div>
      <div>
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.04em">${label}</div>
        <div style="font-size:20px;font-weight:700;color:#e2e8f0">${value}</div>
      </div>
    </div>
  </div>`
}

async function submitTsEntry() {
  const body = {
    date: document.getElementById('ts-date')?.value,
    hours_consumed: parseFloat(document.getElementById('ts-hours')?.value || 0),
    project_id: document.getElementById('ts-project')?.value,
    module_name: document.getElementById('ts-module')?.value.trim(),
    task_description: document.getElementById('ts-task')?.value.trim(),
    status: document.getElementById('ts-status')?.value || 'in_progress',
    is_billable: parseInt(document.getElementById('ts-billable')?.value || '1'),
    blocker_remarks: document.getElementById('ts-blocker')?.value.trim() || null,
    user_id: document.getElementById('ts-user')?.value || null,
  }
  if (!body.date || !body.project_id || !body.task_description || !body.hours_consumed)
    return toast('Date, project, hours, and task description are required', 'error')
  try {
    await API.post('/timesheets', body)
    toast('Time entry submitted!', 'success')
    document.getElementById('ts-quick-form').style.display = 'none'
    loadTimesheetData()
  } catch(e) { toast(e.message, 'error') }
}

async function approveTsEntry(id, action) {
  try {
    await API.patch('/timesheets/' + id + '/approve', { action })
    toast(action === 'approved' ? 'Entry approved!' : 'Entry rejected', action === 'approved' ? 'success' : 'info')
    loadTimesheetData()
  } catch(e) { toast(e.message, 'error') }
}

function toggleTsSelectAll(cb) {
  document.querySelectorAll('.ts-check').forEach(c => c.checked = cb.checked)
}

async function bulkApproveTsSelected() {
  const ids = Array.from(document.querySelectorAll('.ts-check:checked')).map(c => c.value)
  if (ids.length === 0) return toast('Select entries to approve', 'error')
  try {
    await Promise.all(ids.map(id => API.patch('/timesheets/' + id + '/approve', { action: 'approved' })))
    toast(`${ids.length} entries approved!`, 'success')
    loadTimesheetData()
  } catch(e) { toast(e.message, 'error') }
}

function exportTimesheetCSV() {
  toast('Exporting CSV…', 'info')
  const rows = document.querySelectorAll('#ts-table-wrap table tbody tr')
  if (!rows.length) return toast('No data to export', 'error')
  const headers = ['Date','Developer','Project','Module','Task','Hours','Status','Approval']
  const lines = [headers.join(',')]
  rows.forEach(r => {
    const cells = r.querySelectorAll('td')
    const offset = ['admin','pm'].includes(_user.role) ? 1 : 0
    const row = [
      cells[offset]?.textContent.trim(),
      cells[offset+1]?.textContent.trim(),
      cells[offset+2]?.textContent.trim(),
      cells[offset+3]?.textContent.trim(),
      '"'+( cells[offset+4]?.textContent.trim().replace(/"/g,'""') || '')+ '"',
      cells[offset+5]?.textContent.trim(),
      cells[offset+6]?.textContent.trim(),
      cells[offset+7]?.textContent.trim(),
    ]
    lines.push(row.join(','))
  })
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = 'timesheets_' + dayjs().format('YYYY-MM-DD') + '.csv'
  a.click(); URL.revokeObjectURL(url)
}

/* ── REPORTS VIEW ──────────────────────────────────────── */
async function renderReportsView(el) {
  el.innerHTML = `<div style="padding:40px;text-align:center;color:#64748b"><i class="fas fa-spinner fa-spin" style="font-size:24px"></i></div>`

  el.innerHTML = `
  <div class="page-header">
    <div><h1 class="page-title">Reports & Analytics</h1><p class="page-subtitle">Export and analyze project data</p></div>
    <div class="page-actions">
      <button class="btn btn-outline" onclick="exportReportCSV()"><i class="fas fa-download"></i>Export CSV</button>
    </div>
  </div>

  <!-- Report tabs -->
  <div style="display:flex;gap:4px;background:#1F0F08;padding:4px;border-radius:10px;border:1px solid #2A1812;margin-bottom:20px;width:fit-content">
    <button id="rtab-team" onclick="switchReportTab2('team')" class="report-tab active-tab" style="padding:8px 20px;border-radius:7px;border:none;cursor:pointer;font-size:13px;font-weight:600;background:#FF7A45;color:#fff">Team Utilization</button>
    <button id="rtab-project" onclick="switchReportTab2('project')" class="report-tab" style="padding:8px 20px;border-radius:7px;border:none;cursor:pointer;font-size:13px;font-weight:500;background:transparent;color:#94a3b8">Project Status</button>
    <button id="rtab-billing" onclick="switchReportTab2('billing')" class="report-tab" style="padding:8px 20px;border-radius:7px;border:none;cursor:pointer;font-size:13px;font-weight:500;background:transparent;color:#94a3b8">Billing Summary</button>
    <button id="rtab-timesheet" onclick="switchReportTab2('timesheet')" class="report-tab" style="padding:8px 20px;border-radius:7px;border:none;cursor:pointer;font-size:13px;font-weight:500;background:transparent;color:#94a3b8">Timesheet Report</button>
  </div>

  <div id="report-panel"></div>`

  switchReportTab2('team')
}

function switchReportTab2(tab) {
  document.querySelectorAll('.report-tab').forEach(btn => {
    btn.style.background = 'transparent'; btn.style.color = '#94a3b8'; btn.style.fontWeight = '500'
  })
  const active = document.getElementById('rtab-' + tab)
  if (active) { active.style.background = '#FF7A45'; active.style.color = '#fff'; active.style.fontWeight = '600' }
  loadReport2(tab)
}

async function loadReport2(tab) {
  const panel = document.getElementById('report-panel')
  if (!panel) return
  panel.innerHTML = '<div style="padding:24px;text-align:center;color:#64748b"><i class="fas fa-spinner fa-spin"></i></div>'
  try {
    if (tab === 'team') {
      const data = await API.get('/reports/team-utilization')
      const users = data.utilization || data.users || []
      panel.innerHTML = `
        <div class="grid-2" style="margin-bottom:20px">
          <div class="card" style="padding:20px">
            <div style="font-size:13px;font-weight:600;color:#e2e8f0;margin-bottom:16px">Developer Utilization</div>
            <div id="util-chart-container" style="height:200px;display:flex;align-items:flex-end;gap:8px;padding:10px">
              ${users.map(u => {
                const pct = Math.min(u.utilization_pct || 0, 100)
                return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
                  <span style="font-size:9px;color:${pct>=80?'#FF5E3A':pct>=50?'#FFCB47':'#58C68A'};font-weight:600">${pct}%</span>
                  <div style="width:100%;background:#2A1812;border-radius:3px;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end" title="${u.full_name}: ${pct}%" style="height:160px">
                    <div style="height:${pct}%;background:${pct>=80?'linear-gradient(180deg,#FF5E3A,#FF5E3A)':pct>=50?'linear-gradient(180deg,#E5A82C,#FFCB47)':'linear-gradient(180deg,#3FAA70,#58C68A)'};border-radius:3px;transition:.5s;min-height:2px"></div>
                  </div>
                  <span style="font-size:9px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:50px" title="${u.full_name}">${u.full_name?.split(' ')[0]}</span>
                </div>`}).join('')}
            </div>
          </div>
          <div class="card" style="padding:20px">
            <div style="font-size:13px;font-weight:600;color:#e2e8f0;margin-bottom:16px">Capacity Summary</div>
            ${users.reduce((html, u) => html + `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #2A1812">
                <div style="display:flex;align-items:center;gap:8px">
                  ${avatar(u.full_name, u.avatar_color, 'sm')}
                  <div><div style="font-size:12px;color:#e2e8f0">${u.full_name}</div><div style="font-size:10px;color:#64748b">${u.designation||u.role}</div></div>
                </div>
                <div style="text-align:right">
                  <div style="font-size:12px;color:#e2e8f0">${u.monthly_consumed||0}h / ${u.monthly_available_hours||160}h</div>
                  <div class="progress-bar" style="width:80px;margin-top:3px"><div class="progress-fill ${(u.utilization_pct||0)>=80?'rose':(u.utilization_pct||0)>=50?'amber':'green'}" style="width:${Math.min(u.utilization_pct||0,100)}%"></div></div>
                </div>
              </div>`, '')}
          </div>
        </div>
        <div class="card">
          <div class="card-header"><span style="font-weight:600">Full Team Report</span></div>
          <div class="card-body" style="padding:0">
            <table class="data-table">
              <thead><tr><th>Developer</th><th>Role</th><th>Monthly Capacity</th><th>Consumed</th><th>Utilization</th><th>Projects</th><th>Hourly Cost</th><th>Cost This Month</th></tr></thead>
              <tbody>${users.map(u => `<tr>
                <td><div style="display:flex;align-items:center;gap:8px">${avatar(u.full_name,u.avatar_color,'sm')}<div><div style="font-size:12px;color:#e2e8f0">${u.full_name}</div><div style="font-size:10px;color:#64748b">${u.email}</div></div></div></td>
                <td><span class="badge badge-${u.role==='pm'?'inprogress':'review'}">${u.role}</span></td>
                <td>${u.monthly_available_hours||160}h</td>
                <td>${u.monthly_consumed||0}h</td>
                <td><div style="display:flex;align-items:center;gap:6px"><div class="progress-bar" style="width:70px"><div class="progress-fill ${(u.utilization_pct||0)>=80?'rose':(u.utilization_pct||0)>=50?'amber':'green'}" style="width:${Math.min(u.utilization_pct||0,100)}%"></div></div><span style="font-size:11px;color:${pctColor(u.utilization_pct||0)}">${u.utilization_pct||0}%</span></div></td>
                <td>${u.project_count||0}</td>
                <td style="color:#94a3b8">${u.hourly_cost ? '₹'+fmtNum(u.hourly_cost) : '—'}</td>
                <td style="color:#58C68A">${u.hourly_cost && u.monthly_consumed ? '₹'+fmtNum(u.hourly_cost * u.monthly_consumed) : '—'}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>
        </div>`
    } else if (tab === 'project') {
      const data = await API.get('/reports/project-summary')
      const projects = data.projects || []
      panel.innerHTML = `
        <div class="card">
          <div class="card-header"><span style="font-weight:600">Project Status Report</span></div>
          <div class="card-body" style="padding:0">
            <table class="data-table">
              <thead><tr><th>Project</th><th>Client</th><th>Type</th><th>Status</th><th>Allocated</th><th>Consumed</th><th>Remaining</th><th>Burn %</th><th>End Date</th><th>Health</th></tr></thead>
              <tbody>${projects.map(p => {
                const burn = p.total_allocated_hours > 0 ? Math.round((p.consumed_hours/p.total_allocated_hours)*100) : 0
                const remaining = (p.total_allocated_hours||0) - (p.consumed_hours||0)
                const overdue = p.expected_end_date && new Date(p.expected_end_date) < new Date() && p.status !== 'completed'
                return `<tr>
                  <td><div style="font-weight:500;color:#e2e8f0;font-size:13px">${p.name}</div><div style="font-size:11px;color:#64748b">${p.code}</div></td>
                  <td style="font-size:12px;color:#94a3b8">${p.client_name||'—'}</td>
                  <td style="font-size:12px;color:#94a3b8">${p.project_type||'—'}</td>
                  <td>${statusBadge(p.status)}</td>
                  <td>${p.total_allocated_hours||0}h</td>
                  <td>${p.consumed_hours||0}h</td>
                  <td style="color:${remaining<0?'#FF5E3A':'#94a3b8'}">${remaining}h</td>
                  <td><div style="display:flex;align-items:center;gap:6px">
                    <div class="progress-bar" style="width:60px"><div class="progress-fill ${burn>=90?'rose':burn>=70?'amber':'green'}" style="width:${Math.min(burn,100)}%"></div></div>
                    <span style="font-size:11px;color:${pctColor(burn)}">${burn}%</span>
                  </div></td>
                  <td style="font-size:12px;color:${overdue?'#FF5E3A':'#94a3b8'}">${fmtDate(p.expected_end_date)}${overdue?' <span class="badge badge-blocked" style="font-size:9px">Overdue</span>':''}</td>
                  <td>${burn>=90?'🔴 Critical':burn>=70?'🟡 Warning':'🟢 Healthy'}</td>
                </tr>`}).join('')}
              </tbody>
            </table>
          </div>
        </div>`
    } else if (tab === 'billing') {
      const data = await API.get('/invoices')
      const invoices = data.invoices || []
      const total = invoices.reduce((s,i) => s+(i.total_amount||0), 0)
      const paid = invoices.reduce((s,i) => s+(i.paid_amount||0), 0)
      const pending = invoices.filter(i=>['pending','sent'].includes(i.status)).reduce((s,i) => s+(i.total_amount||0), 0)
      panel.innerHTML = `
        <div class="grid-4" style="margin-bottom:16px">
          ${miniStatCard('Total Invoiced', fmtCurrency(total), '#FF7A45', 'fa-file-invoice-dollar')}
          ${miniStatCard('Collected', fmtCurrency(paid), '#58C68A', 'fa-check-circle')}
          ${miniStatCard('Outstanding', fmtCurrency(pending), '#FFCB47', 'fa-hourglass-half')}
          ${miniStatCard('Overdue Count', invoices.filter(i=>i.status==='overdue').length, '#FF5E3A', 'fa-exclamation-triangle')}
        </div>
        <div class="card">
          <div class="card-header"><span style="font-weight:600">Invoice Summary</span></div>
          <div class="card-body" style="padding:0">
            <table class="data-table">
              <thead><tr><th>Invoice #</th><th>Client</th><th>Project</th><th>Issue Date</th><th>Due Date</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead>
              <tbody>${invoices.map(i => `<tr>
                <td style="font-family:monospace;font-size:12px;color:#FFB347">${i.invoice_number}</td>
                <td style="font-size:12px;color:#e2e8f0">${i.company_name||'—'}</td>
                <td style="font-size:12px;color:#94a3b8">${i.project_name||'—'}</td>
                <td style="font-size:12px;color:#94a3b8">${fmtDate(i.issue_date)}</td>
                <td style="font-size:12px;color:${new Date(i.due_date)<new Date()&&i.status!=='paid'?'#FF5E3A':'#94a3b8'}">${fmtDate(i.due_date)}</td>
                <td style="font-weight:600;color:#e2e8f0">${fmtCurrency(i.total_amount)}</td>
                <td style="color:#58C68A">${i.paid_amount>0?fmtCurrency(i.paid_amount):'—'}</td>
                <td style="color:${(i.total_amount-(i.paid_amount||0))>0?'#FFCB47':'#64748b'}">${fmtCurrency(i.total_amount-(i.paid_amount||0))}</td>
                <td><span class="badge ${invoiceStatusClass(i.status)}">${i.status}</span></td>
              </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>`
    } else if (tab === 'timesheet') {
      const today = dayjs().format('YYYY-MM-DD')
      const monthStart = dayjs().startOf('month').format('YYYY-MM-DD')
      const data = await API.get('/timesheets?from=' + monthStart + '&to=' + today)
      const logs = data.timesheets || data || []
      const totalH = logs.reduce((s,l) => s+(parseFloat(l.hours_consumed)||0), 0)
      const billH = logs.filter(l=>l.is_billable).reduce((s,l) => s+(parseFloat(l.hours_consumed)||0), 0)

      // Aggregate by developer
      const byDev = {}
      logs.forEach(l => {
        const k = l.user_id || l.id
        if (!byDev[k]) byDev[k] = { name: l.full_name||'—', total: 0, billable: 0, projects: new Set() }
        byDev[k].total += parseFloat(l.hours_consumed||0)
        byDev[k].billable += l.is_billable ? parseFloat(l.hours_consumed||0) : 0
        if (l.project_id) byDev[k].projects.add(l.project_id)
      })

      panel.innerHTML = `
        <div class="grid-4" style="margin-bottom:16px">
          ${miniStatCard('This Month Total', totalH.toFixed(1)+'h', '#FF7A45', 'fa-clock')}
          ${miniStatCard('Billable', billH.toFixed(1)+'h', '#58C68A', 'fa-check-circle')}
          ${miniStatCard('Non-Billable', (totalH-billH).toFixed(1)+'h', '#64748b', 'fa-ban')}
          ${miniStatCard('Entries', logs.length, '#FFB347', 'fa-list')}
        </div>
        <div class="card">
          <div class="card-header"><span style="font-weight:600">This Month by Developer</span></div>
          <div class="card-body" style="padding:0">
            <table class="data-table">
              <thead><tr><th>Developer</th><th>Total Hours</th><th>Billable</th><th>Non-Billable</th><th>Projects</th></tr></thead>
              <tbody>${Object.values(byDev).map(d => `<tr>
                <td style="font-weight:500;color:#e2e8f0;font-size:13px">${d.name}</td>
                <td style="font-weight:600;color:#e2e8f0">${d.total.toFixed(1)}h</td>
                <td style="color:#58C68A">${d.billable.toFixed(1)}h</td>
                <td style="color:#64748b">${(d.total-d.billable).toFixed(1)}h</td>
                <td>${d.projects.size}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>
        </div>`
    }
  } catch(e) {
    panel.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>`
  }
}

function exportReportCSV() {
  const table = document.querySelector('#report-panel table')
  if (!table) return toast('No report table to export', 'error')
  const rows = table.querySelectorAll('tr')
  const lines = Array.from(rows).map(r => Array.from(r.querySelectorAll('th,td')).map(c => '"'+c.textContent.trim().replace(/"/g,'""')+'"').join(','))
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = 'report_' + dayjs().format('YYYY-MM-DD') + '.csv'
  a.click(); URL.revokeObjectURL(url)
}

/* ── ALERTS VIEW ───────────────────────────────────────── */
async function renderAlertsView(el) {
  el.innerHTML = `<div style="padding:40px;text-align:center;color:#64748b"><i class="fas fa-spinner fa-spin" style="font-size:24px"></i></div>`
  try {
    const data = await API.get('/alerts')
    const alerts = data.alerts || data || []
    const unread = alerts.filter(a => !a.is_read)
    const dismissed = alerts.filter(a => a.is_dismissed)
    const active = alerts.filter(a => !a.is_dismissed)
    const filtered = _alertsSeverityFilter ? active.filter(a => a.severity === _alertsSeverityFilter) : active
    const pagination = paginateClient(filtered, _alertsViewPage, 10)
    _alertsViewPage = pagination.page

    const sevColor = { critical:'#FF5E3A', high:'#FF7A45', warning:'#FFCB47', info:'#F4C842', low:'#64748b' }
    const sevIcon = { critical:'fa-circle-exclamation', high:'fa-exclamation-triangle', warning:'fa-triangle-exclamation', info:'fa-info-circle', low:'fa-circle-info' }

    el.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Alerts & Notifications</h1><p class="page-subtitle">${unread.length} unread alerts</p></div>
      <div class="page-actions">
        <button class="btn btn-outline" onclick="markAllAlertsRead()"><i class="fas fa-check-double"></i>Mark All Read</button>
        <button class="btn btn-primary" onclick="generateNewAlerts()"><i class="fas fa-refresh"></i>Generate Alerts</button>
      </div>
    </div>

    <div class="grid-4" style="margin-bottom:16px">
      ${miniStatCard('Total Alerts', active.length, '#FF7A45', 'fa-bell')}
      ${miniStatCard('Unread', unread.length, '#FF5E3A', 'fa-envelope')}
      ${miniStatCard('Critical', alerts.filter(a=>a.severity==='critical'&&!a.is_dismissed).length, '#FF7A45', 'fa-circle-exclamation')}
      ${miniStatCard('Dismissed', dismissed.length, '#64748b', 'fa-ban')}
    </div>

    <div style="display:flex;gap:8px;margin-bottom:14px">
      <button class="btn btn-sm btn-outline" onclick="filterAlerts('')" id="af-all" style="background:rgba(255,122,69,.15);color:#FFB347">All</button>
      <button class="btn btn-sm btn-outline" onclick="filterAlerts('critical')" id="af-critical">🔴 Critical</button>
      <button class="btn btn-sm btn-outline" onclick="filterAlerts('high')" id="af-high">🟠 High</button>
      <button class="btn btn-sm btn-outline" onclick="filterAlerts('warning')" id="af-warning">🟡 Warning</button>
      <button class="btn btn-sm btn-outline" onclick="filterAlerts('info')" id="af-info">🔵 Info</button>
    </div>

    <div id="alerts-list">
      ${pagination.total === 0 ? '<div class="empty-state"><i class="fas fa-bell-slash"></i><p>No active alerts. System is healthy!</p></div>' :
      pagination.items.map(alert => `
        <div class="card" id="alert-${alert.id}" style="padding:16px;margin-bottom:10px;border-left:3px solid ${sevColor[alert.severity]||'#64748b'};${!alert.is_read?'background:rgba(255,122,69,.04)':''}">
          <div style="display:flex;align-items:flex-start;gap:12px">
            <div style="width:36px;height:36px;border-radius:8px;background:${sevColor[alert.severity]||'#64748b'}22;display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <i class="fas ${sevIcon[alert.severity]||'fa-circle-info'}" style="color:${sevColor[alert.severity]||'#64748b'};font-size:14px"></i>
            </div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <div style="font-size:14px;font-weight:600;color:#e2e8f0">${alert.title}</div>
                <span class="badge" style="background:${sevColor[alert.severity]||'#64748b'}22;color:${sevColor[alert.severity]||'#94a3b8'};border-color:${sevColor[alert.severity]||'#64748b'}">${alert.severity}</span>
                ${!alert.is_read ? '<span class="badge badge-inprogress" style="font-size:9px">New</span>' : ''}
              </div>
              <div style="font-size:13px;color:#94a3b8;margin-top:4px;line-height:1.5">${alert.message}</div>
              <div style="font-size:11px;color:#64748b;margin-top:6px">${fmtDate(alert.created_at)}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0">
              ${!alert.is_read ? `<button class="btn btn-sm btn-outline" onclick="markAlertRead2('${alert.id}')"><i class="fas fa-eye"></i>Read</button>` : ''}
              <button class="btn btn-sm btn-outline" onclick="dismissAlert2('${alert.id}')" style="color:#64748b"><i class="fas fa-times"></i></button>
            </div>
          </div>
        </div>`).join('')}
    </div>
    <div style="margin-top:12px">${renderPager(pagination, 'goAlertsPage', 'goAlertsPage', 'alerts')}</div>
    `

    window._allAlerts = active
  } catch(e) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>`
  }
}

function filterAlerts(severity) {
  _alertsSeverityFilter = severity || ''
  _alertsViewPage = 1
  const el = document.getElementById('page-alerts-view')
  if (el) {
    el.dataset.loaded = ''
    renderAlertsView(el)
  }
}

function goAlertsPage(page) {
  _alertsViewPage = Math.max(1, Number(page) || 1)
  const el = document.getElementById('page-alerts-view')
  if (el) {
    el.dataset.loaded = ''
    renderAlertsView(el)
  }
}

async function markAlertRead2(id) {
  try {
    await API.patch('/alerts/' + id + '/read', {})
    const el = document.getElementById('alert-' + id)
    if (el) { el.style.background = 'transparent'; el.querySelector('.btn:first-child')?.remove() }
    toast('Marked as read', 'info')
  } catch(e) { toast(e.message, 'error') }
}

async function dismissAlert2(id) {
  try {
    await API.patch('/alerts/' + id + '/dismiss', {})
    const el = document.getElementById('alert-' + id)
    if (el) el.style.display = 'none'
    toast('Alert dismissed', 'info')
  } catch(e) { toast(e.message, 'error') }
}

async function markAllAlertsRead() {
  try {
    await API.patch('/alerts/read-all', {})
    toast('All alerts marked as read', 'success')
    const alertEl = document.getElementById('page-alerts-view'); if (alertEl) { alertEl.dataset.loaded=''; renderAlertsView(alertEl) }
  } catch(e) { toast(e.message, 'error') }
}

async function generateNewAlerts() {
  try {
    const data = await API.post('/alerts/generate', {})
    toast((data.count || 0) + ' new alerts generated!', 'success')
    // Refresh
    const currentPage = Router.current?.page
    if (currentPage === 'alerts-view') { const el2 = document.getElementById('page-alerts-view'); if (el2) { el2.dataset.loaded=''; renderAlertsView(el2) } }
  } catch(e) { toast(e.message, 'error') }
}

/* ── SETTINGS VIEW ─────────────────────────────────────── */
async function renderSettingsView(el) {
  el.innerHTML = `<div style="padding:40px;text-align:center;color:#64748b"><i class="fas fa-spinner fa-spin" style="font-size:24px"></i></div>`
  try {
    const [settings, techData, holidayData] = await Promise.all([
      API.get('/settings'),
      API.get('/settings/tech-stacks').catch(() => ({ tech_stacks: [] })),
      API.get('/settings/holidays').catch(() => ({ holidays: [] }))
    ])
    const company = settings.company_settings || settings.settings || {}
    const techStacks = techData.tech_stacks || []
    const holidays = holidayData.holidays || []

    el.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Settings</h1><p class="page-subtitle">Company configuration and system preferences</p></div>
    </div>

    <!-- Settings tabs -->
    <div style="display:flex;gap:4px;background:#1F0F08;padding:4px;border-radius:10px;border:1px solid #2A1812;margin-bottom:20px;width:fit-content">
      <button class="settings-tab" id="stab-company" onclick="switchSettingsTab2('company')" style="padding:8px 20px;border-radius:7px;border:none;cursor:pointer;font-size:13px;font-weight:600;background:#FF7A45;color:#fff">Company</button>
      <button class="settings-tab" id="stab-holidays" onclick="switchSettingsTab2('holidays')" style="padding:8px 20px;border-radius:7px;border:none;cursor:pointer;font-size:13px;font-weight:500;background:transparent;color:#94a3b8">Holidays</button>
      <button class="settings-tab" id="stab-tech" onclick="switchSettingsTab2('tech')" style="padding:8px 20px;border-radius:7px;border:none;cursor:pointer;font-size:13px;font-weight:500;background:transparent;color:#94a3b8">Tech Stacks</button>
      <button class="settings-tab" id="stab-profile" onclick="switchSettingsTab2('profile')" style="padding:8px 20px;border-radius:7px;border:none;cursor:pointer;font-size:13px;font-weight:500;background:transparent;color:#94a3b8">My Profile</button>
      ${['admin','pm'].includes(_user.role) ? `<button class="settings-tab" id="stab-invites" onclick="switchSettingsTab2('invites')" style="padding:8px 20px;border-radius:7px;border:none;cursor:pointer;font-size:13px;font-weight:500;background:transparent;color:#94a3b8">Invites</button>` : ''}
      ${_user.role === 'admin' ? `<button class="settings-tab" id="stab-roles" onclick="switchSettingsTab2('roles')" style="padding:8px 20px;border-radius:7px;border:none;cursor:pointer;font-size:13px;font-weight:500;background:transparent;color:#94a3b8">Roles &amp; Permissions</button>` : ''}
    </div>

    <div id="settings-panel">
      <!-- Company tab shown by default via JS -->
    </div>`

    // Store data for use in tab renders
    window._settingsCompany = company
    window._settingsTech = techStacks
    window._settingsHolidays = holidays

    switchSettingsTab2('company')

  } catch(e) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>`
  }
}

function switchSettingsTab2(tab) {
  document.querySelectorAll('.settings-tab').forEach(btn => { btn.style.background='transparent'; btn.style.color='#94a3b8'; btn.style.fontWeight='500' })
  const active = document.getElementById('stab-' + tab)
  if (active) { active.style.background='#FF7A45'; active.style.color='#fff'; active.style.fontWeight='600' }
  const panel = document.getElementById('settings-panel')
  if (!panel) return

  if (tab === 'company') {
    const c = window._settingsCompany || {}
    panel.innerHTML = `
    <div class="grid-2">
      <div class="card" style="padding:24px">
        <h3 style="font-size:15px;font-weight:600;color:#e2e8f0;margin:0 0 20px">Company Settings</h3>
        <div class="form-group"><label class="form-label">Company Name</label><input class="form-input" id="cs-name" value="${c.company_name||'DevTrack Pro'}"/></div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Default Daily Hours</label><input class="form-input" type="number" id="cs-daily" value="${c.default_daily_hours||8}" min="1" max="24"/></div>
          <div class="form-group"><label class="form-label">Working Days/Month</label><input class="form-input" type="number" id="cs-days" value="${c.default_working_days||22}" min="1" max="31"/></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Alert Threshold (%)</label><input class="form-input" type="number" id="cs-alert" value="${Math.round((c.alert_threshold_hours||0.8)*100)}" min="1" max="100"/></div>
          <div class="form-group"><label class="form-label">Overtime Threshold (h)</label><input class="form-input" type="number" id="cs-overtime" value="${c.overtime_threshold||10}" min="1" max="16"/></div>
        </div>
        <div class="form-group"><label class="form-label">Inactivity Warning (days)</label><input class="form-input" type="number" id="cs-inactivity" value="${c.inactivity_days||3}" min="1" max="30"/></div>
        <button class="btn btn-primary" onclick="saveCompanySettings2()"><i class="fas fa-save"></i>Save Settings</button>
      </div>
      <div class="card" style="padding:24px">
        <h3 style="font-size:15px;font-weight:600;color:#e2e8f0;margin:0 0 20px">System Information</h3>
        ${profileRow2('fa-building','Company','Mariox Software Services')}
        ${profileRow2('fa-code-branch','Version','DevPortal v2.0 Enterprise')}
        ${profileRow2('fa-database','Database','MongoDB-backed SQL')}
        ${profileRow2('fa-server','Platform','Node.js')}
        ${profileRow2('fa-shield-halved','Security','JWT + SHA-256 Hashed Passwords')}
        ${profileRow2('fa-globe','Region','Global Edge Network')}
      </div>
    </div>`
  } else if (tab === 'holidays') {
    const holidays = window._settingsHolidays || []
    const pagination = paginateClient(holidays, _holidaysPage, 8)
    _holidaysPage = pagination.page
    panel.innerHTML = `
    <div class="card">
      <div class="card-header">
        <span style="font-weight:600">Holidays (${pagination.total})</span>
        <button class="btn btn-sm btn-primary" onclick="showAddHolidayModal2()"><i class="fas fa-plus"></i>Add Holiday</button>
      </div>
      <div class="card-body" style="padding:0">
        ${pagination.total === 0 ? '<div class="empty-state"><i class="fas fa-calendar"></i><p>No holidays configured</p></div>' :
        `<table class="data-table">
          <thead><tr><th>Holiday Name</th><th>Date</th><th>Type</th><th></th></tr></thead>
          <tbody id="holidays-tbody">${pagination.items.map(h => `<tr id="holiday-row-${h.id}">
            <td style="font-weight:500;color:#e2e8f0">${h.name}</td>
            <td style="color:#94a3b8">${fmtDate(h.date)}</td>
            <td><span class="badge badge-${h.type==='national'?'done':'inprogress'}">${h.type||'national'}</span></td>
            <td><button class="btn btn-sm btn-outline" style="color:#FF5E3A;border-color:#FF5E3A" onclick="deleteHoliday2('${h.id}')"><i class="fas fa-trash"></i></button></td>
          </tr>`).join('')}</tbody>
        </table>`}
        <div style="margin-top:12px">${renderPager(pagination, 'goHolidaysPage', 'goHolidaysPage', 'holidays')}</div>
      </div>
    </div>`
  } else if (tab === 'tech') {
    const techs = window._settingsTech || []
    const byCategory = {}
    techs.forEach(t => { const c = t.category||'Other'; if(!byCategory[c]) byCategory[c]=[]; byCategory[c].push(t) })
    panel.innerHTML = `
    <div class="card">
      <div class="card-header">
        <span style="font-weight:600">Technology Stacks (${techs.length})</span>
        <button class="btn btn-sm btn-primary" onclick="showAddTechModal2()"><i class="fas fa-plus"></i>Add Tech</button>
      </div>
      <div class="card-body" style="padding:16px">
        ${Object.entries(byCategory).map(([cat, items]) => `
          <div style="margin-bottom:16px">
            <div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">${cat}</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">
              ${items.map(t => `<span style="padding:5px 12px;border-radius:20px;background:#2A1812;color:#94a3b8;font-size:12px;display:inline-flex;align-items:center;gap:6px">
                ${t.name}
                <button onclick="deleteTech2('${t.id}')" style="background:none;border:none;color:#64748b;cursor:pointer;padding:0;font-size:10px;display:inline-flex;align-items:center" title="Remove">✕</button>
              </span>`).join('')}
            </div>
          </div>`).join('')}
      </div>
    </div>`
  } else if (tab === 'profile') {
    panel.innerHTML = `
    <div class="grid-2">
      <div class="card" style="padding:24px">
        <h3 style="font-size:15px;font-weight:600;color:#e2e8f0;margin:0 0 20px">Profile Info</h3>
        <div style="text-align:center;margin-bottom:20px">
          <div style="width:64px;height:64px;border-radius:50%;background:${_user.avatar_color||'#FF7A45'};display:inline-flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;color:#fff;margin-bottom:10px">${initials(_user.name||_user.full_name||'U')}</div>
          <div style="font-size:16px;font-weight:600;color:#e2e8f0">${_user.name||_user.full_name||'—'}</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px">${_user.email||'—'}</div>
          <span class="badge badge-inprogress" style="margin-top:6px;text-transform:capitalize">${_user.role}</span>
        </div>
      </div>
      <div class="card" style="padding:24px">
        <h3 style="font-size:15px;font-weight:600;color:#e2e8f0;margin:0 0 16px">Change Password</h3>
        <div class="form-group"><label class="form-label">Current Password</label><input class="form-input" id="prof-old" type="password" placeholder="••••••••"/></div>
        <div class="form-group"><label class="form-label">New Password</label><input class="form-input" id="prof-new" type="password" placeholder="Minimum 8 chars"/></div>
        <div class="form-group"><label class="form-label">Confirm Password</label><input class="form-input" id="prof-conf" type="password" placeholder="Repeat new password"/></div>
        <button class="btn btn-primary" style="width:100%" onclick="changePasswordProfile()"><i class="fas fa-lock"></i>Update Password</button>
        <div style="margin-top:16px;padding-top:16px;border-top:1px solid #2A1812">
          <button class="btn btn-outline" style="width:100%;color:#FF5E3A;border-color:#FF5E3A" onclick="if(confirm('Sign out?')){clearAuth();location.reload()}"><i class="fas fa-sign-out-alt"></i>Sign Out</button>
        </div>
      </div>
    </div>`
  } else if (tab === 'invites') {
    panel.innerHTML = `<div id="invites-panel-container" style="padding:8px 0"><div style="padding:20px;text-align:center;color:#64748b"><i class="fas fa-spinner fa-spin"></i> Loading invites…</div></div>`
    const cont = document.getElementById('invites-panel-container')
    if (cont && typeof renderInvitesPanel === 'function') renderInvitesPanel(cont)
  } else if (tab === 'roles') {
    panel.innerHTML = `<div id="roles-panel-container"><div style="padding:20px;text-align:center;color:#64748b"><i class="fas fa-spinner fa-spin"></i> Loading roles…</div></div>`
    renderRolesPanel()
  }
}

// ── Roles & Permissions ─────────────────────────────────────────
let _rolesState = { roles: [], catalogue: [] }

async function renderRolesPanel() {
  const cont = document.getElementById('roles-panel-container')
  if (!cont) return
  try {
    const res = await API.get('/settings/roles')
    _rolesState.roles = res.roles || res.data || []
    _rolesState.catalogue = res.catalogue || []
    paintRolesPanel()
  } catch (e) {
    cont.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>`
  }
}

function paintRolesPanel() {
  const cont = document.getElementById('roles-panel-container')
  if (!cont) return
  const roles = _rolesState.roles || []

  cont.innerHTML = `
    <div class="card">
      <div class="card-header" style="display:flex;align-items:center;justify-content:space-between">
        <span style="font-weight:700;font-size:15px">Role Configuration</span>
        <div style="display:flex;gap:8px">
          <button class="btn btn-sm btn-secondary" onclick="renderRolesPanel()"><i class="fas fa-rotate"></i> Refresh</button>
          <button class="btn btn-sm btn-primary" onclick="openRoleEditModal('')"><i class="fas fa-plus"></i> Create Role</button>
        </div>
      </div>
      <div class="card-body" style="display:flex;flex-direction:column;gap:12px">
        ${roles.length === 0 ? '<div class="empty-state"><i class="fas fa-shield-halved"></i><p>No roles defined yet.</p></div>' : roles.map(renderRoleCard).join('')}
      </div>
    </div>
  `
}

function renderRoleCard(role) {
  const perms = Array.isArray(role.permissions) ? role.permissions : []
  const labelByKey = new Map()
  for (const grp of _rolesState.catalogue || []) {
    for (const p of grp.permissions || []) labelByKey.set(p.key, p.label)
  }
  const previewCount = 8
  const previewPerms = perms.slice(0, previewCount)
  const remaining = Math.max(0, perms.length - previewCount)
  const isSystem = !!role.is_system

  return `
    <div class="role-card">
      <div class="role-card-head">
        <div>
          <div class="role-card-title">
            <strong>${escapeHtml(role.name || role.key)}</strong>
            ${isSystem ? '<span class="badge badge-inprogress" style="margin-left:8px">SYSTEM</span>' : '<span class="badge badge-purple" style="margin-left:8px">CUSTOM</span>'}
            <span style="font-size:11px;color:var(--text-muted);margin-left:10px;font-family:'IBM Plex Mono',monospace">${escapeHtml(role.key)}</span>
          </div>
          ${role.description ? `<div class="role-card-desc">${escapeHtml(role.description)}</div>` : ''}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm btn-outline" onclick="openRoleEditModal('${escapeHtml(role.id)}')"><i class="fas fa-sliders"></i> Manage Permissions</button>
          ${!isSystem ? `<button class="btn btn-sm btn-danger" onclick="deleteCustomRole('${escapeHtml(role.id)}')"><i class="fas fa-trash"></i></button>` : ''}
        </div>
      </div>
      <div class="role-card-perms">
        ${previewPerms.length === 0 ? '<span style="color:var(--text-muted);font-size:12px">No permissions yet</span>' : previewPerms.map(k => `<span class="role-perm-chip">${escapeHtml(labelByKey.get(k) || k)}</span>`).join('')}
        ${remaining > 0 ? `<span class="role-perm-chip role-perm-chip-more">+${remaining} more</span>` : ''}
      </div>
    </div>
  `
}

function openRoleEditModal(roleId) {
  const isCreate = !roleId
  const role = isCreate ? null : (_rolesState.roles || []).find(r => r.id === roleId)
  if (!isCreate && !role) { toast('Role not found', 'error'); return }
  const isSystem = role?.is_system

  const granted = new Set(Array.isArray(role?.permissions) ? role.permissions : [])
  const groups = _rolesState.catalogue || []

  const groupHtml = groups.map(g => {
    const checks = (g.permissions || []).map(p => `
      <label class="perm-row">
        <input type="checkbox" data-perm="${escapeHtml(p.key)}" ${granted.has(p.key)?'checked':''}/>
        <span class="perm-row-text">
          <span class="perm-row-label">${escapeHtml(p.label)}</span>
          <span class="perm-row-key">${escapeHtml(p.key)}</span>
        </span>
      </label>
    `).join('')
    return `
      <div class="perm-group">
        <div class="perm-group-head">
          <i class="fas ${escapeHtml(g.icon || 'fa-circle')}"></i>
          <strong>${escapeHtml(g.label)}</strong>
          <button class="btn btn-xs btn-outline" onclick="togglePermGroup('${escapeHtml(g.module)}', true)">All</button>
          <button class="btn btn-xs btn-outline" onclick="togglePermGroup('${escapeHtml(g.module)}', false)">None</button>
        </div>
        <div class="perm-group-body" data-perm-group="${escapeHtml(g.module)}">${checks}</div>
      </div>
    `
  }).join('')

  showModal(`
    <div class="modal-header">
      <div>
        <h3>${isCreate ? 'Create Role' : `Manage Permissions — ${escapeHtml(role.name)}`}</h3>
        <div style="font-size:11px;color:var(--text-muted);margin-top:3px">${isSystem ? 'System role: name and description are editable; key is fixed.' : 'Custom role'}</div>
      </div>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Role Name *</label>
          <input id="role-name" class="form-input" value="${escapeHtml(role?.name || '')}" placeholder="e.g., QA Lead"/>
        </div>
        <div class="form-group">
          <label class="form-label">Role Key${isCreate ? '' : ' (fixed)'}</label>
          <input id="role-key" class="form-input" ${isCreate ? '' : 'disabled'} value="${escapeHtml(role?.key || '')}" placeholder="lowercase_no_spaces"/>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <input id="role-desc" class="form-input" value="${escapeHtml(role?.description || '')}" placeholder="Short summary of what this role does"/>
      </div>

      <div class="perm-grid">${groupHtml}</div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveRoleFromModal('${escapeHtml(role?.id || '')}', ${isCreate})">
        <i class="fas fa-save"></i> ${isCreate ? 'Create Role' : 'Save Permissions'}
      </button>
    </div>
  `, 'modal-xl')
}

function togglePermGroup(moduleKey, on) {
  const wrap = document.querySelector(`[data-perm-group="${moduleKey}"]`)
  if (!wrap) return
  wrap.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = !!on })
}

async function saveRoleFromModal(roleId, isCreate) {
  const name = document.getElementById('role-name')?.value.trim() || ''
  const desc = document.getElementById('role-desc')?.value.trim() || ''
  const key  = document.getElementById('role-key')?.value.trim() || ''
  const checks = document.querySelectorAll('input[data-perm]')
  const permissions = []
  checks.forEach(cb => { if (cb.checked) permissions.push(cb.dataset.perm) })

  if (!name || name.length < 2) return toast('Role name must be at least 2 characters', 'error')

  try {
    if (isCreate) {
      await API.post('/settings/roles', { name, description: desc, key, permissions })
      toast('Role created', 'success')
    } else {
      await API.put(`/settings/roles/${roleId}`, { name, description: desc, permissions })
      toast('Role updated', 'success')
    }
    closeModal()
    await renderRolesPanel()
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

async function deleteCustomRole(roleId) {
  const role = (_rolesState.roles || []).find(r => r.id === roleId)
  if (!role) return
  if (!confirm(`Delete role "${role.name}"?`)) return
  try {
    await API.delete(`/settings/roles/${roleId}`)
    toast('Role deleted', 'success')
    await renderRolesPanel()
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

function profileRow2(icon, label, value) {
  return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #2A1812">
    <div style="width:32px;height:32px;border-radius:8px;background:rgba(255,122,69,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <i class="fas ${icon}" style="color:#FFB347;font-size:12px"></i>
    </div>
    <div><div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.04em">${label}</div><div style="font-size:13px;color:#e2e8f0;margin-top:2px">${value}</div></div>
  </div>`
}

async function saveCompanySettings2() {
  const body = {
    company_name: document.getElementById('cs-name')?.value.trim(),
    default_daily_hours: parseInt(document.getElementById('cs-daily')?.value || 8),
    default_working_days: parseInt(document.getElementById('cs-days')?.value || 22),
    alert_threshold_hours: parseInt(document.getElementById('cs-alert')?.value || 80) / 100,
    overtime_threshold: parseInt(document.getElementById('cs-overtime')?.value || 10),
    inactivity_days: parseInt(document.getElementById('cs-inactivity')?.value || 3),
  }
  try { await API.put('/settings', body); toast('Settings saved!', 'success') }
  catch(e) { toast(e.message, 'error') }
}

async function showAddHolidayModal2() {
  showModal(`
  <div class="modal-header"><h3>Add Holiday</h3><button class="close-btn" onclick="closeModal()">✕</button></div>
  <div class="modal-body">
    <div class="form-group"><label class="form-label">Holiday Name *</label><input class="form-input" id="h-name" placeholder="e.g., Diwali"/></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Date *</label><input class="form-input" id="h-date" type="date"/></div>
      <div class="form-group"><label class="form-label">Type</label>
        <select class="form-select" id="h-type"><option value="national">National</option><option value="regional">Regional</option><option value="optional">Optional</option></select></div>
    </div>
  </div>
  <div class="modal-footer">
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="addHoliday2()"><i class="fas fa-plus"></i>Add Holiday</button>
  </div>`)
}

async function addHoliday2() {
  const body = { name: document.getElementById('h-name')?.value.trim(), date: document.getElementById('h-date')?.value, type: document.getElementById('h-type')?.value }
  if (!body.name || !body.date) return toast('Name and date required', 'error')
  try {
    const r = await API.post('/settings/holidays', body)
    toast('Holiday added!', 'success')
    closeModal()
    window._settingsHolidays = [...(window._settingsHolidays||[]), r.holiday||body]
    switchSettingsTab2('holidays')
  } catch(e) { toast(e.message, 'error') }
}

async function deleteHoliday2(id) {
  if (!confirm('Delete this holiday?')) return
  try {
    await API.delete('/settings/holidays/' + id)
    toast('Deleted', 'info')
    document.getElementById('holiday-row-' + id)?.remove()
  } catch(e) { toast(e.message, 'error') }
}

function goHolidaysPage(page) {
  _holidaysPage = Math.max(1, Number(page) || 1)
  const el = document.getElementById('page-settings-view')
  if (el) { el.dataset.loaded=''; loadPage('settings-view', el) }
}

async function showAddTechModal2() {
  showModal(`
  <div class="modal-header"><h3>Add Technology</h3><button class="close-btn" onclick="closeModal()">✕</button></div>
  <div class="modal-body">
    <div class="form-group"><label class="form-label">Technology Name *</label><input class="form-input" id="tech-name" placeholder="e.g., React Native"/></div>
    <div class="form-group"><label class="form-label">Category</label>
      <select class="form-select" id="tech-cat">
        <option value="Frontend">Frontend</option><option value="Backend">Backend</option><option value="Database">Database</option>
        <option value="Mobile">Mobile</option><option value="DevOps">DevOps</option><option value="Other">Other</option>
      </select></div>
  </div>
  <div class="modal-footer">
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="addTech2()"><i class="fas fa-plus"></i>Add</button>
  </div>`)
}

async function addTech2() {
  const name = document.getElementById('tech-name')?.value.trim()
  const category = document.getElementById('tech-cat')?.value
  if (!name) return toast('Name required', 'error')
  try {
    await API.post('/settings/tech-stacks', { name, category })
    toast('Tech added!', 'success')
    closeModal()
    window._settingsTech = [...(window._settingsTech||[]), { name, category }]
    switchSettingsTab2('tech')
  } catch(e) { toast(e.message, 'error') }
}

async function deleteTech2(id) {
  try {
    await API.delete('/settings/tech-stacks/' + id)
    toast('Removed', 'info')
    window._settingsTech = (window._settingsTech||[]).filter(t => t.id !== id)
    switchSettingsTab2('tech')
  } catch(e) { toast(e.message, 'error') }
}

async function changePasswordProfile() {
  const oldPass = document.getElementById('prof-old')?.value
  const newPass = document.getElementById('prof-new')?.value
  const confPass = document.getElementById('prof-conf')?.value
  if (!oldPass || !newPass || !confPass) return toast('Fill all fields', 'error')
  if (newPass !== confPass) return toast('Passwords do not match', 'error')
  if (newPass.length < 8) return toast('Minimum 8 characters', 'error')
  try {
    await API.post('/auth/change-password', { current_password: oldPass, new_password: newPass })
    toast('Password changed!', 'success')
    document.getElementById('prof-old').value = ''
    document.getElementById('prof-new').value = ''
    document.getElementById('prof-conf').value = ''
  } catch(e) { toast(e.message, 'error') }
}
