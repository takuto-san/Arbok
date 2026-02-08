import Parser from 'web-tree-sitter';
import { v4 as uuidv4 } from 'uuid';
import type { Node, NodeKind } from '../types/index.js';
import path from 'path';

interface ExtractedNode {
  name: string;
  kind: NodeKind;
  startLine: number;
  endLine: number;
  signature: string | null;
  docComment: string | null;
  exported: boolean;
}

/**
 * Extract nodes from an AST tree
 */
export function extractNodes(tree: Parser.Tree, filePath: string, content: string): Omit<Node, 'updated_at'>[] {
  const ext = path.extname(filePath);
  const nodes: Omit<Node, 'updated_at'>[] = [];
  
  if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
    extractTypeScriptNodes(tree.rootNode, content, filePath, nodes);
  } else if (ext === '.py') {
    extractPythonNodes(tree.rootNode, content, filePath, nodes);
  }
  
  return nodes;
}

/**
 * Extract nodes from TypeScript/JavaScript AST
 */
function extractTypeScriptNodes(
  node: Parser.SyntaxNode,
  content: string,
  filePath: string,
  nodes: Omit<Node, 'updated_at'>[]
): void {
  // Check if this node is exported
  const isExported = hasExportModifier(node);
  
  switch (node.type) {
    case 'function_declaration':
      extractFunction(node, content, filePath, nodes, isExported);
      break;
    
    case 'class_declaration':
      extractClass(node, content, filePath, nodes, isExported);
      break;
    
    case 'interface_declaration':
      extractInterface(node, content, filePath, nodes, isExported);
      break;
    
    case 'type_alias_declaration':
      extractTypeAlias(node, content, filePath, nodes, isExported);
      break;
    
    case 'enum_declaration':
      extractEnum(node, content, filePath, nodes, isExported);
      break;
    
    case 'lexical_declaration':
    case 'variable_declaration':
      extractVariableDeclaration(node, content, filePath, nodes, isExported);
      break;
    
    case 'method_definition':
      extractMethod(node, content, filePath, nodes, false);
      break;
    
    case 'export_statement':
      // Process exported declarations
      for (const child of node.children) {
        extractTypeScriptNodes(child, content, filePath, nodes);
      }
      return;
  }
  
  // Recursively process child nodes
  for (const child of node.children) {
    extractTypeScriptNodes(child, content, filePath, nodes);
  }
}

/**
 * Extract nodes from Python AST
 */
function extractPythonNodes(
  node: Parser.SyntaxNode,
  content: string,
  filePath: string,
  nodes: Omit<Node, 'updated_at'>[]
): void {
  switch (node.type) {
    case 'function_definition':
      extractPythonFunction(node, content, filePath, nodes);
      break;
    
    case 'class_definition':
      extractPythonClass(node, content, filePath, nodes);
      break;
    
    case 'decorated_definition':
      // Process the actual definition inside decorator
      for (const child of node.children) {
        if (child.type === 'function_definition' || child.type === 'class_definition') {
          extractPythonNodes(child, content, filePath, nodes);
        }
      }
      break;
  }
  
  // Recursively process child nodes
  for (const child of node.children) {
    extractPythonNodes(child, content, filePath, nodes);
  }
}

/**
 * Check if a node has an export modifier
 */
