import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import path from 'path';
import { config, isProjectConfigured } from '../config.js';
import { createTablesSQL } from './schema.js';

let db: Database.Database | null = null;
/** The absolute path where the current `db` was actually opened. */
let currentDbPath: string | null = null;

/**
 * Get or create the database connection.
 *
 * GUARD: Throws immediately if no project path has been configured yet
 * (via updateProjectPath / syncProjectConfig).  This prevents the DB
 * from being silently created at a wrong or empty path.
 */
export function getDatabase(): Database.Database {
  if (db) {
    return db;
  }

  // --- Safety guard ---
  if (!isProjectConfigured() || !config.dbPath) {
    throw new Error(
      '[Arbok DB] Cannot open database: project path has not been configured yet. '
      + 'Ensure arbok:init or syncProjectConfig() is called before any database operation.'
    );
  }

  // Ensure .arbok directory exists
  const dbDir = path.dirname(config.dbPath);
  mkdirSync(dbDir, { recursive: true });

  console.error(`[Arbok DB] Opening database at: ${config.dbPath}`);

  // Create database connection
  db = new Database(config.dbPath, {
    verbose: process.env.DEBUG_SQL ? console.log : undefined,
  });

  // Remember WHERE we actually opened the connection
  currentDbPath = config.dbPath;

  // Verify the file was actually created
  if (!existsSync(config.dbPath)) {
    throw new Error(`[Arbok DB] CRITICAL: Database file was not created at: ${config.dbPath}`);
  }

  // Enable foreign keys
  db.pragma('foreign_keys = ON');
  
  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  // Initialize schema
  db.exec(createTablesSQL);

  console.error(`[Arbok DB] Database ready at: ${config.dbPath}`);

  return db;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    console.error(`[Arbok DB] Closing database (was at: ${currentDbPath})`);
    db.close();
    db = null;
    currentDbPath = null;
  }
}

/**
 * Ensure the database connection points to `targetDbPath`.
 *
 * Compares against the path where the connection was actually opened
 * (NOT config.dbPath, which may have been updated already).
 * If the connection points elsewhere, it is closed so that the next
 * `getDatabase()` call re-creates it at the current `config.dbPath`.
 */
export function ensureDatabaseAt(targetDbPath: string): void {
  // No connection open – nothing to do; getDatabase() will use config.dbPath
  if (!db) {
    return;
  }

  // Connection already points to the right file
  if (currentDbPath === targetDbPath) {
    return;
  }

  // Stale connection – close it so getDatabase() re-opens at the new path
  console.error(`[Arbok DB] Path mismatch: current=${currentDbPath}, target=${targetDbPath}. Closing stale connection.`);
  closeDatabase();
}

/**
 * Execute a transaction
 */
export function transaction<T>(fn: (db: Database.Database) => T): T {
  const database = getDatabase();
  const exec = database.transaction(fn);
  return exec(database);
}
