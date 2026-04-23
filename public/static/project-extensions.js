// ═══════════════════════════════════════════════════════════════
// Project Extensions — Teams, Kanban Permissions, Invites
// Hooked into existing app.js render pipeline
// ═══════════════════════════════════════════════════════════════

let _projectTeamsPage = 1
let _invitesPage = 1

// ─── PROJECT TEAMS SECTION ────────────────────────────────────
// Injected into the project detail page. Allows PM/admin to create
// teams within a project, assign members, and set team leads.

async function renderProjectTeamsSection(projectId, containerEl) {
  try {
    const [teamsRes, devsRes] = await Promise.all([
      API.get(`/project-teams/project/${projectId}`),
      API.get(`/projects/${projectId}/developers`),
    ])
    const teams = teamsRes.data || []
    const projectDevs = devsRes.developers || []
    const canManage = ['admin', 'pm'].includes(_user.role)
    const pagination = paginateClient(teams, _projectTeamsPage, 6)
    _projectTeamsPage = pagination.page

    containerEl.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div>
          <h2 style="font-size:18px;font-weight:700;margin:0">Project Teams</h2>
          <p style="font-size:12px;color:var(--text-muted);margin:4px 0 0">${pagination.total} team${pagination.total === 1 ? '' : 's'} in this project</p>
        </div>
        ${canManage ? `
          <button class="btn btn-primary" onclick="openCreateTeamModal('${projectId}')">
            <i class="fas fa-plus"></i> New Team
          </button>
        ` : ''}
      </div>

      ${teams.length === 0 ? `
        <div class="empty-state" style="padding:40px;text-align:center;background:rgba(255,255,255,.02);border-radius:12px;border:1px dashed var(--border)">
          <i class="fas fa-users fa-2x" style="color:var(--text-muted);margin-bottom:12px;display:block"></i>
          <h3 style="margin:0 0 4px;font-size:15px">No teams yet</h3>
          <p style="margin:0;color:var(--text-muted);font-size:13px">
            ${canManage ? 'Create a team to organise developers by function (e.g. Backend, Frontend, QA).' : 'The PM hasn\'t created any teams yet.'}
          </p>
        </div>
      ` : `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px">
          ${pagination.items.map(t => renderTeamCard(t, projectDevs, canManage)).join('')}
        </div>
        <div style="margin-top:12px">${renderPager(pagination, 'goProjectTeamsPage', 'goProjectTeamsPage', 'teams')}</div>
      `}
    `
  } catch (e) {
    containerEl.innerHTML = `<div style="color:var(--danger);padding:16px">Failed to load teams: ${e.message}</div>`
  }
}

function renderTeamCard(t, projectDevs, canManage) {
  const members = t.members || []
  return `
    <div class="glass-card" style="padding:16px;border-left:4px solid ${t.color}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px">
        <div style="min-width:0;flex:1">
          <h3 style="font-size:15px;font-weight:700;margin:0 0 2px;display:flex;align-items:center;gap:6px">
            <span style="width:8px;height:8px;border-radius:50%;background:${t.color}"></span>
            ${escapeHtml(t.name)}
          </h3>
          ${t.description ? `<p style="font-size:12px;color:var(--text-muted);margin:0">${escapeHtml(t.description)}</p>` : ''}
        </div>
        ${canManage ? `
          <div class="dropdown" style="position:relative">
            <button class="icon-btn" onclick="toggleTeamMenu('${t.id}')"><i class="fas fa-ellipsis-v"></i></button>
            <div id="team-menu-${t.id}" style="display:none;position:absolute;right:0;top:100%;background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;min-width:140px;z-index:10;box-shadow:0 10px 30px rgba(0,0,0,.3)">
              <button class="dropdown-item" onclick="openEditTeamModal('${t.id}')" style="width:100%;text-align:left;padding:10px 12px;background:none;border:none;color:var(--text);cursor:pointer;font-size:13px"><i class="fas fa-pen" style="width:14px"></i> Edit</button>
              <button class="dropdown-item" onclick="confirmDeleteTeam('${t.id}','${escapeHtml(t.name).replace(/'/g, "\\'")}')" style="width:100%;text-align:left;padding:10px 12px;background:none;border:none;color:var(--danger);cursor:pointer;font-size:13px"><i class="fas fa-trash" style="width:14px"></i> Delete</button>
            </div>
          </div>
        ` : ''}
      </div>

      <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">
        <i class="fas fa-user-crown" style="color:#f59e0b"></i>
        ${t.lead_name ? `Lead: <strong style="color:var(--text)">${escapeHtml(t.lead_name)}</strong>` : 'No team lead'}
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
        ${members.slice(0, 8).map(m => `
          <div title="${escapeHtml(m.full_name)}${m.role === 'lead' ? ' (Lead)' : ''}" style="position:relative">
            ${avatar(m.full_name, m.avatar_color || '#6366f1')}
            ${m.role === 'lead' ? '<span style="position:absolute;top:-2px;right:-2px;background:#f59e0b;color:#fff;border-radius:50%;width:14px;height:14px;font-size:8px;display:flex;align-items:center;justify-content:center">★</span>' : ''}
          </div>
        `).join('')}
        ${members.length > 8 ? `<span style="font-size:11px;color:var(--text-muted);align-self:center">+${members.length - 8} more</span>` : ''}
        ${members.length === 0 ? '<span style="font-size:12px;color:var(--text-muted);font-style:italic">No members yet</span>' : ''}
      </div>

      ${canManage ? `
        <button class="btn btn-secondary btn-sm w-full" onclick="openManageMembersModal('${t.id}')">
          <i class="fas fa-user-plus"></i> Manage members (${members.length})
        </button>
      ` : ''}
    </div>
  `
}

function toggleTeamMenu(id) {
  const menu = document.getElementById('team-menu-' + id)
  if (!menu) return
  document.querySelectorAll('[id^="team-menu-"]').forEach(m => { if (m.id !== menu.id) m.style.display = 'none' })
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none'
  // Close on outside click
  setTimeout(() => {
    const off = (e) => { if (!menu.contains(e.target)) { menu.style.display = 'none'; document.removeEventListener('click', off) } }
    document.addEventListener('click', off)
  }, 10)
}

async function openCreateTeamModal(projectId) {
  const devsRes = await API.get(`/projects/${projectId}/developers`)
  const devs = devsRes.developers || []
  pxModal({
    title: 'Create New Team',
    body: `
      <div class="form-group"><label class="form-label">Team name *</label><input id="team-name" class="form-input" placeholder="e.g. Backend Squad" autofocus/></div>
      <div class="form-group"><label class="form-label">Description</label><textarea id="team-desc" class="form-input" rows="2" placeholder="What does this team do?"></textarea></div>
      <div style="display:grid;grid-template-columns:1fr 120px;gap:10px">
        <div class="form-group"><label class="form-label">Team lead</label>
          <select id="team-lead" class="form-select">
            <option value="">— No lead —</option>
            ${devs.map(d => `<option value="${d.user_id}">${escapeHtml(d.full_name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label class="form-label">Colour</label><input id="team-color" type="color" value="#6366f1" class="form-input" style="height:40px;padding:3px"/></div>
      </div>
    `,
    confirmText: 'Create Team',
    onConfirm: async () => {
      const name = document.getElementById('team-name').value.trim()
      if (!name) { toast('Team name is required', 'error'); return false }
      try {
        await API.post(`/project-teams/project/${projectId}`, {
          name,
          description: document.getElementById('team-desc').value.trim(),
          team_lead_id: document.getElementById('team-lead').value || null,
          color: document.getElementById('team-color').value,
        })
        toast('Team created', 'success')
        reloadProjectTeamsSection(projectId)
        return true
      } catch (e) { toast('Failed: ' + e.message, 'error'); return false }
    }
  })
}

async function openCreateTeamFromOverviewModal() {
  try {
    const projectsRes = await API.get('/projects')
    const projects = projectsRes.projects || projectsRes.data || []
    if (!projects.length) {
      toast('No projects found. Create a project first.', 'error')
      return
    }
    pxModal({
      title: 'Create Team',
      body: `
        <div class="form-group">
          <label class="form-label">Project *</label>
          <select id="team-project" class="form-select" onchange="loadTeamLeadOptionsForModal(this.value)">
            <option value="">Select project</option>
            ${projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (${escapeHtml(p.code || '')})</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label class="form-label">Team name *</label><input id="team-name" class="form-input" placeholder="e.g. Backend Squad" autofocus/></div>
        <div class="form-group"><label class="form-label">Description</label><textarea id="team-desc" class="form-input" rows="2" placeholder="What does this team do?"></textarea></div>
        <div style="display:grid;grid-template-columns:1fr 120px;gap:10px">
          <div class="form-group"><label class="form-label">Team lead</label>
            <select id="team-lead" class="form-select">
              <option value="">— No lead —</option>
            </select>
          </div>
          <div class="form-group"><label class="form-label">Colour</label><input id="team-color" type="color" value="#6366f1" class="form-input" style="height:40px;padding:3px"/></div>
        </div>
      `,
      confirmText: 'Create Team',
      large: true,
      onConfirm: async () => {
        const projectId = document.getElementById('team-project').value
        const name = document.getElementById('team-name').value.trim()
        if (!projectId) { toast('Please select a project', 'error'); return false }
        if (!name) { toast('Team name is required', 'error'); return false }
        try {
          await API.post(`/project-teams/project/${projectId}`, {
            name,
            description: document.getElementById('team-desc').value.trim(),
            team_lead_id: document.getElementById('team-lead').value || null,
            color: document.getElementById('team-color').value,
          })
          toast('Team created', 'success')
          const el = document.getElementById('page-team-overview')
          if (el) { el.dataset.loaded = ''; loadPage('team-overview', el) }
          return true
        } catch (e) { toast('Failed: ' + e.message, 'error'); return false }
      }
    })
    loadTeamLeadOptionsForModal('')
  } catch (e) {
    toast('Failed to load projects: ' + e.message, 'error')
  }
}

async function loadTeamLeadOptionsForModal(projectId) {
  const leadSelect = document.getElementById('team-lead')
  if (!leadSelect) return
  leadSelect.innerHTML = '<option value="">— No lead —</option>'
  if (!projectId) return
  try {
    const res = await API.get(`/projects/${projectId}/developers`)
    const devs = res.developers || []
    leadSelect.innerHTML = `<option value="">— No lead —</option>${devs.map(d => `<option value="${d.user_id}">${escapeHtml(d.full_name)}</option>`).join('')}`
  } catch (e) {
    leadSelect.innerHTML = '<option value="">— No lead —</option>'
  }
}

async function openEditTeamModal(teamId) {
  try {
    const res = await API.get(`/project-teams/${teamId}`)
    const t = res.data
    pxModal({
      title: 'Edit Team',
      body: `
        <div class="form-group"><label class="form-label">Team name *</label><input id="team-name" class="form-input" value="${escapeHtml(t.name)}"/></div>
        <div class="form-group"><label class="form-label">Description</label><textarea id="team-desc" class="form-input" rows="2">${escapeHtml(t.description || '')}</textarea></div>
        <div class="form-group"><label class="form-label">Colour</label><input id="team-color" type="color" value="${t.color || '#6366f1'}" class="form-input" style="height:40px;padding:3px"/></div>
      `,
      confirmText: 'Save',
      onConfirm: async () => {
        const name = document.getElementById('team-name').value.trim()
        if (!name) { toast('Team name required', 'error'); return false }
        try {
          await API.put(`/project-teams/${teamId}`, {
            name,
            description: document.getElementById('team-desc').value.trim(),
            color: document.getElementById('team-color').value,
            team_lead_id: t.team_lead_id, // preserve existing; change via member management
          })
          toast('Team updated', 'success')
          reloadProjectTeamsSection(t.project_id)
          return true
        } catch (e) { toast('Failed: ' + e.message, 'error'); return false }
      }
    })
  } catch (e) { toast('Failed to load team: ' + e.message, 'error') }
}

async function confirmDeleteTeam(teamId, teamName) {
  if (!confirm(`Delete team "${teamName}"? Its members will remain on the project; this only removes the team grouping.`)) return
  try {
    const res = await API.get(`/project-teams/${teamId}`)
    const projectId = res.data.project_id
    await API.delete(`/project-teams/${teamId}`)
    toast('Team deleted', 'success')
    reloadProjectTeamsSection(projectId)
  } catch (e) { toast('Failed: ' + e.message, 'error') }
}

async function openManageMembersModal(teamId) {
  try {
    const [teamRes, _] = await Promise.all([API.get(`/project-teams/${teamId}`)])
    const t = teamRes.data
    const devsRes = await API.get(`/projects/${t.project_id}/developers`)
    const allDevs = devsRes.developers || []
    const memberIds = new Set((t.members || []).map(m => m.user_id))

    const memberRows = (t.members || []).map(m => `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.04);margin-bottom:6px">
        ${avatar(m.full_name, m.avatar_color || '#6366f1')}
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600">${escapeHtml(m.full_name)}</div>
          <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(m.designation || 'Developer')}</div>
        </div>
        <select onchange="updateMemberRole('${teamId}','${m.user_id}',this.value)" style="padding:4px 6px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px">
          <option value="member" ${m.role === 'member' ? 'selected' : ''}>Member</option>
          <option value="lead"   ${m.role === 'lead'   ? 'selected' : ''}>Lead</option>
          <option value="qa"     ${m.role === 'qa'     ? 'selected' : ''}>QA</option>
          <option value="designer" ${m.role === 'designer' ? 'selected' : ''}>Designer</option>
        </select>
        <button class="icon-btn" onclick="removeTeamMember('${teamId}','${m.user_id}')" title="Remove"><i class="fas fa-times" style="color:var(--danger)"></i></button>
      </div>
    `).join('')

    const addableDevs = allDevs.filter(d => !memberIds.has(d.user_id))

    pxModal({
      title: `Manage members — ${escapeHtml(t.name)}`,
      body: `
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">
          Only developers already assigned to this project can join a team. Assign more devs to the project first if needed.
        </div>
        <h4 style="font-size:13px;margin:0 0 8px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted)">Current members (${(t.members || []).length})</h4>
        ${memberRows || '<div style="font-size:12px;color:var(--text-muted);padding:8px">No members yet.</div>'}
        ${addableDevs.length ? `
          <h4 style="font-size:13px;margin:14px 0 8px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted)">Add developer</h4>
          <div style="display:flex;gap:8px">
            <select id="add-member-id" class="form-select" style="flex:1">
              ${addableDevs.map(d => `<option value="${d.user_id}">${escapeHtml(d.full_name)} — ${escapeHtml(d.designation || '')}</option>`).join('')}
            </select>
            <select id="add-member-role" class="form-select" style="width:110px">
              <option value="member">Member</option>
              <option value="lead">Lead</option>
              <option value="qa">QA</option>
              <option value="designer">Designer</option>
            </select>
            <button class="btn btn-primary btn-sm" onclick="addTeamMember('${teamId}')"><i class="fas fa-plus"></i></button>
          </div>
        ` : ''}
      `,
      confirmText: 'Done',
      onConfirm: async () => { reloadProjectTeamsSection(t.project_id); return true }
    })
  } catch (e) { toast('Failed to load: ' + e.message, 'error') }
}

async function addTeamMember(teamId) {
  const user_id = document.getElementById('add-member-id').value
  const role = document.getElementById('add-member-role').value
  if (!user_id) return
  try {
    await API.post(`/project-teams/${teamId}/members`, { user_id, role })
    toast('Member added', 'success')
    openManageMembersModal(teamId) // reopen with fresh data
  } catch (e) { toast('Failed: ' + e.message, 'error') }
}

async function updateMemberRole(teamId, userId, role) {
  try {
    await API.post(`/project-teams/${teamId}/members`, { user_id: userId, role })
    toast('Role updated', 'success')
  } catch (e) { toast('Failed: ' + e.message, 'error') }
}

async function removeTeamMember(teamId, userId) {
  if (!confirm('Remove this member from the team?')) return
  try {
    await API.delete(`/project-teams/${teamId}/members/${userId}`)
    toast('Member removed', 'success')
    openManageMembersModal(teamId)
  } catch (e) { toast('Failed: ' + e.message, 'error') }
}

function reloadProjectTeamsSection(projectId) {
  const el = document.getElementById('project-teams-section-' + projectId)
  if (el) renderProjectTeamsSection(projectId, el)
}

function goProjectTeamsPage(page) {
  _projectTeamsPage = Math.max(1, Number(page) || 1)
  const projectId = document.querySelector('[id^="project-teams-section-"]')?.id?.replace('project-teams-section-', '')
  if (projectId) reloadProjectTeamsSection(projectId)
}

// Open the project teams UI in a modal (used from the projects list)
function showProjectTeamsModal(projectId, projectName) {
  pxModal({
    title: `Teams — ${projectName}`,
    body: `<div id="project-teams-section-${projectId}" style="min-height:240px">
             <div style="padding:30px;text-align:center;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Loading…</div>
           </div>`,
    confirmText: 'Close',
    large: true,
    onConfirm: () => true,
  })
  const el = document.getElementById('project-teams-section-' + projectId)
  if (el) renderProjectTeamsSection(projectId, el)
}

// ─── KANBAN PERMISSION MATRIX ─────────────────────────────────

async function openKanbanPermissionsModal(projectId, projectName) {
  try {
    const res = await API.get(`/kanban-permissions/project/${projectId}`)
    const rows = res.data || []
    const byRole = {}
    for (const r of rows) byRole[r.role] = r
    const roles = ['admin', 'pm', 'developer', 'client']
    const perms = [
      { key: 'can_view',           label: 'View board' },
      { key: 'can_create_task',    label: 'Create tasks' },
      { key: 'can_edit_any_task',  label: 'Edit any task' },
      { key: 'can_edit_own_task',  label: 'Edit own tasks' },
      { key: 'can_move_task',      label: 'Move tasks' },
      { key: 'can_delete_task',    label: 'Delete tasks' },
      { key: 'can_manage_columns', label: 'Manage columns' },
      { key: 'can_comment',        label: 'Comment' },
    ]
    const defaults = {
      admin:     { can_view:1, can_create_task:1, can_edit_any_task:1, can_edit_own_task:1, can_move_task:1, can_delete_task:1, can_manage_columns:1, can_comment:1 },
      pm:        { can_view:1, can_create_task:1, can_edit_any_task:1, can_edit_own_task:1, can_move_task:1, can_delete_task:1, can_manage_columns:1, can_comment:1 },
      developer: { can_view:1, can_create_task:1, can_edit_any_task:0, can_edit_own_task:1, can_move_task:1, can_delete_task:0, can_manage_columns:0, can_comment:1 },
      client:    { can_view:1, can_create_task:0, can_edit_any_task:0, can_edit_own_task:0, can_move_task:0, can_delete_task:0, can_manage_columns:0, can_comment:1 },
    }
    const get = (role, key) => {
      const row = byRole[role]
      if (row) return row[key] ? 1 : 0
      return defaults[role][key]
    }

    const matrix = `
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="border-bottom:1px solid var(--border)">
            <th style="text-align:left;padding:8px 6px;font-weight:600">Permission</th>
            ${roles.map(r => `<th style="text-align:center;padding:8px 6px;text-transform:capitalize;font-weight:600">${r}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${perms.map(p => `
            <tr style="border-bottom:1px solid rgba(255,255,255,.05)">
              <td style="padding:10px 6px">${p.label}</td>
              ${roles.map(r => {
                const checked = get(r, p.key) ? 'checked' : ''
                const disabled = (r === 'admin' && (p.key === 'can_view' || p.key === 'can_create_task' || p.key === 'can_edit_any_task')) ? 'disabled' : ''
                return `<td style="text-align:center;padding:10px 6px"><input type="checkbox" data-role="${r}" data-perm="${p.key}" ${checked} ${disabled}/></td>`
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div style="font-size:11px;color:var(--text-muted);margin-top:10px;padding:8px;background:rgba(99,102,241,.08);border-radius:6px;border-left:3px solid var(--primary)">
        <strong>Note:</strong> "Edit own tasks" only applies to tasks where the user is the assignee. Admin keeps full access by default. Changes apply immediately on save.
      </div>
    `

    pxModal({
      title: `Kanban permissions — ${escapeHtml(projectName || '')}`,
      body: matrix,
      confirmText: 'Save permissions',
      large: true,
      onConfirm: async () => {
        const payload = []
        for (const role of roles) {
          const row = { role }
          for (const p of perms) {
            const cb = document.querySelector(`input[data-role="${role}"][data-perm="${p.key}"]`)
            row[p.key] = cb && cb.checked ? 1 : 0
          }
          payload.push(row)
        }
        try {
          await API.put(`/kanban-permissions/project/${projectId}`, { permissions: payload })
          toast('Permissions updated', 'success')
          return true
        } catch (e) { toast('Failed: ' + e.message, 'error'); return false }
      }
    })
  } catch (e) { toast('Failed to load permissions: ' + e.message, 'error') }
}

// ─── INVITES (PM/Admin) ───────────────────────────────────────

async function renderInvitesPanel(containerEl) {
  if (!['admin', 'pm'].includes(_user.role)) {
    containerEl.innerHTML = '<div style="color:var(--text-muted)">You do not have permission to manage invites.</div>'
    return
  }
  try {
    const res = await API.get('/invites')
    const invites = res.data || []
    const pagination = paginateClient(invites, _invitesPage, 10)
    _invitesPage = pagination.page
    containerEl.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div>
          <h2 style="font-size:17px;font-weight:700;margin:0">Pending Invites</h2>
          <p style="font-size:12px;color:var(--text-muted);margin:4px 0 0">${pagination.total} open invite${pagination.total === 1 ? '' : 's'}</p>
        </div>
        <button class="btn btn-primary" onclick="openInviteUserModal()"><i class="fas fa-paper-plane"></i> Invite User</button>
      </div>
      ${pagination.total === 0 ? `
        <div style="padding:24px;text-align:center;color:var(--text-muted);background:rgba(255,255,255,.02);border-radius:10px;border:1px dashed var(--border)">
          No pending invites. Invite developers or PMs to create their own accounts.
        </div>
      ` : `
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="border-bottom:1px solid var(--border);text-align:left">
            <th style="padding:8px">Name</th><th style="padding:8px">Email</th><th style="padding:8px">Role</th>
            <th style="padding:8px">Invited by</th><th style="padding:8px">Expires</th><th style="padding:8px">Actions</th>
          </tr></thead>
          <tbody>
            ${pagination.items.map(i => `
              <tr style="border-bottom:1px solid rgba(255,255,255,.05)">
                <td style="padding:10px 8px">${escapeHtml(i.full_name)}</td>
                <td style="padding:10px 8px;color:var(--text-muted)">${escapeHtml(i.email)}</td>
                <td style="padding:10px 8px"><span class="badge badge-todo">${i.role}</span></td>
                <td style="padding:10px 8px;color:var(--text-muted)">${escapeHtml(i.invited_by_name || '')}</td>
                <td style="padding:10px 8px;color:var(--text-muted)">${fmtDate(i.expires_at)}</td>
                <td style="padding:10px 8px">
                  <button class="btn btn-secondary btn-sm" onclick="copyInviteLink('${i.token}')"><i class="fas fa-link"></i> Copy link</button>
                  <button class="btn btn-sm" style="background:var(--danger);color:#fff" onclick="revokeInvite('${i.id}')"><i class="fas fa-times"></i></button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div style="margin-top:12px">${renderPager(pagination, 'goInvitesPage', 'goInvitesPage', 'invites')}</div>
      `}
    `
  } catch (e) {
    containerEl.innerHTML = `<div style="color:var(--danger);padding:16px">Failed to load invites: ${e.message}</div>`
  }
}

function goInvitesPage(page) {
  _invitesPage = Math.max(1, Number(page) || 1)
  const el = document.getElementById('invites-panel-container')
  if (el) renderInvitesPanel(el)
}

function openInviteUserModal() {
  pxModal({
    title: 'Invite a new user',
    body: `
      <div class="form-group"><label class="form-label">Full name *</label><input id="inv-name" class="form-input" placeholder="Jane Smith" autofocus/></div>
      <div class="form-group"><label class="form-label">Email *</label><input id="inv-email" type="email" class="form-input" placeholder="jane@company.com"/></div>
      <div class="form-group"><label class="form-label">Role *</label>
        <select id="inv-role" class="form-select">
          <option value="developer">Developer</option>
          <option value="team">Team Member</option>
          ${_user.role === 'admin' ? '<option value="pm">Project Manager</option><option value="pc">Project Coordinator</option>' : ''}
        </select>
      </div>
      <div style="font-size:11px;color:var(--text-muted);padding:8px;background:rgba(99,102,241,.08);border-radius:6px;border-left:3px solid var(--primary)">
        After you create this invite, you'll get a link to share with the user. They'll set their own password on first use.
      </div>
    `,
    confirmText: 'Send Invite',
    onConfirm: async () => {
      const full_name = document.getElementById('inv-name').value.trim()
      const email     = document.getElementById('inv-email').value.trim()
      const role      = document.getElementById('inv-role').value
      if (!full_name || !email) { toast('Name and email required', 'error'); return false }
      try {
        const res = await API.post('/invites', { full_name, email, role })
        const link = location.origin + res.data.invite_url
        // Copy to clipboard
        try { await navigator.clipboard.writeText(link) } catch(e) {}
        toast('Invite created — link copied to clipboard', 'success', 5000)
        pxModal({
          title: 'Invite link ready',
          body: `
            <p style="font-size:13px">Share this link with <strong>${escapeHtml(full_name)}</strong>:</p>
            <div style="padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-family:monospace;font-size:12px;word-break:break-all;user-select:all">${escapeHtml(link)}</div>
            <p style="font-size:11px;color:var(--text-muted);margin-top:10px">Link expires in 7 days. The user sets their own password when accepting.</p>
          `,
          confirmText: 'Done',
          onConfirm: () => {
            const el = document.getElementById('page-settings-view')
            if (el) { el.dataset.loaded = ''; if (el.classList.contains('active')) loadPage('settings-view', el) }
            return true
          }
        })
        return true
      } catch (e) { toast('Failed: ' + e.message, 'error'); return false }
    }
  })
}

async function copyInviteLink(token) {
  const link = location.origin + '/accept-invite?token=' + token
  try { await navigator.clipboard.writeText(link); toast('Link copied', 'success') }
  catch (e) { prompt('Copy this link:', link) }
}

async function revokeInvite(id) {
  if (!confirm('Revoke this invite? The link will stop working immediately.')) return
  try {
    await API.delete(`/invites/${id}`)
    toast('Invite revoked', 'success')
    const el = document.getElementById('invites-panel-container')
    if (el) renderInvitesPanel(el)
  } catch (e) { toast('Failed: ' + e.message, 'error') }
}

// ─── ACCEPT INVITE PAGE (public, no auth) ─────────────────────

async function renderAcceptInvitePage() {
  const token = new URLSearchParams(location.search).get('token')
  const app = document.getElementById('app')
  if (!token) {
    app.innerHTML = '<div style="padding:40px;text-align:center">Invalid invite link.</div>'
    return
  }
  app.innerHTML = `
    <div id="login-page">
      <div class="login-card">
        <div class="login-logo">
          <div style="width:52px;height:52px;background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.3);border-radius:14px;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:22px">🚀</div>
          <h1>DevPortal</h1>
          <p>Accept your invite</p>
        </div>
        <div id="invite-body"><div style="padding:20px;text-align:center;color:var(--text-muted)"><i class="fas fa-spinner fa-spin"></i> Validating invite…</div></div>
      </div>
    </div>
  `
  try {
    const res = await fetch('/api/invites/validate/' + encodeURIComponent(token))
    const data = await res.json()
    const body = document.getElementById('invite-body')
    if (!data.valid) {
      body.innerHTML = `
        <div style="padding:16px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:8px;color:#fca5a5;font-size:13px">
          <i class="fas fa-exclamation-circle"></i> ${escapeHtml(data.error || 'This invite is invalid.')}
        </div>
        <a href="/" class="btn btn-secondary w-full" style="margin-top:14px;text-decoration:none;text-align:center">Back to login</a>
      `
      return
    }
    const { email, full_name, role } = data.data
    body.innerHTML = `
      <form onsubmit="submitAcceptInvite('${token}');return false" autocomplete="off">
        <div style="padding:12px;background:rgba(16,185,129,.08);border-left:3px solid var(--success);border-radius:6px;margin-bottom:14px;font-size:13px">
          Welcome, <strong>${escapeHtml(full_name)}</strong>!<br/>
          <span style="color:var(--text-muted);font-size:12px">You've been invited as a <strong>${role}</strong> to ${escapeHtml(email)}.</span>
        </div>
        <div class="form-group">
          <label class="form-label">Create your password</label>
          <input id="new-password" type="password" class="form-input" placeholder="At least 8 characters" minlength="8" required autocomplete="new-password"/>
        </div>
        <div class="form-group">
          <label class="form-label">Confirm password</label>
          <input id="confirm-password" type="password" class="form-input" minlength="8" required autocomplete="new-password"/>
        </div>
        <button type="submit" class="btn btn-primary w-full"><i class="fas fa-check"></i> Create account</button>
      </form>
    `
  } catch (e) {
    document.getElementById('invite-body').innerHTML = `<div style="color:var(--danger)">Failed to validate invite: ${e.message}</div>`
  }
}

async function submitAcceptInvite(token) {
  const pw = document.getElementById('new-password').value
  const cf = document.getElementById('confirm-password').value
  if (pw !== cf) { toast('Passwords do not match', 'error'); return }
  if (pw.length < 8) { toast('Password must be at least 8 characters', 'error'); return }
  try {
    const res = await fetch('/api/invites/accept/' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to accept invite')
    toast('Account created! Redirecting to login…', 'success')
    setTimeout(() => { location.href = '/' }, 1200)
  } catch (e) { toast(e.message, 'error') }
}

// ─── UTILITIES (reused from app.js) ──────────────────────────

function escapeHtml(s) {
  if (s == null) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

// Generic object-style modal helper (our own, avoids clashing with app.js's showModal(html, size))
function pxModal({ title, body, confirmText = 'Confirm', cancelText = 'Cancel', onConfirm, large = false }) {
  const root = document.getElementById('modal-root') || document.body
  const wrapper = document.createElement('div')
  wrapper.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)'
  wrapper.innerHTML = `
    <div style="background:var(--bg-elevated,#1e293b);border:1px solid var(--border,#334155);border-radius:14px;padding:20px;width:100%;max-width:${large ? '720px' : '480px'};max-height:90vh;overflow:auto;color:var(--text,#e2e8f0)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <h3 style="margin:0;font-size:16px;font-weight:700">${escapeHtml(title)}</h3>
        <button onclick="this.closest('[data-px-modal]').remove()" style="background:none;border:none;color:var(--text-muted,#64748b);cursor:pointer;font-size:20px;line-height:1">×</button>
      </div>
      <div>${body}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;padding-top:14px;border-top:1px solid var(--border,#334155)">
        <button class="btn btn-secondary" data-action="cancel">${escapeHtml(cancelText)}</button>
        <button class="btn btn-primary"   data-action="confirm">${escapeHtml(confirmText)}</button>
      </div>
    </div>
  `
  wrapper.setAttribute('data-px-modal', '1')
  root.appendChild(wrapper)
  wrapper.querySelector('[data-action="cancel"]').onclick  = () => wrapper.remove()
  wrapper.querySelector('[data-action="confirm"]').onclick = async () => {
    const ok = onConfirm ? await onConfirm() : true
    if (ok !== false) wrapper.remove()
  }
}

// ─── ROUTER HOOK: detect /accept-invite on page load ─────────
(function () {
  if (location.pathname === '/accept-invite') {
    // Wait a tick so app.js has loaded
    document.addEventListener('DOMContentLoaded', renderAcceptInvitePage)
    // If DOMContentLoaded already fired:
    if (document.readyState !== 'loading') setTimeout(renderAcceptInvitePage, 0)
  }
})()
