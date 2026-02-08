#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// サーバーの定義
const server = new Server(
  {
    name: "arbok",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ツール一覧の定義（Clineに「何ができるか」を教える）
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "index_project",
        description: "プロジェクトのインデックスを作成・更新します（テスト用）",
        inputSchema: {
          type: "object",
          properties: {
            force: {
              type: "boolean",
              description: "強制再スキャン",
            },
          },
        },
      },
    ],
  };
});

// ツールの実行処理（Clineから呼ばれたときの動き）
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "index_project") {
    // ★今はまだ何もしない。ログだけ出す。
    console.error("Arbok: index_project tool was called!"); 
    
    return {
      content: [
        {
          type: "text",
          text: "【成功】Arbokと接続できています！まだインデックス機能は空っぽですが、コマンドは届きました。",
        },
      ],
    };
  }
  throw new Error("Unknown tool");
});

// サーバー起動
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Arbok MCP Server running...");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});