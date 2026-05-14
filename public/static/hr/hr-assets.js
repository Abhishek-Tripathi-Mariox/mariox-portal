// HR · Assets
// Backed by /api/assets. Manage permission: hr.assets.manage.
// Tracks company equipment (laptop, phone, ID card, etc.) and the assign/
// return lifecycle. Employees without manage permission only see assets
// currently assigned to them.

let _hrAssetPage = 1
let _hrAssetStatus = ''
let _hrAssetType = ''

const ASSET_TYPE_LABEL = {
  laptop: 'Laptop', desktop: 'Desktop', monitor: 'Monitor', phone: 'Phone', sim: 'SIM',
  id_card: 'ID card', access_card: 'Access card', headset: 'Headset',
  keyboard: 'Keyboard', mouse: 'Mouse', other: 'Other',
}
const ASSET_TYPE_ICON = {
  laptop: 'fa-laptop', desktop: 'fa-desktop', monitor: 'fa-tv', phone: 'fa-mobile-screen',
  sim: 'fa-sim-card', id_card: 'fa-id-card', access_card: 'fa-id-badge',
  headset: 'fa-headset', keyboard: 'fa-keyboard', mouse: 'fa-computer-mouse', other: 'fa-box',
}
const ASSET_STATUS_BADGE = {
  available: '<span class="badge badge-green">Available</span>',
  assigned:  '<span class="badge badge-yellow">Assigned</span>',
  returned:  '<span class="badge badge-blue">Returned</span>',
  retired:   '<span class="badge">Retired</span>',
  lost:      '<span class="badge badge-red">Lost</span>',
}

