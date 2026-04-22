# ⚡ Quick Reference Guide

## 🚀 Quick Start

### Import & Use Patterns

```typescript
// Types
import type { User, Project, ApiResponse, Bindings } from '@/types'

// Constants
import { ROLES, PROJECT_STATUS, ERROR_MESSAGES, HTTP_STATUS } from '@/constants'

// Config
import CONFIG from '@/config'

// Validators
import { validateEmail, validatePassword, validateRequired } from '@/validators'

// Utils
import { sendSuccess, sendError, sendCreated, sendForbidden } from '@/utils/response'
import { ValidationError, AuthenticationError, NotFoundError } from '@/utils/errors'
import { generateId, getRandomAvatarColor, isManager, normalizeEmail } from '@/utils/helpers'

// Database
import { DatabaseService } from '@/db/service'

// Middleware
import { auth, requireRole, requireManager, requireAdmin } from '@/middleware/auth'
```

## 📋 Cheat Sheet

### Response Patterns
```typescript
// Success
return sendSuccess(c, userData)                    // 200 OK

// Created
return sendCreated(c, newUser)                     // 201 Created

// Errors
return sendError(c, 'Something wrong', 400)        // 400 Bad Request
return sendUnauthorized(c)                         // 401 Unauthorized
return sendForbidden(c)                            // 403 Forbidden
return sendNotFound(c, 'User')                     // 404 Not Found
return sendBadRequest(c, 'Invalid email')          // 400

// Paginated
return sendPaginated(c, items, 100, 1, 20)        // Page 1 of 100 items
```

### Database Patterns
```typescript
const db = new DatabaseService(c.env.DB)

// SELECT (all)
const users = await db.findAll(
  'SELECT * FROM users WHERE role=?',
  ['admin']
)

// SELECT (one)
const user = await db.findOne(
  'SELECT * FROM users WHERE id=?',
  [userId]
)

// COUNT
const count = await db.count(
  'SELECT * FROM projects WHERE status=?',
  ['active']
)

// INSERT
await db.insert('users', {
  id: generateId('user'),
  email: normalizeEmail('test@example.com'),
  password_hash: hash,
  full_name: 'John Doe',
  avatar_color: getRandomAvatarColor(),
})

// UPDATE
await db.update(
  'users',
  { full_name: 'Jane Doe', updated_at: new Date() },
  'id = ?',
  [userId]
)

// DELETE
await db.delete('users', 'id = ?', [userId])

// TRANSACTION
await db.transaction(async () => {
  await db.insert('projects', ...)
  await db.insert('kanban_columns', ...)
})
```

### Middleware Patterns
```typescript
// Require auth
router.use('*', auth)

// Require specific roles
router.use('*', requireRole('admin', 'pm'))

// Require admin
router.post('/', requireAdmin, async (c) => { ... })

// Require manager
router.get('/', requireManager, async (c) => { ... })

// Optional auth
router.use('*', optionalAuth)
const user = c.get('user')  // null if not authenticated
```

### Validation Patterns
```typescript
try {
  const email = validateEmail(input.email)
  const password = validatePassword(input.password)
  const name = validateRequired(input.name, 'Name')
  
  // Use validated data...
} catch (error) {
  if (error instanceof ValidationError) {
    return sendError(c, error.message, 400)
  }
  return sendError(c, 'Server error', 500)
}

// Or use combined validators
try {
  const { email, password, full_name } = validateSignupInput(
    input.email,
    input.password,
    input.full_name
  )
} catch (error) {
  return sendError(c, error.message, 400)
}
```

### Access Context Values
```typescript
const user = c.get('user')         // { sub, email, role, name, ... }
const userId = c.get('userId')     // user.id
const userRole = c.get('userRole') // user.role
```

## 📁 File Location Guide

| Need | Location | Import |
|------|----------|--------|
| Role constants | `constants/` | `ROLES.ADMIN` |
| HTTP status | `constants/` | `HTTP_STATUS.OK` |
| Configs | `config/` | `CONFIG.JWT.EXPIRY` |
| User interface | `types/` | `type User = ...` |
| Format success | `utils/response.ts` | `sendSuccess(c, data)` |
| Throw error | `utils/errors.ts` | `throw new ValidationError(...)` |
| Helper functions | `utils/helpers.ts` | `generateId('user')` |
| DB operations | `db/service.ts` | `new DatabaseService(db)` |
| Validate input | `validators/` | `validateEmail(email)` |
| Auth/role check | `middleware/auth.ts` | `requireRole('admin')` |
| Business logic | `services/` | `UserService` |
| API endpoints | `routes/api/` | `router.post('/')` |

## 🔍 Common Scenarios

