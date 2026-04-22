# Project Architecture Guide

## 📁 New Folder Structure

```
src/
├── config/                 # ⚙️ Configuration files
│   └── index.ts           # App config, JWT settings, pagination, etc.
│
├── constants/             # 📌 Global constants & enums
│   └── index.ts           # Roles, status, priorities, error messages
│
├── types/                 # 🔤 TypeScript interfaces
│   └── index.ts           # User, Project, Task, API Response types
│
├── db/                    # 💾 Database services
│   └── service.ts         # DatabaseService class with helper methods
│
├── validators/            # ✅ Input validation
│   └── index.ts           # Email, password, signup validation
│
├── utils/                 # 🛠️ Utility functions
│   ├── response.ts        # Response formatting (success, error, paginated)
│   ├── errors.ts          # Custom error classes
│   └── helpers.ts         # Helper functions (ID generation, formats, etc.)
│
├── middleware/            # 🔐 Express-like middleware
│   └── auth.ts            # Auth, role-based access, optional auth
│
├── services/              # 🎯 Business logic services
│   ├── auth.service.ts    # Authentication service
│   ├── user.service.ts    # User management
│   ├── project.service.ts # Project operations
│   └── ... (more services)
│
├── routes/api/            # 🌐 API routes (organized by domain)
│   ├── auth/              # Authentication routes
│   │   ├── login.ts
│   │   ├── signup.ts
│   │   └── verify.ts
│   ├── users/             # User management
│   ├── projects/          # Project management
│   ├── tasks/             # Task management
│   └── timesheets/        # Timesheet routes
│
├── index.tsx              # Main app entry point
└── renderer.tsx           # Renderer entry (if needed)
```

## 🎯 Core Concepts

### 1. Types (`src/types/index.ts`)
Centralized TypeScript interfaces:
```typescript
import type { Bindings, User, Project, ApiResponse } from './types'

const user: User = { id: '1', email: 'user@example.com', ... }
```

### 2. Constants (`src/constants/index.ts`)
Global constants for roles, statuses, messages:
```typescript
import { ROLES, PROJECT_STATUS, ERROR_MESSAGES } from './constants'

if (user.role === ROLES.ADMIN) { ... }
```

### 3. Config (`src/config/index.ts`)
Application configuration (URLs, timeouts, limits):
```typescript
import CONFIG from './config'

const token_expiry = CONFIG.JWT.EXPIRY
const max_limit = CONFIG.PAGINATION.MAX_LIMIT
```

### 4. Database Service (`src/db/service.ts`)
Simplified database operations:
```typescript
const db = new DatabaseService(c.env.DB)
const users = await db.findAll('SELECT * FROM users WHERE role=?', ['admin'])
const user = await db.findOne('SELECT * FROM users WHERE id=?', [userId])
const count = await db.count('SELECT * FROM users')
await db.insert('users', { email, password, ... })
```

### 5. Validators (`src/validators/index.ts`)
Input validation with error handling:
```typescript
import { validateEmail, validatePassword, validateRequired } from './validators'

const email = validateEmail(input.email)  // Throws ValidationError if invalid
```

### 6. Utils
#### Response Formatting (`src/utils/response.ts`)
```typescript
sendSuccess(c, data)           // Returns 200 with success flag
sendError(c, message, status)  // Returns error with status
sendCreated(c, data)           // Returns 201
sendForbidden(c)               // Returns 403
sendUnauthorized(c)            // Returns 401
sendPaginated(c, items, total, page, limit)
```

#### Error Classes (`src/utils/errors.ts`)
```typescript
throw new ValidationError('Invalid email')
throw new AuthenticationError('Invalid token')
throw new AuthorizationError('Insufficient permissions')
throw new NotFoundError('User')
throw new ConflictError('Email already exists')
```

#### Helpers (`src/utils/helpers.ts`)
```typescript
generateId('user')            // user-1710914400000
getRandomAvatarColor()        // Random Tailwind color
normalizeEmail(email)         // email@example.com
getPaginationParams(limit, page)
isValidEmail(email)
hasRole(userRole, ['admin'])
```

### 7. Middleware (`src/middleware/auth.ts`)
```typescript
app.use('*', auth)                    // Require auth for all routes
app.use(requireRole('admin', 'pm'))   // Role-based access
app.use(requireAdmin)                 // Only admins
app.use(optionalAuth)                 // Auth is optional
```

