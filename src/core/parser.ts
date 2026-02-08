import Parser from 'web-tree-sitter';
import { readFileSync } from 'fs';
import path from 'path';
import { config } from '../config.js';

let parserInitialized = false;
let tsParser: Parser | null = null;
let pyParser: Parser | null = null;

/**
 * Initialize tree-sitter parsers with WASM grammars
 */
export async function initParsers(): Promise<void> {
  if (parserInitialized) {
    return;
  }

  try {
    // Initialize the WASM runtime
    await Parser.init();

    // Load TypeScript language
    const tsWasmPath = path.join(config.wasmDir, 'tree-sitter-typescript.wasm');
    const TypeScript = await Parser.Language.load(tsWasmPath);
    
    tsParser = new Parser();
    tsParser.setLanguage(TypeScript);

    // Load Python language
    const pyWasmPath = path.join(config.wasmDir, 'tree-sitter-python.wasm');
    const Python = await Parser.Language.load(pyWasmPath);
    
    pyParser = new Parser();
    pyParser.setLanguage(Python);

    parserInitialized = true;
    console.error('Tree-sitter parsers initialized successfully');
  } catch (error) {
    console.error('Failed to initialize parsers:', error);
    throw error;
  }
}

/**
 * Parse file content and return AST tree
 */
export function parseFile(content: string, ext: string): Parser.Tree | null {
  if (!parserInitialized) {
    throw new Error('Parsers not initialized. Call initParsers() first.');
  }

  try {
    // Determine which parser to use based on extension
    if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
      if (!tsParser) {
        throw new Error('TypeScript parser not available');
      }
      return tsParser.parse(content);
    } else if (ext === '.py') {
      if (!pyParser) {
        throw new Error('Python parser not available');
      }
      return pyParser.parse(content);
    }
    
    return null;
  } catch (error) {
    console.error(`Failed to parse file with extension ${ext}:`, error);
    return null;
  }
}

/**
 * Parse a file by path
 */
export function parseFilePath(filePath: string): Parser.Tree | null {
  const ext = path.extname(filePath);
  const content = readFileSync(filePath, 'utf-8');
  return parseFile(content, ext);
}

/**
 * Check if a file extension is supported
 */
export function isSupportedExtension(ext: string): boolean {
  return ['.ts', '.tsx', '.js', '.jsx', '.py'].includes(ext);
}
