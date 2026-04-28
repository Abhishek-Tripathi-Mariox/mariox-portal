// ═══════════════════════════════════════════════════════════
// support.js — Support / Ticket Management
// Staff (admin/pm/pc/developer/team) view, with role-based actions.
// Client portal entry point is exposed as renderCpSupport().
// ═══════════════════════════════════════════════════════════

const SUPPORT_PRIORITY_COLORS = {
  urgent: '#FF5E3A',
  high: '#FF7A45',
  medium: '#FFCB47',
  low: '#94a3b8',
}
const SUPPORT_STATUS_COLORS = {
  open: '#FF7A45',
  in_progress: '#FFA577',
  waiting_on_client: '#C56FE6',
  resolved: '#58C68A',
  closed: '#64748b',
}
const SUPPORT_STATUSES = ['open', 'in_progress', 'waiting_on_client', 'resolved', 'closed']
const SUPPORT_PRIORITIES = ['low', 'medium', 'high', 'urgent']
const SUPPORT_CATEGORIES = ['bug', 'feature_request', 'question', 'billing', 'access', 'other']

const _supportState = {
  filterStatus: '',
  filterPriority: '',
  filterProject: '',
  search: '',
  list: [],
  projects: [],
  currentTicket: null,
  comments: [],
  events: [],
  assignees: { groups: { managers: [], developers: [], team: [] }, project: null },
}

const SUPPORT_EVENT_ICONS = {
  created: { icon: 'fa-circle-plus', color: '#FFB347' },
  status_changed: { icon: 'fa-circle-half-stroke', color: '#FFA577' },
  priority_changed: { icon: 'fa-flag', color: '#FFCB47' },
  assignee_changed: { icon: 'fa-user-check', color: '#C56FE6' },
  category_changed: { icon: 'fa-tags', color: '#FFB67A' },
  project_changed: { icon: 'fa-folder', color: '#FFCB47' },
  subject_edited: { icon: 'fa-pen', color: '#9F8678' },
  description_edited: { icon: 'fa-file-pen', color: '#9F8678' },
  comment_added: { icon: 'fa-message', color: '#FFB67A' },
  internal_note_added: { icon: 'fa-lock', color: '#FFCB47' },
}

