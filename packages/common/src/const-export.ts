export enum Environment {
  Prod = 'prod',
  Uat = 'uat',
}
export type RequestMode = `${Environment}`

export const TEST_ORIGIN = 'https://example.com'
export const TEST_UID = '019d5913-2b73-70df-bd3f-d2bc79aa1xod'
export const LIVE_UID = '019d5913-2b73-70df-bd3f-d2bc79aa4pod'

export const AUTH_CLIENT_NAME = 'onelyid/client'
export const APP_CLIENT_NAME = 'onelyid/express'

export const COOKIE_NAME_SID = 'atp-sid';  // session cookie (encrypted)
export const COOKIE_NAME_DID = 'atp-did';  // session user did (plain text)
export const COOKIE_NAME_UID = 'atp-uid';  // device/origin id (long-lived)
export const COOKIE_NAME_TID = 'atp-tid';  // trace id (very short-lived)
