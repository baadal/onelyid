import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { utils } from '@baadal-sdk/dapi'
import { isValidHandle as isValidHandleSyntax } from '@atproto/syntax'
import { getPackageName, getRootPackageName, isLocalHostname } from '@onelyid/common'
import { DEFAULT_DBFILE_DIR, DEFAULT_DBFILE_NAME, INVALID } from '../const'

// NOTE: `publicUrl` remains empty string ('') for localhost/127.0.0.1
export function assertPublicUrl(url?: string) {
  let publicUrl = url ?? '';
  publicUrl = publicUrl.trim();
  if (!publicUrl) return publicUrl;
  
  publicUrl = publicUrl.toLowerCase()
  if (publicUrl.endsWith('/')) {
    publicUrl = publicUrl.substring(0, publicUrl.length-1)
  }
  if (!publicUrl.startsWith('http://') && !publicUrl.startsWith('https://')) {
    return INVALID
  }

  try {
    const urlObj = new URL(publicUrl)
    if (isLocalHostname(urlObj.hostname)) {
      return ''
    } else {
      return publicUrl
    }
  } catch(err) {
    return INVALID
  }
}

export function isValidHandle(handle?: string) {
  if (!handle || typeof handle !== 'string') {
    return false
  }
  return isValidHandleSyntax(handle);
}

export function getAppPackageName() {
  return getPackageName(__dirname)
}

export function getDatabasePath() {
  let dbFile = DEFAULT_DBFILE_NAME;
  // const packageName = getRootPackageName()
  // if (packageName) {
  //   dbFile = `${packageName}-${dbFile}`
  // }
  // dbFile = dbFile.replace(/\s+/g, '-');

  // const baseDir = path.join(os.homedir(), DEFAULT_DBFILE_DIR)
  const baseDir = process.cwd()

  const dir = path.join(baseDir, 'db')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const dbPath = path.join(dir, dbFile)
  return dbPath
}

export function getDatabase2Path(baseUrl: string) {
  const origin = new URL(baseUrl)
  const hostname = origin.hostname
  const hash = utils.sha256Hash(baseUrl)!.substring(0, 8)
  const dbFile = `${hostname}-${hash}-${DEFAULT_DBFILE_NAME}`

  const dir = path.join(process.cwd(), 'db', 'db-auth')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const dbPath = path.join(dir, dbFile)
  return dbPath
}