### 8. Services (`src/services/`)
Business logic layer - encapsulates data operations:
```typescript
// Example structure
class UserService {
  async createUser(email, password) { ... }
  async getUserById(id) { ... }
  async updateUser(id, data) { ... }
  async deleteUser(id) { ... }
  async changePassword(userId, oldPassword, newPassword) { ... }
}
```

### 9. Routes by Domain (`src/routes/api/`)
Organize routes by business domain:
- `auth/` - Authentication (login, signup, verify)
- `users/` - User management (CRUD, profile)
- `projects/` - Project management
- `tasks/` - Task/kanban management
- `timesheets/` - Time tracking

## 💡 Usage Examples

### Example: Creating a User Route
```typescript
// src/routes/api/users/create.ts
import { Hono } from 'hono'
import { auth, requireManager } from '../../../middleware/auth'
import { validateSignupInput } from '../../../validators'
import { sendSuccess, sendError, sendCreated } from '../../../utils/response'
import { DatabaseService } from '../../../db/service'
import type { Bindings } from '../../../types'

const router = new Hono<{ Bindings: Bindings }>()

router.post('/', auth, requireManager, async (c) => {
  try {
    const { email, password, full_name } = await c.req.json()
    
    // Validate input
    const validated = validateSignupInput(email, password, full_name)
    
    // Database operation
    const db = new DatabaseService(c.env.DB)
    const existing = await db.findOne('SELECT id FROM users WHERE email=?', [validated.email])
    
    if (existing) {
      return sendError(c, 'Email already exists', 409)
    }
    
    // Hash password (implement in service)
    const user = await db.insert('users', {
      id: generateId('user'),
      email: validated.email,
      password_hash: hashedPassword,
      full_name: validated.full_name,
    })
    
    return sendCreated(c, user)
  } catch (error) {
    return sendError(c, error.message, 500)
  }
})

export default router
```

### Example: Using in Main App
```typescript
// src/index.tsx
import { Hono } from 'hono'
import type { Bindings } from './types'

// Import organized routes
import authRoutes from './routes/api/auth'
import userRoutes from './routes/api/users'
import projectRoutes from './routes/api/projects'

const app = new Hono<{ Bindings: Bindings }>()

// Mount organized routes
app.route('/api/auth', authRoutes)
app.route('/api/users', userRoutes)
app.route('/api/projects', projectRoutes)

export default app
```

## 🚀 Best Practices

### 1. Always Use Types
```typescript
import type { User, Project } from './types'

const user: User = { ... }  // Type-safe
```

### 2. Centralize Constants
```typescript
// ❌ Bad
if (user.role === 'admin') { ... }

// ✅ Good
import { ROLES } from './constants'
if (user.role === ROLES.ADMIN) { ... }
```

### 3. Use DatabaseService
```typescript
// ❌ Bad
const result = await c.env.DB.prepare('SELECT ...').all()

// ✅ Good
const db = new DatabaseService(c.env.DB)
const result = await db.findAll('SELECT ...')
```

### 4. Validate Early
```typescript
try {
  const email = validateEmail(input.email)
  const password = validatePassword(input.password)
  // Proceed with validated data
} catch (error) {
  return sendError(c, error.message, 400)
}
```

### 5. Use Response Helpers
```typescript
// ❌ Bad
return c.json({ user: userData }, 200)

// ✅ Good
return sendSuccess(c, userData)
return sendForbidden(c)
return sendCreated(c, newUser)
```

### 6. Create Services for Logic
```typescript
// src/services/auth.service.ts
class AuthService {
  async login(email, password) { ... }
  async validate Token(token) { ... }
  async refreshToken(refreshToken) { ... }
}
```

## 📊 File Organization Checklist

- [x] Types centralized (`src/types/`)
- [x] Constants defined (`src/constants/`)
- [x] Config organized (`src/config/`)
- [x] Validators created (`src/validators/`)
- [x] Utils for common functions (`src/utils/`)
- [x] Middleware organized (`src/middleware/`)
- [x] DB service layer (`src/db/`)
- [ ] Services for business logic (`src/services/`)
- [ ] Routes organized by domain (`src/routes/api/`)

## 🔧 Next Steps

1. **Create Services Layer** - Move business logic to `src/services/`
2. **Migrate Routes** - Organize routes by domain in `src/routes/api/`
3. **Add Error Handling** - Use error classes throughout the app
4. **Create API Documentation** - Document all endpoints
5. **Add Tests** - Create test files alongside services

---

**This structure provides:**
- ✅ Clear separation of concerns
- ✅ Type safety with TypeScript
- ✅ Reusable utilities and validators
- ✅ Scalable service layer
- ✅ Organized by feature/domain
- ✅ Easy to maintain and extend
