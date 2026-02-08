import { getDatabase } from './connection.js';
import type { Node, Edge, NodeKind, EdgeRelation } from '../types/index.js';

/**
 * Insert a node into the database
 */
export function insertNode(node: Omit<Node, 'updated_at'>): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO nodes (id, file_path, name, kind, start_line, end_line, signature, doc_comment, exported)
    VALUES (@id, @file_path, @name, @kind, @start_line, @end_line, @signature, @doc_comment, @exported)
  `);
  
  stmt.run({
    id: node.id,
    file_path: node.file_path,
    name: node.name,
    kind: node.kind,
    start_line: node.start_line,
    end_line: node.end_line,
    signature: node.signature,
    doc_comment: node.doc_comment,
    exported: node.exported ? 1 : 0,
  });
}

/**
 * Insert multiple nodes in a transaction
 */
export function insertNodes(nodes: Omit<Node, 'updated_at'>[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO nodes (id, file_path, name, kind, start_line, end_line, signature, doc_comment, exported)
    VALUES (@id, @file_path, @name, @kind, @start_line, @end_line, @signature, @doc_comment, @exported)
  `);
  
  const insertMany = db.transaction((nodes: Omit<Node, 'updated_at'>[]) => {
    for (const node of nodes) {
      stmt.run({
        id: node.id,
        file_path: node.file_path,
        name: node.name,
        kind: node.kind,
        start_line: node.start_line,
        end_line: node.end_line,
        signature: node.signature,
        doc_comment: node.doc_comment,
        exported: node.exported ? 1 : 0,
      });
    }
  });
  
  insertMany(nodes);
}

/**
 * Get all nodes for a specific file
 */
export function getNodesByFile(filePath: string): Node[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT id, file_path, name, kind, start_line, end_line, signature, doc_comment, exported, updated_at
    FROM nodes
    WHERE file_path = ?
    ORDER BY start_line ASC
  `);
  
  const rows = stmt.all(filePath) as any[];
  return rows.map(row => ({
    ...row,
    exported: row.exported === 1,
  }));
}

/**
 * Search nodes by name (LIKE query)
 */
export function searchNodes(query: string, kind?: NodeKind): Node[] {
  const db = getDatabase();
  
  let sql = `
    SELECT id, file_path, name, kind, start_line, end_line, signature, doc_comment, exported, updated_at
    FROM nodes
    WHERE name LIKE ?
  `;
  
  const params: any[] = [`%${query}%`];
  
  if (kind) {
    sql += ` AND kind = ?`;
    params.push(kind);
  }
  
  sql += ` ORDER BY name ASC LIMIT 100`;
  
  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as any[];
  
  return rows.map(row => ({
    ...row,
    exported: row.exported === 1,
  }));
}

/**
 * Get a node by ID
 */
export function getNodeById(id: string): Node | null {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT id, file_path, name, kind, start_line, end_line, signature, doc_comment, exported, updated_at
    FROM nodes
    WHERE id = ?
  `);
  
  const row = stmt.get(id) as any;
  if (!row) return null;
  
  return {
    ...row,
    exported: row.exported === 1,
  };
}

/**
 * Delete all nodes for a specific file
 */
export function deleteNodesByFile(filePath: string): void {
  const db = getDatabase();
  const stmt = db.prepare('DELETE FROM nodes WHERE file_path = ?');
  stmt.run(filePath);
}

/**
 * Get all nodes in the database
 */
export function getAllNodes(): Node[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT id, file_path, name, kind, start_line, end_line, signature, doc_comment, exported, updated_at
    FROM nodes
    ORDER BY file_path, start_line
  `);
  
  const rows = stmt.all() as any[];
  return rows.map(row => ({
    ...row,
    exported: row.exported === 1,
  }));
}

/**
 * Insert an edge into the database
 */
export function insertEdge(edge: Edge): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO edges (id, source_node_id, target_node_id, relation)
    VALUES (@id, @source_node_id, @target_node_id, @relation)
  `);
  
  stmt.run(edge);
}

/**
 * Insert multiple edges in a transaction
 */
export function insertEdges(edges: Edge[]): void {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO edges (id, source_node_id, target_node_id, relation)
    VALUES (@id, @source_node_id, @target_node_id, @relation)
  `);
  
  const insertMany = db.transaction((edges: Edge[]) => {
    for (const edge of edges) {
      stmt.run(edge);
    }
  });
  
  insertMany(edges);
}

/**
 * Get edges by source node ID
 */
export function getEdgesBySource(sourceNodeId: string): Edge[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT id, source_node_id, target_node_id, relation
    FROM edges
    WHERE source_node_id = ?
  `);
  
  return stmt.all(sourceNodeId) as Edge[];
}

/**
 * Get edges by target node ID
 */
export function getEdgesByTarget(targetNodeId: string): Edge[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT id, source_node_id, target_node_id, relation
    FROM edges
    WHERE target_node_id = ?
  `);
  
  return stmt.all(targetNodeId) as Edge[];
}

/**
 * Get edges for nodes in a specific file
 */
export function getEdgesByFile(filePath: string): Edge[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT DISTINCT e.id, e.source_node_id, e.target_node_id, e.relation
    FROM edges e
    INNER JOIN nodes n ON e.source_node_id = n.id
    WHERE n.file_path = ?
  `);
  
  return stmt.all(filePath) as Edge[];
}

/**
 * Delete edges for nodes in a specific file
 */
export function deleteEdgesByFile(filePath: string): void {
  const db = getDatabase();
  // Delete edges where source is in the file
  const stmt1 = db.prepare(`
    DELETE FROM edges
    WHERE source_node_id IN (
      SELECT id FROM nodes WHERE file_path = ?
    )
  `);
  stmt1.run(filePath);
  
  // Delete edges where target is in the file
  const stmt2 = db.prepare(`
    DELETE FROM edges
    WHERE target_node_id IN (
      SELECT id FROM nodes WHERE file_path = ?
    )
  `);
  stmt2.run(filePath);
}

/**
 * Get total counts for statistics
 */
export function getCounts(): { nodes: number; edges: number; files: number } {
  const db = getDatabase();
  
  const nodesCount = db.prepare('SELECT COUNT(*) as count FROM nodes').get() as { count: number };
  const edgesCount = db.prepare('SELECT COUNT(*) as count FROM edges').get() as { count: number };
  const filesCount = db.prepare('SELECT COUNT(DISTINCT file_path) as count FROM nodes').get() as { count: number };
  
  return {
    nodes: nodesCount.count,
    edges: edgesCount.count,
    files: filesCount.count,
  };
}

/**
 * Clear all data from the database
 */
export function clearDatabase(): void {
  const db = getDatabase();
  db.exec('DELETE FROM edges');
  db.exec('DELETE FROM nodes');
}
