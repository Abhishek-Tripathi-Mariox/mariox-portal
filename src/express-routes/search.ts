// ───────────────────────────────────────────────────────────────────
// Global search — Elasticsearch-backed
// ───────────────────────────────────────────────────────────────────
// The matching is done by ES (the combined cls_search field gives partial /
// substring matching across every column). Authorization is done HERE, in app
// code, by filtering ES candidates through the same visibility rules each
// entity's list route uses — an unscoped ES search would leak data.
import { Router } from 'express'
import type { MongoModels } from '../models/mongo-models'
import { createAuthMiddleware, userHasAnyPermission } from '../express-middleware/auth'
import { isElasticEnabled, multiSearch } from '../utils/elastic'
import { isProjectLinkedToUser } from './projects'

const CANDIDATES = 25 // pulled from ES per entity, before scoping
const SHOWN = 6       // returned per group after scoping

export function createSearchRouter(models: MongoModels, jwtSecret: string) {
  const router = Router()
  router.use(createAuthMiddleware(jwtSecret))

  router.get('/', async (req, res) => {
    try {
      const user = req.user as any
      const sub = String(user?.sub || '')
      const role = String(user?.role || '').toLowerCase()
      const q = String(req.query.q || '').trim()

      const uHas = (...keys: string[]) => userHasAnyPermission(models, user, ...keys)
      const [
        canViewAllProjects, canViewAllClients, canClientsList,
        canViewAllLeads, canLeadsList, canInvoices, canViewAllTickets, canTicketsList,
      ] = await Promise.all([
        uHas('projects.view_all'),
        uHas('clients.view_all'),
        uHas('clients.view_all', 'clients.create', 'clients.edit'),
        uHas('leads.view_all'),
        uHas('leads.view_all', 'leads.view_own'),
        uHas('invoices.view_all', 'invoices.create', 'invoices.send', 'invoices.mark_paid', 'invoices.delete'),
        uHas('tickets.view_all'),
        uHas('tickets.view_all', 'tickets.create', 'tickets.assign'),
      ])

      const perms = {
        canProjects: true,
        canTasks: true,
        canPTasks: true,
        canClients: canClientsList,
        canLeads: canLeadsList,
        canInvoices,
        canDocs: true,
        canTickets: canTicketsList,
      }

      const empty = { projects: [], tasks: [], ptasks: [], clients: [], leads: [], invoices: [], documents: [], tickets: [], perms }
      // Search needs ES; lists/gets still fall back to Mongo, but matching is ES-only.
      if (!isElasticEnabled() || q.length < 2) return res.json(empty)

      // ── ES candidate fetch — ONE _msearch round trip for all entities ──
      const [pHits, tHits, cHits, lHits, iHits, dHits, tkHits, ptHits] = await multiSearch([
        { collection: 'projects', q, size: CANDIDATES },
        { collection: 'tasks', q, size: CANDIDATES },
        { collection: 'clients', q, size: perms.canClients ? CANDIDATES : 0 },
        { collection: 'leads', q, size: perms.canLeads ? CANDIDATES : 0 },
        { collection: 'invoices', q, size: perms.canInvoices ? CANDIDATES : 0 },
        { collection: 'documents', q, size: CANDIDATES },
        { collection: 'support_tickets', q, size: perms.canTickets ? CANDIDATES : 0 },
        { collection: 'personal_tasks', q, size: CANDIDATES },
      ])

      // ── Scoping data ──
      const myAssignments = canViewAllProjects
        ? []
        : (await models.projectAssignments.find({ user_id: sub, is_active: 1 })) as any[]
      // Projects referenced by project/task/document hits — used for both
      // visibility checks and project_name enrichment.
      const projIds = new Set<string>()
      for (const p of pHits) if (p.id) projIds.add(String(p.id))
      for (const t of tHits) if (t.project_id) projIds.add(String(t.project_id))
      for (const d of dHits) if (d.project_id) projIds.add(String(d.project_id))
      const projDocs = projIds.size
        ? (await models.projects.find({ id: { $in: [...projIds] } })) as any[]
        : []
      const projMap = new Map(projDocs.map((p) => [String(p.id), p]))

      const projectVisible = (p: any) => !!p && (canViewAllProjects || isProjectLinkedToUser(p, user, myAssignments))
      const docVisible = (d: any) => {
        if (String(d.created_by || '') === sub) return true
        if (role === 'admin' || role === 'pm' || role === 'pc') return true
        if (role === 'client') return d.visibility === 'client' || d.visibility === 'all'
        return d.visibility !== 'internal' // developer / team / others
      }

      // ── Apply scope + shape ──
      // Rank every group by ES relevance (_score) so the most relevant matches
      // surface first (and the top-N we keep are the best matches).
      const byScore = (a: any, b: any) => (Number(b._score) || 0) - (Number(a._score) || 0)

      const projects = pHits
        .filter((p) => projectVisible(projMap.get(String(p.id)) || p))
        .sort(byScore)
        .slice(0, SHOWN)

      const tasks = tHits
        .filter((t) => canViewAllProjects || projectVisible(projMap.get(String(t.project_id))))
        .sort(byScore)
        .map((t) => ({ ...t, project_name: projMap.get(String(t.project_id))?.name || null }))
        .slice(0, SHOWN)

      const clients = (canViewAllClients ? cHits : cHits.filter((c) => String(c.created_by || '') === sub)).sort(byScore).slice(0, SHOWN)
      const leads = (canViewAllLeads ? lHits : lHits.filter((l) => String(l.assigned_to || '') === sub || String(l.created_by || '') === sub)).sort(byScore).slice(0, SHOWN)
      const invoices = iHits.slice().sort(byScore).slice(0, SHOWN)
      const documents = dHits
        .filter(docVisible)
        .sort(byScore)
        .map((d) => ({ ...d, project_name: projMap.get(String(d.project_id))?.name || null }))
        .slice(0, SHOWN)
      const tickets = tkHits
        .filter((t) => canViewAllTickets || [t.created_by_id, t.assigned_to_id, t.client_id].map((x) => String(x || '')).includes(sub))
        .sort(byScore)
        .slice(0, SHOWN)
      const ptasks = ptHits
        .filter((t) => String(t.assigned_to || '') === sub || String(t.created_by || '') === sub)
        .sort(byScore)
        .slice(0, SHOWN)

      return res.json({ projects, tasks, ptasks, clients, leads, invoices, documents, tickets, perms })
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || 'Search failed' })
    }
  })

  return router
}
