
// ============ DEVELOPERS PAGE ============
router.register('developers', async () => {
  try {
    const res = await API.get('/users?role=developer')
    const devs = res.users || res.data || []
    document.getElementById('page-content').innerHTML = `
      <div class="animate-fade-in">
        <div class="page-header" style="display:flex;justify-content:space-between;align-items:center">
          <div><h1 class="page-title">Developers</h1><p class="page-subtitle">${devs.length} team members</p></div>
          ${state.user?.role === 'admin' ? '<button class="btn btn-primary" onclick="openAddDeveloperModal()"><i class="fas fa-user-plus"></i> Add User</button>' : ''}
        </div>
        <div style="display:flex;gap:10px;margin-bottom:16px">
          <input type="text" id="dev-search" class="form-input" style="max-width:280px" placeholder="Search developers..." oninput="filterDevTable()"/>
          <select class="form-select" id="dev-status-filter" style="max-width:160px" onchange="filterDevTable()">
            <option value="">All Status</option><option value="1">Active</option><option value="0">Inactive</option>
          </select>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px" id="dev-grid">
          ${devs.map(d => renderDevCard(d)).join('')}
        </div>
      </div>
    `
  } catch (e) { document.getElementById('page-content').innerHTML = `<div style="color:var(--danger);padding:20px">Error: ${e.message}</div>` }
})

function renderDevCard(d) {
  const consumed = parseFloat(d.monthly_consumed || 0)
  const capacity = parseFloat(d.monthly_available_hours || 160)
  const pct = Math.round((consumed / capacity) * 100)
  const color = pct >= 100 ? '#FF5E3A' : pct >= 70 ? '#58C68A' : pct >= 50 ? '#FFCB47' : '#94a3b8'
  const techStack = d.tech_stack ? (typeof d.tech_stack === 'string' ? JSON.parse(d.tech_stack) : d.tech_stack) : []
  return `
    <div class="glass-card" style="padding:20px;cursor:pointer" onclick="router.navigate('developer-detail',{id:'${d.id}'})" id="dev-card-${d.id}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:12px">
          <div class="avatar avatar-lg" style="background:${d.avatar_color}">${utils.getInitials(d.full_name)}</div>
          <div>
            <div style="font-size:15px;font-weight:700">${d.full_name}</div>
            <div style="font-size:12px;color:var(--text-muted)">${d.designation || 'Developer'}</div>
            <div style="margin-top:4px">${d.is_active ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-gray">Inactive</span>'}</div>
          </div>
        </div>
        <div style="text-align:center">
          <div style="font-size:20px;font-weight:800;color:${color}">${pct}%</div>
          <div style="font-size:10px;color:var(--text-muted)">Utilized</div>
        </div>
      </div>
      <div style="margin-bottom:12px">
        ${utils.progressBar(pct, pct >= 100 ? 'red' : pct >= 70 ? 'green' : 'yellow')}
        <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:11px;color:var(--text-muted)">
          <span>${utils.formatHours(consumed)} logged</span>
          <span>${utils.formatHours(capacity)} capacity</span>
        </div>
      </div>
      <div style="display:flex;gap:16px;padding:10px;background:rgba(255,255,255,0.03);border-radius:8px;margin-bottom:12px">
        <div style="text-align:center;flex:1"><div style="font-size:16px;font-weight:700;color:var(--accent)">${d.project_count || 0}</div><div style="font-size:10px;color:var(--text-muted)">Projects</div></div>
        <div style="text-align:center;flex:1"><div style="font-size:16px;font-weight:700;color:var(--success)">${utils.formatHours(d.total_allocated)}</div><div style="font-size:10px;color:var(--text-muted)">Allocated</div></div>
        <div style="text-align:center;flex:1"><div style="font-size:16px;font-weight:700">${utils.formatHours(Math.max(0, parseFloat(d.total_allocated||0) - parseFloat(d.monthly_consumed||0)))}</div><div style="font-size:10px;color:var(--text-muted)">Idle</div></div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px">
        ${techStack.slice(0,4).map(t => `<span class="tag">${t}</span>`).join('')}
        ${techStack.length > 4 ? `<span class="tag">+${techStack.length-4}</span>` : ''}
      </div>
      <div style="display:flex;gap:8px" onclick="event.stopPropagation()">
        <button class="btn btn-secondary btn-sm" onclick="router.navigate('developer-detail',{id:'${d.id}'})"><i class="fas fa-eye"></i> View</button>
        ${['admin','pm'].includes(state.user?.role) ? `
          <button class="btn btn-secondary btn-sm" onclick="openEditDeveloperModal('${d.id}')"><i class="fas fa-edit"></i> Edit</button>
          <button class="btn btn-sm ${d.is_active ? 'btn-danger' : 'btn-success'}" onclick="toggleDevStatus('${d.id}',${!d.is_active})">
            <i class="fas fa-${d.is_active ? 'ban' : 'check'}"></i> ${d.is_active ? 'Deactivate' : 'Activate'}
          </button>
        ` : ''}
      </div>
    </div>
  `
}

function filterDevTable() {
  const search = document.getElementById('dev-search')?.value.toLowerCase() || ''
  const status = document.getElementById('dev-status-filter')?.value
  document.querySelectorAll('[id^="dev-card-"]').forEach(card => {
    const name = card.querySelector('.avatar-lg + div div')?.textContent?.toLowerCase() || ''
    const isActive = card.innerHTML.includes('Active') && !card.innerHTML.includes('Inactive')
    let show = name.includes(search)
    if (status !== '') show = show && (status === '1' ? isActive : !isActive)
    card.parentElement.style.display = show ? '' : 'none'
  })
}

async function toggleDevStatus(id, active) {
  try {
    await API.patch(`/users/${id}/status`, { is_active: active })
    utils.toast(`Developer ${active ? 'activated' : 'deactivated'}`, 'success')
    router.navigate('developers')
  } catch (e) { utils.toast('Failed: ' + e.message, 'error') }
}

function openAddDeveloperModal() { openDeveloperModal() }
async function openEditDeveloperModal(id) {
  const res = await API.get(`/users/${id}`)
  openDeveloperModal(res.data)
}

