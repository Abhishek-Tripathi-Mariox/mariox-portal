// Tasks — standalone tasks that aren't tied to a project.
// Visibility on the server: assignee + creator + their upper hierarchy
// (admin/PM/PC/HR see all; sales_manager sees TLs+agents; sales_tl sees
// agents). The page below renders whatever the API returns, so there's no
// duplicate gating client-side.

let _ptaskStatus = ''
let _ptaskUsers = []

async function renderPersonalTasksPage(el) {
  el.innerHTML = `<div style="padding:24px;color:#64748b"><i class="fas fa-spinner fa-spin"></i> Loading tasks…</div>`
  try {
    const [tasksRes, usersRes] = await Promise.all([
      API.get('/personal-tasks' + (_ptaskStatus ? '?status=' + _ptaskStatus : '')),
      API.get('/users').catch(() => ({ users: [] })),
    ])
    const tasks = tasksRes.tasks || tasksRes.data || []
    _ptaskUsers = usersRes.users || usersRes.data || []
    el.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title"><i class="fas fa-list-check" style="color:#a855f7;margin-right:8px"></i>Tasks</h1>
      <p class="page-subtitle">Independent tasks — assignee + their hierarchy. ${tasks.length} total.</p></div>
      <div class="page-actions" style="display:flex;gap:8px;flex-wrap:wrap">
        <select class="form-select" style="width:160px" onchange="ptaskFilterStatus(this.value)">
          <option value="" ${_ptaskStatus === '' ? 'selected' : ''}>All Status</option>
          <option value="todo" ${_ptaskStatus === 'todo' ? 'selected' : ''}>To Do</option>
          <option value="in_progress" ${_ptaskStatus === 'in_progress' ? 'selected' : ''}>In Progress</option>
          <option value="done" ${_ptaskStatus === 'done' ? 'selected' : ''}>Done</option>
        </select>
        <button class="btn btn-primary btn-sm" onclick="openPersonalTaskModal()"><i class="fas fa-plus"></i> New Task</button>
      </div>
    </div>
    <div class="card">
      <div class="card-body p-0 table-wrap">
        <table class="data-table">
          <thead><tr><th>Title</th><th>Assignee</th><th>Priority</th><th>Status</th><th>Due</th><th>Created by</th><th style="width:160px">Actions</th></tr></thead>
          <tbody>
            ${tasks.length ? tasks.map(t => `
              <tr>
                <td>
                  <div style="font-weight:600;color:#e2e8f0">${escapeInbox(t.title)}</div>
                  ${t.description ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeInbox(t.description)}</div>` : ''}
                </td>
                <td>${t.assigned_to_name ? `<div style="display:flex;align-items:center;gap:6px">${avatar(t.assigned_to_name, t.assigned_to_avatar, 'sm')}<span style="font-size:12px">${escapeInbox(t.assigned_to_name)}</span></div>` : '—'}</td>
                <td>${_ptaskPriorityBadge(t.priority)}</td>
                <td>${_ptaskStatusBadge(t.status)}</td>
                <td style="font-size:12px;color:${t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done' ? '#FF5E3A' : '#94a3b8'}">${t.due_date ? fmtDate(t.due_date) : '—'}</td>
                <td style="font-size:12px;color:#94a3b8">${escapeInbox(t.created_by_name || '—')}</td>
                <td>
                  <div style="display:flex;gap:4px">
                    ${t.status !== 'done' ? `<button class="btn btn-xs btn-primary" title="Mark done" onclick="ptaskSetStatus('${t.id}','done')"><i class="fas fa-check"></i></button>` : ''}
                    <button class="btn btn-xs btn-outline" title="Edit" onclick="openPersonalTaskModal('${t.id}')"><i class="fas fa-edit"></i></button>
                    <button class="btn btn-xs btn-outline" title="Delete" onclick="deletePersonalTask('${t.id}')" style="color:#FF5E3A"><i class="fas fa-trash"></i></button>
                  </div>
                </td>
              </tr>`).join('') : `<tr><td colspan="7" style="text-align:center;color:#64748b;padding:36px">No tasks. Click "New Task" to add one.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>${escapeInbox(e.message)}</p></div>`
  }
}

function _ptaskPriorityBadge(p) {
  const map = { low: 'todo', medium: 'inprogress', high: 'critical' }
  return `<span class="badge badge-${map[p] || 'todo'}">${escapeInbox(String(p || '').toUpperCase())}</span>`
}
function _ptaskStatusBadge(s) {
  const map = { todo: 'todo', in_progress: 'inprogress', done: 'done' }
  const labels = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' }
  return `<span class="badge badge-${map[s] || 'todo'}">${labels[s] || s}</span>`
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
        <div class="form-group"><label class="form-label">Assignee *</label>${hrEmployeePicker('ptask-assignee', _ptaskUsers, task?.assigned_to || '', { placeholder: 'Pick an employee…' })}</div>
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
            ${[['todo','To Do'],['in_progress','In Progress'],['done','Done']].map(([v,l]) => `<option value="${v}" ${task?.status === v ? 'selected' : ''}>${l}</option>`).join('')}
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

async function deletePersonalTask(id) {
  if (!confirm('Delete this task?')) return
  try {
    await API.delete('/personal-tasks/' + id)
    toast('Task deleted', 'success')
    const el = document.getElementById('page-personal-tasks')
    if (el) { el.dataset.loaded = ''; loadPage('personal-tasks', el) }
  } catch (e) { toast(e.message, 'error') }
}