async function renderHrAssetsView(el) {
  el.innerHTML = hrLoadingHTML()
  try {
    const canManage = hrCanManage('assets')
    const [assetRes, usersRes] = await Promise.all([
      API.get('/assets'),
      canManage ? hrFetchEmployees() : Promise.resolve({ users: [] }),
    ])
    const list = assetRes.assets || assetRes.data || []
    window._hrEmployees = usersRes.users || usersRes.data || []
    window._hrAssetsById = Object.fromEntries(list.map(a => [a.id, a]))

    let filtered = list
    if (_hrAssetStatus) filtered = filtered.filter(a => a.status === _hrAssetStatus)
    if (_hrAssetType) filtered = filtered.filter(a => a.asset_type === _hrAssetType)
    const pagination = paginateClient(filtered, _hrAssetPage, 12)
    _hrAssetPage = pagination.page

    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">${canManage ? 'Asset Register' : 'My Assets'}</h1>
          <p class="page-subtitle">${canManage ? 'Track company equipment and who has what' : 'Equipment currently assigned to you'}</p>
        </div>
        ${canManage ? `<div class="page-actions">
          <button class="btn btn-primary" onclick="openAssetModal()"><i class="fas fa-plus"></i> Add Asset</button>
        </div>` : ''}
      </div>

      <div class="grid-4" style="margin-bottom:16px">
        ${miniStatCard('Total',      list.length, '#FF7A45', 'fa-box-archive')}
        ${miniStatCard('Available',  list.filter(a => a.status === 'available').length, '#58C68A', 'fa-circle-check')}
        ${miniStatCard('Assigned',   list.filter(a => a.status === 'assigned').length, '#FFCB47', 'fa-user-check')}
        ${miniStatCard('Retired/lost', list.filter(a => a.status === 'retired' || a.status === 'lost').length, '#FF5E3A', 'fa-trash')}
      </div>

      <div style="display:flex;gap:14px;margin-bottom:14px;flex-wrap:wrap">
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${hrFilterButtons([
            { value: '',          label: 'Any status', activeStyle: 'background:rgba(255,122,69,.15);color:#FFB347' },
            { value: 'available', label: 'Available',  activeStyle: 'background:rgba(88,198,138,.15);color:#86E0A8' },
            { value: 'assigned',  label: 'Assigned',   activeStyle: 'background:rgba(255,203,71,.15);color:#FFD986' },
            { value: 'retired',   label: 'Retired',    activeStyle: 'background:rgba(255,255,255,.07)' },
            { value: 'lost',      label: 'Lost',       activeStyle: 'background:rgba(255,94,58,.15);color:#FF8866' },
          ], _hrAssetStatus, 'hrAssetSetStatus')}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${hrFilterButtons([
            { value: '',          label: 'Any type', activeStyle: 'background:rgba(100,160,255,.15);color:#A8C8FF' },
            { value: 'laptop',    label: 'Laptop',   activeStyle: 'background:rgba(100,160,255,.15);color:#A8C8FF' },
            { value: 'phone',     label: 'Phone',    activeStyle: 'background:rgba(100,160,255,.15);color:#A8C8FF' },
            { value: 'id_card',   label: 'ID card',  activeStyle: 'background:rgba(100,160,255,.15);color:#A8C8FF' },
            { value: 'other',     label: 'Other',    activeStyle: 'background:rgba(100,160,255,.15);color:#A8C8FF' },
          ], _hrAssetType, 'hrAssetSetType')}
        </div>
      </div>

      <div class="card"><div class="card-body" style="padding:0">
        <table class="data-table">
          <thead><tr>
            <th>Asset</th><th>Tag / serial</th><th>Status</th><th>Assigned to</th><th>Since</th><th style="width:170px">Actions</th>
          </tr></thead>
          <tbody>
            ${pagination.total === 0
              ? hrEmptyRow(6, 'fa-box-archive', 'No assets in the register.')
              : pagination.items.map(a => renderAssetRow(a, canManage)).join('')}
          </tbody>
        </table>
        ${renderPager(pagination, 'hrAssetPage', 'hrAssetPage', 'assets')}
      </div></div>`
  } catch (e) {
    el.innerHTML = hrErrorHTML(e.message)
  }
}

function renderAssetRow(a, canManage) {
  const icon = ASSET_TYPE_ICON[a.asset_type] || 'fa-box'
  const typeLabel = ASSET_TYPE_LABEL[a.asset_type] || a.asset_type
  return `<tr>
    <td><div style="display:flex;align-items:center;gap:10px"><i class="fas ${icon}" style="color:#FFB347;font-size:18px;width:22px;text-align:center"></i><div><div style="font-size:13px;color:#FFF1E6;font-weight:600">${escapeInbox(a.name)}</div><div style="font-size:11px;color:#9F8678">${escapeInbox(typeLabel)}</div></div></div></td>
    <td style="font-family:monospace;font-size:12px;color:#E8D2BD">${escapeInbox(a.tag || '—')}</td>
    <td>${ASSET_STATUS_BADGE[a.status] || `<span class="badge">${escapeInbox(a.status)}</span>`}</td>
    <td>${a.assigned_to_name
      ? `<div style="display:flex;align-items:center;gap:6px">${avatar(a.assigned_to_name, a.assigned_to_avatar_color, 'sm')}<span style="font-size:12px;color:#FFF1E6">${escapeInbox(a.assigned_to_name)}</span></div>`
      : '<span style="font-size:12px;color:#9F8678">—</span>'}</td>
    <td style="font-size:12px;color:#9F8678">${a.assigned_at ? fmtDate(a.assigned_at) : '—'}</td>
    <td>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="btn btn-icon btn-xs" onclick="openAssetDetail('${a.id}')" title="View"><i class="fas fa-eye"></i></button>
        ${canManage && a.status === 'available' ? `<button class="btn btn-xs btn-outline" onclick="openAssignAssetModal('${a.id}')" title="Assign"><i class="fas fa-user-plus"></i></button>` : ''}
        ${canManage && a.status === 'assigned' ? `<button class="btn btn-xs btn-outline" onclick="openReturnAssetModal('${a.id}')" title="Return"><i class="fas fa-rotate-left"></i></button>` : ''}
        ${canManage ? `<button class="btn btn-icon btn-xs" onclick="deleteAsset('${a.id}')" title="Delete"><i class="fas fa-trash"></i></button>` : ''}
      </div>
    </td>
  </tr>`
}

function hrAssetSetStatus(s) { _hrAssetStatus = s || ''; _hrAssetPage = 1; hrReloadPage('page-hr-assets') }
function hrAssetSetType(t) { _hrAssetType = t || ''; _hrAssetPage = 1; hrReloadPage('page-hr-assets') }
function hrAssetPage(p) { _hrAssetPage = Math.max(1, Number(p) || 1); hrReloadPage('page-hr-assets') }

function openAssetModal() {
  if (!hrCanManage('assets')) { toast('Not allowed', 'error'); return }
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-box-archive" style="color:var(--accent);margin-right:6px"></i>Add Asset</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Name *</label><input id="asset-name" class="form-input" placeholder="e.g. MacBook Pro 14&quot; 2023"/></div>
        <div class="form-group">
          <label class="form-label">Type *</label>
          <select id="asset-type" class="form-select">
            ${Object.keys(ASSET_TYPE_LABEL).map(k => `<option value="${k}">${ASSET_TYPE_LABEL[k]}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Tag / serial</label><input id="asset-tag" class="form-input" placeholder="Serial number or asset tag"/></div>
        <div class="form-group"><label class="form-label">Purchase date</label><input id="asset-purchase-date" class="form-input" type="date"/></div>
      </div>
      <div class="form-group"><label class="form-label">Purchase cost</label><input id="asset-cost" class="form-input" type="number" min="0" step="0.01" placeholder="Optional"/></div>
      <div class="form-group" style="margin-bottom:0"><label class="form-label">Notes</label><textarea id="asset-notes" class="form-textarea" rows="2" placeholder="Optional"></textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitAsset()"><i class="fas fa-save"></i> Save</button>
    </div>
  `, 'modal-lg')
}

async function submitAsset() {
  const payload = {
    name:          document.getElementById('asset-name')?.value.trim(),
    asset_type:    document.getElementById('asset-type')?.value,
    tag:           document.getElementById('asset-tag')?.value.trim() || null,
    purchase_date: document.getElementById('asset-purchase-date')?.value || null,
    purchase_cost: document.getElementById('asset-cost')?.value || null,
    notes:         document.getElementById('asset-notes')?.value.trim() || null,
  }
  if (!payload.name || !payload.asset_type) { toast('Name and type are required', 'error'); return }
  try { await API.post('/assets', payload); toast('Asset added', 'success'); closeModal(); hrReloadPage('page-hr-assets') }
  catch (e) { toast('Failed: ' + e.message, 'error') }
}

function openAssignAssetModal(id) {
  if (!hrCanManage('assets')) { toast('Not allowed', 'error'); return }
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-user-plus" style="color:var(--accent);margin-right:6px"></i>Assign Asset</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px">
      <div class="form-group" style="margin-bottom:0"><label class="form-label">Employee *</label><select id="assign-user" class="form-select">${hrEmployeeOptions(window._hrEmployees || [])}</select></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitAssetAssign('${id}')"><i class="fas fa-check"></i> Assign</button>
    </div>
  `)
}
async function submitAssetAssign(id) {
  const user_id = document.getElementById('assign-user')?.value
  if (!user_id) { toast('Pick an employee', 'error'); return }
  try { await API.post('/assets/' + id + '/assign', { user_id }); toast('Asset assigned', 'success'); closeModal(); hrReloadPage('page-hr-assets') }
  catch (e) { toast('Failed: ' + e.message, 'error') }
}

