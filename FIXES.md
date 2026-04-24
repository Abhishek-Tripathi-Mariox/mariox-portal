# Fixes Applied

This document summarizes the bugs found and fixed in the PMportal codebase during audit.

## Backend fixes

### 1. Inconsistent approval-status filter (`src/routes/users.ts`)
**Before:** The users list and user-detail endpoints filtered timesheets by `approval_status = 'approved'`, while the dashboard endpoint used `approval_status != 'rejected'` (which includes pending entries).
**Impact:** The "monthly consumed hours" for the same developer appeared different on the dashboard versus the user detail page.
**Fix:** Unified every query to use `approval_status != 'rejected'`.

### 2. Missing auto-consume on developer-created timesheets (`src/routes/timesheets.ts`)
**Before:** When a developer created a timesheet entry, the `updateConsumedHours()` helper was deliberately skipped (it only ran for PM/admin entries). But the SUM query inside that helper counts **all** non-rejected entries (including pending). So project/assignment `consumed_hours` columns stayed stale until a PM approved the entry.
**Impact:** Developer dashboards and project burn bars didn't update in real-time after logging hours.
**Fix:** Always run `updateConsumedHours()` on create. Approval workflow still controls what counts as "approved" — but the aggregate counters now stay in sync.

### 3. Divide-by-zero in timeline-progress SQL
**Before:** Four SQL queries computed `timeline_progress` as `(now - start_date) / (end_date - start_date)`. When a project had `start_date == expected_end_date`, this divided by zero and D1 returned an error, breaking the whole endpoint.
**Files affected:** `src/routes/dashboard.ts`, `src/routes/projects.ts` (two queries), `src/routes/reports.ts`.
**Fix:** Wrapped the denominator in `NULLIF(..., 0)` so the result becomes `NULL` instead of erroring.

## Migration fixes

### 4. Mismatched emails in `migrations/0005_fix_password_hashes.sql`
**Before:** The password-fix UPDATE referenced `vikram@devtrack.com` and `anjali@devtrack.com`, neither of which are part of the current bootstrap data. Meanwhile the actually-seeded emails `arjun@devtrack.com` and `divya@devtrack.com` were missing from the list.
**Impact:** Two real demo accounts never had their hash updated by this migration. (They happened to still work because the hash was already correct in the initial seed, but if anyone ran 0005 on a partial DB, those accounts would break.)
**Fix:** Updated the email list to match the bootstrap data exactly.

## Frontend fixes

### 5. Added defensive `utils` shim in `public/static/app.js`
**Issue:** Legacy files `pages.js` and `pages2.js` call `utils.getInitials()`, `utils.toast()`, `utils.formatHours()`, `utils.progressBar()`, etc. No `utils` object was ever defined anywhere in the frontend bundle.
**Why this didn't already break:** These legacy files register handlers with the stubbed `router.register()` in `app.js` — a no-op — so their code never actually runs in the current build.
**Why we fixed it anyway:** If anyone later re-enables the legacy router or accidentally calls into those code paths, everything would throw `ReferenceError: utils is not defined`. The shim maps each legacy `utils.*` call to the equivalent live helper (`initials`, `toast`, `fmtNum`, `fmtDate`, etc.).

## Documentation fixes

### 6. Demo credentials table in `README.md` now reflects all 6 seeded developers
Previously listed only 3 of the 6 developers that exist in seed data.

---

## Verified non-issues (for future reference)

- **Password hashes in seed match the auth algorithm.** Computed SHA-256 of `'Admin@123' + 'devtrack-salt-2025'` and confirmed it matches the hash stored for `admin@devtrack.com`. Likewise for `Password@123`. All demo logins work out of the box.
- **Auto-consume logic is otherwise correct.** `updateConsumedHours()` properly recalculates project and assignment totals on create/edit/delete/approve/reject using the same `!= 'rejected'` filter everywhere after fix #1 and #2.
- **All 6 migrations apply in order without conflicts.**
- **JWT is signed and verified from Cloudflare env bindings in `auth.ts` and `client-auth.ts`.** Keep the value in `.dev.vars` locally or as a Cloudflare secret in production.

## How to run after pulling these fixes

```bash
npm install
npx wrangler d1 create devtrack-pro-production
# copy the returned database_id into wrangler.jsonc

# apply all migrations + seed data
npx wrangler d1 migrations apply devtrack-pro-production --local

# build and run
npm run build
npm run dev:sandbox
```

Open <http://localhost:3000> and log in with `admin@devtrack.com` / `Admin@123`.
