// HR · Attendance
// Backed by /api/attendance. Manage permission: hr.attendance.manage.
// Employees without the manage permission only see their own records (server
// enforces — we just hide the manager-only controls).

// `tab` switches between the daily log and the monthly summary view. We
// keep both behind the same page so admins don't lose filter context when
// flipping between them.
let _hrAttTab = 'log'  // 'log' | 'summary'
let _hrAttFilterDate = ''
let _hrAttFilterStatus = ''
let _hrAttPage = 1
let _hrAttSummaryMonth = ''

const ATT_STATUS_BADGE = {
  present:  '<span class="badge badge-green">Present</span>',
  absent:   '<span class="badge badge-red">Absent</span>',
  half_day: '<span class="badge badge-yellow">Half day</span>',
  late:     '<span class="badge badge-yellow">Late</span>',
  on_leave: '<span class="badge badge-blue">On leave</span>',
  holiday:  '<span class="badge badge-blue">Holiday</span>',
}

// Break kinds mirror the server's BREAK_KINDS list. Icon + label drive both
// the Start Break dialog buttons and the history chips.
const BREAK_KIND_META = {
  tea:      { label: 'Tea',      icon: 'fa-mug-saucer',   color: '#A970FF' },
  lunch:    { label: 'Lunch',    icon: 'fa-utensils',     color: '#FF9F40' },
  personal: { label: 'Personal', icon: 'fa-user',         color: '#58C68A' },
  meeting:  { label: 'Meeting',  icon: 'fa-people-group', color: '#A8C8FF' },
  other:    { label: 'Other',    icon: 'fa-mug-hot',      color: '#FFB874' },
}
function _breakKindMeta(kind) {
  return BREAK_KIND_META[String(kind || 'other').toLowerCase()] || BREAK_KIND_META.other
}

