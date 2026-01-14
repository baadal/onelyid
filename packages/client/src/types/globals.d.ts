import type { RequestContext, UserInfo } from './common'

// Express request augmentation
declare global {
  namespace Express {
    interface Request {
      ctx: RequestContext
      auth: UserInfo | null
      authFlow: (handle: string, redirectUrl?: string) => Promise<void>
      getAuth: () => Promise<void>
    }
    interface Response {
      clearAuth: () => Promise<void>
    }
  }
}

export {}
