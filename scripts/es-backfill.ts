// ───────────────────────────────────────────────────────────────────
// Standalone Elasticsearch backfill
// ───────────────────────────────────────────────────────────────────
// Re-indexes existing Mongo data into Elasticsearch on demand — without
// booting the whole app. Use it after first enabling ES, or after bumping
// `elastic_version` to populate the fresh `*_<version>` indexes.
//
//   npm run es:backfill                # every collection
//   npm run es:backfill tasks users    # only these collections
//
// Each index is (re)created with the proper settings/mappings (ngram analyzer,
// cls_search, dynamic templates) before its documents are written.

import { MongoClient } from 'mongodb'
import { createMongoModels, backfillElastic } from '../src/models/mongo-models'
import { configureElastic, pingElastic, bulkIndex } from '../src/utils/elastic'
import { loadRuntimeEnv } from '../src/utils/runtime-env'

const env = loadRuntimeEnv()

if (!configureElastic(env as any)) {
  console.error('[es-backfill] Elasticsearch is not configured — set elastic_ip / elastic_username / elastic_password in .dev.vars')
  process.exit(1)
}

const conn = String(env.LOCAL_MONGO_DB || '')
if (!conn) {
  console.error('[es-backfill] LOCAL_MONGO_DB is not set')
  process.exit(1)
}
const dbName = String(env.MONGODB_DB || new URL(conn).pathname.replace(/^\//, '') || 'mariox-portal')

const client = new MongoClient(conn)
await client.connect()
const db = client.db(dbName)
const models = createMongoModels(db)

if (!(await pingElastic())) {
  console.error('[es-backfill] could not reach Elasticsearch — aborting')
  await client.close()
  process.exit(1)
}

// Optional collection filter from CLI args (everything after the script name).
const only = process.argv.slice(2).map((s) => s.trim()).filter(Boolean)

if (only.length) {
  let total = 0
  for (const name of only) {
    try {
      const docs = await db.collection(name).find({}).toArray()
      await bulkIndex(name, docs)
      total += docs.length
      console.log(`[es-backfill] ${name}: ${docs.length} docs`)
    } catch (e: any) {
      console.warn(`[es-backfill] ${name} failed:`, e?.message || e)
    }
  }
  console.log(`[es-backfill] done — ${total} docs across ${only.length} collection(s)`)
} else {
  await backfillElastic(models)
}

await client.close()
process.exit(0)