async function renderAttendanceView(el) {
  el.innerHTML = hrLoadingHTML()
  try {
    const canManage = hrCanManage('attendance')
    // Non-managers can only see the daily log of their own rows; summary view
    // is a company-wide aggregate that only makes sense for HR.
    if (!canManage) _hrAttTab = 'log'

    // Always preload the employee list for managers so the Bulk modal can
    // render employees as checkboxes without a second round-trip.
    const usersRes = canManage ? await hrFetchEmployees() : { users: [] }
    window._hrEmployees = usersRes.users || usersRes.data || []

    if (_hrAttTab === 'summary' && canManage) {
      await renderAttendanceSummaryTab(el)
      return
    }

    const params = {}
    if (_hrAttFilterDate) params.date = _hrAttFilterDate
    const [rows, todayRes] = await Promise.all([
      API.get('/attendance', { params }),
      API.get('/attendance/today').catch(() => ({ data: null })),
    ])
    const list = rows.attendance || rows.data || []
    const today = todayRes.data || null
    window._hrAttToday = today

    const filtered = _hrAttFilterStatus ? list.filter(r => r.status === _hrAttFilterStatus) : list
    const pagination = paginateClient(filtered, _hrAttPage, 12)
    _hrAttPage = pagination.page

    const present = list.filter(r => r.status === 'present').length
    const absent  = list.filter(r => r.status === 'absent').length
    const late    = list.filter(r => r.status === 'late').length

    el.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Attendance</h1>
          <p class="page-subtitle">${canManage ? 'Track daily attendance for every employee' : 'Your daily attendance record'}</p>
        </div>
        ${canManage ? `<div class="page-actions" style="display:flex;gap:8px">
          <button class="btn btn-outline" onclick="openBulkAttendanceModal()"><i class="fas fa-users"></i> Bulk Mark</button>
          <button class="btn btn-primary" onclick="openAttendanceModal()"><i class="fas fa-plus"></i> Mark Attendance</button>
        </div>` : ''}
      </div>

      ${renderMyPunchCard(today)}

      ${canManage ? `<div style="display:flex;gap:6px;margin-bottom:14px;border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:0">
        <button class="btn btn-sm ${_hrAttTab==='log'?'btn-primary':'btn-outline'}" onclick="hrAttSetTab('log')" style="border-radius:6px 6px 0 0"><i class="fas fa-list"></i> Daily Log</button>
        <button class="btn btn-sm ${_hrAttTab==='summary'?'btn-primary':'btn-outline'}" onclick="hrAttSetTab('summary')" style="border-radius:6px 6px 0 0"><i class="fas fa-chart-column"></i> Monthly Summary</button>
      </div>` : ''}

      <div class="grid-4" style="margin-bottom:16px">
        ${miniStatCard('Records', list.length, '#A970FF', 'fa-user-clock')}
        ${miniStatCard('Present', present, '#58C68A', 'fa-check-circle')}
        ${miniStatCard('Absent',  absent,  '#FF5E3A', 'fa-times-circle')}
        ${miniStatCard('Late',    late,    '#C9A7FF', 'fa-hourglass-half')}
      </div>

      <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;align-items:center">
        <div class="form-group" style="margin:0">
          <label class="form-label" style="font-size:11px;margin-bottom:2px">Date</label>
          <input type="date" class="form-input" value="${_hrAttFilterDate}" onchange="hrAttSetDate(this.value)" style="height:32px"/>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end">
          ${hrFilterButtons([
            { value: '',         label: 'All',       activeStyle: 'background:rgba(169,112,255,.15);color:#C9A7FF' },
            { value: 'present',  label: 'Present',   activeStyle: 'background:rgba(88,198,138,.15);color:#86E0A8' },
            { value: 'absent',   label: 'Absent',    activeStyle: 'background:rgba(255,94,58,.15);color:#A970FF' },
            { value: 'half_day', label: 'Half day',  activeStyle: 'background:rgba(169,112,255,.15);color:#D5C0FF' },
            { value: 'late',     label: 'Late',      activeStyle: 'background:rgba(169,112,255,.15);color:#D5C0FF' },
            { value: 'on_leave', label: 'On leave',  activeStyle: 'background:rgba(169,112,255,.15);color:#A8C8FF' },
          ], _hrAttFilterStatus, 'hrAttSetStatus')}
        </div>
      </div>

      <div class="card"><div class="card-body" style="padding:0">
        <table class="data-table">
          <thead><tr>
            ${canManage ? '<th>Employee</th>' : ''}
            <th>Date</th><th>Status</th><th>Check-in</th><th>Check-out</th><th>Worked</th><th>Breaks</th><th>Approval</th><th>Note</th>${canManage ? '<th style="width:120px">Actions</th>' : ''}
          </tr></thead>
          <tbody>
            ${pagination.total === 0
              ? hrEmptyRow(canManage ? 10 : 8, 'fa-user-clock', 'No attendance records yet.')
              : pagination.items.map(r => renderAttendanceRow(r, canManage)).join('')}
          </tbody>
        </table>
        ${renderPager(pagination, 'hrAttPage', 'hrAttPage', 'records')}
      </div></div>`

    // Kick off the reverse-geocode resolver in the background. The first
    // paint shows coordinates (or the cached address if we've seen this
    // point before); the resolver overwrites with a readable label as soon
    // as Nominatim responds.
    setTimeout(_resolveAttLocChips, 0)
  } catch (e) {
    el.innerHTML = hrErrorHTML(e.message)
  }
}

// Format a "HH:mm" pair into a duration like "2h 15m". Used by the
// punch card to surface working / break time totals at a glance.
function _fmtMinutes(mins) {
  const m = Math.max(0, Math.round(Number(mins) || 0))
  if (m < 60) return m + 'm'
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`
}
// Sum the finished portions of a break list. The active break (no `end`)
// isn't counted yet — we surface it separately as the live "On break" timer.
function _breaksTotalMinutes(breaks) {
  if (!Array.isArray(breaks)) return 0
  let total = 0
  for (const b of breaks) {
    if (!b?.start || !b?.end) continue
    const [sh, sm] = String(b.start).split(':').map(Number)
    const [eh, em] = String(b.end).split(':').map(Number)
    if (![sh, sm, eh, em].every(Number.isFinite)) continue
    total += Math.max(0, (eh * 60 + em) - (sh * 60 + sm))
  }
  return total
}
function _liveMinutesSince(hhmm) {
  if (!hhmm) return 0
  const [h, m] = String(hhmm).split(':').map(Number)
  if (![h, m].every(Number.isFinite)) return 0
  const now = new Date()
  const startMin = h * 60 + m
  const nowMin = now.getHours() * 60 + now.getMinutes()
  return Math.max(0, nowMin - startMin)
}
// In-session cache of reverse-geocoded addresses, keyed by lat,lng rounded
// to 5 decimals (~1 m precision — anything finer is just GPS jitter).
// Persisted to localStorage so the user doesn't re-pay the Nominatim cost
// across navigations within the same browser session.
// Cache key bumped to v2 so users who already have the shorter v1 labels
// cached re-fetch the more detailed addresses on next load.
const _geoCache = (() => {
  try {
    const raw = localStorage.getItem('att_geo_cache_v2')
    return new Map(raw ? JSON.parse(raw) : [])
  } catch { return new Map() }
})()
function _geoCacheSave() {
  try { localStorage.setItem('att_geo_cache_v2', JSON.stringify([..._geoCache])) } catch {}
}
function _geoKey(lat, lng) {
  return `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`
}

function _renderLocChip(loc) {
  if (!loc || typeof loc !== 'object') return ''
  const lat = Number(loc.lat), lng = Number(loc.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return ''
  const href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`
  const key = _geoKey(lat, lng)
  const cached = _geoCache.get(key)
  // Initial render shows the cached label (or coords as a fallback) inside a
  // <span> that the resolver can later overwrite. data-lat/data-lng tell the
  // resolver which chips still need work.
  const text = cached || `${lat.toFixed(4)}, ${lng.toFixed(4)}`
  return `<a href="${href}" target="_blank" rel="noopener" class="att-loc-chip" data-lat="${lat}" data-lng="${lng}" title="${cached ? escapeInbox(cached + ' — open map') : 'Open captured location'}" style="font-size:10px;color:#9F8678;text-decoration:none;display:inline-flex;align-items:center;gap:3px;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
    <i class="fas fa-location-dot" style="color:#C9A7FF;flex-shrink:0"></i><span class="att-loc-text">${escapeInbox(text)}</span>
  </a>`
}

// Resolver — turns each unresolved location chip into a readable address.
// Tries BigDataCloud first (no API key, no per-second cap, works client-side
// from any origin), then falls back to Nominatim if the primary is unreachable.
// Cached results are persisted in localStorage so subsequent renders are
// instant. Failures leave the chip with a "View on map" label instead of raw
// coordinates so the chip always reads as a place reference, never as data.
let _geoResolverRunning = false
async function _reverseGeocode(lat, lng) {
  // De-dup helper for the final label — drops repeats and empties.
  function _composeLabel(parts) {
    const seen = new Set()
    const out = []
    for (const raw of parts) {
      if (!raw) continue
      const s = String(raw).trim()
      if (!s) continue
      const k = s.toLowerCase()
      if (seen.has(k)) continue
      // Skip if this part is a substring of a previously-collected one
      // (e.g. drop "Mumbai" when "Greater Mumbai" was already added).
      let subsumed = false
      for (const prev of out) if (prev.toLowerCase().includes(k)) { subsumed = true; break }
      if (subsumed) continue
      seen.add(k)
      out.push(s)
    }
    return out
  }
  // --- Primary: Nominatim — has street-level detail (road + house number
  //     + neighbourhood + city + state) which is what the user wants. Uses
  //     zoom=18 to favour pin-precise addresses over administrative areas. ---
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18&addressdetails=1`,
      { headers: { 'Accept': 'application/json' } },
    )
    if (r.ok) {
      const d = await r.json()
      const a = d.address || {}
      // Build the most specific label we can: house number + road + area + city.
      const houseRoad = [a.house_number, a.road].filter(Boolean).join(' ').trim()
      const area = a.neighbourhood || a.suburb || a.quarter || a.residential || a.hamlet || a.village || a.city_district || ''
      const city = a.city || a.town || a.municipality || a.county || ''
      const state = a.state || a.region || ''
      const composed = _composeLabel([houseRoad, area, city, state])
      if (composed.length) return composed.slice(0, 4).join(', ')
      // Last-ditch — Nominatim's display_name is the full pretty address.
      if (d.display_name) return d.display_name.split(',').slice(0, 4).join(',').trim()
    }
  } catch (e) { console.warn('[geo] nominatim failed', e) }
  // --- Fallback: BigDataCloud (city-level only, but rarely blocked) ---
  try {
    const r = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`,
    )
    if (r.ok) {
      const d = await r.json()
      const composed = _composeLabel([d.locality, d.city, d.principalSubdivision, d.countryName])
      if (composed.length) return composed.slice(0, 3).join(', ')
    }
  } catch (e) { console.warn('[geo] bigdatacloud failed', e) }
  return null
}

async function _resolveAttLocChips() {
  if (_geoResolverRunning) return
  _geoResolverRunning = true
  try {
    const chips = Array.from(document.querySelectorAll('.att-loc-chip[data-lat]:not([data-resolved])'))
    // First pass: cached labels paint synchronously so most chips become
    // readable instantly on re-renders.
    for (const chip of chips) {
      const key = _geoKey(chip.dataset.lat, chip.dataset.lng)
      const cached = _geoCache.get(key)
      if (cached) {
        const span = chip.querySelector('.att-loc-text')
        if (span) span.textContent = cached
        chip.title = cached + ' — open map'
        chip.dataset.resolved = '1'
      }
    }
    // Second pass: network lookup for the rest. Small 400ms gap between
    // requests so we don't fire all of them at once.
    for (const chip of chips) {
      if (chip.dataset.resolved === '1') continue
      const lat = chip.dataset.lat, lng = chip.dataset.lng
      const key = _geoKey(lat, lng)
      const label = await _reverseGeocode(lat, lng)
      if (label) {
        _geoCache.set(key, label)
        _geoCacheSave()
        const span = chip.querySelector('.att-loc-text')
        if (span) span.textContent = label
        chip.title = label + ' — open map'
      } else {
        // Last resort — replace raw coordinates with a friendlier "View on
        // map" hint. User can still click the chip to see the exact point.
        const span = chip.querySelector('.att-loc-text')
        if (span) span.textContent = 'View on map'
        chip.title = `Captured location — open map (${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)})`
      }
      chip.dataset.resolved = '1'
      // Respect Nominatim's 1 req/sec fair-use rate. Cached chips are
      // already painted in the first pass and skip this loop entirely.
      await new Promise(r => setTimeout(r, 1100))
    }
  } finally {
    _geoResolverRunning = false
  }
}

function renderMyPunchCard(today) {
  const hasIn = !!(today && today.check_in)
  const hasOut = !!(today && today.check_out)
  const onBreak = !!(today && today.on_break)
  const breaks = Array.isArray(today?.breaks) ? today.breaks : []
  const completedBreaks = breaks.filter(b => b?.start && b?.end)
  const activeBreak = breaks.find(b => b?.start && !b?.end) || null
  const breakTotalMins = _breaksTotalMinutes(breaks)
  // Working minutes — backend stamps a final number on punch-out, otherwise
  // we render a live count: (now - check_in) - completed-break time.
  let workingMins = Number(today?.working_minutes) || 0
  if (!hasOut && hasIn) {
    workingMins = Math.max(0, _liveMinutesSince(today.check_in) - breakTotalMins)
    if (onBreak && activeBreak) workingMins = Math.max(0, workingMins - _liveMinutesSince(activeBreak.start))
  }
  const approval = today?.approval_status || 'pending'
  const approvalLabel = !today ? 'No punch yet' : (approval === 'approved' ? 'Approved' : approval === 'rejected' ? 'Rejected' : 'Pending HR approval')
  const approvalColor = approval === 'approved' ? '#58C68A' : approval === 'rejected' ? '#FF5E3A' : '#C9A7FF'
  const rejectReason = approval === 'rejected' && today?.decision_reason
    ? `<div style="font-size:11px;color:#A970FF;margin-top:4px"><i class="fas fa-comment-dots"></i> ${escapeInbox(today.decision_reason)}</div>`
    : ''

  // Compact single-line banner: icon · kind · elapsed/planned · End Break.
  // Overrun = the "elapsed" turns red and gets a "+Xm" suffix. Note (if any)
  // is appended after a separator instead of stacking on a new line.
  let stateBanner = ''
  if (onBreak && activeBreak) {
    const liveBreak = _liveMinutesSince(activeBreak.start)
    const meta = _breakKindMeta(activeBreak.kind)
    const planned = Number(activeBreak.planned_minutes) || 0
    const overRun = planned > 0 && liveBreak > planned
    const elapsedTxt = planned ? `${_fmtMinutes(liveBreak)} / ${_fmtMinutes(planned)}` : _fmtMinutes(liveBreak)
    const elapsedColor = overRun ? '#FF7E64' : meta.color
    const overSuffix = overRun ? ` <span style="color:#FF7E64;font-weight:700">+${_fmtMinutes(liveBreak - planned)}</span>` : ''
    const noteSuffix = activeBreak.note ? ` <span style="color:#9F8678">· ${escapeInbox(activeBreak.note)}</span>` : ''
    stateBanner = `
    <div style="background:${meta.color}1A;border:1px solid ${meta.color}66;border-radius:8px;padding:6px 12px;margin-bottom:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <i class="fas ${meta.icon}" style="color:${meta.color};font-size:13px"></i>
      <div style="flex:1;min-width:0;font-size:12.5px;color:#E8D9FF">
        <strong style="color:${meta.color}">${escapeInbox(meta.label)}</strong> ·
        <span style="color:${elapsedColor};font-weight:600">${elapsedTxt}</span>${overSuffix}${noteSuffix}
      </div>
      <button class="btn btn-xs" style="background:${meta.color};color:#0F0A06" onclick="hrPunch('break_end')"><i class="fas fa-circle-stop"></i> End</button>
    </div>`
  }

  // Break history list — completed breaks only. Active break is in the banner.
  // Each chip shows the kind icon + label + actual duration; planned duration
  // surfaces in the title attribute so it's not noisy on the row but still
  // available on hover.
  // Compact chips — one badge per break, "kind · duration". Full time range
  // + planned vs actual sit in the hover title so the row stays scannable.
  const breaksList = completedBreaks.length
    ? `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed rgba(255,255,255,.08)">
        <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center">
          <span style="font-size:10px;color:#9F8678;text-transform:uppercase;letter-spacing:.5px">${completedBreaks.length} break${completedBreaks.length === 1 ? '' : 's'} · ${_fmtMinutes(breakTotalMins)}</span>
          ${completedBreaks.map(b => {
            const meta = _breakKindMeta(b.kind)
            const actualMins = _breaksTotalMinutes([b])
            const planned = Number(b.planned_minutes) || 0
            const title = `${meta.label} · ${escapeInbox(b.start)}→${escapeInbox(b.end)} · ${actualMins}m${planned ? ` (planned ${planned}m)` : ''}${b.note ? ' — ' + b.note : ''}`
            return `<span class="badge" title="${escapeInbox(title)}" style="background:${meta.color}1F;color:${meta.color};border:1px solid ${meta.color}40;font-size:11px;padding:2px 7px;display:inline-flex;align-items:center;gap:4px">
              <i class="fas ${meta.icon}" style="font-size:9px"></i>${escapeInbox(meta.label)} · ${_fmtMinutes(actualMins)}
            </span>`
          }).join('')}
        </div>
      </div>`
    : ''

  // Action buttons differ by state:
  //   not punched in → only Punch In
  //   punched in, not on break, not punched out → Start Break + Punch Out
  //   on break → ONLY End Break (everything else disabled / hidden)
  //   punched out → all disabled
  let actions = ''
  if (!hasIn) {
    actions = `<button class="btn btn-primary btn-sm" onclick="hrPunch('in')"><i class="fas fa-sign-in-alt"></i> Punch In</button>`
  } else if (onBreak) {
    // Lock the user to the End Break button — everything else is disabled.
    actions = `
      <button class="btn btn-sm" disabled style="opacity:.4;cursor:not-allowed" title="End the break first"><i class="fas fa-mug-hot"></i> On break…</button>
      <button class="btn btn-sm" disabled style="opacity:.4;cursor:not-allowed" title="End the break first"><i class="fas fa-sign-out-alt"></i> Punch Out</button>`
  } else if (!hasOut) {
    actions = `
      <button class="btn btn-sm" style="background:#FF9F40;color:#0F0A06" onclick="openStartBreakDialog()"><i class="fas fa-mug-hot"></i> Start Break</button>
      <button class="btn btn-primary btn-sm" onclick="hrPunch('out')"><i class="fas fa-sign-out-alt"></i> Punch Out</button>`
  } else {
    actions = `<button class="btn btn-outline btn-sm" disabled style="opacity:.5;cursor:not-allowed"><i class="fas fa-check"></i> Day complete</button>`
  }

  return `
  <div class="card" style="margin-bottom:14px">
    <div class="card-body" style="padding:14px 16px">
      ${stateBanner}
      <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;color:#9F8678;text-transform:uppercase;letter-spacing:.5px">My Shift Today</div>
          <div style="display:flex;align-items:center;gap:16px;margin-top:4px;flex-wrap:wrap">
            <div>
              <span style="font-size:11px;color:#7E7E8F">In:</span>
              <span style="font-weight:600;color:${hasIn?'#86E0A8':'#7E7E8F'}">${hasIn ? escapeInbox(today.check_in) : '—'}</span>
              ${hasIn ? _renderLocChip(today.check_in_location) : ''}
            </div>
            <div>
              <span style="font-size:11px;color:#7E7E8F">Out:</span>
              <span style="font-weight:600;color:${hasOut?'#86E0A8':'#7E7E8F'}">${hasOut ? escapeInbox(today.check_out) : '—'}</span>
              ${hasOut ? _renderLocChip(today.check_out_location) : ''}
            </div>
            <div>
              <span style="font-size:11px;color:#7E7E8F">${hasOut ? 'Worked:' : 'Working:'}</span>
              <span style="font-weight:700;color:#C9A7FF">${hasIn ? _fmtMinutes(workingMins) : '—'}</span>
            </div>
            ${breakTotalMins ? `<div><span style="font-size:11px;color:#7E7E8F">Break:</span> <span style="font-weight:600;color:#FFB874">${_fmtMinutes(breakTotalMins)}</span></div>` : ''}
            <div><span class="badge" style="background:${approvalColor}20;color:${approvalColor};border:1px solid ${approvalColor}40">${approvalLabel}</span></div>
          </div>
          ${rejectReason}
          ${breaksList}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${actions}</div>
      </div>
    </div>
  </div>`
}

// Capture the user's GPS with a short timeout. Returns null if denied,
// unavailable, or the user took too long — punching always proceeds so the
// employee isn't blocked by a flaky GPS chip; the server just stores
// `check_in_location: null` in that case.
function _hrGetLocation(timeoutMs = 6000) {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null)
    let settled = false
    const finish = (val) => { if (!settled) { settled = true; resolve(val) } }
    const timer = setTimeout(() => finish(null), timeoutMs)
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timer)
          finish({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy })
        },
        () => { clearTimeout(timer); finish(null) },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
      )
    } catch { clearTimeout(timer); finish(null) }
  })
}

async function hrPunch(action, extras) {
  // Resolve location first (silent failure is fine — see _hrGetLocation).
  // We do this for every action so the break in/out events also get a
  // location stamp, useful for "where did the user step away from?".
  const location = await _hrGetLocation()
  const payload = { action, location, ...(extras || {}) }
  try {
    const res = await API.post('/attendance/punch', payload)
    const labels = { in: 'Punched in', out: 'Punched out', break_start: 'Break started', break_end: 'Break ended' }
    toast(labels[action] || 'Saved', 'success')
    // Re-check overrun state immediately — without this, ending a break
    // would leave the ring playing for up to 30s until the next poll tick.
    if (typeof _breakOverrunCheck === 'function') _breakOverrunCheck()
    hrReloadPage('page-hr-attendance')
    return res
  } catch (e) { toast(e.message || 'Failed', 'error') }
}

// Quick modal that captures break kind + planned duration before the punch
// fires. The user picks one of the BREAK_KIND_META cards and a duration
// (preset chips or custom number). Cancel just closes — nothing is saved.
function openStartBreakDialog() {
  const kindCards = Object.entries(BREAK_KIND_META).map(([key, meta]) => `
    <label class="break-kind-card" style="cursor:pointer;border:1.5px solid rgba(255,255,255,.10);border-radius:10px;padding:12px;display:flex;flex-direction:column;align-items:center;gap:6px;transition:all .12s;background:rgba(255,255,255,.02);position:relative">
      <input type="radio" name="break-kind" value="${key}" ${key === 'tea' ? 'checked' : ''} style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none"/>
      <i class="fas ${meta.icon}" style="color:${meta.color};font-size:20px"></i>
      <span style="font-size:12.5px;font-weight:600;color:#E8D9FF">${escapeInbox(meta.label)}</span>
    </label>
  `).join('')
  const presetMinutes = [5, 10, 15, 30, 45, 60]
  const presetChips = presetMinutes.map(m => `
    <button type="button" class="break-mins-chip" data-mins="${m}" onclick="setBreakDuration(${m})"
      style="padding:6px 12px;border:1px solid rgba(255,255,255,.12);border-radius:999px;background:rgba(255,255,255,.03);color:#E8D9FF;font-size:12px;cursor:pointer">${m}m</button>
  `).join('')

  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-mug-hot" style="color:#FF9F40;margin-right:6px"></i>Start Break</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div class="form-group">
        <label class="form-label" style="margin-bottom:8px">Kind of break</label>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px" id="break-kind-grid">${kindCards}</div>
      </div>
      <div class="form-group">
        <label class="form-label" style="margin-bottom:8px">How long? <span style="font-size:11px;color:#9F8678">(planned)</span></label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px" id="break-mins-presets">${presetChips}</div>
        <div style="display:flex;align-items:center;gap:8px">
          <input type="number" id="break-mins" class="form-input" min="1" max="240" value="15" style="width:120px"/>
          <span style="font-size:12px;color:#9F8678">minutes (1–240)</span>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Note <span style="font-size:11px;color:#9F8678">(optional)</span></label>
        <input id="break-note" class="form-input" placeholder="e.g. doctor appointment, quick errand…"/>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitStartBreak()" style="background:#FF9F40;color:#0F0A06;border-color:#FF9F40"><i class="fas fa-play"></i> Start Break</button>
    </div>
  `, 'modal-lg')

  // Style the radio cards as visual toggles: the picked one gets a thick
  // accent border and a tinted background. Re-run on change to flip styles.
  const grid = document.getElementById('break-kind-grid')
  if (grid) {
    const paintCards = () => {
      grid.querySelectorAll('.break-kind-card').forEach(card => {
        const input = card.querySelector('input[type="radio"]')
        const meta = BREAK_KIND_META[input?.value] || BREAK_KIND_META.other
        if (input?.checked) {
          card.style.borderColor = meta.color
          card.style.background = `${meta.color}1F`
          card.style.boxShadow = `0 0 0 1px ${meta.color}40`
        } else {
          card.style.borderColor = 'rgba(255,255,255,.10)'
          card.style.background = 'rgba(255,255,255,.02)'
          card.style.boxShadow = 'none'
        }
      })
    }
    grid.addEventListener('change', paintCards)
    grid.addEventListener('click', (e) => {
      const card = e.target.closest('.break-kind-card')
      if (!card) return
      const input = card.querySelector('input[type="radio"]')
      if (input) { input.checked = true; paintCards() }
    })
    paintCards()
  }
}

