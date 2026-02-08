import Parser from 'web-tree-sitter';
import { v4 as uuidv4 } from 'uuid';
import type { Edge, Node } from '../types/index.js';
import path from 'path';
import { getAllNodes } from '../database/queries.js';

/**
 * Resolve edges (relationships) between nodes
 */
export function resolveEdges(tree: Parser.Tree, filePath: string, content: string, fileNodes: Omit<Node, 'updated_at'>[]): Edge[] {
  const ext = path.extname(filePath);
  const edges: Edge[] = [];
  
  if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
    resolveTypeScriptEdges(tree.rootNode, content, filePath, fileNodes, edges);
  } else if (ext === '.py') {
    resolvePythonEdges(tree.rootNode, content, filePath, fileNodes, edges);
  }
  
  return edges;
}

/**
 * Resolve TypeScript/JavaScript edges
 */
function resolveTypeScriptEdges(
  node: Parser.SyntaxNode,
  content: string,
  filePath: string,
  fileNodes: Omit<Node, 'updated_at'>[],
  edges: Edge[]
): void {
  switch (node.type) {
    case 'import_statement':
      resolveImport(node, content, filePath, fileNodes, edges);
      break;
    
    case 'class_declaration':
      resolveClassHeritage(node, content, filePath, fileNodes, edges);
      break;
  }
  
  // Recursively process child nodes
  for (const child of node.children) {
    resolveTypeScriptEdges(child, content, filePath, fileNodes, edges);
  }
}

/**
 * Resolve Python edges
 */
function resolvePythonEdges(
  node: Parser.SyntaxNode,
  content: string,
  filePath: string,
  fileNodes: Omit<Node, 'updated_at'>[],
  edges: Edge[]
): void {
  switch (node.type) {
    case 'import_statement':
    case 'import_from_statement':
      resolvePythonImport(node, content, filePath, fileNodes, edges);
      break;
    
    case 'class_definition':
      resolvePythonClassHeritage(node, content, filePath, fileNodes, edges);
      break;
  }
  
  // Recursively process child nodes
  for (const child of node.children) {
    resolvePythonEdges(child, content, filePath, fileNodes, edges);
  }
}

/**
 * Resolve import statement to create import edges
 */
function resolveImport(
  node: Parser.SyntaxNode,
  content: string,
  filePath: string,
  fileNodes: Omit<Node, 'updated_at'>[],
  edges: Edge[]
): void {
  // Extract imported names
  const importedNames: string[] = [];
  
  for (const child of node.children) {
    if (child.type === 'import_clause') {
      extractImportedNames(child, importedNames);
    }
  }
  
  // Try to match imported names to nodes in the database
  const allNodes = getAllNodes();
  
  for (const importedName of importedNames) {
    // Find a node in current file that could be using this import
    const sourceNode = fileNodes.find(n => n.exported);
    if (!sourceNode) continue;
    
    // Find the target node (what's being imported)
    const targetNode = allNodes.find(n => 
      n.name === importedName && 
      n.exported && 
      n.file_path !== filePath
    );
    
    if (targetNode) {
      edges.push({
        id: uuidv4(),
        source_node_id: sourceNode.id,
        target_node_id: targetNode.id,
        relation: 'imports',
      });
    }
  }
}

/**
 * Extract imported names from import clause
 */
function extractImportedNames(node: Parser.SyntaxNode, names: string[]): void {
  if (node.type === 'identifier') {
    names.push(node.text);
  }
  
  for (const child of node.children) {
    extractImportedNames(child, names);
  }
}

/**
 * Resolve class heritage (extends/implements)
 */
function resolveClassHeritage(
  node: Parser.SyntaxNode,
  content: string,
  filePath: string,
  fileNodes: Omit<Node, 'updated_at'>[],
  edges: Edge[]
): void {
  // Find the class node in our extracted nodes
  const className = getClassName(node);
  if (!className) return;
  
  const classNode = fileNodes.find(n => n.name === className && n.kind === 'class');
  if (!classNode) return;
  
  // Look for class_heritage node
  for (const child of node.children) {
    if (child.type === 'class_heritage') {
      resolveHeritageClause(child, classNode, edges);
    }
  }
}

/**
 * Get class name from class declaration
 */
