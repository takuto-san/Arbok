import Database from 'better-sqlite3';
import * as fs from 'fs';
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
  fs.mkdirSync(dbDir, { recursive: true });
  try {
    console.error(`[Arbok DB] Ensured directory exists: ${dbDir} (exists=${fs.existsSync(dbDir)})`);
  } catch (e) {
    console.error(`[Arbok DB] Failed to stat dbDir: ${dbDir} -> ${e}`);
  }

  const targetPath = config.dbPath;
  console.error(`[Arbok DB] Opening database at: ${targetPath}`);

  // Ensure the DB file exists on disk before opening. This prevents some
  // SQLite bindings from opening an in-memory DB when the path is invalid
  // or the parent directory was missing. Create an empty file if absent.
  try {
    if (!fs.existsSync(targetPath)) {
      const fd = fs.openSync(targetPath, 'w');
      fs.closeSync(fd);
      console.error(`[Arbok DB] Created empty DB file at: ${targetPath}`);
    }
  } catch (e) {
    console.error(`[Arbok DB] Failed to ensure DB file exists at: ${targetPath} -> ${e}`);
  }

  // Create database connection
  let newDb: Database.Database;
  try {
    newDb = new Database(targetPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[Arbok DB] Failed to open database file at: ${targetPath} – ${msg}`);
  }

  // Verify the file was actually created on disk
  if (!fs.existsSync(targetPath)) {
    try { newDb.close(); } catch { /* ignore */ }
    console.error(`[Arbok DB] File missing after open: ${targetPath} (dir exists=${fs.existsSync(dbDir)})`);
    throw new Error(
      `[Arbok DB] CRITICAL: better-sqlite3 returned a Database object but the file does not exist at: ${targetPath}. `
      + 'The database may have been opened in-memory. Ensure the path is absolute and the parent directory is writable.'
    );
  } else {
    try {
      const stats = fs.statSync(targetPath);
      console.error(`[Arbok DB] Database file exists: ${targetPath} (size=${stats.size})`);
    } catch (e) {
      console.error(`[Arbok DB] Could not stat DB file: ${targetPath} -> ${e}`);
    }
  }

  // Only commit to module-level state AFTER the file is confirmed on disk
  db = newDb;
  currentDbPath = targetPath;

  try {
    // Enable foreign keys
    db.pragma('foreign_keys = ON');

    // Enable WAL mode for better concurrency
    db.pragma('journal_mode = WAL');

    // Initialize schema
    db.exec(createTablesSQL);
  } catch (err) {
    // Schema init failed – close and reset so the next call retries cleanly
    console.error(`[Arbok DB] Schema initialisation failed, closing connection: ${err}`);
    try { db.close(); } catch { /* ignore */ }
    db = null;
    currentDbPath = null;
    throw err;
  }

  console.error(`[Arbok DB] Database ready at: ${targetPath} (file verified on disk)`);

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
 * Return the absolute path where the currently open DB resides,
 * or null if no connection is open.
 */
export function getOpenDbPath(): string | null {
  return currentDbPath;
}

/**
 * Execute a transaction
 */
export function transaction<T>(fn: (db: Database.Database) => T): T {
  const database = getDatabase();
  const exec = database.transaction(fn);
  return exec(database);
}
