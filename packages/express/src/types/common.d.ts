export type Logger = {
  info: Function;
  warn: Function;
  error: Function;
}

export type AuthMiddlewareConfig = {
  loginRedirect?: string;
  logger?: Logger;
}

export type UserInfo = {
  did: string;
  handle: string;
  email: string;
  emailTrusted: boolean;
  displayName?: string;
  avatar?: string;
}
