# Arbok MCP Server

AST-based code analysis MCP server that reduces token consumption by providing lightweight code structure queries instead of reading entire files.

## Features

- **AST Parsing**: Uses tree-sitter to parse TypeScript, JavaScript, and Python files
- **Symbol Indexing**: Extracts and indexes functions, classes, interfaces, methods, and more
- **Dependency Tracking**: Resolves imports, extends, and implements relationships
- **Real-time Updates**: File system watcher keeps the index up-to-date
- **Memory Bank**: Generates documentation files summarizing project structure

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

### 1. `arbok_init`

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

### 3. `arbok_search_symbol`

Search for symbols by name across the entire project.

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

### 5. `arbok_update_memory`

Generate Memory Bank files with project structure and documentation.

```json
{
  "memoryBankPath": "memory-bank"  // optional
}
```

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
