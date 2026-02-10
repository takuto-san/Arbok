import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { initParsers } from '../core/parser.js';
import {
  arbokInit,
  arbokInitIndex,
  arbokGetFileStructure,
  arbokSearchSymbol,
  arbokGetDependencies,
  arbokUpdateMemory,
  arbokInitMemoryBank,
  arbokSetupRules,
  arbokInitRules,
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
        // init tools
        {
          name: 'arbok:init_index',
          description: 'Initialize the project index only if it does not already exist. If the index already exists, this tool does nothing and returns a message. Use arbok:update_index to re-index.',
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
          name: 'arbok:init_memory_bank',
          description: 'Initialize Memory Bank files only if the memory-bank directory does not already exist. If it already exists, this tool does nothing and returns a message. Use arbok:update_memory_bank to update.',
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
          name: 'arbok:init_rules',
          description: 'Initialize .clinerules configuration files only if the .clinerules directory does not already exist. If it already exists, this tool does nothing and returns a message. Use arbok:update_rules to update.',
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
        // get tools
        {
          name: 'arbok:get_file_structure',
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
          name: 'arbok:get_symbols',
          description: 'List symbols matching a name across the entire project. Supports partial matching.',
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
          name: 'arbok:get_dependencies',
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
        // update tools
        {
          name: 'arbok:update_index',
          description: 'Initialize or re-index the project. Scans all source files, parses them with Tree-sitter, extracts nodes and edges, and starts file watcher. If the index already exists, it is refreshed.',
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
          name: 'arbok:update_memory_bank',
          description: 'Update Memory Bank files with current project structure, components, and dependencies. If the memory-bank directory and basic files do not exist, they are created and initialized. If they already exist, they are updated with the current project state.',
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
          name: 'arbok:update_rules',
          description: 'Update .clinerules configuration files for Cline integration. If .clinerules or related config files do not exist, they are generated from scratch. If they already exist, they are updated with necessary changes.',
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
        // init tools
        case 'arbok:init_index': {
          const validatedArgs = ArbokInitSchema.parse(args || {});
          result = await arbokInitIndex(validatedArgs);
          break;
        }

        case 'arbok:init_memory_bank': {
          const validatedArgs = ArbokUpdateMemorySchema.parse(args || {});
          result = arbokInitMemoryBank(validatedArgs);
          break;
        }

        case 'arbok:init_rules': {
          const validatedArgs = ArbokSetupRulesSchema.parse(args || {});
          result = arbokInitRules(validatedArgs);
          break;
        }

        // get tools
        case 'arbok:get_file_structure': {
          const validatedArgs = ArbokGetFileStructureSchema.parse(args || {});
          result = arbokGetFileStructure(validatedArgs);
          break;
        }

        case 'arbok:get_symbols': {
          const validatedArgs = ArbokSearchSymbolSchema.parse(args || {});
          result = arbokSearchSymbol(validatedArgs);
          break;
        }

        case 'arbok:get_dependencies': {
          const validatedArgs = ArbokGetDependenciesSchema.parse(args || {});
          result = arbokGetDependencies(validatedArgs);
          break;
        }

        // update tools
        case 'arbok:update_index': {
          const validatedArgs = ArbokInitSchema.parse(args || {});
          result = await arbokInit(validatedArgs);
          break;
        }

        case 'arbok:update_memory_bank': {
          const validatedArgs = ArbokUpdateMemorySchema.parse(args || {});
          result = arbokUpdateMemory(validatedArgs);
          break;
        }

        case 'arbok:update_rules': {
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
