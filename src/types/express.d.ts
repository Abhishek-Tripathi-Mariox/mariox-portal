import type { JWTPayload } from 'jose'

declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload & Record<string, any>
    }
  }
}

export {}
