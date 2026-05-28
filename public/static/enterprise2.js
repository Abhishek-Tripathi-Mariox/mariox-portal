// ═══════════════════════════════════════════════════════════
// enterprise2.js  – Documents, Timesheets, Reports, Alerts, Settings
// ═══════════════════════════════════════════════════════════

let _documentsCenterPage = 1
let _timesheetsViewPage = 1
let _alertsViewPage = 1
let _holidaysPage = 1
let _alertsSeverityFilter = ''
// Documents view mode — 'grid' = category-grouped cards (default), 'list' =
// flat table. Persisted to localStorage so the user's choice survives refresh.
let _documentsView = (typeof localStorage !== 'undefined' && localStorage.getItem('documentsView')) || 'grid'

function setDocumentsView(view) {
  if (view !== 'grid' && view !== 'list') return
  _documentsView = view
  try { localStorage.setItem('documentsView', view) } catch {}
  // Re-run the active filter with the new view — no need to re-fetch /documents.
  if (typeof window.applyDocFilter === 'function') {
    window.applyDocFilter()
    // Also re-render the toggle buttons so the active state flips.
    const wrap = document.getElementById('doc-view-toggle')
    if (wrap) {
      wrap.querySelectorAll('button[data-view]').forEach(btn => {
        btn.classList.toggle('btn-primary', btn.dataset.view === view)
        btn.classList.toggle('btn-outline', btn.dataset.view !== view)
      })
    }
  }
}
window.setDocumentsView = setDocumentsView

/* ── DOCUMENTS CENTER ──────────────────────────────────── */
async function renderDocumentsCenter(el) {
  el.innerHTML = `<div style="padding:40px;text-align:center;color:#7E7E8F"><i class="fas fa-spinner fa-spin" style="font-size:24px"></i></div>`
  try {
    const [docsData, projectsData] = await Promise.all([
      API.get('/documents'),
      API.get('/projects')
    ])
    const docs = docsData.documents || []
    const projects = projectsData.projects || projectsData || []
    const categories = docsData.categories || ['sow','brd','frd','uiux','wireframes','meeting_notes','technical','test_report','release','billing','contract','bid','other']
    _documentsCenterPage = 1

    // Built-in label table — merged with any admin-added custom categories
    // so filter chips and section headers show their friendly names.
    const categoryLabels = {
      sow:'Statement of Work', brd:'Business Requirements', frd:'Functional Requirements',
      uiux:'UI/UX Design', wireframes:'Wireframes', meeting_notes:'Meeting Notes',
      technical:'Technical Docs', test_report:'Test Reports', release:'Release Notes',
      billing:'Billing', contract:'Contracts', bid:'Bid Attachments', other:'Other'
    }
    for (const c of (docsData.custom_categories || [])) {
      if (c && c.value && !categoryLabels[c.value]) categoryLabels[c.value] = c.label || c.value
    }

    let filterProject = '', filterCategory = '', filterSearch = ''

    function buildDocGrid(filteredDocs) {
      if (filteredDocs.length === 0) return '<div class="empty-state"><i class="fas fa-folder-open"></i><p>No documents found</p></div>'
      // Dispatch to the active view. List view bypasses the per-category
      // grouping and renders a flat table for compact scanning.
      if (_documentsView === 'list') return buildDocList(filteredDocs)
      const byCat = {}
      filteredDocs.forEach(d => { const c = d.category||'other'; if(!byCat[c]) byCat[c]=[]; byCat[c].push(d) })
      return Object.entries(byCat).map(([cat, catDocs]) => `
        <div style="margin-bottom:24px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #2A1812">
            <span style="font-size:18px">${docCategoryIcon(cat)}</span>
            <span style="font-size:13px;font-weight:600;color:#e2e8f0">${categoryLabels[cat]||cat}</span>
            <span style="background:#2A1812;color:#7E7E8F;font-size:10px;padding:2px 7px;border-radius:10px">${catDocs.length}</span>
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
                    <div style="font-size:11px;color:#7E7E8F;margin-top:2px">${doc.project_name||'—'} • v${doc.version||'1.0'}</div>
                    ${doc.description ? `<div style="font-size:11px;color:#7E7E8F;margin-top:4px;line-height:1.4">${doc.description.substring(0,60)}${doc.description.length>60?'…':''}</div>` : ''}
                    <div style="display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap">
                      <span style="font-size:10px;color:#7E7E8F"><i class="fas fa-user" style="margin-right:3px"></i>${doc.uploaded_by_name||'—'}</span>
                      <span style="font-size:10px;color:#7E7E8F"><i class="fas fa-clock" style="margin-right:3px"></i>${fmtDate(doc.created_at)}</span>
                      <span class="badge ${doc.visibility==='all'?'badge-done':doc.visibility==='client'?'badge-inprogress':'badge-review'}" style="font-size:9px">${doc.visibility||'all'}</span>
                    </div>
                  </div>
                </div>
                <div style="display:flex;gap:6px;margin-top:12px">
                  <button type="button" class="btn btn-sm btn-outline" style="flex:1" onclick="viewDocPreview('${doc.id}', '${encodeURIComponent(doc.file_url||'')}', '${encodeURIComponent(doc.file_type||'')}', '${encodeURIComponent(doc.title||doc.file_name||'Document')}')">
                    <i class="fas fa-eye"></i>View
                  </button>
                  <a href="${doc.file_url||'#'}" download class="btn btn-sm btn-primary" style="flex:1;text-align:center;text-decoration:none">
                    <i class="fas fa-download"></i>Download
                  </a>
                  ${['admin','pm'].includes(_user.role) && !doc.read_only ? `<button class="btn btn-sm btn-outline" onclick="deleteDoc('${doc.id}')" style="color:#FF5E3A;border-color:#FF5E3A"><i class="fas fa-trash"></i></button>` : ''}
                </div>
              </div>`).join('')}
          </div>
        </div>`).join('')
    }

    // Flat table — same docs, no category grouping. Designed for scanning
    // a lot of documents at once; the category is shown as a pill in its
    // own column instead of as a section header.
    function buildDocList(filteredDocs) {
      const canDelete = ['admin','pm'].includes(_user.role)
      const rows = filteredDocs.map(doc => {
        const titleSafe = String(doc.title || doc.file_name || 'Untitled').replace(/'/g, "\\'")
        return `
        <tr class="doc-list-row" style="border-bottom:1px solid rgba(255,255,255,.04)">
          <td style="padding:10px 12px;vertical-align:middle">
            <div style="display:flex;align-items:center;gap:10px;min-width:0">
              <div style="width:32px;height:32px;border-radius:7px;background:${docCategoryColor(doc.category)};display:flex;align-items:center;justify-content:center;flex-shrink:0">
                <i class="fas ${docFTypeIcon(doc.file_type)}" style="color:#fff;font-size:13px"></i>
              </div>
              <div style="min-width:0">
                <div style="font-size:13px;font-weight:600;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:320px">${escapeHtml(doc.title || doc.file_name || 'Untitled')}</div>
                ${doc.description ? `<div style="font-size:11px;color:#7E7E8F;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:320px">${escapeHtml(doc.description)}</div>` : ''}
              </div>
            </div>
          </td>
          <td style="padding:10px 12px;font-size:12px;vertical-align:middle">
            <span style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;background:${docCategoryColor(doc.category)}22;color:${docCategoryColor(doc.category)};font-size:11px;font-weight:600">${docCategoryIcon(doc.category)} ${escapeHtml(categoryLabels[doc.category] || doc.category || 'other')}</span>
          </td>
          <td style="padding:10px 12px;font-size:12px;color:#cbd5e1;vertical-align:middle">${escapeHtml(doc.project_name || '—')}</td>
          <td style="padding:10px 12px;font-size:12px;color:#cbd5e1;vertical-align:middle;text-align:center">v${escapeHtml(doc.version || '1.0')}</td>
          <td style="padding:10px 12px;font-size:12px;color:#cbd5e1;vertical-align:middle">${escapeHtml(doc.uploaded_by_name || '—')}</td>
          <td style="padding:10px 12px;font-size:12px;color:#7E7E8F;vertical-align:middle;white-space:nowrap">${fmtDate(doc.created_at)}</td>
          <td style="padding:10px 12px;vertical-align:middle">
            <span class="badge ${doc.visibility === 'all' ? 'badge-done' : doc.visibility === 'client' ? 'badge-inprogress' : 'badge-review'}" style="font-size:10px">${escapeHtml(doc.visibility || 'all')}</span>
          </td>
          <td style="padding:10px 12px;text-align:right;vertical-align:middle;white-space:nowrap">
            <button type="button" class="btn btn-xs btn-outline" onclick="viewDocPreview('${doc.id}','${encodeURIComponent(doc.file_url||'')}','${encodeURIComponent(doc.file_type||'')}','${encodeURIComponent(doc.title||doc.file_name||'Document')}')" title="Preview"><i class="fas fa-eye"></i></button>
            <a href="${doc.file_url || '#'}" download class="btn btn-xs btn-primary" style="text-decoration:none" title="Download"><i class="fas fa-download"></i></a>
            ${canDelete && !doc.read_only ? `<button class="btn btn-xs btn-outline" onclick="deleteDoc('${doc.id}')" style="color:#FF5E3A;border-color:#FF5E3A" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
          </td>
        </tr>`
      }).join('')
      return `
        <div style="overflow-x:auto;background:var(--surface,rgba(255,255,255,.03));border:1px solid var(--border,rgba(255,255,255,.08));border-radius:12px">
          <table style="width:100%;border-collapse:collapse;min-width:900px">
            <thead>
              <tr style="background:rgba(169,112,255,.08);border-bottom:1px solid rgba(169,112,255,.18);text-align:left">
                <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#C9A7FF;text-transform:uppercase;letter-spacing:.5px">Document</th>
                <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#C9A7FF;text-transform:uppercase;letter-spacing:.5px">Category</th>
                <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#C9A7FF;text-transform:uppercase;letter-spacing:.5px">Project</th>
                <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#C9A7FF;text-transform:uppercase;letter-spacing:.5px;text-align:center">Ver</th>
                <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#C9A7FF;text-transform:uppercase;letter-spacing:.5px">Uploaded by</th>
                <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#C9A7FF;text-transform:uppercase;letter-spacing:.5px">Date</th>
                <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#C9A7FF;text-transform:uppercase;letter-spacing:.5px">Visibility</th>
                <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#C9A7FF;text-transform:uppercase;letter-spacing:.5px;text-align:right">Actions</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`
    }

    function renderFilteredDocs(filteredDocs) {
      // Table rows are much more compact than cards — show more per page in
      // list view so users don't paginate constantly when scanning.
      const perPage = _documentsView === 'list' ? 25 : 8
      const pagination = paginateClient(filteredDocs, _documentsCenterPage, perPage)
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
      <div class="page-actions" style="display:flex;gap:8px;flex-wrap:wrap">
        ${(['admin','pm','pc'].includes(_user.role) || (typeof hasAnyPermission === 'function' && hasAnyPermission(['documents.upload']))) ? `<button class="btn btn-outline" onclick="openManageDocCategories()" title="Add or remove custom categories"><i class="fas fa-tags"></i> Manage Categories</button>` : ''}
        ${(['admin','pm','pc'].includes(_user.role) || (typeof hasAnyPermission === 'function' && hasAnyPermission(['documents.upload']))) ? `<button class="btn btn-primary" onclick="showUploadDocModal()"><i class="fas fa-upload"></i>Upload Document</button>` : ''}
      </div>
    </div>

    <!-- Filter toolbar — compact inline row. The previous design wrapped the
         inputs in a padded card which doubled the row's vertical footprint;
         the standalone form-input / form-select are full-height by default
         too. We override both with compact inline sizing here. -->
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
      <div style="position:relative;flex:0 1 260px;min-width:180px">
        <i class="fas fa-search" style="position:absolute;left:11px;top:50%;transform:translateY(-50%);font-size:11px;color:var(--text-muted);pointer-events:none"></i>
        <input class="form-input" placeholder="Search documents…" oninput="window._docFilter=this.value.toLowerCase();applyDocFilter()" style="width:100%;height:32px;padding:0 12px 0 30px;font-size:12.5px"/>
      </div>
      <div style="flex:0 1 200px;min-width:160px">
        ${searchableSelect('doc-project-filter',
          [{ value: '', label: 'All Projects' }].concat(projects.map(p => ({ value: p.id, label: p.name }))),
          '',
          { placeholder: 'All Projects', onChange: (id) => { window._docProject = id || ''; if (window.applyDocFilter) window.applyDocFilter() } }
        )}
      </div>
      <div style="flex:0 1 200px;min-width:160px">
        ${searchableSelect('doc-category-filter',
          [{ value: '', label: 'All Categories' }].concat(categories.map(c => ({ value: c, label: categoryLabels[c] || c }))),
          '',
          { placeholder: 'All Categories', onChange: (id) => { window._docCategory = id || ''; if (window.applyDocFilter) window.applyDocFilter() } }
        )}
      </div>
      <div id="doc-view-toggle" style="display:flex;gap:4px;margin-left:auto">
        <button type="button" class="btn btn-xs ${_documentsView === 'grid' ? 'btn-primary' : 'btn-outline'}" data-view="grid" onclick="setDocumentsView('grid')" title="Grid view" aria-label="Grid view"><i class="fas fa-th-large"></i> Grid</button>
        <button type="button" class="btn btn-xs ${_documentsView === 'list' ? 'btn-primary' : 'btn-outline'}" data-view="list" onclick="setDocumentsView('list')" title="List view" aria-label="List view"><i class="fas fa-list"></i> List</button>
      </div>
    </div>

    <div id="doc-grid"></div>
    <div id="doc-pager"></div>`

    // Trim the picker inputs to match the 32px toolbar — the searchableSelect
    // helper renders a stock form-input which is taller than our compact row.
    for (const pid of ['doc-project-filter', 'doc-category-filter']) {
      const inp = document.getElementById(pid + '-search')
      if (inp) {
        inp.style.height = '32px'
        inp.style.padding = '0 28px 0 10px'
        inp.style.fontSize = '12.5px'
      }
    }

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

// Built-in category labels — used to render the dropdown when no custom
// label is available. Custom categories supply their own label.
window._docCategoryLabels = {
  sow: 'Statement of Work', brd: 'Business Requirements', frd: 'Functional Requirements',
  uiux: 'UI/UX Design', wireframes: 'Wireframes', meeting_notes: 'Meeting Notes',
  technical: 'Technical Docs', test_report: 'Test Reports', release: 'Release Notes',
  billing: 'Billing', contract: 'Contracts', bid: 'Bids', other: 'Other',
}

async function fetchDocCategories() {
  try {
    const r = await API.get('/documents/categories')
    const builtin = (r.builtin_categories || []).map(v => ({ v, l: window._docCategoryLabels[v] || v, builtin: true }))
    const custom = (r.custom_categories || []).map(c => ({ v: c.value, l: c.label || c.value, builtin: false, id: c.id }))
    return [...builtin, ...custom]
  } catch {
    // Fall back to the static built-in list if the endpoint is unavailable.
    return Object.entries(window._docCategoryLabels).map(([v, l]) => ({ v, l, builtin: true }))
  }
}

async function showUploadDocModal() {
  const [projData, catOpts] = await Promise.all([API.get('/projects'), fetchDocCategories()])
  const projects = projData.projects || projData || []
  window._udCatOpts = catOpts
  window._udFiles = []
  showModal(`
  <div class="modal-header"><h3><i class="fas fa-upload" style="color:#A970FF"></i> Upload Documents</h3><button class="close-btn" onclick="closeModal()">✕</button></div>
  <div class="modal-body">
    <div class="form-row">
      <div class="form-group"><label class="form-label">Project *</label>
        <select class="form-select" id="ud-project"><option value="">Select…</option>${projects.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label" style="display:flex;align-items:center;justify-content:space-between">
          <span>Category *</span>
          <button type="button" class="btn btn-xs btn-outline" onclick="udAddDocCategory()" title="Add a new category" style="padding:2px 8px;font-size:11px"><i class="fas fa-plus"></i> New category</button>
        </label>
        <select class="form-select" id="ud-category" onchange="if(this.value==='__new__'){udAddDocCategory()}">${catOpts.map(c=>`<option value="${c.v}">${c.l}</option>`).join('')}<option value="__new__" style="font-style:italic;color:#C9A7FF">＋ Add new category…</option></select></div>
    </div>

    <div class="form-group">
      <label class="form-label">Files * <span style="font-weight:400;color:#7E7E8F;font-size:11px">(pick one or many — max 25 MB each)</span></label>
      <div id="ud-dropzone" style="border:2px dashed rgba(169,112,255,.35);border-radius:10px;padding:20px;text-align:center;cursor:pointer;background:rgba(169,112,255,.04);transition:.2s" onclick="document.getElementById('ud-files').click()">
        <i class="fas fa-cloud-upload-alt" style="font-size:32px;color:#A970FF;display:block;margin-bottom:8px"></i>
        <div style="font-size:13px;color:#e2e8f0;font-weight:600">Click to choose files from your computer</div>
        <div style="font-size:11px;color:#7E7E8F;margin-top:4px">or drop files here • PDF, images, docs, videos</div>
      </div>
      <input id="ud-files" type="file" multiple style="display:none" onchange="udOnFilesPicked(this.files)"/>
      <div id="ud-files-list" style="display:flex;flex-direction:column;gap:6px;margin-top:10px"></div>
    </div>

    <div class="form-group"><label class="form-label">Title prefix (optional)</label><input class="form-input" id="ud-title" placeholder="If blank, each file's name is used as its title"/></div>
    <div class="form-group"><label class="form-label">Description (applied to all)</label><textarea class="form-textarea" id="ud-desc" style="min-height:50px" placeholder="Brief description…"></textarea></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Version</label><input class="form-input" id="ud-version" value="1.0" placeholder="1.0"/></div>
      <div class="form-group"><label class="form-label">Visibility</label>
        <select class="form-select" id="ud-visibility">
          <option value="all">All (Internal + Client)</option>
          <option value="client">Client Visible Only</option>
          <option value="internal">Internal Only</option>
        </select>
      </div>
    </div>
    <div class="form-group"><label class="form-label">Tags (comma separated)</label><input class="form-input" id="ud-tags" placeholder="sow, phase1, delivery"/></div>

    <div id="ud-progress" style="display:none;margin-top:10px">
      <div style="font-size:12px;color:#7E7E8F;margin-bottom:6px"><span id="ud-progress-label">Uploading…</span></div>
      <div class="progress-bar"><div id="ud-progress-bar" class="progress-fill amber" style="width:0%"></div></div>
    </div>
  </div>
  <div class="modal-footer">
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="ud-submit-btn" onclick="doUploadDoc()"><i class="fas fa-upload"></i>Upload</button>
  </div>`, 'modal-lg')

  // Drag and drop on the dropzone
  const dz = document.getElementById('ud-dropzone')
  if (dz) {
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.style.background = 'rgba(169,112,255,.12)' })
    dz.addEventListener('dragleave', () => { dz.style.background = 'rgba(169,112,255,.04)' })
    dz.addEventListener('drop', e => { e.preventDefault(); dz.style.background = 'rgba(169,112,255,.04)'; if (e.dataTransfer?.files) udOnFilesPicked(e.dataTransfer.files) })
  }
}

// In-app prompt overlay — replaces the ugly native window.prompt for adding
// a new document category. Returns a Promise that resolves to the typed
// string (trimmed) or null if the user cancelled. Stacked above the existing
// Upload modal without disturbing it (separate root, higher z-index).
function udOpenCategoryPrompt() {
  return new Promise(resolve => {
    let root = document.getElementById('ud-cat-prompt-root')
    if (root) root.remove()
    root = document.createElement('div')
    root.id = 'ud-cat-prompt-root'
    root.innerHTML = `
      <div class="modal-overlay" style="z-index:1100;background:rgba(0,0,0,.55)">
        <div class="modal" style="max-width:420px;width:90%">
          <div class="modal-header">
            <h3 style="display:flex;align-items:center;gap:8px;margin:0"><i class="fas fa-folder-plus" style="color:#A970FF"></i> New Category</h3>
            <button class="close-btn" id="ud-cat-prompt-x" type="button">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">Category name</label>
              <input class="form-input" id="ud-cat-prompt-input" placeholder='e.g. "Design Review", "QA Sign-off"' autocomplete="off"/>
              <div style="font-size:11px;color:var(--text-muted);margin-top:6px">Once added, this category will be available to everyone in the workspace.</div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-outline" id="ud-cat-prompt-cancel" type="button">Cancel</button>
            <button class="btn btn-primary" id="ud-cat-prompt-ok" type="button"><i class="fas fa-plus"></i> Add Category</button>
          </div>
        </div>
      </div>`
    document.body.appendChild(root)

    const input = root.querySelector('#ud-cat-prompt-input')
    const cleanup = (value) => { root.remove(); resolve(value) }
    root.querySelector('#ud-cat-prompt-x').onclick = () => cleanup(null)
    root.querySelector('#ud-cat-prompt-cancel').onclick = () => cleanup(null)
    root.querySelector('#ud-cat-prompt-ok').onclick = () => {
      const v = (input.value || '').trim()
      if (!v) { input.focus(); return }
      cleanup(v)
    }
    // Outside-click on this nested overlay cancels (no draft to preserve).
    root.querySelector('.modal-overlay').addEventListener('click', e => {
      if (e.target === e.currentTarget) cleanup(null)
    })
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); root.querySelector('#ud-cat-prompt-ok').click() }
      else if (e.key === 'Escape') { e.preventDefault(); cleanup(null) }
    })
    setTimeout(() => input.focus(), 30)
  })
}

// Prompt the user for a new category name, POST it to the server and re-render
// the dropdown with the new entry pre-selected. Called from both the "+ New
// category" button and the sentinel "__new__" option at the bottom of the
// dropdown — whichever the user clicks first.
// ── Manage Document Categories ────────────────────────────────
// Two-pane modal: built-in categories (read-only) on top, custom ones
// underneath with delete buttons + an inline add row. Mirrors the same
// pattern used for personal-task statuses.
async function openManageDocCategories() {
  let cats = []
  try {
    const r = await API.get('/documents/categories')
    cats = [
      ...(r.builtin_categories || []).map(v => ({ value: v, label: window._docCategoryLabels?.[v] || v, builtin: true })),
      ...(r.custom_categories || []).map(c => ({ value: c.value, label: c.label || c.value, builtin: false, id: c.id })),
    ]
  } catch (e) { toast('Failed to load categories: ' + (e.message || e), 'error'); return }
  const builtin = cats.filter(c => c.builtin)
  const custom = cats.filter(c => !c.builtin)
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-tags" style="color:#A970FF;margin-right:6px"></i> Manage Categories</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:18px">
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px">Built-in (cannot be removed)</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${builtin.map(c => `<span class="badge badge-todo">${escapeInbox(c.label)}</span>`).join('')}
        </div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px">Custom categories (${custom.length})</div>
        <div id="doc-cat-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">
          ${custom.length ? custom.map(c => `
            <div id="doc-cat-row-${escapeInbox(c.id)}" style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(169,112,255,.06);border:1px solid rgba(169,112,255,.18);border-radius:8px">
              <i class="fas fa-folder" style="color:#A970FF"></i>
              <div id="doc-cat-body-${escapeInbox(c.id)}" style="flex:1;min-width:0">
                <div style="font-size:13px;color:#e2e8f0">${escapeInbox(c.label)}</div>
                <div style="font-size:10px;color:#7E7E8F;font-family:monospace">${escapeInbox(c.value)}</div>
              </div>
              <button class="btn btn-xs btn-outline" title="Rename" onclick="startEditDocCategory('${escapeInbox(c.id)}','${escapeInbox(c.label).replace(/'/g, "\\'")}')"><i class="fas fa-pencil"></i></button>
              <button class="btn btn-xs btn-outline" style="color:#FF5E3A;border-color:#FF5E3A" title="Delete" onclick="deleteDocCategory('${escapeInbox(c.id)}','${escapeInbox(c.label).replace(/'/g, "\\'")}')"><i class="fas fa-trash"></i></button>
            </div>`).join('') : '<div class="empty-inline"><i class="fas fa-circle-plus"></i><span>No custom categories yet. Add one below.</span></div>'}
        </div>
        <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
          <div class="form-group" style="flex:1;min-width:200px;margin:0">
            <label class="form-label">Category name</label>
            <input id="doc-cat-new-label" class="form-input" placeholder='e.g. "Design Review", "QA Sign-off"' maxlength="60" autocomplete="off"/>
          </div>
          <button class="btn btn-primary" onclick="addDocCategoryFromManager()"><i class="fas fa-plus"></i> Add</button>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:6px">Removing a category is allowed only if no documents are using it server-side.</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Close</button>
    </div>
  `, 'modal-lg')
}

