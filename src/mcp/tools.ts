import { z } from 'zod';
import fg from 'fast-glob';
import path from 'path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { config } from '../config.js';
import { parseFile, isSupportedExtension } from '../core/parser.js';
import { extractNodes } from '../core/node-extractor.js';
import { resolveEdges } from '../core/edge-resolver.js';
import {
  insertNodes,
  insertEdges,
  getNodesByFile,
  searchNodes,
  getAllNodes,
  getNodeById,
  getEdgesBySource,
  getCounts,
  clearDatabase,
} from '../database/queries.js';
import { startWatcher } from '../observer/watcher.js';
import type { Node as ArbokNode, NodeKind } from '../types/index.js';

// Input schemas for MCP tools
export const ArbokInitSchema = z.object({
  projectPath: z.string().optional(),
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
  memoryBankPath: z.string().optional(),
});

export const ArbokSetupRulesSchema = z.object({
  projectPath: z.string().optional(),
});

/**
 * Update .clinerules configuration files.
 * If .clinerules or related config files do not exist, they are generated from scratch (Setup phase).
 * If they already exist, they are updated with necessary changes (Update phase).
 */
export function arbokSetupRules(args: z.infer<typeof ArbokSetupRulesSchema>): string {
  const projectPath = args.projectPath || config.projectPath;
  
  const clineruleDir = path.join(projectPath, '.clinerules');
  const workflowsDir = path.join(clineruleDir, 'workflows');
  const isUpdate = existsSync(clineruleDir);

  // Create .clinerules directory structure if missing
  mkdirSync(clineruleDir, { recursive: true });
  mkdirSync(workflowsDir, { recursive: true });

  // 1. Create base rules file
  const baseRules = `# Arbok Integration Rules

## File Access Rules
When you need to understand a file's structure, ALWAYS use the \`arbok_get_file_structure\` tool first before reading the entire file.
Only read the full file content when you need to modify specific lines or understand detailed implementation logic.

## Symbol Search Rules  
When looking for a function, class, or variable definition, use \`arbok_list_symbols\` instead of scanning multiple files.

## Dependency Analysis Rules
When you need to understand how components are connected, use \`arbok_get_dependencies\` to get the dependency graph.

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
1. Call \`arbok_update_memory_bank\` tool to regenerate Memory Bank files
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
1. Call \`arbok_update_index\` tool to scan and index the entire project
2. Call \`arbok_update_memory_bank\` to generate Memory Bank documentation
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
 * Initialize/re-index the project
 */
export async function arbokInit(args: z.infer<typeof ArbokInitSchema>): Promise<string> {
  const projectPath = args.projectPath || config.projectPath;
  
  console.error(`Initializing Arbok for project: ${projectPath}`);

  // Ensure parsers are initialized
  const { initParsers } = await import('../core/parser.js');
  await initParsers();

  // Clear existing data
  clearDatabase();

  // Find all source files
  const patterns = [
    '**/*.ts',
    '**/*.tsx',
    '**/*.js',
    '**/*.jsx',
    '**/*.py',
  ];

  const files = await fg(patterns, {
    cwd: projectPath,
    ignore: config.watchIgnorePatterns,
    absolute: true,
  });

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

  // Auto-setup .clinerules if not present
  const clineruleDir = path.join(projectPath, '.clinerules');
  if (!existsSync(clineruleDir)) {
    arbokSetupRules({ projectPath });
    console.error('.clinerules auto-generated');
  }

  // Auto-generate Memory Bank
  arbokUpdateMemory({ memoryBankPath: config.memoryBankPath });
  console.error('Memory Bank auto-generated');

  const stats = getCounts();

  return JSON.stringify({
    success: true,
    message: 'Project indexed successfully',
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

/**
 * Update Memory Bank files.
 * If the memory-bank directory and basic files do not exist, they are created and initialized (Setup phase).
 * If they already exist, they are updated with the current project state (Update phase).
 */
export function arbokUpdateMemory(args: z.infer<typeof ArbokUpdateMemorySchema>): string {
  const memoryBankPath = args.memoryBankPath || config.memoryBankPath;
  const isUpdate = existsSync(memoryBankPath);
  
  // Ensure memory bank directory exists
  mkdirSync(memoryBankPath, { recursive: true });

  const allNodes = getAllNodes();
  const stats = getCounts();
  const projectPath = config.projectPath;

  const filesCreated: string[] = [];

  // 1. Generate productContext.md
  const productContext = generateProductContext(allNodes, projectPath);
  const productContextPath = path.join(memoryBankPath, 'productContext.md');
  writeFileSync(productContextPath, productContext);
  filesCreated.push(productContextPath);

  // 2. Generate activeContext.md
  const activeContext = generateActiveContext(allNodes);
  const activeContextPath = path.join(memoryBankPath, 'activeContext.md');
  writeFileSync(activeContextPath, activeContext);
  filesCreated.push(activeContextPath);

  // 3. Generate progress.md
  const progress = generateProgress(allNodes, stats);
  const progressPath = path.join(memoryBankPath, 'progress.md');
  writeFileSync(progressPath, progress);
  filesCreated.push(progressPath);

  // 4. Generate systemPatterns.md
  const systemPatterns = generateSystemPatterns(allNodes);
  const systemPatternsPath = path.join(memoryBankPath, 'systemPatterns.md');
  writeFileSync(systemPatternsPath, systemPatterns);
  filesCreated.push(systemPatternsPath);

  // 5. Generate techContext.md
  const techContext = generateTechContext(projectPath, allNodes);
  const techContextPath = path.join(memoryBankPath, 'techContext.md');
  writeFileSync(techContextPath, techContext);
  filesCreated.push(techContextPath);

  // 6. Generate project-structure.md
  const projectStructure = generateProjectStructure(allNodes);
  const projectStructurePath = path.join(memoryBankPath, 'project-structure.md');
  writeFileSync(projectStructurePath, projectStructure);
  filesCreated.push(projectStructurePath);

  return JSON.stringify({
    success: true,
    message: isUpdate
      ? 'Memory Bank updated successfully'
      : 'Memory Bank initialized successfully',
    files: filesCreated,
    stats: {
      files: stats.files,
      nodes: stats.nodes,
      edges: stats.edges,
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
