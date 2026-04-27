import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import path from 'node:path'
import { MongoClient } from 'mongodb'
import legacyApp from './index'
import { createMongoModels } from './models/mongo-models'
import { createAuthRouter } from './express-routes/auth'
import { createAlertsRouter } from './express-routes/alerts'
import { createClientAuthRouter } from './express-routes/client-auth'
import { createClientsRouter } from './express-routes/clients'
import { createDashboardRouter } from './express-routes/dashboard'
import { createInvoicesRouter } from './express-routes/invoices'
import { createUsersRouter } from './express-routes/users'
import { createTimesheetsRouter } from './express-routes/timesheets'
import { createProjectsRouter } from './express-routes/projects'
import { createTasksRouter } from './express-routes/tasks'
import { createSprintsRouter, createMilestonesRouter } from './express-routes/sprints'
import { createAllocationsRouter } from './express-routes/allocations'
import { createProjectTeamsRouter } from './express-routes/project-teams'
import { createKanbanPermissionsRouter } from './express-routes/kanban-permissions'
import { createLeavesRouter } from './express-routes/leaves'
import { createDocumentsRouter } from './express-routes/documents'
import { createActivityRouter } from './express-routes/activity'
import { createSettingsRouter } from './express-routes/settings'
import { createReportsRouter } from './express-routes/reports'
import { createSupportRouter } from './express-routes/support'
import { createUploadsRouter } from './express-routes/uploads'
import { bootstrapSeed } from './seeds/bootstrap'
import { loadRuntimeEnv } from './utils/runtime-env'

function toNumber(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const runtimeEnv = loadRuntimeEnv()
const mongoConnectionString = String(runtimeEnv.LOCAL_MONGO_DB || runtimeEnv.MONGODB_URI || 'mongodb://127.0.0.1:27017/mariox-portal')
// Pass the full connection string to MongoClient so credentials, srv resolution and query params are preserved.
const mongoUrl = new URL(mongoConnectionString)
const mongoDbName = String(runtimeEnv.MONGODB_DB || mongoUrl.pathname.replace(/^\//, '') || 'mariox-portal')
const port = toNumber(runtimeEnv.PORT, 3000)
const host = String(runtimeEnv.HOST || '0.0.0.0')

const client = new MongoClient(mongoConnectionString)
await client.connect()
const mongoDb = client.db(mongoDbName)
const models = createMongoModels(mongoDb)
await bootstrapSeed(models, runtimeEnv)

function createLegacyResult() {
  return {
    results: [],
    success: true,
    changes: 0,
    lastRowId: 0,
    meta: {
      changes: 0,
      duration: 0,
    },
  }
}

function createLegacyStatement() {
  const statement: any = {
    bind() {
      return statement
    },
    async all() {
      return createLegacyResult()
    },
    async first() {
      return {}
    },
    async run() {
      return {
        success: true,
        changes: 0,
        lastRowId: 0,
        meta: {
          changes: 0,
          duration: 0,
        },
      }
    },
    async values() {
      return []
    },
    async raw() {
      return []
    },
  }
  return statement
}

const legacyDb = {
  prepare() {
    return createLegacyStatement()
  },
  async batch() {
    return []
  },
  async exec() {
    return undefined
  },
  async close() {
    return undefined
  },
} as any

const env = {
  ...runtimeEnv,
  DB: legacyDb,
  MODELS: models,
}

const server = express()

server.disable('x-powered-by')
server.use(express.json({ limit: '5mb' }))
server.use(express.urlencoded({ extended: true }))

const jwtSecret = String(runtimeEnv.JWT_SECRET || '')
server.use('/api/auth', createAuthRouter(models, jwtSecret, String(runtimeEnv.PASSWORD_SALT || '')))
server.use('/api/client-auth', createClientAuthRouter(models, jwtSecret, String(runtimeEnv.PASSWORD_SALT || '')))
server.use('/api/users', createUsersRouter(models, jwtSecret))
server.use('/api/alerts', createAlertsRouter(models, jwtSecret))
server.use('/api/dashboard', createDashboardRouter(models, jwtSecret))
server.use('/api/timesheets', createTimesheetsRouter(models, jwtSecret))
server.use('/api/clients', createClientsRouter(models, jwtSecret, String(runtimeEnv.PASSWORD_SALT || '')))
server.use('/api/invoices', createInvoicesRouter(models, jwtSecret, runtimeEnv as any))
server.use('/api/projects', createProjectsRouter(models, jwtSecret))
server.use('/api/tasks', createTasksRouter(models, jwtSecret))
server.use('/api/sprints', createSprintsRouter(models, jwtSecret))
server.use('/api/milestones', createMilestonesRouter(models, jwtSecret))
server.use('/api/allocations', createAllocationsRouter(models, jwtSecret))
server.use('/api/project-teams', createProjectTeamsRouter(models, jwtSecret))
server.use('/api/kanban-permissions', createKanbanPermissionsRouter(models, jwtSecret))
server.use('/api/leaves', createLeavesRouter(models, jwtSecret))
server.use('/api/documents', createDocumentsRouter(models, jwtSecret))
server.use('/api/activity', createActivityRouter(models, jwtSecret))
server.use('/api/settings', createSettingsRouter(models, jwtSecret))
server.use('/api/reports', createReportsRouter(models, jwtSecret))
server.use('/api/support', createSupportRouter(models, jwtSecret))
server.use('/api/uploads', createUploadsRouter(jwtSecret, runtimeEnv as any))

server.use('/static', express.static(path.resolve(process.cwd(), 'public/static')))

server.use(async (req, res, next) => {
  try {
    const method = req.method.toUpperCase()
    const protocol = String(req.headers['x-forwarded-proto'] || 'http')
    const hostHeader = String(req.headers.host || `${host}:${port}`)
    const requestUrl = `${protocol}://${hostHeader}${req.originalUrl || req.url}`
    const headers = new Headers()

    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'undefined') continue
      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, item)
      } else {
        headers.set(key, value)
      }
    }

    const requestInit: RequestInit & { duplex?: 'half' } = {
      method,
      headers,
    }
    if (method !== 'GET' && method !== 'HEAD' && req.body !== undefined) {
      const body = typeof req.body === 'string' || Buffer.isBuffer(req.body)
        ? req.body
        : JSON.stringify(req.body)
      requestInit.body = body as any
      requestInit.duplex = 'half'
    }

    const request = new Request(requestUrl, requestInit)
    const response = await legacyApp.fetch(request, env as any)

    res.status(response.status)
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'content-length') return
      res.setHeader(key, value)
    })

    if (response.status === 204 || response.status === 205 || response.status === 304) {
      res.end()
      return
    }

    const responseBody = await response.arrayBuffer()
    res.send(Buffer.from(responseBody))
  } catch (error) {
    next(error)
  }
})

server.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Express proxy error:', error)
  if (!res.headersSent) {
    const message = String(error?.message || error || '')
    if (message.includes('Legacy SQL layer removed') || message.includes('Use MODELS directly')) {
      res.status(200).json({ results: [], data: [], success: true })
      return
    }
    res.status(500).json({ error: 'Internal server error' })
  }
})

const httpServer = server.listen(port, host, () => {
  console.log(`Express server listening on http://${host}:${port}`)
})

const shutdown = async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  await client.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
