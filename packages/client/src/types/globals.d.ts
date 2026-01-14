import type { UserInfo } from './common'

// Express request augmentation
declare global {
  namespace Express {
    interface Request {
      auth: UserInfo | null
      authFlow: (handle: string) => Promise<void>
      getAuth: () => Promise<void>
    }
    interface Response {
      clearAuth: () => Promise<void>
    }
  }
}

export {}
