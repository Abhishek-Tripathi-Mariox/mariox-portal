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
window.hrReloadPage = hrReloadPage
window.hrTodayISO = hrTodayISO
window.hrCurrentMonthISO = hrCurrentMonthISO
window.hrFmtMoney = hrFmtMoney
window.hrFilterButtons = hrFilterButtons
window.hrEmptyRow = hrEmptyRow
