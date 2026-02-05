import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

async function main() {
  console.error("Arbok MCP Server starting...");

  const server = new McpServer({
    name: "arbok",
    version: "0.1.0",
  });

  // テスト用ツール
  server.tool(
    "ping",
    "サーバーの動作確認",
    {},
    async () => {
      return {
        content: [{ type: "text", text: "pong" }],
      };
    }
  );

  // stdio で通信開始
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("Arbok MCP Server running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});