// Tasks — standalone tasks that aren't tied to a project.
// Visibility on the server: ONLY the assignee and the creator can see (no
// admin/PM bypass). The page splits visible tasks into tabs so the user can
// switch between "assigned to me" and "I assigned" without re-querying.

let _ptaskStatus = ''
let _ptaskTab = 'assigned_to_me' // assigned_to_me | assigned_by_me | all
let _ptaskUsers = []
// Cached status palette (built-in + custom) returned by GET /personal-tasks.
// Used by inline-edit dropdowns and the "Manage statuses" modal.
window._ptaskStatusPalette = window._ptaskStatusPalette || null
const PTASK_PRIORITIES = ['low', 'medium', 'high']

async function renderPersonalTasksPage(el) {
  el.innerHTML = `<div style="padding:24px;color:#7E7E8F"><i class="fas fa-spinner fa-spin"></i> Loading tasks…</div>`
  try {
    const [tasksRes, usersRes] = await Promise.all([
      API.get('/personal-tasks' + (_ptaskStatus ? '?status=' + _ptaskStatus : '')),
      API.get('/users').catch(() => ({ users: [] })),
    ])
    const allTasks = tasksRes.tasks || tasksRes.data || []
    _ptaskUsers = usersRes.users || usersRes.data || []
    // The API now returns the live status palette. Fall back to the static
    // built-ins if the field's missing (older deployments / cached worker).
    window._ptaskStatusPalette = Array.isArray(tasksRes.statuses) && tasksRes.statuses.length
      ? tasksRes.statuses
      : [
          { value: 'todo', label: 'To Do', builtin: true },
          { value: 'in_progress', label: 'In Progress', builtin: true },
          { value: 'done', label: 'Done', builtin: true },
        ]
    const statusPalette = window._ptaskStatusPalette
    const myId = String(_user?.sub || _user?.id || '')
    const myRole = String(_user?.role || '').toLowerCase()
    // Manage Statuses now gated on the personal_tasks.manage_statuses
    // permission so admins can hand it to sales managers / HR / etc. without
    // promoting the user to PM. Default for admin/PM/PC stays the same.
    const canManageStatuses = myRole === 'admin'
      || ['pm', 'pc'].includes(myRole)
      || (typeof hasAnyPermission === 'function' && hasAnyPermission(['personal_tasks.manage_statuses']))

    // Split into the two tabs. Created-by-me and assigned-to-me can overlap
    // (a task you assigned to yourself shows up in both), and that's fine —
    // each tab is just a different lens on the same underlying list.
    const toMe = allTasks.filter(t => String(t.assigned_to) === myId)
    const byMe = allTasks.filter(t => String(t.created_by) === myId)
    const tabMap = {
      assigned_to_me: { label: 'Assigned to Me',  list: toMe,     icon: 'fa-inbox' },
      assigned_by_me: { label: 'Assigned by Me',  list: byMe,     icon: 'fa-paper-plane' },
      all:            { label: 'All',             list: allTasks, icon: 'fa-list' },
    }
    if (!tabMap[_ptaskTab]) _ptaskTab = 'assigned_to_me'
    const activeTab = tabMap[_ptaskTab]
    const tasks = activeTab.list

    const tabBtn = (key) => {
      const t = tabMap[key]
      const active = key === _ptaskTab
      return `<button class="ptask-tab ${active ? 'active' : ''}" onclick="ptaskSetTab('${key}')">
        <i class="fas ${t.icon}"></i>
        <span>${t.label}</span>
        <span class="ptask-tab-count">${t.list.length}</span>
      </button>`
    }

    el.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title"><i class="fas fa-list-check" style="color:#a855f7;margin-right:8px"></i>My Task</h1>
      <p class="page-subtitle">Independent tasks — visible only to you and the person on the other side of each task.</p></div>
      <div class="page-actions" style="display:flex;gap:8px;flex-wrap:wrap">
        <select class="form-select" style="width:180px" onchange="ptaskFilterStatus(this.value)">
          <option value="" ${_ptaskStatus === '' ? 'selected' : ''}>All Status</option>
          ${statusPalette.map(s => `<option value="${escapeInbox(s.value)}" ${_ptaskStatus === s.value ? 'selected' : ''}>${escapeInbox(s.label)}</option>`).join('')}
        </select>
        ${canManageStatuses ? `<button class="btn btn-outline btn-sm" onclick="openManagePersonalTaskStatuses()" title="Add or remove custom statuses"><i class="fas fa-tags"></i> Manage Statuses</button>` : ''}
        <button class="btn btn-primary btn-sm" onclick="openPersonalTaskModal()"><i class="fas fa-plus"></i> New Task</button>
      </div>
    </div>

    <!-- Tabs -->
    <div class="ptask-tabs">
      ${tabBtn('assigned_to_me')}
      ${tabBtn('assigned_by_me')}
      ${tabBtn('all')}
    </div>

    <div class="card">
      <div class="card-body p-0 table-wrap">
        <table class="data-table">
          <thead><tr><th>Title</th><th>Assigned To</th><th>Assigned By</th><th>Priority</th><th>Status</th><th>Due</th><th style="width:180px">Actions</th></tr></thead>
          <tbody>
            ${tasks.length ? tasks.map(t => _ptaskRow(t, statusPalette, myId)).join('') : `<tr><td colspan="7" style="text-align:center;color:#7E7E8F;padding:36px"><div style="display:flex;flex-direction:column;align-items:center;gap:8px"><i class="fas ${activeTab.icon}" style="font-size:24px;color:#a855f7;opacity:.6"></i><div>${_ptaskTab === 'assigned_to_me' ? 'Nothing assigned to you yet.' : _ptaskTab === 'assigned_by_me' ? 'You have not assigned any tasks yet.' : 'No tasks.'}</div><button class="btn btn-sm btn-primary" onclick="openPersonalTaskModal()"><i class="fas fa-plus"></i> New Task</button></div></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${escapeInbox(e.message)}</p></div>`
  }
}

function ptaskSetTab(tab) {
  _ptaskTab = tab
  const el = document.getElementById('page-personal-tasks')
  if (el) { el.dataset.loaded = ''; loadPage('personal-tasks', el) }
}

// ── Inline-editable row ─────────────────────────────────────
// Each cell that the current user is allowed to change is rendered as a
// real form control (input / select) so the change saves the moment the
// user hits Enter, tabs out, or picks a new value.
function _ptaskRow(t, statusPalette, myId) {
  const isCreator  = String(t.created_by)  === String(myId)
  const isAssignee = String(t.assigned_to) === String(myId)
  // Assignee can move status/priority/due/title; only creator can reassign
  // or delete. Anyone outside both (visibility leaks aside) is read-only.
  const canEdit       = isCreator || isAssignee
  const canReassign   = isCreator
  const canDelete     = isCreator
  const statusOptions = statusPalette
    .map(s => `<option value="${escapeInbox(s.value)}" ${t.status === s.value ? 'selected' : ''}>${escapeInbox(s.label)}</option>`)
    .join('')
  const priorityOptions = PTASK_PRIORITIES
    .map(p => `<option value="${p}" ${t.priority === p ? 'selected' : ''}>${p.charAt(0).toUpperCase() + p.slice(1)}</option>`)
    .join('')
  // Searchable inline assignee picker — replaces the native <select> with a
  // button + portaled search panel so long employee lists (50+) are usable.
  const _currentAssignee = _ptaskUsers.find(u => String(u.id) === String(t.assigned_to))
  const _assigneeLabel = _currentAssignee
    ? escapeInbox(_currentAssignee.full_name || _currentAssignee.email || _currentAssignee.id)
    : '— Unassigned —'
  const assigneeBtnHtml = `<button type="button" class="ptask-inline-select ptask-assignee-btn" data-no-lock onclick="openPtaskAssigneePicker('${escapeInbox(t.id)}', this)" style="display:flex;align-items:center;gap:6px;justify-content:space-between;text-align:left">
    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_assigneeLabel}</span>
    <i class="fas fa-chevron-down" style="font-size:9px;opacity:.6;flex-shrink:0"></i>
  </button>`

  const overdue = t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done'
  const dueColor = overdue ? '#FF5E3A' : '#7E7E8F'

  return `
    <tr data-ptask-id="${escapeInbox(t.id)}">
      <td>
        ${canEdit
          ? `<input class="ptask-inline-input" data-ptask-id="${escapeInbox(t.id)}" data-field="title" value="${escapeInbox(t.title || '')}" placeholder="Untitled"
              onchange="ptaskInlineSave('${escapeInbox(t.id)}','title',this.value)"
              onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur()}"
              style="font-weight:600;color:#e2e8f0;background:transparent;border:1px solid transparent;border-radius:6px;padding:4px 8px;width:100%;font-size:13px;transition:background .15s,border-color .15s"
              onmouseover="this.style.borderColor='rgba(168,85,247,.25)'" onmouseout="this.style.borderColor='transparent'"
              onfocus="this.style.background='rgba(168,85,247,.08)';this.style.borderColor='rgba(168,85,247,.45)'"
              onblur="this.style.background='transparent';this.style.borderColor='transparent'"/>`
          : `<div style="font-weight:600;color:#e2e8f0;padding:4px 8px">${escapeInbox(t.title)}</div>`}
        ${canEdit
          ? `<input class="ptask-inline-input" data-ptask-id="${escapeInbox(t.id)}" data-field="description" value="${escapeInbox(t.description || '')}" placeholder="Add a description…"
              onchange="ptaskInlineSave('${escapeInbox(t.id)}','description',this.value)"
              onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur()}"
              style="font-size:11px;color:#7E7E8F;background:transparent;border:1px solid transparent;border-radius:6px;padding:3px 8px;width:100%;margin-top:2px;transition:background .15s,border-color .15s"
              onmouseover="this.style.borderColor='rgba(168,85,247,.18)'" onmouseout="this.style.borderColor='transparent'"
              onfocus="this.style.background='rgba(168,85,247,.06)';this.style.borderColor='rgba(168,85,247,.35)'"
              onblur="this.style.background='transparent';this.style.borderColor='transparent'"/>`
          : (t.description ? `<div style="font-size:11px;color:#7E7E8F;margin-top:2px;padding:0 8px">${escapeInbox(t.description)}</div>` : '')}
      </td>
      <td>
        ${canReassign
          ? assigneeBtnHtml
          : (t.assigned_to_name ? `<div style="display:flex;align-items:center;gap:6px">${avatar(t.assigned_to_name, t.assigned_to_color || t.assigned_to_avatar, 'sm')}<span style="font-size:12px">${escapeInbox(t.assigned_to_name)}</span></div>` : '—')}
      </td>
      <td>${t.created_by_name ? `<div style="display:flex;align-items:center;gap:6px">${avatar(t.created_by_name, t.created_by_color || '#7E7E8F', 'sm')}<span style="font-size:12px">${escapeInbox(t.created_by_name)}</span></div>` : '—'}</td>
      <td>
        ${canEdit
          ? `<select class="ptask-inline-select" onchange="ptaskInlineSave('${escapeInbox(t.id)}','priority',this.value)">${priorityOptions}</select>`
          : _ptaskPriorityBadge(t.priority)}
      </td>
      <td>
        ${canEdit
          ? `<select class="ptask-inline-select" onchange="ptaskInlineSave('${escapeInbox(t.id)}','status',this.value)">${statusOptions}</select>`
          : _ptaskStatusBadge(t.status)}
      </td>
      <td>
        ${canEdit
          ? `<input type="date" class="ptask-inline-input" value="${t.due_date ? String(t.due_date).slice(0,10) : ''}"
              onchange="ptaskInlineSave('${escapeInbox(t.id)}','due_date',this.value)"
              style="background:transparent;border:1px solid transparent;border-radius:6px;padding:3px 6px;color:${dueColor};font-size:12px"
              onmouseover="this.style.borderColor='rgba(168,85,247,.25)'" onmouseout="this.style.borderColor='transparent'"
              onfocus="this.style.background='rgba(168,85,247,.08)';this.style.borderColor='rgba(168,85,247,.45)'"
              onblur="this.style.background='transparent';this.style.borderColor='transparent'"/>`
          : `<span style="font-size:12px;color:${dueColor}">${t.due_date ? fmtDate(t.due_date) : '—'}</span>`}
      </td>
      <td>
        <div style="display:flex;gap:4px">
          ${canEdit && t.status !== 'done' ? `<button class="btn btn-xs btn-primary" title="Mark done" onclick="ptaskSetStatus('${escapeInbox(t.id)}','done')"><i class="fas fa-check"></i></button>` : ''}
          <button class="btn btn-xs btn-outline" title="History" onclick="showPersonalTaskHistory('${escapeInbox(t.id)}')"><i class="fas fa-history"></i></button>
          ${canDelete ? `<button class="btn btn-xs btn-outline" title="Delete" onclick="deletePersonalTask('${escapeInbox(t.id)}')" style="color:#FF5E3A"><i class="fas fa-trash"></i></button>` : ''}
        </div>
      </td>
    </tr>`
}

