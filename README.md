# Arbok MCP Server

AST-based code analysis MCP server that reduces token consumption by providing lightweight code structure queries instead of reading entire files.

## Why Arbok?

Cline is powerful but expensive — it reads entire source files to understand your codebase, consuming thousands of tokens per exploration. Arbok solves this by:

1. **AST Index**: Instead of reading 500-line files, Cline gets a 20-line summary of functions/classes/signatures
2. **Memory Bank**: Project context is pre-generated so Cline doesn't need to re-explore on every task  
3. **Auto-setup**: .clinerules are generated automatically to teach Cline to use Arbok
4. **Real-time sync**: File watcher keeps everything up-to-date as you code

## Features

- **AST Parsing**: Uses tree-sitter to parse TypeScript, JavaScript, and Python files
- **Symbol Indexing**: Extracts and indexes functions, classes, interfaces, methods, and more
- **Dependency Tracking**: Resolves imports, extends, and implements relationships
- **Real-time Updates**: File system watcher keeps the index up-to-date
- **Memory Bank**: Generates Cline-compliant documentation files summarizing project structure
- **Cline Integration**: Auto-generates .clinerules for optimal workflow

## Quick Start with Cline

1. Add Arbok as an MCP server in Cline settings
2. In Cline chat, say: "init arbok"  
3. Arbok will:
   - Scan your project and create an AST index (.arbok/index.db)
   - Generate Memory Bank files (memory-bank/)
   - Create .clinerules for optimal Cline integration
4. Start coding with dramatically reduced token consumption!

## Installation

```bash
npm install
npm run build
npm run build:wasm  # Build tree-sitter WASM grammars
```

## Usage

### Development

```bash
npm run dev
```

### Production

```bash
npm start
```

### Docker

```bash
docker-compose up
```

## MCP Tools

### Init Tools（初回セットアップ用）

#### `arbok:init_index`

Initialize the project index only if it does not already exist. If the index already exists, this tool does nothing and returns a message.

```json
{
  "projectPath": "/workspace"  // optional
}
```

#### `arbok:init_memory_bank`

Initialize Memory Bank files only if the memory-bank directory does not already exist. If it already exists, this tool does nothing and returns a message.

```json
{
  "memoryBankPath": "memory-bank"  // optional
}
```

#### `arbok:init_rules`

Initialize .clinerules configuration files only if the .clinerules directory does not already exist. If it already exists, this tool does nothing and returns a message.

```json
{
  "projectPath": "/workspace"  // optional
}
```

### Get Tools（情報取得用）

#### `arbok:get_file_structure`

Get the structure of a specific file. Returns symbols (functions, classes, etc.) with their metadata but WITHOUT source code.

```json
{
  "filePath": "src/index.ts"  // required
}
```

#### `arbok:get_symbols`

List symbols matching a name across the entire project. Supports partial matching.

```json
{
  "query": "hello",           // required
  "kind": "function"          // optional: function, class, variable, interface, method, type_alias, enum
}
```

#### `arbok:get_dependencies`

Get dependency relationships for a file or symbol. Returns imports, calls, extends, and implements relationships.

```json
{
  "filePath": "src/index.ts",  // optional
  "symbolName": "hello"        // optional
}
```

### Update Tools（更新用）

#### `arbok:update_index`

Initialize or re-index the project. Scans all source files, parses them with Tree-sitter, extracts nodes and edges, and starts file watcher. If the index already exists, it is refreshed.

```json
{
  "projectPath": "/workspace"  // optional
}
```

#### `arbok:update_memory_bank`

Update Memory Bank files with current project structure, components, and dependencies. If the memory-bank directory and basic files do not exist, they are created and initialized. If they already exist, they are updated with the current project state.

```json
{
  "memoryBankPath": "memory-bank"  // optional
}
```

Generates 6 Cline-compliant Memory Bank files:
- `productContext.md` — Project purpose and user experience goals
- `activeContext.md` — Current work focus and recent changes
- `progress.md` — What works, what's left, known issues
- `systemPatterns.md` — Architecture and design patterns
- `techContext.md` — Technologies, dependencies, and setup
- `project-structure.md` — File tree and symbol index

#### `arbok:update_rules`

Update .clinerules configuration files for Cline integration. If .clinerules or related config files do not exist, they are generated from scratch. If they already exist, they are updated with necessary changes.

```json
{
  "projectPath": "/workspace"  // optional
}
```

Creates:
- `.clinerules/rules.md` — Base rules for efficient file access
- `.clinerules/workflows/update_memory.md` — Memory Bank update workflow
- `.clinerules/workflows/init_arbok.md` — Initialization workflow

## Configuration

Set environment variables in `.env`:

```env
PROJECT_PATH=/workspace  # Path to your project
DEBUG_SQL=false          # Enable SQL query logging
```

## Database

The server uses SQLite to store indexed symbols and relationships. The database is stored in `.arbok/index.db` within your project directory.

## Architecture

- **`src/config.ts`**: Configuration management
- **`src/types/`**: TypeScript type definitions
- **`src/database/`**: SQLite connection and queries
- **`src/core/`**: AST parsing and node/edge extraction
- **`src/watcher/`**: File system watcher
- **`src/mcp/`**: MCP server and tool implementations

## Supported Languages

- TypeScript (`.ts`, `.tsx`)
- JavaScript (`.js`, `.jsx`)
- Python (`.py`)

## License

MIT