### Scenario 1: Create a User Endpoint
```typescript
// src/routes/api/users/create.ts
router.post('/', auth, requireManager, async (c) => {
  const { email, password, full_name } = await c.req.json()

  // Validate
  const validated = validateSignupInput(email, password, full_name)

  // Check exists
  const db = new DatabaseService(c.env.DB)
  const exists = await db.findOne(
    'SELECT id FROM users WHERE email=?',
    [validated.email]
  )

  if (exists) return sendError(c, 'Email exists', 409)

  // Create
  const userId = generateId('user')
  const newUser = await db.insert('users', {
    id: userId,
    email: validated.email,
    password_hash: await hashPassword(validated.password),
    full_name: validated.full_name,
    avatar_color: getRandomAvatarColor(),
    is_active: 1,
  })

  return sendCreated(c, newUser)
})
```

### Scenario 2: Get Paginated List
```typescript
router.get('/', auth, async (c) => {
  const { limit = '20', page = '1' } = c.req.query()
  const { limit: l, offset } = getPaginationParams(limit, page)

  const db = new DatabaseService(c.env.DB)
  
  // Get data
  const items = await db.findAll(
    'SELECT * FROM users LIMIT ? OFFSET ?',
    [l, offset]
  )

  // Get total
  const total = await db.count('SELECT * FROM users')

  return sendPaginated(c, items, total, parseInt(page), l)
})
```

### Scenario 3: Use Service Layer
```typescript
// Assume UserService exists in src/services/user.service.ts
class UserService {
  async createUser(email, password, full_name) { ... }
  async getUserById(id) { ... }
  async updateUser(id, data) { ... }
}

// In route
const userService = new UserService(new DatabaseService(c.env.DB))
const user = await userService.createUser(email, password, full_name)
return sendCreated(c, user)
```

### Scenario 4: Check Permissions
```typescript
router.use('*', requireManager)  // Only admin & pm

router.post('/delete/:id', async (c) => {
  const id = c.req.param('id')
  const user = c.get('user')

  // Only allow user to delete own account (unless admin)
  if (user.role !== ROLES.ADMIN && user.sub !== id) {
    return sendForbidden(c)
  }

  const db = new DatabaseService(c.env.DB)
  await db.delete('users', 'id=?', [id])

  return sendSuccess(c, { deleted: true })
})
```

## 🚨 Error Handling

```typescript
// Throw specific errors
throw new ValidationError('Invalid email')               // 400
throw new AuthenticationError('Token expired')           // 401
throw new AuthorizationError('Not an admin')             // 403
throw new NotFoundError('User')                          // 404
throw new ConflictError('Email already exists')          // 409
throw new DatabaseError('Query failed')                  // 500

// Handle in route
try {
  // ... code ...
} catch (error) {
  if (error instanceof ValidationError) {
    return sendBadRequest(c, error.message)
  }
  if (error instanceof AuthorizationError) {
    return sendForbidden(c)
  }
  return sendError(c, 'Server error', 500)
}
```

## 📊 Pagination Helper

```typescript
const { limit, page, offset } = getPaginationParams(
  c.req.query('limit'),
  c.req.query('page')
)

// Now use in query
sql += ` LIMIT ${limit} OFFSET ${offset}`

// Return paginated
return sendPaginated(c, items, total, page, limit)
```

## 🔑 Authentication Example

```typescript
// Protect route with auth
router.post('/', auth, async (c) => {
  const user = c.get('user')
  
  // user = { 
  //   sub: 'user-123',
  //   email: 'user@example.com',
  //   role: 'developer',
  //   name: 'John Doe'
  // }
})

// Check role
router.use('*', requireRole('admin', 'pm'))

// Only for managers
router.delete('/:id', requireManager, async (c) => { ... })

// Optional - user might be null
router.get('/', optionalAuth, async (c) => {
  const user = c.get('user')
  if (user) {
    // Authenticated
  } else {
    // Anonymous
  }
})
```

## 📚 File Structure to Know

```
src/
├─ types/index.ts           ← All your type definitions
├─ constants/index.ts       ← ROLES, STATUS, MESSAGES
├─ config/index.ts          ← Settings and configuration
├─ validators/index.ts      ← Input validation functions
├─ utils/
│  ├─ response.ts           ← Response helpers
│  ├─ errors.ts             ← Error classes
│  └─ helpers.ts            ← Utility functions
├─ db/service.ts            ← Database wrapper
├─ middleware/auth.ts       ← Auth middleware
├─ services/                ← Business logic (create here!)
├─ routes/api/              ← API endpoints (organize here!)
└─ index.tsx                ← Main app
```

---

**Tip:** Start building by creating a service in `src/services/` and routes in `src/routes/api/`!
