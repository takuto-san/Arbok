import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import path from 'path';
import { config } from '../config.js';
import { createTablesSQL } from './schema.js';

let db: Database.Database | null = null;

/**
 * Get or create the database connection
 */
export function getDatabase(): Database.Database {
  if (db) {
    return db;
  }

  // Ensure .arbok directory exists
  const dbDir = path.dirname(config.dbPath);
  mkdirSync(dbDir, { recursive: true });

  // Create database connection
  db = new Database(config.dbPath, {
    verbose: process.env.DEBUG_SQL ? console.log : undefined,
  });

  // Enable foreign keys
  db.pragma('foreign_keys = ON');
  
  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  // Initialize schema
  db.exec(createTablesSQL);

  return db;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Execute a transaction
 */
export function transaction<T>(fn: (db: Database.Database) => T): T {
  const database = getDatabase();
  const exec = database.transaction(fn);
  return exec(database);
}
