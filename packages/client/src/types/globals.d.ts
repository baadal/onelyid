import { Environment } from '@onelyid/common'
import type { RequestContext, UserInfo, LoginPageProps } from './common'

// Express request augmentation
declare global {
  namespace Express {
    interface Request {
      ctx: RequestContext
      auth: UserInfo | null
      authFlow: () => Promise<LoginPageProps | void>
      getAuth: () => Promise<UserInfo | null>
      mode: Environment
    }
    interface Response {
      clearAuth: () => Promise<void>
    }
  }
}

export {}
