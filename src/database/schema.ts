/**
 * Database schema definitions for Arbok
 */

export const createTablesSQL = `
-- Nodes table: stores code structure elements
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('function', 'class', 'variable', 'interface', 'method', 'type_alias', 'enum')),
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  signature TEXT,
  doc_comment TEXT,
  exported INTEGER DEFAULT 0 CHECK(exported IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Edges table: stores relationships between nodes
CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  relation TEXT NOT NULL CHECK(relation IN ('imports', 'calls', 'extends', 'implements')),
  FOREIGN KEY (source_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_nodes_file ON nodes(file_path);
CREATE INDEX IF NOT EXISTS idx_nodes_name ON nodes(name);
CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_node_id);
CREATE INDEX IF NOT EXISTS idx_edges_relation ON edges(relation);
`;

export const dropTablesSQL = `
DROP INDEX IF EXISTS idx_edges_relation;
DROP INDEX IF EXISTS idx_edges_target;
DROP INDEX IF EXISTS idx_edges_source;
DROP INDEX IF EXISTS idx_nodes_kind;
DROP INDEX IF EXISTS idx_nodes_name;
DROP INDEX IF EXISTS idx_nodes_file;
DROP TABLE IF EXISTS edges;
DROP TABLE IF EXISTS nodes;
`;
