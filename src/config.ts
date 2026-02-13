import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface Config {
  projectPath: string;
  dbPath: string;
  memoryBankPath: string;
  wasmDir: string;
  watchIgnorePatterns: string[];
}

/** Whether a tool call has explicitly set the project path. */
let _projectPathConfigured = false;

function getConfig(): Config {
  // Use PROJECT_PATH env-var if present (e.g. set in .env for local dev).
  // Otherwise leave empty – tools will set it via updateProjectPath().
  const projectPath = process.env.PROJECT_PATH || '';

  return {
    projectPath,
    dbPath: projectPath ? path.join(projectPath, '.arbok', 'index.db') : '',
    memoryBankPath: projectPath ? path.join(projectPath, 'memory-bank') : '',
    wasmDir: path.join(__dirname, '..', 'resources'),
    watchIgnorePatterns: [
      '**/node_modules/**',
      '**/.git/**',
      '**/.arbok/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.nuxt/**',
      '**/coverage/**',
      '**/*.log',
    ],
  };
}

export const config = getConfig();

if (config.projectPath) {
  _projectPathConfigured = true;
}

/**
 * Returns true once updateProjectPath() (or env PROJECT_PATH) has provided
 * a concrete project path.  Database operations MUST NOT run before this.
 */
export function isProjectConfigured(): boolean {
  return _projectPathConfigured;
}

/**
 * Update the project path and all derived paths at runtime.
 * Called by tools that accept a user-provided projectPath to ensure
 * config is always in sync with the actual target project.
 */
export function updateProjectPath(newProjectPath: string): void {
  config.projectPath = newProjectPath;
  config.dbPath = path.join(newProjectPath, '.arbok', 'index.db');
  config.memoryBankPath = path.join(newProjectPath, 'memory-bank');
  _projectPathConfigured = true;
  console.error(`[Arbok Config] projectPath set to: ${newProjectPath}`);
  console.error(`[Arbok Config] dbPath set to: ${config.dbPath}`);
}
