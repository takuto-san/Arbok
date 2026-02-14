import { z } from 'zod';
import fg from 'fast-glob';
import path from 'path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { config, updateProjectPath } from '../config.js';
import { parseFile, isSupportedExtension } from '../core/parser.js';
import { extractNodes } from '../core/node-extractor.js';
import { resolveEdges } from '../core/edge-resolver.js';
import {
  insertNodes,
  insertEdges,
  getNodesByFile,
  searchNodes,
  getNodeById,
  getEdgesBySource,
  getCounts,
  clearDatabase,
} from '../database/queries.js';
import { ensureDatabaseAt, getOpenDbPath } from '../database/connection.js';
import { startWatcher } from '../watcher/watcher.js';
import type { Node as ArbokNode, NodeKind } from '../types/index.js';

/** Glob patterns for source files to scan recursively. */
const SOURCE_FILE_PATTERNS: string[] = [
  '**/*.ts',
  '**/*.tsx',
  '**/*.js',
  '**/*.jsx',
  '**/*.py',
  '**/*.go',
  '**/*.rs',
];

/** Directories to strictly ignore during file scanning. */
const SCAN_IGNORE_PATTERNS: string[] = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
];

/**
 * Synchronise the global config and database connection with the
 * user-provided project path.  This MUST be called before any
 * database access in tools that accept a `projectPath` argument.
 */
function syncProjectConfig(projectPath: string): void {
  const resolved = path.resolve(projectPath);
  const targetDbPath = path.join(resolved, '.arbok', 'index.db');

  // Close stale DB connection BEFORE updating config paths,
  // so ensureDatabaseAt can compare against the old currentDbPath.
  ensureDatabaseAt(targetDbPath);

  // Now update config paths for subsequent getDatabase() calls
  updateProjectPath(resolved);
}

// Input schemas for MCP tools
export const ArbokInitSchema = z.object({
  projectPath: z.string().min(1, "projectPath must be a non-empty string"),
  execute: z.boolean().optional().describe("Set to true ONLY in Act Mode to perform the actual operation. Defaults to false (Dry Run/Preview)."),
});

export const ArbokGetFileStructureSchema = z.object({
  filePath: z.string(),
});

export const ArbokSearchSymbolSchema = z.object({
  query: z.string(),
  kind: z.enum(['function', 'class', 'variable', 'interface', 'method', 'type_alias', 'enum']).optional(),
});

export const ArbokGetDependenciesSchema = z.object({
  filePath: z.string().optional(),
  symbolName: z.string().optional(),
});

export const ArbokUpdateMemorySchema = z.object({
  projectPath: z.string().min(1, "projectPath must be a non-empty string"),
  memoryBankPath: z.string().optional(),
  execute: z.boolean().optional().describe("Set to true ONLY in Act Mode to perform the actual operation. Defaults to false (Dry Run/Preview)."),
});

export const ArbokSetupRulesSchema = z.object({
  projectPath: z.string().min(1, "projectPath must be a non-empty string"),
  execute: z.boolean().optional().describe("Set to true ONLY in Act Mode to perform the actual operation. Defaults to false (Dry Run/Preview)."),
});

/** Number of files created by arbokSetupRules (.clinerules). */
const CLINERULES_FILE_COUNT = 3;

/**
 * Update .clinerules configuration files.
 * If .clinerules or related config files do not exist, they are generated from scratch (Setup phase).
 * If they already exist, they are updated with necessary changes (Update phase).
 */
export function arbokSetupRules(args: z.infer<typeof ArbokSetupRulesSchema>): string {
  const projectPath = args.projectPath;

  if (!existsSync(projectPath)) {
    return JSON.stringify({
      success: false,
      isError: true,
      message: `The provided projectPath does not exist: '${projectPath}'. Cannot setup rules in a non-existent project.`,
    }, null, 2);
  }
  
  const clineruleDir = path.join(projectPath, '.clinerules');
  const workflowsDir = path.join(clineruleDir, 'workflows');
  const isUpdate = existsSync(clineruleDir);

  // Create .clinerules directory structure if missing
  mkdirSync(clineruleDir, { recursive: true });
  mkdirSync(workflowsDir, { recursive: true });

  // 1. Create base rules file
  const baseRules = `# Arbok Autonomous Rules

## Core Directive
You are an advanced AI agent acting as a Lead Engineer. Your responsibility is twofold: **Quality Coding** and **Perfect Documentation Sync**.
The Arbok MCP is your primary interface for maintaining this synchronization.

## CRITICAL: Definition of Done
A task is **NOT COMPLETE** until:
1. The code changes are implemented and verified.
2. **You have executed \`arbok:update_memory_bank\` to sync the documentation.**
3. You have confirmed the update was successful.

**Do NOT report "Task Completed" without performing Step 2.**

## Mandatory Workflows

### 1. Pre-Task Analysis
- **Constraint:** Do NOT blindly read files using \`read_file\`.
- **Action:** ALWAYS use \`arbok:get_file_structure\` and \`arbok:get_symbols\` first to build a mental map.
- **Context:** Check \`memory-bank/activeContext.md\` BEFORE starting any implementation.

### 2. Post-Coding Sync (The "Arbok Loop")
- **Trigger:** Immediately after you finish writing or modifying code.
- **Action:** Run the \`arbok:update_memory_bank\` tool.
- **Reasoning:** The Memory Bank is the source of truth. Code without updated documentation is technical debt.

## Tool Usage Constraints
- **File Access:** Only read the full content of a file if you intend to edit it or need deep logic verification. Use the index for everything else.
- **Symbol Search:** Use \`arbok:get_symbols\` instead of \`grep\` or searching strings.
`;
  writeFileSync(path.join(clineruleDir, 'rules.md'), baseRules);

  // 2. Create Memory Bank update workflow
  const updateMemoryWorkflow = `# Update Memory Bank Workflow

## Trigger
Run this workflow after completing any task that modifies the codebase.

## Steps
1. Call \`arbok:update_memory_bank\` tool to regenerate Memory Bank files
2. Review the generated files in \`memory-bank/\` directory
3. The following files will be updated:
   - \`memory-bank/productContext.md\` — Project purpose and user experience goals
   - \`memory-bank/activeContext.md\` — Current work focus and recent changes
   - \`memory-bank/progress.md\` — What works, what's left, known issues
   - \`memory-bank/systemPatterns.md\` — Architecture and design patterns
   - \`memory-bank/techContext.md\` — Technologies, dependencies, and setup
   - \`memory-bank/project-structure.md\` — File tree and symbol index
`;
  writeFileSync(path.join(workflowsDir, 'update_memory.md'), updateMemoryWorkflow);

  return JSON.stringify({
    success: true,
    message: isUpdate
      ? '.clinerules files updated successfully'
      : '.clinerules files created successfully',
    files_created: [
      path.join(clineruleDir, 'rules.md'),
      path.join(workflowsDir, 'update_memory.md'),
    ],
  }, null, 2);
}

