#!/usr/bin/env node
/**
 * Arbok MCP Server - Entry Point
 * 
 * AST-based code analysis MCP server that reduces token consumption
 * by providing lightweight code structure queries.
 */

import 'dotenv/config';
import { startMCPServer } from './mcp/server.js';

async function main() {
  try {
    await startMCPServer();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();