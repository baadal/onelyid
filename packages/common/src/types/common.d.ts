export type DomainConfig = {
  baseDomain: string,
  authOrigin: string | null,
  isLocalhost?: boolean,
  isVerified?: boolean,
}

export type BaseDomain = {
  baseDomain: string,
  isLocalhost?: boolean,
  isVerified?: boolean,
}

export type AuthOrigin = {
  authOrigin: string,
  isLocalhost?: boolean,
}
