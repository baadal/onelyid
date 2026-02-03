import { createDb, migrateToLatest } from './db'
import { createDb2, migrateToLatest2 } from './db2'

export async function createDbClient(dbPath: string) {
  const db = createDb(dbPath)
  await migrateToLatest(db)
  return db
}

export async function createDb2Client(dbPath: string) {
  const db = createDb2(dbPath)
  await migrateToLatest2(db)
  return db
}
