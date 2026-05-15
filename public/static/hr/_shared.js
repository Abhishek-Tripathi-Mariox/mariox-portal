// Shared helpers for the HR module pages. Loaded BEFORE each per-component
// hr-*.js file so they can use these functions and the HR_PERMS catalogue
// without re-declaring them.
//
// Permission gating: every HR page reads from window.HR_PERMS, which maps
// a logical module name → permission key. Frontend visibility flows through
// NAV_PERMISSION_MAP (app.js), and inside each render function we use
// `hrCanManage(module)` to decide whether to show admin-only controls
// (Create / Edit / Delete buttons, target-user pickers, etc.).
//
// hrCanManage('attendance') === true only when:
//   • role === 'admin', OR
//   • _user.permissions includes 'hr.attendance.manage'
// This matches the backend's userHasAnyPermission semantics in auth.ts so
// the UI never offers actions the server would reject.

window.HR_PERMS = {
  attendance:    'hr.attendance.manage',
  calendar:      'hr.calendar.manage',
  warnings:      'hr.warnings.manage',
  pips:          'hr.pips.manage',
  salary_slips:  'hr.salary_slips.manage',
  terminations:  'hr.terminations.manage',
}

function hrCanManage(module) {
  const role = String(_user?.role || '').toLowerCase()
  if (role === 'admin') return true
  const key = window.HR_PERMS[module]
  if (!key) return false
  const perms = Array.isArray(_user?.permissions) ? _user.permissions : []
  return perms.includes(key)
}

function hrLoadingHTML() {
  return `<div style="padding:40px;text-align:center;color:#9F8678"><i class="fas fa-spinner fa-spin" style="font-size:24px"></i></div>`
}

function hrErrorHTML(message) {
  return `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${escapeInbox(String(message || 'Failed to load'))}</p></div>`
}

// Pull active employees so admins can pick a target in modals. Returns []
// rather than throwing if the call is denied for the current role — that
// way modules still render for self-view users.
function hrFetchEmployees() {
  return API.get('/users').catch(() => ({ users: [] }))
}

function hrEmployeeOptions(users, selectedId) {
  const eligible = (users || []).filter(u => Number(u.is_active) !== 0)
  return eligible.map(u =>
    `<option value="${u.id}"${selectedId === u.id ? ' selected' : ''}>${escapeInbox(u.full_name || u.email || u.id)}${u.designation ? ' · ' + escapeInbox(u.designation) : ''}</option>`,
  ).join('')
}

// Searchable employee picker. Drops in where a plain <select> was used:
// - The visible <input> filters the list as the user types (matches name,
//   email, designation).
// - A hidden <input id="${id}"> holds the selected user id, so existing
//   form-submit code that reads `document.getElementById(id).value` keeps
//   working without changes.
// - "+ Add Employee" row appears for users who can manage staff
//   (admin / hr / pm). Clicking it opens the regular Add User modal.
//   This replaces the current modal — acceptable trade-off; the user
//   re-opens the HR modal once the new employee is created.
window._hrEmpPickerData = window._hrEmpPickerData || {}
window._hrEmpPickerOpts = window._hrEmpPickerOpts || {}

function hrEmployeePicker(id, users, selectedId, opts) {
  // Drop a stale list from the previous modal cycle — when the modal closed,
  // its DOM was wiped, but our list had been portaled to <body> and survives
  // as an orphan. Fresh modal = fresh list.
  const stale = document.getElementById(id + '-list')
  if (stale && stale.parentNode === document.body) stale.remove()

  const eligible = (users || []).filter(u => Number(u.is_active) !== 0)
  window._hrEmpPickerData[id] = eligible
  window._hrEmpPickerOpts[id] = { allowAdd: !opts || opts.allowAdd !== false }
  const sel = eligible.find(u => String(u.id) === String(selectedId))
  const selDisplay = sel ? (sel.full_name || sel.email || sel.id) + (sel.designation ? ' · ' + sel.designation : '') : ''
  const placeholder = (opts && opts.placeholder) || 'Search employee…'
  const allowAdd = !opts || opts.allowAdd !== false
  const role = String(_user?.role || '').toLowerCase()
  const canAdd = allowAdd && (role === 'admin' || role === 'hr' || role === 'pm')
  const listHtml = _hrEmpPickerListHtml(eligible, selectedId, '', canAdd)
  return `
    <div class="hr-emp-picker" id="${id}-picker" style="position:relative">
      <input type="text" id="${id}-search" class="form-input" placeholder="${escapeInbox(placeholder)}"
             value="${escapeInbox(selDisplay)}" autocomplete="off"
             style="padding-right:34px;cursor:pointer"
             oninput="hrEmpPickerFilter('${id}')"
             onfocus="hrEmpPickerOpen('${id}')"
             onclick="hrEmpPickerOpen('${id}')"
             onkeydown="hrEmpPickerKeydown(event,'${id}')"/>
      <i class="fas fa-chevron-down" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);color:#94a3b8;font-size:11px;pointer-events:none"></i>
      <input type="hidden" id="${id}" value="${selectedId || ''}"/>
      <div class="hr-emp-picker-list" id="${id}-list"
           style="display:none;position:absolute;top:100%;left:0;right:0;z-index:1100;max-height:260px;overflow-y:auto;background:#1f2937;border:1px solid #374151;border-radius:8px;margin-top:4px;box-shadow:0 6px 24px rgba(0,0,0,.35)">
        ${listHtml}
      </div>
    </div>
  `
}