async function addDocCategoryFromManager() {
  const label = (document.getElementById('doc-cat-new-label')?.value || '').trim()
  if (!label) { toast('Enter a category name', 'error'); return }
  try {
    await API.post('/documents/categories', { label })
    toast('Category added', 'success', 1200)
    // Re-render the manager so the new entry shows up immediately, and bust
    // the docs list cache so its filter chip refreshes on next load.
    await openManageDocCategories()
    const docEl = document.getElementById('page-documents-center')
    if (docEl) docEl.dataset.loaded = ''
  } catch (e) { toast(e.message || 'Failed to add', 'error') }
}

// Swap the row's body for an inline input + Save/Cancel. The slug is kept
// (server enforces this) so only the human label changes.
function startEditDocCategory(id, currentLabel) {
  const body = document.getElementById('doc-cat-body-' + id)
  const row = document.getElementById('doc-cat-row-' + id)
  if (!body || !row) return
  body.innerHTML = `
    <input id="doc-cat-edit-input-${id}" class="form-input" value="${escapeInbox(currentLabel)}" maxlength="60" autocomplete="off"
      onkeydown="if(event.key==='Enter'){event.preventDefault();saveEditDocCategory('${id}')} else if(event.key==='Escape'){event.preventDefault();cancelEditDocCategory()}"
      style="font-size:13px;padding:4px 8px;background:rgba(255,255,255,.04);border:1px solid rgba(169,112,255,.45);border-radius:6px;color:#e2e8f0;width:100%"/>
  `
  // Swap the trailing buttons too — replace edit/delete with save/cancel.
  const actions = row.querySelectorAll('button')
  actions.forEach(b => b.remove())
  const save = document.createElement('button')
  save.className = 'btn btn-xs btn-primary'
  save.title = 'Save'
  save.innerHTML = '<i class="fas fa-check"></i>'
  save.onclick = () => saveEditDocCategory(id)
  const cancel = document.createElement('button')
  cancel.className = 'btn btn-xs btn-outline'
  cancel.title = 'Cancel'
  cancel.innerHTML = '<i class="fas fa-times"></i>'
  cancel.onclick = () => cancelEditDocCategory()
  row.appendChild(save)
  row.appendChild(cancel)
  setTimeout(() => {
    const inp = document.getElementById('doc-cat-edit-input-' + id)
    if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length) }
  }, 30)
}

function cancelEditDocCategory() {
  // Easiest path: just re-open the manager so the cancelled row reverts.
  openManageDocCategories()
}

async function saveEditDocCategory(id) {
  const inp = document.getElementById('doc-cat-edit-input-' + id)
  const label = (inp?.value || '').trim()
  if (!label) { toast('Name cannot be empty', 'error'); return }
  try {
    await API.put('/documents/categories/' + id, { label })
    toast('Category renamed', 'success', 1200)
    await openManageDocCategories()
    const docEl = document.getElementById('page-documents-center')
    if (docEl) docEl.dataset.loaded = ''
  } catch (e) { toast(e.message || 'Failed to rename', 'error') }
}

async function deleteDocCategory(id, label) {
  if (!confirm(`Remove "${label}" category?`)) return
  try {
    await API.delete('/documents/categories/' + id)
    toast('Category removed', 'success', 1200)
    await openManageDocCategories()
    const docEl = document.getElementById('page-documents-center')
    if (docEl) docEl.dataset.loaded = ''
  } catch (e) { toast(e.message || 'Failed to remove', 'error') }
}

async function udAddDocCategory() {
  const sel = document.getElementById('ud-category')
  // If the change came from the sentinel option, restore the previous choice
  // before opening the prompt so cancelling leaves the dropdown unchanged.
  const fallback = sel && sel.options.length > 1 ? sel.options[0].value : 'other'
  if (sel && sel.value === '__new__') sel.value = fallback
  const name = await udOpenCategoryPrompt()
  if (!name) return
  try {
    const r = await API.post('/documents/categories', { label: name })
    const created = r.category || r
    if (typeof toast === 'function') toast('Category added', 'success', 1500)
    // Refresh the dropdown so the next picker shows the new option, and select
    // it automatically for this upload.
    window._udCatOpts = await fetchDocCategories()
    if (sel) {
      sel.innerHTML = window._udCatOpts.map(c => `<option value="${c.v}">${c.l}</option>`).join('')
        + `<option value="__new__" style="font-style:italic;color:#C9A7FF">＋ Add new category…</option>`
      sel.value = created.value
    }
  } catch (e) {
    if (typeof toast === 'function') toast(e.message || 'Failed to add category', 'error')
  }
}

function udOnFilesPicked(fileList) {
  const incoming = Array.from(fileList || [])
  const existing = window._udFiles || []
  // Append (don't replace) so users can pick across multiple choose-file rounds
  for (const f of incoming) {
    if (!existing.find(x => x.name === f.name && x.size === f.size)) existing.push(f)
  }
  window._udFiles = existing
  udRenderFilesList()
}

function udRemoveFile(idx) {
  const files = window._udFiles || []
  files.splice(idx, 1)
  window._udFiles = files
  udRenderFilesList()
}

