import fs from 'node:fs'
import path from 'node:path'
// import crypto from 'node:crypto'
import { v7 as uuidv7 } from 'uuid'
import { Environment } from './const-export';

export function getUuid() {
  // return crypto.randomUUID()
  return uuidv7()
}

export function assertPath(path?: string) {
  let newPath = path ?? '';
  newPath = newPath.trim();
  if (!newPath) return newPath;

  if (!newPath.startsWith('/')) {
    newPath = `/${newPath}`
  }
  if (newPath.length > 1 && newPath.endsWith('/')) {
    newPath = newPath.substring(0, newPath.length-1)
  }
  return newPath;
}

export function assertOrigin(origin?: string) {
  let newOrigin = origin ?? '';
  newOrigin = newOrigin.trim();
  if (!newOrigin) return newOrigin;

  try {
    const url = new URL(newOrigin)
    const parsedOrigin = `${url.protocol}//${url.host}`
    if (origin === parsedOrigin) {
      return parsedOrigin
    }
  } catch(e) {}

  return '';
}

export function assertRequestMode(mode?: string): Environment | undefined {
  if (mode === Environment.Prod) {
    return Environment.Prod
  } else if (mode === Environment.Uat) {
    return Environment.Uat
  }
}

export function getPackageName(startDir: string): string | null {
  let dir = startDir

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

export function getRootPackageName() {
  return getPackageName(process.cwd())
}
