import { runMcpServer } from '../mcp/server.js';

export async function handleMcp(options = {}) {
  // Stdout is used strictly for MCP JSON-RPC protocol messages.
  // Diagnostic logs should go to stderr.
  process.stderr.write('Starting Google Flow MCP server (stdio transport)...\n');
  await runMcpServer(options);
}
