// ───────────────────────────────────────────────────────────────────
// Elasticsearch mirror
// ───────────────────────────────────────────────────────────────────
// Every Mongo collection is mirrored into a matching Elasticsearch index so
// the data is searchable outside Mongo. This talks to ES over its REST API
// with the global `fetch` (no extra dependency) using HTTP Basic auth.
//
// Configuration comes from the runtime env (.dev.vars):
//   elastic_ip        host or full URL (e.g. "10.0.0.5", "http://10.0.0.5:9200",
//                     or "https://my-cluster:9243"). Scheme defaults to http
//                     and port to 9200 when omitted.
//   elastic_username  Basic-auth user
//   elastic_password  Basic-auth password
//
// When any of these are missing the whole module is a no-op — callers never
// need to branch, and there is zero overhead on the write path.

import http from 'node:http'
import https from 'node:https'

// Keep-alive connection pools so every ES call reuses an already-open TCP+TLS
// connection instead of paying a fresh handshake (the big latency cost when the
// cluster is remote). One agent per (protocol, tls-verify) combination.
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 64, keepAliveMsecs: 30_000 })
const httpsAgentSecure = new https.Agent({ keepAlive: true, maxSockets: 64, keepAliveMsecs: 30_000, rejectUnauthorized: true })
const httpsAgentInsecure = new https.Agent({ keepAlive: true, maxSockets: 64, keepAliveMsecs: 30_000, rejectUnauthorized: false })

// Bulk requests are chunked so a large backfill doesn't build one giant body.
const BULK_CHUNK = 500

let enabled = false
let baseUrl = ''
let authHeader = ''
// Index version suffix read from .dev.vars (elastic_version), e.g. "version1".
// Index names become "<collection>_<version>" (tasks_version1, users_version1…)
// so a schema/data revision can live in a fresh set of indexes side-by-side.
let indexVersion = ''
// When true, findById reads from ES first (realtime GET) and falls back to
// Mongo on a miss. Off by default (set elastic_read_first=true) because the
// write mirror is asynchronous — see isElasticReadFirst() / getDoc().
let readFirst = false
// ES 8 with security on an IP serves a self-signed cert, so TLS verification
// is off by default. Set elastic_tls_verify=true once a trusted cert is in
// place. Only affects the ES connection — not the rest of the process.
let tlsVerify = false
// ngram bounds for the partial-match analyzer on the combined `cls_search`
// field (configurable via elastic_min_gram / elastic_max_gram).
let minGram = 2
let maxGram = 10

// Tolerate values pasted JSON-style (wrapping quotes and/or a trailing comma),
// which the .env parser leaves intact when the trailing comma breaks its
// quote-stripping heuristic.
function sanitizeEnvValue(v: any): string {
  let s = String(v ?? '').trim().replace(/,+$/, '').trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1)
  }
  return s.trim()
}

function buildBaseUrl(ip: string): string {
  let s = String(ip || '').trim()
  if (!s) return ''
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s
  try {
    const u = new URL(s)
    if (!u.port) u.port = '9200'
    return u.origin
  } catch {
    return ''
  }
}

export function configureElastic(env: Record<string, any>): boolean {
  const ip = sanitizeEnvValue(env.elastic_ip ?? env.ELASTIC_IP)
  const user = sanitizeEnvValue(env.elastic_username ?? env.ELASTIC_USERNAME)
  const pass = sanitizeEnvValue(env.elastic_password ?? env.ELASTIC_PASSWORD)
  if (!ip || !user || !pass) {
    enabled = false
    return false
  }
  baseUrl = buildBaseUrl(ip)
  if (!baseUrl) {
    enabled = false
    return false
  }
  const verify = sanitizeEnvValue(env.elastic_tls_verify ?? env.ELASTIC_TLS_VERIFY).toLowerCase()
  tlsVerify = verify === 'true' || verify === '1'
  // Index version suffix — sanitised so it's safe in an index name (ES indexes
  // must be lowercase and can't contain spaces or most punctuation).
  indexVersion = sanitizeEnvValue(env.elastic_version ?? env.ELASTIC_VERSION)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  // ngram bounds for partial-match search. Guard rails: min ≥ 1, max ≥ min.
  const mn = parseInt(sanitizeEnvValue(env.elastic_min_gram ?? env.ELASTIC_MIN_GRAM), 10)
  const mx = parseInt(sanitizeEnvValue(env.elastic_max_gram ?? env.ELASTIC_MAX_GRAM), 10)
  minGram = Number.isFinite(mn) && mn >= 1 ? mn : 2
  maxGram = Number.isFinite(mx) && mx >= minGram ? mx : Math.max(minGram, 10)
  const rf = sanitizeEnvValue(env.elastic_read_first ?? env.ELASTIC_READ_FIRST).toLowerCase()
  readFirst = rf === 'true' || rf === '1'
  // A new mapping/analyzer config means the in-process "already created" cache
  // is stale — clear it so indexes get (re)ensured with the current settings.
  ensuredIndexes.clear()
  authHeader = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
  enabled = true
  return true
}