// Preset-chip handler — sets the duration field and lights up the active chip.
function setBreakDuration(mins) {
  const field = document.getElementById('break-mins')
  if (field) field.value = String(mins)
  document.querySelectorAll('.break-mins-chip').forEach(chip => {
    const isActive = Number(chip.dataset.mins) === Number(mins)
    chip.style.background = isActive ? 'rgba(255,159,64,.22)' : 'rgba(255,255,255,.03)'
    chip.style.borderColor = isActive ? '#FF9F40' : 'rgba(255,255,255,.12)'
    chip.style.color = isActive ? '#FF9F40' : '#E8D9FF'
  })
}

async function submitStartBreak() {
  const kindEl = document.querySelector('input[name="break-kind"]:checked')
  const kind = kindEl?.value || 'other'
  const planned = Number(document.getElementById('break-mins')?.value || 0)
  if (!planned || planned < 1 || planned > 240) {
    toast('Planned duration must be 1–240 minutes', 'error')
    return
  }
  const note = (document.getElementById('break-note')?.value || '').trim() || null
  // Warm up the audio element inside this click handler so the browser's
  // autoplay policy considers it user-activated. Without this, the first
  // play() call when the break overruns gets silently blocked.
  try {
    if (typeof _ensureAudio === 'function') {
      const a = _ensureAudio()
      if (a) {
        a.muted = true
        const p = a.play()
        if (p && typeof p.then === 'function') {
          p.then(() => { a.pause(); a.currentTime = 0; a.muted = false; _breakRingState.audioUnlocked = true })
            .catch(() => { a.muted = false })
        }
      }
    }
  } catch {}
  closeModal()
  await hrPunch('break_start', { kind, planned_minutes: planned, note })
}

