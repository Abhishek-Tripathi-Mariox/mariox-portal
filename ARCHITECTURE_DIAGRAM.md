# 🏗️ Project Architecture Diagram

## Request Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         HTTP Request                             │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────────┐
        │   Middleware Chain                   │
        │  ─────────────────────────────────── │
        │  1. Logger                           │
        │  2. Auth (checks token)              │
        │  3. Role (checks permissions)        │
        │  4. Optional (custom)                │
        └────────────┬─────────────────────────┘
                     │
                     ▼
        ┌──────────────────────────────────────┐
        │   Route Handler                      │
        │  ─────────────────────────────────── │
        │  • Parse request                     │
        │  • Validate input (Validators)       │
        │  • Call service (Services)           │
        │  • Format response (Response Utils)  │
        └────────────┬─────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
        ▼                         ▼
  ┌──────────────┐         ┌──────────────┐
  │  Database    │         │  Services    │
  │  Service     │         │  ──────────  │
  │  ──────────  │         │  Business    │
  │  • find()    │         │  Logic       │
  │  • insert()  │         │              │
  │  • update()  │         └──────────────┘
  │  • delete()  │
  └──────────────┘
        │
        ▼
  ┌──────────────────┐
  │    SQLite DB     │
  │ (Mongo snapshot) │
  └──────────────────┘
```

## Folder Hierarchy

```
src/
│
├── 📌 constants/
│   └── index.ts                    ← ROLES, STATUS, MESSAGES
│
├── ⚙️ config/
│   └── index.ts                    ← APP CONFIG (JWT, DB, etc)
│
├── 🔤 types/
│   └── index.ts                    ← ALL INTERFACES
│
├── 🛠️ utils/
│   ├── response.ts                 ← Response formatting
│   ├── errors.ts                   ← Error classes
│   └── helpers.ts                  ← Helper functions
│
├── 💾 db/
│   └── service.ts                  ← Database operations
│
├── ✅ validators/
│   └── index.ts                    ← Input validation
│
├── 🔐 middleware/
│   └── auth.ts                     ← Auth & permissions
│
├── 🎯 services/
│   ├── auth.service.ts             ← Authentication logic
│   ├── user.service.ts             ← User operations
│   ├── project.service.ts          ← Project operations
│   └── ...                         ← More services
│
├── 🌐 routes/api/
│   ├── auth/                       ← Auth endpoints
│   │   ├── index.ts
│   │   ├── login.ts
│   │   └── signup.ts
│   │
│   ├── users/                      ← User endpoints
│   │   ├── index.ts
│   │   ├── create.ts
│   │   ├── list.ts
│   │   └── update.ts
│   │
│   ├── projects/                   ← Project endpoints
│   └── tasks/                      ← Task endpoints
│
├── index.tsx                       ← APP ENTRY POINT
└── renderer.tsx

```

## Data Flow Example: User Creates a Project

```
1. CLIENT SENDS REQUEST
   POST /api/projects
   {
     "name": "My Project",
     "description": "...",
     "client_id": "client-1"
   }
   
   ▼
   
2. MIDDLEWARE
   ✓ Logger logs request
   ✓ Auth middleware verifies JWT token
   ✓ requireManager checks user is PM/Admin
   
   ▼
   
3. ROUTE HANDLER
   ✓ Parse JSON body
   ✓ Validate input → validateRequired(), validateEnum()
   ✓ Extract user info from context
   
   ▼
   
4. SERVICE LAYER (Business Logic)
   ProjectService.createProject({
     name, description, client_id, created_by: user.id
   })
   
   ▼
   
5. DATABASE SERVICE
   ✓ Check if project with name exists
   ✓ Insert new project
   ✓ Create default kanban columns
   ✓ Set up permissions
   
   ▼
   
6. RESPONSE
   sendCreated(c, {
     id: "proj-123",
     name: "My Project",
     ...
   })
   
   Returns 201 Created to client
```

## File Organization by Purpose

```
CONFIGURATION & SETUP
├── config/index.ts        ← JWT, DB, pagination settings
├── constants/index.ts     ← ROLES, STATUS, MESSAGES
└── types/index.ts         ← All TypeScript interfaces

INPUT HANDLING
├── validators/index.ts    ← Validate user input
└── utils/helpers.ts       ← Parse & transform data

DATABASE & STORAGE
├── db/service.ts          ← Database operations
└── models/                ← Mongo collections registry