function udRenderFilesList() {
  const list = document.getElementById('ud-files-list')
  if (!list) return
  const files = window._udFiles || []
  if (!files.length) { list.innerHTML = ''; return }
  list.innerHTML = files.map((f, i) => {
    const sizeMb = (f.size / (1024 * 1024)).toFixed(2)
    const tooBig = f.size > 25 * 1024 * 1024
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(11,11,13,.5);border:1px solid rgba(179,136,255,.18);border-radius:8px">
        <i class="fas ${docFTypeIcon(f.type)}" style="color:#A970FF;font-size:16px"></i>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${f.name}</div>
          <div style="font-size:11px;color:${tooBig?'#FF5E3A':'#7E7E8F'}">${sizeMb} MB${tooBig?' — exceeds 25 MB limit':''} • ${f.type || 'unknown'}</div>
        </div>
        <button type="button" class="btn btn-sm btn-outline" style="border-color:rgba(255,94,58,.4);color:#FF5E3A" onclick="udRemoveFile(${i})"><i class="fas fa-times"></i></button>
      </div>`
  }).join('')
}

function udUploadFileToServer(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/uploads', true)
    const token = (window._token || (typeof _token !== 'undefined' && _token) || localStorage.getItem('token'))
    if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token)
    xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)) }
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

async function doUploadDoc() {
  const project_id = document.getElementById('ud-project')?.value
  const category = document.getElementById('ud-category')?.value
  const titlePrefix = document.getElementById('ud-title')?.value.trim()
  const description = document.getElementById('ud-desc')?.value.trim()
  const version = document.getElementById('ud-version')?.value.trim() || '1.0'
  const visibility = document.getElementById('ud-visibility')?.value
  const tags = document.getElementById('ud-tags')?.value.split(',').map(t=>t.trim()).filter(Boolean)
  const files = window._udFiles || []

  if (!project_id) return toast('Select a project', 'error')
  if (!files.length) return toast('Pick at least one file', 'error')
  for (const f of files) {
    if (f.size > 25 * 1024 * 1024) return toast(`"${f.name}" exceeds the 25 MB limit`, 'error')
  }

  const submitBtn = document.getElementById('ud-submit-btn')
  const progress = document.getElementById('ud-progress')
  const progressBar = document.getElementById('ud-progress-bar')
  const progressLabel = document.getElementById('ud-progress-label')
  if (submitBtn) submitBtn.disabled = true
  if (progress) progress.style.display = ''

  let okCount = 0, failCount = 0
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    if (progressLabel) progressLabel.textContent = `Uploading ${i+1}/${files.length}: ${f.name}`
    try {
      const uploaded = await udUploadFileToServer(f, pct => {
        if (progressBar) progressBar.style.width = (((i / files.length) * 100) + (pct / files.length)) + '%'
      })
      const baseName = f.name.replace(/\.[^.]+$/, '')
      const docTitle = titlePrefix ? `${titlePrefix} — ${baseName}` : baseName
      await API.post('/documents', {
        project_id,
        title: docTitle.slice(0, 200),
        description: description || null,
        category,
        file_url: uploaded.url,
        file_name: uploaded.file_name || f.name,
        file_type: uploaded.file_type || f.type,
        file_size: uploaded.file_size || f.size,
        version,
        visibility,
        is_client_visible: visibility !== 'internal' ? 1 : 0,
        tags,
      })
      okCount++
    } catch (e) {
      failCount++
      toast(`"${f.name}" failed: ${e.message}`, 'error')
    }
  }

  if (progressBar) progressBar.style.width = '100%'
  if (okCount) toast(`${okCount} document${okCount===1?'':'s'} uploaded${failCount?` (${failCount} failed)`:''}`, failCount?'warning':'success')
  if (okCount) {
    closeModal()
    const docEl = document.getElementById('page-documents-center'); if (docEl) { docEl.dataset.loaded=''; renderDocumentsCenter(docEl) }
  } else {
    if (submitBtn) submitBtn.disabled = false
    if (progress) progress.style.display = 'none'
  }
}

async function deleteDoc(id) {
  if (!confirm('Delete this document?')) return
  try { await API.delete('/documents/' + id); toast('Deleted', 'success')
    const docEl = document.getElementById('page-documents-center'); if (docEl) { docEl.dataset.loaded=''; renderDocumentsCenter(docEl) } }
  catch(e) { toast(e.message, 'error') }
}

// Track active blob URLs so we can revoke them when the modal closes,
// otherwise they leak memory across previews.
let _docPreviewBlobUrl = null
function _revokeDocPreviewBlob() {
  if (_docPreviewBlobUrl) {
    try { URL.revokeObjectURL(_docPreviewBlobUrl) } catch {}
    _docPreviewBlobUrl = null
  }
}

// Preview a document inline. We fetch the file through the server proxy
// (`/api/documents/:id/preview`) which streams it back with `inline`
// disposition, then wrap the response in a Blob URL so the iframe/img/video
// embed can never trigger a download — the browser sees a same-origin blob.
async function viewDocPreview(id, _encodedUrl, encodedType, encodedTitle) {
  const fallbackUrl = decodeURIComponent(_encodedUrl || '')
  const type = decodeURIComponent(encodedType || '').toLowerCase()
  const title = decodeURIComponent(encodedTitle || 'Document')

  _revokeDocPreviewBlob()

  // Open a placeholder modal immediately so the user knows something is happening.
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-eye" style="color:#A970FF;margin-right:6px"></i>${escapeHtml(title)}</h3>
      <button class="close-btn" onclick="_revokeDocPreviewBlob();closeModal()">✕</button>
    </div>
    <div class="modal-body" id="doc-preview-body" style="padding:0;min-height:300px">
      <div style="padding:40px;text-align:center;color:#7E7E8F"><i class="fas fa-spinner fa-spin" style="font-size:24px;color:#A970FF"></i><div style="margin-top:12px;font-size:13px">Loading preview…</div></div>
    </div>
  `, 'modal-xl')

  let blobUrl = ''
  let resolvedType = type
  try {
    const res = await fetch('/api/documents/' + encodeURIComponent(id) + '/preview', {
      headers: { 'Authorization': 'Bearer ' + _token },
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const blob = await res.blob()
    blobUrl = URL.createObjectURL(blob)
    _docPreviewBlobUrl = blobUrl
    if (blob.type) resolvedType = blob.type.toLowerCase()
  } catch (e) {
    const body = document.getElementById('doc-preview-body')
    if (body) {
      body.innerHTML = `
        <div style="padding:40px;text-align:center;color:#7E7E8F">
          <i class="fas fa-triangle-exclamation" style="font-size:36px;color:#A970FF;margin-bottom:12px;display:block"></i>
          <p style="font-size:13px;margin-bottom:14px">Preview failed: ${escapeHtml(e.message || 'unknown error')}</p>
          ${fallbackUrl ? `<a href="${fallbackUrl}" target="_blank" rel="noopener" class="btn btn-primary btn-sm" style="text-decoration:none"><i class="fas fa-external-link-alt"></i> Open in new tab</a>` : ''}
        </div>`
    }
    return
  }

  const isImage = /^image\//.test(resolvedType)
  const isPdf = resolvedType === 'application/pdf'
  const isVideo = /^video\//.test(resolvedType)
  const isAudio = /^audio\//.test(resolvedType)
  const isText = /^text\//.test(resolvedType) || resolvedType === 'application/json' || resolvedType === 'application/xml'

  let inner
  if (isImage) {
    inner = `<div style="display:flex;align-items:center;justify-content:center;background:#0a0a0a;min-height:400px"><img src="${blobUrl}" alt="${escapeHtml(title)}" style="max-width:100%;max-height:75vh;object-fit:contain"/></div>`
  } else if (isPdf) {
    inner = `<iframe src="${blobUrl}" style="width:100%;height:75vh;border:0;background:#0a0a0a"></iframe>`
  } else if (isVideo) {
    inner = `<div style="display:flex;align-items:center;justify-content:center;background:#0a0a0a;padding:20px"><video src="${blobUrl}" controls autoplay style="max-width:100%;max-height:70vh"></video></div>`
  } else if (isAudio) {
    inner = `<div style="display:flex;align-items:center;justify-content:center;padding:40px"><audio src="${blobUrl}" controls style="width:100%;max-width:520px"></audio></div>`
  } else if (isText) {
    inner = `<iframe src="${blobUrl}" style="width:100%;height:70vh;border:0;background:#fff"></iframe>`
  } else {
    inner = `
      <div style="padding:40px;text-align:center;color:#7E7E8F">
        <i class="fas fa-file" style="font-size:48px;color:#A970FF;margin-bottom:16px;display:block"></i>
        <p style="font-size:14px;margin-bottom:6px">Inline preview is not available for this file type.</p>
        <p style="font-size:12px;color:#7E7E8F;margin-bottom:20px">Type: ${escapeHtml(resolvedType || 'unknown')}</p>
        <a href="${blobUrl}" target="_blank" rel="noopener" class="btn btn-primary btn-sm" style="text-decoration:none"><i class="fas fa-external-link-alt"></i> Open in new tab</a>
      </div>`
  }

  const body = document.getElementById('doc-preview-body')
  if (body) body.innerHTML = inner
}

/* ── TIMESHEETS VIEW ───────────────────────────────────── */
async function renderTimesheetsView(el) {
  el.innerHTML = `<div style="padding:40px;text-align:center;color:#7E7E8F"><i class="fas fa-spinner fa-spin" style="font-size:24px"></i></div>`
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
          <h3 style="font-size:14px;font-weight:600;color:#e2e8f0;margin:0"><i class="fas fa-plus" style="color:#A970FF;margin-right:8px"></i>New Time Entry</h3>
          <button onclick="document.getElementById('ts-quick-form').style.display='none'" style="background:none;border:none;color:#7E7E8F;cursor:pointer">✕</button>
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
        <div id="ts-table-wrap"><div style="padding:24px;text-align:center;color:#7E7E8F"><i class="fas fa-spinner fa-spin"></i> Loading…</div></div>
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
  if (wrap) wrap.innerHTML = '<div style="padding:24px;text-align:center;color:#7E7E8F"><i class="fas fa-spinner fa-spin"></i></div>'

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
        ${miniStatCard('Total Hours', total.toFixed(1)+'h', '#A970FF','fa-clock')}
        ${miniStatCard('Billable', billable.toFixed(1)+'h', '#58C68A','fa-check-circle')}
        ${miniStatCard('Non-Billable', (total-billable).toFixed(1)+'h', '#7E7E8F','fa-ban')}
        ${miniStatCard('Pending Approval', pending, '#C9A7FF','fa-hourglass-half')}`
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
            <td><div style="font-size:12px;color:#7E7E8F;white-space:nowrap">${l.project_name||'—'}</div><div style="font-size:10px;color:#7E7E8F">${l.project_code||''}</div></td>
            <td style="font-size:12px;color:#7E7E8F">${l.module_name||'—'}</td>
            <td style="max-width:200px"><div style="font-size:12px;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${l.task_description||''}">${(l.task_description||'—').substring(0,60)}${(l.task_description||'').length>60?'…':''}</div>${l.blocker_remarks?`<div style="font-size:10px;color:#FF5E3A;margin-top:2px"><i class="fas fa-exclamation-triangle" style="margin-right:3px"></i>${l.blocker_remarks.substring(0,40)}</div>`:''}</td>
            <td style="font-weight:600;color:${(l.hours_consumed||0)>8?'#C9A7FF':'#e2e8f0'}">${parseFloat(l.hours_consumed||0).toFixed(1)}h${l.is_billable?'':' <span style="font-size:9px;color:#7E7E8F">(NB)</span>'}</td>
            <td><span class="badge ${statusColors[l.status]||'badge-todo'}">${l.status||'—'}</span></td>
            <td><span class="badge ${approvalColors[l.approval_status]||'badge-todo'}">${l.approval_status||'pending'}</span>${l.pm_notes?`<div style="font-size:10px;color:#7E7E8F;margin-top:2px">${l.pm_notes.substring(0,30)}</div>`:''}</td>
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
        <div style="font-size:11px;color:#7E7E8F;text-transform:uppercase;letter-spacing:.04em">${label}</div>
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
  if (action === 'rejected') {
    if (typeof showRejectLogModal === 'function') return showRejectLogModal(id)
  }
  try {
    await API.patch('/timesheets/' + id + '/approve', { action })
    toast('Entry approved!', 'success')
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
  el.innerHTML = `<div style="padding:40px;text-align:center;color:#7E7E8F"><i class="fas fa-spinner fa-spin" style="font-size:24px"></i></div>`

  el.innerHTML = `
  <div class="page-header">
    <div><h1 class="page-title">Reports & Analytics</h1><p class="page-subtitle">Export and analyze project data</p></div>
    <div class="page-actions">
      <button class="btn btn-outline" onclick="exportReportCSV()"><i class="fas fa-download"></i>Export CSV</button>
    </div>
  </div>

  <!-- Report tabs -->
  <div style="display:flex;gap:4px;background:#1F0F08;padding:4px;border-radius:10px;border:1px solid #2A1812;margin-bottom:20px;flex-wrap:wrap">
    <button id="rtab-team"      onclick="switchReportTab2('team')"      class="report-tab active-tab" style="padding:8px 16px;border-radius:7px;border:none;cursor:pointer;font-size:12.5px;font-weight:600;background:#A970FF;color:#fff">Team Utilization</button>
    <button id="rtab-inhouse"   onclick="switchReportTab2('inhouse')"   class="report-tab"            style="padding:8px 16px;border-radius:7px;border:none;cursor:pointer;font-size:12.5px;font-weight:500;background:transparent;color:#7E7E8F">In-house Devs</button>
    <button id="rtab-external"  onclick="switchReportTab2('external')"  class="report-tab"            style="padding:8px 16px;border-radius:7px;border:none;cursor:pointer;font-size:12.5px;font-weight:500;background:transparent;color:#7E7E8F">External Teams</button>
    <button id="rtab-pm"        onclick="switchReportTab2('pm')"        class="report-tab"            style="padding:8px 16px;border-radius:7px;border:none;cursor:pointer;font-size:12.5px;font-weight:500;background:transparent;color:#7E7E8F">PM-wise</button>
    <button id="rtab-pc"        onclick="switchReportTab2('pc')"        class="report-tab"            style="padding:8px 16px;border-radius:7px;border:none;cursor:pointer;font-size:12.5px;font-weight:500;background:transparent;color:#7E7E8F">PC-wise</button>
    <button id="rtab-project"   onclick="switchReportTab2('project')"   class="report-tab"            style="padding:8px 16px;border-radius:7px;border:none;cursor:pointer;font-size:12.5px;font-weight:500;background:transparent;color:#7E7E8F">Project Status</button>
    <button id="rtab-billing"   onclick="switchReportTab2('billing')"   class="report-tab"            style="padding:8px 16px;border-radius:7px;border:none;cursor:pointer;font-size:12.5px;font-weight:500;background:transparent;color:#7E7E8F">Billing</button>
    <button id="rtab-timesheet" onclick="switchReportTab2('timesheet')" class="report-tab"            style="padding:8px 16px;border-radius:7px;border:none;cursor:pointer;font-size:12.5px;font-weight:500;background:transparent;color:#7E7E8F">Timesheet</button>
  </div>

  <div id="report-panel"></div>`

  switchReportTab2('team')
}

function switchReportTab2(tab) {
  document.querySelectorAll('.report-tab').forEach(btn => {
    btn.style.background = 'transparent'; btn.style.color = '#7E7E8F'; btn.style.fontWeight = '500'
  })
  const active = document.getElementById('rtab-' + tab)
  if (active) { active.style.background = '#A970FF'; active.style.color = '#fff'; active.style.fontWeight = '600' }
  loadReport2(tab)
}

async function loadReport2(tab) {
  const panel = document.getElementById('report-panel')
  if (!panel) return
  panel.innerHTML = '<div style="padding:24px;text-align:center;color:#7E7E8F"><i class="fas fa-spinner fa-spin"></i></div>'
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
                  <span style="font-size:9px;color:${pct>=80?'#FF5E3A':pct>=50?'#C9A7FF':'#58C68A'};font-weight:600">${pct}%</span>
                  <div style="width:100%;background:#2A1812;border-radius:3px;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end" title="${u.full_name}: ${pct}%" style="height:160px">
                    <div style="height:${pct}%;background:${pct>=80?'linear-gradient(180deg,#FF5E3A,#FF5E3A)':pct>=50?'linear-gradient(180deg,#A970FF,#C9A7FF)':'linear-gradient(180deg,#3FAA70,#58C68A)'};border-radius:3px;transition:.5s;min-height:2px"></div>
                  </div>
                  <span style="font-size:9px;color:#7E7E8F;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:50px" title="${u.full_name}">${u.full_name?.split(' ')[0]}</span>
                </div>`}).join('')}
            </div>
          </div>
          <div class="card" style="padding:20px">
            <div style="font-size:13px;font-weight:600;color:#e2e8f0;margin-bottom:16px">Capacity Summary</div>
            ${users.reduce((html, u) => html + `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #2A1812">
                <div style="display:flex;align-items:center;gap:8px">
                  ${avatar(u.full_name, u.avatar_color, 'sm')}
                  <div><div style="font-size:12px;color:#e2e8f0">${u.full_name}</div><div style="font-size:10px;color:#7E7E8F">${u.designation||u.role}</div></div>
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
                <td><div style="display:flex;align-items:center;gap:8px">${avatar(u.full_name,u.avatar_color,'sm')}<div><div style="font-size:12px;color:#e2e8f0">${u.full_name}</div><div style="font-size:10px;color:#7E7E8F">${u.email}</div></div></div></td>
                <td><span class="badge badge-${u.role==='pm'?'inprogress':'review'}">${u.role}</span></td>
                <td>${u.monthly_available_hours||160}h</td>
                <td>${u.monthly_consumed||0}h</td>
                <td><div style="display:flex;align-items:center;gap:6px"><div class="progress-bar" style="width:70px"><div class="progress-fill ${(u.utilization_pct||0)>=80?'rose':(u.utilization_pct||0)>=50?'amber':'green'}" style="width:${Math.min(u.utilization_pct||0,100)}%"></div></div><span style="font-size:11px;color:${pctColor(u.utilization_pct||0)}">${u.utilization_pct||0}%</span></div></td>
                <td>${u.project_count||0}</td>
                <td style="color:#7E7E8F">${u.hourly_cost ? '₹'+fmtNum(u.hourly_cost) : '—'}</td>
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
                  <td><div style="font-weight:500;color:#e2e8f0;font-size:13px">${p.name}</div><div style="font-size:11px;color:#7E7E8F">${p.code}</div></td>
                  <td style="font-size:12px;color:#7E7E8F">${p.client_name||'—'}</td>
                  <td style="font-size:12px;color:#7E7E8F">${p.project_type||'—'}</td>
                  <td>${statusBadge(p.status)}</td>
                  <td>${p.total_allocated_hours||0}h</td>
                  <td>${p.consumed_hours||0}h</td>
                  <td style="color:${remaining<0?'#FF5E3A':'#7E7E8F'}">${remaining}h</td>
                  <td><div style="display:flex;align-items:center;gap:6px">
                    <div class="progress-bar" style="width:60px"><div class="progress-fill ${burn>=90?'rose':burn>=70?'amber':'green'}" style="width:${Math.min(burn,100)}%"></div></div>
                    <span style="font-size:11px;color:${pctColor(burn)}">${burn}%</span>
                  </div></td>
                  <td style="font-size:12px;color:${overdue?'#FF5E3A':'#7E7E8F'}">${fmtDate(p.expected_end_date)}${overdue?' <span class="badge badge-blocked" style="font-size:9px">Overdue</span>':''}</td>
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
          ${miniStatCard('Total Invoiced', fmtCurrency(total), '#A970FF', 'fa-file-invoice-dollar')}
          ${miniStatCard('Collected', fmtCurrency(paid), '#58C68A', 'fa-check-circle')}
          ${miniStatCard('Outstanding', fmtCurrency(pending), '#C9A7FF', 'fa-hourglass-half')}
          ${miniStatCard('Overdue Count', invoices.filter(i=>i.status==='overdue').length, '#FF5E3A', 'fa-exclamation-triangle')}
        </div>
        <div class="card">
          <div class="card-header"><span style="font-weight:600">Invoice Summary</span></div>
          <div class="card-body" style="padding:0">
            <table class="data-table">
              <thead><tr><th>Invoice #</th><th>Client</th><th>Project</th><th>Issue Date</th><th>Due Date</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead>
              <tbody>${invoices.map(i => `<tr>
                <td style="font-family:monospace;font-size:12px;color:#C9A7FF">${i.invoice_number}</td>
                <td style="font-size:12px;color:#e2e8f0">${i.company_name||'—'}</td>
                <td style="font-size:12px;color:#7E7E8F">${i.project_name||'—'}</td>
                <td style="font-size:12px;color:#7E7E8F">${fmtDate(i.issue_date)}</td>
                <td style="font-size:12px;color:${new Date(i.due_date)<new Date()&&i.status!=='paid'?'#FF5E3A':'#7E7E8F'}">${fmtDate(i.due_date)}</td>
                <td style="font-weight:600;color:#e2e8f0">${fmtCurrency(i.total_amount)}</td>
                <td style="color:#58C68A">${i.paid_amount>0?fmtCurrency(i.paid_amount):'—'}</td>
                <td style="color:${(i.total_amount-(i.paid_amount||0))>0?'#C9A7FF':'#7E7E8F'}">${fmtCurrency(i.total_amount-(i.paid_amount||0))}</td>
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
          ${miniStatCard('This Month Total', totalH.toFixed(1)+'h', '#A970FF', 'fa-clock')}
          ${miniStatCard('Billable', billH.toFixed(1)+'h', '#58C68A', 'fa-check-circle')}
          ${miniStatCard('Non-Billable', (totalH-billH).toFixed(1)+'h', '#7E7E8F', 'fa-ban')}
          ${miniStatCard('Entries', logs.length, '#C9A7FF', 'fa-list')}
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
                <td style="color:#7E7E8F">${(d.total-d.billable).toFixed(1)}h</td>
                <td>${d.projects.size}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>
        </div>`
    } else if (tab === 'inhouse') {
      // ── In-house developer report ──────────────────────────────
      const [usersRes, projectsRes, tsRes, allocRes] = await Promise.all([
        API.get('/users?role=developer'),
        API.get('/projects'),
        API.get('/timesheets?from=' + dayjs().startOf('month').format('YYYY-MM-DD') + '&to=' + dayjs().format('YYYY-MM-DD')),
        API.get('/allocations').catch(() => ({ allocations: [] })),
      ])
      const devs = (usersRes.users || usersRes.data || []).filter(u => String(u.role).toLowerCase() === 'developer')
      const projects = projectsRes.projects || projectsRes.data || []
      const logs = tsRes.timesheets || tsRes.data || []
      const allocs = allocRes.allocations || allocRes.data || []

      const rows = devs.map(d => {
        const myLogs = logs.filter(l => l.user_id === d.id)
        const totalH = myLogs.reduce((s, l) => s + parseFloat(l.hours_consumed || 0), 0)
        const billH = myLogs.filter(l => l.is_billable).reduce((s, l) => s + parseFloat(l.hours_consumed || 0), 0)
        const myAllocs = allocs.filter(a => a.user_id === d.id)
        const projectIds = new Set(myAllocs.map(a => a.project_id).concat(myLogs.map(l => l.project_id).filter(Boolean)))
        const cap = parseFloat(d.monthly_available_hours || 160)
        const utilPct = cap > 0 ? Math.round((totalH / cap) * 100) : 0
        return { dev: d, totalH, billH, projects: projectIds.size, utilPct, cap }
      })

      panel.innerHTML = `
        <div class="grid-4" style="margin-bottom:16px">
          ${miniStatCard('In-house Devs', devs.length, '#A970FF', 'fa-code')}
          ${miniStatCard('Hours This Month', rows.reduce((s, r) => s + r.totalH, 0).toFixed(1) + 'h', '#C9A7FF', 'fa-clock')}
          ${miniStatCard('Billable', rows.reduce((s, r) => s + r.billH, 0).toFixed(1) + 'h', '#58C68A', 'fa-check-circle')}
          ${miniStatCard('Avg Utilization', Math.round(rows.reduce((s, r) => s + r.utilPct, 0) / (rows.length || 1)) + '%', '#C56FE6', 'fa-tachometer-alt')}
        </div>
        <div class="card">
          <div class="card-header"><span style="font-weight:600">In-house Developer Report</span></div>
          <div class="card-body" style="padding:0">
            <table class="data-table">
              <thead><tr><th>Developer</th><th>Designation</th><th>Capacity</th><th>Logged</th><th>Billable</th><th>Utilization</th><th>Active Projects</th><th>Hourly Cost</th><th>Cost</th><th></th></tr></thead>
              <tbody>${rows.map(r => `<tr>
                <td><div style="display:flex;align-items:center;gap:8px">${avatar(r.dev.full_name, r.dev.avatar_color, 'sm')}<div><div style="font-size:12px;color:#e2e8f0">${r.dev.full_name}</div><div style="font-size:10px;color:#7E7E8F">${r.dev.email}</div></div></div></td>
                <td style="font-size:12px;color:#7E7E8F">${r.dev.designation || '—'}</td>
                <td>${r.cap}h</td>
                <td>${r.totalH.toFixed(1)}h</td>
                <td style="color:#58C68A">${r.billH.toFixed(1)}h</td>
                <td><div style="display:flex;align-items:center;gap:6px"><div class="progress-bar" style="width:70px"><div class="progress-fill ${r.utilPct>=80?'rose':r.utilPct>=50?'amber':'green'}" style="width:${Math.min(r.utilPct,100)}%"></div></div><span style="font-size:11px;color:${pctColor(r.utilPct)}">${r.utilPct}%</span></div></td>
                <td>${r.projects}</td>
                <td style="color:#7E7E8F">${r.dev.hourly_cost ? '₹' + fmtNum(r.dev.hourly_cost) : '—'}</td>
                <td style="color:#58C68A">${r.dev.hourly_cost && r.totalH ? '₹' + fmtNum(r.dev.hourly_cost * r.totalH) : '—'}</td>
                <td><button class="btn btn-xs btn-outline" title="View summary" onclick="openReportSummary('inhouse','${r.dev.id}')"><i class="fas fa-eye"></i></button></td>
              </tr>`).join('') || '<tr><td colspan="10" style="text-align:center;color:#7E7E8F;padding:24px">No in-house developers</td></tr>'}</tbody>
            </table>
          </div>
        </div>`
    } else if (tab === 'external') {
      // ── External teams report ──────────────────────────────────
      const [teamsRes, teamUsersRes, projectsRes, tsRes] = await Promise.all([
        API.get('/project-teams').catch(() => ({ teams: [] })),
        API.get('/users?role=team').catch(() => ({ users: [] })),
        API.get('/projects'),
        API.get('/timesheets?from=' + dayjs().startOf('month').format('YYYY-MM-DD') + '&to=' + dayjs().format('YYYY-MM-DD')),
      ])
      const teams = teamsRes.teams || teamsRes.data || []
      const teamUsers = (teamUsersRes.users || teamUsersRes.data || [])
      const projects = projectsRes.projects || projectsRes.data || []
      const logs = tsRes.timesheets || tsRes.data || []

      // External-projects: assignment_type === 'external'
      const externalProjects = projects.filter(p => p.assignment_type === 'external')

      // For each team, count linked projects
      const teamRows = teams.map(t => {
        const linked = externalProjects.filter(p => p.external_team_id === t.id && p.external_assignee_type === 'team')
        return {
          name: t.alias || t.name,
          lead: t.lead_name || '—',
          members: t.member_count || 0,
          projects: linked.length,
          allocated: linked.reduce((s, p) => s + (p.total_allocated_hours || 0), 0),
          consumed: linked.reduce((s, p) => s + (p.consumed_hours || 0), 0),
        }
      })

      // For each external single-user assignee, summarize
      const userRows = teamUsers.map(u => {
        const linked = externalProjects.filter(p => p.external_team_id === u.id && p.external_assignee_type === 'user')
        const myLogs = logs.filter(l => l.user_id === u.id)
        const totalH = myLogs.reduce((s, l) => s + parseFloat(l.hours_consumed || 0), 0)
        return {
          dev: u,
          projects: linked.length,
          totalH,
          allocated: linked.reduce((s, p) => s + (p.total_allocated_hours || 0), 0),
        }
      })

      panel.innerHTML = `
        <div class="grid-4" style="margin-bottom:16px">
          ${miniStatCard('External Teams', teams.length, '#A970FF', 'fa-users')}
          ${miniStatCard('External Members', teamUsers.length, '#C9A7FF', 'fa-user-friends')}
          ${miniStatCard('External Projects', externalProjects.length, '#C56FE6', 'fa-folder-open')}
          ${miniStatCard('Total Allocated', fmtNum(teamRows.reduce((s, r) => s + r.allocated, 0) + userRows.reduce((s, r) => s + r.allocated, 0)) + 'h', '#C9A7FF', 'fa-clock')}
        </div>
        <div class="card" style="margin-bottom:16px">
          <div class="card-header"><span style="font-weight:600">External Teams</span></div>
          <div class="card-body" style="padding:0">
            <table class="data-table">
              <thead><tr><th>Team</th><th>Lead</th><th>Members</th><th>Projects</th><th>Allocated</th><th>Consumed</th><th>Burn %</th><th></th></tr></thead>
              <tbody>${teamRows.map((r, idx) => {
                const team = teams[idx]
                const burn = r.allocated > 0 ? Math.round((r.consumed / r.allocated) * 100) : 0
                return `<tr>
                  <td style="font-weight:500;color:#e2e8f0">${r.name}</td>
                  <td style="font-size:12px;color:#7E7E8F">${r.lead}</td>
                  <td>${r.members}</td>
                  <td>${r.projects}</td>
                  <td>${fmtNum(r.allocated)}h</td>
                  <td>${fmtNum(r.consumed)}h</td>
                  <td><div style="display:flex;align-items:center;gap:6px"><div class="progress-bar" style="width:70px"><div class="progress-fill ${burn>=90?'rose':burn>=70?'amber':'green'}" style="width:${Math.min(burn,100)}%"></div></div><span style="font-size:11px;color:${pctColor(burn)}">${burn}%</span></div></td>
                  <td><button class="btn btn-xs btn-outline" title="View summary" onclick="openReportSummary('external-team','${team?.id || ''}')"><i class="fas fa-eye"></i></button></td>
                </tr>`
              }).join('') || '<tr><td colspan="8" style="text-align:center;color:#7E7E8F;padding:24px">No external teams</td></tr>'}</tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><span style="font-weight:600">Individual External Members</span></div>
          <div class="card-body" style="padding:0">
            <table class="data-table">
              <thead><tr><th>Member</th><th>Designation</th><th>Projects</th><th>Allocated</th><th>Logged This Month</th><th></th></tr></thead>
              <tbody>${userRows.map(r => `<tr>
                <td><div style="display:flex;align-items:center;gap:8px">${avatar(r.dev.full_name, r.dev.avatar_color, 'sm')}<div><div style="font-size:12px;color:#e2e8f0">${r.dev.full_name}</div><div style="font-size:10px;color:#7E7E8F">${r.dev.email}</div></div></div></td>
                <td style="font-size:12px;color:#7E7E8F">${r.dev.designation || '—'}</td>
                <td>${r.projects}</td>
                <td>${fmtNum(r.allocated)}h</td>
                <td style="color:#58C68A">${r.totalH.toFixed(1)}h</td>
                <td><button class="btn btn-xs btn-outline" title="View summary" onclick="openReportSummary('external-user','${r.dev.id}')"><i class="fas fa-eye"></i></button></td>
              </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:#7E7E8F;padding:24px">No external members</td></tr>'}</tbody>
            </table>
          </div>
        </div>`
    } else if (tab === 'pm' || tab === 'pc') {
      // ── PM-wise / PC-wise report (project ownership rollup) ──
      const role = tab
      const [usersRes, projectsRes, tsRes] = await Promise.all([
        API.get('/users?role=' + role),
        API.get('/projects'),
        API.get('/timesheets?from=' + dayjs().startOf('month').format('YYYY-MM-DD') + '&to=' + dayjs().format('YYYY-MM-DD')),
      ])
      const owners = (usersRes.users || usersRes.data || []).filter(u => String(u.role).toLowerCase() === role)
      const projects = projectsRes.projects || projectsRes.data || []
      const logs = tsRes.timesheets || tsRes.data || []

      const rows = owners.map(o => {
        const owned = projects.filter(p => (role === 'pm' ? p.pm_id : p.pc_id) === o.id)
        const totalAlloc = owned.reduce((s, p) => s + (p.total_allocated_hours || 0), 0)
        const totalConsumed = owned.reduce((s, p) => s + (p.consumed_hours || 0), 0)
        const myLogs = logs.filter(l => owned.some(p => p.id === l.project_id))
        const monthlyH = myLogs.reduce((s, l) => s + parseFloat(l.hours_consumed || 0), 0)
        const billable = myLogs.filter(l => l.is_billable).reduce((s, l) => s + parseFloat(l.hours_consumed || 0), 0)
        const revenue = owned.reduce((s, p) => s + (p.revenue || 0), 0)
        return { owner: o, owned, totalAlloc, totalConsumed, monthlyH, billable, revenue }
      })

      const labelTitle = role === 'pm' ? 'Project Manager' : 'Product Coordinator'
      panel.innerHTML = `
        <div class="grid-4" style="margin-bottom:16px">
          ${miniStatCard(labelTitle + 's', owners.length, '#A970FF', 'fa-user-tie')}
          ${miniStatCard('Total Projects', rows.reduce((s, r) => s + r.owned.length, 0), '#C9A7FF', 'fa-folder-open')}
          ${miniStatCard('Hours This Month', rows.reduce((s, r) => s + r.monthlyH, 0).toFixed(1) + 'h', '#58C68A', 'fa-clock')}
          ${miniStatCard('Total Revenue', '₹' + fmtNum(rows.reduce((s, r) => s + r.revenue, 0)), '#C56FE6', 'fa-indian-rupee-sign')}
        </div>
        <div class="card">
          <div class="card-header"><span style="font-weight:600">${labelTitle}-wise Report</span></div>
          <div class="card-body" style="padding:0">
            <table class="data-table">
              <thead><tr><th>${labelTitle}</th><th>Projects</th><th>Active</th><th>Allocated Hours</th><th>Consumed</th><th>Burn %</th><th>Hours This Month</th><th>Billable</th><th>Revenue</th><th></th></tr></thead>
              <tbody>${rows.map(r => {
                const active = r.owned.filter(p => p.status === 'active').length
                const burn = r.totalAlloc > 0 ? Math.round((r.totalConsumed / r.totalAlloc) * 100) : 0
                return `<tr>
                  <td><div style="display:flex;align-items:center;gap:8px">${avatar(r.owner.full_name, r.owner.avatar_color, 'sm')}<div><div style="font-size:12px;color:#e2e8f0">${r.owner.full_name}</div><div style="font-size:10px;color:#7E7E8F">${r.owner.email}</div></div></div></td>
                  <td>${r.owned.length}</td>
                  <td><span class="badge badge-${active > 0 ? 'green' : 'gray'}">${active}</span></td>
                  <td>${fmtNum(r.totalAlloc)}h</td>
                  <td>${fmtNum(r.totalConsumed)}h</td>
                  <td><div style="display:flex;align-items:center;gap:6px"><div class="progress-bar" style="width:70px"><div class="progress-fill ${burn>=90?'rose':burn>=70?'amber':'green'}" style="width:${Math.min(burn,100)}%"></div></div><span style="font-size:11px;color:${pctColor(burn)}">${burn}%</span></div></td>
                  <td>${r.monthlyH.toFixed(1)}h</td>
                  <td style="color:#58C68A">${r.billable.toFixed(1)}h</td>
                  <td style="color:#C9A7FF;font-weight:600">₹${fmtNum(r.revenue)}</td>
                  <td><button class="btn btn-xs btn-outline" title="View summary" onclick="openReportSummary('${role}','${r.owner.id}')"><i class="fas fa-eye"></i></button></td>
                </tr>`
              }).join('') || `<tr><td colspan="10" style="text-align:center;color:#7E7E8F;padding:24px">No ${labelTitle.toLowerCase()}s</td></tr>`}</tbody>
            </table>
          </div>
        </div>`
    }
  } catch(e) {
    panel.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>`
  }
}

// ── Report row summary (eye button) ─────────────────────────
// Pulls people-scoped data from /projects, /timesheets, /users, /project-teams
// and renders a quick-glance modal so admins don't have to leave the report
// to see what a particular dev/team/PM/PC is actually working on.
async function openReportSummary(kind, entityId) {
  if (!entityId) { toast('No entity to summarize', 'error'); return }
  showModal(`
    <div class="modal-header"><h3><i class="fas fa-chart-line" style="color:#A970FF"></i> Loading summary…</h3><button class="close-btn" onclick="closeModal()">✕</button></div>
    <div class="modal-body" style="padding:30px;text-align:center;color:#7E7E8F"><i class="fas fa-spinner fa-spin"></i></div>`, 'modal-lg')

  try {
    const monthStart = dayjs().startOf('month').format('YYYY-MM-DD')
    const today = dayjs().format('YYYY-MM-DD')
    const [projectsRes, tsRes, usersRes, teamsRes, allocsRes] = await Promise.all([
      API.get('/projects'),
      API.get('/timesheets?from=' + monthStart + '&to=' + today),
      API.get('/users').catch(() => ({ users: [] })),
      API.get('/project-teams').catch(() => ({ teams: [] })),
      API.get('/allocations').catch(() => ({ allocations: [] })),
    ])
    const projects = projectsRes.projects || projectsRes.data || []
    const logs = tsRes.timesheets || tsRes.data || []
    const users = usersRes.users || usersRes.data || []
    const teams = teamsRes.teams || teamsRes.data || []
    const allocs = allocsRes.allocations || allocsRes.data || []

    let title = ''
    let subtitle = ''
    let avatarColor = '#A970FF'
    let avatarName = '?'
    let ownedProjects = []
    let myLogs = []

    if (kind === 'inhouse' || kind === 'external-user' || kind === 'pm' || kind === 'pc') {
      const u = users.find(x => String(x.id) === String(entityId))
      if (!u) { toast('User not found', 'error'); closeModal(); return }
      title = u.full_name
      subtitle = `${u.designation || u.role} · ${u.email}`
      avatarColor = u.avatar_color || '#A970FF'
      avatarName = u.full_name
      if (kind === 'pm') ownedProjects = projects.filter(p => p.pm_id === u.id)
      else if (kind === 'pc') ownedProjects = projects.filter(p => p.pc_id === u.id)
      else if (kind === 'inhouse') {
        const myAllocProjectIds = new Set(allocs.filter(a => a.user_id === u.id).map(a => String(a.project_id)))
        ownedProjects = projects.filter(p => myAllocProjectIds.has(String(p.id)))
      } else if (kind === 'external-user') {
        ownedProjects = projects.filter(p => p.assignment_type === 'external' && p.external_team_id === u.id)
      }
      myLogs = logs.filter(l => l.user_id === u.id)
    } else if (kind === 'external-team') {
      const team = teams.find(t => String(t.id) === String(entityId))
      if (!team) { toast('Team not found', 'error'); closeModal(); return }
      title = team.alias || team.name
      subtitle = `External team · Lead: ${team.lead_name || '—'} · ${team.member_count || 0} members`
      avatarColor = '#A970FF'
      avatarName = team.alias || team.name
      ownedProjects = projects.filter(p => p.assignment_type === 'external' && p.external_team_id === team.id && p.external_assignee_type === 'team')
      const memberIds = new Set((team.members || []).map(m => String(m.user_id || m.id)))
      myLogs = logs.filter(l => memberIds.has(String(l.user_id)))
    }

    const totalAlloc = ownedProjects.reduce((s, p) => s + (Number(p.total_allocated_hours) || 0), 0)
    const totalConsumed = ownedProjects.reduce((s, p) => s + (Number(p.consumed_hours) || 0), 0)
    const monthlyH = myLogs.reduce((s, l) => s + parseFloat(l.hours_consumed || 0), 0)
    const billableH = myLogs.filter(l => l.is_billable).reduce((s, l) => s + parseFloat(l.hours_consumed || 0), 0)
    const revenue = ownedProjects.reduce((s, p) => s + (Number(p.revenue) || 0), 0)
    const activeProjects = ownedProjects.filter(p => p.status === 'active').length
    const completedProjects = ownedProjects.filter(p => p.status === 'completed').length
    const burn = totalAlloc > 0 ? Math.round((totalConsumed / totalAlloc) * 100) : 0

    const kindLabel = {
      'inhouse': 'In-house Developer',
      'external-team': 'External Team',
      'external-user': 'External Member',
      'pm': 'Project Manager',
      'pc': 'Product Coordinator',
    }[kind] || 'Summary'

    const statCard = (label, value, color) => `
      <div style="padding:12px;background:rgba(${hexToRgb(color)},.08);border:1px solid rgba(${hexToRgb(color)},.25);border-radius:8px">
        <div style="font-size:10px;color:${color};text-transform:uppercase;letter-spacing:.05em">${label}</div>
        <div style="font-size:18px;font-weight:700;color:#e2e8f0;margin-top:4px">${value}</div>
      </div>`

    closeModal()
    showModal(`
      <div class="modal-header" style="display:flex;align-items:center;gap:10px">
        ${avatar(avatarName, avatarColor, 'lg')}
        <div style="flex:1;min-width:0">
          <h3 style="margin:0;font-size:16px;color:#e2e8f0">${escapeHtml(title)}</h3>
          <div style="font-size:11.5px;color:#7E7E8F;margin-top:2px">${escapeHtml(kindLabel)} · ${escapeHtml(subtitle)}</div>
        </div>
        <button class="close-btn" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body" style="padding:18px">
        <div class="grid-4" style="gap:8px;margin-bottom:16px">
          ${statCard('Projects', ownedProjects.length, '#A970FF')}
          ${statCard('Active', activeProjects, '#58C68A')}
          ${statCard('Completed', completedProjects, '#C56FE6')}
          ${statCard('Burn %', burn + '%', burn >= 90 ? '#FF5E3A' : burn >= 70 ? '#C9A7FF' : '#58C68A')}
        </div>
        <div class="grid-4" style="gap:8px;margin-bottom:16px">
          ${statCard('Allocated', fmtNum(totalAlloc) + 'h', '#C9A7FF')}
          ${statCard('Consumed', fmtNum(totalConsumed) + 'h', '#C9A7FF')}
          ${statCard('This Month', monthlyH.toFixed(1) + 'h', '#58C68A')}
          ${statCard('Billable', billableH.toFixed(1) + 'h', '#86E0A8')}
        </div>
        ${revenue > 0 ? `<div style="padding:12px;background:rgba(169,112,255,.08);border:1px solid rgba(169,112,255,.25);border-radius:8px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:11px;color:#C9A7FF;text-transform:uppercase;letter-spacing:.05em">Linked Revenue</div>
          <div style="font-size:18px;font-weight:700;color:#C9A7FF">₹${fmtNum(revenue)}</div>
        </div>` : ''}

        <div style="font-size:12px;font-weight:600;color:#e2e8f0;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Projects (${ownedProjects.length})</div>
        ${ownedProjects.length === 0 ? '<div style="padding:14px;text-align:center;color:#7E7E8F;border:1px dashed #2A1812;border-radius:8px;font-size:12px">No projects linked.</div>' : `
          <div style="display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto">
            ${ownedProjects.map(p => {
              const pBurn = (Number(p.total_allocated_hours) || 0) > 0 ? Math.round((Number(p.consumed_hours || 0) / Number(p.total_allocated_hours)) * 100) : 0
              return `<div style="padding:10px 12px;background:rgba(11,11,13,.5);border:1px solid rgba(179,136,255,.18);border-radius:8px;display:flex;align-items:center;gap:10px">
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;color:#e2e8f0;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.name)}</div>
                  <div style="font-size:11px;color:#7E7E8F">${escapeHtml(p.code || '')}${p.client_name ? ' · ' + escapeHtml(p.client_name) : ''} · ${escapeHtml(p.status || '')}</div>
                </div>
                <div style="text-align:right;flex-shrink:0">
                  <div style="font-size:11px;color:#7E7E8F">${fmtNum(p.consumed_hours || 0)}/${fmtNum(p.total_allocated_hours || 0)}h</div>
                  <div style="font-size:11px;color:${pBurn >= 90 ? '#FF5E3A' : pBurn >= 70 ? '#C9A7FF' : '#58C68A'};font-weight:600">${pBurn}%</div>
                </div>
              </div>`
            }).join('')}
          </div>`}
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Close</button>
      </div>
    `, 'modal-lg')
  } catch (e) {
    closeModal()
    toast('Failed to load summary: ' + e.message, 'error')
  }
}

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `${r},${g},${b}`
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

/* ── ALERTS + NOTIFICATIONS (unified inbox) ───────────── */
const NOTIF_TYPE_ICON = {
  ticket_created:       { icon: 'fa-ticket', color: '#A970FF' },
  ticket_assigned:      { icon: 'fa-user-check', color: '#C56FE6' },
  ticket_status:        { icon: 'fa-circle-half-stroke', color: '#B388FF' },
  ticket_priority:      { icon: 'fa-flag', color: '#C9A7FF' },
  ticket_comment:       { icon: 'fa-message', color: '#B388FF' },
  ticket_internal_note: { icon: 'fa-lock', color: '#C9A7FF' },
}

async function renderAlertsView(el) {
  el.innerHTML = `<div style="padding:40px;text-align:center;color:#7E7E8F"><i class="fas fa-spinner fa-spin" style="font-size:24px"></i></div>`
  try {
    const [alertsRes, notifsRes] = await Promise.all([
      API.get('/alerts').catch(() => ({ alerts: [] })),
      API.get('/notifications/me?limit=200').catch(() => ({ notifications: [] })),
    ])
    const alerts = alertsRes.alerts || alertsRes.data || []
    const notifs = notifsRes.notifications || notifsRes.data || []

    const sevColor = { critical:'#FF5E3A', high:'#A970FF', warning:'#C9A7FF', info:'#C9A7FF', low:'#7E7E8F' }
    const sevIcon = { critical:'fa-circle-exclamation', high:'fa-exclamation-triangle', warning:'fa-triangle-exclamation', info:'fa-info-circle', low:'fa-circle-info' }

    // Merge into a single inbox list sorted by created_at desc
    const items = [
      ...alerts
        .filter(a => !a.is_dismissed)
        .map(a => ({
          kind: 'alert',
          id: a.id,
          title: a.title,
          body: a.message,
          created_at: a.created_at,
          is_read: !!a.is_read,
          severity: a.severity || 'info',
          icon: sevIcon[a.severity] || 'fa-circle-info',
          color: sevColor[a.severity] || '#7E7E8F',
          link: null,
          raw: a,
        })),
      ...notifs.map(n => {
        const ic = NOTIF_TYPE_ICON[n.type] || { icon: 'fa-bell', color: '#C9A7FF' }
        return {
          kind: 'notif',
          id: n.id,
          title: n.title,
          body: n.body || '',
          created_at: n.created_at,
          is_read: !!n.is_read,
          severity: 'info',
          icon: ic.icon,
          color: ic.color,
          link: n.link || null,
          actor_name: n.actor_name || null,
          raw: n,
        }
      }),
    ].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))

    const unread = items.filter(i => !i.is_read)
    const filterSev = _alertsSeverityFilter || ''
    const filtered = filterSev
      ? items.filter(i => i.kind === 'alert' && i.severity === filterSev)
      : items
    const pagination = paginateClient(filtered, _alertsViewPage, 12)
    _alertsViewPage = pagination.page

    el.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Alerts &amp; Notifications</h1><p class="page-subtitle">${unread.length} unread · ${items.length} total</p></div>
      <div class="page-actions" style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-outline" onclick="markAllInboxRead()"><i class="fas fa-check-double"></i>Mark All Read</button>
        ${typeof generateNewAlerts === 'function' ? '<button class="btn btn-primary" onclick="generateNewAlerts()"><i class="fas fa-refresh"></i>Generate Alerts</button>' : ''}
      </div>
    </div>

    <div class="grid-4" style="margin-bottom:16px">
      ${miniStatCard('Total', items.length, '#A970FF', 'fa-bell')}
      ${miniStatCard('Unread', unread.length, '#FF5E3A', 'fa-envelope')}
      ${miniStatCard('Activity', notifs.length, '#C9A7FF', 'fa-message')}
      ${miniStatCard('System Alerts', alerts.filter(a => !a.is_dismissed).length, '#C9A7FF', 'fa-triangle-exclamation')}
    </div>

    <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
      <button class="btn btn-sm btn-outline" onclick="filterAlerts('')" id="af-all" ${!filterSev?'style="background:rgba(169,112,255,.15);color:#C9A7FF"':''}>All</button>
      <button class="btn btn-sm btn-outline" onclick="filterAlerts('critical')" id="af-critical" ${filterSev==='critical'?'style="background:rgba(255,94,58,.15);color:#A970FF"':''}>🔴 Critical alerts</button>
      <button class="btn btn-sm btn-outline" onclick="filterAlerts('high')" id="af-high" ${filterSev==='high'?'style="background:rgba(169,112,255,.15);color:#C9A7FF"':''}>🟠 High alerts</button>
      <button class="btn btn-sm btn-outline" onclick="filterAlerts('warning')" id="af-warning" ${filterSev==='warning'?'style="background:rgba(169,112,255,.15);color:#D5C0FF"':''}>🟡 Warning alerts</button>
    </div>

    <div id="alerts-list">
      ${pagination.total === 0
        ? '<div class="empty-state"><i class="fas fa-bell-slash"></i><p>Inbox is clear — no alerts or notifications.</p></div>'
        : pagination.items.map(it => `
        <div class="card inbox-row" id="inbox-${it.kind}-${it.id}" style="padding:14px 16px;margin-bottom:10px;border-left:3px solid ${it.color};${!it.is_read?'background:rgba(169,112,255,.04)':''};cursor:${it.link?'pointer':'default'}" ${it.link?`onclick="onInboxClick('${it.kind}','${it.id}','${it.link}')"`:''}>
          <div style="display:flex;align-items:flex-start;gap:12px">
            <div style="width:36px;height:36px;border-radius:8px;background:${it.color}22;border:1px solid ${it.color}55;display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <i class="fas ${it.icon}" style="color:${it.color};font-size:14px"></i>
            </div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <div style="font-size:13.5px;font-weight:700;color:var(--text-primary)">${escapeInbox(it.title)}</div>
                <span class="badge" style="background:${it.color}22;color:${it.color};border-color:${it.color};font-size:9.5px">${it.kind === 'alert' ? it.severity : (it.raw.type || 'activity').replace(/_/g, ' ')}</span>
                ${!it.is_read ? '<span class="badge badge-inprogress" style="font-size:9px">New</span>' : ''}
              </div>
              ${it.body ? `<div style="font-size:12.5px;color:var(--text-secondary);margin-top:4px;line-height:1.5">${escapeInbox(it.body)}</div>` : ''}
              <div style="font-size:11px;color:var(--text-muted);margin-top:6px">${fmtDate(it.created_at)}${it.actor_name ? ' · by ' + escapeInbox(it.actor_name) : ''}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0" onclick="event.stopPropagation()">
              ${!it.is_read ? `<button class="btn btn-sm btn-outline" onclick="markInboxRead('${it.kind}','${it.id}')" title="Mark read"><i class="fas fa-eye"></i></button>` : ''}
              ${it.kind === 'alert' ? `<button class="btn btn-sm btn-outline" onclick="dismissAlert2('${it.id}')" style="color:#9F8678" title="Dismiss"><i class="fas fa-times"></i></button>` : ''}
            </div>
          </div>
        </div>`).join('')}
    </div>
    <div style="margin-top:12px">${renderPager(pagination, 'goAlertsPage', 'goAlertsPage', 'items')}</div>
    `
    window._allAlerts = alerts.filter(a => !a.is_dismissed)
  } catch(e) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>`
  }
}

function escapeInbox(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

async function markInboxRead(kind, id) {
  try {
    if (kind === 'alert') await API.patch('/alerts/' + id + '/read', {})
    else                   await API.post('/notifications/' + id + '/read', {})
    const row = document.getElementById('inbox-' + kind + '-' + id)
    if (row) {
      row.style.background = 'transparent'
      row.querySelector('.btn[title="Mark read"]')?.remove()
      row.querySelector('.badge-inprogress')?.remove()
    }
    if (typeof pollNotifications === 'function') pollNotifications()
  } catch(e) { toast(e.message, 'error') }
}

async function markAllInboxRead() {
  try {
    await Promise.all([
      API.post('/alerts/read-all', {}).catch(() => API.patch('/alerts/read-all', {}).catch(() => {})),
      API.post('/notifications/read-all', {}).catch(() => {}),
    ])
    toast('All marked read', 'success')
    const el = document.getElementById('page-alerts-view')
    if (el) { el.dataset.loaded = ''; renderAlertsView(el) }
    if (typeof pollNotifications === 'function') pollNotifications()
  } catch(e) { toast(e.message, 'error') }
}

function onInboxClick(kind, id, link) {
  // mark read on the way out
  markInboxRead(kind, id)
  if (link && link.startsWith('ticket:')) {
    const ticketId = link.slice('ticket:'.length)
    if (typeof openSupportDetail === 'function') openSupportDetail(ticketId)
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
  el.innerHTML = `<div style="padding:40px;text-align:center;color:#7E7E8F"><i class="fas fa-spinner fa-spin" style="font-size:24px"></i></div>`
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
      <button class="settings-tab" id="stab-company" onclick="switchSettingsTab2('company')" style="padding:8px 20px;border-radius:7px;border:none;cursor:pointer;font-size:13px;font-weight:600;background:#A970FF;color:#fff">Company</button>
      <button class="settings-tab" id="stab-holidays" onclick="switchSettingsTab2('holidays')" style="padding:8px 20px;border-radius:7px;border:none;cursor:pointer;font-size:13px;font-weight:500;background:transparent;color:#7E7E8F">Holidays</button>
      <button class="settings-tab" id="stab-tech" onclick="switchSettingsTab2('tech')" style="padding:8px 20px;border-radius:7px;border:none;cursor:pointer;font-size:13px;font-weight:500;background:transparent;color:#7E7E8F">Tech Stacks</button>
      <button class="settings-tab" id="stab-profile" onclick="switchSettingsTab2('profile')" style="padding:8px 20px;border-radius:7px;border:none;cursor:pointer;font-size:13px;font-weight:500;background:transparent;color:#7E7E8F">My Profile</button>
      ${['admin','pm'].includes(_user.role) ? `<button class="settings-tab" id="stab-invites" onclick="switchSettingsTab2('invites')" style="padding:8px 20px;border-radius:7px;border:none;cursor:pointer;font-size:13px;font-weight:500;background:transparent;color:#7E7E8F">Invites</button>` : ''}
      ${_user.role === 'admin' ? `<button class="settings-tab" id="stab-roles" onclick="switchSettingsTab2('roles')" style="padding:8px 20px;border-radius:7px;border:none;cursor:pointer;font-size:13px;font-weight:500;background:transparent;color:#7E7E8F">Roles &amp; Permissions</button>` : ''}
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
  document.querySelectorAll('.settings-tab').forEach(btn => { btn.style.background='transparent'; btn.style.color='#7E7E8F'; btn.style.fontWeight='500' })
  const active = document.getElementById('stab-' + tab)
  if (active) { active.style.background='#A970FF'; active.style.color='#fff'; active.style.fontWeight='600' }
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
            <td style="color:#7E7E8F">${fmtDate(h.date)}</td>
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
            <div style="font-size:11px;font-weight:600;color:#7E7E8F;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">${cat}</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">
              ${items.map(t => `<span style="padding:5px 12px;border-radius:20px;background:#2A1812;color:#7E7E8F;font-size:12px;display:inline-flex;align-items:center;gap:6px">
                ${t.name}
                <button onclick="deleteTech2('${t.id}')" style="background:none;border:none;color:#7E7E8F;cursor:pointer;padding:0;font-size:10px;display:inline-flex;align-items:center" title="Remove">✕</button>
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
          <div style="width:64px;height:64px;border-radius:50%;background:${_user.avatar_color||'#A970FF'};display:inline-flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;color:#fff;margin-bottom:10px">${initials(_user.name||_user.full_name||'U')}</div>
          <div style="font-size:16px;font-weight:600;color:#e2e8f0">${_user.name||_user.full_name||'—'}</div>
          <div style="font-size:12px;color:#7E7E8F;margin-top:2px">${_user.email||'—'}</div>
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
    panel.innerHTML = `<div id="invites-panel-container" style="padding:8px 0"><div style="padding:20px;text-align:center;color:#7E7E8F"><i class="fas fa-spinner fa-spin"></i> Loading invites…</div></div>`
    const cont = document.getElementById('invites-panel-container')
    if (cont && typeof renderInvitesPanel === 'function') renderInvitesPanel(cont)
  } else if (tab === 'roles') {
    panel.innerHTML = `<div id="roles-panel-container"><div style="padding:20px;text-align:center;color:#7E7E8F"><i class="fas fa-spinner fa-spin"></i> Loading roles…</div></div>`
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

// ── Salesforce-style permission matrix ───────────────────────
// One unified table: every row is a module, the first six columns are the
// standard CRUD actions (Create / Read / Edit / Delete / View All / Modify
// All), and the final "Other Actions" column carries pill-checkboxes for any
// remaining module-specific permission (tasks.move, invoices.send,
// leaves.approve, hr.*.manage, etc.). Every permission key in the catalogue
// is represented somewhere in this single table — no separate "extras" pane.
const PERM_MATRIX_ACTIONS = [
  { key: 'create',    label: 'Create' },
  { key: 'read',      label: 'Read' },
  { key: 'edit',      label: 'Edit' },
  { key: 'delete',    label: 'Delete' },
  { key: 'viewAll',   label: 'View All' },
  { key: 'modifyAll', label: 'Modify All' },
]

// Map a (module, action) pair to the underlying permission key(s) for the
// catalogue group. Returns either a single key, a "key1|key2" composite
// (Modify All grants edit-any + delete-any in one click), or null when the
// module doesn't support that action — in which case the cell renders as a dash.
function _permMatrixKey(module, action, keySet) {
  const has = (k) => keySet.has(k) ? k : null
  // Modules use slightly different verbs for "create" (leaves.create_own,
  // timesheets.log_own, documents.upload). Treat them all as Create so the
  // column is populated instead of pushing them into Other Actions.
  const CREATE_ALIASES   = ['create', 'create_own', 'log_own', 'upload']
  // Leaves uses `delete_any` (not `delete`) for the "delete anyone's record"
  // variant. Treat both as synonyms so Modify All works for leaves too.
  const DELETE_ANY_ALIAS = ['delete', 'delete_any']
  switch (action) {
    case 'create': {
      for (const a of CREATE_ALIASES) { const k = has(`${module}.${a}`); if (k) return k }
      return null
    }
    case 'read':   return has(`${module}.view_own`) || has(`${module}.view_all`) || has(`${module}.view`)
    case 'edit':   return has(`${module}.edit_own`) || has(`${module}.edit`)
    case 'delete': return has(`${module}.delete_own`) || has(`${module}.delete`)
    case 'viewAll': {
      // Only meaningful when the module exposes a scoped "own" view AND a
      // separate "all" view. Otherwise the "Read" column already represents
      // view_all and rendering it twice would mislead.
      const hasScoped = keySet.has(`${module}.view_own`) || keySet.has(`${module}.view`)
      return (hasScoped && keySet.has(`${module}.view_all`)) ? `${module}.view_all` : null
    }
    case 'modifyAll': {
      // Salesforce semantics: "Modify All" = grant the "any" edit + "any"
      // delete (full override). Only show when the module distinguishes an
      // _own scope from a full one, otherwise the Edit/Delete columns
      // already grant full power.
      const fullEdit = keySet.has(`${module}.edit`) && keySet.has(`${module}.edit_own`)
      const delAnyKey = DELETE_ANY_ALIAS.map(a => `${module}.${a}`).find(k => keySet.has(k))
      const fullDel  = !!delAnyKey && keySet.has(`${module}.delete_own`)
      if (!fullEdit && !fullDel) return null
      return [fullEdit ? `${module}.edit` : '', fullDel ? delAnyKey : ''].filter(Boolean).join('|')
    }
  }
  return null
}

async function openRoleEditModal(roleId) {
  try {
  const isCreate = !roleId
  const role = isCreate ? null : (_rolesState.roles || []).find(r => r.id === roleId)
  if (!isCreate && !role) { toast('Role not found', 'error'); return }
  const isSystem = role?.is_system

  const granted = new Set(Array.isArray(role?.permissions) ? role.permissions : [])
  // If the catalogue cache is empty (page just refreshed, or the roles panel
  // hasn't been opened in this session), fetch it before rendering — without
  // this the modal opens with an empty matrix body and looks blank.
  if (!Array.isArray(_rolesState.catalogue) || _rolesState.catalogue.length === 0) {
    try {
      const res = await API.get('/settings/roles')
      _rolesState.roles = res.roles || res.data || _rolesState.roles || []
      _rolesState.catalogue = res.catalogue || []
    } catch (e) {
      toast('Failed to load permissions catalogue: ' + (e.message || 'unknown error'), 'error')
      return
    }
  }
  const groups = _rolesState.catalogue || []
  if (!groups.length) {
    toast('Permissions catalogue is empty — please refresh the page', 'error')
    return
  }

  // Build the matrix table — one <tr> per module group, one <td> per action,
  // plus a final "Other Actions" cell that contains pill-checkboxes for any
  // permission in the group that didn't fit a standard CRUD slot.
  const matrixHeader = `
    <tr>
      <th class="perm-mtx-module-head">Module</th>
      ${PERM_MATRIX_ACTIONS.map(a => `<th class="perm-mtx-action-head">${escapeHtml(a.label)}</th>`).join('')}
      <th class="perm-mtx-action-head perm-mtx-other-head">Other Actions</th>
      <th class="perm-mtx-action-head perm-mtx-bulk-head">All&nbsp;/&nbsp;None</th>
    </tr>`

  const matrixRows = groups.map(g => {
    const keySet = new Set((g.permissions || []).map(p => p.key))
    // First the six CRUD cells. Each cell records which raw keys it consumes
    // so the "Other Actions" cell at the end can show everything that's left.
    const consumed = new Set()
    const cells = PERM_MATRIX_ACTIONS.map(a => {
      const k = _permMatrixKey(g.module, a.key, keySet)
      if (!k) return `<td class="perm-mtx-cell perm-mtx-na" aria-label="not applicable">—</td>`
      const parts = k.split('|')
      parts.forEach(p => consumed.add(p))
      const allChecked = parts.every(p => granted.has(p))
      const someChecked = parts.some(p => granted.has(p))
      const indet = !allChecked && someChecked
      return `<td class="perm-mtx-cell">
        <label class="perm-mtx-check" title="${escapeHtml(parts.join(' + '))}">
          <input type="checkbox" data-perm="${escapeHtml(k)}" ${allChecked ? 'checked' : ''} ${indet ? 'data-indeterminate="1"' : ''}/>
          <span class="perm-mtx-tick"><i class="fas fa-check"></i></span>
        </label>
      </td>`
    }).join('')

    // Pill-checkboxes for the leftovers (approve, send, mark_paid, move,
    // comment, assign, manage, *.view_overview, hr.*.manage, etc.). Each
    // pill is a normal checkbox styled to read as both a chip and a control,
    // so the entire row of pills wraps inside the same cell.
    const extras = (g.permissions || []).filter(p => !consumed.has(p.key))
    const otherCell = extras.length
      ? `<td class="perm-mtx-cell perm-mtx-other">
          <div class="perm-pill-group">
            ${extras.map(p => `
              <label class="perm-pill" title="${escapeHtml(p.key)}">
                <input type="checkbox" data-perm="${escapeHtml(p.key)}" ${granted.has(p.key)?'checked':''}/>
                <span class="perm-pill-body"><i class="fas fa-check"></i> ${escapeHtml(p.label)}</span>
              </label>`).join('')}
          </div>
        </td>`
      : `<td class="perm-mtx-cell perm-mtx-na" aria-label="no extra actions">—</td>`

    return `
      <tr data-perm-row="${escapeHtml(g.module)}">
        <th class="perm-mtx-module">
          <i class="fas ${escapeHtml(g.icon || 'fa-circle')}"></i>
          <span>${escapeHtml(g.label)}</span>
        </th>
        ${cells}
        ${otherCell}
        <td class="perm-mtx-cell perm-mtx-bulk">
          <button type="button" class="btn btn-xs btn-outline" onclick="togglePermGroup('${escapeHtml(g.module)}', true)">All</button>
          <button type="button" class="btn btn-xs btn-outline" onclick="togglePermGroup('${escapeHtml(g.module)}', false)">None</button>
        </td>
      </tr>`
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

      <div class="perm-mtx-section">
        <div class="perm-mtx-section-head">
          <div>
            <div class="perm-mtx-title">Permissions</div>
            <div class="perm-mtx-sub">Every permission in one place — CRUD actions in the standard columns, anything module-specific (approve, send, assign, manage, etc.) inline under "Other Actions". Dashes mean the module doesn't expose that action.</div>
          </div>
          <div style="display:flex;gap:6px">
            <button type="button" class="btn btn-xs btn-outline" onclick="togglePermMatrix(true)"><i class="fas fa-check-double"></i> Grant all</button>
            <button type="button" class="btn btn-xs btn-outline" onclick="togglePermMatrix(false)"><i class="fas fa-eraser"></i> Clear all</button>
          </div>
        </div>
        <div class="perm-mtx-wrap">
          <table class="perm-mtx">
            <thead>${matrixHeader}</thead>
            <tbody>${matrixRows}</tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveRoleFromModal('${escapeHtml(role?.id || '')}', ${isCreate})">
        <i class="fas fa-save"></i> ${isCreate ? 'Create Role' : 'Save Permissions'}
      </button>
    </div>
  `, 'modal-xl')

  // Reflect composite "some-but-not-all" state visually. The HTML `checked`
  // attribute can't express it, so we paint it after mount.
  setTimeout(() => {
    document.querySelectorAll('input[data-indeterminate="1"]').forEach(cb => { cb.indeterminate = true })
  }, 0)
  } catch (e) {
    // Anything thrown while building the matrix (missing field, bad escape,
    // unexpected catalogue shape) lands here — surface it as a toast instead
    // of blanking out the modal so the user has something to react to.
    console.error('[roles] openRoleEditModal failed:', e)
    toast('Failed to open role editor: ' + (e?.message || 'unknown error'), 'error')
  }
}

// Toggle every checkbox in a single matrix row (per-module All / None).
// All permissions for a module — including the "Other Actions" pills — live
// inside one <tr data-perm-row>, so a single query covers both surfaces.
function togglePermGroup(moduleKey, on) {
  const row = document.querySelector(`[data-perm-row="${moduleKey}"]`)
  if (!row) return
  row.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = !!on; cb.indeterminate = false })
}

// Bulk toggle for every checkbox in the modal (matrix + extras).
function togglePermMatrix(on) {
  document.querySelectorAll('input[data-perm]').forEach(cb => { cb.checked = !!on; cb.indeterminate = false })
}

async function saveRoleFromModal(roleId, isCreate) {
  const name = document.getElementById('role-name')?.value.trim() || ''
  const desc = document.getElementById('role-desc')?.value.trim() || ''
  const key  = document.getElementById('role-key')?.value.trim() || ''
  const checks = document.querySelectorAll('input[data-perm]')
  // Matrix cells can carry a composite "key1|key2" (Modify All grants
  // edit-any + delete-any in one click). De-dup via Set because a key can
  // also exist in the Additional panel.
  const permSet = new Set()
  checks.forEach(cb => {
    if (!cb.checked) return
    String(cb.dataset.perm || '').split('|').filter(Boolean).forEach(k => permSet.add(k))
  })
  const permissions = Array.from(permSet)

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
    // Re-render the roles panel separately so a render error doesn't leak
    // out of this handler — saveRoleFromModal already toasted success.
    try {
      await renderRolesPanel()
    } catch (rpErr) {
      console.error('[roles] renderRolesPanel after save failed:', rpErr)
      toast('Saved, but failed to refresh the roles list: ' + (rpErr?.message || 'unknown error'), 'error')
    }
  } catch (e) {
    console.error('[roles] saveRoleFromModal failed:', e)
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
    <div style="width:32px;height:32px;border-radius:8px;background:rgba(169,112,255,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <i class="fas ${icon}" style="color:#C9A7FF;font-size:12px"></i>
    </div>
    <div><div style="font-size:10px;color:#7E7E8F;text-transform:uppercase;letter-spacing:.04em">${label}</div><div style="font-size:13px;color:#e2e8f0;margin-top:2px">${value}</div></div>
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

/* ── LEAVES VIEW ─────────────────────────────────────────── */
let _leavesPage = 1
let _leavesFilterStatus = ''

const LEAVE_TYPE_LABEL = {
  casual: 'Casual', sick: 'Sick', earned: 'Earned',
  unpaid: 'Unpaid', maternity: 'Maternity', paternity: 'Paternity',
  wfh: 'Work from Home', other: 'Other',
}

async function renderLeavesView(el) {
  el.innerHTML = `<div style="padding:40px;text-align:center;color:#9F8678"><i class="fas fa-spinner fa-spin" style="font-size:24px"></i></div>`
  try {
    const role = String(_user?.role || '').toLowerCase()
    const isManager = ['admin', 'pm', 'pc'].includes(role)

    const [leavesRes, devsRes] = await Promise.all([
      API.get('/leaves'),
      isManager ? API.get('/users').catch(() => ({ users: [] })) : Promise.resolve({ users: [] }),
    ])
    const leaves = leavesRes.leaves || leavesRes.data || []
    const allUsers = devsRes.users || devsRes.data || []
    // Every staff role can have leave applied on their behalf — client is the
    // only excluded role (they don't use this portal). Inactive users are
    // hidden so admins don't accidentally raise leaves for offboarded staff.
    // Self is already pinned as "(me)" at the top of the dropdown, so we drop
    // it from the rest to avoid showing the same person twice.
    const selfId = String(_user?.sub || _user?.id || '')
    const eligibleAssignees = allUsers.filter(u => {
      const r = String(u.role || '').toLowerCase()
      if (!r || r === 'client') return false
      if (Number(u.is_active) === 0) return false
      if (String(u.id) === selfId) return false
      return true
    })

    const filtered = _leavesFilterStatus
      ? leaves.filter(l => l.status === _leavesFilterStatus)
      : leaves
    const pagination = paginateClient(filtered, _leavesPage, 12)
    _leavesPage = pagination.page

    const pendingCount  = leaves.filter(l => l.status === 'pending').length
    const approvedCount = leaves.filter(l => l.status === 'approved').length
    const rejectedCount = leaves.filter(l => l.status === 'rejected').length

    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">${isManager ? 'Leave Management' : 'My Leaves'}</h1>
          <p class="page-subtitle">${isManager ? 'Approve or reject team leave requests' : 'Apply for leave and track status'}</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" onclick="openLeaveApplyModal()"><i class="fas fa-plus"></i> Apply for Leave</button>
        </div>
      </div>

      <div class="grid-4" style="margin-bottom:16px">
        ${miniStatCard('Total Requests', leaves.length, '#A970FF', 'fa-umbrella-beach')}
        ${miniStatCard('Pending',  pendingCount,  '#C9A7FF', 'fa-hourglass-half')}
        ${miniStatCard('Approved', approvedCount, '#58C68A', 'fa-check-circle')}
        ${miniStatCard('Rejected', rejectedCount, '#FF5E3A', 'fa-times-circle')}
      </div>

      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        <button class="btn btn-sm btn-outline" onclick="filterLeaves('')"        ${!_leavesFilterStatus           ?'style="background:rgba(169,112,255,.15);color:#C9A7FF"':''}>All</button>
        <button class="btn btn-sm btn-outline" onclick="filterLeaves('pending')" ${_leavesFilterStatus==='pending' ?'style="background:rgba(169,112,255,.15);color:#D5C0FF"':''}>Pending</button>
        <button class="btn btn-sm btn-outline" onclick="filterLeaves('approved')" ${_leavesFilterStatus==='approved'?'style="background:rgba(88,198,138,.15);color:#86E0A8"':''}>Approved</button>
        <button class="btn btn-sm btn-outline" onclick="filterLeaves('rejected')" ${_leavesFilterStatus==='rejected'?'style="background:rgba(255,94,58,.15);color:#A970FF"':''}>Rejected</button>
      </div>

      <div class="card">
        <div class="card-body" style="padding:0">
          <table class="data-table">
            <thead><tr>
              ${isManager ? '<th>Employee</th>' : ''}
              <th>Type</th><th>From</th><th>To</th><th>Days</th><th>Reason</th><th>Status</th><th style="width:160px">Actions</th>
            </tr></thead>
            <tbody>
              ${pagination.total === 0
                ? `<tr><td colspan="${isManager?8:7}" style="text-align:center;color:#9F8678;padding:36px"><i class="fas fa-umbrella-beach" style="font-size:24px;opacity:.5;margin-bottom:8px;display:block"></i>No leave requests yet.</td></tr>`
                : pagination.items.map(l => renderLeaveRow(l, role, isManager)).join('')}
            </tbody>
          </table>
          ${renderPager(pagination, 'goLeavesPage', 'goLeavesPage', 'leaves')}
        </div>
      </div>
    `

    // Stash data for the modal
    window._leaveAssignees = eligibleAssignees
    window._isLeaveManager = isManager
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>`
  }
}

function renderLeaveRow(l, currentRole, isManager) {
  const statusBadge = l.status === 'approved'
    ? '<span class="badge badge-green">Approved</span>'
    : l.status === 'rejected'
      ? '<span class="badge badge-red">Rejected</span>'
      : '<span class="badge badge-yellow">Pending</span>'
  const myId = _user?.sub || _user?.id
  const isOwner = l.user_id === myId
  // Two-tier permission gate (mirrors backend): admin/leaves.delete_any can
  // wipe any leave at any state; the leave's owner can withdraw their own
  // only while it's still pending and only if they hold leaves.delete_own.
  const role = String(_user?.role || '').toLowerCase()
  const _hasPerm = (k) => typeof hasAnyPermission === 'function' && hasAnyPermission([k])
  const canDeleteAny = role === 'admin' || _hasPerm('leaves.delete_any')
  const canWithdrawOwn = isOwner && l.status === 'pending'
    && (_hasPerm('leaves.delete_own') || _hasPerm('leaves.create_own'))
  const canDelete = canDeleteAny || canWithdrawOwn
  // Stash the leave row so the detail modal can render rich info without re-fetching.
  if (!window._leavesById) window._leavesById = {}
  window._leavesById[l.id] = l
  const employeeName = l.full_name || l.email || 'Unknown employee'

  return `<tr>
    ${isManager ? `<td><div style="display:flex;align-items:center;gap:8px">${avatar(employeeName, l.avatar_color, 'sm')}<span style="font-size:12.5px;color:#FFFFFF">${escapeInbox(employeeName)}</span></div></td>` : ''}
    <td><span class="badge badge-blue">${LEAVE_TYPE_LABEL[l.leave_type] || l.leave_type}</span></td>
    <td style="font-size:12px;color:#9F8678">${fmtDate(l.start_date)}</td>
    <td style="font-size:12px;color:#9F8678">${fmtDate(l.end_date)}</td>
    <td style="font-weight:700;color:#FFFFFF">${l.days_count}</td>
    <td style="font-size:12px;color:#E8D9FF;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeInbox(l.reason || '')}">${escapeInbox(l.reason || '—')}</td>
    <td>${statusBadge}</td>
    <td>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="btn btn-icon btn-xs" onclick="openLeaveDetailModal('${l.id}')" title="View / decide"><i class="fas fa-eye"></i></button>
        ${canDelete ? `<button class="btn btn-icon btn-xs" onclick="deleteLeaveAction('${l.id}')" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
      </div>
    </td>
  </tr>`
}

function openLeaveDetailModal(id) {
  const l = (window._leavesById || {})[id]
  if (!l) { toast('Leave not found', 'error'); return }
  const role = String(_user?.role || '').toLowerCase()
  const isManager = ['admin', 'pm', 'pc'].includes(role)
    || (typeof hasAnyPermission === 'function' && hasAnyPermission(['leaves.approve']))
  // Self-approval is blocked at every layer (backend + table buttons + this
  // modal) — a manager can't sign off on their own leave application.
  const myId = String(_user?.sub || _user?.id || '')
  const isOwnLeave = String(l.user_id || '') === myId
  const canApprove = isManager && l.status === 'pending' && !isOwnLeave
  const employeeName = l.full_name || l.email || 'Unknown employee'
  const statusBadge = l.status === 'approved'
    ? '<span class="badge badge-green">Approved</span>'
    : l.status === 'rejected'
      ? '<span class="badge badge-red">Rejected</span>'
      : '<span class="badge badge-yellow">Pending</span>'

  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-umbrella-beach" style="color:var(--accent);margin-right:6px"></i>Leave Request</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:12px;background:rgba(169,112,255,0.06);border:1px solid rgba(169,112,255,0.2)">
        ${avatar(employeeName, l.avatar_color, 'md')}
        <div>
          <div style="font-size:14px;font-weight:700;color:#FFFFFF">${escapeInbox(employeeName)}</div>
          <div style="font-size:12px;color:#9F8678">${escapeInbox(l.designation || l.email || '')}</div>
        </div>
        <div style="margin-left:auto">${statusBadge}</div>
      </div>
      <div class="grid-2" style="gap:10px">
        <div><div style="font-size:11px;color:#9F8678;text-transform:uppercase;letter-spacing:.5px">Type</div><div style="font-size:13px;color:#FFFFFF;font-weight:600">${LEAVE_TYPE_LABEL[l.leave_type] || l.leave_type}</div></div>
        <div><div style="font-size:11px;color:#9F8678;text-transform:uppercase;letter-spacing:.5px">Days</div><div style="font-size:13px;color:#FFFFFF;font-weight:600">${l.days_count}</div></div>
        <div><div style="font-size:11px;color:#9F8678;text-transform:uppercase;letter-spacing:.5px">From</div><div style="font-size:13px;color:#FFFFFF">${fmtDate(l.start_date)}</div></div>
        <div><div style="font-size:11px;color:#9F8678;text-transform:uppercase;letter-spacing:.5px">To</div><div style="font-size:13px;color:#FFFFFF">${fmtDate(l.end_date)}</div></div>
      </div>
      <div>
        <div style="font-size:11px;color:#9F8678;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Reason from employee</div>
        <div style="font-size:13px;color:#FFFFFF;padding:10px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);min-height:42px">${escapeInbox(l.reason || '— No reason given —')}</div>
      </div>
      ${l.decision_reason ? `
        <div>
          <div style="font-size:11px;color:#9F8678;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Manager note${l.approved_by_name ? ' · ' + escapeInbox(l.approved_by_name) : ''}</div>
          <div style="font-size:13px;color:#FFFFFF;padding:10px;border-radius:8px;background:rgba(169,112,255,0.05);border:1px solid rgba(169,112,255,0.18)">${escapeInbox(l.decision_reason)}</div>
        </div>` : ''}
      ${isOwnLeave && isManager && l.status === 'pending' ? `
        <div class="empty-inline"><i class="fas fa-circle-info"></i><span>This is your own leave request — ask another manager to approve or reject it.</span></div>
      ` : ''}
      ${canApprove ? `
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">Decision reason <span style="color:#9F8678;font-weight:400">(optional)</span></label>
          <textarea id="lv-decision-reason" class="form-textarea" rows="3" placeholder="Why are you approving / rejecting this leave?"></textarea>
        </div>` : ''}
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Close</button>
      ${canApprove ? `
        <button class="btn btn-danger" onclick="submitLeaveDecision('${l.id}','rejected')"><i class="fas fa-times"></i> Disapprove</button>
        <button class="btn btn-success" onclick="submitLeaveDecision('${l.id}','approved')"><i class="fas fa-check"></i> Approve</button>` : ''}
    </div>
  `, 'modal-lg')
}

async function submitLeaveDecision(id, status) {
  const reasonEl = document.getElementById('lv-decision-reason')
  const reason = reasonEl ? reasonEl.value.trim() : ''
  try {
    await API.patch(`/leaves/${id}/approve`, { status, decision_reason: reason || null })
    toast(`Leave ${status}`, 'success')
    closeModal()
    const el = document.getElementById('page-leaves-view')
    if (el) { el.dataset.loaded = ''; renderLeavesView(el) }
    if (typeof pollNotifications === 'function') pollNotifications()
    if (typeof loadBadges === 'function') loadBadges()
  } catch (e) { toast('Failed: ' + e.message, 'error') }
}

function filterLeaves(status) {
  _leavesFilterStatus = status || ''
  _leavesPage = 1
  const el = document.getElementById('page-leaves-view')
  if (el) { el.dataset.loaded = ''; renderLeavesView(el) }
}

function goLeavesPage(page) {
  _leavesPage = Math.max(1, Number(page) || 1)
  const el = document.getElementById('page-leaves-view')
  if (el) { el.dataset.loaded = ''; renderLeavesView(el) }
}

function openLeaveApplyModal() {
  // JWT login stores `id`; client/legacy flows store `sub`. Always resolve to a real value
  // — otherwise the hidden input gets the literal string "undefined" and leaves get saved
  // against a non-existent user, causing "Unknown employee" in the list.
  const myId = _user?.sub || _user?.id || ''

  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-umbrella-beach" style="color:var(--accent);margin-right:6px"></i>Apply for Leave</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <input type="hidden" id="lv-user" value="${myId}"/>
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Leave Type *</label>
          <select id="lv-type" class="form-select">
            <option value="casual">Casual</option>
            <option value="sick">Sick</option>
            <option value="earned">Earned</option>
            <option value="unpaid">Unpaid</option>
            <option value="wfh">Work from Home</option>
            <option value="maternity">Maternity</option>
            <option value="paternity">Paternity</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Days</label>
          <input id="lv-days" class="form-input" type="number" value="1" min="0.5" step="0.5"/>
        </div>
      </div>
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">From *</label>
          <input id="lv-from" class="form-input" type="date" onchange="recalcLeaveDays()"/>
        </div>
        <div class="form-group">
          <label class="form-label">To *</label>
          <input id="lv-to" class="form-input" type="date" onchange="recalcLeaveDays()"/>
        </div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">Reason</label>
        <textarea id="lv-reason" class="form-textarea" rows="3" placeholder="Reason for the leave (optional but recommended)"></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitLeaveApply()"><i class="fas fa-paper-plane"></i> Submit Request</button>
    </div>
  `, 'modal-lg')

  // Default From = today
  const today = new Date().toISOString().slice(0, 10)
  const f = document.getElementById('lv-from'); if (f) f.value = today
  const t = document.getElementById('lv-to');   if (t) t.value = today
}

function recalcLeaveDays() {
  const from = document.getElementById('lv-from')?.value
  const to   = document.getElementById('lv-to')?.value
  if (!from || !to) return
  const diff = Math.ceil((new Date(to) - new Date(from)) / (1000*60*60*24)) + 1
  const d = document.getElementById('lv-days')
  if (d) d.value = Math.max(0.5, diff)
}

async function submitLeaveApply() {
  const myId = _user?.sub || _user?.id || ''
  const rawUserId = document.getElementById('lv-user')?.value || ''
  // Guard against the literal string "undefined" sneaking in if the dropdown
  // was rendered before _user was hydrated.
  const userId = (rawUserId && rawUserId !== 'undefined') ? rawUserId : myId
  if (!userId) { toast('Could not identify your user account — please log in again', 'error'); return }
  const type = document.getElementById('lv-type').value
  const from = document.getElementById('lv-from').value
  const to   = document.getElementById('lv-to').value
  const days = parseFloat(document.getElementById('lv-days').value) || 1
  const reason = document.getElementById('lv-reason').value.trim()
  if (!from || !to) { toast('From and To dates are required', 'error'); return }
  if (new Date(from) > new Date(to)) { toast('From date must be before To date', 'error'); return }
  try {
    await API.post('/leaves', {
      user_id: userId,
      leave_type: type,
      start_date: from,
      end_date: to,
      days_count: days,
      reason,
    })
    toast('Leave request submitted', 'success')
    closeModal()
    const el = document.getElementById('page-leaves-view')
    if (el) { el.dataset.loaded = ''; renderLeavesView(el) }
    if (typeof loadBadges === 'function') loadBadges()
  } catch (e) {
    toast('Failed: ' + (e.message || 'unknown'), 'error')
  }
}

async function approveLeaveAction(id, status) {
  // Belt-and-braces self-approval guard. The backend rejects this 403 too,
  // but checking client-side keeps the UX feedback instant.
  const leave = (window._leavesById || {})[id]
  if (leave && String(leave.user_id || '') === String(_user?.sub || _user?.id || '')) {
    toast('You cannot approve or reject your own leave. Ask another manager.', 'error')
    return
  }
  if (status === 'rejected') {
    return showRejectLeaveModal(id)
  }
  try {
    await API.patch(`/leaves/${id}/approve`, { status })
    toast(`Leave ${status}`, 'success')
    if (typeof pollNotifications === 'function') pollNotifications()
  } catch (e) { toast('Failed: ' + e.message, 'error') }
}

function showRejectLeaveModal(id) {
  showModal(`
  <div class="modal-header"><h3><i class="fas fa-times-circle" style="color:#FF5E3A"></i> Reject Leave</h3><button class="close-btn" onclick="closeModal()">✕</button></div>
  <div class="modal-body">
    <div style="font-size:13px;color:#7E7E8F;margin-bottom:12px">Optionally add a reason — the employee will see this in their notification.</div>
    <div class="form-group"><label class="form-label">Rejection reason <span style="color:#9F8678;font-weight:400">(optional)</span></label><textarea id="rj-reason" class="form-textarea" rows="3" placeholder="Why is this leave being rejected?"></textarea></div>
  </div>
  <div class="modal-footer">
    <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
    <button class="btn btn-danger" onclick="doRejectLeave('${id}')"><i class="fas fa-times"></i> Reject</button>
  </div>`)
}
async function doRejectLeave(id) {
  const reason = document.getElementById('rj-reason')?.value.trim() || ''
  try {
    await API.patch(`/leaves/${id}/approve`, { status: 'rejected', decision_reason: reason || null })
    toast('Leave rejected', 'info')
    closeModal()
  } catch (e) { toast('Failed: ' + e.message, 'error') }
}

async function deleteLeaveAction(id) {
  if (!confirm('Delete this leave request?')) return
  try {
    await API.delete(`/leaves/${id}`)
    toast('Deleted', 'success')
    const el = document.getElementById('page-leaves-view')
    if (el) { el.dataset.loaded = ''; renderLeavesView(el) }
  } catch (e) { toast('Failed: ' + e.message, 'error') }
}

// ── Bidding ──────────────────────────────────────────────────
// Standalone module — talks to /api/bids (not /api/projects). The bid module
// owns the auction lifecycle: create, invite teams, place bids, reveal at
// the visibility window, award (which spawns a real project automatically).
let _biddingTimer = null
const _biddingState = { auctions: [] }

function _formatCountdown(ms) {
  if (ms == null) return '—'
  if (ms <= 0) return 'Closed'
  const total = Math.floor(ms / 1000)
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (d > 0) return `${d}d ${h}h ${m}m ${String(s).padStart(2,'0')}s`
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}

async function renderBiddingView(el) {
  el.innerHTML = `<div style="padding:40px;text-align:center;color:#9F8678"><i class="fas fa-spinner fa-spin" style="font-size:24px"></i></div>`
  try {
    const res = await API.get('/bids')
    const auctions = res.data || res.auctions || []
    _biddingState.auctions = auctions

    const role = String(_user?.role || '').toLowerCase()
    const canCreate = ['admin', 'pm'].includes(role)

    el.innerHTML = `
      <div class="page-header">
        <div><h1 class="page-title">Bidding</h1><p class="page-subtitle">${auctions.length} ${auctions.length === 1 ? 'auction' : 'auctions'}</p></div>
        ${canCreate ? `<div class="page-actions"><button class="btn btn-primary" onclick="openAuctionModal()"><i class="fas fa-plus"></i> New Auction</button></div>` : ''}
      </div>
      ${auctions.length === 0
        ? `<div class="empty-state"><i class="fas fa-gavel"></i><p>${canCreate ? 'No auctions yet — start one to invite teams to bid.' : 'No auctions you are invited to yet.'}</p></div>`
        : `<div class="grid-3" style="gap:14px;align-items:stretch">${auctions.map(a => renderAuctionCard(a)).join('')}</div>`}
    `

    if (_biddingTimer) clearInterval(_biddingTimer)
    _biddingTimer = setInterval(updateBiddingCountdowns, 1000)
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>`
  }
}

function renderAuctionCard(a) {
  const deadlineMs = a.bid_deadline ? new Date(a.bid_deadline).getTime() : null
  const myId = _user?.sub || _user?.id
  const myBid = a.my_submission || (a.submissions || []).find(s => s.user_id === myId) || null
  const isClosed = deadlineMs ? Date.now() > deadlineMs : false
  const role = String(_user?.role || '').toLowerCase()
  const isAdminOrPm = ['admin', 'pm'].includes(role)
  const canAward = isAdminOrPm && a.status === 'open' && (a.submission_count || 0) > 0
  const canBid = !isClosed && a.status === 'open' && !isAdminOrPm
  const reveal = !!a.visibility_open
  const lowestText = reveal && a.lowest_amount != null
    ? `₹${Number(a.lowest_amount).toLocaleString()}${a.lowest_bidder_name ? ' · ' + escapeInbox(a.lowest_bidder_name) : ''}`
    : (reveal ? '—' : 'Hidden')
  const winnerName = a.status === 'awarded' ? a.winner_name : null
  const winnerAmt = a.status === 'awarded' ? a.winner_amount : null
  return `
    <div class="card" style="display:flex;flex-direction:column">
      <div class="card-body" style="display:flex;flex-direction:column;gap:10px;flex:1">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div>
            <div style="font-size:15px;font-weight:700;color:#FFFFFF">${escapeInbox(a.name || '')}</div>
            <div style="font-size:11px;color:#9F8678;font-family:monospace">${escapeInbox(a.code || '')}${a.client_name ? ' · ' + escapeInbox(a.client_name) : ''}</div>
          </div>
          <span class="badge ${a.status === 'awarded' ? 'badge-green' : (isClosed || a.status !== 'open') ? 'badge-red' : 'badge-blue'}">${a.status === 'awarded' ? 'Awarded' : isClosed ? 'Closed' : 'Open'}</span>
        </div>
        ${a.scope ? `
          <div style="padding:10px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06)">
            <div style="font-size:10px;color:#9F8678;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px"><i class="fas fa-file-lines"></i> Scope</div>
            <div style="font-size:12.5px;color:#E8D9FF;line-height:1.55;white-space:pre-wrap">${escapeInbox(a.scope.slice(0, 320))}${a.scope.length > 320 ? '…' : ''}</div>
          </div>` : ''}
        <div class="grid-2" style="gap:8px">
          <div><div style="font-size:10px;color:#9F8678;text-transform:uppercase">Max bid</div><div style="font-size:13px;font-weight:700;color:#FFFFFF">₹${Number(a.max_bid_amount || 0).toLocaleString()}</div></div>
          <div><div style="font-size:10px;color:#9F8678;text-transform:uppercase">Reveal</div><div style="font-size:13px;font-weight:700;color:#FFFFFF">${a.visibility_hours ? `${a.visibility_hours}h before close` : 'After close'}</div></div>
          ${a.planned_start_date ? `<div><div style="font-size:10px;color:#9F8678;text-transform:uppercase">Start</div><div style="font-size:12px;color:#FFFFFF">${fmtDate(a.planned_start_date)}</div></div>` : ''}
          ${a.planned_end_date ? `<div><div style="font-size:10px;color:#9F8678;text-transform:uppercase">End</div><div style="font-size:12px;color:#FFFFFF">${fmtDate(a.planned_end_date)}</div></div>` : ''}
        </div>
        ${a.status === 'open' && !isClosed ? `
          <div style="padding:10px;border-radius:10px;background:rgba(169,112,255,0.08);border:1px solid rgba(169,112,255,0.18)">
            <div style="font-size:11px;color:#9F8678;text-transform:uppercase;letter-spacing:.5px">Time remaining</div>
            <div data-bid-countdown="${a.id}" data-deadline="${deadlineMs || ''}" style="font-size:18px;font-weight:700;color:#C9A7FF;font-variant-numeric:tabular-nums">${_formatCountdown(deadlineMs ? deadlineMs - Date.now() : null)}</div>
          </div>` : `
          <div style="padding:10px;border-radius:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08)">
            <div style="font-size:11px;color:#9F8678;text-transform:uppercase;letter-spacing:.5px">Bidding</div>
            <div style="font-size:15px;font-weight:700;color:#9F8678">${a.status === 'awarded' ? 'Awarded' : a.status === 'cancelled' ? 'Cancelled' : 'Closed'}</div>
          </div>`}
        <div class="grid-2" style="gap:8px">
          <div><div style="font-size:10px;color:#9F8678;text-transform:uppercase">Bids</div><div style="font-size:14px;font-weight:700;color:#FFFFFF">${a.submission_count || 0}</div></div>
          <div><div style="font-size:10px;color:#9F8678;text-transform:uppercase">Lowest</div><div style="font-size:14px;font-weight:700;color:#FFFFFF">${lowestText}</div></div>
        </div>
        ${!reveal && a.status === 'open' ? `<div style="font-size:11px;color:#9F8678"><i class="fas fa-eye-slash"></i> Other bids reveal ${a.visibility_hours ? a.visibility_hours + 'h before deadline' : 'after deadline'}</div>` : ''}
        ${myBid ? `<div style="font-size:11.5px;color:#86E0A8"><i class="fas fa-check-circle"></i> Your bid: ₹${Number(myBid.amount).toLocaleString()}${myBid.delivery_days ? ' · ' + myBid.delivery_days + ' days' : ''}</div>` : ''}
        ${winnerName ? `
          <div style="padding:10px;border-radius:10px;background:rgba(88,198,138,0.08);border:1px solid rgba(88,198,138,0.25)">
            <div style="font-size:10px;color:#86E0A8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px"><i class="fas fa-trophy"></i> Won by</div>
            <div style="font-size:13px;color:#FFFFFF;font-weight:700">${escapeInbox(winnerName)}${winnerAmt ? ' · ₹' + Number(winnerAmt).toLocaleString() : ''}</div>
            ${a.resulting_project_id ? `<div style="font-size:11px;color:#9F8678;margin-top:3px"><i class="fas fa-folder-open"></i> Project auto-created</div>` : ''}
          </div>` : ''}
      </div>
      <div style="padding:12px;border-top:1px solid rgba(255,255,255,0.06);display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-outline btn-sm" onclick="openAuctionDetailModal('${a.id}')" style="flex:1"><i class="fas fa-list"></i> View bids</button>
        ${canBid ? `<button class="btn btn-primary btn-sm" onclick="openPlaceBidModal('${a.id}')" style="flex:1"><i class="fas fa-gavel"></i> ${myBid ? 'Update' : 'Place'} bid</button>` : ''}
        ${canAward ? `<button class="btn btn-success btn-sm" onclick="openAuctionDetailModal('${a.id}')" style="flex:1"><i class="fas fa-trophy"></i> Award</button>` : ''}
      </div>
    </div>`
}

function updateBiddingCountdowns() {
  const nodes = document.querySelectorAll('[data-bid-countdown]')
  // No live countdown nodes left (we don't render them for awarded/closed
  // auctions any more) — stop the interval so we don't keep ticking forever.
  if (nodes.length === 0 && _biddingTimer) {
    clearInterval(_biddingTimer)
    _biddingTimer = null
    return
  }
  nodes.forEach(node => {
    const dl = Number(node.dataset.deadline)
    if (!dl) return
    node.textContent = _formatCountdown(dl - Date.now())
  })
}

// Refresh whichever bid surfaces are currently mounted: the dedicated bidding
// page, the team dashboard's auction strip, and the auction detail modal if
// it's open. Used after place-bid / award so the new amount shows up without
// the user having to manually reload.
async function refreshBidSurfaces(auctionId) {
  const bid = document.getElementById('page-bidding-view')
  if (bid?.classList.contains('active')) {
    bid.dataset.loaded = ''
    if (typeof renderBiddingView === 'function') renderBiddingView(bid)
  }
  const dash = document.getElementById('page-team-dashboard')
  if (dash?.classList.contains('active')) {
    dash.dataset.loaded = ''
    if (typeof renderTeamDashboard === 'function') renderTeamDashboard(dash)
  }
  // If a detail modal for this auction is open, re-render it in place.
  if (auctionId && document.querySelector(`[data-auction-modal="${auctionId}"]`)) {
    if (typeof openAuctionDetailModal === 'function') openAuctionDetailModal(auctionId)
  }
}

function _findAuction(id) {
  return (_biddingState.auctions || []).find(a => a.id === id)
}

// ── New auction creation modal ───────────────────────────────
async function openAuctionModal() {
  let teamUsers = []
  let clients = []
  try {
    const [teamsRes, clientsRes] = await Promise.all([
      API.get('/users?role=team').catch(() => ({ users: [] })),
      API.get('/clients').catch(() => ({ clients: [] })),
    ])
    teamUsers = (teamsRes.users || teamsRes.data || [])
      .filter(u => String(u.role || '').toLowerCase() === 'team')
    clients = clientsRes.clients || clientsRes.data || []
  } catch {}
  window._auctionInvitedIds = new Set()
  window._auctionFiles = []
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-gavel" style="color:var(--accent);margin-right:6px"></i>New Bid Auction</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div class="grid-2" style="gap:12px">
        <div class="form-group" style="margin-bottom:0"><label class="form-label">Name *</label><input id="auc-name" class="form-input" placeholder="e.g. Mariox CRM Build"/></div>
        <div class="form-group" style="margin-bottom:0"><label class="form-label">Code *</label><input id="auc-code" class="form-input" placeholder="e.g. CRM-Q1"/></div>
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">Client</label>
          <select id="auc-client" class="form-select">
            <option value="">— Internal / None —</option>
            ${clients.map(c => `<option value="${escapeInbox(c.id)}" data-name="${escapeInbox(c.company_name || c.contact_name || '')}">${escapeInbox(c.company_name || c.contact_name || c.email)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">Maximum bid amount (₹) *</label>
          <input id="auc-max" class="form-input" type="number" min="1" step="1" placeholder="bidders can't bid higher than this"/>
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">Bid deadline *</label>
          <input id="auc-deadline" class="form-input" type="datetime-local"/>
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label">Reveal bids window (hours before deadline)</label>
          <input id="auc-visibility" class="form-input" type="number" min="0" step="0.5" value="3" placeholder="e.g. 3"/>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Bidders see each other's amounts only in the last X hours.</div>
        </div>
        <div class="form-group" style="margin-bottom:0"><label class="form-label">Planned start date</label><input id="auc-start" class="form-input" type="date"/></div>
        <div class="form-group" style="margin-bottom:0"><label class="form-label">Planned end date</label><input id="auc-end" class="form-input" type="date"/></div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label"><i class="fas fa-file-lines" style="color:#A970FF;margin-right:6px"></i>Project scope *</label>
        <textarea id="auc-scope" class="form-textarea" rows="4" placeholder="Describe the deliverables, tech, constraints — bidders read this before bidding."></textarea>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label"><i class="fas fa-paperclip" style="color:#A970FF;margin-right:6px"></i>Attachments (optional)</label>
        <div style="border:1px dashed rgba(179,136,255,.32);border-radius:10px;padding:10px;background:rgba(0,0,0,.18)">
          <input id="auc-files-input" type="file" multiple style="display:none" onchange="aucAddFiles(this.files);this.value=''"/>
          <button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById('auc-files-input').click()"><i class="fas fa-upload"></i> Choose files</button>
          <span style="font-size:11px;color:var(--text-muted);margin-left:8px">Bidders + Documents will see these. 25 MB / file.</span>
          <div id="auc-files-list" style="display:flex;flex-direction:column;gap:6px;margin-top:8px"></div>
        </div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label"><i class="fas fa-users" style="color:#A970FF;margin-right:6px"></i>Invite teams (role=team) *</label>
        <div style="border:1px solid var(--border);border-radius:12px;overflow:hidden">
          <div id="auc-team-list" style="max-height:220px;overflow-y:auto;padding:8px">
            ${teamUsers.length === 0 ? '<div style="color:var(--text-muted);font-size:12px;padding:8px;text-align:center">No team users available</div>' :
              teamUsers.map(u => `
                <label data-team-row="${u.id}" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;margin-bottom:4px;border:1px solid transparent">
                  <input type="checkbox" data-team-cb="${u.id}" onchange="toggleAuctionInvite('${u.id}', this.checked)" style="accent-color:#A970FF;width:15px;height:15px"/>
                  <div style="width:28px;height:28px;border-radius:50%;background:${u.avatar_color || '#A970FF'};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;flex-shrink:0">${escapeInbox((u.full_name || '').split(' ').map(n => n[0]).join('').slice(0, 2))}</div>
                  <div style="flex:1">
                    <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${escapeInbox(u.full_name)}</div>
                    <div style="font-size:11px;color:var(--text-muted)">${escapeInbox(u.designation || u.email || 'team')}</div>
                  </div>
                </label>`).join('')}
          </div>
        </div>
        <div id="auc-invite-count" style="font-size:11px;color:#9F8678;margin-top:4px">0 selected</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitAuction()"><i class="fas fa-paper-plane"></i> Create auction</button>
    </div>
  `, 'modal-xl')
}

function aucAddFiles(fileList) {
  if (!window._auctionFiles) window._auctionFiles = []
  for (const f of fileList) window._auctionFiles.push(f)
  aucRenderFilesList()
}
function aucRemoveFile(idx) {
  if (!window._auctionFiles) return
  window._auctionFiles.splice(idx, 1)
  aucRenderFilesList()
}
function aucRenderFilesList() {
  const wrap = document.getElementById('auc-files-list')
  if (!wrap) return
  const files = window._auctionFiles || []
  if (!files.length) { wrap.innerHTML = ''; return }
  wrap.innerHTML = files.map((f, i) => {
    const sizeMb = (f.size / (1024 * 1024)).toFixed(2)
    const tooBig = f.size > 25 * 1024 * 1024
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:6px 10px;background:rgba(11,11,13,.5);border:1px solid rgba(179,136,255,.18);border-radius:8px">
        <i class="fas fa-file" style="color:#A970FF;font-size:14px"></i>
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${f.name}</div>
          <div style="font-size:10.5px;color:${tooBig ? '#FF5E3A' : '#7E7E8F'}">${sizeMb} MB${tooBig ? ' — exceeds 25 MB limit' : ''}</div>
        </div>
        <button type="button" class="btn btn-sm btn-outline" style="border-color:rgba(255,94,58,.4);color:#FF5E3A" onclick="aucRemoveFile(${i})"><i class="fas fa-times"></i></button>
      </div>`
  }).join('')
}

function toggleAuctionInvite(id, checked) {
  if (!window._auctionInvitedIds) window._auctionInvitedIds = new Set()
  if (checked) window._auctionInvitedIds.add(id)
  else window._auctionInvitedIds.delete(id)
  const cnt = document.getElementById('auc-invite-count')
  if (cnt) cnt.textContent = `${window._auctionInvitedIds.size} selected`
}

async function submitAuction() {
  const name = (document.getElementById('auc-name').value || '').trim()
  const code = (document.getElementById('auc-code').value || '').trim()
  const clientSelect = document.getElementById('auc-client')
  const clientOpt = clientSelect?.selectedOptions?.[0]
  const scope = (document.getElementById('auc-scope').value || '').trim()
  const maxBid = parseFloat(document.getElementById('auc-max').value)
  const deadlineRaw = document.getElementById('auc-deadline').value
  const visibility = parseFloat(document.getElementById('auc-visibility').value)
  const start = document.getElementById('auc-start').value || null
  const end = document.getElementById('auc-end').value || null
  const invited = Array.from(window._auctionInvitedIds || [])

  const pendingFiles = window._auctionFiles || []

  if (!name || !code) { toast('Name and Code required', 'error'); return }
  if (!scope) { toast('Add the project scope', 'error'); return }
  if (!maxBid || maxBid <= 0) { toast('Enter a valid maximum bid amount', 'error'); return }
  if (!deadlineRaw) { toast('Set a bid deadline', 'error'); return }
  if (invited.length === 0) { toast('Pick at least one team to invite', 'error'); return }
  for (const f of pendingFiles) {
    if (f.size > 25 * 1024 * 1024) { toast(`"${f.name}" exceeds the 25 MB limit`, 'error'); return }
  }

  try {
    const attachments = []
    for (const f of pendingFiles) {
      try {
        const uploaded = await udUploadFileToServer(f)
        attachments.push({
          file_name: uploaded.file_name || f.name,
          file_url: uploaded.url,
          file_type: uploaded.file_type || f.type || null,
          file_size: uploaded.file_size || f.size || 0,
        })
      } catch (e) {
        toast(`"${f.name}" upload failed: ${e.message}`, 'error')
        return
      }
    }
    await API.post('/bids', {
      name, code,
      client_id: clientSelect?.value || null,
      client_name: clientOpt?.dataset?.name || null,
      scope,
      max_bid_amount: maxBid,
      bid_deadline: new Date(deadlineRaw).toISOString(),
      visibility_hours: Number.isFinite(visibility) && visibility >= 0 ? visibility : 0,
      planned_start_date: start,
      planned_end_date: end,
      invited_user_ids: invited,
      attachments,
    })
    toast('Auction created', 'success')
    window._auctionFiles = []
    closeModal()
    const el = document.getElementById('page-bidding-view')
    if (el) { el.dataset.loaded = ''; renderBiddingView(el) }
    const docEl = document.getElementById('page-documents-center')
    if (docEl) { docEl.dataset.loaded = ''; }
  } catch (e) { toast('Failed: ' + e.message, 'error') }
}

// ── Place / update bid modal ─────────────────────────────────
function openPlaceBidModal(auctionId) {
  const a = _findAuction(auctionId)
  if (!a) { toast('Auction not found', 'error'); return }
  const myId = _user?.sub || _user?.id
  const myBid = a.my_submission || (a.submissions || []).find(s => s.user_id === myId) || null
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-gavel" style="color:var(--accent);margin-right:6px"></i>${myBid ? 'Update' : 'Place'} bid · ${escapeInbox(a.name)}</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div class="form-group">
        <label class="form-label">Your bid amount (₹) *</label>
        <input id="bid-amount" class="form-input" type="number" min="1" step="1" max="${a.max_bid_amount || ''}" value="${myBid?.amount || ''}" placeholder="Enter your bid amount" oninput="validateBidAmount(this, ${Number(a.max_bid_amount) || 0})"/>
        <div id="bid-amount-error" style="display:none;margin-top:6px;font-size:12px;color:#F87171"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Delivery in (days)</label>
        <input id="bid-days" class="form-input" type="number" min="1" step="1" value="${myBid?.delivery_days || ''}" placeholder="e.g. 14"/>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">Note for the client</label>
        <textarea id="bid-note" class="form-textarea" rows="3" placeholder="Why should you win this bid?">${escapeInbox(myBid?.note || '')}</textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitPlaceBid('${auctionId}', ${Number(a.max_bid_amount) || 0})"><i class="fas fa-paper-plane"></i> ${myBid ? 'Update' : 'Submit'} bid</button>
    </div>
  `, 'modal-md')
}

function validateBidAmount(input, maxBidAmount) {
  const errEl = document.getElementById('bid-amount-error')
  if (!errEl) return
  const val = parseFloat(input.value)
  if (input.value === '' || Number.isNaN(val)) {
    errEl.style.display = 'none'
    errEl.textContent = ''
    input.classList.remove('input-error')
    return
  }
  if (val <= 0) {
    errEl.textContent = 'Enter a valid bid amount'
    errEl.style.display = 'block'
    input.classList.add('input-error')
    return
  }
  if (Number(maxBidAmount) > 0 && val > Number(maxBidAmount)) {
    errEl.textContent = `Bid cannot exceed the maximum of ₹${Number(maxBidAmount).toLocaleString()}`
    errEl.style.display = 'block'
    input.classList.add('input-error')
    return
  }
  errEl.style.display = 'none'
  errEl.textContent = ''
  input.classList.remove('input-error')
}

async function submitPlaceBid(auctionId, maxBidAmount) {
  const amountInput = document.getElementById('bid-amount')
  const errEl = document.getElementById('bid-amount-error')
  const amount = parseFloat(amountInput.value)
  const days = parseFloat(document.getElementById('bid-days').value)
  const note = (document.getElementById('bid-note').value || '').trim()
  const showInlineErr = (msg) => {
    if (errEl) {
      errEl.textContent = msg
      errEl.style.display = 'block'
    }
    amountInput?.classList.add('input-error')
    amountInput?.focus()
  }
  if (!amount || amount <= 0) { showInlineErr('Enter a valid bid amount'); return }
  // Frontend guard so the user gets the message before the round-trip.
  if (Number(maxBidAmount) > 0 && amount > Number(maxBidAmount)) {
    showInlineErr(`Bid cannot exceed the maximum of ₹${Number(maxBidAmount).toLocaleString()}`)
    return
  }
  try {
    await API.post(`/bids/${auctionId}/submissions`, {
      amount,
      delivery_days: Number.isFinite(days) && days > 0 ? days : null,
      note: note || null,
    })
    toast('Bid submitted', 'success')
    closeModal()
    await refreshBidSurfaces(auctionId)
  } catch (e) { toast('Failed: ' + e.message, 'error') }
}

// ── Auction detail / award modal ─────────────────────────────
async function openAuctionDetailModal(auctionId) {
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-list" style="color:var(--accent);margin-right:6px"></i>Auction details</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;text-align:center;color:#9F8678"><i class="fas fa-spinner fa-spin"></i> Loading…</div>
  `, 'modal-lg')
  try {
    const res = await API.get(`/bids/${auctionId}`)
    const a = res.data || res.auction
    const role = String(_user?.role || '').toLowerCase()
    const canAward = ['admin', 'pm'].includes(role) && a.status === 'open'
    const subs = a.submissions || []
    const reveal = !!a.visibility_open
    const winnerName = a.status === 'awarded' ? a.winner_name : null
    closeModal()
    // data-auction-modal lets refreshBidSurfaces find this modal and re-render
    // it after a bid is placed/awarded — without it the modal sits stale and
    // the user has to close + reopen to see updates.
    showModal(`
      <div data-auction-modal="${auctionId}" class="modal-header">
        <h3><i class="fas fa-list" style="color:var(--accent);margin-right:6px"></i>${escapeInbox(a.name)} <span style="font-size:12px;color:#9F8678;font-weight:400">· ${escapeInbox(a.code)}</span></h3>
        <button class="close-btn" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
        ${winnerName ? `<div style="padding:10px;border-radius:10px;background:rgba(88,198,138,0.1);border:1px solid rgba(88,198,138,0.3);font-size:13px;color:#FFFFFF"><i class="fas fa-trophy" style="color:#86E0A8"></i> <strong>${escapeInbox(winnerName)}</strong> won at ₹${Number(a.winner_amount || 0).toLocaleString()}${a.resulting_project_id ? ' — project auto-created' : ''}</div>` : ''}
        ${a.scope ? `<div><div style="font-size:10px;color:#9F8678;text-transform:uppercase;margin-bottom:4px">Scope</div><div style="font-size:13px;color:#E8D9FF;line-height:1.55;white-space:pre-wrap">${escapeInbox(a.scope)}</div></div>` : ''}
        ${(a.attachments && a.attachments.length) ? `
          <div>
            <div style="font-size:10px;color:#9F8678;text-transform:uppercase;margin-bottom:6px">Attachments (${a.attachments.length})</div>
            <div style="display:flex;flex-direction:column;gap:6px">
              ${a.attachments.map(f => `
                <a href="${escapeInbox(f.file_url)}" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(11,11,13,.5);border:1px solid rgba(179,136,255,.18);border-radius:8px;text-decoration:none">
                  <i class="fas fa-file" style="color:#A970FF;font-size:14px"></i>
                  <div style="flex:1;min-width:0">
                    <div style="font-size:12.5px;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeInbox(f.file_name || 'file')}</div>
                    <div style="font-size:10.5px;color:#7E7E8F">${f.file_size ? (Number(f.file_size) / (1024 * 1024)).toFixed(2) + ' MB' : ''}${f.file_type ? ' • ' + escapeInbox(f.file_type) : ''}</div>
                  </div>
                  <i class="fas fa-external-link-alt" style="color:#9F8678;font-size:11px"></i>
                </a>`).join('')}
            </div>
          </div>` : ''}
        <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:#9F8678">
          <span><i class="fas fa-rupee-sign"></i> Max ₹${Number(a.max_bid_amount || 0).toLocaleString()}</span>
          <span><i class="fas fa-stopwatch"></i> Closes ${new Date(a.bid_deadline).toLocaleString()}</span>
          <span><i class="fas fa-eye"></i> ${a.visibility_hours ? `Reveal ${a.visibility_hours}h before` : 'Reveal at close'}</span>
        </div>
        ${!reveal && a.status === 'open' && !['admin','pm','pc'].includes(role) ? `
          <div style="padding:10px;border-radius:10px;background:rgba(255,255,255,0.04);font-size:12px;color:#9F8678">
            <i class="fas fa-eye-slash"></i> Other bids stay hidden until the reveal window opens.
          </div>` : ''}
        <div>
          <div style="font-size:11px;color:#9F8678;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Bids (${a.submission_count || 0})</div>
          ${subs.length === 0 ? '<div class="empty-state"><i class="fas fa-inbox"></i><p>No bids yet.</p></div>' : `
            <table class="data-table">
              <thead><tr><th>Bidder</th><th>Amount</th><th>Delivery</th><th>Note</th>${canAward ? '<th></th>' : ''}</tr></thead>
              <tbody>
                ${subs.map((s, i) => `<tr ${(reveal && i === 0) ? 'style="background:rgba(88,198,138,0.08)"' : ''}>
                  <td><div style="display:flex;align-items:center;gap:8px">${avatar(s.bidder_name || '—', s.avatar_color, 'sm')}<span style="font-size:12.5px;color:#FFFFFF">${escapeInbox(s.bidder_name || '—')}</span>${(reveal && i === 0) ? '<span class="badge badge-green" style="font-size:10px">Lowest</span>' : ''}${s.status === 'awarded' ? '<span class="badge badge-green" style="font-size:10px">Won</span>' : ''}${s.status === 'lost' ? '<span class="badge" style="font-size:10px;background:rgba(255,255,255,0.06);color:#9F8678">Lost</span>' : ''}</div></td>
                  <td style="font-weight:700;color:#FFFFFF">₹${Number(s.amount).toLocaleString()}</td>
                  <td style="font-size:12px;color:#9F8678">${s.delivery_days ? s.delivery_days + ' days' : '—'}</td>
                  <td style="font-size:12px;color:#E8D9FF;max-width:240px">${escapeInbox(s.note || '—')}</td>
                  ${canAward && s.status === 'submitted' ? `<td><button class="btn btn-success btn-xs" onclick="awardBidAction('${auctionId}','${s.id}')"><i class="fas fa-trophy"></i> Award</button></td>` : (canAward ? '<td></td>' : '')}
                </tr>`).join('')}
              </tbody>
            </table>`}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Close</button>
      </div>
    `, 'modal-lg')
  } catch (e) {
    toast('Failed to load auction: ' + e.message, 'error')
  }
}

async function awardBidAction(auctionId, submissionId) {
  if (!confirm('Award this bid? It will close the auction and auto-create the project.')) return
  try {
    const res = await API.post(`/bids/${auctionId}/submissions/${submissionId}/award`)
    toast(res.message || 'Bid awarded — project created', 'success')
    closeModal()
    await refreshBidSurfaces(auctionId)
    // Also refresh the Projects list if visible (a new project was created).
    const projEl = document.getElementById('page-projects-list')
    if (projEl?.classList.contains('active')) {
      projEl.dataset.loaded = ''
      if (typeof loadPage === 'function') loadPage('projects-list', projEl)
    }
  } catch (e) { toast('Failed: ' + e.message, 'error') }
}

// ── Team Dashboard ───────────────────────────────────────────
// Shown to role=team accounts. The "team" account is a single head/lead
// user — so this is essentially their personal landing page: their projects
// (external assignments + bids they won) plus active auctions they are
// invited to bid on.
async function renderTeamDashboard(el) {
  el.innerHTML = `<div style="padding:40px;text-align:center;color:#9F8678"><i class="fas fa-spinner fa-spin" style="font-size:24px"></i></div>`
  try {
    const myId = _user?.sub || _user?.id || ''
    const [projRes, bidsRes] = await Promise.all([
      API.get('/projects').catch(() => ({ projects: [] })),
      API.get('/bids').catch(() => ({ data: [] })),
    ])
    const allProjects = projRes.projects || projRes.data?.projects || []
    const auctions = bidsRes.data || bidsRes.auctions || []
    // A project is "mine" if it was assigned externally to me, or auto-created
    // from a bid I won, or its source bid is one I won.
    const myProjects = allProjects.filter((p) => {
      if (p.external_team_id === myId) return true
      if (p.awarded_to_user_id === myId) return true
      return false
    })
    const activeProjects = myProjects.filter((p) => p.status === 'active')
    const openAuctions = auctions.filter((a) => a.status === 'open')
    const myWins = auctions.filter((a) => a.awarded_user_id === myId)
    const totalRevenue = myWins.reduce((sum, a) => sum + (Number(a.awarded_amount) || 0), 0)

    el.innerHTML = `
      ${typeof helloBanner === 'function' ? helloBanner({
        subtitle: 'Your projects and bid invitations at a glance',
        metrics: [
          { value: activeProjects.length, label: 'active' },
          { value: openAuctions.length,   label: 'auctions' },
          { value: myWins.length,         label: 'wins' },
          { value: '₹' + Number(totalRevenue).toLocaleString(), label: 'awarded' },
        ],
      }) : `<div class="page-header"><div><h1 class="page-title">Welcome${_user?.name ? ', ' + escapeInbox(_user.name.split(' ')[0]) : ''}</h1></div></div>`}

      <div class="grid-4" style="margin-bottom:16px">
        ${miniStatCard('Active Projects', activeProjects.length, '#A970FF', 'fa-layer-group')}
        ${miniStatCard('Open Auctions',   openAuctions.length,   '#C9A7FF', 'fa-gavel')}
        ${miniStatCard('Wins',            myWins.length,         '#58C68A', 'fa-trophy')}
        ${miniStatCard('Awarded Value',   '₹' + Number(totalRevenue).toLocaleString(), '#C56FE6', 'fa-rupee-sign')}
      </div>

      <div style="display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:16px;align-items:start">
        <div class="card">
          <div class="card-header">
            <h3>My Projects</h3>
            <span style="font-size:12px;color:var(--text-muted)">${myProjects.length} total</span>
          </div>
          <div class="card-body" style="padding:0">
            ${myProjects.length === 0
              ? `<div class="empty-state" style="padding:24px"><i class="fas fa-folder-open"></i><p>No projects assigned yet — win a bid to see them here.</p></div>`
              : `<table class="data-table">
                  <thead><tr><th>Project</th><th>Status</th><th>Start</th><th>Due</th><th></th></tr></thead>
                  <tbody>
                    ${myProjects.map((p) => `
                      <tr>
                        <td>
                          <div style="font-weight:600;color:#FFFFFF">${escapeInbox(p.name || '')}</div>
                          <div style="font-size:11px;color:#9F8678;font-family:monospace">${escapeInbox(p.code || '')}</div>
                        </td>
                        <td>${typeof statusBadge === 'function' ? statusBadge(p.status) : `<span class="badge">${escapeInbox(p.status || '')}</span>`}</td>
                        <td style="font-size:12px;color:#9F8678">${p.start_date ? fmtDate(p.start_date) : '—'}</td>
                        <td style="font-size:12px;color:${new Date(p.expected_end_date) < new Date() && p.status === 'active' ? '#FF5E3A' : '#9F8678'}">${p.expected_end_date ? fmtDate(p.expected_end_date) : '—'}</td>
                        <td><button class="btn btn-xs btn-outline" onclick="openProjectDetailModal('${p.id}')" title="View details"><i class="fas fa-eye"></i></button></td>
                      </tr>`).join('')}
                  </tbody>
                </table>`}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3>Open Auctions</h3>
            <span style="font-size:12px;color:var(--text-muted)">${openAuctions.length} live</span>
          </div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:10px">
            ${openAuctions.length === 0
              ? `<div class="empty-state"><i class="fas fa-gavel"></i><p>No open auctions for you right now.</p></div>`
              : openAuctions.slice(0, 6).map((a) => {
                  const myBid = a.my_submission || (a.submissions || []).find((s) => s.user_id === myId) || null
                  const dl = a.bid_deadline ? new Date(a.bid_deadline).getTime() : null
                  return `
                    <div style="padding:12px;border-radius:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06)">
                      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                        <div style="min-width:0">
                          <div style="font-size:13.5px;font-weight:700;color:#FFFFFF;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeInbox(a.name || '')}</div>
                          <div style="font-size:11px;color:#9F8678">Max ₹${Number(a.max_bid_amount || 0).toLocaleString()}</div>
                        </div>
                        <span class="badge badge-blue" style="font-size:10px">Open</span>
                      </div>
                      <div style="margin-top:8px;font-size:13px;font-weight:700;color:#C9A7FF;font-variant-numeric:tabular-nums" data-bid-countdown="${a.id}" data-deadline="${dl || ''}">${_formatCountdown(dl ? dl - Date.now() : null)}</div>
                      ${myBid ? `<div style="font-size:11px;color:#86E0A8;margin-top:4px"><i class="fas fa-check-circle"></i> Your bid: ₹${Number(myBid.amount).toLocaleString()}</div>` : ''}
                      <div style="margin-top:8px;display:flex;gap:6px">
                        <button class="btn btn-primary btn-xs" onclick="openPlaceBidModal('${a.id}')" style="flex:1"><i class="fas fa-gavel"></i> ${myBid ? 'Update' : 'Place'} bid</button>
                        <button class="btn btn-outline btn-xs" onclick="openAuctionDetailModal('${a.id}')"><i class="fas fa-eye"></i></button>
                      </div>
                    </div>`
                }).join('')}
            ${openAuctions.length > 0 ? `<button class="btn btn-outline btn-sm" onclick="Router.navigate('bidding-view')" style="margin-top:6px">See all auctions <i class="fas fa-arrow-right"></i></button>` : ''}
          </div>
        </div>
      </div>

      ${myWins.length > 0 ? `
        <div class="card" style="margin-top:16px">
          <div class="card-header"><h3>My Wins</h3><span style="font-size:12px;color:var(--text-muted)">${myWins.length} awarded</span></div>
          <div class="card-body" style="padding:0">
            <table class="data-table">
              <thead><tr><th>Auction</th><th>Amount</th><th>Awarded</th><th>Project</th></tr></thead>
              <tbody>
                ${myWins.map((a) => `
                  <tr>
                    <td>
                      <div style="font-weight:600;color:#FFFFFF">${escapeInbox(a.name || '')}</div>
                      <div style="font-size:11px;color:#9F8678;font-family:monospace">${escapeInbox(a.code || '')}</div>
                    </td>
                    <td style="font-weight:700;color:#FFFFFF">₹${Number(a.awarded_amount || 0).toLocaleString()}</td>
                    <td style="font-size:12px;color:#9F8678">${a.awarded_at ? fmtDate(a.awarded_at) : '—'}</td>
                    <td style="font-size:12px;color:#9F8678">${a.resulting_project_id ? '<i class="fas fa-folder-open" style="color:#86E0A8"></i> Created' : '—'}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>` : ''}
    `

    // Re-tick countdowns inside the dashboard cards (shared timer is OK).
    if (_biddingTimer) clearInterval(_biddingTimer)
    _biddingTimer = setInterval(updateBiddingCountdowns, 1000)
    // Stash for the place-bid modal which reads from _biddingState.auctions.
    _biddingState.auctions = auctions
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${e.message}</p></div>`
  }
}

// ── BROADCAST ────────────────────────────────────────────────
// Two-step flow: Create a broadcast (saved as draft) → review in the list →
// Send it. Drafts can be edited or deleted; sent broadcasts are immutable
// but still deletable (history cleanup). The "Send to" target list includes
// every staff role from the catalogue plus a dedicated "Clients" option
// that fans out via the client-portal notification collection.
async function renderBroadcastsView(el) {
  el.innerHTML = `<div style="padding:24px;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Loading broadcasts…</div>`
  try {
    const data = await API.get('/broadcasts')
    const rows = data.broadcasts || data.data || []
    const canCreate = hasPermission('broadcasts.create')
    const canEdit   = hasPermission('broadcasts.edit')
    const canDelete = hasPermission('broadcasts.delete')
    const canSend   = hasPermission('broadcasts.send')
    const sentRows  = rows.filter(b => b.status === 'sent')
    const draftRows = rows.filter(b => b.status !== 'sent')
    const totalRecipients = sentRows.reduce((s, b) => s + (Number(b.recipient_count) || 0), 0)
    const lastSent = sentRows[0]?.sent_at || sentRows[0]?.created_at || ''

    el.innerHTML = `
    <div class="page-header">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:36px;height:36px;border-radius:8px;background:linear-gradient(135deg,#A970FF,#C56FE6);display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <i class="fas fa-bullhorn" style="color:#fff;font-size:15px"></i>
        </div>
        <div>
          <h1 class="page-title">Broadcast</h1>
          <p class="page-subtitle">${draftRows.length} draft${draftRows.length === 1 ? '' : 's'} · ${sentRows.length} sent · ${fmtNum(totalRecipients)} notification${totalRecipients === 1 ? '' : 's'} delivered</p>
        </div>
      </div>
      <div class="page-actions">
        ${canCreate ? `<button class="btn btn-primary" onclick="showBroadcastModal()"><i class="fas fa-plus"></i> New Broadcast</button>` : ''}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:18px">
      ${_broadcastStatCard('fa-file-pen',         '#C9A7FF', 'Drafts',                draftRows.length)}
      ${_broadcastStatCard('fa-paper-plane',      '#58C68A', 'Sent broadcasts',       sentRows.length)}
      ${_broadcastStatCard('fa-users',            '#A970FF', 'Notifications delivered', fmtNum(totalRecipients))}
      ${_broadcastStatCard('fa-clock-rotate-left','#FF9F40', 'Last sent',             lastSent ? (typeof timeAgo === 'function' ? timeAgo(lastSent) : fmtDate(lastSent)) : '—')}
    </div>

    ${rows.length ? `
    <div style="overflow-x:auto;background:var(--surface,rgba(255,255,255,.03));border:1px solid var(--border,rgba(255,255,255,.08));border-radius:12px">
      <table style="width:100%;border-collapse:collapse;min-width:860px">
        <thead>
          <tr style="background:rgba(169,112,255,.08);border-bottom:1px solid rgba(169,112,255,.18);text-align:left">
            <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#C9A7FF;text-transform:uppercase;letter-spacing:.5px">Broadcast</th>
            <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#C9A7FF;text-transform:uppercase;letter-spacing:.5px">Status</th>
            <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#C9A7FF;text-transform:uppercase;letter-spacing:.5px">Targets</th>
            <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#C9A7FF;text-transform:uppercase;letter-spacing:.5px;text-align:right">Recipients</th>
            <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#C9A7FF;text-transform:uppercase;letter-spacing:.5px">Sender</th>
            <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#C9A7FF;text-transform:uppercase;letter-spacing:.5px">When</th>
            <th style="padding:10px 12px;font-size:11px;font-weight:700;color:#C9A7FF;text-transform:uppercase;letter-spacing:.5px;text-align:right">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(b => {
            const isSent = b.status === 'sent'
            const ts = b.sent_at || b.created_at
            const statusChip = isSent
              ? '<span class="badge" style="background:rgba(88,198,138,.15);color:#58C68A;font-size:10px;padding:2px 8px;border-radius:999px;font-weight:700">SENT</span>'
              : '<span class="badge" style="background:rgba(201,167,255,.15);color:#C9A7FF;font-size:10px;padding:2px 8px;border-radius:999px;font-weight:700">DRAFT</span>'
            return `
            <tr style="border-bottom:1px solid rgba(255,255,255,.04)">
              <td style="padding:12px;vertical-align:top">
                <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:3px">${escapeHtml(b.title || '')}</div>
                <div style="font-size:12px;color:var(--text-muted);line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escapeHtml(b.body || '')}</div>
              </td>
              <td style="padding:12px;vertical-align:top">${statusChip}</td>
              <td style="padding:12px;vertical-align:top">
                <div style="display:flex;gap:4px;flex-wrap:wrap;max-width:220px">
                  ${(Array.isArray(b.target_roles) ? b.target_roles : []).map(r => `<span class="badge" style="background:rgba(169,112,255,.14);color:#C9A7FF;font-size:10px;padding:2px 8px;border-radius:999px">${escapeHtml(r === 'all' ? 'Everyone' : r === 'client' ? 'Clients' : r.replace(/_/g, ' '))}</span>`).join('')}
                </div>
              </td>
              <td style="padding:12px;text-align:right;font-size:13px;font-weight:700;color:${isSent ? '#58C68A' : '#7E7E8F'};vertical-align:top">${isSent ? fmtNum(b.recipient_count || 0) : '—'}</td>
              <td style="padding:12px;font-size:12px;color:var(--text-primary);vertical-align:top">${escapeHtml(b.sender_name || '—')}<div style="font-size:10px;color:var(--text-muted);text-transform:capitalize">${escapeHtml((b.sender_role || '').replace(/_/g, ' '))}</div></td>
              <td style="padding:12px;font-size:12px;color:var(--text-muted);vertical-align:top">${ts ? (typeof timeAgo === 'function' ? timeAgo(ts) : fmtDate(ts)) : '—'}</td>
              <td style="padding:12px;text-align:right;vertical-align:top;white-space:nowrap">
                ${!isSent && canSend   ? `<button class="btn btn-xs btn-primary" onclick="dispatchBroadcast('${escapeHtml(b.id)}')" title="Send this draft now"><i class="fas fa-paper-plane"></i> Send</button>` : ''}
                ${!isSent && canEdit   ? `<button class="btn btn-xs btn-outline" onclick="editBroadcast('${escapeHtml(b.id)}')" title="Edit draft"><i class="fas fa-pen"></i></button>` : ''}
                ${canDelete            ? `<button class="btn btn-xs btn-danger"  onclick="deleteBroadcast('${escapeHtml(b.id)}','${escapeHtml((b.title || '').replace(/'/g,"\\'"))}')" title="Delete broadcast"><i class="fas fa-trash"></i></button>` : ''}
              </td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>` : `
    <div class="empty-state">
      <i class="fas fa-bullhorn"></i>
      <p>No broadcasts yet</p>
      ${canCreate ? '<small>Click <strong>New Broadcast</strong> above to draft an announcement.</small>' : '<small>You need <code>broadcasts.create</code> to compose announcements.</small>'}
    </div>`}
    `
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${escapeHtml(e.message || 'Failed to load broadcasts')}</p></div>`
  }
}

function _broadcastStatCard(icon, color, label, value) {
  return `
  <div style="background:var(--surface,rgba(255,255,255,.03));border:1px solid var(--border,rgba(255,255,255,.08));border-radius:12px;padding:14px;display:flex;align-items:center;gap:12px">
    <div style="width:38px;height:38px;border-radius:10px;background:${color}22;border:1px solid ${color}44;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="fas ${icon}" style="color:${color};font-size:14px"></i></div>
    <div style="min-width:0">
      <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">${escapeHtml(label)}</div>
      <div style="font-size:17px;font-weight:700;color:var(--text-primary);margin-top:2px">${value}</div>
    </div>
  </div>`
}

// Role list pulled from the same catalogue the roles modal uses so a fresh
// custom role admin just created shows up automatically. We hide `client`
// (those are external contacts, not staff) and de-dup just in case.
async function _broadcastTargetRoles() {
  try {
    if (!Array.isArray(_rolesState?.roles) || !_rolesState.roles.length) {
      const res = await API.get('/settings/roles')
      _rolesState.roles = res.roles || res.data || []
      _rolesState.catalogue = res.catalogue || _rolesState.catalogue || []
    }
    const seen = new Set()
    return (_rolesState.roles || [])
      .filter(r => r.key && r.key !== 'client')
      .filter(r => { if (seen.has(r.key)) return false; seen.add(r.key); return true })
  } catch { return [] }
}

// Modal works for both Create (no draft) and Edit (existing draft id).
// When `draft` is passed the title/body are prefilled, target chips reflect
// the saved selection, and Save calls PATCH instead of POST.
async function showBroadcastModal(draft) {
  const isEdit = !!(draft && draft.id)
  const roles = await _broadcastTargetRoles()
  const savedTargets = new Set(Array.isArray(draft?.target_roles) ? draft.target_roles : [])
  const wantsAll = savedTargets.has('all')
  const wantsClients = savedTargets.has('client') || wantsAll
  const roleChips = roles.map(r => {
    const checked = wantsAll || savedTargets.has(r.key)
    const disabled = wantsAll ? 'disabled' : ''
    return `
    <label class="perm-pill" title="${escapeHtml(r.key)}" style="${wantsAll ? 'opacity:.5' : ''}">
      <input type="checkbox" data-bcast-role="${escapeHtml(r.key)}" ${checked ? 'checked' : ''} ${disabled}/>
      <span class="perm-pill-body"><i class="fas fa-check"></i> ${escapeHtml(r.name || r.key)}</span>
    </label>`
  }).join('')
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-bullhorn" style="color:#A970FF;margin-right:6px"></i> ${isEdit ? 'Edit Draft' : 'New Broadcast'}</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="display:flex;flex-direction:column;gap:14px">
      <div class="form-group">
        <label class="form-label">Title *</label>
        <input id="bcast-title" class="form-input" maxlength="160" value="${escapeHtml(draft?.title || '')}" placeholder="e.g., Office closed on Friday for Diwali"/>
      </div>
      <div class="form-group">
        <label class="form-label">Message *</label>
        <textarea id="bcast-body" class="form-textarea" maxlength="2000" placeholder="What do you want every recipient to read in their notification?" style="min-height:110px">${escapeHtml(draft?.body || '')}</textarea>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Up to 2000 characters · this is just a draft — nothing is sent until you hit <strong>Send</strong> from the list.</div>
      </div>
      <div class="form-group">
        <label class="form-label">Send to *</label>
        <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;align-items:center">
          <label class="perm-pill"><input type="checkbox" id="bcast-target-all" ${wantsAll ? 'checked' : ''} onchange="toggleBroadcastAll(this.checked)"/><span class="perm-pill-body"><i class="fas fa-check"></i> Everyone (staff + clients)</span></label>
          <label class="perm-pill" style="${wantsAll ? 'opacity:.5' : ''}"><input type="checkbox" id="bcast-target-client" ${wantsClients && !wantsAll ? 'checked' : ''} ${wantsAll ? 'disabled' : ''}/><span class="perm-pill-body"><i class="fas fa-check"></i> Clients</span></label>
          <button type="button" class="btn btn-xs btn-outline" onclick="toggleBroadcastRoles(true)">Select all staff roles</button>
          <button type="button" class="btn btn-xs btn-outline" onclick="toggleBroadcastRoles(false)">Clear</button>
        </div>
        <div id="bcast-roles" class="perm-pill-group" style="display:flex;flex-wrap:wrap;gap:5px">${roleChips || '<div class="empty-inline"><i class="fas fa-circle-info"></i><span>No staff roles available</span></div>'}</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveBroadcastDraft(${isEdit ? `'${escapeHtml(draft.id)}'` : 'null'})">
        <i class="fas fa-save"></i> ${isEdit ? 'Save Changes' : 'Save Draft'}
      </button>
    </div>
  `, 'modal-lg')
}

// "Everyone" toggle — ticks the `all` sentinel and disables every other
// target pill (clients + per-role) so the user can't second-guess what's
// being sent. Toggling off restores them.
function toggleBroadcastAll(on) {
  const clientCb = document.getElementById('bcast-target-client')
  if (clientCb) {
    clientCb.checked = false
    clientCb.disabled = !!on
    clientCb.parentElement?.style.setProperty('opacity', on ? '.5' : '1')
  }
  document.querySelectorAll('#bcast-roles input[data-bcast-role]').forEach(cb => {
    cb.checked = false
    cb.disabled = !!on
    cb.parentElement?.style.setProperty('opacity', on ? '.5' : '1')
  })
}
function toggleBroadcastRoles(on) {
  const all = document.getElementById('bcast-target-all')
  if (all) { all.checked = false }
  const clientCb = document.getElementById('bcast-target-client')
  if (clientCb) clientCb.disabled = false
  document.querySelectorAll('#bcast-roles input[data-bcast-role]').forEach(cb => {
    cb.disabled = false
    cb.checked = !!on
    cb.parentElement?.style.setProperty('opacity', '1')
  })
}

// Collect the target list the modal currently represents — handles the
// "Everyone" / "Clients" sentinels + per-role pills consistently for both
// the create + edit flows.
function _collectBroadcastTargets() {
  if (document.getElementById('bcast-target-all')?.checked) return ['all']
  const targets = []
  if (document.getElementById('bcast-target-client')?.checked) targets.push('client')
  document.querySelectorAll('#bcast-roles input[data-bcast-role]:checked').forEach(cb => {
    targets.push(cb.dataset.bcastRole)
  })
  return targets
}

// Persist the draft. Brand-new → POST /broadcasts, edit → PATCH /broadcasts/:id.
// Neither dispatches notifications — that's deliberately a separate click
// (dispatchBroadcast) so the user can review before pushing.
async function saveBroadcastDraft(existingId) {
  const title = document.getElementById('bcast-title')?.value.trim() || ''
  const body  = document.getElementById('bcast-body')?.value.trim() || ''
  if (title.length < 2)  return toast('Title is required (at least 2 characters)', 'error')
  if (body.length < 1)   return toast('Message is required', 'error')
  const target_roles = _collectBroadcastTargets()
  if (!target_roles.length) return toast('Pick at least one target (role, Clients, or Everyone)', 'error')
  try {
    if (existingId) {
      await API.patch(`/broadcasts/${existingId}`, { title, body, target_roles })
      toast('Draft saved', 'success')
    } else {
      await API.post('/broadcasts', { title, body, target_roles })
      toast('Draft created. Click Send when ready.', 'success')
    }
    closeModal()
    const el = document.getElementById('page-broadcasts-view')
    if (el) { el.dataset.loaded = ''; loadPage('broadcasts-view', el) }
  } catch (e) {
    toast('Failed to save: ' + (e.message || 'unknown error'), 'error')
  }
}

// Open the edit modal pre-filled with the draft's current state.
async function editBroadcast(id) {
  try {
    const data = await API.get('/broadcasts')
    const draft = (data.broadcasts || data.data || []).find(b => String(b.id) === String(id))
    if (!draft) { toast('Broadcast not found', 'error'); return }
    if (draft.status === 'sent') { toast('Sent broadcasts cannot be edited', 'error'); return }
    showBroadcastModal(draft)
  } catch (e) {
    toast('Failed to load draft: ' + (e.message || 'unknown error'), 'error')
  }
}

// Dispatch a saved draft. Server flips status='sent' and fans out
// notifications to staff + clients in one shot. We re-render so the row
// flips from DRAFT → SENT and the stat cards update.
async function dispatchBroadcast(id) {
  if (!window.confirm('Send this broadcast now? Recipients will be notified immediately.')) return
  try {
    const res = await API.post(`/broadcasts/${id}/send`, {})
    const count = res?.broadcast?.recipient_count ?? res?.data?.recipient_count ?? 0
    toast(`Broadcast sent to ${count} recipient${count === 1 ? '' : 's'}`, 'success')
    const el = document.getElementById('page-broadcasts-view')
    if (el) { el.dataset.loaded = ''; loadPage('broadcasts-view', el) }
  } catch (e) {
    toast('Failed to send: ' + (e.message || 'unknown error'), 'error')
  }
}

async function deleteBroadcast(id, title) {
  if (!window.confirm(`Delete broadcast "${title || ''}"? This cannot be undone.`)) return
  try {
    await API.delete(`/broadcasts/${id}`)
    toast('Broadcast deleted', 'success')
    const el = document.getElementById('page-broadcasts-view')
    if (el) { el.dataset.loaded = ''; loadPage('broadcasts-view', el) }
  } catch (e) {
    toast('Failed to delete: ' + (e.message || 'unknown error'), 'error')
  }
}

window.showBroadcastModal = showBroadcastModal
window.toggleBroadcastAll = toggleBroadcastAll
window.toggleBroadcastRoles = toggleBroadcastRoles
window.saveBroadcastDraft = saveBroadcastDraft
window.dispatchBroadcast = dispatchBroadcast
window.editBroadcast = editBroadcast
window.deleteBroadcast = deleteBroadcast