window.openStartBreakDialog = openStartBreakDialog
window.setBreakDuration = setBreakDuration
window.submitStartBreak = submitStartBreak

function _attApprovalBadge(r) {
  const s = r.approval_status || 'pending'
  const color = s === 'approved' ? '#58C68A' : s === 'rejected' ? '#FF5E3A' : '#C9A7FF'
  const label = s === 'approved' ? 'Approved' : s === 'rejected' ? 'Rejected' : 'Pending'
  // Tooltip on the badge always carries the reason (when set) so hovering
  // gives the full text. The visible "reason line" below the badge is added
  // by the caller — see renderAttendanceRow.
  const tip = r.decision_reason ? ` title="${escapeInbox(r.decision_reason)}"` : ''
  return `<span class="badge"${tip} style="background:${color}20;color:${color};border:1px solid ${color}40">${label}</span>`
}

// Inline reason line under the approval badge. Prefix the action so the
// reader can tell at a glance whether it's an Approve note or a Reject
// reason — Approve = green check, Reject = red cross. Same row stays
// compact (single line, ellipsis when too long, full text in tooltip).
function _attReasonLine(r) {
  if (!r.decision_reason) return ''
  const status = r.approval_status || 'pending'
  if (status !== 'approved' && status !== 'rejected') return ''
  const isReject = status === 'rejected'
  const color = isReject ? '#FF7E64' : '#86E0A8'
  const icon = isReject ? 'fa-circle-xmark' : 'fa-circle-check'
  const label = isReject ? 'Rejected' : 'Approved'
  return `<div style="font-size:11px;color:${color};margin-top:3px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeInbox(label + ': ' + r.decision_reason)}">
    <i class="fas ${icon}" style="margin-right:4px"></i><strong>${label}:</strong> ${escapeInbox(r.decision_reason)}
  </div>`
}

function renderAttendanceRow(r, canManage) {
  const name = r.full_name || r.email || 'Unknown'
  const isPending = (r.approval_status || 'pending') === 'pending'
  const breaks = Array.isArray(r.breaks) ? r.breaks : []
  const breakMins = _breaksTotalMinutes(breaks)
  const breakLabel = breaks.length
    ? `${breaks.filter(b => b?.start && b?.end).length || breaks.length} · ${_fmtMinutes(breakMins)}`
    : '—'
  // For an in-progress row (no check-out yet) we show the live counter so
  // managers can see how long the employee has actually been working.
  let workedLabel = '—'
  if (r.check_out) {
    workedLabel = _fmtMinutes(Number(r.working_minutes) || 0)
  } else if (r.check_in) {
    workedLabel = `${_fmtMinutes(Math.max(0, _liveMinutesSince(r.check_in) - breakMins))}…`
  }
  const inLoc = _renderLocChip(r.check_in_location)
  const outLoc = _renderLocChip(r.check_out_location)
  return `<tr>
    ${canManage ? `<td><div style="display:flex;align-items:center;gap:8px">${avatar(name, r.avatar_color, 'sm')}<span style="font-size:12.5px;color:#FFFFFF">${escapeInbox(name)}</span></div></td>` : ''}
    <td style="font-size:12px;color:#9F8678">${fmtDate(r.date)}</td>
    <td>${ATT_STATUS_BADGE[r.status] || `<span class="badge">${escapeInbox(r.status||'')}</span>`}</td>
    <td style="font-size:12px;color:#E8D9FF">${escapeInbox(r.check_in || '—')}${inLoc ? `<div style="margin-top:2px">${inLoc}</div>` : ''}</td>
    <td style="font-size:12px;color:#E8D9FF">${escapeInbox(r.check_out || '—')}${outLoc ? `<div style="margin-top:2px">${outLoc}</div>` : ''}</td>
    <td style="font-size:12px;font-weight:700;color:#C9A7FF">${workedLabel}</td>
    <td style="font-size:11.5px;color:#FFB874">${breakLabel}</td>
    <td>${_attApprovalBadge(r)}${_attReasonLine(r)}</td>
    <td style="font-size:12px;color:#E8D9FF;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeInbox(r.note || '')}">${escapeInbox(r.note || '—')}</td>
    ${canManage ? `<td>
      <div style="display:flex;gap:4px">
        ${isPending ? `<button class="btn btn-xs btn-primary" onclick="openAttDecisionDialog('${r.id}','approved')" title="Approve"><i class="fas fa-check"></i></button>
          <button class="btn btn-xs btn-outline" onclick="openAttDecisionDialog('${r.id}','rejected')" title="Reject" style="color:#FF5E3A"><i class="fas fa-xmark"></i></button>` : ''}
        <button class="btn btn-icon btn-xs" onclick="deleteAttendance('${r.id}')" title="Delete"><i class="fas fa-trash"></i></button>
      </div>
    </td>` : ''}
  </tr>`
}

// Approve/Reject dialog. Replaces the native `prompt()` so:
//   - the reason field is a real textarea (multi-line, paste-friendly)
//   - Approve can carry an OPTIONAL note (the user asked for this)
//   - Reject keeps the existing "reason required" rule (server enforces too)
function openAttDecisionDialog(id, decision) {
  const isApprove = decision === 'approved'
  const accent = isApprove ? '#58C68A' : '#FF5E3A'
  const icon = isApprove ? 'fa-check' : 'fa-xmark'
  const title = isApprove ? 'Approve Attendance' : 'Reject Attendance'
  const helpText = isApprove
    ? '<span style="color:#9F8678">Add a short note if you want — it\'s visible to the employee. Leave blank to approve without a comment.</span>'
    : '<span style="color:#FF7E64"><strong>Required.</strong> The employee will see this when they check their record.</span>'
  showModal(`
    <div class="modal-header">
      <h3><i class="fas ${icon}" style="color:${accent};margin-right:6px"></i>${title}</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:12px">
      <div class="form-group" style="margin:0">
        <label class="form-label">Reason ${isApprove ? '<span style="color:#9F8678;font-weight:400">(optional)</span>' : '<span style="color:#FF5E3A">*</span>'}</label>
        <textarea id="att-decision-reason" class="form-textarea" rows="3" maxlength="500" placeholder="${isApprove ? 'e.g. checked CCTV, confirmed punch-in time…' : 'e.g. employee was on leave, no punch-in evidence…'}"></textarea>
        <div style="font-size:11px;margin-top:6px">${helpText}</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn ${isApprove ? 'btn-primary' : 'btn-danger'}" onclick="submitAttDecision('${id}','${decision}')">
        <i class="fas ${icon}"></i> ${isApprove ? 'Approve' : 'Reject'}
      </button>
    </div>
  `, 'modal-lg')
  setTimeout(() => document.getElementById('att-decision-reason')?.focus(), 50)
}

