import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { initParsers } from '../core/parser.js';
import {
  arbokInit,
  arbokReindex,
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

const PLAN_MODE_META_INSTRUCTION = '\n\n[IMPORTANT INSTRUCTION]: If you executed this tool in Plan Mode, the task is NOT complete. You have only prepared the environment. You MUST now ask the user to switch to Act Mode to proceed with the actual implementation.';

const EXECUTE_PROPERTY = {
  execute: {
    type: 'boolean',
    description: "Set to true ONLY in Act Mode to perform the actual operation. Defaults to false (Dry Run/Preview).",
  },
} as const;

function dryRunResponse(_toolName: string): string {
  return "Preview Mode: To perform this action, please SWITCH TO ACT MODE and run this tool again with 'execute: true'.";
}

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
        // unified init tool
        {
          name: 'arbok:init',
          description: 'Unified project initialization. Sets up the project index (.arbok/), Memory Bank (memory-bank/), and Cline rules (.clinerules/) in one go. Smart and idempotent: only creates what is missing, skips what already exists.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to the project directory. REQUIRED.',
              },
              ...EXECUTE_PROPERTY,
            },
            required: ['projectPath'],
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
                description: 'Absolute path to the project directory. REQUIRED.',
              },
              ...EXECUTE_PROPERTY,
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'arbok:update_memory_bank',
          description: 'Update Memory Bank files with current project structure, components, and dependencies. If the memory-bank directory and basic files do not exist, they are created and initialized. If they already exist, they are updated with the current project state.',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Absolute path to the project directory. REQUIRED.',
              },
              memoryBankPath: {
                type: 'string',
                description: 'Path to memory bank directory (optional, defaults to memory-bank/)',
              },
              ...EXECUTE_PROPERTY,
            },
            required: ['projectPath'],
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
                description: 'Absolute path to the project directory. REQUIRED.',
              },
              ...EXECUTE_PROPERTY,
            },
            required: ['projectPath'],
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
        // unified init
        case 'arbok:init': {
          const validatedArgs = ArbokInitSchema.parse(args || {});
          result = await arbokInit(validatedArgs);
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
          if (!validatedArgs.execute) {
            result = dryRunResponse(name);
            break;
          }
          result = await arbokReindex(validatedArgs);
          break;
        }

        case 'arbok:update_memory_bank': {
          const validatedArgs = ArbokUpdateMemorySchema.parse(args || {});
          if (!validatedArgs.execute) {
            result = dryRunResponse(name);
            break;
          }
          result = arbokUpdateMemory(validatedArgs);
          break;
        }

        case 'arbok:update_rules': {
          const validatedArgs = ArbokSetupRulesSchema.parse(args || {});
          if (!validatedArgs.execute) {
            result = dryRunResponse(name);
            break;
          }
          result = arbokSetupRules(validatedArgs);
          break;
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      const executedInActMode = args && typeof args === 'object' && 'execute' in args && args.execute === true;
      if ((name.startsWith('arbok:init') || name.startsWith('arbok:update')) && !executedInActMode) {
        result += PLAN_MODE_META_INSTRUCTION;
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
