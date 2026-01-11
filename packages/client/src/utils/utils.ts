import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { isValidHandle as isValidHandleSyntax } from '@atproto/syntax'
import { isLocalHostname } from '@onelyid/common'
import { Logger } from '../types/common'
import { DEFAULT_DBFILE_DIR, DEFAULT_DBFILE_NAME, INVALID } from '../const'

export function getConsoleLogger(): Logger {
  return {
    info: console.info,
    warn: console.warn,
    error: console.error,
  }
}

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

function getAppPackageName(): string | null {
  let dir = process.cwd()

  while (true) {
    const pkgPath = path.join(dir, 'package.json')
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
        return pkg.name ?? null
      } catch {
        return null
      }
    }

    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  return null
}

export function getDatabasePath() {
  // local db file
  return DEFAULT_DBFILE_NAME

  let dbFile = DEFAULT_DBFILE_NAME;
  const packageName = getAppPackageName()
  if (packageName) {
    dbFile = `${packageName}-${dbFile}`
  }
  dbFile = dbFile.replace(/\s+/g, '-');

  const dir = path.join(os.homedir(), DEFAULT_DBFILE_DIR, 'db')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const file = path.join(dir, dbFile)
  return file
}
