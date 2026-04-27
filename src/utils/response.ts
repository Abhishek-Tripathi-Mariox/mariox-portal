// ───────────────────────────────────────────────────────────────────
// Response Formatting Utilities
// ───────────────────────────────────────────────────────────────────

import { Context } from 'hono'
import { HTTP_STATUS } from '../constants'
import type { ApiResponse } from '../types'

export const sendSuccess = (c: Context, data: any, status: number = HTTP_STATUS.OK) => {
  return c.json({
    success: true,
    data,
  } as ApiResponse, status as any)
}

export const sendError = (c: Context, message: string, status: number = HTTP_STATUS.INTERNAL_ERROR) => {
  return c.json({
    success: false,
    error: message,
  } as ApiResponse, status as any)
}

export const sendPaginated = (
  c: Context,
  data: any[],
  total: number,
  page: number = 1,
  limit: number = 20,
  status: number = HTTP_STATUS.OK
) => {
  const hasMore = (page - 1) * limit + data.length < total
  return c.json({
    success: true,
    data: {
      items: data,
      pagination: {
        total,
        page,
        limit,
        hasMore,
        totalPages: Math.ceil(total / limit),
      },
    },
  }, status as any)
}

export const sendCreated = (c: Context, data: any) => {
  return sendSuccess(c, data, HTTP_STATUS.CREATED)
}

export const sendNotFound = (c: Context, resource: string = 'Resource') => {
  return sendError(c, `${resource} not found`, HTTP_STATUS.NOT_FOUND)
}

export const sendUnauthorized = (c: Context) => {
  return sendError(c, 'Unauthorized', HTTP_STATUS.UNAUTHORIZED)
}

export const sendForbidden = (c: Context) => {
  return sendError(c, 'Forbidden: Insufficient permissions', HTTP_STATUS.FORBIDDEN)
}

export const sendBadRequest = (c: Context, message: string = 'Invalid request') => {
  return sendError(c, message, HTTP_STATUS.BAD_REQUEST)
}
