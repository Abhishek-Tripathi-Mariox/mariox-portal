# Changelog

## Round 2 — Feature additions (per-project teams, kanban permissions, invites)

### Database

- **`migrations/0007_project_teams_and_permissions.sql`** — new tables:
  - `project_teams` — per-project team groupings (name, colour, lead)
  - `project_team_members` — many-to-many between users and project teams
  - `kanban_permissions` — per-project role-based permission matrix (8 permission flags × 4 roles per project)
  - `user_invites` — one-time signup tokens for developer/PM onboarding
  - New columns: `users.must_change_password`, `project_assignments.project_team_id`, `tasks.project_team_id`

- **`migrations/0009_admin_seed.sql`** — admin bootstrap:
  - Core company settings record
  - Admin user account for `akash@marioxsoftware.com`

### Backend

- **`src/routes/project-teams.ts`** (new) — CRUD for project teams and members
  - `GET /api/project-teams/project/:projectId` — list teams in a project
  - `POST /api/project-teams/project/:projectId` — create team (PM/admin)
  - `GET /api/project-teams/:teamId` — team detail with members
  - `PUT /api/project-teams/:teamId` — update team
  - `DELETE /api/project-teams/:teamId` — delete team (detaches assignments/tasks, doesn't cascade delete)
  - `POST /api/project-teams/:teamId/members` — add or update a member's role
  - `DELETE /api/project-teams/:teamId/members/:userId` — remove member

- **`src/routes/kanban-permissions.ts`** (new) — permission matrix API + reusable `checkKanbanPerm()` helper
  - `GET /api/kanban-permissions/project/:projectId` — full matrix (PM view)
  - `GET /api/kanban-permissions/project/:projectId/mine` — effective permissions for the current user (tells the frontend what buttons to show)
  - `PUT /api/kanban-permissions/project/:projectId` — bulk upsert (PM/admin only)
  - Developers not assigned to a project are automatically downgraded to view-only regardless of matrix
  - Admin/PM always bypass the matrix (full access)

- **`src/routes/invites.ts`** (new) — signup-by-invite flow
  - `POST /api/invites` — PM/admin creates an invite, returns a link with a random 48-char token (7-day expiry)
  - `GET /api/invites` — list pending invites
  - `DELETE /api/invites/:id` — revoke invite
  - `GET /api/invites/validate/:token` — **public**, checks if a token is usable
  - `POST /api/invites/accept/:token` — **public**, the invited user posts a password and their account is created

- **`src/routes/tasks.ts`** — mutation endpoints now enforce kanban permissions:
  - `POST /` (create) → requires `can_create_task`
  - `PUT /:id` (update) → requires `can_edit_any_task`, OR `can_edit_own_task` AND the user is the assignee
  - `DELETE /:id` → requires `can_delete_task`
  - `PATCH /:id/move` → requires `can_move_task`
  - `POST /:id/comment` → requires `can_comment`
  - Developers not assigned to the project get 403 on any write op except commenting (if allowed)

- **`src/routes/projects.ts`** — `POST /` (create project) now:
  - Validates required fields (name, code, start_date, expected_end_date, total_allocated_hours > 0, end > start) and returns 400 with a clear list of errors
  - Auto-seeds default kanban permissions for the new project
  - Auto-seeds default kanban columns for the new project

- **`src/index.tsx`** — wired the 3 new route modules

### Frontend

- **`public/static/project-extensions.js`** (new) — contains:
  - `renderProjectTeamsSection(projectId, el)` — list/create/edit/delete teams inside a project
  - `openManageMembersModal(teamId)` — drag-in/drag-out members, assign roles (member/lead/qa/designer)
  - `openKanbanPermissionsModal(projectId, name)` — 4×8 checkbox matrix for PM to configure per-project permissions
  - `renderInvitesPanel(el)` — pending invites table with "copy link" and "revoke" actions
  - `openInviteUserModal()` — modal for PM/admin to create a new invite
  - `renderAcceptInvitePage()` — public standalone page rendered when URL is `/accept-invite?token=...`
  - `pxModal({title, body, onConfirm})` — object-style modal helper (deliberately named `pxModal` to avoid colliding with the existing `showModal(html, size)` in `app.js`)

- **`public/static/enterprise.js`** — added 3 action buttons to each project row:
  - Kanban (existing)
  - **Teams** (new) — opens `showProjectTeamsModal`
  - **Permissions** (new, PM/admin only) — opens the matrix modal
  - Edit (existing)
  - Kanban board header also got Teams and Permissions shortcut buttons

- **`public/static/enterprise2.js`** — added "Invites" tab in Settings (PM/admin only); renders the invites panel on click

- **`public/static/app.js`** — init function now skips auto-render if URL is `/accept-invite` so the public signup page can take over

- **`src/index.tsx`** — added `<script src="/static/project-extensions.js">` to the HTML shell

---

## Things to verify after running

1. Run migrations 0007 and 0008 after pulling:
   ```bash
   npx wrangler d1 migrations apply devtrack-pro-production --local
   ```
2. Log in as `admin@devtrack.com` / `Admin@123`
3. Navigate to Projects → click the **Teams** button on any row → create a team, add members
4. Click the **Permissions** button → uncheck "can_move_task" for the developer role → save
5. Log out, log in as `rahul@devtrack.com` / `Password@123` → open the same board → dragging should be blocked
6. Go back as admin → Settings → **Invites** tab → click "Invite User" → fill form → copy the link
7. Open the link in an incognito window → set a password → confirm it redirects to login → log in with the new account

## Known caveats

- JWT auth now reads from `c.env.JWT_SECRET` in both `auth.ts` and `client-auth.ts`. Keep that secret in `.dev.vars` locally or Cloudflare secrets in production.
- Invites are delivered as copyable links only — no email integration. The PM copies the link and shares it out-of-band.
- The permission matrix does not yet support per-user overrides, only per-role.
- If you rename a project with single-quotes in the name, the Teams/Permissions buttons in the projects list may break due to HTML-attribute escaping. Using double-quoted names is safe.
