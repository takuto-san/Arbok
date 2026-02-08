/**
 * Shared type definitions for Arbok MCP server
 */

export type NodeKind = 
  | 'function'
  | 'class'
  | 'variable'
  | 'interface'
  | 'method'
  | 'type_alias'
  | 'enum';

export type EdgeRelation = 
  | 'imports'
  | 'calls'
  | 'extends'
  | 'implements';

export interface Node {
  id: string;
  file_path: string;
  name: string;
  kind: NodeKind;
  start_line: number;
  end_line: number;
  signature: string | null;
  doc_comment: string | null;
  exported: boolean;
  updated_at: string;
}

export interface Edge {
  id: string;
  source_node_id: string;
  target_node_id: string;
  relation: EdgeRelation;
}

export interface Module {
  file_path: string;
  nodes: Node[];
}

export interface DependencyGraph {
  file_path?: string;
  symbol_name?: string;
  dependencies: {
    relation: EdgeRelation;
    target: {
      file_path: string;
      name: string;
      kind: NodeKind;
    };
  }[];
}

export interface IndexStats {
  files_indexed: number;
  nodes_created: number;
  edges_created: number;
}

export interface FileStructure {
  file_path: string;
  symbols: {
    kind: NodeKind;
    name: string;
    signature: string | null;
    start_line: number;
    end_line: number;
    exported: boolean;
  }[];
}

export interface SearchResult {
  file_path: string;
  kind: NodeKind;
  name: string;
  signature: string | null;
  start_line: number;
  end_line: number;
}