export function isElasticEnabled(): boolean {
  return enabled
}

// Whether findById should try ES before Mongo (only when ES is on AND the
// read-first flag is set).
export function isElasticReadFirst(): boolean {
  return enabled && readFirst
}

// Realtime get-by-id straight from ES (not subject to the refresh delay — ES
// serves GET /_doc/{id} from the translog). Returns the stored _source, or
// null on a miss / any error so the caller can fall back to Mongo.
export async function getDoc(collection: string, id: string): Promise<any | null> {
  if (!enabled || !id) return null
  try {
    const res = await rawRequest('GET', `/${indexFor(collection)}/_doc/${encodeURIComponent(String(id))}`)
    if (res.status !== 200) return null
    const parsed = JSON.parse(res.text)
    return parsed?.found ? parsed._source : null
  } catch {
    return null
  }
}

function indexFor(collection: string): string {
  const base = String(collection).toLowerCase()
  return indexVersion ? `${base}_${indexVersion}` : base
}

// Collections we never mirror to ES (internal/not searched). Their snapshots
// can be large; reads fall back to Mongo automatically.
const NO_MIRROR = new Set(['trash'])

// ── Mongo-filter → ES-query translation ──────────────────────────────
// Only the subset of Mongo query shapes this app actually uses is translated.
// Anything else throws Bail, which makes searchByFilter return null so the
// caller falls back to Mongo — correctness over coverage.
class Bail extends Error {}

// Exact-equality for one field. Strings match on the `.keyword` sub-field (the
// analyzed text field can't term-match a raw value); numbers/booleans match the
// field directly; null means "missing/!exists" (ES doesn't index null values).
function eqClause(field: string, value: any): any {
  if (value === null || value === undefined) return { bool: { must_not: { exists: { field } } } }
  const t = typeof value
  if (t === 'string') {
    return { bool: { should: [{ term: { [field]: value } }, { term: { [`${field}.keyword`]: value } }], minimum_should_match: 1 } }
  }
  if (t === 'number' || t === 'boolean') return { term: { [field]: value } }
  throw new Bail() // arrays/objects as a direct equality value — let Mongo do it
}

function fieldClause(field: string, cond: any): any {
  if (cond === null || typeof cond !== 'object' || Array.isArray(cond)) return eqClause(field, cond)
  const must: any[] = []
  const mustNot: any[] = []
  for (const op of Object.keys(cond)) {
    const v = cond[op]
    switch (op) {
      case '$eq': must.push(eqClause(field, v)); break
      case '$ne': mustNot.push(eqClause(field, v)); break
      case '$in':
        if (!Array.isArray(v)) throw new Bail()
        must.push({ bool: { should: v.map((x) => eqClause(field, x)), minimum_should_match: 1 } }); break
      case '$nin':
        if (!Array.isArray(v)) throw new Bail()
        for (const x of v) mustNot.push(eqClause(field, x)); break
      case '$exists':
        if (v) must.push({ exists: { field } }); else mustNot.push({ exists: { field } }); break
      case '$gt': case '$gte': case '$lt': case '$lte':
        must.push({ range: { [field]: { [op.slice(1)]: v } } }); break
      default: throw new Bail()
    }
  }
  const bool: any = {}
  if (must.length) bool.must = must
  if (mustNot.length) bool.must_not = mustNot
  return { bool }
}