function _supEsc(value = '') {
  const text = value === null || value === undefined ? '' : String(value)
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function _supBadge(label, color) {
  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:600;background:${color}20;color:${color};border:1px solid ${color}40">${_supEsc(label)}</span>`
}

function _supStatusLabel(s) {
  return String(s || '').replace(/_/g, ' ')
}

// ─── Staff page ─────────────────────────────────────────────
async function renderSupportTickets(el) {
  el.innerHTML = `<div style="padding:40px 0;text-align:center;color:var(--text-muted)"><i class="fas fa-spinner fa-spin" style="font-size:24px"></i></div>`
  await Promise.all([loadSupportList(), loadSupportProjects()])
  paintSupportList(el)
}

async function loadSupportProjects() {
  try {
    const res = await API.get('/projects')
    _supportState.projects = res.projects || res.data || []
  } catch {
    _supportState.projects = []
  }
}

async function loadSupportList() {
  try {
    const params = {}
    if (_supportState.filterStatus) params.status = _supportState.filterStatus
    if (_supportState.filterPriority) params.priority = _supportState.filterPriority
    if (_supportState.filterProject) params.project_id = _supportState.filterProject
    const res = await API.get('/support/tickets', { params })
    _supportState.list = res.tickets || res.data || []
  } catch (e) {
    _supportState.list = []
    if (typeof toast === 'function') toast('Failed to load tickets: ' + e.message, 'error')
  }
}

function paintSupportList(el) {
  const role = String(_user?.role || '').toLowerCase()
  const canCreate = role === 'admin' || role === 'pm' || role === 'pc' || role === 'developer' || role === 'team'
  const search = (_supportState.search || '').toLowerCase()
  const list = _supportState.list.filter((t) => {
    if (!search) return true
    const blob = [t.subject, t.description, t.created_by_name, t.assigned_to_name, t.client_name, t.project_name]
      .filter(Boolean).join(' ').toLowerCase()
    return blob.includes(search)
  })

  el.innerHTML = `
    <div class="page-header">
      <h1 class="page-title"><i class="fas fa-life-ring"></i> Support Tickets</h1>
      ${canCreate ? `<button class="btn btn-primary" onclick="openSupportCreateModal()"><i class="fas fa-plus"></i> New Ticket</button>` : ''}
    </div>

    <div class="glass-card" style="padding:14px;margin-bottom:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <input class="form-input" id="sup-search" placeholder="Search tickets…" value="${_supEsc(_supportState.search)}" oninput="onSupportSearch(this.value)" style="max-width:280px"/>
      <select class="form-select" id="sup-filter-project" onchange="onSupportFilter('project', this.value)" style="max-width:220px">
        <option value="">All projects</option>
        ${(_supportState.projects||[]).map(p => `<option value="${_supEsc(p.id)}" ${_supportState.filterProject===p.id?'selected':''}>${_supEsc(p.name||p.code||p.id)}</option>`).join('')}
      </select>
      <select class="form-select" id="sup-filter-status" onchange="onSupportFilter('status', this.value)" style="max-width:180px">
        <option value="">All statuses</option>
        ${SUPPORT_STATUSES.map(s => `<option value="${s}" ${_supportState.filterStatus===s?'selected':''}>${_supStatusLabel(s)}</option>`).join('')}
      </select>
      <select class="form-select" id="sup-filter-priority" onchange="onSupportFilter('priority', this.value)" style="max-width:180px">
        <option value="">All priorities</option>
        ${SUPPORT_PRIORITIES.map(p => `<option value="${p}" ${_supportState.filterPriority===p?'selected':''}>${p}</option>`).join('')}
      </select>
      <button class="btn btn-secondary btn-sm" onclick="reloadSupportList()"><i class="fas fa-rotate"></i> Refresh</button>
    </div>

    ${list.length === 0 ? `
      <div class="glass-card" style="padding:48px;text-align:center;color:var(--text-muted)">
        <i class="fas fa-ticket" style="font-size:32px;opacity:.5"></i>
        <p style="margin-top:12px">No tickets match your filters.</p>
      </div>
    ` : `
      <div style="display:grid;gap:10px">
        ${list.map(renderSupportRow).join('')}
      </div>
    `}
  `
}

function renderSupportRow(t) {
  const pColor = SUPPORT_PRIORITY_COLORS[t.priority] || '#94a3b8'
  const sColor = SUPPORT_STATUS_COLORS[t.status] || '#64748b'
  const subTitle = [t.project_name, t.client_name].filter(Boolean).join(' · ')
  return `
    <div class="glass-card" style="padding:14px;cursor:pointer;border-left:3px solid ${pColor}" onclick="openSupportDetail('${_supEsc(t.id)}')">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:700;color:var(--text-primary)">${_supEsc(t.subject)}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:3px">
            #${_supEsc(String(t.id).slice(-6))}${subTitle ? ` · ${_supEsc(subTitle)}` : ''}
            ${t.created_by_name ? ` · by ${_supEsc(t.created_by_name)}` : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          ${_supBadge(t.priority || 'medium', pColor)}
          ${_supBadge(_supStatusLabel(t.status), sColor)}
          ${t.assigned_to_name ? `<span style="font-size:11px;color:var(--text-muted)"><i class="fas fa-user-check"></i> ${_supEsc(t.assigned_to_name)}</span>` : `<span style="font-size:11px;color:#94a3b8"><i class="fas fa-user-slash"></i> Unassigned</span>`}
        </div>
      </div>
    </div>`
}

function onSupportSearch(value) {
  _supportState.search = value
  const el = document.getElementById('page-support-tickets')
  if (el) paintSupportList(el)
}

async function onSupportFilter(kind, value) {
  if (kind === 'status') _supportState.filterStatus = value
  if (kind === 'priority') _supportState.filterPriority = value
  if (kind === 'project') _supportState.filterProject = value
  await loadSupportList()
  const el = document.getElementById('page-support-tickets')
  if (el) paintSupportList(el)
}

async function reloadSupportList() {
  await loadSupportList()
  const el = document.getElementById('page-support-tickets')
  if (el) paintSupportList(el)
}

// ─── Create modal ───────────────────────────────────────────
async function openSupportCreateModal() {
  let projects = []
  let clients = []
  try {
    const role = String(_user?.role || '').toLowerCase()
    const projRes = await API.get('/projects')
    projects = projRes.projects || projRes.data || []
    if (role === 'admin' || role === 'pm' || role === 'pc') {
      const cRes = await API.get('/clients').catch(() => ({ clients: [] }))
      clients = cRes.clients || cRes.data || []
    }
  } catch (e) {
    if (typeof toast === 'function') toast('Failed to load form data: ' + e.message, 'error')
  }

  const role = String(_user?.role || '').toLowerCase()
  const canAssign = ['admin', 'pm', 'pc'].includes(role)

  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-plus-circle"></i> New Support Ticket</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:20px;display:flex;flex-direction:column;gap:14px">
      <div class="grid-2" style="gap:12px">
        <div class="form-group">
          <label class="form-label">Subject *</label>
          <input id="sup-new-subject" class="form-input" maxlength="200" placeholder="Brief summary"/>
        </div>
        <div class="form-group">
          <label class="form-label">Priority</label>
          <select id="sup-new-priority" class="form-select">
            ${SUPPORT_PRIORITIES.map(p => `<option value="${p}" ${p==='medium'?'selected':''}>${p}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="grid-2" style="gap:12px">
        <div class="form-group">
          <label class="form-label">Category</label>
          <select id="sup-new-category" class="form-select">
            ${SUPPORT_CATEGORIES.map(c => `<option value="${c}" ${c==='other'?'selected':''}>${_supStatusLabel(c)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Project</label>
          <select id="sup-new-project" class="form-select" onchange="onSupportProjectChanged(this.value)">
            <option value="">— None —</option>
            ${projects.map(p => `<option value="${_supEsc(p.id)}">${_supEsc(p.name||p.code||p.id)}</option>`).join('')}
          </select>
        </div>
      </div>
      ${clients.length ? `
        <div class="form-group">
          <label class="form-label">Client (optional)</label>
          <select id="sup-new-client" class="form-select">
            <option value="">— None —</option>
            ${clients.map(c => `<option value="${_supEsc(c.id)}">${_supEsc(c.company_name||c.contact_name||c.email)}</option>`).join('')}
          </select>
        </div>
      ` : ''}
      ${canAssign ? `
        <div class="form-group" id="sup-new-assignee-wrap">
          <label class="form-label">Assign to</label>
          <select id="sup-new-assignee" class="form-select"><option value="">Loading…</option></select>
          <div id="sup-new-assignee-hint" style="font-size:11px;color:var(--text-muted);margin-top:4px">Pick a project above to scope the assignee list to its team.</div>
        </div>
      ` : ''}
      <div class="form-group">
        <label class="form-label">Description *</label>
        <textarea id="sup-new-description" class="form-textarea" rows="5" maxlength="5000" placeholder="Provide steps, context, screenshots links, etc."></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitSupportTicket()"><i class="fas fa-paper-plane"></i> Submit</button>
    </div>
  `, 'modal-lg')

  if (canAssign) onSupportProjectChanged('')
}

async function onSupportProjectChanged(projectId) {
  const select = document.getElementById('sup-new-assignee')
  const hint = document.getElementById('sup-new-assignee-hint')
  const role = String(_user?.role || '').toLowerCase()
  if (!['admin', 'pm', 'pc'].includes(role)) return
  if (!select) return

  select.innerHTML = `<option value="">Loading…</option>`
  try {
    const params = projectId ? { project_id: projectId } : {}
    const res = await API.get('/support/assignees', { params })
    const groups = res.groups || {}
    const project = res.project || null
    const opts = ['<option value="">— Unassigned —</option>']
    if ((groups.managers || []).length) {
      opts.push('<optgroup label="Project Managers">')
      for (const u of groups.managers) opts.push(`<option value="${_supEsc(u.id)}">${_supEsc(u.full_name)}</option>`)
      opts.push('</optgroup>')
    }
    if ((groups.developers || []).length) {
      opts.push('<optgroup label="In-house Developers">')
      for (const u of groups.developers) opts.push(`<option value="${_supEsc(u.id)}">${_supEsc(u.full_name)}</option>`)
      opts.push('</optgroup>')
    }
    if ((groups.team || []).length) {
      opts.push('<optgroup label="External Team">')
      for (const u of groups.team) opts.push(`<option value="${_supEsc(u.id)}">${_supEsc(u.full_name)}</option>`)
      opts.push('</optgroup>')
    }
    select.innerHTML = opts.join('')
    if (hint) {
      if (!projectId) {
        hint.textContent = 'No project picked — assignable to managers (admin / PM / PC) only. Choose a project to add its team.'
      } else {
        const type = project?.assignment_type === 'external' ? 'External team project' : 'In-house project'
        hint.textContent = `${type} — only related people can be assigned.`
      }
    }
  } catch (e) {
    select.innerHTML = `<option value="">— Unassigned —</option>`
    if (hint) hint.textContent = 'Could not load assignees: ' + e.message
  }
}

async function submitSupportTicket() {
  const subject = document.getElementById('sup-new-subject')?.value.trim()
  const description = document.getElementById('sup-new-description')?.value.trim()
  const priority = document.getElementById('sup-new-priority')?.value || 'medium'
  const category = document.getElementById('sup-new-category')?.value || 'other'
  const project_id = document.getElementById('sup-new-project')?.value || null
  const client_id = document.getElementById('sup-new-client')?.value || null
  const assigned_to_id = document.getElementById('sup-new-assignee')?.value || null
  if (!subject || subject.length < 3) return toast('Subject must be at least 3 characters', 'error')
  if (!description || description.length < 5) return toast('Description must be at least 5 characters', 'error')
  try {
    await API.post('/support/tickets', {
      subject, description, priority, category, project_id, client_id, assigned_to_id,
    })
    closeModal()
    toast('Ticket created', 'success')
    await reloadSupportList()
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

// ─── Detail drawer ──────────────────────────────────────────
async function openSupportDetail(ticketId) {
  try {
    const res = await API.get(`/support/tickets/${ticketId}`)
    _supportState.currentTicket = res.ticket
    _supportState.comments = res.comments || []
    _supportState.events = res.events || []
    _supportState.assignees = { groups: { managers: [], developers: [], team: [] }, project: null }
    paintSupportDetail()
    if (res.ticket?.project_id) {
      try {
        const aRes = await API.get('/support/assignees', { params: { project_id: res.ticket.project_id } })
        _supportState.assignees = { groups: aRes.groups || {}, project: aRes.project || null }
        paintSupportDetail()
      } catch {}
    }
  } catch (e) {
    toast('Failed to load ticket: ' + e.message, 'error')
  }
}

function _supBuildTimeline(events, comments) {
  const items = []
  for (const ev of events || []) {
    items.push({ kind: 'event', at: ev.created_at, data: ev })
  }
  const commentById = new Map((comments || []).map((c) => [c.id, c]))
  // For comment events, attach the actual comment body so we render a single rich entry
  for (const it of items) {
    if (it.kind === 'event' && (it.data.type === 'comment_added' || it.data.type === 'internal_note_added')) {
      const cid = it.data.note
      const c = cid ? commentById.get(cid) : null
      if (c) it.comment = c
    }
  }
  // If a comment exists but didn't get an event (older data), fall back to rendering it directly
  const usedCommentIds = new Set(items.filter((i) => i.comment).map((i) => i.comment.id))
  for (const c of comments || []) {
    if (!usedCommentIds.has(c.id)) items.push({ kind: 'comment', at: c.created_at, data: c })
  }
  items.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))
  return items
}

function _supRelativeTime(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diff = Math.max(0, now - then)
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.floor(hr / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

function _supEventLabel(ev) {
  const t = ev.type
  const from = ev.from_label
  const to = ev.to_label
  switch (t) {
    case 'created':         return `created this ticket`
    case 'status_changed':  return `changed status from <strong>${_supEsc(_supStatusLabel(from || ''))}</strong> to <strong>${_supEsc(_supStatusLabel(to || ''))}</strong>`
    case 'priority_changed':return `changed priority from <strong>${_supEsc(from || '')}</strong> to <strong>${_supEsc(to || '')}</strong>`
    case 'assignee_changed':return `${ev.from_value ? 'reassigned' : 'assigned'} to <strong>${_supEsc(to || 'Unassigned')}</strong>${ev.from_value ? ` (was ${_supEsc(from || 'Unassigned')})` : ''}`
    case 'category_changed':return `changed category from <strong>${_supEsc(from || '')}</strong> to <strong>${_supEsc(to || '')}</strong>`
    case 'project_changed': return `moved to project <strong>${_supEsc(to || 'No project')}</strong>`
    case 'subject_edited':  return `edited the subject`
    case 'description_edited': return `edited the description`
    case 'comment_added':   return `replied`
    case 'internal_note_added': return `added an internal note`
    default: return _supEsc(t)
  }
}

function _supRenderTimelineItem(it) {
  const ev = it.data
  const conf = SUPPORT_EVENT_ICONS[ev.type] || { icon: 'fa-circle', color: '#94A3B8' }
  const when = _supRelativeTime(ev.created_at || ev.at)
  const fullTime = _supEsc(new Date(ev.created_at).toLocaleString())
  const actor = _supEsc(ev.actor_name || 'Someone')

  if (it.comment) {
    const c = it.comment
    const isInternal = !!c.is_internal
    return `
      <div class="sup-timeline-item">
        <div class="sup-timeline-rail"><span class="sup-timeline-dot" style="background:${conf.color}"><i class="fas ${conf.icon}"></i></span></div>
        <div class="sup-timeline-body sup-comment ${isInternal?'is-internal':''}">
          <div class="sup-timeline-meta">
            <strong>${actor}</strong>
            <span>${ev.actor_role === 'client' ? 'Client' : 'Staff'}</span>
            ${isInternal ? '<span class="sup-pill sup-pill-internal"><i class="fas fa-lock"></i> Internal note</span>' : ''}
            <span class="sup-time" title="${fullTime}">${when}</span>
          </div>
          <div class="sup-comment-body">${_supEsc(c.body)}</div>
        </div>
      </div>`
  }

  return `
    <div class="sup-timeline-item">
      <div class="sup-timeline-rail"><span class="sup-timeline-dot" style="background:${conf.color}"><i class="fas ${conf.icon}"></i></span></div>
      <div class="sup-timeline-body sup-event">
        <div class="sup-event-line">
          <strong>${actor}</strong> ${_supEventLabel(ev)}
          <span class="sup-time" title="${fullTime}">· ${when}</span>
        </div>
      </div>
    </div>`
}

function paintSupportDetail() {
  const t = _supportState.currentTicket
  if (!t) return
  const role = String(_user?.role || '').toLowerCase()
  const isStaff = ['admin','pm','pc','developer','team'].includes(role)
  const isPm = ['admin','pm','pc'].includes(role)
  const pColor = SUPPORT_PRIORITY_COLORS[t.priority] || '#94a3b8'
  const sColor = SUPPORT_STATUS_COLORS[t.status] || '#64748b'

  const groups = _supportState.assignees.groups || {}
  const project = _supportState.assignees.project
  const assigneeOpts = ['<option value="">— Unassigned —</option>']
  if ((groups.managers || []).length) {
    assigneeOpts.push('<optgroup label="Project Managers">')
    for (const u of groups.managers) assigneeOpts.push(`<option value="${_supEsc(u.id)}" ${t.assigned_to_id===u.id?'selected':''}>${_supEsc(u.full_name)}</option>`)
    assigneeOpts.push('</optgroup>')
  }
  if ((groups.developers || []).length) {
    assigneeOpts.push('<optgroup label="In-house Developers">')
    for (const u of groups.developers) assigneeOpts.push(`<option value="${_supEsc(u.id)}" ${t.assigned_to_id===u.id?'selected':''}>${_supEsc(u.full_name)}</option>`)
    assigneeOpts.push('</optgroup>')
  }
  if ((groups.team || []).length) {
    assigneeOpts.push('<optgroup label="External Team">')
    for (const u of groups.team) assigneeOpts.push(`<option value="${_supEsc(u.id)}" ${t.assigned_to_id===u.id?'selected':''}>${_supEsc(u.full_name)}</option>`)
    assigneeOpts.push('</optgroup>')
  }

  const allowedStatuses = isPm
    ? SUPPORT_STATUSES
    : (role === 'developer' || role === 'team'
        ? ['open', 'in_progress', 'waiting_on_client', 'resolved']
        : ['open', 'closed'])

  const timeline = _supBuildTimeline(_supportState.events, _supportState.comments)
  const timelineHtml = timeline.length
    ? timeline.map(_supRenderTimelineItem).join('')
    : '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:18px">No activity yet.</div>'

  showModal(`
    <div class="modal-header">
      <div style="min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="sup-pill" style="background:rgba(255,255,255,0.06);color:var(--text-muted);font-family:'IBM Plex Mono',monospace;font-size:11px">#${_supEsc(String(t.id).slice(-6).toUpperCase())}</span>
          ${_supBadge(_supStatusLabel(t.status), sColor)}
          ${_supBadge(t.priority||'medium', pColor)}
        </div>
        <h3 style="margin:6px 0 0">${_supEsc(t.subject)}</h3>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${_supEsc(t.project_name||'No project')}${t.client_name?` · ${_supEsc(t.client_name)}`:''} · opened by ${_supEsc(t.created_by_name||'—')} ${_supRelativeTime(t.created_at)}</div>
      </div>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:grid;grid-template-columns:minmax(0,1.6fr) minmax(280px,0.95fr);gap:16px">
      <div style="display:flex;flex-direction:column;gap:14px;min-width:0">
        <div class="card">
          <div class="card-header"><h3><i class="fas fa-align-left" style="margin-right:6px;color:var(--text-muted)"></i>Description</h3></div>
          <div class="card-body" style="white-space:pre-wrap;font-size:13px;line-height:1.55">${_supEsc(t.description)}</div>
        </div>

        <div class="card">
          <div class="card-header"><h3><i class="fas fa-clock-rotate-left" style="margin-right:6px;color:var(--text-muted)"></i>Activity</h3></div>
          <div class="card-body sup-timeline">${timelineHtml}</div>
          <div class="card-body" style="border-top:1px solid var(--border);display:flex;flex-direction:column;gap:8px">
            <textarea id="sup-comment-body" class="form-textarea" rows="3" placeholder="Add a reply or note…"></textarea>
            ${isStaff ? `<label style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:6px"><input type="checkbox" id="sup-comment-internal"/> Internal note (hidden from client)</label>` : ''}
            <div style="text-align:right">
              <button class="btn btn-primary btn-sm" onclick="postSupportComment('${_supEsc(t.id)}')"><i class="fas fa-paper-plane"></i> Send</button>
            </div>
          </div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="card">
          <div class="card-header"><h3><i class="fas fa-circle-half-stroke" style="margin-right:6px;color:var(--text-muted)"></i>Status</h3></div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:8px">
            ${(isPm || role === 'developer' || role === 'team' || role === 'client') ? `
              <select id="sup-status-select" class="form-select" onchange="updateSupportField('${_supEsc(t.id)}','status',this.value)">
                ${allowedStatuses.map(s => `<option value="${s}" ${t.status===s?'selected':''}>${_supStatusLabel(s)}</option>`).join('')}
              </select>
            ` : `<div>${_supBadge(_supStatusLabel(t.status), sColor)}</div>`}
            ${isPm ? `
              <select id="sup-priority-select" class="form-select" onchange="updateSupportField('${_supEsc(t.id)}','priority',this.value)">
                ${SUPPORT_PRIORITIES.map(p => `<option value="${p}" ${t.priority===p?'selected':''}>${p}</option>`).join('')}
              </select>
            ` : ''}
          </div>
        </div>

        ${isPm ? `
          <div class="card">
            <div class="card-header"><h3><i class="fas fa-user-check" style="margin-right:6px;color:var(--text-muted)"></i>Assignment</h3></div>
            <div class="card-body" style="display:flex;flex-direction:column;gap:8px">
              <select id="sup-assign-select" class="form-select" onchange="assignSupport('${_supEsc(t.id)}',this.value)">
                ${assigneeOpts.join('')}
              </select>
              ${project ? `<div style="font-size:11px;color:var(--text-muted)">${project.assignment_type==='external'?'External team project':'In-house project'} — only related people are listed.</div>` : '<div style="font-size:11px;color:var(--text-muted)">Pick a project on the ticket to scope assignees.</div>'}
            </div>
          </div>
        ` : ''}

        <div class="card">
          <div class="card-header"><h3><i class="fas fa-circle-info" style="margin-right:6px;color:var(--text-muted)"></i>Details</h3></div>
          <div class="card-body" style="font-size:12px;color:var(--text-muted);display:grid;gap:6px">
            <div><strong>Requester:</strong> ${_supEsc(t.created_by_name||'—')} <span style="opacity:.6">(${_supEsc(t.created_by_role||'')})</span></div>
            <div><strong>Assigned:</strong> ${_supEsc(t.assigned_to_name||'Unassigned')}</div>
            <div><strong>Project:</strong> ${_supEsc(t.project_name||'—')}</div>
            <div><strong>Client:</strong> ${_supEsc(t.client_name||'—')}</div>
            <div><strong>Category:</strong> ${_supEsc(t.category||'—')}</div>
            <div><strong>Created:</strong> ${_supEsc(new Date(t.created_at).toLocaleString())}</div>
            <div><strong>Updated:</strong> ${_supEsc(new Date(t.updated_at).toLocaleString())}</div>
            ${t.resolved_at ? `<div><strong>Resolved:</strong> ${_supEsc(new Date(t.resolved_at).toLocaleString())}</div>`:''}
            ${t.closed_at ? `<div><strong>Closed:</strong> ${_supEsc(new Date(t.closed_at).toLocaleString())}</div>`:''}
          </div>
        </div>

        ${isPm ? `<button class="btn btn-danger btn-sm" onclick="deleteSupportTicket('${_supEsc(t.id)}')"><i class="fas fa-trash"></i> Delete ticket</button>` : ''}
      </div>
    </div>
  `, 'modal-xl')
}

async function updateSupportField(ticketId, field, value) {
  try {
    await API.patch(`/support/tickets/${ticketId}`, { [field]: value })
    const fresh = await API.get(`/support/tickets/${ticketId}`)
    _supportState.currentTicket = fresh.ticket
    _supportState.comments = fresh.comments || []
    _supportState.events = fresh.events || []
    paintSupportDetail()
    await reloadSupportList()
    toast('Updated', 'success')
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

async function assignSupport(ticketId, assignedToId) {
  try {
    await API.patch(`/support/tickets/${ticketId}/assign`, { assigned_to_id: assignedToId || null })
    const fresh = await API.get(`/support/tickets/${ticketId}`)
    _supportState.currentTicket = fresh.ticket
    _supportState.comments = fresh.comments || []
    _supportState.events = fresh.events || []
    paintSupportDetail()
    await reloadSupportList()
    toast(assignedToId ? 'Assigned' : 'Unassigned', 'success')
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

async function postSupportComment(ticketId) {
  const body = document.getElementById('sup-comment-body')?.value.trim()
  const isInternal = document.getElementById('sup-comment-internal')?.checked || false
  if (!body) return toast('Write something first', 'error')
  try {
    await API.post(`/support/tickets/${ticketId}/comments`, { body, is_internal: isInternal })
    const fresh = await API.get(`/support/tickets/${ticketId}`)
    _supportState.currentTicket = fresh.ticket
    _supportState.comments = fresh.comments || []
    _supportState.events = fresh.events || []
    paintSupportDetail()
    toast('Comment added', 'success')
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

async function deleteSupportTicket(ticketId) {
  if (!confirm('Delete this ticket and its comments? This cannot be undone.')) return
  try {
    await API.delete(`/support/tickets/${ticketId}`)
    closeModal()
    toast('Ticket deleted', 'success')
    await reloadSupportList()
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

// ─── Client portal entry ────────────────────────────────────
async function renderCpSupport(container) {
  container.innerHTML = `<div style="color:#64748b;padding:40px 0;text-align:center"><i class="fas fa-spinner fa-spin" style="font-size:24px"></i></div>`
  try {
    const res = await ClientAPI.get('/support/tickets')
    const list = res.tickets || res.data || []
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h3 style="margin:0;color:#e2e8f0">My Support Tickets</h3>
        <button class="btn btn-primary" onclick="openCpSupportCreate()"><i class="fas fa-plus"></i> New Ticket</button>
      </div>
      ${list.length === 0 ? `
        <div style="padding:48px;text-align:center;color:#64748b;border:1px dashed #2A1812;border-radius:12px">
          <i class="fas fa-life-ring" style="font-size:32px;opacity:.5"></i>
          <p style="margin-top:12px">You haven't raised any tickets yet.</p>
        </div>
      ` : `
        <div style="display:grid;gap:10px">
          ${list.map(t => {
            const pColor = SUPPORT_PRIORITY_COLORS[t.priority] || '#94a3b8'
            const sColor = SUPPORT_STATUS_COLORS[t.status] || '#64748b'
            return `
              <div onclick="openCpSupportDetail('${_supEsc(t.id)}')" style="padding:14px;border-radius:10px;background:#1F0F08;border:1px solid #2A1812;border-left:3px solid ${pColor};cursor:pointer">
                <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
                  <div style="font-size:14px;font-weight:600;color:#e2e8f0">${_supEsc(t.subject)}</div>
                  <div style="display:flex;gap:6px;flex-wrap:wrap">${_supBadge(_supStatusLabel(t.status), sColor)}${_supBadge(t.priority||'medium', pColor)}</div>
                </div>
                <div style="font-size:11px;color:#64748b;margin-top:4px">#${_supEsc(String(t.id).slice(-6))} · ${_supEsc(new Date(t.created_at).toLocaleDateString())} · ${_supEsc(t.assigned_to_name||'Unassigned')}</div>
              </div>`
          }).join('')}
        </div>
      `}
    `
  } catch (e) {
    container.innerHTML = `<div style="color:#FF5E3A;padding:24px;text-align:center">Failed to load tickets: ${_supEsc(e.message)}</div>`
  }
}

async function openCpSupportCreate() {
  let projects = []
  let loadError = null
  try {
    const clientId = _user?.sub || _user?.id
    if (clientId) {
      const res = await ClientAPI.get(`/clients/${clientId}`)
      projects = res.projects || []
    }
  } catch (e) {
    loadError = e?.message || String(e)
    console.warn('Could not load client projects:', loadError)
  }

  const noProjects = projects.length === 0

  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-plus-circle"></i> Raise a Support Ticket</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:20px;display:flex;flex-direction:column;gap:12px">
      <div style="padding:10px 12px;border-radius:10px;background:rgba(255,122,69,.10);border:1px solid rgba(255,122,69,.30);font-size:12px;color:#FFCEAA;line-height:1.5">
        <i class="fas fa-info-circle"></i>
        Your ticket will be routed to the project manager. They'll then assign it to the right person on your project's team.
      </div>

      ${loadError ? `
        <div style="padding:10px 12px;border-radius:10px;background:rgba(255,94,58,.10);border:1px solid rgba(255,94,58,.30);font-size:12px;color:#FFB099">
          <i class="fas fa-triangle-exclamation"></i> Could not load your projects: ${_supEsc(loadError)}
        </div>
      ` : ''}

      <div class="form-group">
        <label class="form-label">Subject *</label>
        <input id="cp-sup-subject" class="form-input" maxlength="200" placeholder="What's the issue?"/>
      </div>

      <div class="grid-2" style="gap:12px">
        <div class="form-group">
          <label class="form-label">Project ${noProjects ? '' : '*'}</label>
          <select id="cp-sup-project" class="form-select" ${noProjects ? 'disabled' : ''}>
            ${noProjects
              ? `<option value="">No projects available</option>`
              : `<option value="">— Select a project —</option>${projects.map(p => `<option value="${_supEsc(p.id)}">${_supEsc(p.name || p.code || p.id)}</option>`).join('')}`}
          </select>
          ${noProjects ? `<div style="font-size:11px;color:#94a3b8;margin-top:4px">No projects are linked to your account yet. You can still raise a general ticket.</div>` : `<div style="font-size:11px;color:#64748b;margin-top:4px">Pick the project this ticket relates to so it reaches the right team.</div>`}
        </div>
        <div class="form-group">
          <label class="form-label">Priority</label>
          <select id="cp-sup-priority" class="form-select">
            ${SUPPORT_PRIORITIES.map(p => `<option value="${p}" ${p==='medium'?'selected':''}>${p}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Category</label>
        <select id="cp-sup-category" class="form-select">
          ${SUPPORT_CATEGORIES.map(c => `<option value="${c}" ${c==='question'?'selected':''}>${_supStatusLabel(c)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Description *</label>
        <textarea id="cp-sup-description" class="form-textarea" rows="5" maxlength="5000" placeholder="Steps to reproduce, screenshots links, expected vs. actual behavior."></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitCpSupportTicket()"><i class="fas fa-paper-plane"></i> Submit</button>
    </div>
  `, 'modal-lg')
}

async function submitCpSupportTicket() {
  const subject = document.getElementById('cp-sup-subject')?.value.trim()
  const description = document.getElementById('cp-sup-description')?.value.trim()
  const projectSelect = document.getElementById('cp-sup-project')
  const project_id = projectSelect?.value || null
  const priority = document.getElementById('cp-sup-priority')?.value || 'medium'
  const category = document.getElementById('cp-sup-category')?.value || 'question'
  if (!subject || subject.length < 3) return toast('Subject must be at least 3 characters', 'error')
  if (!description || description.length < 5) return toast('Description must be at least 5 characters', 'error')
  // If projects are available, force the client to pick one so the ticket has a routing target
  if (projectSelect && !projectSelect.disabled && projectSelect.options.length > 1 && !project_id) {
    return toast('Please pick the project this ticket is about', 'error')
  }
  try {
    await ClientAPI.post('/support/tickets', { subject, description, priority, category, project_id })
    closeModal()
    toast('Ticket submitted', 'success')
    const main = document.getElementById('cp-main')
    if (main) renderCpSupport(main)
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

async function openCpSupportDetail(ticketId) {
  try {
    const res = await ClientAPI.get(`/support/tickets/${ticketId}`)
    const t = res.ticket
    const comments = res.comments || []
    const pColor = SUPPORT_PRIORITY_COLORS[t.priority] || '#94a3b8'
    const sColor = SUPPORT_STATUS_COLORS[t.status] || '#64748b'
    const commentsHtml = comments.map((c) => `
      <div style="padding:10px 12px;border-radius:10px;background:#1F0F08;border:1px solid #2A1812">
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#64748b;margin-bottom:4px">
          <span><strong>${_supEsc(c.author_role==='client'?'You':'Support')}</strong> · ${_supEsc(new Date(c.created_at).toLocaleString())}</span>
        </div>
        <div style="white-space:pre-wrap;color:#e2e8f0;font-size:13px">${_supEsc(c.body)}</div>
      </div>
    `).join('') || '<div style="color:#64748b;font-size:12px;text-align:center;padding:16px">No replies yet.</div>'
    showModal(`
      <div class="modal-header">
        <div>
          <h3 style="margin:0">${_supEsc(t.subject)}</h3>
          <div style="font-size:11px;color:#64748b;margin-top:3px">#${_supEsc(String(t.id).slice(-6))} · ${_supEsc(t.project_name||'No project')}</div>
        </div>
        <button class="close-btn" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;gap:6px;flex-wrap:wrap">${_supBadge(_supStatusLabel(t.status), sColor)}${_supBadge(t.priority||'medium', pColor)}</div>
        <div style="white-space:pre-wrap;color:#e2e8f0;font-size:13px;line-height:1.5;padding:12px;border-radius:10px;background:#1F0F08;border:1px solid #2A1812">${_supEsc(t.description)}</div>
        <div style="display:flex;flex-direction:column;gap:8px">${commentsHtml}</div>
        <textarea id="cp-sup-reply" class="form-textarea" rows="3" placeholder="Reply…"></textarea>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
          ${t.status !== 'closed' ? `<button class="btn btn-outline" onclick="cpSupportClose('${_supEsc(t.id)}')"><i class="fas fa-times-circle"></i> Close ticket</button>` : `<button class="btn btn-outline" onclick="cpSupportReopen('${_supEsc(t.id)}')"><i class="fas fa-rotate-left"></i> Re-open</button>`}
          <button class="btn btn-primary" onclick="cpSupportReply('${_supEsc(t.id)}')"><i class="fas fa-paper-plane"></i> Send reply</button>
        </div>
      </div>
    `, 'modal-lg')
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

async function cpSupportReply(ticketId) {
  const body = document.getElementById('cp-sup-reply')?.value.trim()
  if (!body) return toast('Write something first', 'error')
  try {
    await ClientAPI.post(`/support/tickets/${ticketId}/comments`, { body })
    closeModal()
    openCpSupportDetail(ticketId)
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

async function cpSupportClose(ticketId) {
  try {
    await ClientAPI.patch(`/support/tickets/${ticketId}`, { status: 'closed' })
    closeModal()
    toast('Ticket closed', 'success')
    const main = document.getElementById('cp-main')
    if (main) renderCpSupport(main)
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}

async function cpSupportReopen(ticketId) {
  try {
    await ClientAPI.patch(`/support/tickets/${ticketId}`, { status: 'open' })
    closeModal()
    openCpSupportDetail(ticketId)
  } catch (e) {
    toast('Failed: ' + e.message, 'error')
  }
}