async function submitAttDecision(id, decision) {
  const reason = (document.getElementById('att-decision-reason')?.value || '').trim()
  if (decision === 'rejected' && !reason) {
    toast('Reason is required when rejecting', 'error')
    return
  }
  try {
    await API.patch(`/attendance/${id}/decision`, { decision, reason: reason || null })
    toast(decision === 'approved' ? 'Marked approved' : 'Marked rejected', 'success')
    closeModal()
    hrReloadPage('page-hr-attendance')
  } catch (e) { toast(e.message || 'Failed', 'error') }
}

window.openAttDecisionDialog = openAttDecisionDialog
window.submitAttDecision = submitAttDecision

function hrAttSetDate(v) { _hrAttFilterDate = v || ''; _hrAttPage = 1; hrReloadPage('page-hr-attendance') }
function hrAttSetStatus(v) { _hrAttFilterStatus = v || ''; _hrAttPage = 1; hrReloadPage('page-hr-attendance') }
function hrAttPage(p) { _hrAttPage = Math.max(1, Number(p) || 1); hrReloadPage('page-hr-attendance') }

function openAttendanceModal() {
  if (!hrCanManage('attendance')) { toast('Not allowed', 'error'); return }
  const users = window._hrEmployees || []
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-user-clock" style="color:var(--accent);margin-right:6px"></i>Mark Attendance</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div class="form-group">
        <label class="form-label">Employee *</label>
        ${hrEmployeePicker('att-user', users)}
      </div>
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Date *</label>
          <input id="att-date" class="form-input" type="date" value="${hrTodayISO()}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Status *</label>
          <select id="att-status" class="form-select">
            <option value="present">Present</option>
            <option value="absent">Absent</option>
            <option value="half_day">Half day</option>
            <option value="late">Late</option>
            <option value="on_leave">On leave</option>
            <option value="holiday">Holiday</option>
          </select>
        </div>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Check-in</label><input id="att-in" class="form-input" type="time"/></div>
        <div class="form-group"><label class="form-label">Check-out</label><input id="att-out" class="form-input" type="time"/></div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">Note</label>
        <textarea id="att-note" class="form-textarea" rows="2" placeholder="Optional"></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitAttendance()"><i class="fas fa-save"></i> Save</button>
    </div>
  `, 'modal-lg')
}

async function submitAttendance() {
  const payload = {
    user_id:   document.getElementById('att-user')?.value,
    date:      document.getElementById('att-date')?.value,
    status:    document.getElementById('att-status')?.value,
    check_in:  document.getElementById('att-in')?.value || null,
    check_out: document.getElementById('att-out')?.value || null,
    note:      document.getElementById('att-note')?.value.trim() || null,
  }
  if (!payload.user_id || !payload.date || !payload.status) { toast('Employee, date, and status are required', 'error'); return }
  try {
    await API.post('/attendance', payload)
    toast('Attendance saved', 'success'); closeModal(); hrReloadPage('page-hr-attendance')
  } catch (e) { toast('Failed: ' + e.message, 'error') }
}

async function deleteAttendance(id) {
  if (!confirm('Delete this attendance record?')) return
  try { await API.delete('/attendance/' + id); toast('Deleted', 'success'); hrReloadPage('page-hr-attendance') }
  catch (e) { toast('Failed: ' + e.message, 'error') }
}

// ── Tab + Summary ──────────────────────────────────────────────
function hrAttSetTab(t) { _hrAttTab = (t === 'summary') ? 'summary' : 'log'; hrReloadPage('page-hr-attendance') }

// Monthly summary filter state — kept on window so re-renders inside the
// same tab don't have to round-trip through hrReloadPage.
let _hrAttSummarySearch = ''
let _hrAttSummaryRole = ''
let _hrAttSummaryStatusFilter = '' // '', 'absent', 'late', 'pending', 'no_data'
let _hrAttSummarySort = { col: 'full_name', dir: 'asc' }
let _hrAttSummaryCache = []

async function renderAttendanceSummaryTab(el) {
  if (!_hrAttSummaryMonth) _hrAttSummaryMonth = hrCurrentMonthISO()
  // Show a shell + spinner first so the user sees something while we fetch.
  // The toolbar is rendered AFTER the data loads so we know the role list up
  // front and can pass it straight into `searchableSelect` (a custom-styled
  // dropdown — the previous native <select> was rendering its options in
  // light-mode white because browsers don't theme native option lists).
  el.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Attendance</h1>
        <p class="page-subtitle">Monthly summary by employee</p>
      </div>
      <div class="page-actions" style="display:flex;gap:8px">
        <button class="btn btn-outline" onclick="openBulkAttendanceModal()"><i class="fas fa-users"></i> Bulk Mark</button>
        <button class="btn btn-primary" onclick="openAttendanceModal()"><i class="fas fa-plus"></i> Mark Attendance</button>
      </div>
    </div>

    <div style="display:flex;gap:6px;margin-bottom:14px;border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:0">
      <button class="btn btn-sm btn-outline" onclick="hrAttSetTab('log')" style="border-radius:6px 6px 0 0"><i class="fas fa-list"></i> Daily Log</button>
      <button class="btn btn-sm btn-primary" onclick="hrAttSetTab('summary')" style="border-radius:6px 6px 0 0"><i class="fas fa-chart-column"></i> Monthly Summary</button>
    </div>

    <div id="hr-att-summary-toolbar"></div>
    <div id="hr-att-summary-body">${hrLoadingHTML()}</div>`

  try {
    const res = await API.get('/attendance/summary', { params: { month: _hrAttSummaryMonth } })
    _hrAttSummaryCache = res.summary || res.data || []
    _renderAttSummaryToolbar()
    _renderAttSummaryTable()
  } catch (e) {
    const body = document.getElementById('hr-att-summary-body')
    if (body) body.innerHTML = hrErrorHTML(e.message)
  }
}