function translateFilter(filter: any): any {
  const keys = Object.keys(filter || {})
  if (!keys.length) return { match_all: {} }
  const must: any[] = []
  const mustNot: any[] = []
  for (const k of keys) {
    const v = filter[k]
    if (k === '$or') {
      if (!Array.isArray(v)) throw new Bail()
      must.push({ bool: { should: v.map(translateFilter), minimum_should_match: 1 } })
    } else if (k === '$and') {
      if (!Array.isArray(v)) throw new Bail()
      for (const sub of v) must.push(translateFilter(sub))
    } else if (k === '$nor') {
      if (!Array.isArray(v)) throw new Bail()
      for (const sub of v) mustNot.push(translateFilter(sub))
    } else if (k.startsWith('$')) {
      throw new Bail()
    } else {
      must.push(fieldClause(k, v))
    }
  }
  const bool: any = {}
  if (must.length) bool.must = must
  if (mustNot.length) bool.must_not = mustNot
  return { bool }
}

// ES-first list/findOne. Returns matching _source docs, or null to signal
// "fall back to Mongo" (ES off, index missing, untranslatable filter/options,
// error, or a result set we'd have to truncate). An empty array means ES is
// reachable but had no matches — the caller still falls back to Mongo so a
// not-yet-synced collection is served from the source of truth.
export async function searchByFilter(collection: string, filter: any, options: any = {}): Promise<any[] | null> {
  if (!enabled) return null
  const opts = options || {}
  // Sort / projection / skip change result shape or order in ways we won't
  // risk reproducing — hand those to Mongo.
  if (opts.projection || opts.skip || opts.sort) return null
  let query: any
  try { query = translateFilter(filter || {}) } catch { return null }
  const hasLimit = Number.isFinite(opts.limit) && opts.limit > 0
  const size = hasLimit ? Math.min(opts.limit, 10000) : 10000
  let res
  try {
    res = await rawRequest('POST', `/${indexFor(collection)}/_search`, JSON.stringify({ query, size, track_total_hits: true }))
  } catch { return null }
  if (res.status < 200 || res.status >= 300) return null // 404 (no index) etc → Mongo
  let body: any
  try { body = JSON.parse(res.text) } catch { return null }
  const hits = body?.hits?.hits || []
  const total = body?.hits?.total?.value ?? hits.length
  // Without an explicit limit, Mongo's find() returns everything — if ES has
  // more than we fetched, it'd silently drop docs, so defer to Mongo.
  if (!hasLimit && total > hits.length) return null
  return hits.map((h: any) => h._source)
}

// Index names we've already created/verified this process, so the create check
// runs once per index rather than on every write. Cleared on reconfigure.
const ensuredIndexes = new Map<string, Promise<void>>()

// settings + mappings applied when an index is first created:
//   • an ngram analyzer (min_gram..max_gram) for substring / partial matching
//   • `cls_search`: a combined field every text column copies into, so a single
//     query against cls_search searches across the whole record
//   • a dynamic template so every model column (string) is mapped consistently
//     (analyzed text + a `.keyword` sub-field for exact match / sort / aggs)
//     and fed into cls_search
function buildIndexBody() {
  return {
    settings: {
      index: { max_ngram_diff: Math.max(1, maxGram - minGram) },
      analysis: {
        tokenizer: {
          cls_ngram_tokenizer: {
            type: 'ngram',
            min_gram: minGram,
            max_gram: maxGram,
            token_chars: ['letter', 'digit'],
          },
        },
        analyzer: {
          // Index-time: break text into ngrams for partial matching.
          cls_ngram_analyzer: { type: 'custom', tokenizer: 'cls_ngram_tokenizer', filter: ['lowercase'] },
          // Search-time: don't ngram the query itself, just lowercase it.
          cls_search_analyzer: { type: 'custom', tokenizer: 'standard', filter: ['lowercase'] },
        },
      },
    },
    mappings: {
      properties: {
        // The catch-all partial-search field. Heavy ngram indexing lives here
        // only, not on every individual column.
        cls_search: { type: 'text', analyzer: 'cls_ngram_analyzer', search_analyzer: 'cls_search_analyzer' },
      },
      dynamic_templates: [
        {
          // Text columns: analyzed text + a .keyword sub-field, copied into the
          // combined search field.
          strings_as_text_and_keyword: {
            match_mapping_type: 'string',
            mapping: {
              type: 'text',
              copy_to: 'cls_search',
              fields: { keyword: { type: 'keyword', ignore_above: 256 } },
            },
          },
        },
        {
          // Everything else (numbers, dates, booleans) keeps its native type
          // but is ALSO copied into cls_search, so a single query against
          // cls_search really searches the whole record — not just text.
          all_others_into_cls_search: {
            match_mapping_type: '*',
            mapping: {
              type: '{dynamic_type}',
              copy_to: 'cls_search',
            },
          },
        },
      ],
    },
  }
}

