// HR · Calendar
// Backed by /api/calendar. Manage permission: hr.calendar.manage.
// Everyone authenticated can VIEW the calendar — only manage permission
// grants add/delete on events.

let _hrCalMonth = ''

async function renderHRCalendarView(el) {
  if (!_hrCalMonth) _hrCalMonth = hrCurrentMonthISO()
  el.innerHTML = hrLoadingHTML()
  try {
    const canManage = hrCanManage('calendar')
    const res = await API.get('/calendar')
    const events = res.events || res.data || []
    window._hrCalEvents = events

    const [y, m] = _hrCalMonth.split('-').map(Number)
    const monthStart = new Date(y, m - 1, 1)
    const monthEnd   = new Date(y, m, 0)
    const monthEvents = events.filter(ev => {
      const s = (ev.start_date || '').slice(0, 10)
      const e = (ev.end_date   || ev.start_date || '').slice(0, 10)
      return s <= `${_hrCalMonth}-31` && e >= `${_hrCalMonth}-01`
    })

    const firstWeekday = monthStart.getDay()
    const daysInMonth  = monthEnd.getDate()
    const cells = []
    for (let i = 0; i < firstWeekday; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(d)
    while (cells.length % 7) cells.push(null)

    const monthLabel = monthStart.toLocaleString(undefined, { month: 'long', year: 'numeric' })

    // Everyone gets the "Add Event" button — non-managers can still add
    // personal events for themselves. The visibility toggle inside the modal
    // is what locks "Company" events down to hr.calendar.manage.
    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Calendar</h1>
          <p class="page-subtitle">Company events + your personal reminders (client meetings, follow-ups, etc.)</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary" onclick="openCalendarEventModal()"><i class="fas fa-plus"></i> Add Event</button>
        </div>
      </div>

      <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px">
        <button class="btn btn-sm btn-outline" onclick="hrCalShift(-1)"><i class="fas fa-chevron-left"></i></button>
        <div style="font-weight:700;color:#FFF1E6;min-width:180px;text-align:center">${monthLabel}</div>
        <button class="btn btn-sm btn-outline" onclick="hrCalShift(1)"><i class="fas fa-chevron-right"></i></button>
        <button class="btn btn-sm btn-outline" onclick="hrCalGotoToday()" style="margin-left:8px">Today</button>
      </div>

      <div class="card" style="margin-bottom:18px"><div class="card-body" style="padding:14px">
        ${renderCalendarGrid(cells, monthEvents)}
      </div></div>

      <div class="card"><div class="card-body" style="padding:0">
        <table class="data-table">
          <thead><tr>
            <th>Title</th><th>Visibility</th><th>Type</th><th>When</th><th>Description</th><th style="width:80px">Actions</th>
          </tr></thead>
          <tbody>
            ${monthEvents.length === 0
              ? hrEmptyRow(6, 'fa-calendar-days', 'No events this month.')
              : monthEvents.map(ev => renderCalendarRow(ev, canManage)).join('')}
          </tbody>
        </table>
      </div></div>`
  } catch (e) {
    el.innerHTML = hrErrorHTML(e.message)
  }
}

function renderCalendarGrid(cells, monthEvents) {
  return `
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;font-size:11px;color:#9F8678;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">
      ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => `<div style="text-align:center;padding:4px">${d}</div>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">
      ${cells.map(d => {
        if (d === null) return `<div style="min-height:74px"></div>`
        const dateStr = `${_hrCalMonth}-${String(d).padStart(2,'0')}`
        const isToday = dateStr === hrTodayISO()
        const dayEvents = monthEvents.filter(ev => {
          const s = (ev.start_date || '').slice(0, 10)
          const e = (ev.end_date   || ev.start_date || '').slice(0, 10)
          return s <= dateStr && e >= dateStr
        })
        return `<div style="min-height:74px;border-radius:10px;padding:6px;background:${isToday ? 'rgba(255,122,69,0.12)' : 'rgba(255,255,255,0.03)'};border:1px solid ${isToday ? 'rgba(255,122,69,0.4)' : 'rgba(255,255,255,0.06)'}">
          <div style="font-size:11px;font-weight:700;color:${isToday ? '#FFB347' : '#FFF1E6'};margin-bottom:4px">${d}</div>
          ${dayEvents.slice(0,3).map(ev => {
            const v = ev.visibility || 'company'
            const icon = v === 'personal' ? '<i class="fas fa-user-lock" style="font-size:9px;margin-right:3px;opacity:.7"></i>' : ''
            const time = ev.start_time ? `<span style="opacity:.7;margin-right:3px">${ev.start_time}</span>` : ''
            return `<div style="font-size:10.5px;padding:2px 5px;border-radius:6px;background:${ev.color || '#FF7A45'}22;color:#FFE5D2;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeInbox(ev.title)}${ev.start_time ? ' @ ' + ev.start_time : ''}">${icon}${time}${escapeInbox(ev.title)}</div>`
          }).join('')}
          ${dayEvents.length > 3 ? `<div style="font-size:10px;color:#9F8678">+${dayEvents.length - 3} more</div>` : ''}
        </div>`
      }).join('')}
    </div>`
}

function _hrCalCanDelete(ev, canManage) {
  const myId = _user?.sub || _user?.id
  const visibility = ev.visibility || 'company'
  if (visibility === 'personal') return ev.created_by === myId
  return canManage
}

function _hrCalVisibilityBadge(ev) {
  const v = ev.visibility || 'company'
  return v === 'personal'
    ? '<span class="badge" style="background:rgba(100,160,255,.15);color:#A8C8FF"><i class="fas fa-user-lock"></i> Personal</span>'
    : '<span class="badge" style="background:rgba(255,122,69,.15);color:#FFB347"><i class="fas fa-building"></i> Company</span>'
}

// Compact "When" label: "12 Mar · 14:00–15:00" if same day with time, else
// just a date range. Keeps the table column narrow.
function _hrCalWhenLabel(ev) {
  const startDate = ev.start_date || ''
  const endDate   = ev.end_date || ev.start_date || ''
  const sameDay = startDate === endDate
  const timePart = (ev.start_time || ev.end_time)
    ? ` · ${ev.start_time || '—'}${ev.end_time ? '–' + ev.end_time : ''}`
    : ''
  if (sameDay) return `${fmtDate(startDate)}${timePart}`
  return `${fmtDate(startDate)} → ${fmtDate(endDate)}${timePart}`
}

function renderCalendarRow(ev, canManage) {
  const canDelete = _hrCalCanDelete(ev, canManage)
  return `<tr>
    <td style="color:#FFF1E6;font-weight:600">${escapeInbox(ev.title)}</td>
    <td>${_hrCalVisibilityBadge(ev)}</td>
    <td><span class="badge badge-blue">${escapeInbox(ev.event_type || '')}</span></td>
    <td style="font-size:12px;color:#9F8678;white-space:nowrap">${_hrCalWhenLabel(ev)}</td>
    <td style="font-size:12px;color:#E8D2BD;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeInbox(ev.description || '')}">${escapeInbox(ev.description || '—')}</td>
    <td>${canDelete ? `<button class="btn btn-icon btn-xs" onclick="deleteCalendarEvent('${ev.id}')" title="Delete"><i class="fas fa-trash"></i></button>` : ''}</td>
  </tr>`
}

function hrCalShift(delta) {
  const [y, m] = _hrCalMonth.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  _hrCalMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  hrReloadPage('page-hr-calendar')
}
function hrCalGotoToday() { _hrCalMonth = hrCurrentMonthISO(); hrReloadPage('page-hr-calendar') }

function openCalendarEventModal() {
  // No global gate anymore — non-managers can create *personal* events.
  // The visibility radio inside the modal disables the "Company" choice
  // when the user lacks hr.calendar.manage.
  const canManage = hrCanManage('calendar')
  // Default colors: blue-ish for personal, accent orange for company.
  const defaultColor = canManage ? '#FF7A45' : '#A8C8FF'
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-calendar-days" style="color:var(--accent);margin-right:6px"></i>Add Event</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div class="form-group">
        <label class="form-label">Visibility *</label>
        <div style="display:flex;gap:8px">
          <label style="flex:1;display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:8px;border:1px solid rgba(100,160,255,0.3);background:rgba(100,160,255,0.06);cursor:pointer">
            <input type="radio" name="cal-visibility" value="personal" checked/>
            <div>
              <div style="font-size:13px;color:#FFF1E6;font-weight:600"><i class="fas fa-user-lock" style="margin-right:4px"></i>Personal</div>
              <div style="font-size:11px;color:#9F8678">Only you see it — e.g. client meeting at 2 pm</div>
            </div>
          </label>
          <label style="flex:1;display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,122,69,0.3);background:rgba(255,122,69,0.05);cursor:${canManage ? 'pointer' : 'not-allowed'};opacity:${canManage ? '1' : '0.45'}">
            <input type="radio" name="cal-visibility" value="company"${canManage ? '' : ' disabled'}/>
            <div>
              <div style="font-size:13px;color:#FFF1E6;font-weight:600"><i class="fas fa-building" style="margin-right:4px"></i>Company</div>
              <div style="font-size:11px;color:#9F8678">${canManage ? 'Everyone sees it — holidays, all-hands' : 'Requires HR permission'}</div>
            </div>
          </label>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Title *</label>
        <input id="cal-title" class="form-input" placeholder="e.g. Client call with Acme"/>
      </div>
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Type *</label>
          <select id="cal-type" class="form-select">
            <option value="meeting">Meeting</option>
            <option value="event">Event</option>
            <option value="training">Training</option>
            <option value="holiday">Holiday</option>
            <option value="birthday">Birthday</option>
            <option value="anniversary">Anniversary</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Color</label>
          <input id="cal-color" class="form-input" type="color" value="${defaultColor}" style="height:38px;padding:2px"/>
        </div>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">From *</label><input id="cal-from" class="form-input" type="date" value="${hrTodayISO()}"/></div>
        <div class="form-group"><label class="form-label">To</label><input id="cal-to" class="form-input" type="date" value="${hrTodayISO()}"/></div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:8px">
          <input type="checkbox" id="cal-allday" checked onchange="hrCalToggleAllDay(this.checked)"/>
          <span style="font-size:13px;color:#FFF1E6">All-day</span>
        </label>
        <div id="cal-time-row" class="grid-2" style="display:none">
          <div class="form-group" style="margin-bottom:0"><label class="form-label">Start time</label><input id="cal-start-time" class="form-input" type="time" value="09:00"/></div>
          <div class="form-group" style="margin-bottom:0"><label class="form-label">End time</label><input id="cal-end-time" class="form-input" type="time" value="10:00"/></div>
        </div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">Description / Notes</label>
        <textarea id="cal-desc" class="form-textarea" rows="3" placeholder="Optional details"></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitCalendarEvent()"><i class="fas fa-save"></i> Save</button>
    </div>
  `, 'modal-lg')
}

function hrCalToggleAllDay(allDay) {
  const row = document.getElementById('cal-time-row')
  if (row) row.style.display = allDay ? 'none' : 'grid'
}

async function submitCalendarEvent() {
  const start_date = document.getElementById('cal-from')?.value
  const allDay = document.getElementById('cal-allday')?.checked
  const visibility = document.querySelector('input[name="cal-visibility"]:checked')?.value || 'personal'
  const payload = {
    title:       document.getElementById('cal-title')?.value.trim(),
    event_type:  document.getElementById('cal-type')?.value,
    visibility,
    start_date,
    end_date:    document.getElementById('cal-to')?.value || start_date,
    start_time:  allDay ? null : (document.getElementById('cal-start-time')?.value || null),
    end_time:    allDay ? null : (document.getElementById('cal-end-time')?.value || null),
    color:       document.getElementById('cal-color')?.value || '#FF7A45',
    description: document.getElementById('cal-desc')?.value.trim() || null,
  }
  if (!payload.title || !payload.start_date) { toast('Title and date are required', 'error'); return }
  try {
    await API.post('/calendar', payload)
    toast('Event saved', 'success'); closeModal(); hrReloadPage('page-hr-calendar')
  } catch (e) { toast('Failed: ' + e.message, 'error') }
}

async function deleteCalendarEvent(id) {
  // Backend enforces ownership / manage perm — frontend just prompts.
  if (!confirm('Delete this event?')) return
  try { await API.delete('/calendar/' + id); toast('Deleted', 'success'); hrReloadPage('page-hr-calendar') }
  catch (e) { toast('Failed: ' + e.message, 'error') }
}
