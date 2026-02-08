import 'dotenv/config';
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

function getConfig(): Config {
  const projectPath = process.env.PROJECT_PATH || '/workspace';
  
  return {
    projectPath,
    dbPath: path.join(projectPath, '.arbok', 'index.db'),
    memoryBankPath: path.join(projectPath, 'memory-bank'),
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