// Create the index with proper settings/mappings if it doesn't exist yet.
// Idempotent and race-safe (a concurrent create returns resource_already_exists,
// which we treat as success). Cached so it runs once per index per process.
function ensureIndex(collection: string): Promise<void> {
  const index = indexFor(collection)
  let p = ensuredIndexes.get(index)
  if (p) return p
  p = (async () => {
    const head = await rawRequest('HEAD', `/${index}`)
    if (head.status === 200) return
    const res = await rawRequest('PUT', `/${index}`, JSON.stringify(buildIndexBody()))
    if (res.status >= 400 && !/resource_already_exists/i.test(res.text)) {
      throw new Error(`ES create ${index} → ${res.status} ${res.text.slice(0, 300)}`)
    }
  })().catch((e) => {
    // Drop the cache entry so a later write retries the create.
    ensuredIndexes.delete(index)
    throw e
  })
  ensuredIndexes.set(index, p)
  return p
}

// Strip Mongo's binary _id — the ES document _id is the record's own `id`.
function clean(doc: any): any {
  if (!doc || typeof doc !== 'object') return doc
  const { _id, ...rest } = doc
  return rest
}

// Raw HTTP(S) request via Node's http/https so we can accept the self-signed
// cert ES serves on an IP (rejectUnauthorized scoped to this request only).
// Global `fetch` offers no per-call TLS control without the undici package.
function rawRequest(method: string, path: string, payload?: string, ndjson = false): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    let url: URL
    try { url = new URL(baseUrl + path) } catch (e) { return reject(e) }
    const isHttps = url.protocol === 'https:'
    const mod = isHttps ? https : http
    const agent = isHttps ? (tlsVerify ? httpsAgentSecure : httpsAgentInsecure) : httpAgent
    const req = mod.request(
      {
        method,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        agent,
        headers: {
          Authorization: authHeader,
          'Content-Type': ndjson ? 'application/x-ndjson' : 'application/json',
          ...(payload != null ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        ...(isHttps ? { rejectUnauthorized: tlsVerify } : {}),
      },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (c) => { data += c })
        res.on('end', () => resolve({ status: res.statusCode || 0, text: data }))
      },
    )
    req.setTimeout(15000, () => req.destroy(new Error('ES request timeout')))
    req.on('error', reject)
    if (payload != null) req.write(payload)
    req.end()
  })
}

async function esFetch(method: string, path: string, body?: any, ndjson = false): Promise<{ status: number; text: string } | null> {
  if (!enabled) return null
  const payload = body == null ? undefined : ndjson ? String(body) : JSON.stringify(body)
  const res = await rawRequest(method, path, payload, ndjson)
  // 404 on delete (already gone) is fine; everything else non-2xx is an error.
  if ((res.status < 200 || res.status >= 300) && res.status !== 404) {
    throw new Error(`ES ${method} ${path} → ${res.status} ${res.text.slice(0, 300)}`)
  }
  return res
}

