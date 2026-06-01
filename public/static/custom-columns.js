// ═══════════════════════════════════════════════════════════
// custom-columns.js — reusable client-side custom-columns engine
// ═══════════════════════════════════════════════════════════
// Generic version of the project-task custom columns, shared by the SALES
// (lead) tasks table and the ATTENDANCE table. Each registry talks to its own
// backend columns API (/api/<base>) and patches values back onto the host
// record via a caller-supplied save function.
//
// Usage:
//   const reg = CustomColumns.register('sales', {
//     apiBase: '/lead-task-columns',          // columns CRUD endpoint
//     canManage: () => hasPermission('leads.manage_task_columns'),
//     save: (recordId, customValues) =>       // persist custom_values patch
//        API.patch('/leads/tasks/' + recordId, { custom_values: customValues }),
//     onChange: () => reloadTheTable(),        // re-render after column add/edit/delete
//   })
//   await reg.load()
//   reg.headerCells()                          // -> '<th>…</th>…'
//   reg.bodyCells(record)                      // -> '<td>…</td>…'  (editable)
//   reg.manageButton()                         // -> '<button>Columns</button>' or ''
//
// Depends on globals already present in the app bundle: escapeHtml, toast,
// showModal, closeModal, and (for date display) a fmtDate-like formatter is
// NOT required — dates are shown raw to stay dependency-free here.

