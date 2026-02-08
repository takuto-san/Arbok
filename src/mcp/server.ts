import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { initParsers } from '../core/parser.js';
import {
  arbokInit,
  arbokGetFileStructure,
  arbokSearchSymbol,
  arbokGetDependencies,
  arbokUpdateMemory,
  arbokSetupRules,
  ArbokInitSchema,
  ArbokGetFileStructureSchema,
  ArbokSearchSymbolSchema,
  ArbokGetDependenciesSchema,
  ArbokUpdateMemorySchema,
  ArbokSetupRulesSchema,
} from './tools.js';

/**
 * Create and configure the MCP server
 */
export async function createMCPServer(): Promise<Server> {
  // Initialize parsers before creating server
  await initParsers();

  const server = new Server(
    {
      name: 'arbok',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'arbok_init',
          description: 'Initialize/re-index the project. Scans all source files, parses them with Tree-sitter, extracts nodes and edges, and starts file watcher.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the project directory (optional, defaults to /workspace or PROJECT_PATH env var)',
              },
            },
          },
        },
        {
          name: 'arbok_get_file_structure',
          description: 'Get the structure of a specific file. Returns symbols (functions, classes, etc.) with their metadata but WITHOUT source code.',
          inputSchema: {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: 'Relative path to the file from project root',
              },
            },
            required: ['filePath'],
          },
        },
        {
          name: 'arbok_search_symbol',
          description: 'Search for symbols by name across the entire project. Supports partial matching.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query (supports partial matching)',
              },
              kind: {
                type: 'string',
                enum: ['function', 'class', 'variable', 'interface', 'method', 'type_alias', 'enum'],
                description: 'Optional filter by symbol kind',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'arbok_get_dependencies',
          description: 'Get dependency relationships for a file or symbol. Returns imports, calls, extends, and implements relationships.',
          inputSchema: {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: 'File path to get dependencies for',
              },
              symbolName: {
                type: 'string',
                description: 'Symbol name to get dependencies for',
              },
            },
          },
        },
        {
          name: 'arbok_update_memory',
          description: 'Update Memory Bank files with current project structure, components, and dependencies.',
          inputSchema: {
            type: 'object',
            properties: {
              memoryBankPath: {
                type: 'string',
                description: 'Path to memory bank directory (optional, defaults to memory-bank/)',
              },
            },
          },
        },
        {
          name: 'arbok_setup_rules',
          description: 'Auto-generate .clinerules configuration files for Cline integration. Creates base rules for efficient file access via Arbok, and workflows for Memory Bank updates and project initialization.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the project directory (optional, defaults to /workspace or PROJECT_PATH env var)',
              },
            },
          },
        },
      ],
    };
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: string;

      switch (name) {
        case 'arbok_init': {
          const validatedArgs = ArbokInitSchema.parse(args || {});
          result = await arbokInit(validatedArgs);
          break;
        }

        case 'arbok_get_file_structure': {
          const validatedArgs = ArbokGetFileStructureSchema.parse(args || {});
          result = arbokGetFileStructure(validatedArgs);
          break;
        }

        case 'arbok_search_symbol': {
          const validatedArgs = ArbokSearchSymbolSchema.parse(args || {});
          result = arbokSearchSymbol(validatedArgs);
          break;
        }

        case 'arbok_get_dependencies': {
          const validatedArgs = ArbokGetDependenciesSchema.parse(args || {});
          result = arbokGetDependencies(validatedArgs);
          break;
        }

        case 'arbok_update_memory': {
          const validatedArgs = ArbokUpdateMemorySchema.parse(args || {});
          result = arbokUpdateMemory(validatedArgs);
          break;
        }

        case 'arbok_setup_rules': {
          const validatedArgs = ArbokSetupRulesSchema.parse(args || {});
          result = arbokSetupRules(validatedArgs);
          break;
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: result,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: errorMessage,
              tool: name,
            }, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Start the MCP server with stdio transport
 */
export async function startMCPServer(): Promise<void> {
  const server = await createMCPServer();
  const transport = new StdioServerTransport();
  
  await server.connect(transport);
  
  console.error('Arbok MCP Server running on stdio...');
}
