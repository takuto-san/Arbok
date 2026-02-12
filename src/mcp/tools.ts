import { z } from 'zod';
import fg from 'fast-glob';
import path from 'path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { config } from '../config.js';
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

export const ArbokUnifiedInitSchema = z.object({
  projectPath: z.string().min(1, "projectPath must be a non-empty string"),
  execute: z.boolean().optional().describe("Set to true ONLY in Act Mode to perform the actual operation. Defaults to false (Dry Run/Preview)."),
});

/**
 * Initialize .clinerules configuration files only if they do not exist.
 * If .clinerules already exists, skip creation and return a message.
 *
 * - Plan Mode (`execute` falsy): returns a JSON diagnostic with `message` and `nextStep`.
 * - Act Mode (`execute: true`): creates the .clinerules directory and files.
 */
export function arbokInitRules(args: z.infer<typeof ArbokSetupRulesSchema>): string {
  if (!existsSync(args.projectPath)) {
    return JSON.stringify({
      success: false,
      isError: true,
      message: `The provided projectPath does not exist: '${args.projectPath}'. Cannot initialize rules in a non-existent project.`,
    }, null, 2);
  }

  const absolutePath = path.resolve(args.projectPath, '.clinerules');

  console.error(`[Arbok] arbokInitRules called with execute=${args.execute}`);
  console.error(`[Arbok] Target Absolute Path: ${absolutePath}`);

  const exists = existsSync(absolutePath);
  console.error(`[Arbok] Directory exists: ${exists}`);

  if (exists) {
    return JSON.stringify({
      success: true,
      status: 'exists',
      debug_checked_path: absolutePath,
      message: `.clinerules already exists at ${absolutePath}. Use arbok:update_rules to update.`,
      skipped: true,
    }, null, 2);
  }

  // Directory does not exist
  if (!args.execute) {
    return JSON.stringify({
      success: true,
      status: 'missing',
      debug_checked_path: absolutePath,
      message: `Ready to initialize .clinerules at ${absolutePath}. Please SWITCH TO ACT MODE and run this tool again with 'execute: true' to proceed.`,
    }, null, 2);
  }

  // Act Mode: create and initialize
  console.error(`[Arbok] Act Mode: creating .clinerules at ${absolutePath}`);
  const result = arbokSetupRules({ projectPath: args.projectPath, execute: true });

  // Post-write verification
  if (!existsSync(absolutePath)) {
    throw new Error(`[CRITICAL FAILURE] Failed to create .clinerules directory at: ${absolutePath}`);
  }
  console.error(`[Arbok] Verified .clinerules directory exists: ${absolutePath}`);

  return result;
}

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
  const baseRules = `# Arbok Integration Rules

## File Access Rules
When you need to understand a file's structure, ALWAYS use the \`arbok:get_file_structure\` tool first before reading the entire file.
Only read the full file content when you need to modify specific lines or understand detailed implementation logic.

## Symbol Search Rules  
When looking for a function, class, or variable definition, use \`arbok:get_symbols\` instead of scanning multiple files.

## Dependency Analysis Rules
When you need to understand how components are connected, use \`arbok:get_dependencies\` to get the dependency graph.

## General Guidelines
- Minimize the number of files you read in full
- Use Arbok's index to navigate the codebase efficiently
- Always check memory-bank/ files first for project context before exploring code
- After completing a task, trigger the memory bank update workflow
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

  // 3. Create init workflow  
  const initWorkflow = `# Initialize Arbok Workflow

## Trigger
Run this workflow when starting work on this project for the first time or after major structural changes.

## Steps
1. Call \`arbok:update_index\` tool to scan and index the entire project
2. Call \`arbok:update_memory_bank\` to generate Memory Bank documentation
3. Read \`memory-bank/productContext.md\` to understand the project
4. Read \`memory-bank/activeContext.md\` for current work context
`;
  writeFileSync(path.join(workflowsDir, 'init_arbok.md'), initWorkflow);

  return JSON.stringify({
    success: true,
    message: isUpdate
      ? '.clinerules files updated successfully'
      : '.clinerules files created successfully',
    files_created: [
      path.join(clineruleDir, 'rules.md'),
      path.join(workflowsDir, 'update_memory.md'),
      path.join(workflowsDir, 'init_arbok.md'),
    ],
  }, null, 2);
}

/**
 * Initialize/index the project only if the index does not exist.
 * If the index already exists, skip creation and return a message.
 *
 * - Plan Mode (`execute` falsy): returns a JSON diagnostic with `message` and `nextStep`.
 * - Act Mode (`execute: true`): creates the .arbok directory and index.
 */
