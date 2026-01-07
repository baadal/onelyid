import type { RequestContext } from './common'

// Express request augmentation
declare global {
  namespace Express {
    interface Request {
      ctx: RequestContext
    }
  }
}

export {}
