// ───────────────────────────────────────────────────────────────────
// Database Service Layer
// ───────────────────────────────────────────────────────────────────

import type { D1Database } from '@cloudflare/workers-types'
import { DatabaseError } from '../utils/errors'

export class DatabaseService {
  constructor(private db: D1Database) {}

  /**
   * Execute query and get all results
   */
  async findAll(sql: string, params: any[] = []) {
    try {
      let query = this.db.prepare(sql)
      if (params.length > 0) {
        query = query.bind(...params)
      }
      const result = await query.all()
      return result.results || []
    } catch (error: any) {
      throw new DatabaseError(`Query failed: ${error.message}`)
    }
  }

  /**
   * Execute query and get first result
   */
  async findOne(sql: string, params: any[] = []) {
    try {
      let query = this.db.prepare(sql)
      if (params.length > 0) {
        query = query.bind(...params)
      }
      const result = await query.first()
      return result
    } catch (error: any) {
      throw new DatabaseError(`Query failed: ${error.message}`)
    }
  }

  /**
   * Count rows matching condition
   */
  async count(sql: string, params: any[] = []): Promise<number> {
    try {
      const countSql = `SELECT COUNT(*) as cnt FROM (${sql})`
      let query = this.db.prepare(countSql)
      if (params.length > 0) {
        query = query.bind(...params)
      }
      const result = await query.first() as any
      return result?.cnt || 0
    } catch (error: any) {
      throw new DatabaseError(`Count failed: ${error.message}`)
    }
  }

  /**
   * Insert record
   */
  async insert(table: string, data: Record<string, any>) {
    try {
      const columns = Object.keys(data).join(', ')
      const placeholders = Object.keys(data).map(() => '?').join(', ')
      const sql = `INSERT INTO ${table} (${columns}) VALUES (${placeholders})`
      const values = Object.values(data)
      
      await this.db.prepare(sql).bind(...values).run()
      return data
    } catch (error: any) {
      throw new DatabaseError(`Insert failed: ${error.message}`)
    }
  }

  /**
   * Update record
   */
  async update(table: string, data: Record<string, any>, whereClause: string, params: any[] = []) {
    try {
      const setClause = Object.keys(data).map(key => `${key} = ?`).join(', ')
      const sql = `UPDATE ${table} SET ${setClause} WHERE ${whereClause}`
      const values = [...Object.values(data), ...params]
      
      await this.db.prepare(sql).bind(...values).run()
      return data
    } catch (error: any) {
      throw new DatabaseError(`Update failed: ${error.message}`)
    }
  }

  /**
   * Delete record
   */
  async delete(table: string, whereClause: string, params: any[] = []) {
    try {
      const sql = `DELETE FROM ${table} WHERE ${whereClause}`
      await this.db.prepare(sql).bind(...params).run()
    } catch (error: any) {
      throw new DatabaseError(`Delete failed: ${error.message}`)
    }
  }

  /**
   * Execute raw query
   */
  async query(sql: string, params: any[] = []) {
    try {
      let query = this.db.prepare(sql)
      if (params.length > 0) {
        query = query.bind(...params)
      }
      const result = await query.all()
      return result.results || []
    } catch (error: any) {
      throw new DatabaseError(`Query failed: ${error.message}`)
    }
  }

  /**
   * Execute transaction
   */
  async transaction(callback: () => Promise<void>) {
    try {
      // SQLite transaction support in Cloudflare D1
      await this.db.prepare('BEGIN TRANSACTION').run()
      await callback()
      await this.db.prepare('COMMIT').run()
    } catch (error: any) {
      await this.db.prepare('ROLLBACK').run()
      throw new DatabaseError(`Transaction failed: ${error.message}`)
    }
  }
}