BUSINESS LOGIC
├── services/              ← Domain logic (Auth, User, Project, etc)
└── utils/helpers.ts       ← Utilities

REQUEST/RESPONSE HANDLING
├── middleware/auth.ts     ← Auth, roles, permissions
├── utils/response.ts      ← Format successful responses
├── utils/errors.ts        ← Custom error classes
└── routes/api/            ← Endpoints by domain

APP ENTRY
└── index.tsx              ← Main Hono app
```

## Integration Points

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                         │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTP Requests
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Hono App (src/index.tsx)                   │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Routes (/api/*)                                           │ │
│  │  ├─ /api/auth (Login, Signup, Verify)                    │ │
│  │  ├─ /api/users (CRUD operations)                         │ │
│  │  ├─ /api/projects (Project management)                   │ │
│  │  ├─ /api/tasks (Kanban, tasking)                         │ │
│  │  └─ /api/timesheets (Time tracking)                      │ │
│  └────────────────────────────────────────────────────────────┘ │
│                           ↓                                      │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Middleware (src/middleware/)                              │ │
│  │  ├─ Verify JWT token                                      │ │
│  │  ├─ Check user role                                       │ │
│  │  └─ Log requests                                          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                           ↓                                      │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Validators (src/validators/)                              │ │
│  │  ├─ Email validation                                      │ │
│  │  ├─ Password validation                                   │ │
│  │  └─ Data validation                                       │ │
│  └────────────────────────────────────────────────────────────┘ │
│                           ↓                                      │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Services (src/services/)  - BUSINESS LOGIC               │ │
│  │  ├─ AuthService (Login, Token verification)              │ │
│  │  ├─ UserService (User management)                        │ │
│  │  ├─ ProjectService (Project operations)                  │ │
│  │  └─ TaskService (Task management)                        │ │
│  └────────────────────────────────────────────────────────────┘ │
│                           ↓                                      │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Mongo Models (src/models/mongo-models.ts)                 │ │
│  │  ├─ SELECT queries (findAll, findOne)                    │ │
│  │  ├─ INSERT operations                                     │ │
│  │  ├─ UPDATE operations                                     │ │
│  │  ├─ DELETE operations                                     │ │
│  │  └─ TRANSACTIONS                                          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                           ↓                                      │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Response Formatting (src/utils/response.ts)               │ │
│  │  ├─ sendSuccess() → 200                                   │ │
│  │  ├─ sendCreated() → 201                                   │ │
│  │  ├─ sendError() → 400/500                                 │ │
│  │  └─ sendPaginated() → Paginated results                  │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTP Response (JSON)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Frontend (React)                           │
│               Receives formatted JSON response                  │
└─────────────────────────────────────────────────────────────────┘


SUPPORTING COMPONENTS
├─ constants/index.ts   ← ROLES, STATUS, etc
├─ types/index.ts       ← TypeScript interfaces
├─ config/index.ts      ← App configuration
├─ utils/helpers.ts     ← Helper functions
└─ utils/errors.ts      ← Error classes
```

## Example Endpoint Implementation

```
GET /api/projects/:id

client → Router → Middleware → Validator → Service → DB → Response

1. Route matches:           GET /api/projects/:id
2. Middleware runs:         auth, requireManager
3. Extract params:          id="proj-123"
4. Validator runs:          validateRequired(id)
5. Service executes:        ProjectService.getById(id)
   ├─ Query database:       SELECT * FROM projects WHERE id=?
   ├─ Fetch relations:      SELECT * FROM clients WHERE id=?
   └─ Format result:        { id, name, client, ... }
6. Response sent:           sendSuccess(c, project)
7. Client receives:         { success: true, data: { ... } }
```

## Best Practices Implemented

✅ **Separation of Concerns** - Each layer has one responsibility  
✅ **Type Safety** - Full TypeScript coverage  
✅ **DRY Principle** - No code duplication  
✅ **Reusability** - Utilities, validators, response helpers  
✅ **Scalability** - Service layer ready for complexity  
✅ **Error Handling** - Standardized error responses  
✅ **Security** - Input validation, role-based access  
✅ **Maintainability** - Clear folder structure, easy to navigate  

---

**This architecture supports:**
- 📈 Rapid feature development
- 🔧 Easy maintenance and debugging
- 🧪 Unit testing at service layer
- 📚 API documentation generation
- 👥 Team collaboration
- 🚀 Horizontal scaling