/**
 * Unified initialization: consolidates index, memory bank, and rules setup.
 *
 * Idempotent – only creates what is missing and skips what already exists.
 *
 * - Plan Mode (`execute` falsy): performs a discovery scan and reports what
 *   IS found and what WILL be created.
 * - Act Mode (`execute: true`): creates missing resources.
 */
export async function arbokInit(args: z.infer<typeof ArbokInitSchema>): Promise<string> {
  const projectPath = args.projectPath;

  if (!existsSync(projectPath)) {
    return JSON.stringify({
      success: false,
      isError: true,
      message: `The provided projectPath does not exist: '${projectPath}'. Cannot initialize project in a non-existent directory.`,
    }, null, 2);
  }

  const absoluteProjectPath = path.resolve(projectPath);

  // Sync config & DB connection with the provided project path
  syncProjectConfig(absoluteProjectPath);

  // --- Step 1: Memory Bank (memory-bank/) ---
  const memoryBankDir = path.resolve(absoluteProjectPath, 'memory-bank');
  const mbState = detectMemoryBankState(memoryBankDir);
  const mbMissingFiles = mbState.missingFiles;
  const mbNeeded = mbMissingFiles.length > 0;

  // --- Step 2: Cline Rules (.clinerules/) ---
  // Always overwrite rules.md to enforce the latest strict compliance content.
  const clineruleDir = path.resolve(absoluteProjectPath, '.clinerules');
  const rulesNeeded = true;

  // AGENTS.md at project root: contains custom agent instructions
  const agentsPath = path.join(absoluteProjectPath, 'AGENTS.md');
  const agentsExists = existsSync(agentsPath);
  const agentsNeeded = !agentsExists;

  // --- Step 3: Project Index (.arbok/) ---
  const arbokDir = path.resolve(absoluteProjectPath, '.arbok');
  const dbPath = path.join(arbokDir, 'index.db');
  // Discovery: does .arbok exist? (used in Plan Mode reporting)
  const arbokDirExists = existsSync(arbokDir);

  const indexDbExists = existsSync(dbPath);
  let indexHasNodes = false;
  if (indexDbExists) {
    const stats = getCounts();
    indexHasNodes = stats.nodes > 0;
  }
  const indexNeeded = !indexDbExists || !indexHasNodes;

  // ---- Plan Mode ----
  if (!args.execute) {
    return JSON.stringify({
      success: true,
      mode: 'plan',
      message: 'Discovery scan complete. Switch to Act Mode and run with execute: true to proceed.',
      discovery: {
        arbok_dir: arbokDirExists ? 'present' : 'missing',
        index_db: indexDbExists ? 'present' : 'missing',
        index_has_nodes: indexDbExists ? (indexHasNodes ? 'yes' : 'no') : 'n/a',
        index: indexNeeded ? 'Will be created' : 'Already exists – will be skipped',
        memoryBank: mbNeeded
          ? `Will create ${mbMissingFiles.length} missing file(s): ${mbMissingFiles.join(', ')}`
          : 'Complete – will be skipped',
        clinerules: rulesNeeded ? 'Will be created / overwritten' : 'Already exists – will be skipped',
        agents_md: agentsNeeded ? 'Will be created' : 'Already exists – will be skipped',
      },
      path: absoluteProjectPath,
    }, null, 2);
  }

  // ---- Act Mode ----
  console.error(`[Arbok] arbokInit Act Mode for: ${absoluteProjectPath}`);

  // Memory Bank: create or update documentation first
  let mbCreatedCount = 0;
  let mbSkippedCount = 0;
  if (mbNeeded) {
    console.error(`[Arbok] Initialising Memory Bank (${mbMissingFiles.length} files)...`);
    try {
      const mbStr = arbokUpdateMemory({ projectPath: absoluteProjectPath, execute: true });
      try {
        const mbParsed = JSON.parse(mbStr);
        if (mbParsed && Array.isArray(mbParsed.files)) {
          mbCreatedCount = mbParsed.files.length;
        }
      } catch {
        console.error('[Arbok] Warning: arbokUpdateMemory returned unparseable JSON');
      }
    } catch (e) {
      console.error(`[Arbok] arbokUpdateMemory threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    mbSkippedCount = MEMORY_BANK_REQUIRED_FILES.length;
  }

  // Cline Rules: update/create .clinerules next
  let clinerulesStatus = 'Skipped (Already exists)';
  if (rulesNeeded) {
    console.error(`[Arbok] Creating .clinerules...`);
    try {
      arbokSetupRules({ projectPath: absoluteProjectPath, execute: true });
      clinerulesStatus = 'Created';
    } catch (e) {
      console.error(`[Arbok] arbokSetupRules threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // AGENTS.md: create project-root AGENTS.md containing custom instructions
  let agentsStatus = 'Skipped (Already exists)';
  let agentsCreatedCount = 0;
  if (agentsNeeded) {
    console.error(`[Arbok] Creating AGENTS.md at: ${agentsPath}`);
    try {
      const agentsContent = `# AGENTS

    ## Custom Instructions

    タスクを開始する前に必ず以下を行ってください。

    - \`.clinerules/rules.md\` を参照すること（必須）。
    - 作業開始前に \`arbok:get_file_structure\` と \`arbok:get_symbols\` を使って対象を把握すること。
    - 変更後は \`arbok:update_memory_bank\` を実行してドキュメントを同期すること。

    *Generated by Arbok*\n`;
      writeFileSync(agentsPath, agentsContent);
      agentsStatus = 'Created';
      agentsCreatedCount = 1;
    } catch (e) {
      console.error(`[Arbok] Failed to create AGENTS.md: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Index: perform reindex last so docs are present even if DB fails
  let indexStatus = 'Skipped (Already exists)';
  let indexNodes = 0;
  let indexFiles = 0;

  if (indexNeeded) {
    console.error(`[Arbok] Creating project index...`);
    try {
      const reindexResultStr = await arbokReindex({ projectPath: absoluteProjectPath, execute: true });
      let parsedReindex: any;
      try {
        parsedReindex = JSON.parse(reindexResultStr);
      } catch {
        return JSON.stringify({
          success: false,
          isError: true,
          message: `[Arbok] arbokReindex returned unparseable result: ${reindexResultStr.substring(0, 300)}`,
        }, null, 2);
      }

      if (!parsedReindex.success) {
        return JSON.stringify(parsedReindex, null, 2);
      }

      // POST-WRITE CHECK: Verify .arbok directory AND index.db exist on disk
      if (!existsSync(arbokDir)) {
        return JSON.stringify({
          success: false,
          isError: true,
          message: `[CRITICAL FAILURE] Index reported success but .arbok directory does not exist at: ${arbokDir}`,
        }, null, 2);
      }

      if (!existsSync(dbPath)) {
        let foundFiles: string[] = [];
        try { foundFiles = readdirSync(arbokDir); } catch {}

        return JSON.stringify({
          success: false,
          isError: true,
          message: `[CRITICAL FAILURE] Index reported success but index.db does not exist at: ${dbPath}. `
            + `config.dbPath=${config.dbPath}, openDbPath=${getOpenDbPath()}, `
            + `Files found in .arbok: [${foundFiles.join(', ')}]`,
        }, null, 2);
      }

      const counts = getCounts();
      indexNodes = counts.nodes;
      indexFiles = counts.files;
      indexStatus = 'Created';
    } catch (e) {
      return JSON.stringify({
        success: false,
        isError: true,
        message: `[Arbok] Reindexing process threw: ${e instanceof Error ? e.message : String(e)}`,
      }, null, 2);
    }
  } else {
    const counts = getCounts();
    indexNodes = counts.nodes;
    indexFiles = counts.files;
  }

  const totalFilesWritten = mbCreatedCount + (clinerulesStatus === 'Created' ? CLINERULES_FILE_COUNT : 0) + agentsCreatedCount;

  return JSON.stringify({
    success: true,
    summary: {
      index: indexStatus,
      memoryBank: `Created ${mbCreatedCount} file(s) / Skipped ${mbSkippedCount} file(s)`,
      clinerules: clinerulesStatus,
      agents: agentsStatus,
    },
    stats: {
      files_indexed: indexFiles,
      nodes_created: indexNodes,
      files_created: totalFilesWritten,
    },
    path: absoluteProjectPath,
  }, null, 2);
}

/**
 * Recursively scan a project directory for source files using fast-glob.
 *
 * Finds all files ending in .py, .ts, .js, .go, and .rs while strictly
 * ignoring node_modules, .git, and dist directories.
 *
 * @param projectPath - The root directory to scan.
 * @returns An array of absolute file paths.
 */
export async function scanSourceFiles(projectPath: string): Promise<string[]> {
  const ignorePatterns: string[] = [
    ...SCAN_IGNORE_PATTERNS,
    ...config.watchIgnorePatterns,
  ];

  // Deduplicate ignore patterns
  const uniqueIgnore: string[] = [...new Set(ignorePatterns)];

  try {
    const files: string[] = await fg(SOURCE_FILE_PATTERNS, {
      cwd: projectPath,
      ignore: uniqueIgnore,
      absolute: true,
      followSymbolicLinks: false,
    });

    return files;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error scanning source files in ${projectPath}: ${message}`);
    return [];
  }
}

/**
 * Re-index the project (scan, parse, extract nodes and edges).
 * Used internally by arbokInit and by arbok:update_index.
 */
export async function arbokReindex(args: z.infer<typeof ArbokInitSchema>): Promise<string> {
  const projectPath = args.projectPath;

  if (!existsSync(projectPath)) {
    return JSON.stringify({
      success: false,
      isError: true,
      message: `The provided projectPath does not exist: '${projectPath}'. Cannot initialize project in a non-existent directory.`,
    }, null, 2);
  }
  
  console.error(`Initializing Arbok for project: ${projectPath}`);

  // Ensure .arbok directory exists and the DB file is present before configuring DB
  const arbokDir = path.resolve(projectPath, '.arbok');
  mkdirSync(arbokDir, { recursive: true });

  const expectedDbPath = path.join(arbokDir, 'index.db');
  console.error(`[Arbok Reindex] arbokDir        = ${arbokDir}`);
  console.error(`[Arbok Reindex] expectedDbPath   = ${expectedDbPath}`);

  // If the DB file is missing or zero-length, create an empty file immediately
  try {
    if (!existsSync(expectedDbPath)) {
      writeFileSync(expectedDbPath, '');
      console.error(`[Arbok Reindex] Created empty DB file at: ${expectedDbPath}`);
    } else {
      try {
        const st = statSync(expectedDbPath);
        if (st.size === 0) {
          // rewrite to ensure a real file exists on disk (some filesystems treat size=0 specially)
          writeFileSync(expectedDbPath, '');
          console.error(`[Arbok Reindex] Re-created zero-length DB file at: ${expectedDbPath}`);
        }
      } catch (e) {
        console.error(`[Arbok Reindex] Could not stat expectedDbPath: ${e}`);
      }
    }
  } catch (e) {
    console.error(`[Arbok Reindex] Failed to ensure DB file exists at ${expectedDbPath}: ${e}`);
  }

  // Sync config & DB connection with the provided project path (will honour existing file)
  syncProjectConfig(projectPath);

  console.error(`[Arbok Reindex] config.dbPath    = ${config.dbPath}`);

  // Sanity-check: config.dbPath must match the expected location
  if (path.resolve(config.dbPath) !== path.resolve(expectedDbPath)) {
    return JSON.stringify({
      success: false,
      isError: true,
      message: `[Arbok Reindex] PATH MISMATCH: config.dbPath (${config.dbPath}) does not match expected (${expectedDbPath}). Aborting to prevent data loss.`,
    }, null, 2);
  }

  // Ensure parsers are initialized
  const { initParsers } = await import('../core/parser.js');
  await initParsers();

  // Ensure DB file is created before clearing (fix for missing DB file)
  clearDatabase();

  // Verify DB file was actually created on disk
  const openPath = getOpenDbPath();
  console.error(`[Arbok Reindex] DB opened at     = ${openPath}`);
  if (!existsSync(expectedDbPath)) {
    let dirContents: string[] = [];
    try { dirContents = readdirSync(arbokDir); } catch { /* ignore */ }
    return JSON.stringify({
      success: false,
      isError: true,
      message: `[Arbok Reindex] Database file was NOT created at ${expectedDbPath} after clearDatabase(). `
        + `config.dbPath=${config.dbPath}, openDbPath=${openPath}, `
        + `.arbok contents=[${dirContents.join(', ')}]`,
    }, null, 2);
  }

  // Find all source files
  const files = await scanSourceFiles(projectPath);

  console.error(`Found ${files.length} files to index`);

  let totalNodes = 0;
  let totalEdges = 0;
  const allFileNodes: { filePath: string; nodes: Omit<ArbokNode, 'updated_at'>[] }[] = [];

  // First pass: extract all nodes
  for (const filePath of files) {
    try {
      const ext = path.extname(filePath);
      if (!isSupportedExtension(ext)) continue;

      const content = readFileSync(filePath, 'utf-8');
      const tree = parseFile(content, ext);

      if (!tree) {
        console.error(`Failed to parse: ${filePath}`);
        continue;
      }

      const relativePath = path.relative(projectPath, filePath);
      const nodes = extractNodes(tree, relativePath, content);

      if (nodes.length > 0) {
        insertNodes(nodes);
        allFileNodes.push({ filePath: relativePath, nodes });
        totalNodes += nodes.length;
      }
    } catch (error) {
      console.error(`Error processing ${filePath}:`, error);
    }
  }

  // Second pass: resolve edges (after all nodes are in the database)
  for (const fileData of allFileNodes) {
    try {
      const fullPath = path.join(projectPath, fileData.filePath);
      const content = readFileSync(fullPath, 'utf-8');
      const ext = path.extname(fullPath);
      const tree = parseFile(content, ext);

      if (tree) {
        const edges = resolveEdges(tree, fileData.filePath, content, fileData.nodes);
        if (edges.length > 0) {
          insertEdges(edges);
          totalEdges += edges.length;
        }
      }
    } catch (error) {
      console.error(`Error resolving edges for ${fileData.filePath}:`, error);
    }
  }

  // Start the file watcher
  startWatcher(projectPath);

  const stats = getCounts();

  return JSON.stringify({
    success: true,
    message: `Project indexed successfully at ${arbokDir}`,
    stats: {
      files_indexed: stats.files,
      nodes_created: stats.nodes,
      edges_created: stats.edges,
    },
  }, null, 2);
}

/**
 * Get file structure (symbols in a file)
 */
export function arbokGetFileStructure(args: z.infer<typeof ArbokGetFileStructureSchema>): string {
  const { filePath } = args;
  
  const nodes = getNodesByFile(filePath);

  const symbols = nodes.map(node => ({
    kind: node.kind,
    name: node.name,
    signature: node.signature,
    start_line: node.start_line,
    end_line: node.end_line,
    exported: node.exported,
  }));

  return JSON.stringify({
    file_path: filePath,
    symbols,
  }, null, 2);
}

/**
 * Search for symbols
 */
export function arbokSearchSymbol(args: z.infer<typeof ArbokSearchSymbolSchema>): string {
  const { query, kind } = args;
  
  const nodes = searchNodes(query, kind as NodeKind | undefined);

  const results = nodes.map(node => ({
    file_path: node.file_path,
    kind: node.kind,
    name: node.name,
    signature: node.signature,
    start_line: node.start_line,
    end_line: node.end_line,
  }));

  return JSON.stringify({
    query,
    kind: kind || 'all',
    results,
  }, null, 2);
}

/**
 * Get dependencies for a file or symbol
 */
export function arbokGetDependencies(args: z.infer<typeof ArbokGetDependenciesSchema>): string {
  const { filePath, symbolName } = args;

  if (!filePath && !symbolName) {
    return JSON.stringify({
      error: 'Either filePath or symbolName must be provided',
    }, null, 2);
  }

  let sourceNodes: ArbokNode[] = [];

  if (symbolName) {
    // Find nodes by name
    const nodes = searchNodes(symbolName);
    sourceNodes = nodes.filter(n => n.name === symbolName);
  } else if (filePath) {
    // Get all nodes in the file
    sourceNodes = getNodesByFile(filePath);
  }

  interface DependencyEntry {
    source: {
      file_path: string;
      name: string;
      kind: NodeKind;
    };
    relation: string;
    target: {
      file_path: string;
      name: string;
      kind: NodeKind;
    };
  }
  
  const dependencies: DependencyEntry[] = [];

  for (const sourceNode of sourceNodes) {
    const edges = getEdgesBySource(sourceNode.id);
    
    for (const edge of edges) {
      const targetNode = getNodeById(edge.target_node_id);
      
      if (targetNode) {
        dependencies.push({
          source: {
            file_path: sourceNode.file_path,
            name: sourceNode.name,
            kind: sourceNode.kind,
          },
          relation: edge.relation,
          target: {
            file_path: targetNode.file_path,
            name: targetNode.name,
            kind: targetNode.kind,
          },
        });
      }
    }
  }

  return JSON.stringify({
    file_path: filePath,
    symbol_name: symbolName,
    dependencies,
  }, null, 2);
}

/** Required files for a complete Memory Bank. */
const MEMORY_BANK_REQUIRED_FILES: string[] = [
  'productContext.md',
  'activeContext.md',
  'progress.md',
  'systemPatterns.md',
  'techContext.md',
  'project-structure.md',
];

/**
 * Detect the current state of the Memory Bank directory.
 * Returns 'missing' | 'partial' | 'complete'.
 */
function detectMemoryBankState(memoryBankPath: string): { state: 'missing' | 'partial' | 'complete'; missingFiles: string[] } {
  if (!existsSync(memoryBankPath)) {
    return { state: 'missing', missingFiles: [...MEMORY_BANK_REQUIRED_FILES] };
  }

  const missingFiles = MEMORY_BANK_REQUIRED_FILES.filter(
    (file) => !existsSync(path.join(memoryBankPath, file))
  );

  if (missingFiles.length > 0) {
    return { state: 'partial', missingFiles };
  }

  return { state: 'complete', missingFiles: [] };
}

/**
 * Resolve the memory bank path to an absolute path.
 * Requires `projectPath` to be provided.
 */
function resolveMemoryBankPath(memoryBankPath: string | undefined, projectPath: string): string {
  if (memoryBankPath && path.isAbsolute(memoryBankPath)) {
    return memoryBankPath;
  }
  const targetPath = memoryBankPath || 'memory-bank';
  return path.resolve(projectPath, targetPath);
}

/**
 * Update Memory Bank files.
 * If the memory-bank directory and basic files do not exist, they are created and initialized (Setup phase).
 * If they already exist, they are updated with the current project state (Update phase).
 */
export function arbokUpdateMemory(args: z.infer<typeof ArbokUpdateMemorySchema>): string {
  if (!existsSync(args.projectPath)) {
    return JSON.stringify({
      success: false,
      isError: true,
      message: `The provided projectPath does not exist: '${args.projectPath}'. Cannot update memory bank in a non-existent project.`,
    }, null, 2);
  }

  const memoryBankPath = resolveMemoryBankPath(args.memoryBankPath, args.projectPath);
  const isUpdate = existsSync(memoryBankPath);
  
  console.error(`[Arbok] arbokUpdateMemory called with execute=${args.execute}`);
  console.error(`[Arbok] Target Absolute Path: ${memoryBankPath}`);

  if (!args.execute) {
    console.error(`[Arbok] Dry run mode – skipping file writes`);
    return JSON.stringify({
      success: true,
      message: `Dry run: would ${isUpdate ? 'update' : 'initialize'} Memory Bank at ${memoryBankPath}. Set execute=true to proceed.`,
      memoryBankPath,
    }, null, 2);
  }

  // Ensure memory bank directory exists
  console.error(`[Arbok] Creating directory at: ${memoryBankPath}`);
  mkdirSync(memoryBankPath, { recursive: true });

  if (!existsSync(memoryBankPath)) {
    throw new Error(`[CRITICAL FAILURE] Failed to create directory at: ${memoryBankPath}`);
  }
  console.error(`[Arbok] Directory verified at: ${memoryBankPath}`);

  // Memory Bank is a lightweight documentation tool and must NOT query the
  // index database.  Symbol scanning / indexing is the responsibility of
  // arbok:init and arbok:update_index only.
  const projectPath = args.projectPath;

  const filesCreated: string[] = [];

  // Helper: write a file and immediately verify it exists
  const writeAndVerify = (absoluteFilePath: string, content: string): void => {
    console.error(`[Arbok] Writing file: ${absoluteFilePath}`);
    writeFileSync(absoluteFilePath, content);

    // IMMEDIATE VERIFICATION
    if (!existsSync(absoluteFilePath)) {
      throw new Error(`[CRITICAL FAILURE] File system reported success, but file does not exist at: ${absoluteFilePath}`);
    }
    console.error(`[Arbok] Verified file exists: ${absoluteFilePath}`);
    filesCreated.push(absoluteFilePath);
  };

  // 1. Generate productContext.md
  const productContext = generateProductContext([], projectPath);
  const productContextPath = path.join(memoryBankPath, 'productContext.md');
  writeAndVerify(productContextPath, productContext);

  // 2. Generate activeContext.md
  const activeContext = generateActiveContext([]);
  const activeContextPath = path.join(memoryBankPath, 'activeContext.md');
  writeAndVerify(activeContextPath, activeContext);

  // 3. Generate progress.md
  const progress = generateProgress([], { files: 0, nodes: 0, edges: 0 });
  const progressPath = path.join(memoryBankPath, 'progress.md');
  writeAndVerify(progressPath, progress);

  // 4. Generate systemPatterns.md
  const systemPatterns = generateSystemPatterns([]);
  const systemPatternsPath = path.join(memoryBankPath, 'systemPatterns.md');
  writeAndVerify(systemPatternsPath, systemPatterns);

  // 5. Generate techContext.md
  const techContext = generateTechContext(projectPath, []);
  const techContextPath = path.join(memoryBankPath, 'techContext.md');
  writeAndVerify(techContextPath, techContext);

  // 6. Generate project-structure.md (uses basic file tree scan, not symbol indexing)
  const projectStructure = generateProjectStructureFromFileTree(projectPath);
  const projectStructurePath = path.join(memoryBankPath, 'project-structure.md');
  writeAndVerify(projectStructurePath, projectStructure);

  console.error(`[Arbok] All ${filesCreated.length} files written and verified successfully`);

  return JSON.stringify({
    success: true,
    message: isUpdate
      ? `Memory Bank updated successfully at ${memoryBankPath}`
      : `Memory Bank initialized successfully at ${memoryBankPath}`,
    memoryBankPath,
    files: filesCreated,
    verified: true,
    stats: {
      files: filesCreated.length,
      nodes: 0,
      edges: 0,
    },
  }, null, 2);
}

/**
 * Generate productContext.md - Why this project exists
 */
function generateProductContext(nodes: ArbokNode[], projectPath: string): string {
  let md = '# Product Context\n\n';
  
  // Try to read README if exists
  const readmePath = path.join(projectPath, 'README.md');
  let projectDescription = 'No README.md found.';
  if (existsSync(readmePath)) {
    try {
      const readmeContent = readFileSync(readmePath, 'utf-8');
      // Extract first few paragraphs (up to 500 chars)
      const lines = readmeContent.split('\n').filter(line => line.trim() && !line.startsWith('#'));
      projectDescription = lines.slice(0, 10).join('\n').substring(0, 500);
    } catch (e) {
      // Ignore read errors
    }
  }

  md += '## Project Purpose\n\n';
  md += projectDescription + '\n\n';

  md += '## Key Exports\n\n';
  const exportedSymbols = nodes.filter(n => n.exported).slice(0, 30);
  const symbolsByKind = new Map<NodeKind, ArbokNode[]>();
  
  for (const node of exportedSymbols) {
    if (!symbolsByKind.has(node.kind)) {
      symbolsByKind.set(node.kind, []);
    }
    symbolsByKind.get(node.kind)!.push(node);
  }

  for (const [kind, symbols] of symbolsByKind.entries()) {
    md += `### ${kind}s\n`;
    for (const symbol of symbols.slice(0, 15)) {
      md += `- \`${symbol.name}\` in ${symbol.file_path}\n`;
    }
    md += '\n';
  }

  md += `\n---\n*Generated by Arbok at ${new Date().toISOString()}*\n`;
  
  // Ensure ≤250 lines
  return truncateToLines(md, 250);
}

/**
 * Generate activeContext.md - Current work focus
 */
function generateActiveContext(nodes: ArbokNode[]): string {
  let md = '# Active Context\n\n';

  md += '## Recently Modified Files\n\n';
  
  // Sort by updated_at timestamp (most recent first)
  const sortedNodes = [...nodes].sort((a, b) => {
    const dateA = new Date(a.updated_at || 0).getTime();
    const dateB = new Date(b.updated_at || 0).getTime();
    return dateB - dateA;
  });

  const recentFiles = new Map<string, { timestamp: string; symbols: string[] }>();
  
  for (const node of sortedNodes.slice(0, 50)) {
    if (!recentFiles.has(node.file_path)) {
      recentFiles.set(node.file_path, {
        timestamp: node.updated_at || 'unknown',
        symbols: [],
      });
    }
    recentFiles.get(node.file_path)!.symbols.push(`${node.kind}: ${node.name}`);
  }

  let count = 0;
  for (const [filePath, data] of recentFiles.entries()) {
    if (count++ >= 20) break;
    md += `### ${filePath}\n`;
    md += `Updated: ${data.timestamp}\n`;
    md += `Symbols: ${data.symbols.slice(0, 5).join(', ')}\n\n`;
  }

  md += '## Active Patterns\n\n';
  md += 'Review the systemPatterns.md for architecture decisions and design patterns in use.\n\n';

  md += `\n---\n*Generated by Arbok at ${new Date().toISOString()}*\n`;
  
  return truncateToLines(md, 250);
}

/**
 * Generate progress.md - What's working, what's not
 */
function generateProgress(nodes: ArbokNode[], stats: { files: number; nodes: number; edges: number }): string {
  let md = '# Progress\n\n';

  md += '## Project Statistics\n\n';
  md += `- **Files indexed**: ${stats.files}\n`;
  md += `- **Total symbols**: ${stats.nodes}\n`;
  md += `- **Relationships**: ${stats.edges}\n\n`;

  md += '## What\'s Working\n\n';
  
  const functionCount = nodes.filter(n => n.kind === 'function').length;
  const classCount = nodes.filter(n => n.kind === 'class').length;
  const interfaceCount = nodes.filter(n => n.kind === 'interface').length;
  
  md += `- ${functionCount} functions defined\n`;
  md += `- ${classCount} classes defined\n`;
  md += `- ${interfaceCount} interfaces defined\n\n`;

  // Detect test files
  const testFiles = nodes.filter(n => 
    n.file_path.includes('.test.') || 
    n.file_path.includes('.spec.') ||
    n.file_path.includes('__tests__')
  );
  
  if (testFiles.length > 0) {
    const testFileCount = new Set(testFiles.map(n => n.file_path)).size;
    md += `- ${testFileCount} test files detected\n\n`;
  }

  md += '## Known Issues\n\n';
  md += 'No automated issue detection implemented yet. Check TODO/FIXME comments in source files.\n\n';

  md += '## What\'s Left\n\n';
  md += 'Review project documentation and issue tracker for remaining work.\n\n';

  md += `\n---\n*Generated by Arbok at ${new Date().toISOString()}*\n`;
  
  return truncateToLines(md, 250);
}

/**
 * Generate systemPatterns.md - Architecture decisions
 */
function generateSystemPatterns(nodes: ArbokNode[]): string {
  let md = '# System Patterns\n\n';

  md += '## Architecture Overview\n\n';
  
  // Group by directory to understand module structure
  const dirMap = new Map<string, ArbokNode[]>();
  for (const node of nodes) {
    const dir = path.dirname(node.file_path);
    if (!dirMap.has(dir)) {
      dirMap.set(dir, []);
    }
    dirMap.get(dir)!.push(node);
  }

  md += '### Module Structure\n\n';
  const sortedDirs = Array.from(dirMap.keys()).sort();
  for (const dir of sortedDirs.slice(0, 30)) {
    const dirNodes = dirMap.get(dir)!;
    const exportedCount = dirNodes.filter(n => n.exported).length;
    md += `- **${dir}**: ${dirNodes.length} symbols (${exportedCount} exported)\n`;
  }
  md += '\n';

  md += '## Class Hierarchy\n\n';
  const classes = nodes.filter(n => n.kind === 'class').slice(0, 30);
  if (classes.length > 0) {
    for (const cls of classes) {
      md += `### ${cls.name}\n`;
      md += `- File: ${cls.file_path}\n`;
      md += `- Lines: ${cls.start_line}-${cls.end_line}\n`;
      
      // Try to find extends/implements relationships
      const edges = getEdgesBySource(cls.id);
      const extendsEdges = edges.filter(e => e.relation === 'extends');
      const implementsEdges = edges.filter(e => e.relation === 'implements');
      
      if (extendsEdges.length > 0 || implementsEdges.length > 0) {
        md += '- Relationships: ';
        const rels = [];
        if (extendsEdges.length > 0) {
          rels.push(`extends ${extendsEdges.length} class(es)`);
        }
        if (implementsEdges.length > 0) {
          rels.push(`implements ${implementsEdges.length} interface(s)`);
        }
        md += rels.join(', ') + '\n';
      }
      md += '\n';
    }
  } else {
    md += 'No classes found in the project.\n\n';
  }

  md += '## Design Patterns\n\n';
  md += 'Analyze the class hierarchy and module structure above to identify design patterns in use.\n\n';

  md += `\n---\n*Generated by Arbok at ${new Date().toISOString()}*\n`;
  
  return truncateToLines(md, 250);
}

/**
 * Generate techContext.md - Technologies used
 */
function generateTechContext(projectPath: string, nodes: ArbokNode[]): string {
  let md = '# Technical Context\n\n';

  md += '## Technologies & Dependencies\n\n';
  
  // Try to read package.json if exists
  const packageJsonPath = path.join(projectPath, 'package.json');
  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      
      md += `### Project: ${packageJson.name || 'Unknown'}\n`;
      md += `Version: ${packageJson.version || 'Unknown'}\n\n`;
      
      if (packageJson.dependencies) {
        md += '### Dependencies\n';
        const deps = Object.entries(packageJson.dependencies).slice(0, 30);
        for (const [name, version] of deps) {
          md += `- ${name}: ${version}\n`;
        }
        md += '\n';
      }
      
      if (packageJson.devDependencies) {
        md += '### Dev Dependencies\n';
        const devDeps = Object.entries(packageJson.devDependencies).slice(0, 20);
        for (const [name, version] of devDeps) {
          md += `- ${name}: ${version}\n`;
        }
        md += '\n';
      }
      
      if (packageJson.scripts) {
        md += '### Scripts\n';
        for (const [name, script] of Object.entries(packageJson.scripts)) {
          md += `- **${name}**: \`${script}\`\n`;
        }
        md += '\n';
      }
    } catch (e) {
      md += 'package.json found but could not be parsed.\n\n';
    }
  }

  md += '## Languages & File Distribution\n\n';
  
  const extMap = new Map<string, number>();
  for (const node of nodes) {
    const ext = path.extname(node.file_path);
    extMap.set(ext, (extMap.get(ext) || 0) + 1);
  }
  
  const sortedExts = Array.from(extMap.entries()).sort((a, b) => b[1] - a[1]);
  for (const [ext, count] of sortedExts) {
    const extName = ext.substring(1) || 'no-extension';
    md += `- **${extName}**: ${count} symbols\n`;
  }
  md += '\n';

  md += '## Development Setup\n\n';
  md += 'See project README.md for setup instructions.\n\n';

  md += `\n---\n*Generated by Arbok at ${new Date().toISOString()}*\n`;
  
  return truncateToLines(md, 250);
}

/**
 * Generate project structure markdown
 */
function generateProjectStructure(nodes: ArbokNode[]): string {
  const fileMap = new Map<string, ArbokNode[]>();
  
  for (const node of nodes) {
    if (!fileMap.has(node.file_path)) {
      fileMap.set(node.file_path, []);
    }
    fileMap.get(node.file_path)!.push(node);
  }

  let md = '# Project Structure\n\n';
  md += `Total Files: ${fileMap.size}\n`;
  md += `Total Symbols: ${nodes.length}\n\n`;

  const sortedFiles = Array.from(fileMap.keys()).sort();

  for (const filePath of sortedFiles.slice(0, 100)) {
    const fileNodes = fileMap.get(filePath)!;
    md += `## ${filePath}\n\n`;
    
    const classes = fileNodes.filter(n => n.kind === 'class');
    const functions = fileNodes.filter(n => n.kind === 'function');
    const interfaces = fileNodes.filter(n => n.kind === 'interface');
    const methods = fileNodes.filter(n => n.kind === 'method');
    
    if (classes.length > 0) {
      md += '### Classes\n';
      for (const node of classes.slice(0, 20)) {
        md += `- \`${node.name}\`${node.exported ? ' (exported)' : ''} [Lines ${node.start_line}-${node.end_line}]\n`;
      }
      md += '\n';
    }
    
    if (interfaces.length > 0) {
      md += '### Interfaces\n';
      for (const node of interfaces.slice(0, 20)) {
        md += `- \`${node.name}\`${node.exported ? ' (exported)' : ''} [Lines ${node.start_line}-${node.end_line}]\n`;
      }
      md += '\n';
    }
    
    if (functions.length > 0) {
      md += '### Functions\n';
      for (const node of functions.slice(0, 20)) {
        md += `- \`${node.name}\`${node.exported ? ' (exported)' : ''} [Lines ${node.start_line}-${node.end_line}]\n`;
      }
      md += '\n';
    }

    if (methods.length > 0) {
      md += '### Methods\n';
      for (const node of methods.slice(0, 10)) {
        md += `- \`${node.name}\` [Lines ${node.start_line}-${node.end_line}]\n`;
      }
      md += '\n';
    }
  }

  md += `\n---\n*Generated by Arbok at ${new Date().toISOString()}*\n`;
  
  return truncateToLines(md, 250);
}

/**
 * Generate project structure markdown using a basic file/directory tree scan.
 * This does NOT perform any symbol analysis or AST parsing.
 */
function generateProjectStructureFromFileTree(projectPath: string): string {
  const IGNORED_ENTRIES = new Set(['node_modules', '.git', 'dist', '.arbok', 'memory-bank']);

  function buildTree(dirPath: string, prefix: string, depth: number): string {
    if (depth > 4) return '';
    let result = '';
    let entries: string[];
    try {
      entries = readdirSync(dirPath).sort();
    } catch {
      return '';
    }

    const dirs: string[] = [];
    const files: string[] = [];
    for (const entry of entries) {
      if (IGNORED_ENTRIES.has(entry)) continue;
      const fullPath = path.join(dirPath, entry);
      try {
        if (statSync(fullPath).isDirectory()) {
          dirs.push(entry);
        } else {
          files.push(entry);
        }
      } catch {
        // skip inaccessible entries
      }
    }

    for (const dir of dirs) {
      result += `${prefix}${dir}/\n`;
      result += buildTree(path.join(dirPath, dir), prefix + '  ', depth + 1);
    }
    for (const file of files) {
      result += `${prefix}${file}\n`;
    }
    return result;
  }

  let md = '# Project Structure\n\n';
  md += '```\n';
  md += buildTree(projectPath, '', 0);
  md += '```\n';
  md += `\n---\n*Generated by Arbok at ${new Date().toISOString()}*\n`;

  return truncateToLines(md, 250);
}

/**
 * Truncate markdown to specified number of lines
 */
function truncateToLines(content: string, maxLines: number): string {
  const lines = content.split('\n');
  if (lines.length <= maxLines) {
    return content;
  }
  // Reserve 2 lines for truncation message
  const TRUNCATION_MESSAGE_LINES = 2;
  return lines.slice(0, maxLines - TRUNCATION_MESSAGE_LINES).join('\n') + '\n\n*[Truncated to fit context window]*\n';
}