function _hrEmpPickerListHtml(users, selectedId, query, canAdd) {
  const q = String(query || '').toLowerCase().trim()
  const filtered = q
    ? users.filter(u => {
        const hay = `${u.full_name || ''} ${u.email || ''} ${u.designation || ''}`.toLowerCase()
        return hay.includes(q)
      })
    : users
  const addRow = canAdd
    ? `<div class="hr-emp-picker-add" onclick="hrEmpPickerAddNew()" style="padding:10px 12px;cursor:pointer;border-bottom:1px solid #374151;color:#FF7A45;font-weight:600;font-size:13px;display:flex;align-items:center;gap:8px"><i class="fas fa-user-plus"></i> Add Employee</div>`
    : ''
  if (!filtered.length) {
    return addRow + `<div style="padding:14px;color:#94a3b8;font-size:13px;text-align:center">No employees match.</div>`
  }
  const rows = filtered.map(u => {
    const isSel = String(u.id) === String(selectedId || '')
    const label = escapeInbox(u.full_name || u.email || u.id)
    const sub = u.designation ? ` · ${escapeInbox(u.designation)}` : ''
    return `<div class="hr-emp-picker-item" data-id="${u.id}" onclick="hrEmpPickerSelect('${u.id}')"
            style="padding:9px 12px;cursor:pointer;font-size:13px;color:#e2e8f0;${isSel ? 'background:#2563eb' : ''}"
            onmouseover="this.style.background='#374151'"
            onmouseout="this.style.background='${isSel ? '#2563eb' : 'transparent'}'">${label}<span style="color:#94a3b8">${sub}</span></div>`
  }).join('')
  return addRow + rows
}

function hrEmpPickerOpen(id) {
  const list = document.getElementById(id + '-list')
  const input = document.getElementById(id + '-search')
  if (!list || !input) return
  // Portal the list to <body> so it escapes every ancestor stacking context,
  // containing block, and overflow clipping rule the modal sets up. The
  // modal-overlay uses `backdrop-filter` (creates a containing block for
  // fixed-positioned descendants) and `.modal { overflow:hidden }` clips
  // children — keeping the list inside that subtree caused it to render
  // either at the wrong position or invisibly behind the backdrop.
  if (list.parentNode !== document.body) {
    document.body.appendChild(list)
  }
  const rect = input.getBoundingClientRect()
  list.style.position = 'fixed'
  list.style.top = (rect.bottom + 4) + 'px'
  list.style.left = rect.left + 'px'
  list.style.width = rect.width + 'px'
  list.style.right = 'auto'
  list.style.margin = '0'
  list.style.zIndex = '10000'
  list.style.display = 'block'
  window._hrEmpPickerActive = id
}

function hrEmpPickerClose(id) {
  const list = document.getElementById(id + '-list')
  if (list) list.style.display = 'none'
  if (window._hrEmpPickerActive === id) window._hrEmpPickerActive = null
}

function hrEmpPickerFilter(id) {
  const input = document.getElementById(id + '-search')
  const list = document.getElementById(id + '-list')
  const users = window._hrEmpPickerData[id] || []
  if (!input || !list) return
  const role = String(_user?.role || '').toLowerCase()
  const pickerOpts = window._hrEmpPickerOpts[id] || { allowAdd: true }
  const canAdd = pickerOpts.allowAdd !== false && (role === 'admin' || role === 'hr' || role === 'pm')
  const hidden = document.getElementById(id)
  list.innerHTML = _hrEmpPickerListHtml(users, hidden?.value || '', input.value, canAdd)
  list.style.display = ''
  window._hrEmpPickerActive = id
}

