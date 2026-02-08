#!/usr/bin/env node
/**
 * Arbok MCP Server - Alternative Entry Point (main.ts)
 * 
 * This is an alternative entry point that can be used instead of index.ts.
 * Both entry points do the same thing: start the MCP server via stdio.
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