function getClassName(node: Parser.SyntaxNode): string | null {
  for (const child of node.children) {
    if (child.type === 'type_identifier' || child.type === 'identifier') {
      return child.text;
    }
  }
  return null;
}

/**
 * Resolve heritage clause (extends/implements)
 */
function resolveHeritageClause(
  node: Parser.SyntaxNode,
  sourceNode: Omit<Node, 'updated_at'>,
  edges: Edge[]
): void {
  const allNodes = getAllNodes();
  
  for (const child of node.children) {
    if (child.type === 'extends_clause') {
      const typeName = getTypeName(child);
      if (typeName) {
        const targetNode = allNodes.find(n => n.name === typeName && n.kind === 'class');
        if (targetNode) {
          edges.push({
            id: uuidv4(),
            source_node_id: sourceNode.id,
            target_node_id: targetNode.id,
            relation: 'extends',
          });
        }
      }
    } else if (child.type === 'implements_clause') {
      const typeName = getTypeName(child);
      if (typeName) {
        const targetNode = allNodes.find(n => n.name === typeName && n.kind === 'interface');
        if (targetNode) {
          edges.push({
            id: uuidv4(),
            source_node_id: sourceNode.id,
            target_node_id: targetNode.id,
            relation: 'implements',
          });
        }
      }
    }
  }
}

/**
 * Get type name from a type reference
 */
function getTypeName(node: Parser.SyntaxNode): string | null {
  for (const child of node.children) {
    if (child.type === 'type_identifier' || child.type === 'identifier') {
      return child.text;
    }
  }
  return null;
}

/**
 * Resolve Python import statement
 */
function resolvePythonImport(
  node: Parser.SyntaxNode,
  content: string,
  filePath: string,
  fileNodes: Omit<Node, 'updated_at'>[],
  edges: Edge[]
): void {
  // Extract imported names
  const importedNames: string[] = [];
  
  if (node.type === 'import_statement') {
    for (const child of node.children) {
      if (child.type === 'dotted_name' || child.type === 'identifier') {
        importedNames.push(child.text);
      }
    }
  } else if (node.type === 'import_from_statement') {
    for (const child of node.children) {
      if (child.type === 'dotted_name' || child.type === 'identifier') {
        // Skip 'from' module name, get imported items
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          extractPythonImportedNames(nameNode, importedNames);
        }
      }
    }
  }
  
  // Try to match imported names to nodes in the database
  const allNodes = getAllNodes();
  
  for (const importedName of importedNames) {
    const sourceNode = fileNodes.find(n => n.exported);
    if (!sourceNode) continue;
    
    const targetNode = allNodes.find(n => 
      n.name === importedName && 
      n.file_path !== filePath
    );
    
    if (targetNode) {
      edges.push({
        id: uuidv4(),
        source_node_id: sourceNode.id,
        target_node_id: targetNode.id,
        relation: 'imports',
      });
    }
  }
}

/**
 * Extract imported names from Python import
 */
function extractPythonImportedNames(node: Parser.SyntaxNode, names: string[]): void {
  if (node.type === 'identifier') {
    names.push(node.text);
  }
  
  for (const child of node.children) {
    extractPythonImportedNames(child, names);
  }
}

/**
 * Resolve Python class heritage
 */
function resolvePythonClassHeritage(
  node: Parser.SyntaxNode,
  content: string,
  filePath: string,
  fileNodes: Omit<Node, 'updated_at'>[],
  edges: Edge[]
): void {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return;
  
  const className = nameNode.text;
  const classNode = fileNodes.find(n => n.name === className && n.kind === 'class');
  if (!classNode) return;
  
  // Look for superclasses in argument_list
  const argumentList = node.childForFieldName('superclasses');
  if (!argumentList) return;
  
  const allNodes = getAllNodes();
  
  for (const child of argumentList.children) {
    if (child.type === 'identifier') {
      const superclassName = child.text;
      const targetNode = allNodes.find(n => n.name === superclassName && n.kind === 'class');
      
      if (targetNode) {
        edges.push({
          id: uuidv4(),
          source_node_id: classNode.id,
          target_node_id: targetNode.id,
          relation: 'extends',
        });
      }
    }
  }
}
