import SqliteDb from 'better-sqlite3'
import {
  Kysely,
  Migrator,
  SqliteDialect,
  Migration,
  MigrationProvider,
} from 'kysely'

// Types

export type DatabaseSchema = {
  app_secrets: AppSecrets
}

export type AppSecrets = {
  key: string
  value: string
}

// Migrations

const migrations: Record<string, Migration> = {}

const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations
  },
}

migrations['002'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('app_secrets')
      .addColumn('key', 'varchar', (col) =>
        col.primaryKey()
      )
      .addColumn('value', 'varchar', (col) =>
        col.notNull()
      )
      .execute()
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('app_secrets').execute()
  },
}

// APIs

export const createDb = (location: string): Database => {
  return new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({
      database: new SqliteDb(location),
    }),
  })
}

export const migrateToLatest = async (db: Database) => {
  const migrator = new Migrator({ db, provider: migrationProvider })
  const { error } = await migrator.migrateToLatest()
  if (error) throw error
}

export type Database = Kysely<DatabaseSchema>