// Renders the filter toolbar. Kept separate from the page shell so we can
// re-render it after status-chip clicks without losing search-input focus.
function _renderAttSummaryToolbar() {
  const toolbar = document.getElementById('hr-att-summary-toolbar')
  if (!toolbar) return
  const roles = Array.from(new Set(_hrAttSummaryCache.map(r => r.role).filter(Boolean))).sort()
  const roleItems = [{ value: '', label: 'All roles' }].concat(roles.map(r => ({ value: r, label: r })))
  toolbar.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
      <input type="month" class="form-input" id="hr-att-summary-month" value="${_hrAttSummaryMonth}" onchange="hrAttSummarySetMonth(this.value)" style="height:32px;width:160px"/>
      <div style="position:relative;flex:1;min-width:220px;max-width:320px">
        <i class="fas fa-search" style="position:absolute;left:11px;top:50%;transform:translateY(-50%);font-size:11px;color:var(--text-muted);pointer-events:none"></i>
        <input id="hr-att-summary-search" class="form-input" placeholder="Search employee / email / role…" oninput="hrAttSummarySetSearch(this.value)" value="${escapeInbox(_hrAttSummarySearch)}" style="width:100%;height:32px;padding:0 12px 0 30px;font-size:12.5px"/>
      </div>
      <div style="width:180px;min-width:160px" id="hr-att-summary-role-wrap">
        ${searchableSelect('hr-att-summary-role', roleItems, _hrAttSummaryRole, { placeholder: 'All roles', onChange: (id) => { _hrAttSummaryRole = id || ''; _renderAttSummaryTable() } })}
      </div>
      <div style="display:flex;gap:4px;flex-wrap:wrap" id="hr-att-summary-chips">
        ${hrFilterButtons([
          { value: '',          label: 'All',          activeStyle: 'background:rgba(169,112,255,.15);color:#C9A7FF' },
          { value: 'absent',    label: 'Has absences', activeStyle: 'background:rgba(255,94,58,.15);color:#FF7E64' },
          { value: 'late',      label: 'Has late',     activeStyle: 'background:rgba(255,159,64,.15);color:#FFB874' },
          { value: 'pending',   label: 'Pending HR',   activeStyle: 'background:rgba(201,167,255,.15);color:#C9A7FF' },
          { value: 'no_data',   label: 'No data',      activeStyle: 'background:rgba(255,255,255,.06);color:#9F8678' },
        ], _hrAttSummaryStatusFilter, 'hrAttSummarySetStatusFilter')}
      </div>
    </div>`
  // Match the role picker's input height to the rest of the toolbar (the
  // searchableSelect helper uses the stock form-input height).
  const roleInput = document.getElementById('hr-att-summary-role-search')
  if (roleInput) {
    roleInput.style.height = '32px'
    roleInput.style.padding = '0 28px 0 10px'
    roleInput.style.fontSize = '12.5px'
  }
}

// Renders ONLY the table body — called by every filter/sort change without
// re-fetching from the server.
function _renderAttSummaryTable() {
  const body = document.getElementById('hr-att-summary-body')
  if (!body) return
  const q = _hrAttSummarySearch.trim().toLowerCase()
  const role = _hrAttSummaryRole
  const statusF = _hrAttSummaryStatusFilter
  let rows = _hrAttSummaryCache.filter(s => {
    if (role && s.role !== role) return false
    if (q) {
      const hay = `${s.full_name || ''} ${s.email || ''} ${s.designation || ''} ${s.role || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (statusF === 'absent'  && !(s.absent > 0))  return false
    if (statusF === 'late'    && !(s.late > 0))    return false
    if (statusF === 'pending' && !(s.pending_approval > 0)) return false
    if (statusF === 'no_data' && s.total > 0)      return false
    return true
  })
  // Sort
  const { col, dir } = _hrAttSummarySort
  const mul = dir === 'desc' ? -1 : 1
  rows = rows.slice().sort((a, b) => {
    const va = a[col], vb = b[col]
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mul
    return String(va || '').localeCompare(String(vb || '')) * mul
  })

  // Header counter chips so HR sees scope at a glance.
  const totalEmp = _hrAttSummaryCache.length
  const shown = rows.length
  const totalWorked = rows.reduce((s, r) => s + (r.worked_minutes || 0), 0)
  const totalBreak = rows.reduce((s, r) => s + (r.break_minutes || 0), 0)
  const totalPending = rows.reduce((s, r) => s + (r.pending_approval || 0), 0)

  function sortHead(label, key, align = 'center') {
    const isActive = _hrAttSummarySort.col === key
    const arrow = isActive ? (_hrAttSummarySort.dir === 'asc' ? ' ▲' : ' ▼') : ''
    return `<th style="text-align:${align};cursor:pointer;user-select:none" onclick="hrAttSummarySort('${key}')" title="Sort by ${escapeInbox(label)}">${escapeInbox(label)}<span style="color:#C9A7FF;font-size:10px">${arrow}</span></th>`
  }

  body.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;font-size:11px;color:#9F8678">
      <span><strong style="color:#E8D9FF">${shown}</strong> / ${totalEmp} employees</span>
      <span>·</span>
      <span>Worked total: <strong style="color:#86E0A8">${_fmtMinutes(totalWorked)}</strong></span>
      <span>·</span>
      <span>Break total: <strong style="color:#FFB874">${_fmtMinutes(totalBreak)}</strong></span>
      ${totalPending ? `<span>·</span><span>Pending HR: <strong style="color:#C9A7FF">${totalPending}</strong></span>` : ''}
    </div>
    <div class="card"><div class="card-body" style="padding:0;overflow-x:auto">
      <table class="data-table" style="min-width:1180px">
        <thead><tr>
          ${sortHead('Employee', 'full_name', 'left')}
          ${sortHead('Worked',   'worked_minutes')}
          ${sortHead('Avg/day',  'avg_daily_minutes')}
          ${sortHead('Days',     'days_worked')}
          ${sortHead('Breaks',   'break_minutes')}
          ${sortHead('Present',  'present')}
          ${sortHead('Half',     'half_day')}
          ${sortHead('Late',     'late')}
          ${sortHead('Absent',   'absent')}
          ${sortHead('Leave',    'on_leave')}
          ${sortHead('Pending',  'pending_approval')}
          <th style="text-align:center;width:60px">Details</th>
        </tr></thead>
        <tbody>
          ${rows.length === 0
            ? hrEmptyRow(12, 'fa-chart-column', 'No employees match these filters.')
            : rows.map(s => {
                const breakCount = s.break_count || 0
                return `<tr>
                  <td><div style="display:flex;align-items:center;gap:8px">${avatar(s.full_name || s.email || '?', s.avatar_color, 'sm')}<div><div style="font-size:12.5px;color:#FFFFFF">${escapeInbox(s.full_name || '—')}</div><div style="font-size:11px;color:#9F8678">${escapeInbox(s.designation || s.email || '')}${s.role ? ' · ' + escapeInbox(s.role) : ''}</div></div></div></td>
                  <td style="text-align:center;color:#86E0A8;font-weight:700;font-variant-numeric:tabular-nums">${_fmtMinutes(s.worked_minutes || 0)}</td>
                  <td style="text-align:center;color:#C9A7FF;font-variant-numeric:tabular-nums">${s.avg_daily_minutes ? _fmtMinutes(s.avg_daily_minutes) : '—'}</td>
                  <td style="text-align:center;color:#E8D9FF;font-variant-numeric:tabular-nums">${s.days_worked || 0}</td>
                  <td style="text-align:center;color:#FFB874;font-variant-numeric:tabular-nums">${breakCount ? `${_fmtMinutes(s.break_minutes || 0)} <span style="color:#7E7E8F;font-size:10px">· ${breakCount}</span>` : '—'}</td>
                  <td style="text-align:center;color:#86E0A8;font-weight:700">${s.present}</td>
                  <td style="text-align:center;color:#D5C0FF">${s.half_day}</td>
                  <td style="text-align:center;color:${s.late ? '#FFB874' : '#9F8678'}">${s.late}</td>
                  <td style="text-align:center;color:${s.absent ? '#FF7E64' : '#9F8678'};font-weight:${s.absent ? '700' : '500'}">${s.absent}</td>
                  <td style="text-align:center;color:#A8C8FF">${s.on_leave}</td>
                  <td style="text-align:center;color:${s.pending_approval ? '#C9A7FF' : '#9F8678'};font-weight:${s.pending_approval ? '700' : '500'}">${s.pending_approval || 0}</td>
                  <td style="text-align:center"><button class="btn btn-xs btn-outline" title="View daily breakdown" onclick="hrAttOpenEmployeeDetail('${escapeInbox(s.user_id)}','${escapeInbox(s.full_name || '')}')"><i class="fas fa-list"></i></button></td>
                </tr>`
              }).join('')}
        </tbody>
      </table>
    </div></div>`
}

function hrAttSummarySetMonth(m) { _hrAttSummaryMonth = m || hrCurrentMonthISO(); hrReloadPage('page-hr-attendance') }
function hrAttSummarySetSearch(v) { _hrAttSummarySearch = v || ''; _renderAttSummaryTable() }
function hrAttSummarySetStatusFilter(v) {
  _hrAttSummaryStatusFilter = v || ''
  _renderAttSummaryToolbar() // re-renders chips so the active style flips
  _renderAttSummaryTable()
}
function hrAttSummarySort(col) {
  if (_hrAttSummarySort.col === col) {
    _hrAttSummarySort.dir = _hrAttSummarySort.dir === 'asc' ? 'desc' : 'asc'
  } else {
    _hrAttSummarySort = { col, dir: col === 'full_name' ? 'asc' : 'desc' }
  }
  _renderAttSummaryTable()
}

// Per-employee daily breakdown modal — drills the user into the day-by-day
// rows behind the summary numbers. Fetches /attendance?user_id=X for the
// current month, no extra backend route required.
async function hrAttOpenEmployeeDetail(userId, fullName) {
  if (!userId) return
  const month = _hrAttSummaryMonth || hrCurrentMonthISO()
  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-user-clock" style="color:#C9A7FF;margin-right:6px"></i>${escapeInbox(fullName || 'Employee')} · ${escapeInbox(month)}</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" id="hr-att-emp-detail-body" style="padding:18px;max-height:70vh;overflow-y:auto">${hrLoadingHTML()}</div>
    <div class="modal-footer"><button class="btn btn-outline" onclick="closeModal()">Close</button></div>
  `, 'modal-xl')
  try {
    const res = await API.get('/attendance', { params: { user_id: userId } })
    const rows = (res.data || res.attendance || [])
      .filter(r => String(r.date || '').startsWith(month))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    const body = document.getElementById('hr-att-emp-detail-body')
    if (!body) return
    if (!rows.length) {
      body.innerHTML = '<div class="empty-state"><i class="fas fa-folder-open"></i><p>No attendance recorded for this month.</p></div>'
      return
    }
    const totalWorked = rows.reduce((s, r) => s + (Number(r.working_minutes) || 0), 0)
    const totalBreak = rows.reduce((s, r) => s + _breaksTotalMinutes(r.breaks || []), 0)
    body.innerHTML = `
      <div style="display:flex;gap:14px;margin-bottom:14px;flex-wrap:wrap;font-size:12px;color:#9F8678">
        <span><strong style="color:#E8D9FF">${rows.length}</strong> days</span>
        <span>·</span>
        <span>Worked: <strong style="color:#86E0A8">${_fmtMinutes(totalWorked)}</strong></span>
        <span>·</span>
        <span>Break: <strong style="color:#FFB874">${_fmtMinutes(totalBreak)}</strong></span>
      </div>
      <div style="overflow-x:auto"><table class="data-table" style="min-width:760px">
        <thead><tr>
          <th>Date</th><th>Status</th><th>In</th><th>Out</th><th>Worked</th><th>Breaks</th><th>Approval</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => {
            const bMins = _breaksTotalMinutes(r.breaks || [])
            const worked = r.check_out ? _fmtMinutes(Number(r.working_minutes) || 0) : (r.check_in ? `${_fmtMinutes(Math.max(0, _liveMinutesSince(r.check_in) - bMins))}…` : '—')
            return `<tr>
              <td style="font-size:12px;color:#9F8678">${fmtDate(r.date)}</td>
              <td>${ATT_STATUS_BADGE[r.status] || `<span class="badge">${escapeInbox(r.status||'')}</span>`}</td>
              <td style="font-size:12px;color:#E8D9FF">${escapeInbox(r.check_in || '—')}</td>
              <td style="font-size:12px;color:#E8D9FF">${escapeInbox(r.check_out || '—')}</td>
              <td style="font-size:12px;font-weight:700;color:#C9A7FF">${worked}</td>
              <td style="font-size:11.5px;color:#FFB874">${(r.breaks || []).filter(b => b?.start && b?.end).length ? `${(r.breaks || []).filter(b => b?.start && b?.end).length} · ${_fmtMinutes(bMins)}` : '—'}</td>
              <td>${_attApprovalBadge(r)}${_attReasonLine(r)}</td>
            </tr>`
          }).join('')}
        </tbody>
      </table></div>`
  } catch (e) {
    const body = document.getElementById('hr-att-emp-detail-body')
    if (body) body.innerHTML = hrErrorHTML(e.message)
  }
}

