# Arbok MCP Server

AST-based code analysis MCP server that reduces token consumption by providing lightweight code-structure queries instead of reading entire files.

## Why Arbok?

Cline (or other LLM-backed agents) often read whole files which is expensive. Arbok reduces that cost by:

1. **AST Index**: Indexes symbols (functions, classes, interfaces) so tools can request concise summaries instead of full files.
2. **Memory Bank**: Lightweight, generated documentation that captures project purpose, active context, and structure.
3. **Auto-setup**: Generates and updates `.clinerules` and helper files to integrate with Cline workflows.
4. **Real-time sync**: A file watcher keeps the index and Memory Bank in sync with code changes.

## Features

- **AST Parsing**: Uses Tree-sitter (via `web-tree-sitter`) to parse TypeScript/JavaScript and Python.
- **Symbol Indexing**: Extracts and indexes functions, classes, interfaces, methods, and other top-level symbols into an SQLite database (`.arbok/index.db`).
- **Dependency Tracking**: Resolves imports and class/interface relationships (extends/implements) as edges in the index.
- **Real-time Updates**: Starts a file watcher after indexing to keep the project index current.
- **Memory Bank**: Generates a small set of Markdown documents under `memory-bank/` that summarize project purpose, active context, and structure.
- **MCP/CLI Integration**: Exposes a set of MCP tools (STDIO-based Server) for automated workflows and integration with Cline.

## Quick Start with Cline or other MCP clients

1. Add Arbok as an MCP server in your MCP client (Arbok runs over STDIO by default).
2. Call the `arbok:init` tool with your `projectPath`.
3. Workflow: Run in Plan Mode (default) to preview; in Act Mode (`execute: true`) Arbok will:
  - Create or refresh the index at `.arbok/index.db`.
  - Generate `memory-bank/` Markdown files.
  - Create/update `.clinerules/` files to guide agents.
4. Use `arbok:get_file_structure`, `arbok:get_symbols` and `arbok:get_dependencies` to query the index instead of reading full files.

## Automated Workflow & Best Practices

### Plan Mode vs Act Mode

Most tools support two modes:
- **Plan Mode** (default): Dry-run / preview. Useful to discover what will be created or changed.
- **Act Mode** (`execute: true`): Performs the actual writes (index, memory bank, rules).

Use Plan Mode to confirm before making changes; Act Mode to apply them.

### When to run manually

You only need to run `arbok:update_index` or `arbok:update_memory_bank` manually if the codebase was changed outside your MCP-driven workflow (e.g., manual edits, `git checkout`, large merges).

## Requirements

- Node.js >= 22.0.0

## Installation

```bash
npm install
npm run build        # TypeScript build (outputs to dist/)
npm run build:wasm   # Build Tree-sitter WASM grammars (requires tree-sitter CLI and grammars)
```

### Build WASM grammars (detailed)

Arbok requires Tree-sitter WASM grammars for the TypeScript and Python parsers. The project includes npm scripts that invoke the `tree-sitter` CLI:

- `npm run build:wasm` — runs both `build:wasm:ts` and `build:wasm:py` (see `package.json`).

Prerequisites:

- Ensure the `tree-sitter` CLI is available. Either install it globally:

```bash
npm install -g tree-sitter-cli
```

or use `npx` to run the locally installed CLI without global install.

Typical build steps:

```bash
# Install dependencies
npm install

# Build TypeScript source
npm run build

# Build both WASM grammars (preferred)
npm run build:wasm

# Alternative: run the individual build commands (using npx if you did not install tree-sitter globally)
npx tree-sitter build --wasm node_modules/tree-sitter-typescript/typescript -o resources/tree-sitter-typescript.wasm
npx tree-sitter build --wasm node_modules/tree-sitter-python -o resources/tree-sitter-python.wasm
```

Output:

- `resources/tree-sitter-typescript.wasm`
- `resources/tree-sitter-python.wasm`

Notes:

- If the `tree-sitter` command is not found after installing globally, ensure your npm global bin directory is on `PATH` or use `npx` as shown above.
- Building the grammars requires a working Node.js toolchain; on macOS you may need to install Xcode Command Line Tools (`xcode-select --install`) if compilation errors occur.

## Usage

### Development

```bash
npm run dev    # Runs src/index.ts via tsx in watch mode
```

### Production

```bash
npm run build
npm start      # Runs dist/index.js
```

### Docker

```bash
docker-compose up
```

## MCP Tools (exposed by the STDIO MCP server)

Arbok exposes a set of tools for discovery and updates. All tools support Plan Mode (dry run) and Act Mode (`execute: true`) where applicable.

- `arbok:init` — Unified initialization: prepares `.arbok/` (index), `memory-bank/`, and `.clinerules/`.
- `arbok:get_file_structure` — List symbols in a single file (no source code included).
- `arbok:get_symbols` — Search symbols across the indexed project (supports partial matching and kind filters).
- `arbok:get_dependencies` — Query dependency relations (imports, extends, implements) for a file or symbol.
- `arbok:update_index` — (Re)index the project and start the file watcher.
- `arbok:update_memory_bank` — Generate/update the set of Memory Bank Markdown files.
- `arbok:update_rules` — Create/update `.clinerules/` and workflows for integration.

Memory Bank generated files (6): `productContext.md`, `activeContext.md`, `progress.md`, `systemPatterns.md`, `techContext.md`, `project-structure.md`.

## Configuration

You can set `PROJECT_PATH` as an environment variable for local development. Many tools accept a `projectPath` argument so they can be run against an arbitrary project.

Example `.env`:

```env
PROJECT_PATH=/path/to/project
DEBUG_SQL=false
```

## Database

Indexed symbols and relationships are stored in SQLite at `.arbok/index.db` inside the target project directory.

## Architecture

- `src/config.ts`: Configuration management
- `src/types/`: TypeScript type definitions
- `src/database/`: SQLite connection and queries
- `src/core/`: AST parsing and node/edge extraction (Tree-sitter parsers)
- `src/watcher/`: File system watcher
- `src/mcp/`: MCP server and tool implementations (STDIO transport)

## Supported Languages

Fully supported (with AST parsing): TypeScript (`.ts`, `.tsx`), JavaScript (`.js`, `.jsx`), Python (`.py`).

Scanned (file-tree only) / planned: Go (`.go`), Rust (`.rs`).

## License

MIT
