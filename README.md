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

### 1. `arbok_update_index`

Initialize or re-index the project.

```json
{
  "projectPath": "/workspace"  // optional
}
```

### 2. `arbok_get_file_structure`

Get the structure of a specific file (symbols without source code).

```json
{
  "filePath": "src/index.ts"
}
```

### 3. `arbok_list_symbols`

List symbols matching a name across the entire project.

```json
{
  "query": "hello",
  "kind": "function"  // optional: function, class, interface, etc.
}
```

### 4. `arbok_get_dependencies`

Get dependency relationships for a file or symbol.

```json
{
  "filePath": "src/index.ts",  // optional
  "symbolName": "hello"        // optional
}
```

### 5. `arbok_update_memory_bank`

Update Memory Bank files with project structure and documentation. Creates the memory-bank directory if missing, or updates existing files.

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

### 6. `arbok_update_rules`

Update .clinerules configuration files for Cline integration. Creates config files if missing, or updates existing ones.

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
- **`src/observer/`**: File system watcher
- **`src/mcp/`**: MCP server and tool implementations

## Supported Languages

- TypeScript (`.ts`, `.tsx`)
- JavaScript (`.js`, `.jsx`)
- Python (`.py`)

## License

MIT