// PATCH a single field. The list re-fetches only on status/assignee changes
// (where the row could move tabs or recolor); other fields update silently
// so the input keeps focus.
async function ptaskInlineSave(id, field, value) {
  const body = {}
  // due_date may come in as '' from a cleared input — normalise to null.
  body[field] = field === 'due_date' && !value ? null : value
  try {
    await API.patch('/personal-tasks/' + id, body)
    if (field === 'status' || field === 'assigned_to') {
      toast(field === 'status' ? 'Status updated' : 'Reassigned', 'success', 1200)
      const el = document.getElementById('page-personal-tasks')
      if (el) { el.dataset.loaded = ''; loadPage('personal-tasks', el) }
    } else {
      toast('Saved', 'success', 900)
    }
  } catch (e) { toast(e.message || 'Save failed', 'error') }
}

// ── Manage status palette ───────────────────────────────────
async function openManagePersonalTaskStatuses() {
  let palette = window._ptaskStatusPalette || []
  try {
    const r = await API.get('/personal-tasks/statuses')
    palette = r.statuses || palette
  } catch {}
  window._ptaskStatusPalette = palette
  const built = palette.filter(p => p.builtin)
  const custom = palette.filter(p => !p.builtin)
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-tags" style="color:#a855f7;margin-right:6px"></i> Manage Statuses</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:18px">
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px">Built-in (cannot be removed)</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${built.map(s => `<span class="badge badge-todo">${escapeInbox(s.label)}</span>`).join('')}
        </div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px">Custom statuses (${custom.length})</div>
        <div id="ptask-status-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">
          ${custom.length ? custom.map(s => `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(168,85,247,.06);border:1px solid rgba(168,85,247,.18);border-radius:8px">
              <span style="width:10px;height:10px;border-radius:50%;background:${escapeInbox(s.color || '#a855f7')}"></span>
              <div style="flex:1;min-width:0">
                <div style="font-size:13px;color:#e2e8f0">${escapeInbox(s.label)}</div>
                <div style="font-size:10px;color:#7E7E8F;font-family:monospace">${escapeInbox(s.value)}</div>
              </div>
              <button class="btn btn-xs btn-outline" style="color:#FF5E3A;border-color:#FF5E3A" onclick="deletePersonalTaskStatus('${escapeInbox(s.id)}','${escapeInbox(s.label)}')"><i class="fas fa-trash"></i></button>
            </div>`).join('') : '<div class="empty-inline"><i class="fas fa-circle-plus"></i><span>No custom statuses yet. Add one below.</span></div>'}
        </div>
        <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
          <div class="form-group" style="flex:1;min-width:180px;margin:0">
            <label class="form-label">Status name</label>
            <input id="ptask-new-status-label" class="form-input" placeholder='e.g. "In Review", "Blocked"' maxlength="40" autocomplete="off"/>
          </div>
          <div class="form-group" style="margin:0">
            <label class="form-label">Color</label>
            <input id="ptask-new-status-color" class="form-input" type="color" value="#a855f7" style="height:38px;width:60px;padding:2px"/>
          </div>
          <button class="btn btn-primary" onclick="addPersonalTaskStatus()"><i class="fas fa-plus"></i> Add</button>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:6px">Removing a status moves any tasks currently on it back to "To Do".</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Close</button>
    </div>
  `, 'modal-lg')
}

async function addPersonalTaskStatus() {
  const label = (document.getElementById('ptask-new-status-label')?.value || '').trim()
  const color = document.getElementById('ptask-new-status-color')?.value || '#a855f7'
  if (!label) { toast('Enter a status name', 'error'); return }
  try {
    await API.post('/personal-tasks/statuses', { label, color })
    toast('Status added', 'success', 1200)
    await openManagePersonalTaskStatuses() // refresh modal
    // Bust the list cache so the new status shows up in row dropdowns.
    const el = document.getElementById('page-personal-tasks')
    if (el) el.dataset.loaded = ''
  } catch (e) { toast(e.message || 'Failed to add', 'error') }
}

async function deletePersonalTaskStatus(id, label) {
  if (!confirm(`Remove "${label}"? Tasks currently on this status will move back to "To Do".`)) return
  try {
    await API.delete('/personal-tasks/statuses/' + id)
    toast('Status removed', 'success', 1200)
    await openManagePersonalTaskStatuses()
    const el = document.getElementById('page-personal-tasks')
    if (el) el.dataset.loaded = ''
  } catch (e) { toast(e.message || 'Failed to remove', 'error') }
}

function _ptaskPriorityBadge(p) {
  const map = { low: 'todo', medium: 'inprogress', high: 'critical' }
  return `<span class="badge badge-${map[p] || 'todo'}">${escapeInbox(String(p || '').toUpperCase())}</span>`
}
function _ptaskStatusBadge(s) {
  const map = { todo: 'todo', in_progress: 'inprogress', done: 'done' }
  const builtinLabels = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' }
  // Custom statuses from the palette: fall back to their label so the badge
  // shows the human name instead of the slug.
  const palette = Array.isArray(window._ptaskStatusPalette) ? window._ptaskStatusPalette : []
  const fromPalette = palette.find(p => p.value === s)
  const label = builtinLabels[s] || fromPalette?.label || s
  return `<span class="badge badge-${map[s] || 'todo'}">${escapeInbox(label)}</span>`
}

function ptaskFilterStatus(v) {
  _ptaskStatus = v || ''
  const el = document.getElementById('page-personal-tasks')
  if (el) { el.dataset.loaded = ''; loadPage('personal-tasks', el) }
}

async function openPersonalTaskModal(id) {
  let task = null
  if (id) {
    try { const r = await API.get('/personal-tasks'); task = (r.tasks || r.data || []).find(t => String(t.id) === String(id)) } catch {}
  }
  if (!_ptaskUsers.length) {
    try { const r = await API.get('/users'); _ptaskUsers = r.users || r.data || [] } catch {}
  }
  const isEdit = !!task
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-list-check" style="color:#a855f7;margin-right:6px"></i>${isEdit ? 'Edit' : 'New'} Personal Task</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div class="form-group"><label class="form-label">Title *</label><input id="ptask-title" class="form-input" value="${escapeInbox(task?.title || '')}" placeholder="e.g. Follow up with Acme"/></div>
      <div class="form-group"><label class="form-label">Description</label><textarea id="ptask-desc" class="form-textarea" rows="3" placeholder="Details…">${escapeInbox(task?.description || '')}</textarea></div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Assignee *</label>${hrEmployeePicker('ptask-assignee', _ptaskUsers, task?.assigned_to || '', { placeholder: 'Search or pick employee…' })}</div>
        <div class="form-group"><label class="form-label">Due date</label><input id="ptask-due" class="form-input" type="date" value="${task?.due_date || ''}"/></div>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Priority</label>
          <select id="ptask-priority" class="form-select">
            ${['low','medium','high'].map(p => `<option value="${p}" ${task?.priority === p ? 'selected' : ''}>${p.charAt(0).toUpperCase()+p.slice(1)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label class="form-label">Status</label>
          <select id="ptask-status" class="form-select">
            ${(window._ptaskStatusPalette || [
              { value: 'todo', label: 'To Do' },
              { value: 'in_progress', label: 'In Progress' },
              { value: 'done', label: 'Done' },
            ]).map(s => `<option value="${escapeInbox(s.value)}" ${task?.status === s.value ? 'selected' : ''}>${escapeInbox(s.label)}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitPersonalTask('${task?.id || ''}')"><i class="fas fa-check"></i> ${isEdit ? 'Save' : 'Create'}</button>
    </div>
  `)
}

async function submitPersonalTask(id) {
  const payload = {
    title: (document.getElementById('ptask-title')?.value || '').trim(),
    description: (document.getElementById('ptask-desc')?.value || '').trim(),
    assigned_to: document.getElementById('ptask-assignee')?.value,
    due_date: document.getElementById('ptask-due')?.value || null,
    priority: document.getElementById('ptask-priority')?.value,
    status: document.getElementById('ptask-status')?.value,
  }
  if (!payload.title) { toast('Title is required', 'error'); return }
  if (!payload.assigned_to) { toast('Assignee is required', 'error'); return }
  try {
    if (id) await API.patch('/personal-tasks/' + id, payload)
    else await API.post('/personal-tasks', payload)
    toast(id ? 'Task updated' : 'Task created', 'success')
    closeModal()
    const el = document.getElementById('page-personal-tasks')
    if (el) { el.dataset.loaded = ''; loadPage('personal-tasks', el) }
  } catch (e) { toast(e.message, 'error') }
}

async function ptaskSetStatus(id, status) {
  try {
    await API.patch('/personal-tasks/' + id, { status })
    toast('Task updated', 'success')
    const el = document.getElementById('page-personal-tasks')
    if (el) { el.dataset.loaded = ''; loadPage('personal-tasks', el) }
  } catch (e) { toast(e.message, 'error') }
}
// Show audit log for a personal task — title/desc/status/assignee changes
// with who did them and when. Falls back gracefully if the list-API call
// hasn't been made yet by hitting it on demand.
async function showPersonalTaskHistory(id) {
  let task = null
  try {
    const r = await API.get('/personal-tasks')
    const list = r.tasks || r.data || []
    task = list.find(t => String(t.id) === String(id))
  } catch (e) {
    toast(e.message || 'Failed to load history', 'error')
    return
  }
  if (!task) { toast('Task not found', 'error'); return }
  const history = Array.isArray(task.history) ? [...task.history].reverse() : []
  const fieldLabel = { title: 'Title', description: 'Description', status: 'Status', priority: 'Priority', due_date: 'Due Date', assigned_to: 'Assignee' }
  const userById = new Map((_ptaskUsers || []).map(u => [String(u.id), u]))
  const fmt = (v) => {
    if (v === null || v === undefined || v === '') return '—'
    return String(v).replace(/_/g, ' ')
  }
  const fmtAssignee = (val) => {
    const u = userById.get(String(val))
    return u ? (u.full_name || u.email) : (val ? `User ${String(val).slice(-6)}` : '—')
  }
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-history" style="color:#a855f7;margin-right:6px"></i> Task History</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px">
      <div style="font-size:14px;font-weight:600;color:#e2e8f0;margin-bottom:4px">${escapeInbox(task.title)}</div>
      <div style="font-size:12px;color:#7E7E8F;margin-bottom:14px">
        Assigned to <strong>${escapeInbox(task.assigned_to_name || '—')}</strong>
        by <strong>${escapeInbox(task.created_by_name || '—')}</strong>
        on ${fmtDate(task.created_at)}.
      </div>
      ${history.length ? `
        <div style="display:flex;flex-direction:column;gap:10px;max-height:360px;overflow-y:auto">
          ${history.map(h => {
            const label = fieldLabel[h.field] || h.field
            const fromVal = h.field === 'assigned_to' ? fmtAssignee(h.from) : fmt(h.from)
            const toVal = h.field === 'assigned_to' ? fmtAssignee(h.to) : fmt(h.to)
            return `
            <div style="background:rgba(168,85,247,.06);border:1px solid rgba(168,85,247,.18);border-radius:8px;padding:10px 12px">
              <div style="font-size:11px;color:#7E7E8F;margin-bottom:4px">
                <i class="fas fa-user-pen" style="color:#a855f7"></i>
                <strong style="color:#e2e8f0">${escapeInbox(h.actor_name || 'Someone')}</strong>
                changed <strong style="color:#e2e8f0">${label}</strong> · ${fmtDate(h.changed_at)} ${new Date(h.changed_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}
              </div>
              <div style="font-size:12.5px;color:#cbd5e1;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <span style="text-decoration:line-through;color:#7E7E8F">${escapeInbox(fromVal)}</span>
                <i class="fas fa-arrow-right" style="font-size:10px;color:#7E7E8F"></i>
                <span style="color:#C9A7FF;font-weight:600">${escapeInbox(toVal)}</span>
              </div>
            </div>`
          }).join('')}
        </div>` : '<div class="empty-inline"><i class="fas fa-clock-rotate-left"></i><span>No edits yet — this task has not been changed since it was created.</span></div>'}
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Close</button>
    </div>
  `, 'modal-lg')
}

async function deletePersonalTask(id) {
  if (!confirm('Delete this task?')) return
  try {
    await API.delete('/personal-tasks/' + id)
    toast('Task deleted', 'success')
    const el = document.getElementById('page-personal-tasks')
    if (el) { el.dataset.loaded = ''; loadPage('personal-tasks', el) }
  } catch (e) { toast(e.message, 'error') }
}

// ──────────────────────────────────────────────────────────────────
// Inline searchable assignee picker for the My Tasks table. Native
// <select> only does single-char jump-to-match, which falls apart on
// employee lists of 50+. This is a portaled popover with a search
// input + filtered list, positioned via getBoundingClientRect so it
// isn't clipped by the table's overflow:hidden parents.
// ──────────────────────────────────────────────────────────────────
let _ptaskPickerPanel = null
let _ptaskPickerBtn = null
let _ptaskPickerOutsideHandler = null
let _ptaskPickerReposition = null

function openPtaskAssigneePicker(taskId, btnEl) {
  if (_ptaskPickerPanel) { closePtaskAssigneePicker(); return }
  const panel = document.createElement('div')
  panel.className = 'ptask-assignee-picker'
  panel.style.cssText = 'position:fixed;z-index:10000;background:var(--surface,#fff);border:1px solid var(--border,#E5E7EB);border-radius:8px;box-shadow:0 16px 40px rgba(0,0,0,.25);padding:6px;min-width:220px'
  panel.innerHTML = `
    <input type="text" class="form-input ptask-picker-search" placeholder="Search…" autocomplete="off"
      style="margin:2px 0 6px 0;padding:6px 10px;font-size:12.5px"
      oninput="filterPtaskAssigneePicker(this.value, '${taskId}')"
      onkeydown="if(event.key==='Escape')closePtaskAssigneePicker()"/>
    <div class="ptask-assignee-picker-list" style="max-height:260px;overflow:auto"></div>`
  document.body.appendChild(panel)
  _ptaskPickerPanel = panel
  _ptaskPickerBtn = btnEl
  _positionPtaskPicker()
  filterPtaskAssigneePicker('', taskId)
  const input = panel.querySelector('input.ptask-picker-search')
  setTimeout(() => input?.focus(), 0)
  _ptaskPickerOutsideHandler = (e) => {
    if (panel.contains(e.target) || btnEl?.contains(e.target)) return
    closePtaskAssigneePicker()
  }
  setTimeout(() => document.addEventListener('mousedown', _ptaskPickerOutsideHandler), 0)
  _ptaskPickerReposition = () => _positionPtaskPicker()
  window.addEventListener('scroll', _ptaskPickerReposition, true)
  window.addEventListener('resize', _ptaskPickerReposition)
}

function _positionPtaskPicker() {
  if (!_ptaskPickerPanel || !_ptaskPickerBtn) return
  const rect = _ptaskPickerBtn.getBoundingClientRect()
  const w = Math.max(rect.width, 240)
  const maxRight = window.innerWidth - 8
  const left = Math.min(rect.left, maxRight - w)
  _ptaskPickerPanel.style.top = (rect.bottom + 4) + 'px'
  _ptaskPickerPanel.style.left = Math.max(8, left) + 'px'
  _ptaskPickerPanel.style.minWidth = w + 'px'
}

function closePtaskAssigneePicker() {
  if (!_ptaskPickerPanel) return
  _ptaskPickerPanel.remove()
  _ptaskPickerPanel = null
  _ptaskPickerBtn = null
  if (_ptaskPickerOutsideHandler) {
    document.removeEventListener('mousedown', _ptaskPickerOutsideHandler)
    _ptaskPickerOutsideHandler = null
  }
  if (_ptaskPickerReposition) {
    window.removeEventListener('scroll', _ptaskPickerReposition, true)
    window.removeEventListener('resize', _ptaskPickerReposition)
    _ptaskPickerReposition = null
  }
}

function filterPtaskAssigneePicker(query, taskId) {
  if (!_ptaskPickerPanel) return
  const q = String(query || '').trim().toLowerCase()
  const eligible = (_ptaskUsers || []).filter(u => Number(u.is_active ?? 1) !== 0)
  const matches = q
    ? eligible.filter(u =>
        String(u.full_name || '').toLowerCase().includes(q)
        || String(u.email || '').toLowerCase().includes(q)
        || String(u.designation || '').toLowerCase().includes(q))
    : eligible
  const list = _ptaskPickerPanel.querySelector('.ptask-assignee-picker-list')
  if (!list) return
  if (!matches.length) {
    list.innerHTML = `<div style="padding:10px;font-size:12px;color:var(--text-muted)">No matches</div>`
    return
  }
  list.innerHTML = matches.slice(0, 50).map(u => `
    <div onclick="pickPtaskAssignee('${escapeInbox(taskId)}','${escapeInbox(u.id)}')"
      style="padding:7px 10px;cursor:pointer;font-size:12.5px;color:var(--text-primary);border-radius:6px"
      onmouseover="this.style.background='rgba(169,112,255,0.10)'"
      onmouseout="this.style.background='transparent'">
      ${escapeInbox(u.full_name || u.email || u.id)}${u.designation ? `<span style="color:var(--text-muted);font-size:11px"> · ${escapeInbox(u.designation)}</span>` : ''}
    </div>`).join('')
}

async function pickPtaskAssignee(taskId, userId) {
  closePtaskAssigneePicker()
  await ptaskInlineSave(taskId, 'assigned_to', userId)
}
