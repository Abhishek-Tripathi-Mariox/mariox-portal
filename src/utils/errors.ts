// ───────────────────────────────────────────────────────────────────
// Custom Error Classes
// ───────────────────────────────────────────────────────────────────

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, message, 'VALIDATION_ERROR')
    this.name = 'ValidationError'
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(401, message, 'AUTHENTICATION_ERROR')
    this.name = 'AuthenticationError'
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(403, message, 'AUTHORIZATION_ERROR')
    this.name = 'AuthorizationError'
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, `${resource} not found`, 'NOT_FOUND')
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, 'CONFLICT')
    this.name = 'ConflictError'
  }
}

export class DatabaseError extends AppError {
  constructor(message: string) {
    super(500, message, 'DATABASE_ERROR')
    this.name = 'DatabaseError'
  }
}

export const handleError = (error: unknown) => {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      message: error.message,
      code: error.code,
    }
  }

  if (error instanceof Error) {
    return {
      statusCode: 500,
      message: error.message,
      code: 'INTERNAL_ERROR',
    }
  }

  return {
    statusCode: 500,
    message: 'An unexpected error occurred',
    code: 'UNKNOWN_ERROR',
  }
}