function openReturnAssetModal(id) {
  if (!hrCanManage('assets')) { toast('Not allowed', 'error'); return }
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-rotate-left" style="color:var(--accent);margin-right:6px"></i>Return Asset</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div class="form-group"><label class="form-label">Condition note</label><textarea id="ret-note" class="form-textarea" rows="2" placeholder="e.g. Screen scratched, keyboard fine"></textarea></div>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="ret-retire"/>
        <span style="font-size:13px;color:#FFF1E6">Mark as retired (don't reissue)</span>
      </label>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitAssetReturn('${id}')"><i class="fas fa-check"></i> Return</button>
    </div>
  `)
}
async function submitAssetReturn(id) {
  const condition_note = document.getElementById('ret-note')?.value.trim() || null
  const retire = !!document.getElementById('ret-retire')?.checked
  try { await API.post('/assets/' + id + '/return', { condition_note, retire }); toast('Asset returned', 'success'); closeModal(); hrReloadPage('page-hr-assets') }
  catch (e) { toast('Failed: ' + e.message, 'error') }
}

function openAssetDetail(id) {
  const a = (window._hrAssetsById || {})[id]
  if (!a) { toast('Asset not found', 'error'); return }
  const icon = ASSET_TYPE_ICON[a.asset_type] || 'fa-box'
  const typeLabel = ASSET_TYPE_LABEL[a.asset_type] || a.asset_type
  showModal(`
    <div class="modal-header">
      <h3><i class="fas ${icon}" style="color:var(--accent);margin-right:6px"></i>${escapeInbox(a.name)}</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;border-radius:12px;background:rgba(255,122,69,0.06);border:1px solid rgba(255,122,69,0.2)">
        <div>
          <div style="font-size:14px;font-weight:700;color:#FFF1E6">${escapeInbox(a.name)}</div>
          <div style="font-size:12px;color:#9F8678">${escapeInbox(typeLabel)}${a.tag ? ' · ' + escapeInbox(a.tag) : ''}</div>
        </div>
        ${ASSET_STATUS_BADGE[a.status] || ''}
      </div>
      <div class="grid-2">
        ${a.purchase_date ? `<div><div style="font-size:11px;color:#9F8678;text-transform:uppercase">Purchased</div><div style="font-size:13px;color:#FFF1E6">${fmtDate(a.purchase_date)}</div></div>` : ''}
        ${a.purchase_cost != null ? `<div><div style="font-size:11px;color:#9F8678;text-transform:uppercase">Cost</div><div style="font-size:13px;color:#FFF1E6">${hrFmtMoney(a.purchase_cost)}</div></div>` : ''}
        ${a.assigned_to_name ? `<div><div style="font-size:11px;color:#9F8678;text-transform:uppercase">Assigned to</div><div style="font-size:13px;color:#FFF1E6">${escapeInbox(a.assigned_to_name)}</div></div>` : ''}
        ${a.assigned_at ? `<div><div style="font-size:11px;color:#9F8678;text-transform:uppercase">Assigned since</div><div style="font-size:13px;color:#FFF1E6">${fmtDate(a.assigned_at)}</div></div>` : ''}
        ${a.returned_at ? `<div><div style="font-size:11px;color:#9F8678;text-transform:uppercase">Last returned</div><div style="font-size:13px;color:#FFF1E6">${fmtDate(a.returned_at)}</div></div>` : ''}
      </div>
      ${a.notes ? `<div><div style="font-size:11px;color:#9F8678;text-transform:uppercase;margin-bottom:4px">Notes</div><div style="font-size:13px;color:#FFF1E6;padding:10px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06)">${escapeInbox(a.notes)}</div></div>` : ''}
      ${a.last_return_note ? `<div><div style="font-size:11px;color:#9F8678;text-transform:uppercase;margin-bottom:4px">Last return note</div><div style="font-size:13px;color:#FFF1E6;padding:10px;border-radius:8px;background:rgba(255,122,69,0.05);border:1px solid rgba(255,122,69,0.18)">${escapeInbox(a.last_return_note)}</div></div>` : ''}
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Close</button>
    </div>
  `)
}

async function deleteAsset(id) {
  if (!confirm('Delete this asset from the register?')) return
  try { await API.delete('/assets/' + id); toast('Deleted', 'success'); hrReloadPage('page-hr-assets') }
  catch (e) { toast('Failed: ' + e.message, 'error') }
}