// Verify the cluster is reachable. Logs once at boot; never throws.
export async function pingElastic(): Promise<boolean> {
  if (!enabled) return false
  try {
    const res = await esFetch('GET', '/')
    let info: any = {}
    try { info = JSON.parse(res!.text) } catch { /* non-JSON banner */ }
    const name = info?.version?.number ? `v${info.version.number}` : ''
    console.log(`[elastic] connected to ${baseUrl} ${name}`.trim())
    return true
  } catch (e: any) {
    console.warn('[elastic] ping failed — mirroring disabled:', e?.message || e)
    enabled = false
    return false
  }
}

export async function indexDoc(collection: string, doc: any): Promise<void> {
  if (!enabled || !doc || !doc.id || NO_MIRROR.has(collection)) return
  await ensureIndex(collection)
  await esFetch('PUT', `/${indexFor(collection)}/_doc/${encodeURIComponent(String(doc.id))}`, clean(doc))
}

// Full-text/partial search against a collection's combined cls_search field.
// Returns the matching _source docs (most relevant first), capped at `size`.
// Empty on any error / when ES is off — the caller decides what to do then.
export async function searchText(collection: string, q: string, size = 25): Promise<any[]> {
  if (!enabled || !q || !String(q).trim()) return []
  const body = { size, query: { match: { cls_search: String(q).trim() } } }
  try {
    const res = await rawRequest('POST', `/${indexFor(collection)}/_search`, JSON.stringify(body))
    if (res.status < 200 || res.status >= 300) return []
    const parsed = JSON.parse(res.text)
    // Carry ES relevance score so callers can rank/sort by it.
    return (parsed?.hits?.hits || []).map((h: any) => ({ ...h._source, _score: h._score }))
  } catch {
    return []
  }
}

// Run several cls_search queries in ONE request via the _msearch API — a single
// network round trip instead of one per collection (big win against a remote
// cluster). Returns hit-arrays aligned to the input specs; an empty array for
// any spec that errored or had no matches.
export async function multiSearch(specs: Array<{ collection: string; q: string; size?: number }>): Promise<any[][]> {
  if (!enabled || !specs.length) return specs.map(() => [])
  const lines: string[] = []
  for (const s of specs) {
    lines.push(JSON.stringify({ index: indexFor(s.collection) }))
    lines.push(JSON.stringify({ size: s.size ?? 25, query: { match: { cls_search: String(s.q || '').trim() } } }))
  }
  try {
    const res = await rawRequest('POST', '/_msearch', lines.join('\n') + '\n', true)
    if (res.status < 200 || res.status >= 300) return specs.map(() => [])
    const parsed = JSON.parse(res.text)
    const responses: any[] = parsed?.responses || []
    // Carry ES relevance score (hits already come back sorted by _score desc).
    return specs.map((_, i) => (responses[i]?.hits?.hits || []).map((h: any) => ({ ...h._source, _score: h._score })))
  } catch {
    return specs.map(() => [])
  }
}

export async function deleteDoc(collection: string, id: string): Promise<void> {
  if (!enabled || !id) return
  await esFetch('DELETE', `/${indexFor(collection)}/_doc/${encodeURIComponent(String(id))}`)
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function bulkIndex(collection: string, docs: any[]): Promise<void> {
  if (!enabled || NO_MIRROR.has(collection)) return
  const index = indexFor(collection)
  const valid = (docs || []).filter((d) => d && d.id)
  if (!valid.length) return
  await ensureIndex(collection)
  for (const batch of chunk(valid, BULK_CHUNK)) {
    const lines: string[] = []
    for (const d of batch) {
      lines.push(JSON.stringify({ index: { _index: index, _id: String(d.id) } }))
      lines.push(JSON.stringify(clean(d)))
    }
    await esFetch('POST', '/_bulk', lines.join('\n') + '\n', true)
  }
}

export async function bulkDelete(collection: string, ids: string[]): Promise<void> {
  if (!enabled) return
  const index = indexFor(collection)
  const valid = (ids || []).filter(Boolean).map(String)
  for (const batch of chunk(valid, BULK_CHUNK)) {
    const lines = batch.map((id) => JSON.stringify({ delete: { _index: index, _id: id } }))
    await esFetch('POST', '/_bulk', lines.join('\n') + '\n', true)
  }
}
