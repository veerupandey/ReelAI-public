/**
 * MCP Client — browser-side client for the MCP management endpoints
 * on the agent shell server (localhost:3721).
 *
 * The shell server manages stdio/HTTP MCP connections and exposes them
 * over a simple REST API so the browser agent can discover and call tools
 * from any MCP server without needing Node.js subprocess access.
 */

import { SHELL_SERVER } from './shellToolService';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface McpInputSchema {
  type: 'object';
  properties: Record<string, {
    type: string;
    description?: string;
    enum?: string[];
    items?: McpInputSchema;
    default?: unknown;
  }>;
  required?: string[];
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: McpInputSchema;
  serverName: string;
}

export type McpContentType = 'text' | 'image' | 'resource';

export interface McpContent {
  type: McpContentType;
  text?: string;
  data?: string;       // base64, for images
  mimeType?: string;
  uri?: string;        // for resources
}

export interface McpToolResult {
  content: McpContent[];
  isError: boolean;
}

export interface McpServerInfo {
  name: string;
  status: 'connecting' | 'connected' | 'error';
  toolCount: number;
  tools: Array<{ name: string; description: string }>;
  error?: string;
  connectedAt?: string;
}

export interface McpConnectConfig {
  command?: string;            // stdio: executable name
  args?: string[];             // stdio: arguments
  url?: string;                // HTTP: server URL
  env?: Record<string, string>;
  description?: string;
  optional?: boolean;
}

// ── API ───────────────────────────────────────────────────────────────────────

/** List all MCP servers known to the shell server and their connection status. */
export const listMcpServers = async (): Promise<McpServerInfo[]> => {
  try {
    const res = await fetch(`${SHELL_SERVER}/mcp/servers`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json() as { servers: McpServerInfo[] };
    return data.servers ?? [];
  } catch {
    return [];
  }
};

/** List all tools from all currently connected MCP servers (flat, namespaced with serverName). */
export const listMcpTools = async (): Promise<McpTool[]> => {
  try {
    const res = await fetch(`${SHELL_SERVER}/mcp/tools`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json() as { tools: McpTool[] };
    return data.tools ?? [];
  } catch {
    return [];
  }
};

/**
 * Call a tool on a specific MCP server.
 *
 * @param serverName - The server name as configured in mcp.config.json
 * @param toolName   - The tool name as reported by tools/list
 * @param args       - Arguments matching the tool's inputSchema
 */
export const callMcpTool = async (
  serverName: string,
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<McpToolResult> => {
  const res = await fetch(`${SHELL_SERVER}/mcp/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverName, toolName, args }),
  });
  const data = await res.json() as McpToolResult;
  return data;
};

/**
 * Connect a new MCP server at runtime (without restarting the shell server).
 * Useful for user-added servers from the AgentConsole UI.
 */
export const connectMcpServer = async (
  serverName: string,
  config: McpConnectConfig,
): Promise<{ ok: boolean; toolCount?: number; error?: string }> => {
  const res = await fetch(`${SHELL_SERVER}/mcp/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverName, config }),
  });
  return res.json() as Promise<{ ok: boolean; toolCount?: number; error?: string }>;
};

/** Extract plain text from MCP content array. */
export const mcpContentToText = (content: McpContent[]): string =>
  content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n')
    .trim();
