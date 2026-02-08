import { z } from 'zod';
import fg from 'fast-glob';
import path from 'path';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
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
import type { NodeKind } from '../types/index.js';

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

/**
 * Initialize/re-index the project
 */
export async function arbokInit(args: z.infer<typeof ArbokInitSchema>): Promise<string> {
  const projectPath = args.projectPath || config.projectPath;
  
  console.error(`Initializing Arbok for project: ${projectPath}`);

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
  const allFileNodes: { filePath: string; nodes: Omit<any, 'updated_at'>[] }[] = [];

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

  let sourceNodes = [];

  if (symbolName) {
    // Find nodes by name
    const nodes = searchNodes(symbolName);
    sourceNodes = nodes.filter(n => n.name === symbolName);
  } else if (filePath) {
    // Get all nodes in the file
    sourceNodes = getNodesByFile(filePath);
  }

  const dependencies: any[] = [];

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
 * Update Memory Bank files
 */
export function arbokUpdateMemory(args: z.infer<typeof ArbokUpdateMemorySchema>): string {
  const memoryBankPath = args.memoryBankPath || config.memoryBankPath;
  
  // Ensure memory bank directory exists
  mkdirSync(memoryBankPath, { recursive: true });

  const allNodes = getAllNodes();
  const stats = getCounts();

  // Generate project-structure.md
  const projectStructure = generateProjectStructure(allNodes);
  const projectStructurePath = path.join(memoryBankPath, 'project-structure.md');
  writeFileSync(projectStructurePath, projectStructure);

  // Generate components.md
  const components = generateComponents(allNodes);
  const componentsPath = path.join(memoryBankPath, 'components.md');
  writeFileSync(componentsPath, components);

  // Generate dependencies.md
  const dependencies = generateDependencies(allNodes);
  const dependenciesPath = path.join(memoryBankPath, 'dependencies.md');
  writeFileSync(dependenciesPath, dependencies);

  return JSON.stringify({
    success: true,
    message: 'Memory Bank updated successfully',
    files: [
      projectStructurePath,
      componentsPath,
      dependenciesPath,
    ],
    stats: {
      files: stats.files,
      nodes: stats.nodes,
      edges: stats.edges,
    },
  }, null, 2);
}

/**
 * Generate project structure markdown
 */
function generateProjectStructure(nodes: any[]): string {
  const fileMap = new Map<string, any[]>();
  
  for (const node of nodes) {
    if (!fileMap.has(node.file_path)) {
      fileMap.set(node.file_path, []);
    }
    fileMap.get(node.file_path)!.push(node);
  }

  let md = '# Project Structure\n\n';
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += `Total Files: ${fileMap.size}\n`;
  md += `Total Symbols: ${nodes.length}\n\n`;

  const sortedFiles = Array.from(fileMap.keys()).sort();

  for (const filePath of sortedFiles) {
    const fileNodes = fileMap.get(filePath)!;
    md += `## ${filePath}\n\n`;
    
    const classes = fileNodes.filter(n => n.kind === 'class');
    const functions = fileNodes.filter(n => n.kind === 'function');
    const interfaces = fileNodes.filter(n => n.kind === 'interface');
    
    if (classes.length > 0) {
      md += '### Classes\n';
      for (const node of classes) {
        md += `- \`${node.name}\`${node.exported ? ' (exported)' : ''}\n`;
      }
      md += '\n';
    }
    
    if (interfaces.length > 0) {
      md += '### Interfaces\n';
      for (const node of interfaces) {
        md += `- \`${node.name}\`${node.exported ? ' (exported)' : ''}\n`;
      }
      md += '\n';
    }
    
    if (functions.length > 0) {
      md += '### Functions\n';
      for (const node of functions) {
        md += `- \`${node.name}\`${node.exported ? ' (exported)' : ''}\n`;
      }
      md += '\n';
    }
  }

  return md;
}

/**
 * Generate components markdown
 */
function generateComponents(nodes: any[]): string {
  let md = '# Major Components\n\n';
  md += `Generated: ${new Date().toISOString()}\n\n`;

  const classes = nodes.filter(n => n.kind === 'class' && n.exported);
  
  md += `## Classes (${classes.length})\n\n`;
  
  for (const cls of classes.slice(0, 50)) {
    md += `### ${cls.name}\n`;
    md += `- File: \`${cls.file_path}\`\n`;
    md += `- Lines: ${cls.start_line}-${cls.end_line}\n`;
    if (cls.doc_comment) {
      md += `- Documentation: ${cls.doc_comment.substring(0, 100)}...\n`;
    }
    md += '\n';
  }

  return md;
}

/**
 * Generate dependencies markdown
 */
function generateDependencies(nodes: any[]): string {
  let md = '# Dependency Graph\n\n';
  md += `Generated: ${new Date().toISOString()}\n\n`;

  const exportedNodes = nodes.filter(n => n.exported);
  
  md += `## Exported Symbols (${exportedNodes.length})\n\n`;
  
  const fileMap = new Map<string, any[]>();
  for (const node of exportedNodes) {
    if (!fileMap.has(node.file_path)) {
      fileMap.set(node.file_path, []);
    }
    fileMap.get(node.file_path)!.push(node);
  }

  for (const [filePath, fileNodes] of fileMap.entries()) {
    md += `### ${filePath}\n`;
    for (const node of fileNodes) {
      md += `- \`${node.name}\` (${node.kind})\n`;
    }
    md += '\n';
  }

  return md;
}