window.hrAttSummarySetMonth = hrAttSummarySetMonth
window.hrAttSummarySetSearch = hrAttSummarySetSearch
window.hrAttSummarySetStatusFilter = hrAttSummarySetStatusFilter
window.hrAttSummarySort = hrAttSummarySort
window.hrAttOpenEmployeeDetail = hrAttOpenEmployeeDetail

// ── Bulk Mark ─────────────────────────────────────────────────
function openBulkAttendanceModal() {
  if (!hrCanManage('attendance')) { toast('Not allowed', 'error'); return }
  const users = window._hrEmployees || []
  const activeUsers = users.filter(u => Number(u.is_active) !== 0)
  const rows = activeUsers.map(u => `
    <label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;background:rgba(255,255,255,0.02)" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='rgba(255,255,255,0.02)'">
      <input type="checkbox" class="att-bulk-user" value="${u.id}" checked/>
      ${avatar(u.full_name || u.email || '?', u.avatar_color, 'sm')}
      <div style="flex:1;min-width:0">
        <div style="font-size:12.5px;color:#FFFFFF;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeInbox(u.full_name || u.email || '?')}</div>
        <div style="font-size:11px;color:#9F8678;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeInbox(u.designation || u.email || '')}</div>
      </div>
    </label>`).join('')

  showModal(`
    <div class="modal-header">
      <h3><i class="fas fa-users" style="color:var(--accent);margin-right:6px"></i>Bulk Mark Attendance</h3>
      <button class="close-btn" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="padding:18px;display:flex;flex-direction:column;gap:14px">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Date *</label>
          <input id="bulk-att-date" class="form-input" type="date" value="${hrTodayISO()}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Status *</label>
          <select id="bulk-att-status" class="form-select">
            <option value="present">Present</option>
            <option value="absent">Absent</option>
            <option value="half_day">Half day</option>
            <option value="late">Late</option>
            <option value="on_leave">On leave</option>
            <option value="holiday">Holiday</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Note</label>
        <input id="bulk-att-note" class="form-input" placeholder="Optional — applied to all selected rows"/>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:11px;color:#9F8678;text-transform:uppercase;letter-spacing:.5px">Employees (${activeUsers.length})</div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-xs btn-outline" onclick="hrBulkToggleAll(true)">Select all</button>
          <button class="btn btn-xs btn-outline" onclick="hrBulkToggleAll(false)">Clear</button>
        </div>
      </div>
      <div style="max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;padding:4px;border-radius:8px;background:rgba(0,0,0,0.15)">
        ${activeUsers.length === 0 ? '<div style="padding:20px;text-align:center;color:#9F8678">No active employees</div>' : rows}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitBulkAttendance()"><i class="fas fa-save"></i> Save All</button>
    </div>
  `, 'modal-lg')
}

function hrBulkToggleAll(checked) {
  document.querySelectorAll('.att-bulk-user').forEach(cb => { cb.checked = checked })
}

async function submitBulkAttendance() {
  const date = document.getElementById('bulk-att-date')?.value
  const status = document.getElementById('bulk-att-status')?.value
  const note = document.getElementById('bulk-att-note')?.value.trim() || null
  const user_ids = Array.from(document.querySelectorAll('.att-bulk-user'))
    .filter(cb => cb.checked).map(cb => cb.value)
  if (!date || !status) { toast('Date and status are required', 'error'); return }
  if (user_ids.length === 0) { toast('Select at least one employee', 'error'); return }
  try {
    const res = await API.post('/attendance/bulk', { date, status, note, user_ids })
    const d = res.data || {}
    toast(`Saved · ${d.inserted || 0} new, ${d.updated || 0} updated`, 'success')
    closeModal(); hrReloadPage('page-hr-attendance')
  } catch (e) { toast('Failed: ' + e.message, 'error') }
}

// ════════════════════════════════════════════════════════════════
// On-break lock modal
// ════════════════════════════════════════════════════════════════
// While the user is on break, a centered overlay covers the whole app —
// the only way out is the End Break button. The overlay shows a live
// elapsed counter (updates every second) + a reverse counter of the
// remaining planned time. When the planned time runs out, the modal
// turns red and a looping alarm plays until the user ends the break.
//
// Audio autoplay is unreliable on cold tabs, so the poller doesn't try
// to start the ring on its own — it sets a flag and a small "Tap to
// enable sound" button surfaces in the modal as a fallback when the
// browser blocks the first play() call.
const _breakRingState = {
  audio: null,
  tickTimer: null,
  // The 1-second tick that drives the live counter on the lock modal.
  liveTimer: null,
  // Today's attendance row, cached between polls so the per-second tick
  // doesn't have to hit the network every time it refreshes the UI.
  today: null,
  // Tracks (date+start) keys that the user silenced — we never re-ring
  // for the same break instance once silenced.
  silenced: new Set(),
  // Audio successfully started? Drives the visibility of the manual
  // "Enable sound" fallback button.
  ringPlaying: false,
  // True once user has interacted with the page in a way that lets us
  // play audio without autoplay blocking. Pre-warmed on Start Break.
  audioUnlocked: false,
}
const BREAK_RING_POLL_MS = 15_000

function startBreakRingPoller() {
  if (_breakRingState.tickTimer) return
  if (typeof _user === 'undefined' || !_user) return
  _breakOverrunCheck() // immediate kick
  _breakRingState.tickTimer = setInterval(_breakOverrunCheck, BREAK_RING_POLL_MS)
}
function stopBreakRingPoller() {
  if (_breakRingState.tickTimer) clearInterval(_breakRingState.tickTimer)
  _breakRingState.tickTimer = null
  _stopLiveTick()
  _stopBreakRing()
  _hideOnBreakLock()
  _breakRingState.silenced.clear()
}

// Poller — calls /attendance/today, decides whether to show the lock and
// (if applicable) ring. Renders the modal initially, then the per-second
// liveTick handles the elapsed/remaining counter updates between polls.
async function _breakOverrunCheck() {
  try {
    const res = await API.get('/attendance/today')
    const today = res?.data
    _breakRingState.today = today
    const activeBreak = today?.on_break && Array.isArray(today.breaks)
      ? today.breaks.find(b => b?.start && !b?.end)
      : null
    if (!activeBreak) {
      _stopBreakRing()
      _hideOnBreakLock()
      _stopLiveTick()
      return
    }
    _showOnBreakLock(today, activeBreak)
    _startLiveTick() // refresh the counter every second
  } catch { /* poller retries on next tick */ }
}

// Live counter — runs every second while the lock modal is up. Pulls the
// active break out of the cached `today` and rewrites just the elapsed +
// remaining values without re-creating the DOM. Also flips the modal into
// "overrun" mode (red + ring) the moment the threshold crosses zero.
function _startLiveTick() {
  if (_breakRingState.liveTimer) return
  _breakRingState.liveTimer = setInterval(_liveTickUpdate, 1000)
}
function _stopLiveTick() {
  if (_breakRingState.liveTimer) clearInterval(_breakRingState.liveTimer)
  _breakRingState.liveTimer = null
}
function _liveTickUpdate() {
  const today = _breakRingState.today
  const activeBreak = today?.on_break && Array.isArray(today.breaks)
    ? today.breaks.find(b => b?.start && !b?.end)
    : null
  if (!activeBreak) { _stopLiveTick(); return }
  const planned = Number(activeBreak.planned_minutes) || 0
  // Compute live elapsed in seconds (more precise than the minute-only helper)
  // so the timer ticks like a real stopwatch.
  const startSec = _hhmmToSeconds(activeBreak.start)
  const nowSec = _nowSeconds()
  const elapsedSec = Math.max(0, nowSec - startSec)
  const elapsedMin = Math.floor(elapsedSec / 60)
  const breakKey = `${today.id || ''}:${activeBreak.start || ''}`
  const overrun = planned > 0 && elapsedMin >= planned
  // Update the DOM values without re-rendering the whole modal.
  const root = document.getElementById('on-break-lock')
  if (!root) return
  const elapsedEl = root.querySelector('[data-elapsed]')
  const remainEl  = root.querySelector('[data-remaining]')
  if (elapsedEl) elapsedEl.textContent = _fmtSecondsHMS(elapsedSec)
  if (remainEl) {
    if (planned > 0) {
      const remainSec = planned * 60 - elapsedSec
      remainEl.textContent = remainSec > 0
        ? `${_fmtSecondsHMS(remainSec)} remaining`
        : `+${_fmtSecondsHMS(-remainSec)} over`
      remainEl.style.color = remainSec > 0 ? '#9F8678' : '#FF7E64'
    } else {
      remainEl.textContent = ''
    }
  }
  // Flip the modal into overrun styling + start the ring on the boundary.
  if (overrun) {
    root.dataset.overrun = '1'
    if (!_breakRingState.silenced.has(breakKey)) _startBreakRing()
  } else {
    root.dataset.overrun = ''
    _stopBreakRing()
  }
}

