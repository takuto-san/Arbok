import chokidar, { FSWatcher } from 'chokidar';
import path from 'path';
import { readFileSync } from 'fs';
import { config } from '../config.js';
import { parseFile, isSupportedExtension } from '../core/parser.js';
import { extractNodes } from '../core/node-extractor.js';
import { resolveEdges } from '../core/edge-resolver.js';
import { 
  deleteNodesByFile, 
  deleteEdgesByFile, 
  insertNodes, 
  insertEdges 
} from '../database/queries.js';
import { arbokUpdateMemory } from '../mcp/tools.js';

let watcher: FSWatcher | null = null;
let watcherProjectPath: string = config.projectPath;
let pendingChanges = 0;
let memoryBankUpdateTimer: NodeJS.Timeout | null = null;
const MEMORY_BANK_UPDATE_THRESHOLD = 5;
const MEMORY_BANK_UPDATE_DEBOUNCE_MS = 30000; // 30 seconds

/**
 * Start watching the project directory for changes
 */
export function startWatcher(projectPath: string = config.projectPath): void {
  if (watcher) {
    console.error('Watcher already running');
    return;
  }

  watcherProjectPath = projectPath;

  console.error(`Starting file watcher for: ${projectPath}`);

  watcher = chokidar.watch(projectPath, {
    persistent: true,
    ignoreInitial: true,
    ignored: config.watchIgnorePatterns,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
  });

  watcher
    .on('add', (filePath: string) => handleFileChange(filePath, 'added'))
    .on('change', (filePath: string) => handleFileChange(filePath, 'changed'))
    .on('unlink', (filePath: string) => handleFileDelete(filePath))
    .on('error', (error: unknown) => console.error('Watcher error:', error));

  console.error('File watcher started successfully');
}

/**
 * Stop the file watcher
 */
export async function stopWatcher(): Promise<void> {
  if (watcher) {
    await watcher.close();
    watcher = null;
    console.error('File watcher stopped');
  }
  
  // Clear any pending memory bank update timer
  if (memoryBankUpdateTimer) {
    clearTimeout(memoryBankUpdateTimer);
    memoryBankUpdateTimer = null;
  }
}

/**
 * Handle file change (add or modify)
 */
async function handleFileChange(filePath: string, event: 'added' | 'changed'): Promise<void> {
  const ext = path.extname(filePath);
  
  // Only process supported file extensions
  if (!isSupportedExtension(ext)) {
    return;
  }

  console.error(`File ${event}: ${filePath}`);

  try {
    // Read and parse the file
    const content = readFileSync(filePath, 'utf-8');
    const tree = parseFile(content, ext);
    
    if (!tree) {
      console.error(`Failed to parse file: ${filePath}`);
      return;
    }

    // Make the file path relative to project root
    const relativePath = path.relative(config.projectPath, filePath);

    // Delete existing nodes and edges for this file
    deleteEdgesByFile(relativePath);
    deleteNodesByFile(relativePath);

    // Extract new nodes
    const nodes = extractNodes(tree, relativePath, content);
    
    if (nodes.length > 0) {
      insertNodes(nodes);
      
      // Resolve and insert edges
      const edges = resolveEdges(tree, relativePath, content, nodes);
      if (edges.length > 0) {
        insertEdges(edges);
      }
      
      console.error(`Updated ${nodes.length} nodes and ${edges.length} edges for: ${relativePath}`);
    }

    // Track change and schedule memory bank update
    scheduleMemoryBankUpdate();
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
  }
}

/**
 * Handle file deletion
 */
function handleFileDelete(filePath: string): void {
  const ext = path.extname(filePath);
  
  // Only process supported file extensions
  if (!isSupportedExtension(ext)) {
    return;
  }

  console.error(`File deleted: ${filePath}`);

  try {
    // Make the file path relative to project root
    const relativePath = path.relative(config.projectPath, filePath);

    // Delete nodes and edges for this file
    deleteEdgesByFile(relativePath);
    deleteNodesByFile(relativePath);

    console.error(`Removed nodes and edges for: ${relativePath}`);

    // Track change and schedule memory bank update
    scheduleMemoryBankUpdate();
  } catch (error) {
    console.error(`Error deleting file data ${filePath}:`, error);
  }
}

/**
 * Schedule a debounced Memory Bank update
 */
function scheduleMemoryBankUpdate(): void {
  pendingChanges++;

  // Clear existing timer
  if (memoryBankUpdateTimer) {
    clearTimeout(memoryBankUpdateTimer);
  }

  // Check if we've reached the threshold
  if (pendingChanges >= MEMORY_BANK_UPDATE_THRESHOLD) {
    executeMemoryBankUpdate();
  } else {
    // Set a new debounce timer
    memoryBankUpdateTimer = setTimeout(() => {
      if (pendingChanges > 0) {
        executeMemoryBankUpdate();
      }
    }, MEMORY_BANK_UPDATE_DEBOUNCE_MS);
  }
}

/**
 * Execute Memory Bank update and reset counters
 */
async function executeMemoryBankUpdate(): Promise<void> {
  if (pendingChanges === 0) return;

  console.error(`Triggering Memory Bank update (${pendingChanges} changes accumulated)`);
  
  try {
    arbokUpdateMemory({ projectPath: watcherProjectPath, memoryBankPath: config.memoryBankPath, execute: true });
    console.error('Memory Bank updated successfully');
  } catch (error) {
    console.error('Error updating Memory Bank:', error);
  }

  // Reset
  pendingChanges = 0;
  if (memoryBankUpdateTimer) {
    clearTimeout(memoryBankUpdateTimer);
    memoryBankUpdateTimer = null;
  }
}