async function openDeveloperModal(dev = null) {
  // Always-on options — these wire into hierarchy logic on the backend
  // (manager_id / tl_id validation), so they must appear regardless of
  // what /settings/roles returns.
  const HIERARCHY_OPTIONS = [
    ['sales_manager', 'Sales Manager'],
    ['sales_tl',      'Sales TL'],
    ['sales_agent',   'Sales Agent'],
  ]
  const isCurrentAdmin = (typeof _user !== 'undefined' && _user?.role === 'admin')
  let roleOptions = [
    ...(isCurrentAdmin ? [['admin', 'Admin']] : []),
    ['developer', 'Developer'],
    ['pm', 'PM'],
    ['pc', 'PC'],
    ['team', 'Team'],
    ['hr', 'HR'],
    ...HIERARCHY_OPTIONS,
  ]
  try {
    const res = await API.get('/settings/roles')
    const roles = (res.roles || res.data || []).filter(r => r.key !== 'client' && (isCurrentAdmin || r.key !== 'admin'))
    if (roles.length) {
      const merged = roles.map(r => [r.key, r.name || r.key])
      // Append any hierarchy options the API didn't include — otherwise the
      // dropdown loses them entirely once roles are seeded.
      for (const opt of HIERARCHY_OPTIONS) {
        if (!merged.some(([k]) => k === opt[0])) merged.push(opt)
      }
      if (isCurrentAdmin && !merged.some(([k]) => k === 'admin')) {
        merged.unshift(['admin', 'Admin'])
      }
      roleOptions = merged
    }
  } catch {}
  // Always pull manager/TL pickers up-front — the dropdowns are tiny (active
  // sales staff only) and we want them ready when the user toggles role.
  let salesManagers = []
  let salesTls = []
  try {
    const [mgrs, tls] = await Promise.all([
      API.get('/users/sales-managers').catch(() => ({ users: [] })),
      API.get('/users/sales-tls').catch(() => ({ users: [] })),
    ])
    salesManagers = mgrs.users || mgrs.data || []
    salesTls = tls.users || tls.data || []
  } catch {}
  const isEdit = !!(dev && dev.id)
  const selectedRole = dev?.role || 'developer'
  const tech = dev?.tech_stack ? (typeof dev.tech_stack === 'string' ? (() => { try { return JSON.parse(dev.tech_stack) } catch { return [] } })() : dev.tech_stack) : []
  const skills = dev?.skill_tags ? (typeof dev.skill_tags === 'string' ? (() => { try { return JSON.parse(dev.skill_tags) } catch { return [] } })() : dev.skill_tags) : []

  const html = `
    <div class="modal-header">
      <h3><i class="fas fa-user-plus" style="color:var(--primary-light);margin-right:8px"></i>${isEdit ? 'Edit' : 'Add'} User</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <form autocomplete="off" onsubmit="event.preventDefault();return false">
      <input type="text" name="prevent_autofill" autocomplete="off" style="display:none"/>
      <input type="password" name="prevent_autofill_pwd" autocomplete="off" style="display:none"/>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Full Name *</label><input id="dev-name" class="form-input" value="${dev?.full_name||''}" placeholder="Full Name" autocomplete="off"/></div>
        <div class="form-group"><label class="form-label">Email *</label><input id="dev-email" class="form-input" type="email" value="${dev?.email||''}" placeholder="Email" autocomplete="off"/></div>
        <div class="form-group"><label class="form-label">Phone</label><input id="dev-phone" class="form-input" value="${dev?.phone||''}" placeholder="Phone Number" autocomplete="off"/></div>
        <div class="form-group"><label class="form-label">Designation</label><input id="dev-designation" class="form-input" value="${dev?.designation||''}" placeholder="Designation" autocomplete="off"/></div>
        <div class="form-group"><label class="form-label">Role</label>
          <select id="dev-role" class="form-select" onchange="onDevRoleChange(this.value)">
            ${roleOptions.map(([value, label]) => `<option value="${value}" ${selectedRole === value ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label class="form-label">Joining Date</label><input id="dev-joining" class="form-input" type="date" value="${dev?.joining_date||''}" onclick="this.showPicker && this.showPicker()" style="cursor:pointer"/></div>
        <div class="form-group"><label class="form-label">Daily Work Hours</label><input id="dev-daily-hours" class="form-input" type="number" value="${dev?.daily_work_hours||8}" min="1" max="12"/></div>
        <div class="form-group"><label class="form-label">Monthly Available Hours</label><input id="dev-monthly-hours" class="form-input" type="number" value="${dev?.monthly_available_hours||160}"/></div>
        <div class="form-group"><label class="form-label">Hourly Cost (₹)</label><input id="dev-hourly-cost" class="form-input" type="number" value="${dev?.hourly_cost||0}"/></div>
        <div class="form-group"><label class="form-label">Avatar Color</label><input id="dev-color" class="form-input" type="color" value="${dev?.avatar_color||'#FF7A45'}" style="height:40px;cursor:pointer;padding:4px"/></div>
      </div>
      <div id="dev-sales-hierarchy-wrap" style="display:${['sales_tl','sales_agent'].includes(selectedRole) ? '' : 'none'}">
        <div class="grid-2">
          <div id="dev-manager-wrap" class="form-group" style="display:${['sales_tl','sales_agent'].includes(selectedRole) ? '' : 'none'}">
            <label class="form-label">Manager *</label>
            <select id="dev-manager-id" class="form-select" onchange="onDevManagerChange()">
              <option value="">— Select Manager —</option>
              ${salesManagers.map(m => `<option value="${m.id}" ${String(dev?.manager_id||'')===String(m.id) ? 'selected' : ''}>${(m.full_name || m.email || '').replace(/</g,'&lt;')}</option>`).join('')}
            </select>
            ${salesManagers.length === 0 ? '<div class="form-hint" style="font-size:11px;color:#FF7A45;margin-top:4px">No active Sales Manager — create one first.</div>' : ''}
          </div>
          <div id="dev-tl-wrap" class="form-group" style="display:${selectedRole === 'sales_agent' ? '' : 'none'}">
            <label class="form-label">Team Lead *</label>
            <select id="dev-tl-id" class="form-select" ${dev?.manager_id ? '' : 'disabled'}>
              <option value="">${dev?.manager_id ? '— Select TL —' : '— Select Manager first —'}</option>
              ${salesTls.map(t => {
                const tlMgr = String(t.manager_id || '')
                const selMgr = String(dev?.manager_id || '')
                const hidden = selMgr && tlMgr !== selMgr ? 'hidden' : ''
                return `<option value="${t.id}" data-manager="${tlMgr}" ${hidden} ${String(dev?.tl_id||'')===String(t.id) ? 'selected' : ''}>${(t.full_name || t.email || '').replace(/</g,'&lt;')}</option>`
              }).join('')}
            </select>
            ${salesTls.length === 0 ? '<div class="form-hint" style="font-size:11px;color:#FF7A45;margin-top:4px">No active Sales TL — create one first.</div>' : ''}
          </div>
        </div>
      </div>
      <div id="dev-sales-incentive-wrap" style="display:${['sales_manager','sales_tl','sales_agent'].includes(selectedRole) ? '' : 'none'}">
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Monthly Revenue Target (₹)</label>
            <input id="dev-monthly-target" class="form-input" type="text" inputmode="decimal" value="${dev?.monthly_target ?? 0}" placeholder="e.g. 500000"/>
            <div class="form-hint" style="font-size:11px;color:#94a3b8;margin-top:4px">Sales target per month in rupees. Achieved is auto-summed from project revenue (lead → close → project).</div>
          </div>
          <div class="form-group">
            <label class="form-label">Incentive Rate (₹ paid per ₹ above target)</label>
            <input id="dev-incentive-rate" class="form-input" type="text" inputmode="decimal" value="${dev?.incentive_rate ?? 0}" placeholder="e.g. 0.10"/>
            <div class="form-hint" style="font-size:11px;color:#94a3b8;margin-top:4px">e.g. 0.10 = 10% commission on revenue above target. Earned = max(0, achieved − target) × rate.</div>
          </div>
        </div>
      </div>
      <div id="dev-tech-skills-wrap" style="display:${['sales_agent','sales_tl','sales_manager'].includes(selectedRole) ? 'none' : ''}">
        <div class="form-group"><label class="form-label">Tech Stack (comma separated)</label>
          <input id="dev-tech" class="form-input" value="${Array.isArray(tech) ? tech.join(', ') : ''}" placeholder="Tech Stack" autocomplete="off"/></div>
        <div class="form-group"><label class="form-label">Skill Tags (comma separated)</label>
          <input id="dev-skills" class="form-input" value="${Array.isArray(skills) ? skills.join(', ') : ''}" placeholder="Skill Tags" autocomplete="off"/></div>
      </div>
      <div class="form-group"><label class="form-label">Remarks</label>
        <textarea id="dev-remarks" class="form-textarea" rows="2" placeholder="Remarks">${dev?.remarks||''}</textarea></div>
      ${!isEdit ? `<div class="form-group"><label class="form-label">Password *</label>
        <div style="position:relative">
          <input id="dev-password" class="form-input" type="password" placeholder="Enter Your Password" autocomplete="new-password" style="padding-right:40px"/>
          <button type="button" id="dev-password-toggle" onclick="toggleDevPasswordVisibility()" aria-label="Show password" style="position:absolute;top:50%;right:8px;transform:translateY(-50%);background:transparent;border:none;color:#94a3b8;cursor:pointer;padding:6px;display:flex;align-items:center;justify-content:center"><i class="fas fa-eye"></i></button>
        </div>
      </div>` : ''}
      </form>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveDeveloper('${dev?.id||''}')"><i class="fas fa-save"></i> ${isEdit ? 'Update' : 'Create'} User</button>
    </div>
  `
  if (typeof showModal === 'function') {
    showModal(html, 'modal-lg')
  } else {
    const modal = document.createElement('div')
    modal.className = 'modal-overlay'
    modal.id = 'dev-modal'
    modal.innerHTML = `<div class="modal modal-lg">${html}</div>`
    document.body.appendChild(modal)
  }
}

function toggleDevPasswordVisibility() {
  const input = document.getElementById('dev-password')
  const btn = document.getElementById('dev-password-toggle')
  if (!input || !btn) return
  const isHidden = input.type === 'password'
  input.type = isHidden ? 'text' : 'password'
  btn.innerHTML = `<i class="fas ${isHidden ? 'fa-eye-slash' : 'fa-eye'}"></i>`
  btn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password')
}

function onDevRoleChange(role) {
  const techWrap = document.getElementById('dev-tech-skills-wrap')
  if (techWrap) techWrap.style.display = ['sales_agent','sales_tl','sales_manager'].includes(role) ? 'none' : ''
  const incWrap = document.getElementById('dev-sales-incentive-wrap')
  if (incWrap) incWrap.style.display = ['sales_manager','sales_tl','sales_agent'].includes(role) ? '' : 'none'
  const hierWrap = document.getElementById('dev-sales-hierarchy-wrap')
  const mgrWrap = document.getElementById('dev-manager-wrap')
  const tlWrap = document.getElementById('dev-tl-wrap')
  const mgrSel = document.getElementById('dev-manager-id')
  if (hierWrap) hierWrap.style.display = ['sales_tl','sales_agent'].includes(role) ? '' : 'none'
  if (mgrWrap) mgrWrap.style.display = ['sales_tl','sales_agent'].includes(role) ? '' : 'none'
  if (tlWrap) tlWrap.style.display = role === 'sales_agent' ? '' : 'none'
  if (mgrSel) mgrSel.disabled = false
  if (role === 'sales_agent') onDevManagerChange()
}

// Sales agent flow: pick Manager first, then the TL dropdown is filtered to
// only TLs under that Manager. The backend still derives manager_id from the
// chosen TL, so this just narrows the UI to a valid sub-set.
function onDevManagerChange() {
  const mgrSel = document.getElementById('dev-manager-id')
  const tlSel = document.getElementById('dev-tl-id')
  if (!tlSel) return
  const mgrId = mgrSel?.value || ''
  let visibleCount = 0
  Array.from(tlSel.options).forEach(opt => {
    if (!opt.value) {
      opt.textContent = mgrId ? '— Select TL —' : '— Select Manager first —'
      opt.hidden = false
      return
    }
    const tlMgr = opt.getAttribute('data-manager') || ''
    const matches = !!mgrId && tlMgr === mgrId
    opt.hidden = !matches
    if (matches) visibleCount++
  })
  // Reset selection if the currently picked TL no longer belongs to the chosen manager.
  const currentOpt = tlSel.selectedOptions[0]
  if (currentOpt && currentOpt.hidden) tlSel.value = ''
  if (!mgrId) tlSel.value = ''
  tlSel.disabled = !mgrId || visibleCount === 0
}

async function saveDeveloper(id) {
  try {
    const role = document.getElementById('dev-role').value
    const isSalesNoTech = ['sales_agent','sales_tl','sales_manager'].includes(role)
    const techEl = document.getElementById('dev-tech')
    const skillsEl = document.getElementById('dev-skills')
    const tech = isSalesNoTech || !techEl ? [] : techEl.value.split(',').map(t=>t.trim()).filter(Boolean)
    const skills = isSalesNoTech || !skillsEl ? [] : skillsEl.value.split(',').map(t=>t.trim()).filter(Boolean)
    const payload = {
      full_name: document.getElementById('dev-name').value,
      email: document.getElementById('dev-email').value,
      phone: document.getElementById('dev-phone').value,
      designation: document.getElementById('dev-designation').value,
      role,
      joining_date: document.getElementById('dev-joining').value,
      daily_work_hours: parseFloat(document.getElementById('dev-daily-hours').value),
      monthly_available_hours: parseFloat(document.getElementById('dev-monthly-hours').value),
      hourly_cost: parseFloat(document.getElementById('dev-hourly-cost').value),
      avatar_color: document.getElementById('dev-color').value,
      tech_stack: tech, skill_tags: skills,
      remarks: document.getElementById('dev-remarks').value,
    }
    if (role === 'sales_tl') {
      const mgr = document.getElementById('dev-manager-id')?.value
      if (!mgr) { utils.toast('Manager is required for a Sales TL', 'error'); return }
      payload.manager_id = mgr
    }
    if (role === 'sales_agent') {
      const tl = document.getElementById('dev-tl-id')?.value
      if (!tl) { utils.toast('Team Lead is required for a Sales Agent', 'error'); return }
      payload.tl_id = tl
    }
    if (['sales_manager','sales_tl','sales_agent'].includes(role)) {
      const t = document.getElementById('dev-monthly-target')?.value
      const r = document.getElementById('dev-incentive-rate')?.value
      payload.monthly_target = Number(t) || 0
      payload.incentive_rate = Number(r) || 0
    }
    if (!id && document.getElementById('dev-password')) payload.password = document.getElementById('dev-password').value
    let res
    if (id) res = await API.put(`/users/${id}`, payload)
    else res = await API.post('/users', payload)
    if (id) {
      utils.toast('User updated successfully!', 'success')
    } else {
      const mailSent = res?.mail?.sent
      const mailError = res?.mail?.error
      if (mailSent) utils.toast('User created — credentials emailed', 'success')
      else if (mailError) utils.toast(`User created, but email failed: ${mailError}`, 'error')
      else utils.toast('User created successfully!', 'success')
    }
    if (typeof closeModal === 'function') closeModal()
    document.getElementById('dev-modal')?.remove()
    router.navigate('developers')
    const teamEl = document.getElementById('page-team-overview')
    if (teamEl && typeof loadPage === 'function') { teamEl.dataset.loaded = ''; loadPage('team-overview', teamEl) }
  } catch (e) { utils.toast('Failed: ' + (e.response?.data?.error || e.message), 'error') }
}

// ============ DEVELOPER DETAIL ============
router.register('developer-detail', async ({ id }) => {
  if (!id) { router.navigate('developers'); return }
  try {
    const [userRes, utilRes] = await Promise.all([
      API.get(`/users/${id}`),
      API.get(`/users/${id}/utilization`)
    ])
    const d = userRes.data.data
    const util = utilRes.data.data
    const techStack = d.tech_stack ? (typeof d.tech_stack==='string'?JSON.parse(d.tech_stack):d.tech_stack) : []
    const skills = d.skill_tags ? (typeof d.skill_tags==='string'?JSON.parse(d.skill_tags):d.skill_tags) : []

    document.getElementById('page-content').innerHTML = `
      <div class="animate-fade-in">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
          <button class="btn btn-secondary btn-sm" onclick="router.navigate('developers')"><i class="fas fa-arrow-left"></i> Back</button>
          <h1 class="page-title">Developer Profile</h1>
        </div>
        <div style="display:grid;grid-template-columns:340px 1fr;gap:16px">
          <!-- Profile Card -->
          <div>
            <div class="glass-card" style="padding:24px;margin-bottom:16px">
              <div style="text-align:center;margin-bottom:20px">
                <div class="avatar avatar-xl" style="background:${d.avatar_color};margin:0 auto 12px">${utils.getInitials(d.full_name)}</div>
                <div style="font-size:20px;font-weight:800">${d.full_name}</div>
                <div style="font-size:13px;color:var(--text-muted);margin:4px 0">${d.designation || 'Developer'}</div>
                <div style="margin:8px 0">${d.is_active ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-gray">Inactive</span>'}</div>
              </div>
              <div style="display:flex;flex-direction:column;gap:10px">
                ${d.email ? `<div style="display:flex;align-items:center;gap:10px;font-size:13px"><i class="fas fa-envelope" style="color:var(--text-muted);width:16px"></i><span>${d.email}</span></div>` : ''}
                ${d.phone ? `<div style="display:flex;align-items:center;gap:10px;font-size:13px"><i class="fas fa-phone" style="color:var(--text-muted);width:16px"></i><span>${d.phone}</span></div>` : ''}
                ${d.joining_date ? `<div style="display:flex;align-items:center;gap:10px;font-size:13px"><i class="fas fa-calendar" style="color:var(--text-muted);width:16px"></i><span>Joined ${utils.formatDate(d.joining_date)}</span></div>` : ''}
                ${d.pm_name ? `<div style="display:flex;align-items:center;gap:10px;font-size:13px"><i class="fas fa-user-tie" style="color:var(--text-muted);width:16px"></i><span>Reports to ${d.pm_name}</span></div>` : ''}
                ${d.hourly_cost ? `<div style="display:flex;align-items:center;gap:10px;font-size:13px"><i class="fas fa-rupee-sign" style="color:var(--text-muted);width:16px"></i><span>₹${d.hourly_cost}/hour</span></div>` : ''}
              </div>
              <div style="margin-top:16px">
                <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px">Tech Stack</div>
                <div>${techStack.map(t=>`<span class="tag">${t}</span>`).join('')}</div>
              </div>
              ${skills.length > 0 ? `<div style="margin-top:12px"><div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px">Skills</div><div>${skills.map(s=>`<span class="badge badge-blue" style="margin:2px">${s}</span>`).join('')}</div></div>` : ''}
              <div style="margin-top:16px;display:flex;gap:8px">
                <button class="btn btn-primary btn-sm" style="flex:1" onclick="openEditDeveloperModal('${d.id}')"><i class="fas fa-edit"></i> Edit</button>
                <button class="btn btn-secondary btn-sm" onclick="router.navigate('timesheet',{user_id:'${d.id}'})"><i class="fas fa-clock"></i> Log</button>
              </div>
            </div>
            <!-- Capacity Card -->
            <div class="glass-card" style="padding:20px">
              <h3 style="font-size:13px;font-weight:700;margin-bottom:14px">Monthly Capacity</h3>
              ${[
                ['Working Days', util?.working_days + ' days'],
                ['Leave Days', util?.leave_days + ' days'],
                ['Holidays', util?.holiday_count + ' days'],
                ['Effective Days', `<strong style="color:var(--primary-light)">${util?.effective_days} days</strong>`],
                ['Capacity Hours', `<strong style="color:var(--success)">${utils.formatHours(util?.capacity_hours)}</strong>`],
                ['Logged Hours', `<strong>${utils.formatHours(util?.logged_hours)}</strong>`],
                ['Remaining', `<strong style="color:var(--accent)">${utils.formatHours(util?.remaining_hours)}</strong>`],
                ['Idle (Unallocated)', `<strong style="color:var(--warning)">${utils.formatHours(util?.idle_hours)}</strong>`],
              ].map(([l,v])=>`<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(45,45,107,0.5);font-size:13px"><span style="color:var(--text-muted)">${l}</span><span>${v}</span></div>`).join('')}
              <div style="margin-top:14px">${utils.utilizationBadge(util?.utilization_percent || 0)}</div>
            </div>
          </div>
          <!-- Right Column -->
          <div>
            <!-- Stats -->
            <div class="grid-3" style="margin-bottom:16px">
              ${statCard('Assigned Projects', d.assignments?.length || 0, 'fa-folder', 'blue', 'Active assignments', '')}
              ${statCard('Total Logged', utils.formatHours(d.total_consumed), 'fa-clock', 'green', 'All time hours', '')}
              ${statCard('Productivity', Math.round((util?.logged_hours||0) / (util?.capacity_hours||1) * 100) + '%', 'fa-tachometer-alt', util?.utilization_percent >= 100 ? 'red' : 'purple', 'This month', '')}
            </div>
            <!-- Project Distribution Chart -->
            <div class="glass-card" style="padding:20px;margin-bottom:16px">
              <h3 style="font-size:14px;font-weight:700;margin-bottom:16px">Work Distribution by Project</h3>
              <div style="display:flex;align-items:center;gap:24px">
                <div style="width:180px;height:180px;flex-shrink:0"><canvas id="devDistChart"></canvas></div>
                <div style="flex:1">
                  ${(d.assignments || []).map((a,i) => {
                    const pct = a.allocated_hours > 0 ? Math.round((a.logged_hours/a.allocated_hours)*100) : 0
                    return `<div style="margin-bottom:10px">
                      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                        <span style="font-size:13px;font-weight:600">${a.project_name}</span>
                        <span style="font-size:12px;color:var(--text-muted)">${utils.formatHours(a.logged_hours)}/${utils.formatHours(a.allocated_hours)}</span>
                      </div>
                      ${utils.progressBar(pct)}
                    </div>`
                  }).join('') || '<p style="color:var(--text-muted)">No assignments</p>'}
                </div>
              </div>
            </div>
            <!-- Recent Logs -->
            <div class="glass-card" style="padding:20px">
              <h3 style="font-size:14px;font-weight:700;margin-bottom:16px">Recent Time Logs</h3>
              <div style="overflow-x:auto">
                <table class="data-table">
                  <thead><tr><th>Date</th><th>Project</th><th>Task</th><th>Hours</th><th>Status</th></tr></thead>
                  <tbody>
                    ${(d.recent_logs || []).slice(0,10).map(l => `
                    <tr>
                      <td style="color:var(--text-muted);font-size:12px">${utils.formatDate(l.date)}</td>
                      <td><span style="font-size:12px;color:var(--primary-light)">${l.project_name}</span></td>
                      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary)">${l.task_description}</td>
                      <td><strong style="color:var(--accent)">${l.hours_consumed}h</strong></td>
                      <td>${utils.approvalBadge(l.approval_status)}</td>
                    </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">No logs found</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    `
    // Distribution chart
    if (d.assignments?.length > 0) {
      const ctx = document.getElementById('devDistChart')
      if (ctx) {
        const colors = ['#FF7A45','#FFA577','#58C68A','#FFCB47','#FF5E3A','#C56FE6','#C56FE6']
        new Chart(ctx, {
          type: 'doughnut',
          data: {
            labels: d.assignments.map(a => a.project_name),
            datasets: [{ data: d.assignments.map(a => a.logged_hours || 0), backgroundColor: colors, borderColor: 'rgba(26,26,62,0.8)', borderWidth: 3 }]
          },
          options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.raw}h` } } } }
        })
      }
    }
  } catch (e) { document.getElementById('page-content').innerHTML = `<div style="color:var(--danger);padding:20px">Error: ${e.message}</div>` }
})

// ============ PROJECTS PAGE ============
router.register('projects', async () => {
  try {
    const res = await API.get('/projects')
    const projects = res.data?.projects || res.data?.data || []
    document.getElementById('page-content').innerHTML = `
      <div class="animate-fade-in">
        <div class="page-header" style="display:flex;justify-content:space-between;align-items:center">
          <div><h1 class="page-title">Projects</h1><p class="page-subtitle">${projects.length} projects total</p></div>
          ${['admin','pm'].includes(state.user?.role) ? `<button class="btn btn-primary" onclick="openProjectModal()"><i class="fas fa-plus"></i> New Project</button>` : ''}
        </div>
        <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">
          <input type="text" id="proj-search" class="form-input" style="max-width:260px" placeholder="Search projects..." oninput="filterProjects()"/>
          <select class="form-select" id="proj-status" style="max-width:160px" onchange="filterProjects()">
            <option value="">All Status</option><option>active</option><option>on_hold</option><option>completed</option><option>archived</option>
          </select>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:16px" id="proj-grid">
          ${projects.map(p => renderProjectCard(p)).join('')}
        </div>
      </div>
    `
  } catch (e) { document.getElementById('page-content').innerHTML = `<div style="color:var(--danger);padding:20px">Error: ${e.message}</div>` }
})

function renderProjectCard(p) {
  const burnPct = p.total_allocated_hours > 0 ? Math.round((p.consumed_hours / p.total_allocated_hours) * 100) : 0
  const tlPct = Math.min(100, Math.max(0, parseFloat(p.timeline_progress || 0)))
  const remaining = Math.max(0, (p.total_allocated_hours || 0) - (p.consumed_hours || 0))
  const color = burnPct >= 100 ? 'red' : burnPct >= 80 ? 'yellow' : 'green'
  return `
    <div class="glass-card" style="padding:20px;cursor:pointer;border-top:3px solid #FF7A45" onclick="router.navigate('project-detail',{id:'${p.id}'})" id="proj-card-${p.id}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
        <div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            ${utils.healthBadge(burnPct, tlPct)}
          </div>
          <div style="font-size:16px;font-weight:700">${p.name}</div>
          <div style="font-size:12px;color:var(--text-muted)">${p.code} · ${p.client_name || 'Internal'}</div>
        </div>
        <div style="text-align:right">
          ${utils.statusBadge(p.status)}
        </div>
      </div>
      <div style="display:flex;gap:16px;margin-bottom:14px">
        <div style="flex:1;text-align:center;padding:8px;background:rgba(255,255,255,0.03);border-radius:8px">
          <div style="font-size:18px;font-weight:800;color:var(--accent)">${utils.formatNum(p.total_allocated_hours,0)}h</div>
          <div style="font-size:10px;color:var(--text-muted)">Allocated</div>
        </div>
        <div style="flex:1;text-align:center;padding:8px;background:rgba(255,255,255,0.03);border-radius:8px">
          <div style="font-size:18px;font-weight:800;color:${color==='red'?'#FF8866':color==='yellow'?'#FFD986':'#58C68A'}">${utils.formatNum(p.consumed_hours,0)}h</div>
          <div style="font-size:10px;color:var(--text-muted)">Consumed</div>
        </div>
        <div style="flex:1;text-align:center;padding:8px;background:rgba(255,255,255,0.03);border-radius:8px">
          <div style="font-size:18px;font-weight:800">${utils.formatNum(remaining,0)}h</div>
          <div style="font-size:10px;color:var(--text-muted)">Remaining</div>
        </div>
      </div>
      <div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:4px">
          <span>Burn Rate</span><span>${burnPct}%</span>
        </div>
        ${utils.progressBar(burnPct, color)}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:12px">
        <span><i class="fas fa-calendar" style="margin-right:4px"></i>${utils.formatDate(p.start_date)}</span>
        <span><i class="fas fa-flag" style="margin-right:4px"></i>${utils.formatDate(p.expected_end_date)}</span>
        <span><i class="fas fa-users" style="margin-right:4px"></i>${p.developer_count || 0} devs</span>
      </div>
      <div style="display:flex;gap:8px" onclick="event.stopPropagation()">
        <button class="btn btn-secondary btn-sm" onclick="router.navigate('project-detail',{id:'${p.id}'})"><i class="fas fa-eye"></i> View</button>
        ${['admin','pm'].includes(state.user?.role) ? `<button class="btn btn-secondary btn-sm" onclick="openProjectModal('${p.id}')"><i class="fas fa-edit"></i> Edit</button>` : ''}
      </div>
    </div>
  `
}

function filterProjects() {
  const search = document.getElementById('proj-search')?.value.toLowerCase() || ''
  const status = document.getElementById('proj-status')?.value.toLowerCase()
  document.querySelectorAll('[id^="proj-card-"]').forEach(card => {
    const text = card.textContent.toLowerCase()
    let show = text.includes(search)
    if (status) show = show && text.includes(status)
    card.parentElement.style.display = show ? '' : 'none'
  })
}

// Track selected developers globally for the project modal
window._projSelectedDevs = []

function toggleDevSelection(devId, devName, devDesig) {
  const idx = window._projSelectedDevs.findIndex(d => d.id === devId)
  if (idx >= 0) {
    window._projSelectedDevs.splice(idx, 1)
  } else {
    window._projSelectedDevs.push({ id: devId, name: devName, designation: devDesig, hours: 0 })
  }
  renderSelectedDevs()
  // Update checkboxes
  document.querySelectorAll(`[data-dev-cb="${devId}"]`).forEach(cb => {
    cb.checked = window._projSelectedDevs.some(d => d.id === devId)
  })
  // Update dev list highlighting
  document.querySelectorAll(`[data-dev-row="${devId}"]`).forEach(row => {
    row.style.background = window._projSelectedDevs.some(d => d.id === devId) ? 'rgba(108,95,252,0.08)' : ''
    row.style.borderColor = window._projSelectedDevs.some(d => d.id === devId) ? '#FF7A45' : 'var(--border)'
  })
}

function renderSelectedDevs() {
  const cont = document.getElementById('selected-devs-list')
  if (!cont) return
  if (!window._projSelectedDevs.length) {
    cont.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px;text-align:center">No developers selected yet. Click developers above to add them.</div>'
    updateProjectDevCount()
    return
  }
  cont.innerHTML = window._projSelectedDevs.map(d => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg-input);border-radius:8px;border:1px solid rgba(108,95,252,0.3)">
      <div style="width:28px;height:28px;border-radius:50%;background:#FF7A45;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;flex-shrink:0">${escapeHtml(d.name.split(' ').map(n=>n[0]).join('').slice(0,2))}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;color:var(--text-primary)">${escapeHtml(d.name)}</div>
        <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(d.designation||'staff')}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <input type="number" value="${d.hours}" min="0" placeholder="Hrs" style="width:65px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:var(--bg-main);color:var(--text-primary);font-size:12px" oninput="updateDevHours('${d.id}',this.value)" title="Allocated hours"/>
        <span style="font-size:10px;color:var(--text-muted)">hrs</span>
        <button onclick="toggleDevSelection('${d.id}','${d.name}','${d.designation||''}')" style="background:none;border:none;color:#FF5E3A;cursor:pointer;font-size:13px" title="Remove"><i class="fas fa-times-circle"></i></button>
      </div>
    </div>`).join('')
  updateProjectDevCount()
}

function updateDevHours(devId, val) {
  const dev = window._projSelectedDevs.find(d => d.id === devId)
  if (dev) dev.hours = parseFloat(val) || 0
}

function updateProjectDevCount() {
  const cnt = document.getElementById('dev-sel-count')
  if (cnt) cnt.textContent = `${window._projSelectedDevs.length} selected`
}

function openProjectModal(id = null) {
  const fetchAndOpen = async () => {
    let proj = null
    let currentDevs = []
    if (id) {
      const res = await API.get(`/projects/${id}`)
      proj = res.data
      const devsRes = await API.get(`/projects/${id}/developers`).catch(() => ({ developers: [] }))
      currentDevs = devsRes.developers || []
    }
    const [devsRes, pmsRes, pcsRes, clientsRes, teamsRes, teamUsersRes, allUsersRes] = await Promise.all([
      API.get('/users?role=developer'),
      API.get('/users?role=pm'),
      API.get('/users?role=pc').catch(() => ({ users: [] })),
      API.get('/clients').catch(() => ({ clients: [] })),
      API.get('/project-teams').catch(() => ({ teams: [] })),
      API.get('/users?role=team').catch(() => ({ users: [] })),
      API.get('/users').catch(() => ({ users: [] })),
    ])
    // Backend aliases /users?role=developer to {developer,team} so we strictly filter
    // here: in-house picker = pure role=developer, external picker = pure role=team
    // (any designation allowed). Same defensive filter for PM/PC so a stale
    // alias never lets a non-PM into the PM dropdown.
    const devs = (devsRes.users || devsRes.data || [])
      .filter(u => String(u.role || '').toLowerCase() === 'developer')
    const allUsers = (allUsersRes.users || allUsersRes.data || [])
    const isActive = u => Number(u.is_active ?? 1) === 1
    // Sales staff for the Sold By dropdown — manager / TL / agent.
    const salesPersons = allUsers
      .filter(u => isActive(u) && ['sales_manager','sales_tl','sales_agent'].includes(String(u.role || '').toLowerCase()))
      .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')))
    // PM dropdown also accepts admin users so projects can always be assigned
    // even on a fresh install where no dedicated PM has been created yet.
    let pms = (pmsRes.users || pmsRes.data || [])
      .filter(u => String(u.role || '').toLowerCase() === 'pm' && isActive(u))
    if (!pms.length) {
      pms = allUsers.filter(u => ['pm', 'admin'].includes(String(u.role || '').toLowerCase()) && isActive(u))
    }
    const pcs = (pcsRes.users || pcsRes.data || [])
      .filter(u => String(u.role || '').toLowerCase() === 'pc' && isActive(u))
    const clients = clientsRes.clients || clientsRes.data || []
    const teams = teamsRes.teams || teamsRes.data || []
    const teamUsers = (teamUsersRes.users || teamUsersRes.data || [])
      .filter(u => String(u.role || '').toLowerCase() === 'team')
    const esc = (value = '') => escapeHtml(value)
    const initialAssignment = (proj?.assignment_type === 'external') ? 'external' : 'in_house'
    window._projAssignmentType = initialAssignment
    window._projExternalTeamId = proj?.external_team_id || ''
    window._projExternalAssigneeType = proj?.external_assignee_type || 'team'

    // Pre-select current developers
    window._projSelectedDevs = currentDevs.map(d => ({
      id: d.user_id,
      name: d.full_name || d.name,
      designation: d.designation || d.user_role || 'Developer',
      hours: d.allocated_hours || 0
    }))
    window._projFiles = []
    window._projLinks = []
    window._projDeliveryKind = proj?.delivery_kind || ''
    // Stash so saveProject can preserve hours/revenue (form no longer exposes them).
    window._projEditingRecord = proj || null
    showModal(`
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:12px">
          <div class="summary-icon blue" style="background:var(--primary-light);color:var(--primary)"><i class="fas fa-folder-${proj ? 'open' : 'plus'}"></i></div>
          <div>
            <h3>${proj ? 'Edit Project' : 'New Project'}</h3>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px">Capture the project, team, and delivery details in one place.</div>
          </div>
        </div>
        <button class="close-btn" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body" style="padding:20px">
        <div class="page-banner" style="margin-bottom:16px">
          <h2>${proj ? esc(proj.name || 'Edit Project') : 'Create a New Project'}</h2>
          <p>${proj ? 'Update the project plan, team assignments, and budget without leaving the workspace.' : 'The project record, default Kanban permissions, and starter columns will be created automatically when you save.'}</p>
          <div class="hero-pills">
            <span class="hero-pill"><i class="fas fa-info-circle"></i> Details</span>
            <span class="hero-pill"><i class="fas fa-users"></i> Team</span>
            <span class="hero-pill"><i class="fas fa-coins"></i> Budget</span>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:minmax(0,1.45fr) minmax(280px,0.85fr);gap:16px">
          <div style="display:flex;flex-direction:column;gap:16px">
            <div class="card">
              <div class="card-header">
                <h3>Project Details</h3>
                <span style="font-size:12px;color:var(--text-muted)">Required fields are marked *</span>
              </div>
              <div class="card-body">
                <div class="grid-2" style="gap:12px">
                  <div class="form-group"><label class="form-label">Project Name *</label><input id="proj-name" class="form-input" value="${esc(proj?.name||'')}" placeholder="e.g. DevTrack Pro"/></div>
                  <div class="form-group">
                    <label class="form-label">Delivery Kind *</label>
                    <select id="proj-delivery-kind" class="form-select" onchange="onProjDeliveryKindChange(this.value, ${proj ? 'true' : 'false'})">
                      <option value="" ${!proj?.delivery_kind ? 'selected' : ''}>— Select —</option>
                      <option value="app" ${proj?.delivery_kind === 'app' ? 'selected' : ''}>App (APP-prefixed code)</option>
                      <option value="web" ${proj?.delivery_kind === 'web' ? 'selected' : ''}>Web (WB-prefixed code)</option>
                      <option value="both" ${proj?.delivery_kind === 'both' ? 'selected' : ''}>Both (BTH-prefixed code)</option>
                    </select>
                  </div>
                  <div class="form-group"><label class="form-label">Project Code *</label>
                    <div style="display:flex;gap:6px">
                      <input id="proj-code" class="form-input" value="${esc(proj?.code||'')}" placeholder="Pick a delivery kind to auto-fill" style="flex:1"/>
                      <button type="button" class="btn btn-outline btn-sm" onclick="autoFillProjectCode()" title="Suggest next code"><i class="fas fa-wand-magic-sparkles"></i></button>
                    </div>
                  </div>
                  <div class="form-group"><label class="form-label">Client</label>
                    <select id="proj-client-id" class="form-select">
                      <option value="">— Internal / None —</option>
                      ${clients.map(c=>`<option value="${esc(c.id)}" data-name="${esc(c.company_name||c.contact_name||'')}" ${proj?.client_id===c.id?'selected':''}>${esc(c.company_name||c.contact_name||c.email)}</option>`).join('')}
                    </select></div>
                  <div class="form-group"><label class="form-label">Project Type</label>
                    <select id="proj-type" class="form-select">${['development','maintenance','support','consulting'].map(t=>`<option value="${t}" ${proj?.project_type===t?'selected':''}>${t.charAt(0).toUpperCase()+t.slice(1)}</option>`).join('')}</select></div>
                  <div class="form-group"><label class="form-label">Start Date *</label><input id="proj-start" class="form-input" type="date" value="${esc(proj?.start_date||'')}"/></div>
                  <div class="form-group"><label class="form-label">End Date</label><input id="proj-end" class="form-input" type="date" value="${esc(proj?.expected_end_date||'')}"/></div>
                  <div class="form-group"><label class="form-label">Status</label>
                    <select id="proj-status" class="form-select">${['active','on_hold','completed','archived','cancelled'].map(t=>`<option value="${t}" ${proj?.status===t?'selected':''}>${t.replace('_',' ').charAt(0).toUpperCase()+t.replace('_',' ').slice(1)}</option>`).join('')}</select></div>
                </div>
              </div>
            </div>

            <div class="card" id="proj-team-assignment-card">
              <div class="card-header"><h3>Team Assignment</h3></div>
              <div class="card-body">
                <div class="grid-2" style="gap:12px;margin-bottom:16px">
                  <div class="form-group"><label class="form-label">Project Manager *</label>
                    <select id="proj-pm" class="form-select">${pms.length ? '<option value="">Select PM</option>' : '<option value="">No PMs available — add one in Team</option>'}${pms.map(p=>`<option value="${p.id}" ${proj?.pm_id===p.id?'selected':''}>${esc(p.full_name)} (${esc(String(p.role || '').toUpperCase())})</option>`).join('')}</select></div>
                  <div class="form-group"><label class="form-label">Product Coordinator</label>
                    <select id="proj-pc" class="form-select"><option value="">None</option>${pcs.map(c=>`<option value="${c.id}" ${proj?.pc_id===c.id?'selected':''}>${esc(c.full_name)}</option>`).join('')}</select></div>
                </div>

                <div class="form-group">
                  <label class="form-label">Assignment Type *</label>
                  <div style="display:flex;gap:8px;flex-wrap:wrap">
                    <button type="button" id="proj-assign-inhouse" onclick="setProjectAssignmentType('in_house')" class="btn ${initialAssignment==='in_house'?'btn-primary':'btn-outline'}" style="flex:1;min-width:140px">
                      <i class="fas fa-building"></i> In-house
                    </button>
                    <button type="button" id="proj-assign-external" onclick="setProjectAssignmentType('external')" class="btn ${initialAssignment==='external'?'btn-primary':'btn-outline'}" style="flex:1;min-width:140px">
                      <i class="fas fa-users-cog"></i> External
                    </button>
                  </div>
                </div>

                <div id="proj-assign-inhouse-panel" style="display:${initialAssignment==='in_house'?'block':'none'}">
                  <div class="form-group">
                    <label class="form-label" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
                      <span><i class="fas fa-code" style="color:#FF7A45;margin-right:6px"></i>Allocated Developers</span>
                      <span id="dev-sel-count" style="font-size:11px;color:#FF7A45;font-weight:600">${window._projSelectedDevs.length} selected</span>
                    </label>
                    <div style="border:1px solid var(--border);border-radius:12px;overflow:hidden">
                      <div style="padding:8px 12px;background:var(--surface-2);border-bottom:1px solid var(--border)">
                        <input type="text" class="form-input" placeholder="Search developers…" style="margin:0" oninput="filterDevDropdown(this.value)"/>
                      </div>
                      <div id="dev-dropdown-list" style="max-height:180px;overflow-y:auto;padding:8px">
                        ${devs.length === 0 ? '<div style="color:var(--text-muted);font-size:12px;padding:8px;text-align:center">No developers found</div>' :
                        devs.map(d => {
                          const isSel = window._projSelectedDevs.some(s => s.id === d.id)
                          return `<div data-dev-row="${d.id}" onclick="toggleDevSelection('${d.id}','${esc(d.full_name)}','${esc(d.designation||d.role||'')}')" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;transition:.15s;border:1px solid ${isSel?'#FF7A45':'transparent'};background:${isSel?'rgba(108,95,252,0.08)':''};margin-bottom:4px">
                            <input type="checkbox" data-dev-cb="${d.id}" ${isSel?'checked':''} onchange="toggleDevSelection('${d.id}','${esc(d.full_name)}','${esc(d.designation||d.role||'')}')" onclick="event.stopPropagation()" style="accent-color:#FF7A45;width:15px;height:15px"/>
                            <div style="width:28px;height:28px;border-radius:50%;background:${d.avatar_color||'#FF7A45'};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;flex-shrink:0">${esc((d.full_name||'').split(' ').map(n=>n[0]).join('').slice(0,2))}</div>
                            <div style="flex:1">
                              <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${esc(d.full_name)}</div>
                              <div style="font-size:11px;color:var(--text-muted)">${esc(d.designation||d.role||'staff')}</div>
                            </div>
                            ${isSel ? '<i class="fas fa-check-circle" style="color:#FF7A45;font-size:14px"></i>' : ''}
                          </div>`
                        }).join('')}
                      </div>
                    </div>
                  </div>
                </div>

                <div id="proj-assign-external-panel" style="display:${initialAssignment==='external'?'block':'none'}">
                  <div class="form-group" style="margin-bottom:0">
                    <label class="form-label"><i class="fas fa-users-cog" style="color:#FF7A45;margin-right:6px"></i>Select External Team / Member *</label>
                    <select id="proj-external-team" class="form-select">
                      <option value="">— Select —</option>
                      ${teams.length ? `<optgroup label="Project Teams">
                        ${teams.map(t=>`<option value="${esc(t.id)}" data-kind="team" ${window._projExternalTeamId===t.id && window._projExternalAssigneeType==='team'?'selected':''}>${esc(t.alias || t.name)}${t.member_count?` · ${t.member_count} members`:''}${t.lead_name?` · Lead: ${esc(t.lead_name)}`:''}</option>`).join('')}
                      </optgroup>` : ''}
                      ${teamUsers.length ? `<optgroup label="Team Members (role: team)">
                        ${teamUsers.map(u=>`<option value="${esc(u.id)}" data-kind="user" ${window._projExternalTeamId===u.id && window._projExternalAssigneeType==='user'?'selected':''}>${esc(u.full_name)}${u.designation?` · ${esc(u.designation)}`:''}</option>`).join('')}
                      </optgroup>` : ''}
                    </select>
                    ${teams.length===0 && teamUsers.length===0 ? '<div style="color:var(--text-muted);font-size:12px;margin-top:6px">No external teams or team members available.</div>' : ''}
                  </div>
                </div>
              </div>
            </div>

            <div class="card">
              <div class="card-header"><h3>Description</h3></div>
              <div class="card-body">
                <div class="form-group">
                  <label class="form-label">Billable</label>
                  <select id="proj-billable" class="form-select" style="max-width:200px"><option value="1" ${proj?.billable?'selected':''}>Yes</option><option value="0" ${!proj?.billable?'selected':''}>No</option></select>
                </div>
                <div class="form-group"><label class="form-label">Description</label><textarea id="proj-desc" class="form-textarea" rows="2">${esc(proj?.description||'')}</textarea></div>
                <div class="form-group" style="margin-bottom:0"><label class="form-label">Remarks</label><textarea id="proj-remarks" class="form-textarea" rows="2">${esc(proj?.remarks||'')}</textarea></div>
              </div>
            </div>

            ${_user?.role === 'admin' ? `
            <div class="card" id="proj-commercial-card">
              <div class="card-header">
                <h3>Commercial Info</h3>
                <span style="font-size:12px;color:var(--text-muted)">Admin-only — choose who else can see these</span>
              </div>
              <div class="card-body">
                <div class="grid-2" style="gap:12px">
                  <div class="form-group"><label class="form-label">Sold By</label>
                    ${(() => {
                      // Render a select of active sales staff. If the project
                      // already has a sold_by that doesn't match any current
                      // sales person, surface it as a "(legacy)" option so we
                      // don't lose data on edit.
                      const cur = (proj?.sold_by || '').trim()
                      const matchesPerson = salesPersons.some(p => p.full_name === cur)
                      return `
                        <select id="proj-sold-by" class="form-select" onchange="onProjSoldByChange(this.value)">
                          <option value="">— Select sales person —</option>
                          ${salesPersons.map(p => `<option value="${esc(p.full_name)}" ${cur === p.full_name ? 'selected' : ''}>${esc(p.full_name)} · ${esc(String(p.role || '').replace('sales_','').toUpperCase())}</option>`).join('')}
                          ${cur && !matchesPerson ? `<option value="${esc(cur)}" selected>${esc(cur)} (legacy)</option>` : ''}
                          <option value="__custom__">Other / custom name…</option>
                        </select>
                        <input id="proj-sold-by-custom" class="form-input" placeholder="Type a custom name" style="margin-top:6px;display:none"/>
                      `
                    })()}
                  </div>
                  <div class="form-group"><label class="form-label">Project Amount</label><input id="proj-amount" class="form-input" type="number" step="0.01" min="0" value="${proj?.project_amount ?? ''}" placeholder="e.g. 500000"/></div>
                </div>
                <div class="form-group" style="margin-bottom:0">
                  <label class="form-label">Visible to roles <span style="color:var(--text-muted);font-weight:400">(admin always sees)</span></label>
                  <div style="display:flex;gap:14px;flex-wrap:wrap;padding:8px 0">
                    ${['pm','pc','developer','team','client'].map(role => {
                      const checked = Array.isArray(proj?.commercial_visible_to) && proj.commercial_visible_to.includes(role)
                      return `<label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-secondary);cursor:pointer">
                        <input type="checkbox" class="proj-commercial-role" value="${role}" ${checked?'checked':''} style="accent-color:#FF7A45"/>${role.toUpperCase()}
                      </label>`
                    }).join('')}
                  </div>
                </div>
              </div>
            </div>` : ''}

            <div class="card">
              <div class="card-header"><h3>Attachments</h3><span style="font-size:12px;color:var(--text-muted)">Files and pasted links appear under this project in Documents (25 MB / file)</span></div>
              <div class="card-body">
                <div style="border:1px dashed rgba(255,180,120,.32);border-radius:10px;padding:12px;background:rgba(0,0,0,.18)">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                    <input id="proj-files-input" type="file" multiple style="display:none" onchange="projAddFiles(this.files);this.value=''"/>
                    <button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById('proj-files-input').click()"><i class="fas fa-upload"></i> Choose files</button>
                    <span style="color:#475569;font-size:11px">— or —</span>
                    <input id="proj-link-url" class="form-input" type="url" placeholder="Paste a document URL (Drive, Figma, Notion…)" style="flex:1;min-width:220px;padding:6px 10px;font-size:12.5px"/>
                    <input id="proj-link-name" class="form-input" type="text" placeholder="Label (optional)" style="width:160px;padding:6px 10px;font-size:12.5px"/>
                    <button type="button" class="btn btn-outline btn-sm" onclick="projAddLink()"><i class="fas fa-link"></i> Add link</button>
                  </div>
                  <div style="font-size:11px;color:#64748b;margin-top:6px">Attach SOW, contracts, mockups, or paste shared-doc URLs.</div>
                  <div id="proj-files-list" style="display:flex;flex-direction:column;gap:6px;margin-top:8px"></div>
                </div>
              </div>
            </div>
          </div>

          <div style="display:flex;flex-direction:column;gap:16px">
            <div class="card">
              <div class="card-header"><h3>Creation Guide</h3></div>
              <div class="card-body" style="display:flex;flex-direction:column;gap:10px">
                <div class="selection-chip"><i class="fas fa-check"></i> Project, Kanban permissions, and default columns are created on save.</div>
                <div class="selection-chip"><i class="fas fa-user-tie"></i> Assign PM, product coordinator, and developers before creating the project.</div>
                <div class="selection-chip"><i class="fas fa-calendar"></i> Start and end dates are validated before submit.</div>
                <div class="selection-chip"><i class="fas fa-coins"></i> Set total project hours and revenue in the Budget section.</div>
              </div>
            </div>

            <div class="card">
              <div class="card-header"><h3>Snapshot</h3></div>
              <div class="card-body" style="display:grid;gap:10px">
                <div style="padding:12px;border-radius:12px;background:var(--surface-2);border:1px solid var(--border)">
                  <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.7px;font-weight:700">Project</div>
                  <div style="font-size:14px;font-weight:700;margin-top:4px">${proj ? esc(proj.name || '') : 'New project draft'}</div>
                  <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${proj ? esc(proj.code || '') : 'Will be available in Projects after save'}</div>
                </div>
                <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px">
                  <div style="padding:10px 12px;border-radius:12px;background:var(--surface-2);border:1px solid var(--border)">
                    <div style="font-size:11px;color:var(--text-muted);font-weight:700;text-transform:uppercase">Team</div>
                    <div style="font-size:13px;font-weight:700;margin-top:3px">${window._projSelectedDevs.length} devs</div>
                  </div>
                  <div style="padding:10px 12px;border-radius:12px;background:var(--surface-2);border:1px solid var(--border)">
                    <div style="font-size:11px;color:var(--text-muted);font-weight:700;text-transform:uppercase">Dates</div>
                    <div style="font-size:13px;font-weight:700;margin-top:3px">${proj?.start_date ? esc(proj.start_date) : 'Not set'}</div>
                  </div>
                </div>
                <div style="padding:12px;border-radius:12px;background:rgba(37,99,235,0.06);border:1px solid rgba(37,99,235,0.14);color:var(--text-secondary);font-size:13px;line-height:1.6">
                  Default kanban access and starter columns are seeded automatically when the project is saved.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveProject('${proj?.id||''}')"><i class="fas fa-save"></i> ${proj ? 'Update' : 'Create'} Project</button>
      </div>
    `, 'modal-xl')
    renderSelectedDevs()
  }
  fetchAndOpen()
}

function filterDevDropdown(query) {
  const q = query.toLowerCase()
  document.querySelectorAll('#dev-dropdown-list [data-dev-row]').forEach(row => {
    const name = row.querySelector('div div:first-child')?.textContent?.toLowerCase() || ''
    const desig = row.querySelector('div div:last-child')?.textContent?.toLowerCase() || ''
    row.style.display = (name.includes(q) || desig.includes(q)) ? '' : 'none'
  })
}

function onProjSoldByChange(value) {
  const custom = document.getElementById('proj-sold-by-custom')
  if (!custom) return
  if (value === '__custom__') {
    custom.style.display = ''
    custom.focus()
  } else {
    custom.style.display = 'none'
    custom.value = ''
  }
}

function readProjSoldBy() {
  const sel = document.getElementById('proj-sold-by')
  if (!sel) return null
  if (sel.value === '__custom__') {
    return (document.getElementById('proj-sold-by-custom')?.value || '').trim() || null
  }
  return sel.value || null
}

function setProjectAssignmentType(type) {
  if (type !== 'in_house' && type !== 'external') return
  window._projAssignmentType = type
  const inHousePanel = document.getElementById('proj-assign-inhouse-panel')
  const externalPanel = document.getElementById('proj-assign-external-panel')
  if (inHousePanel) inHousePanel.style.display = type === 'in_house' ? 'block' : 'none'
  if (externalPanel) externalPanel.style.display = type === 'external' ? 'block' : 'none'
  const inBtn = document.getElementById('proj-assign-inhouse')
  const exBtn = document.getElementById('proj-assign-external')
  if (inBtn) {
    inBtn.classList.toggle('btn-primary', type === 'in_house')
    inBtn.classList.toggle('btn-outline', type !== 'in_house')
  }
  if (exBtn) {
    exBtn.classList.toggle('btn-primary', type === 'external')
    exBtn.classList.toggle('btn-outline', type !== 'external')
  }
}

// ── Project create modal helpers (delivery kind, code prefix, files) ────
async function onProjDeliveryKindChange(kind, isEdit) {
  window._projDeliveryKind = kind || ''
  if (isEdit) return // don't auto-overwrite an existing code on edit
  const codeInput = document.getElementById('proj-code')
  if (!codeInput) return
  // Only auto-fill when code is empty or still matches a previous prefix —
  // we don't want to clobber a manually-typed code.
  const cur = (codeInput.value || '').trim().toUpperCase()
  const knownPrefixes = ['APP', 'WB', 'BTH']
  const looksAuto = !cur || knownPrefixes.some(p => cur.startsWith(p))
  if (!kind || !looksAuto) return
  await fetchAndFillNextCode(kind)
}

async function autoFillProjectCode() {
  const kind = document.getElementById('proj-delivery-kind')?.value
  if (!kind) return utils.toast('Pick a delivery kind first', 'error')
  await fetchAndFillNextCode(kind)
}

async function fetchAndFillNextCode(kind) {
  const codeInput = document.getElementById('proj-code')
  if (!codeInput) return
  try {
    const res = await API.get('/projects/next-code?kind=' + encodeURIComponent(kind))
    if (res.code) codeInput.value = res.code
  } catch (e) {
    utils.toast('Could not suggest a code: ' + e.message, 'error')
  }
}

function projAddFiles(fileList) {
  if (!window._projFiles) window._projFiles = []
  for (const f of fileList) window._projFiles.push(f)
  projRenderFilesList()
}
function projRemoveFile(idx) {
  if (!window._projFiles) return
  window._projFiles.splice(idx, 1)
  projRenderFilesList()
}
function projAddLink() {
  const urlEl = document.getElementById('proj-link-url')
  const nameEl = document.getElementById('proj-link-name')
  const url = (urlEl?.value || '').trim()
  if (!url) return utils.toast('Paste a URL first', 'error')
  if (!/^https?:\/\//i.test(url)) return utils.toast('URL must start with http:// or https://', 'error')
  if (!window._projLinks) window._projLinks = []
  let display = (nameEl?.value || '').trim()
  if (!display) {
    try { const u = new URL(url); display = u.hostname + (u.pathname && u.pathname !== '/' ? u.pathname : '') }
    catch { display = url }
  }
  window._projLinks.push({ url, name: display })
  if (urlEl) urlEl.value = ''
  if (nameEl) nameEl.value = ''
  projRenderFilesList()
}
function projRemoveLink(idx) {
  if (!window._projLinks) return
  window._projLinks.splice(idx, 1)
  projRenderFilesList()
}
function projRenderFilesList() {
  const wrap = document.getElementById('proj-files-list')
  if (!wrap) return
  const files = window._projFiles || []
  const links = window._projLinks || []
  if (!files.length && !links.length) { wrap.innerHTML = ''; return }
  const fileRows = files.map((f, i) => {
    const sizeMb = (f.size / (1024 * 1024)).toFixed(2)
    const tooBig = f.size > 25 * 1024 * 1024
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:6px 10px;background:rgba(15,23,42,.5);border:1px solid rgba(148,163,184,.18);border-radius:8px">
        <i class="fas fa-file" style="color:#FF7A45;font-size:14px"></i>
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(f.name)}</div>
          <div style="font-size:10.5px;color:${tooBig ? '#FF5E3A' : '#64748b'}">${sizeMb} MB${tooBig ? ' — exceeds 25 MB limit' : ''}</div>
        </div>
        <button type="button" class="btn btn-sm btn-outline" style="border-color:rgba(255,94,58,.4);color:#FF5E3A" onclick="projRemoveFile(${i})"><i class="fas fa-times"></i></button>
      </div>`
  })
  const linkRows = links.map((l, i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:6px 10px;background:rgba(15,23,42,.5);border:1px solid rgba(148,163,184,.18);border-radius:8px">
      <i class="fas fa-link" style="color:#86E0A8;font-size:14px"></i>
      <div style="flex:1;min-width:0">
        <div style="font-size:12.5px;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(l.name)}</div>
        <div style="font-size:10.5px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener" style="color:#9F8678">${escapeHtml(l.url)}</a></div>
      </div>
      <button type="button" class="btn btn-sm btn-outline" style="border-color:rgba(255,94,58,.4);color:#FF5E3A" onclick="projRemoveLink(${i})"><i class="fas fa-times"></i></button>
    </div>`)
  wrap.innerHTML = [...fileRows, ...linkRows].join('')
}

async function saveProject(id) {
  try {
    const clientSelect = document.getElementById('proj-client-id')
    const clientOpt = clientSelect?.selectedOptions?.[0]
    const assignmentType = window._projAssignmentType === 'external' ? 'external' : 'in_house'
    const externalSelect = document.getElementById('proj-external-team')
    const externalOpt = externalSelect?.selectedOptions?.[0]
    const externalTeamId = assignmentType === 'external' ? (externalSelect?.value || '') : ''
    const externalAssigneeType = assignmentType === 'external'
      ? (externalOpt?.dataset?.kind || 'team')
      : null
    const deliveryKind = document.getElementById('proj-delivery-kind')?.value || null
    // Total Hours / Revenue were removed from the form — preserve existing
    // values on edit (from the loaded project record), default to 0 on create.
    const existing = window._projEditingRecord || null
    const soldByEl = document.getElementById('proj-sold-by')
    const amountEl = document.getElementById('proj-amount')
    const commercialRoles = Array.from(document.querySelectorAll('.proj-commercial-role:checked'))
      .map(el => el.value)
    const payload = {
      name: document.getElementById('proj-name').value.trim(),
      code: document.getElementById('proj-code').value.trim(),
      client_id: clientSelect?.value || null,
      client_name: clientOpt?.dataset?.name || null,
      project_type: document.getElementById('proj-type').value,
      delivery_kind: deliveryKind || null,
      start_date: document.getElementById('proj-start').value,
      expected_end_date: document.getElementById('proj-end').value || null,
      status: document.getElementById('proj-status').value,
      assignment_type: assignmentType,
      external_team_id: externalTeamId || null,
      external_assignee_type: externalAssigneeType,
      total_allocated_hours: Number(existing?.total_allocated_hours) || 0,
      estimated_budget_hours: Number(existing?.estimated_budget_hours) || 0,
      pm_id: document.getElementById('proj-pm').value||null,
      pc_id: document.getElementById('proj-pc').value||null,
      team_lead_id: null,
      revenue: Number(existing?.revenue) || 0,
      billable: document.getElementById('proj-billable').value==='1',
      description: document.getElementById('proj-desc').value,
      remarks: document.getElementById('proj-remarks').value,
      // Commercial fields — only present in the form for admins; preserved
      // for non-admins by falling back to the loaded record.
      sold_by: soldByEl ? readProjSoldBy() : (existing?.sold_by ?? null),
      project_amount: amountEl
        ? (amountEl.value === '' ? null : Number(amountEl.value))
        : (existing?.project_amount ?? null),
      commercial_visible_to: soldByEl ? commercialRoles : (existing?.commercial_visible_to ?? []),
    }
    if (!payload.name || !payload.code || !payload.start_date) {
      utils.toast('Please fill required fields (Name, Code, Start Date)', 'error'); return
    }
    if (assignmentType === 'external' && !externalTeamId) {
      utils.toast('Please select an external team or team member', 'error'); return
    }

    // Upload any attached files first so we can pass them along with the
    // create/update payload. On create the backend persists them as
    // project documents tied to the new project_id.
    const pendingFiles = window._projFiles || []
    for (const f of pendingFiles) {
      if (f.size > 25 * 1024 * 1024) { utils.toast(`"${f.name}" exceeds the 25 MB limit`, 'error'); return }
    }
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
        utils.toast(`"${f.name}" upload failed: ${e.message}`, 'error')
        return
      }
    }
    // Pasted URLs ride along as link-only attachments.
    for (const l of (window._projLinks || [])) {
      attachments.push({
        file_name: l.name,
        file_url: l.url,
        file_type: 'link',
        file_size: 0,
      })
    }
    if (attachments.length) payload.attachments = attachments

    let projId = id
    if (id) {
      await API.put(`/projects/${id}`, payload)
    } else {
      const res = await API.post('/projects', payload)
      projId = res.data?.id || res.id
    }
    window._projFiles = []
    window._projLinks = []

    if (assignmentType === 'in_house') {
      if (projId && window._projSelectedDevs.length > 0) {
        const developers = window._projSelectedDevs.map(d => ({
          user_id: d.id,
          allocated_hours: d.hours || 0,
          role: 'developer'
        }))
        await API.post(`/projects/${projId}/assign-bulk`, { developers }).catch(e => {
          console.warn('Could not save developer allocations:', e.message)
        })
      } else if (projId && window._projSelectedDevs.length === 0 && id) {
        await API.post(`/projects/${projId}/assign-bulk`, { developers: [] }).catch(() => {})
      }
    } else if (projId && id) {
      // Switching to external — clear any previous in-house developer allocations
      await API.post(`/projects/${projId}/assign-bulk`, { developers: [] }).catch(() => {})
    }

    utils.toast(`Project ${id ? 'updated' : 'created'} successfully!`, 'success')
    closeModal()
    window._projSelectedDevs = []
    const currentPage = window.Router?.current?.page
    if (currentPage === 'projects-list') {
      const listEl = document.getElementById('page-projects-list')
      if (listEl) {
        listEl.dataset.loaded = ''
        loadPage('projects-list', listEl)
        return
      }
    }
    if (window.Router?.navigate) {
      Router.navigate('projects-list')
      return
    }
    router.navigate('projects')
  } catch (e) { utils.toast('Failed: ' + e.message, 'error') }
}

// ============ PROJECT DETAIL ============
router.register('project-detail', async ({ id }) => {
  if (!id) { router.navigate('projects'); return }
  try {
    const res = await API.get(`/projects/${id}`)
    const p = res.data
    const burnPct = p.total_allocated_hours > 0 ? Math.round((p.consumed_hours/p.total_allocated_hours)*100) : 0
    const tlPct = Math.min(100, Math.max(0, parseFloat(p.timeline_progress||0)))

    document.getElementById('page-content').innerHTML = `
      <div class="animate-fade-in">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
          <div style="display:flex;align-items:center;gap:12px">
            <button class="btn btn-secondary btn-sm" onclick="router.navigate('projects')"><i class="fas fa-arrow-left"></i></button>
            <div>
              <h1 style="font-size:22px;font-weight:800">${p.name}</h1>
              <div style="font-size:12px;color:var(--text-muted)">${p.code} · ${p.client_name||'Internal'} · ${p.project_type}</div>
            </div>
          </div>
          <div style="display:flex;gap:10px;align-items:center">
            ${utils.statusBadge(p.status)}
            ${['admin','pm'].includes(state.user?.role) ? `<button class="btn btn-secondary btn-sm" onclick="openProjectModal('${p.id}')"><i class="fas fa-edit"></i> Edit</button>` : ''}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px">
          <div>
            <!-- Stats -->
            <div class="grid-3" style="margin-bottom:16px">
              ${statCard('Allocated', utils.formatHours(p.total_allocated_hours), 'fa-clock', 'blue', 'Total hours', '')}
              ${statCard('Consumed', utils.formatHours(p.consumed_hours), 'fa-fire', burnPct>=80?'red':'orange', `${burnPct}% burn rate`, '')}
              ${statCard('Remaining', utils.formatHours(Math.max(0,(p.total_allocated_hours||0)-(p.consumed_hours||0))), 'fa-hourglass-half', 'green', 'Hours left', '')}
            </div>
            <!-- Timeline vs Burn Chart -->
            <div class="glass-card" style="padding:20px;margin-bottom:16px">
              <h3 style="font-size:14px;font-weight:700;margin-bottom:16px">Timeline vs Effort Analysis</h3>
              <div style="display:grid;gap:14px">
                <div>
                  <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">
                    <span style="color:var(--text-muted)">Timeline Progress</span>
                    <span style="font-weight:700;color:#FFA577">${tlPct}%</span>
                  </div>
                  <div class="progress-bar" style="height:10px"><div class="progress-fill blue" style="width:${tlPct}%"></div></div>
                </div>
                <div>
                  <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">
                    <span style="color:var(--text-muted)">Hours Burned</span>
                    <span style="font-weight:700;color:${burnPct>=100?'#FF8866':burnPct>=80?'#FFD986':'#58C68A'}">${burnPct}%</span>
                  </div>
                  <div class="progress-bar" style="height:10px"><div class="progress-fill ${burnPct>=100?'red':burnPct>=80?'yellow':'green'}" style="width:${Math.min(burnPct,100)}%"></div></div>
                </div>
              </div>
              ${burnPct > tlPct * 1.3 ? `
              <div class="alert-card warning" style="margin-top:14px">
                <div style="font-size:13px;font-weight:600;color:var(--warning)"><i class="fas fa-exclamation-triangle margin-right:6px"></i> Hour Consumption Ahead of Schedule</div>
                <div style="font-size:12px;color:var(--text-secondary);margin-top:4px">Project may exceed allocated hours. ${burnPct}% hours consumed but only ${tlPct}% time elapsed.</div>
              </div>` : ''}
            </div>
            <!-- Monthly Burn Chart -->
            <div class="glass-card" style="padding:20px;margin-bottom:16px">
              <h3 style="font-size:14px;font-weight:700;margin-bottom:16px">Monthly Hours Burn</h3>
              <div class="chart-container"><canvas id="projBurnChart"></canvas></div>
            </div>
            <!-- Developer Contributions -->
            <div class="glass-card" style="padding:20px;margin-bottom:16px">
              <div style="display:flex;justify-content:space-between;margin-bottom:16px">
                <h3 style="font-size:14px;font-weight:700">Team Assignments</h3>
                ${['admin','pm'].includes(state.user?.role) ? `<button class="btn btn-primary btn-sm" onclick="openAssignDeveloperModal('${p.id}')"><i class="fas fa-user-plus"></i> Assign Dev</button>` : ''}
              </div>
              <table class="data-table">
                <thead><tr><th>Developer</th><th>Role</th><th>Allocated</th><th>Logged</th><th>Progress</th><th>Actions</th></tr></thead>
                <tbody>
                  ${(p.assignments||[]).map(a => {
                    const aPct = a.allocated_hours > 0 ? Math.round((a.logged_hours/a.allocated_hours)*100) : 0
                    return `<tr>
                      <td><div style="display:flex;align-items:center;gap:8px">
                        <div class="avatar avatar-sm" style="background:${a.avatar_color}">${utils.getInitials(a.full_name)}</div>
                        <div><div style="font-size:13px;font-weight:600">${a.full_name}</div><div style="font-size:11px;color:var(--text-muted)">${a.designation||''}</div></div>
                      </div></td>
                      <td><span class="badge badge-blue">${a.role}</span></td>
                      <td style="font-weight:600">${utils.formatHours(a.allocated_hours)}</td>
                      <td style="color:var(--accent);font-weight:700">${utils.formatHours(a.logged_hours)}</td>
                      <td style="min-width:100px">${utils.progressBar(aPct)}<span style="font-size:10px;color:var(--text-muted)">${aPct}%</span></td>
                      <td>${['admin','pm'].includes(state.user?.role) ? `<button class="btn btn-danger btn-xs" onclick="removeDevFromProject('${p.id}','${a.user_id}')"><i class="fas fa-times"></i></button>` : ''}</td>
                    </tr>`
                  }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px">No developers assigned</td></tr>'}
                </tbody>
              </table>
            </div>
            <!-- Recent Logs -->
            <div class="glass-card" style="padding:20px">
              <h3 style="font-size:14px;font-weight:700;margin-bottom:16px">Recent Logs</h3>
              <table class="data-table">
                <thead><tr><th>Dev</th><th>Date</th><th>Task</th><th>Hours</th><th>Status</th></tr></thead>
                <tbody>
                  ${(p.recent_logs||[]).slice(0,10).map(l=>`<tr>
                    <td><div style="display:flex;align-items:center;gap:6px"><div class="avatar avatar-sm" style="background:${l.avatar_color}">${utils.getInitials(l.full_name)}</div><span style="font-size:12px">${l.full_name}</span></div></td>
                    <td style="font-size:12px;color:var(--text-muted)">${utils.formatDate(l.date)}</td>
                    <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--text-secondary)">${l.task_description}</td>
                    <td><strong style="color:var(--accent)">${l.hours_consumed}h</strong></td>
                    <td>${utils.approvalBadge(l.approval_status)}</td>
                  </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">No logs</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>
          <!-- Right sidebar -->
          <div>
            <div class="glass-card" style="padding:20px;margin-bottom:16px">
              <h3 style="font-size:13px;font-weight:700;margin-bottom:14px">Project Info</h3>
              ${[
                ['PM', p.pm_name||'-'],
                ['Product Coordinator', p.pc_name||'-'],
                ['Start Date', utils.formatDate(p.start_date)],
                ['Deadline', utils.formatDate(p.expected_end_date)],
                ['Billable', p.billable ? '<span class="badge badge-green">Yes</span>' : '<span class="badge badge-gray">No</span>'],
                ['Revenue', p.revenue ? `₹${parseFloat(p.revenue).toLocaleString()}` : '-'],
              ].map(([l,v])=>`<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(45,45,107,0.5);font-size:13px"><span style="color:var(--text-muted)">${l}</span><span>${v}</span></div>`).join('')}
            </div>
            <div class="glass-card" style="padding:20px;margin-bottom:16px">
              <h3 style="font-size:13px;font-weight:700;margin-bottom:14px">Health Status</h3>
              <div style="text-align:center;padding:16px">
                <div style="font-size:48px;margin-bottom:8px">${burnPct>=100?'🔴':burnPct>=80?'🟡':'🟢'}</div>
                <div style="font-size:16px;font-weight:700">${burnPct>=100?'Critical':burnPct>=80?'At Risk':'Healthy'}</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:4px">${burnPct}% hours consumed</div>
              </div>
            </div>
            ${p.description ? `<div class="glass-card" style="padding:20px;margin-bottom:16px">
              <h3 style="font-size:13px;font-weight:700;margin-bottom:10px">Description</h3>
              <p style="font-size:13px;color:var(--text-secondary);line-height:1.6">${p.description}</p>
            </div>` : ''}
            <!-- Notes -->
            <div class="glass-card" style="padding:20px">
              <h3 style="font-size:13px;font-weight:700;margin-bottom:12px">Notes & Comments</h3>
              <div id="notes-list">
                ${(p.notes||[]).map(n=>`<div class="timeline-item" style="margin-bottom:10px">
                  <div style="font-size:12px;font-weight:600">${n.full_name}</div>
                  <div style="font-size:12px;color:var(--text-secondary);margin-top:2px">${n.content}</div>
                  <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${utils.formatRelative(n.created_at)}</div>
                </div>`).join('') || '<p style="font-size:12px;color:var(--text-muted)">No notes yet</p>'}
              </div>
              <div style="margin-top:14px">
                <textarea id="new-note" class="form-textarea" rows="2" placeholder="Add a note..."></textarea>
                <button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="addProjectNote('${p.id}')"><i class="fas fa-paper-plane"></i> Add Note</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `
    // Burn chart
    if (p.monthly_burn?.length > 0) {
      const ctx = document.getElementById('projBurnChart')
      if (ctx) {
        new Chart(ctx, {
          type: 'line',
          data: {
            labels: p.monthly_burn.map(d=>d.month),
            datasets: [{label:'Hours Burned', data: p.monthly_burn.map(d=>parseFloat(d.hours||0)), borderColor:'#FFCB47', backgroundColor:'rgba(255,203,71,0.1)', fill:true, tension:0.4, pointBackgroundColor:'#FFCB47', pointRadius:4}]
          },
          options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{x:{grid:{display:false},ticks:{color:'#64748b'}},y:{grid:{color:'rgba(45,45,107,0.5)'},ticks:{color:'#64748b',callback:v=>v+'h'}}} }
        })
      }
    }
  } catch (e) { document.getElementById('page-content').innerHTML = `<div style="color:var(--danger);padding:20px">Error: ${e.message}</div>` }
})

async function addProjectNote(projectId) {
  const content = document.getElementById('new-note').value.trim()
  if (!content) return
  try {
    await API.post(`/projects/${projectId}/notes`, { content })
    utils.toast('Note added!', 'success')
    router.navigate('project-detail', { id: projectId })
  } catch (e) { utils.toast('Failed to add note', 'error') }
}

async function removeDevFromProject(projectId, userId) {
  if (!utils.confirm('Remove this developer from the project?')) return
  try {
    await API.delete(`/projects/${projectId}/assign/${userId}`)
    utils.toast('Developer removed', 'success')
    router.navigate('project-detail', { id: projectId })
  } catch (e) { utils.toast('Failed: ' + e.message, 'error') }
}

function openAssignDeveloperModal(projectId) {
  const openModal = async () => {
    const devsRes = await API.get('/users?role=developer')
    const devs = devsRes.users || devsRes.data || []
    const modal = document.createElement('div')
    modal.className = 'modal-overlay'
    modal.id = 'assign-modal'
    modal.innerHTML = `
      <div class="modal-box">
        <div class="modal-header">
          <h2 style="font-size:16px;font-weight:700">Assign Developer to Project</h2>
          <button onclick="document.getElementById('assign-modal').remove()" style="background:none;border:none;color:var(--text-muted);font-size:18px;cursor:pointer"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body">
          <div class="form-group"><label class="form-label">Developer *</label>
            <select id="assign-dev" class="form-select"><option value="">Select Developer</option>${devs.map(d=>`<option value="${d.id}">${d.full_name} (${d.designation||'Dev'})</option>`).join('')}</select></div>
          <div class="form-group"><label class="form-label">Role</label>
            <select id="assign-role" class="form-select"><option value="developer">Developer</option><option value="lead">Lead</option><option value="qa">QA</option><option value="designer">Designer</option></select></div>
          <div class="form-group"><label class="form-label">Allocated Hours</label><input id="assign-hours" class="form-input" type="number" value="80" min="0"/></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('assign-modal').remove()">Cancel</button>
          <button class="btn btn-primary" onclick="assignDeveloper('${projectId}')"><i class="fas fa-user-plus"></i> Assign</button>
        </div>
      </div>
    `
    document.body.appendChild(modal)
  }
  openModal()
}

async function assignDeveloper(projectId) {
  const userId = document.getElementById('assign-dev').value
  const role = document.getElementById('assign-role').value
  const hours = parseFloat(document.getElementById('assign-hours').value)||0
  if (!userId) { utils.toast('Please select a developer', 'error'); return }
  try {
    await API.post(`/projects/${projectId}/assign`, { user_id: userId, role, allocated_hours: hours })
    utils.toast('Developer assigned!', 'success')
    document.getElementById('assign-modal').remove()
    router.navigate('project-detail', { id: projectId })
  } catch (e) { utils.toast('Failed: ' + e.message, 'error') }
}