function _nowSeconds() {
  const d = new Date()
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()
}
function _hhmmToSeconds(hhmm) {
  if (!hhmm) return 0
  const [h, m] = String(hhmm).split(':').map(Number)
  if (![h, m].every(Number.isFinite)) return 0
  return h * 3600 + m * 60
}
function _fmtSecondsHMS(totalSec) {
  totalSec = Math.max(0, Math.round(totalSec))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  return `${m}:${String(s).padStart(2,'0')}`
}

// Audio — created lazily but pre-warmed when the user clicks Start Break
// (see submitStartBreak below). Once unlocked, every subsequent play()
// call is allowed without a fresh user gesture.
function _ensureAudio() {
  if (_breakRingState.audio) return _breakRingState.audio
  try {
    const a = new Audio('/static/sounds/task.wav')
    a.loop = true
    a.volume = 0.85
    a.preload = 'auto'
    _breakRingState.audio = a
    return a
  } catch { return null }
}
function _startBreakRing() {
  const a = _ensureAudio()
  if (!a) return
  if (!a.paused) return
  const p = a.play()
  if (p && typeof p.then === 'function') {
    p.then(() => {
      _breakRingState.ringPlaying = true
      _breakRingState.audioUnlocked = true
      _refreshSoundButton()
    }).catch(() => {
      _breakRingState.ringPlaying = false
      _refreshSoundButton()
    })
  }
}
function _stopBreakRing() {
  if (_breakRingState.audio) {
    try { _breakRingState.audio.pause(); _breakRingState.audio.currentTime = 0 } catch {}
  }
  _breakRingState.ringPlaying = false
  _refreshSoundButton()
}
function _refreshSoundButton() {
  const root = document.getElementById('on-break-lock')
  if (!root) return
  const overrun = root.dataset.overrun === '1'
  const btn = root.querySelector('[data-enable-sound]')
  if (!btn) return
  // Show the "Enable sound" fallback only when overrun + ring isn't playing
  // + user hasn't silenced it. This handles the autoplay-block case.
  const today = _breakRingState.today
  const activeBreak = today?.on_break && Array.isArray(today.breaks)
    ? today.breaks.find(b => b?.start && !b?.end) : null
  const key = activeBreak ? `${today.id || ''}:${activeBreak.start || ''}` : ''
  const silenced = _breakRingState.silenced.has(key)
  btn.style.display = (overrun && !_breakRingState.ringPlaying && !silenced) ? 'inline-flex' : 'none'
}

// Manual "Enable sound" button — fires inside a click handler so the
// browser allows the play() call even if autoplay was blocked initially.
function enableBreakSound() {
  _breakRingState.audioUnlocked = true
  _startBreakRing()
}

// The lock modal itself. Built once, then updated in place by the live
// tick to avoid jank. data-overrun toggles a red overrun styling that's
// applied via inline style references — kept here so we don't need new CSS.
function _showOnBreakLock(today, activeBreak) {
  const existing = document.getElementById('on-break-lock')
  if (existing && existing.dataset.breakKey === `${today.id || ''}:${activeBreak.start || ''}`) {
    return // Already up for this break — live tick will keep it fresh.
  }
  if (existing) existing.remove()
  const meta = _breakKindMeta(activeBreak.kind)
  const planned = Number(activeBreak.planned_minutes) || 0
  const startSec = _hhmmToSeconds(activeBreak.start)
  const elapsedSec = Math.max(0, _nowSeconds() - startSec)
  const elapsedMin = Math.floor(elapsedSec / 60)
  const remainSec = planned * 60 - elapsedSec
  const overrun = planned > 0 && elapsedMin >= planned
  const breakKey = `${today.id || ''}:${activeBreak.start || ''}`

  const overlay = document.createElement('div')
  overlay.id = 'on-break-lock'
  overlay.dataset.breakKey = breakKey
  overlay.dataset.overrun = overrun ? '1' : ''
  overlay.innerHTML = `
    <div role="dialog" aria-modal="true" aria-label="On break"
         style="position:fixed;inset:0;background:rgba(0,0,0,.82);backdrop-filter:blur(6px);z-index:9500;display:flex;align-items:center;justify-content:center;padding:20px">
      <div style="background:#16161C;border:2px solid ${meta.color};border-radius:16px;padding:26px 28px 22px;max-width:420px;width:100%;text-align:center;box-shadow:0 28px 70px rgba(0,0,0,.6)">
        <div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:${meta.color}26;margin-bottom:12px">
          <i class="fas ${meta.icon}" style="color:${meta.color};font-size:24px"></i>
        </div>
        <div style="font-size:13px;color:#9F8678;text-transform:uppercase;letter-spacing:1px">On Break</div>
        <div style="font-size:20px;font-weight:700;color:${meta.color};margin-top:2px">${escapeInbox(meta.label)}</div>
        <div data-elapsed style="font-size:46px;font-weight:800;color:#E8D9FF;margin:14px 0 4px;font-variant-numeric:tabular-nums;letter-spacing:2px">${_fmtSecondsHMS(elapsedSec)}</div>
        <div data-remaining style="font-size:13px;color:${remainSec > 0 ? '#9F8678' : '#FF7E64'};font-variant-numeric:tabular-nums">${planned ? (remainSec > 0 ? _fmtSecondsHMS(remainSec) + ' remaining' : `+${_fmtSecondsHMS(-remainSec)} over`) : ''}</div>
        ${planned ? `<div style="font-size:11px;color:#7E7E8F;margin-top:6px">Planned ${planned}m · started ${escapeInbox(activeBreak.start)}</div>` : ''}
        ${activeBreak.note ? `<div style="font-size:12px;color:#C9A7FF;margin-top:8px;padding:6px 10px;background:rgba(169,112,255,.08);border-radius:8px"><i class="fas fa-comment-dots" style="margin-right:5px"></i>${escapeInbox(activeBreak.note)}</div>` : ''}
        <button data-enable-sound class="btn btn-sm" style="display:none;margin-top:14px;background:${meta.color};color:#0F0A06" onclick="enableBreakSound()"><i class="fas fa-volume-high"></i> Enable Sound</button>
        <div style="display:flex;gap:8px;margin-top:18px">
          <button class="btn" style="background:${meta.color};color:#0F0A06;flex:1;font-weight:700;padding:12px" onclick="hrPunch('break_end')"><i class="fas fa-circle-stop"></i> End Break</button>
          <button class="btn btn-outline" style="padding:12px" onclick="silenceBreakOverrun('${escapeInbox(breakKey)}')" title="Mute the alarm but stay on break"><i class="fas fa-bell-slash"></i></button>
        </div>
      </div>
    </div>`
  document.body.appendChild(overlay)
  _refreshSoundButton()
}
function _hideOnBreakLock() {
  document.getElementById('on-break-lock')?.remove()
}

// Silence the alarm for this specific break instance. Keeps the lock
// modal up — user is still on break, just no sound until they end it.
function silenceBreakOverrun(breakKey) {
  _breakRingState.silenced.add(breakKey)
  _stopBreakRing()
  _refreshSoundButton()
}
window.silenceBreakOverrun = silenceBreakOverrun
window.enableBreakSound = enableBreakSound
window.startBreakRingPoller = startBreakRingPoller
window.stopBreakRingPoller = stopBreakRingPoller

// Boot the poller as soon as the page is interactive AND a session exists.
function _bootBreakRingPoller() {
  if (typeof _user === 'undefined' || !_user) {
    setTimeout(_bootBreakRingPoller, 1000)
    return
  }
  startBreakRingPoller()
}
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(_bootBreakRingPoller, 800)
} else {
  document.addEventListener('DOMContentLoaded', () => setTimeout(_bootBreakRingPoller, 800))
}
window.addEventListener('storage', () => {
  if (!localStorage.getItem('devportal_token')) stopBreakRingPoller()
})
