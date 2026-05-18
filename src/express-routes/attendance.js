import { Router } from 'express';
import { createAuthMiddleware, requireAnyPermission, userHasAnyPermission } from '../express-middleware/auth';
import { generateId } from '../utils/helpers';
import { validateEnum, validateISODate, validateLength, validateOptional, respondWithError, } from '../validators';
const ATTENDANCE_STATUSES = ['present', 'absent', 'half_day', 'late', 'on_leave', 'holiday'];
const APPROVAL_DECISIONS = ['approved', 'rejected'];
// Returns YYYY-MM-DD for today in the server's local TZ.
function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Returns HH:mm in the server's local TZ.
function nowHHMM() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function createAttendanceRouter(models, jwtSecret) {
    const router = Router();
    router.use(createAuthMiddleware(jwtSecret));
    // Admins / users with hr.attendance.manage see everything. Everyone else
    // only sees their own rows.
    router.get('/', async (req, res) => {
        try {
            const user = req.user;
            const isManager = await userHasAnyPermission(models, user, 'hr.attendance.manage');
            const userId = typeof req.query.user_id === 'string' ? req.query.user_id : undefined;
            const date = typeof req.query.date === 'string' ? req.query.date : undefined;
            const filter = {};
            if (!isManager)
                filter.user_id = user.sub;
            else if (userId)
                filter.user_id = userId;
            if (date)
                filter.date = date;
            const [rows, users] = await Promise.all([
                models.attendance.find(filter),
                models.users.find({}),
            ]);
            const usersById = new Map(users.map((u) => [String(u.id), u]));
            const enriched = rows
                .map((r) => ({
                ...r,
                full_name: usersById.get(String(r.user_id))?.full_name || null,
                email: usersById.get(String(r.user_id))?.email || null,
                designation: usersById.get(String(r.user_id))?.designation || null,
                avatar_color: usersById.get(String(r.user_id))?.avatar_color || null,
            }))
                .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
                .slice(0, 500);
            return res.json({ data: enriched, attendance: enriched });
        }
        catch {
            return res.json({ data: [], attendance: [] });
        }
    });
    router.post('/', requireAnyPermission(models, 'hr.attendance.manage'), async (req, res) => {
        try {
            const body = req.body || {};
            const targetUserId = String(body.user_id || '').trim();
            if (!targetUserId)
                return res.status(400).json({ error: 'Employee is required' });
            const targetUser = await models.users.findById(targetUserId);
            if (!targetUser)
                return res.status(400).json({ error: 'Employee not found' });
            const date = validateISODate(body.date, 'Date');
            const status = validateEnum(body.status, ATTENDANCE_STATUSES, 'Status');
            const checkIn = validateOptional(body.check_in, (v) => validateLength(String(v).trim(), 1, 16, 'Check-in'));
            const checkOut = validateOptional(body.check_out, (v) => validateLength(String(v).trim(), 1, 16, 'Check-out'));
            const note = validateOptional(body.note, (v) => validateLength(String(v).trim(), 1, 500, 'Note'));
            // One row per (user_id, date). If it already exists, update in place.
            const existing = await models.attendance.findOne({ user_id: targetUserId, date });
            const now = new Date().toISOString();
            if (existing) {
                await models.attendance.updateById(existing.id, {
                    $set: { status, check_in: checkIn, check_out: checkOut, note, updated_at: now },
                });
                return res.json({ message: 'Attendance updated', data: { id: existing.id } });
            }
            const id = generateId('att');
            await models.attendance.insertOne({
                id,
                user_id: targetUserId,
                date,
                status,
                check_in: checkIn,
                check_out: checkOut,
                note,
                created_at: now,
                updated_at: now,
            });
            return res.status(201).json({ message: 'Attendance recorded', data: { id } });
        }
        catch (error) {
            return respondWithError(res, error, 500);
        }
    });
    // Bulk-mark attendance: same date + status for many employees in one go.
    // Upserts per (user_id, date) — re-marking the same day is idempotent.
    router.post('/bulk', requireAnyPermission(models, 'hr.attendance.manage'), async (req, res) => {
        try {
            const body = req.body || {};
            const date = validateISODate(body.date, 'Date');
            const status = validateEnum(body.status, ATTENDANCE_STATUSES, 'Status');
            const userIds = Array.isArray(body.user_ids) ? body.user_ids.map(String) : [];
            if (userIds.length === 0)
                return res.status(400).json({ error: 'At least one employee is required' });
            if (userIds.length > 500)
                return res.status(400).json({ error: 'Too many employees in one request' });
            const note = validateOptional(body.note, (v) => validateLength(String(v).trim(), 1, 500, 'Note'));
            const now = new Date().toISOString();
            let inserted = 0;
            let updated = 0;
            for (const uid of userIds) {
                const targetUser = await models.users.findById(uid);
                if (!targetUser)
                    continue;
                const existing = await models.attendance.findOne({ user_id: uid, date });
                if (existing) {
                    await models.attendance.updateById(existing.id, {
                        $set: { status, note, updated_at: now },
                    });
                    updated += 1;
                }
                else {
                    await models.attendance.insertOne({
                        id: generateId('att'),
                        user_id: uid,
                        date,
                        status,
                        check_in: null,
                        check_out: null,
                        note,
                        created_at: now,
                        updated_at: now,
                    });
                    inserted += 1;
                }
            }
            return res.json({ message: 'Bulk attendance saved', data: { inserted, updated, total: inserted + updated } });
        }
        catch (error) {
            return respondWithError(res, error, 500);
        }
    });
    // Monthly summary: aggregate counts per employee for a YYYY-MM month. Used
    // by the Attendance "Summary" tab — far cheaper than letting the client
    // tally a 500-row response client-side.
    router.get('/summary', requireAnyPermission(models, 'hr.attendance.manage'), async (req, res) => {
        try {
            const month = typeof req.query.month === 'string' ? req.query.month : '';
            if (!/^\d{4}-\d{2}$/.test(month))
                return res.status(400).json({ error: 'month must be in YYYY-MM format' });
            const start = `${month}-01`;
            const [y, m] = month.split('-').map(Number);
            const end = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
            const [rows, users] = await Promise.all([
                models.attendance.find({ date: { $gte: start, $lte: end } }),
                models.users.find({ is_active: 1 }),
            ]);
            // Build per-user counts.
            const byUser = new Map();
            for (const u of users) {
                byUser.set(String(u.id), {
                    user_id: u.id,
                    full_name: u.full_name,
                    email: u.email,
                    designation: u.designation || null,
                    avatar_color: u.avatar_color || null,
                    present: 0, absent: 0, half_day: 0, late: 0, on_leave: 0, holiday: 0, total: 0,
                });
            }
            for (const r of rows) {
                const entry = byUser.get(String(r.user_id));
                if (!entry)
                    continue;
                const k = String(r.status || '');
                if (entry[k] !== undefined)
                    entry[k] += 1;
                entry.total += 1;
            }
            const summary = Array.from(byUser.values()).sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));
            return res.json({ data: summary, summary, month });
        }
        catch (error) {
            return respondWithError(res, error, 500);
        }
    });
    // User-self punch in/out. Writes (or upserts) today's attendance row for
    // the calling user. `check_in` is set on the first punch of the day; later
    // punches update `check_out`. Newly created rows land with approval_status
    // = 'pending' so HR has to confirm them before they count.
    router.post('/punch', async (req, res) => {
        try {
            const user = req.user;
            if (!user?.sub)
                return res.status(401).json({ error: 'Unauthenticated' });
            const action = String(req.body?.action || '').toLowerCase();
            if (action !== 'in' && action !== 'out') {
                return res.status(400).json({ error: 'action must be "in" or "out"' });
            }
            const date = todayISO();
            const time = nowHHMM();
            const now = new Date().toISOString();
            const existing = await models.attendance.findOne({ user_id: user.sub, date });
            if (action === 'in') {
                if (existing && existing.check_in) {
                    return res.status(409).json({ error: 'Already punched in today', data: existing });
                }
                if (existing) {
                    await models.attendance.updateById(existing.id, {
                        $set: { check_in: time, status: 'present', approval_status: 'pending', updated_at: now },
                    });
                    const updated = await models.attendance.findById(existing.id);
                    return res.json({ message: 'Punched in', data: updated });
                }
                const id = generateId('att');
                const doc = {
                    id,
                    user_id: user.sub,
                    date,
                    status: 'present',
                    check_in: time,
                    check_out: null,
                    note: null,
                    approval_status: 'pending',
                    created_at: now,
                    updated_at: now,
                };
                await models.attendance.insertOne(doc);
                return res.status(201).json({ message: 'Punched in', data: doc });
            }
            // action === 'out'
            if (!existing) {
                return res.status(400).json({ error: 'No check-in recorded today — punch in first' });
            }
            await models.attendance.updateById(existing.id, {
                $set: { check_out: time, approval_status: 'pending', updated_at: now },
            });
            const updated = await models.attendance.findById(existing.id);
            return res.json({ message: 'Punched out', data: updated });
        }
        catch (error) {
            return respondWithError(res, error, 500);
        }
    });
    // Calling user's today record — used by the attendance page header to
    // show current state and toggle the punch-in / punch-out button.
    router.get('/today', async (req, res) => {
        try {
            const user = req.user;
            if (!user?.sub)
                return res.status(401).json({ error: 'Unauthenticated' });
            const row = await models.attendance.findOne({ user_id: user.sub, date: todayISO() });
            return res.json({ data: row || null });
        }
        catch {
            return res.json({ data: null });
        }
    });
    // HR approves / rejects a daily attendance row. Reason is required for
    // rejections so the employee gets context.
    router.patch('/:id/decision', requireAnyPermission(models, 'hr.attendance.manage'), async (req, res) => {
        try {
            const user = req.user;
            const decision = validateEnum(req.body?.decision, APPROVAL_DECISIONS, 'Decision');
            let reason = null;
            if (req.body?.reason !== undefined && req.body?.reason !== null && String(req.body.reason).trim() !== '') {
                reason = validateLength(String(req.body.reason).trim(), 1, 500, 'Reason');
            }
            if (decision === 'rejected' && !reason) {
                return res.status(400).json({ error: 'Reason is required when rejecting' });
            }
            const row = await models.attendance.findById(String(req.params.id));
            if (!row)
                return res.status(404).json({ error: 'Attendance row not found' });
            const now = new Date().toISOString();
            await models.attendance.updateById(row.id, {
                $set: {
                    approval_status: decision,
                    decision_reason: reason,
                    decided_by: String(user?.sub || ''),
                    decided_at: now,
                    updated_at: now,
                },
            });
            const updated = await models.attendance.findById(row.id);
            return res.json({ message: `Attendance ${decision}`, data: updated });
        }
        catch (error) {
            return respondWithError(res, error, 500);
        }
    });
    router.delete('/:id', requireAnyPermission(models, 'hr.attendance.manage'), async (req, res) => {
        try {
            await models.attendance.deleteById(String(req.params.id));
            return res.json({ message: 'Attendance deleted' });
        }
        catch (error) {
            return res.status(500).json({ error: error?.message || 'Failed to delete' });
        }
    });
    return router;
}
