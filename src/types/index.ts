import type { MongoModels } from '../models/mongo-models'

// ───────────────────────────────────────────────────────────────────
// Common Types & Interfaces
// ───────────────────────────────────────────────────────────────────

// Runtime Bindings
export type Bindings = {
  DB: any
  MODELS?: MongoModels
  JWT_SECRET: string
  PASSWORD_SALT: string
  EMAIL?: {
    send: (message: {
      to: string | string[]
      from: string | { email: string; name?: string }
      subject: string
      html?: string
      text?: string
      cc?: string | string[]
      bcc?: string | string[]
      replyTo?: string | { email: string; name?: string }
    }) => Promise<unknown>
  }
  SENDER_EMAIL?: string
  APP_PASSWORD?: string
  SMTP_HOST?: string
  SMTP_PORT?: string
  SMTP_USER?: string
  SMTP_PASS?: string
  SMTP_FROM?: string
  SMTP_SECURE?: string
}

// User types
export interface User {
  id: string
  email: string
  full_name: string
  role: 'admin' | 'pm' | 'pc' | 'developer' | 'team' | 'client'
  designation?: string
  avatar_color?: string
  is_active?: number
  created_at?: string
}

// Client types
export interface Client {
  id: string
  email: string
  company_name: string
  contact_name: string
  avatar_color?: string
  phone?: string
  website?: string
  industry?: string
}

// Project types
export interface Project {
  id: string
  name: string
  description?: string
  code: string
  status: 'active' | 'archived' | 'on_hold'
  client_id: string
  start_date?: string
  end_date?: string
  budget?: number
  created_by?: string
}

// Task types
export interface Task {
  id: string
  project_id: string
  title: string
  description?: string
  status_key: string
  assigned_to?: string
  created_by: string
  priority?: 'low' | 'medium' | 'high' | 'critical'
  due_date?: string
}

// JWT Payload
export interface JWTPayload {
  sub: string
  email: string
  role: string
  name: string
  company?: string
  exp?: number
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

// Pagination
export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}