function hrEmpPickerSelect(userId) {
  const id = window._hrEmpPickerActive
  if (!id) return
  const users = window._hrEmpPickerData[id] || []
  const u = users.find(x => String(x.id) === String(userId))
  if (!u) return
  const hidden = document.getElementById(id)
  const search = document.getElementById(id + '-search')
  if (hidden) hidden.value = u.id
  if (search) search.value = (u.full_name || u.email || u.id) + (u.designation ? ' · ' + u.designation : '')
  hrEmpPickerClose(id)
  // Fire the onChange callback if the searchableSelect caller registered one
  // (e.g. dependent dropdowns like Project → Milestone in the invoice modal).
  const pickerOpts = window._hrEmpPickerOpts[id]
  if (pickerOpts && typeof pickerOpts.onChange === 'function') {
    try { pickerOpts.onChange(u.id) } catch (e) { console.warn('searchableSelect onChange failed', e) }
  }
}

function hrEmpPickerKeydown(e, id) {
  if (e.key === 'Escape') { hrEmpPickerClose(id); return }
  if (e.key === 'Enter') {
    e.preventDefault()
    const first = document.querySelector(`#${id}-list .hr-emp-picker-item`)
    if (first) hrEmpPickerSelect(first.getAttribute('data-id'))
  }
}

function hrEmpPickerAddNew() {
  if (typeof openDeveloperModal !== 'function') {
    if (typeof toast === 'function') toast('Add User unavailable', 'error')
    return
  }
  openDeveloperModal()
}

// Generic searchable dropdown. Hand it any `items` array of
// { value, label, sub? } and it renders the same searchable picker shell
// as hrEmployeePicker — text input that filters, dropdown of matches, and
// a hidden input with id=${id} holding the selected value. Drop-in
// replacement for a plain <select> wherever search is wanted.
//
// Reuses the same picker plumbing (hrEmpPicker*) so outside-click,
// keyboard nav and the portal-to-body trick all work without duplication.
window._searchableSelectData = window._searchableSelectData || {}

function searchableSelect(id, items, selectedId, opts) {
  const stale = document.getElementById(id + '-list')
  if (stale && stale.parentNode === document.body) stale.remove()
  const list = (items || []).map(it => ({
    id: String(it.value),
    full_name: String(it.label || it.value),
    designation: it.sub ? String(it.sub) : '',
    is_active: 1,
  }))
  window._hrEmpPickerData[id] = list
  window._hrEmpPickerOpts[id] = { allowAdd: false, onChange: opts && opts.onChange }
  const placeholder = (opts && opts.placeholder) || 'Search…'
  const sel = list.find(u => u.id === String(selectedId || ''))
  const selDisplay = sel ? sel.full_name + (sel.designation ? ' · ' + sel.designation : '') : ''
  const listHtml = _hrEmpPickerListHtml(list, selectedId, '', false)
  return `
    <div class="hr-emp-picker" id="${id}-picker" style="position:relative">
      <input type="text" id="${id}-search" class="form-input" placeholder="${escapeInbox(placeholder)}"
             value="${escapeInbox(selDisplay)}" autocomplete="off"
             style="padding-right:34px;cursor:pointer"
             oninput="hrEmpPickerFilter('${id}')"
             onfocus="hrEmpPickerOpen('${id}')"
             onclick="hrEmpPickerOpen('${id}')"
             onkeydown="hrEmpPickerKeydown(event,'${id}')"/>
      <i class="fas fa-chevron-down" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);color:#94a3b8;font-size:11px;pointer-events:none"></i>
      <input type="hidden" id="${id}" value="${selectedId || ''}"/>
      <div class="hr-emp-picker-list" id="${id}-list"
           style="display:none;position:absolute;top:100%;left:0;right:0;z-index:1100;max-height:260px;overflow-y:auto;background:#1f2937;border:1px solid #374151;border-radius:8px;margin-top:4px;box-shadow:0 6px 24px rgba(0,0,0,.35)">
        ${listHtml}
      </div>
    </div>
  `
}

window.searchableSelect = searchableSelect