const CustomColumns = (function () {
  const registries = {}

  function esc(v) { return (typeof escapeHtml === 'function') ? escapeHtml(v == null ? '' : String(v)) : String(v == null ? '' : v) }

  function multiList(v) {
    if (Array.isArray(v)) return v.map(String)
    if (v == null || v === '') return []
    if (typeof v === 'boolean') return v ? ['true'] : []
    return [String(v)]
  }
  function labelFor(col, value) {
    const o = (col.options || []).find(o => String(o.value) === String(value))
    return o ? o.label : value
  }

  class Registry {
    constructor(ns, cfg) {
      this.ns = ns
      this.cfg = cfg
      this.columns = []
      // Records rendered this pass, by id — so a value change can hand the
      // FULL record back to cfg.save (attendance needs user_id+date to upsert).
      this._records = {}
    }
    async load() {
      try {
        const r = await API.get(this.cfg.apiBase)
        this.columns = (r.columns || r.data || []).slice().sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
      } catch { this.columns = [] }
      return this.columns
    }
    canManage() { try { return !!this.cfg.canManage() } catch { return false } }

    headerCells() {
      return this.columns.map(c =>
        `<th style="white-space:nowrap">${esc(c.label)}</th>`).join('')
    }

    // Labeled editable fields for a card/detail layout (used where there's no
    // table to hang <td> cells on, e.g. the sales follow-up cards).
    fields(record) {
      if (!this.columns.length) return ''
      const id = record[this.cfg.idField || 'id']
      this._records[id] = record
      const cv = record.custom_values || {}
      return `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">` + this.columns.map(c =>
        `<div style="flex:1;min-width:140px"><div style="font-size:10px;color:#7E7E8F;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px">${esc(c.label)}</div>${this._cellInput(id, c, cv[c.key])}</div>`).join('') + `</div>`
    }

    // Read-only-ish editable cell — inline inputs that save on change.
    bodyCells(record) {
      const id = record[this.cfg.idField || 'id']
      this._records[id] = record
      const cv = record.custom_values || {}
      return this.columns.map(c => `<td data-tc-cell="${esc(c.key)}">${this._cellInput(id, c, cv[c.key])}</td>`).join('')
    }

    _cellInput(recordId, col, value) {
      const ns = this.ns
      const k = esc(col.key)
      const rid = esc(recordId)
      const common = `data-tc-ns="${ns}" data-tc-key="${k}" data-tc-rec="${rid}"`
      const sel = `style="width:100%;min-width:90px;background:rgba(11,11,13,.4);border:1px solid rgba(179,136,255,.25);border-radius:6px;color:#e2e8f0;font-size:12px;padding:4px 6px"`
      if (col.type === 'text') {
        return `<input type="text" ${common} value="${esc(value)}" ${sel} onchange="CustomColumns.onInput(this)"/>`
      }
      if (col.type === 'textarea') {
        return `<textarea ${common} rows="1" ${sel} onchange="CustomColumns.onInput(this)">${esc(value)}</textarea>`
      }
      if (col.type === 'date') {
        return `<input type="date" ${common} value="${esc(value)}" ${sel} onchange="CustomColumns.onInput(this)"/>`
      }
      if (col.type === 'radio' || col.type === 'dropdown') {
        const cur = (col.type === 'dropdown') ? multiList(value) : [value == null ? '' : String(value)]
        const opts = (col.options || []).map(o =>
          `<option value="${esc(o.value)}" ${cur.includes(String(o.value)) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')
        const multi = col.type === 'dropdown' ? 'multiple' : ''
        const blank = col.type === 'radio' ? `<option value="">—</option>` : ''
        return `<select ${common} ${multi} ${sel} onchange="CustomColumns.onSelect(this)">${blank}${opts}</select>`
      }
      if (col.type === 'checkbox') {
        const cur = multiList(value)
        return `<div ${common} style="display:flex;flex-wrap:wrap;gap:6px">` + (col.options || []).map(o =>
          `<label style="font-size:11px;color:#cbd5e1;display:inline-flex;align-items:center;gap:3px"><input type="checkbox" value="${esc(o.value)}" ${cur.includes(String(o.value)) ? 'checked' : ''} onchange="CustomColumns.onCheckbox(this,'${ns}','${k}','${rid}')"/>${esc(o.label)}</label>`).join('') + `</div>`
      }
      return esc(value)
    }

    async _save(recordId, key, val) {
      try {
        const record = this._records[recordId] || { id: recordId }
        await this.cfg.save(record, { [key]: val })
      } catch (e) { if (typeof toast === 'function') toast(e.message || 'Save failed', 'error') }
    }

    manageButton() {
      if (!this.canManage()) return ''
      return `<button class="btn btn-sm btn-outline" onclick="CustomColumns.openManage('${this.ns}')"><i class="fas fa-table-columns"></i> Columns</button>`
    }
  }

  // ── value-change handlers (called from inline on* attrs) ──
  function regOf(el) { return registries[el.getAttribute('data-tc-ns')] }
  function onInput(el) {
    const reg = registries[el.getAttribute('data-tc-ns')]; if (!reg) return
    const v = String(el.value || '').trim()
    reg._save(el.getAttribute('data-tc-rec'), el.getAttribute('data-tc-key'), v === '' ? null : v)
  }
  function onSelect(el) {
    const reg = registries[el.getAttribute('data-tc-ns')]; if (!reg) return
    let v
    if (el.multiple) v = Array.from(el.selectedOptions).map(o => o.value).filter(Boolean)
    else v = el.value || null
    if (Array.isArray(v) && !v.length) v = null
    reg._save(el.getAttribute('data-tc-rec'), el.getAttribute('data-tc-key'), v)
  }
  function onCheckbox(input, ns, key, rid) {
    const reg = registries[ns]; if (!reg) return
    const wrap = input.closest('[data-tc-key]')
    const vals = Array.from(wrap.querySelectorAll('input[type=checkbox]')).filter(c => c.checked).map(c => c.value)
    reg._save(rid, key, vals.length ? vals : null)
  }

  // ── manage-columns modal ──
  const TYPES = [
    { value: 'text', label: 'Text' },
    { value: 'textarea', label: 'Text area' },
    { value: 'date', label: 'Date' },
    { value: 'dropdown', label: 'Dropdown (multi-select)' },
    { value: 'radio', label: 'Single choice' },
    { value: 'checkbox', label: 'Checkboxes (multi)' },
  ]
  function needsOptions(t) { return t === 'dropdown' || t === 'radio' || t === 'checkbox' }

  async function openManage(ns) {
    const reg = registries[ns]; if (!reg) return
    if (!reg.canManage()) { if (typeof toast === 'function') toast('Not allowed', 'error'); return }
    await reg.load()
    renderManage(ns)
  }
  function renderManage(ns) {
    const reg = registries[ns]
    const cols = reg.columns
    const atLimit = cols.length >= 20
    const rows = cols.length ? cols.map(c => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(11,11,13,.5);border:1px solid rgba(179,136,255,.18);border-radius:8px">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;color:#e2e8f0">${esc(c.label)}</div>
          <div style="font-size:11px;color:#7E7E8F">${esc(c.type)}${(c.options && c.options.length) ? ' • ' + c.options.length + ' options' : ''}</div>
        </div>
        <button class="btn btn-sm btn-outline" onclick="CustomColumns.editCol('${ns}','${esc(c.id)}')"><i class="fas fa-pen"></i></button>
        <button class="btn btn-sm btn-outline" style="border-color:rgba(255,94,58,.4);color:#FF5E3A" onclick="CustomColumns.deleteCol('${ns}','${esc(c.id)}','${esc(c.label).replace(/'/g, '')}')"><i class="fas fa-trash"></i></button>
      </div>`).join('') : '<div style="font-size:12px;color:#7E7E8F;text-align:center;padding:14px">No custom columns yet.</div>'
    showModal(`
      <div class="modal-header"><h3><i class="fas fa-table-columns" style="color:#A970FF"></i> Manage Columns</h3><button class="close-btn" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <div style="font-size:12px;color:#7E7E8F;margin-bottom:10px">${cols.length}/20 custom columns</div>
        <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px">${rows}</div>
        ${atLimit ? '<div style="font-size:12px;color:#FF5E3A">Column limit reached. Delete one to add another.</div>' : `
        <div style="border-top:1px solid rgba(179,136,255,.18);padding-top:14px">
          <div style="font-size:13px;font-weight:600;color:#e2e8f0;margin-bottom:8px">Add column</div>
          <div class="form-group"><label class="form-label">Label</label><input class="form-input" id="cc-label" placeholder="e.g. Region"/></div>
          <div class="form-group"><label class="form-label">Type</label>
            <select class="form-select" id="cc-type" onchange="CustomColumns.toggleOptions()">${TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}</select></div>
          <div class="form-group" id="cc-options-wrap" style="display:none"><label class="form-label">Options (one per line)</label><textarea class="form-input" id="cc-options" rows="3" placeholder="High&#10;Medium&#10;Low"></textarea></div>
          <button class="btn btn-primary" onclick="CustomColumns.submitNew('${ns}')"><i class="fas fa-plus"></i> Add Column</button>
        </div>`}
      </div>
      <div class="modal-footer"><button class="btn btn-outline" onclick="closeModal()">Close</button></div>`, 'modal-md')
  }
  function toggleOptions() {
    const t = document.getElementById('cc-type')?.value
    const wrap = document.getElementById('cc-options-wrap')
    if (wrap) wrap.style.display = needsOptions(t) ? '' : 'none'
  }
  function parseOptions() {
    return (document.getElementById('cc-options')?.value || '')
      .split('\n').map(s => s.trim()).filter(Boolean).map(s => ({ value: s, label: s }))
  }
  async function submitNew(ns) {
    const reg = registries[ns]; if (!reg) return
    const label = (document.getElementById('cc-label')?.value || '').trim()
    const type = document.getElementById('cc-type')?.value
    if (!label) return toast('Label is required', 'error')
    const options = needsOptions(type) ? parseOptions() : []
    if (needsOptions(type) && !options.length) return toast('Add at least one option', 'error')
    try {
      await API.post(reg.cfg.apiBase, { label, type, options })
      await reg.load(); renderManage(ns)
      if (reg.cfg.onChange) reg.cfg.onChange()
    } catch (e) { toast(e.message, 'error') }
  }
  async function editCol(ns, id) {
    const reg = registries[ns]; const c = reg.columns.find(x => String(x.id) === String(id)); if (!c) return
    showModal(`
      <div class="modal-header"><h3>Edit Column</h3><button class="close-btn" onclick="closeModal()">✕</button></div>
      <div class="modal-body">
        <div class="form-group"><label class="form-label">Label</label><input class="form-input" id="cc-label" value="${esc(c.label)}"/></div>
        <div class="form-group"><label class="form-label">Type</label>
          <select class="form-select" id="cc-type" onchange="CustomColumns.toggleOptions()">${TYPES.map(t => `<option value="${t.value}" ${t.value === c.type ? 'selected' : ''}>${t.label}</option>`).join('')}</select></div>
        <div class="form-group" id="cc-options-wrap" style="display:${needsOptions(c.type) ? '' : 'none'}"><label class="form-label">Options (one per line)</label><textarea class="form-input" id="cc-options" rows="3">${esc((c.options || []).map(o => o.label).join('\n'))}</textarea></div>
      </div>
      <div class="modal-footer"><button class="btn btn-outline" onclick="CustomColumns.openManage('${ns}')">Back</button><button class="btn btn-primary" onclick="CustomColumns.submitEdit('${ns}','${esc(id)}')"><i class="fas fa-save"></i> Save</button></div>`, 'modal-md')
  }
  async function submitEdit(ns, id) {
    const reg = registries[ns]; if (!reg) return
    const label = (document.getElementById('cc-label')?.value || '').trim()
    const type = document.getElementById('cc-type')?.value
    if (!label) return toast('Label is required', 'error')
    const options = needsOptions(type) ? parseOptions() : []
    if (needsOptions(type) && !options.length) return toast('Add at least one option', 'error')
    try {
      await API.patch(reg.cfg.apiBase + '/' + id, { label, type, options })
      await reg.load(); renderManage(ns)
      if (reg.cfg.onChange) reg.cfg.onChange()
    } catch (e) { toast(e.message, 'error') }
  }
  async function deleteCol(ns, id, label) {
    const reg = registries[ns]; if (!reg) return
    if (!confirm(`Delete column "${label}"? Its values will be removed from all rows.`)) return
    try {
      await API.delete(reg.cfg.apiBase + '/' + id)
      await reg.load(); renderManage(ns)
      if (reg.cfg.onChange) reg.cfg.onChange()
    } catch (e) { toast(e.message, 'error') }
  }

  return {
    register(ns, cfg) { const r = new Registry(ns, cfg); registries[ns] = r; return r },
    get(ns) { return registries[ns] },
    onInput, onSelect, onCheckbox,
    openManage, toggleOptions, submitNew, editCol, submitEdit, deleteCol,
  }
})()
