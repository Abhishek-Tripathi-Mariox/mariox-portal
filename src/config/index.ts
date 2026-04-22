// ───────────────────────────────────────────────────────────────────
// Application Configuration
// ───────────────────────────────────────────────────────────────────

export const CONFIG = {
  // JWT Settings
  JWT: {
    ALGORITHM: 'HS256',
    EXPIRY: 60 * 60 * 24, // 24 hours in seconds
    REFRESH_EXPIRY: 60 * 60 * 24 * 7, // 7 days
  },

  // Database
  DB: {
    QUERY_TIMEOUT: 30000, // 30 seconds
    BATCH_SIZE: 100,
  },

  // Security
  SECURITY: {
    MAX_LOGIN_ATTEMPTS: 5,
    LOCKOUT_DURATION: 15 * 60 * 1000, // 15 minutes
    PASSWORD_MIN_LENGTH: 8,
    PASSWORD_REQUIRE_SPECIAL: true,
  },

  // Pagination
  PAGINATION: {
    DEFAULT_LIMIT: 20,
    MAX_LIMIT: 100,
  },

  // File Upload
  UPLOAD: {
    MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
    ALLOWED_TYPES: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'png', 'jpg', 'jpeg'],
  },

  // Notifications
  NOTIFICATIONS: {
    BATCH_DELAY: 5000, // 5 seconds
  },

  // Rate Limiting
  RATE_LIMIT: {
    WINDOW: 15 * 60 * 1000, // 15 minutes
    MAX_REQUESTS: 100,
  },
} as const

export default CONFIG