export async function arbokInitIndex(args: z.infer<typeof ArbokInitSchema>): Promise<string> {
  if (!existsSync(args.projectPath)) {
    return JSON.stringify({
      success: false,
      isError: true,
      message: `The provided projectPath does not exist: '${args.projectPath}'. Cannot initialize index in a non-existent project.`,
    }, null, 2);
  }

  const absolutePath = path.resolve(args.projectPath, '.arbok');
  const dbPath = path.join(absolutePath, 'index.db');

  console.error(`[Arbok] arbokInitIndex called with execute=${args.execute}`);
  console.error(`[Arbok] Target Absolute Path: ${absolutePath}`);

  const dbExists = existsSync(dbPath);
  console.error(`[Arbok] Index DB exists: ${dbExists}`);

  if (dbExists) {
    const stats = getCounts();
    if (stats.nodes > 0) {
      return JSON.stringify({
        success: true,
        status: 'exists',
        debug_checked_path: absolutePath,
        message: `Index already exists at ${absolutePath}. Use arbok:update_index to re-index.`,
        skipped: true,
        stats: {
          files_indexed: stats.files,
          nodes_created: stats.nodes,
          edges_created: stats.edges,
        },
      }, null, 2);
    }
  }

  // Index does not exist or is empty
  if (!args.execute) {
    return JSON.stringify({
      success: true,
      status: 'missing',
      debug_checked_path: absolutePath,
      message: `Ready to initialize .arbok index at ${absolutePath}. Please SWITCH TO ACT MODE and run this tool again with 'execute: true' to proceed.`,
    }, null, 2);
  }

  // Act Mode: create and initialize — strictly .arbok/ only, never .clinerules/
  console.error(`[Arbok] Act Mode: creating index at ${absolutePath}`);
  mkdirSync(absolutePath, { recursive: true });
  const result = await arbokInit(args);

  // Post-write verification
  if (!existsSync(dbPath)) {
    throw new Error(`[CRITICAL FAILURE] Failed to create index database at: ${dbPath}`);
  }
  console.error(`[Arbok] Verified index DB exists: ${dbPath}`);

  return result;
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
export async function arbokUnifiedInit(args: z.infer<typeof ArbokUnifiedInitSchema>): Promise<string> {
  const projectPath = args.projectPath;

  if (!existsSync(projectPath)) {
    return JSON.stringify({
      success: false,
      isError: true,
      message: `The provided projectPath does not exist: '${projectPath}'. Cannot initialize project in a non-existent directory.`,
    }, null, 2);
  }

  const absoluteProjectPath = path.resolve(projectPath);

  // --- Step 1: Project Index (.arbok/) ---
  const arbokDir = path.resolve(absoluteProjectPath, '.arbok');
  const dbPath = path.join(arbokDir, 'index.db');
  const indexDbExists = existsSync(dbPath);
  let indexHasNodes = false;
  if (indexDbExists) {
    const stats = getCounts();
    indexHasNodes = stats.nodes > 0;
  }
  const indexNeeded = !indexDbExists || !indexHasNodes;

  // --- Step 2: Memory Bank (memory-bank/) ---
  const memoryBankDir = path.resolve(absoluteProjectPath, 'memory-bank');
  const mbState = detectMemoryBankState(memoryBankDir);
  const mbMissingFiles = mbState.missingFiles;
  const mbNeeded = mbMissingFiles.length > 0;

  // --- Step 3: Cline Rules (.clinerules/) ---
  const clineruleDir = path.resolve(absoluteProjectPath, '.clinerules');
  const rulesExist = existsSync(clineruleDir);
  const rulesNeeded = !rulesExist;

  // ---- Plan Mode ----
  if (!args.execute) {
    return JSON.stringify({
      success: true,
      mode: 'plan',
      message: 'Discovery scan complete. Switch to Act Mode and run with execute: true to proceed.',
      discovery: {
        index: indexNeeded ? 'Will be created' : 'Already exists – will be skipped',
        memoryBank: mbNeeded
          ? `Will create ${mbMissingFiles.length} missing file(s): ${mbMissingFiles.join(', ')}`
          : 'Complete – will be skipped',
        clinerules: rulesNeeded ? 'Will be created' : 'Already exists – will be skipped',
      },
      path: absoluteProjectPath,
    }, null, 2);
  }

  // ---- Act Mode ----
  console.error(`[Arbok] arbokUnifiedInit Act Mode for: ${absoluteProjectPath}`);

  let indexStatus = 'Skipped';
  let indexNodes = 0;
  let indexFiles = 0;

  // Step 1: Index
  if (indexNeeded) {
    console.error(`[Arbok] Creating project index...`);
    mkdirSync(arbokDir, { recursive: true });
    await arbokInit({ projectPath: absoluteProjectPath, execute: true });
    const counts = getCounts();
    indexNodes = counts.nodes;
    indexFiles = counts.files;
    indexStatus = 'Created';
  } else {
    const counts = getCounts();
    indexNodes = counts.nodes;
    indexFiles = counts.files;
  }

  // Step 2: Memory Bank – only create missing files
  let mbCreatedCount = 0;
  let mbSkippedCount = 0;

  if (mbNeeded) {
    console.error(`[Arbok] Setting up memory bank (${mbMissingFiles.length} files to create)...`);
    mkdirSync(memoryBankDir, { recursive: true });

    const generators: Record<string, () => string> = {
      'productContext.md': () => generateProductContext([], absoluteProjectPath),
      'activeContext.md': () => generateActiveContext([]),
      'progress.md': () => generateProgress([], { files: 0, nodes: 0, edges: 0 }),
      'systemPatterns.md': () => generateSystemPatterns([]),
      'techContext.md': () => generateTechContext(absoluteProjectPath, []),
      'project-structure.md': () => generateProjectStructureFromFileTree(absoluteProjectPath),
    };

    for (const file of MEMORY_BANK_REQUIRED_FILES) {
      const filePath = path.join(memoryBankDir, file);
      if (existsSync(filePath)) {
        mbSkippedCount++;
      } else {
        const generator = generators[file];
        if (generator) {
          writeFileSync(filePath, generator());
          mbCreatedCount++;
        }
      }
    }
  } else {
    mbSkippedCount = MEMORY_BANK_REQUIRED_FILES.length;
  }

  // Step 3: Cline Rules
  let clinerulesStatus = 'Skipped';

  if (rulesNeeded) {
    console.error(`[Arbok] Creating .clinerules...`);
    arbokSetupRules({ projectPath: absoluteProjectPath, execute: true });
    clinerulesStatus = 'Created';
  }

  const totalFilesWritten = mbCreatedCount + (clinerulesStatus === 'Created' ? 3 : 0);

  return JSON.stringify({
    success: true,
    summary: {
      index: indexStatus,
      memoryBank: `Created ${mbCreatedCount} file(s) / Skipped ${mbSkippedCount} file(s)`,
      clinerules: clinerulesStatus,
    },
    stats: { nodes: indexNodes, files: indexFiles + totalFilesWritten },
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
 * Initialize/re-index the project
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
  
  console.error(`Initializing Arbok for project: ${projectPath}`);

  // Ensure parsers are initialized
  const { initParsers } = await import('../core/parser.js');
  await initParsers();

  // Clear existing data
  clearDatabase();

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

  const arbokDir = path.resolve(projectPath, '.arbok');
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
 * Initialize Memory Bank files with 3-state detection.
 *
 * - Plan Mode (`execute` falsy): returns a JSON diagnostic with `message` and `nextStep`.
 * - Act Mode (`execute: true`): creates / repairs the Memory Bank.
 */
export function arbokInitMemoryBank(args: z.infer<typeof ArbokUpdateMemorySchema>): string {
  // Step 1: Validate projectPath is provided
  if (!existsSync(args.projectPath)) {
    return JSON.stringify({
      success: false,
      isError: true,
      message: `The provided projectPath does not exist: '${args.projectPath}'. Cannot initialize memory bank in a non-existent project.`,
    }, null, 2);
  }

  // Step 2: Resolve absolute path
  const memoryBankDir = args.memoryBankPath || 'memory-bank';
  const absolutePath = path.resolve(args.projectPath, memoryBankDir);

  console.error(`[Arbok] arbokInitMemoryBank called with execute=${args.execute}`);
  console.error(`[Arbok] Target Absolute Path: ${absolutePath}`);

  // Step 3: Check existence
  const exists = existsSync(absolutePath);
  console.error(`[Arbok] Directory exists: ${exists}`);

  // Step 4: Logic flow
  if (!exists) {
    if (!args.execute) {
      return JSON.stringify({
        success: true,
        status: 'missing',
        debug_checked_path: absolutePath,
        message: `Directory NOT found at ${absolutePath}. Please SWITCH TO ACT MODE to create it.`,
      }, null, 2);
    }

    // Act Mode: create and initialize
    console.error(`[Arbok] Act Mode: creating and initializing memory bank at ${absolutePath}`);
    return arbokUpdateMemory({ projectPath: args.projectPath, memoryBankPath: absolutePath, execute: true });
  }

  // Directory exists – check completeness
  const missingFiles = MEMORY_BANK_REQUIRED_FILES.filter(
    (file) => !existsSync(path.join(absolutePath, file))
  );

  if (missingFiles.length > 0) {
    if (!args.execute) {
      return JSON.stringify({
        success: true,
        status: 'incomplete',
        debug_checked_path: absolutePath,
        message: `Directory exists but files are missing. Please SWITCH TO ACT MODE to repair.`,
        missingFiles,
      }, null, 2);
    }

    // Act Mode: repair missing files
    console.error(`[Arbok] Act Mode: repairing ${missingFiles.length} missing files at ${absolutePath}`);
    return arbokUpdateMemory({ projectPath: args.projectPath, memoryBankPath: absolutePath, execute: true });
  }

  // Fully complete
  return JSON.stringify({
    success: true,
    status: 'exists',
    debug_checked_path: absolutePath,
    message: `Memory Bank fully exists at ${absolutePath}. Use update tool.`,
  }, null, 2);
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
  // arbok:init_index and arbok:update_index only.
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