function hasExportModifier(node: Parser.SyntaxNode): boolean {
  if (!node.parent) return false;
  
  // Check if parent is export_statement
  if (node.parent.type === 'export_statement') {
    return true;
  }
  
  // Check for 'export' keyword in previous siblings
  const parent = node.parent;
  for (const sibling of parent.children) {
    if (sibling.startPosition.row < node.startPosition.row) {
      if (sibling.type === 'export') {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Get the name identifier from a node
 */
function getNameNode(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  for (const child of node.children) {
    if (child.type === 'identifier' || child.type === 'type_identifier') {
      return child;
    }
  }
  return null;
}

/**
 * Extract doc comment preceding a node
 */
function getDocComment(node: Parser.SyntaxNode, content: string): string | null {
  // Look for preceding comment
  let current = node.previousSibling;
  
  while (current) {
    if (current.type === 'comment') {
      const text = content.slice(current.startIndex, current.endIndex);
      // Check if it's a doc comment (JSDoc: /** */ or Python: """)
      if (text.startsWith('/**') || text.startsWith('"""') || text.startsWith("'''")) {
        return text.trim();
      }
    }
    current = current.previousSibling;
  }
  
  return null;
}

/**
 * Extract function declaration
 */
function extractFunction(
  node: Parser.SyntaxNode,
  content: string,
  filePath: string,
  nodes: Omit<Node, 'updated_at'>[],
  exported: boolean
): void {
  const nameNode = getNameNode(node);
  if (!nameNode) return;
  
  const name = nameNode.text;
  const signature = getNodeSignature(node, content);
  const docComment = getDocComment(node, content);
  
  nodes.push({
    id: uuidv4(),
    file_path: filePath,
    name,
    kind: 'function',
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    signature,
    doc_comment: docComment,
    exported,
  });
}

/**
 * Extract class declaration
 */
function extractClass(
  node: Parser.SyntaxNode,
  content: string,
  filePath: string,
  nodes: Omit<Node, 'updated_at'>[],
  exported: boolean
): void {
  const nameNode = getNameNode(node);
  if (!nameNode) return;
  
  const name = nameNode.text;
  const signature = getNodeSignature(node, content);
  const docComment = getDocComment(node, content);
  
  nodes.push({
    id: uuidv4(),
    file_path: filePath,
    name,
    kind: 'class',
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    signature,
    doc_comment: docComment,
    exported,
  });
}

/**
 * Extract interface declaration
 */
function extractInterface(
  node: Parser.SyntaxNode,
  content: string,
  filePath: string,
  nodes: Omit<Node, 'updated_at'>[],
  exported: boolean
): void {
  const nameNode = getNameNode(node);
  if (!nameNode) return;
  
  const name = nameNode.text;
  const signature = getNodeSignature(node, content);
  const docComment = getDocComment(node, content);
  
  nodes.push({
    id: uuidv4(),
    file_path: filePath,
    name,
    kind: 'interface',
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    signature,
    doc_comment: docComment,
    exported,
  });
}

/**
 * Extract type alias declaration
 */
function extractTypeAlias(
  node: Parser.SyntaxNode,
  content: string,
  filePath: string,
  nodes: Omit<Node, 'updated_at'>[],
  exported: boolean
): void {
  const nameNode = getNameNode(node);
  if (!nameNode) return;
  
  const name = nameNode.text;
  const signature = getNodeSignature(node, content);
  const docComment = getDocComment(node, content);
  
  nodes.push({
    id: uuidv4(),
    file_path: filePath,
    name,
    kind: 'type_alias',
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    signature,
    doc_comment: docComment,
    exported,
  });
}

/**
 * Extract enum declaration
 */
function extractEnum(
  node: Parser.SyntaxNode,
  content: string,
  filePath: string,
  nodes: Omit<Node, 'updated_at'>[],
  exported: boolean
): void {
  const nameNode = getNameNode(node);
  if (!nameNode) return;
  
  const name = nameNode.text;
  const signature = getNodeSignature(node, content);
  const docComment = getDocComment(node, content);
  
  nodes.push({
    id: uuidv4(),
    file_path: filePath,
    name,
    kind: 'enum',
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    signature,
    doc_comment: docComment,
    exported,
  });
}

/**
 * Extract method definition
 */
function extractMethod(
  node: Parser.SyntaxNode,
  content: string,
  filePath: string,
  nodes: Omit<Node, 'updated_at'>[],
  exported: boolean
): void {
  const nameNode = getNameNode(node);
  if (!nameNode) return;
  
  const name = nameNode.text;
  const signature = getNodeSignature(node, content);
  const docComment = getDocComment(node, content);
  
  nodes.push({
    id: uuidv4(),
    file_path: filePath,
    name,
    kind: 'method',
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    signature,
    doc_comment: docComment,
    exported,
  });
}

/**
 * Extract variable declarations
 */
function extractVariableDeclaration(
  node: Parser.SyntaxNode,
  content: string,
  filePath: string,
  nodes: Omit<Node, 'updated_at'>[],
  exported: boolean
): void {
  // Find variable_declarator children
  for (const child of node.children) {
    if (child.type === 'variable_declarator') {
      const nameNode = getNameNode(child);
      if (!nameNode) continue;
      
      const name = nameNode.text;
      
      // Only extract if it has an initializer (assigned value)
      const hasInitializer = child.children.some(c => c.type === 'arrow_function' || c.type === 'function');
      
      if (hasInitializer) {
        const signature = getNodeSignature(child, content);
        const docComment = getDocComment(node, content);
        
        nodes.push({
          id: uuidv4(),
          file_path: filePath,
          name,
          kind: 'variable',
          start_line: child.startPosition.row + 1,
          end_line: child.endPosition.row + 1,
          signature,
          doc_comment: docComment,
          exported,
        });
      }
    }
  }
}

/**
 * Extract Python function
 */
function extractPythonFunction(
  node: Parser.SyntaxNode,
  content: string,
  filePath: string,
  nodes: Omit<Node, 'updated_at'>[]
): void {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return;
  
  const name = nameNode.text;
  const signature = getNodeSignature(node, content);
  const docComment = getPythonDocstring(node, content);
  
  nodes.push({
    id: uuidv4(),
    file_path: filePath,
    name,
    kind: 'function',
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    signature,
    doc_comment: docComment,
    exported: true, // Python functions at module level are implicitly exported
  });
}

/**
 * Extract Python class
 */
function extractPythonClass(
  node: Parser.SyntaxNode,
  content: string,
  filePath: string,
  nodes: Omit<Node, 'updated_at'>[]
): void {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return;
  
  const name = nameNode.text;
  const signature = getNodeSignature(node, content);
  const docComment = getPythonDocstring(node, content);
  
  nodes.push({
    id: uuidv4(),
    file_path: filePath,
    name,
    kind: 'class',
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    signature,
    doc_comment: docComment,
    exported: true, // Python classes at module level are implicitly exported
  });
}

/**
 * Get Python docstring
 */
function getPythonDocstring(node: Parser.SyntaxNode, content: string): string | null {
  // Look for docstring as first statement in body
  const body = node.childForFieldName('body');
  if (!body) return null;
  
  for (const child of body.children) {
    if (child.type === 'expression_statement') {
      const stringNode = child.firstChild;
      if (stringNode && stringNode.type === 'string') {
        const text = content.slice(stringNode.startIndex, stringNode.endIndex);
        return text.trim();
      }
    }
    // Only check first statement
    break;
  }
  
  return null;
}

/**
 * Get a compact signature for a node (first line or declaration line)
 */
function getNodeSignature(node: Parser.SyntaxNode, content: string): string {
  // Get the first line of the node
  const startLine = node.startPosition.row;
  const lines = content.split('\n');
  const firstLine = lines[startLine] || '';
  
  // Trim and limit length
  const signature = firstLine.trim();
  return signature.length > 200 ? signature.substring(0, 197) + '...' : signature;
}