// Replace the items in an already-rendered searchableSelect without
// re-rendering the picker shell. Used by dependent dropdowns (e.g. when
// Client changes, refill the Project picker). Clears the current selection.
function searchableSelectSetItems(id, items, opts) {
  const list = document.getElementById(id + '-list')
  const search = document.getElementById(id + '-search')
  const hidden = document.getElementById(id)
  if (!list || !search || !hidden) return
  const mapped = (items || []).map(it => ({
    id: String(it.value),
    full_name: String(it.label || it.value),
    designation: it.sub ? String(it.sub) : '',
    is_active: 1,
  }))
  window._hrEmpPickerData[id] = mapped
  const existing = window._hrEmpPickerOpts[id] || {}
  window._hrEmpPickerOpts[id] = {
    allowAdd: false,
    onChange: (opts && opts.onChange) || existing.onChange,
  }
  if (opts && opts.placeholder !== undefined) search.placeholder = opts.placeholder
  hidden.value = ''
  search.value = ''
  list.innerHTML = _hrEmpPickerListHtml(mapped, '', '', false)
}

function searchableSelectSetEnabled(id, enabled) {
  const search = document.getElementById(id + '-search')
  if (!search) return
  search.disabled = !enabled
  search.style.opacity = enabled ? '1' : '0.6'
  search.style.cursor = enabled ? 'pointer' : 'not-allowed'
}

window.searchableSelectSetItems = searchableSelectSetItems
window.searchableSelectSetEnabled = searchableSelectSetEnabled

// One global click listener auto-closes any open picker when the user clicks
// outside the picker root. Installed once on first use.
if (!window._hrEmpPickerListenerInstalled) {
  document.addEventListener('click', (e) => {
    const active = window._hrEmpPickerActive
    if (!active) return
    const root = document.getElementById(active + '-picker')
    const list = document.getElementById(active + '-list')
    // The list lives in <body> once opened (portal), so we have to check
    // both the picker root AND the list to decide whether the click was
    // "inside". Clicks anywhere else collapse the dropdown.
    if (root && root.contains(e.target)) return
    if (list && list.contains(e.target)) return
    hrEmpPickerClose(active)
  })
  window._hrEmpPickerListenerInstalled = true
}

// Re-render a page after a mutation. Used after every successful POST/PATCH/DELETE
// so the list reflects the change without a full reload.
function hrReloadPage(pageId) {
  const el = document.getElementById(pageId)
  if (el) { el.dataset.loaded = ''; loadPage(pageId.replace(/^page-/, ''), el) }
}

function hrTodayISO() { return new Date().toISOString().slice(0, 10) }
function hrCurrentMonthISO() {
  const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function hrFmtMoney(n) {
  const v = Number(n) || 0
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Render a simple horizontal row of filter buttons. `current` is the active value;
// each option is { value, label, activeStyle } and the click handler is the
// caller-supplied function name (string) so the existing inline onclick pattern
// in app.js keeps working.
function hrFilterButtons(options, current, handlerFnName) {
  return options.map(opt => {
    const active = (opt.value || '') === (current || '')
    const activeStyle = active && opt.activeStyle ? ` style="${opt.activeStyle}"` : ''
    return `<button class="btn btn-sm btn-outline" onclick="${handlerFnName}('${opt.value || ''}')"${activeStyle}>${opt.label}</button>`
  }).join('')
}

// Empty-state row used inside data-table tbody when the list is empty.
function hrEmptyRow(colspan, icon, text) {
  return `<tr><td colspan="${colspan}" style="text-align:center;color:#9F8678;padding:36px"><i class="fas ${icon}" style="font-size:24px;opacity:.5;margin-bottom:8px;display:block"></i>${escapeInbox(text)}</td></tr>`
}

// Expose for the per-module files. They are plain globals (the project doesn't
// use ES modules in the browser) — assigning to window makes intent explicit.
window.hrCanManage = hrCanManage
window.hrLoadingHTML = hrLoadingHTML
window.hrErrorHTML = hrErrorHTML
window.hrFetchEmployees = hrFetchEmployees
window.hrEmployeeOptions = hrEmployeeOptions
window.hrEmployeePicker = hrEmployeePicker
window.hrEmpPickerOpen = hrEmpPickerOpen
window.hrEmpPickerClose = hrEmpPickerClose
window.hrEmpPickerFilter = hrEmpPickerFilter
window.hrEmpPickerSelect = hrEmpPickerSelect
window.hrEmpPickerKeydown = hrEmpPickerKeydown
window.hrEmpPickerAddNew = hrEmpPickerAddNew
window.hrReloadPage = hrReloadPage
window.hrTodayISO = hrTodayISO
window.hrCurrentMonthISO = hrCurrentMonthISO
window.hrFmtMoney = hrFmtMoney
window.hrFilterButtons = hrFilterButtons
window.hrEmptyRow = hrEmptyRow
