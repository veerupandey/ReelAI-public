/**
 * General Agent Tool Suite
 *
 * A comprehensive set of capabilities available to General Agent workers:
 *   - web_fetch: Read any URL as clean markdown
 *   - web_search: Search the web for current information
 *   - image_gen: Generate images via Gemini Flash Image
 *   - code_sandbox: Run Python/JS in a sandboxed session
 *   - file_read: Read files from session workspace
 *   - file_write: Write/save files to session workspace
 *   - pdf_read: Extract text from PDF URLs
 *   - screenshot: Capture webpage screenshots
 *   - memory: Persist key-value facts across workers
 *   - todo: Track tasks and deliverables
 *   - data_transform: Parse/transform structured data (CSV, JSON)
 *   - browser: Navigate and interact with web pages
 */

import { generateImageAsset } from './geminiService';
import type { ImageGenerationRequest } from '../types';

const SHELL_SERVER = 'http://127.0.0.1:3721';
const JINA_PROXY = 'https://r.jina.ai';


// ═══════════════════════════════════════════════════════════════════════════════
// WEB FETCH — Read any URL as markdown via Jina reader proxy
// ═══════════════════════════════════════════════════════════════════════════════

export interface WebFetchResult {
  ok: boolean;
  url: string;
  markdown: string;
  title?: string;
  error?: string;
}

export async function fetchUrlAsMarkdown(url: string): Promise<WebFetchResult> {
  const normalized = url.trim().replace(/^(?!https?:\/\/)/, 'https://');
  try {
    const resp = await fetch(`${JINA_PROXY}/${normalized}`, {
      headers: { Accept: 'text/markdown' },
      signal: AbortSignal.timeout(25000),
    });
    if (!resp.ok) return { ok: false, url: normalized, markdown: '', error: `HTTP ${resp.status}` };
    const markdown = await resp.text();
    const titleMatch = markdown.match(/^Title:\s*(.+)/m);
    return { ok: true, url: normalized, markdown: markdown.slice(0, 15000), title: titleMatch?.[1] };
  } catch (err: any) {
    return { ok: false, url: normalized, markdown: '', error: err?.message || 'fetch failed' };
  }
}

export function extractImageUrls(markdown: string): string[] {
  const matches = [...markdown.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
  return matches
    .map((m) => m[2])
    .filter((url) => /\.(jpg|jpeg|png|webp|avif)/i.test(url) || url.includes('/cdn/'))
    .slice(0, 10);
}


// ═══════════════════════════════════════════════════════════════════════════════
// WEB SEARCH — Search the internet for current information
// ═══════════════════════════════════════════════════════════════════════════════

export interface WebSearchResult {
  ok: boolean;
  query: string;
  results: Array<{ title: string; url: string; snippet: string }>;
  error?: string;
}

/**
 * Search the web using Gemini with Google Search grounding.
 * Falls back to DuckDuckGo via Jina reader if Gemini is unavailable.
 */
export async function searchWeb(query: string, maxResults = 5): Promise<WebSearchResult> {
  // Prefer Gemini grounded search
  try {
    const apiKey = getGeminiApiKey();
    if (apiKey) {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey });
      const res = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: [{ parts: [{ text: `Search and summarize the top results for: ${query}\n\nReturn a concise summary of key findings with source URLs.` }] }],
        config: { tools: [{ googleSearch: {} }] } as any,
      });
      const text = (res.candidates?.[0]?.content?.parts ?? [])
        .map((p: any) => p.text ?? '').join('').trim();
      // Extract grounding metadata if available
      const grounding = (res.candidates?.[0] as any)?.groundingMetadata;
      const chunks = grounding?.groundingChunks || grounding?.searchEntryPoint?.renderedContent ? [] : [];

      if (text) {
        const results: Array<{ title: string; url: string; snippet: string }> = [];
        // Try to parse grounding chunks for structured results
        if (grounding?.groundingChunks?.length) {
          for (const chunk of grounding.groundingChunks.slice(0, maxResults)) {
            results.push({
              title: chunk.web?.title || chunk.retrievedContext?.title || 'Result',
              url: chunk.web?.uri || chunk.retrievedContext?.uri || '',
              snippet: '',
            });
          }
        }
        // Always include the synthesized answer
        if (results.length === 0) {
          results.push({ title: `Search: ${query}`, url: '', snippet: text.slice(0, 2000) });
        } else {
          results.unshift({ title: 'Summary', url: '', snippet: text.slice(0, 1500) });
        }
        return { ok: true, query, results: results.slice(0, maxResults) };
      }
    }
  } catch {
    // Fall through to DuckDuckGo
  }

  // Fallback: DuckDuckGo HTML via Jina reader
  try {
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const resp = await fetch(`${JINA_PROXY}/${ddgUrl}`, {
      headers: { Accept: 'text/markdown' },
      signal: AbortSignal.timeout(15000),
    });
    if (resp.ok) {
      const md = await resp.text();
      const results: Array<{ title: string; url: string; snippet: string }> = [];
      const blocks = md.split(/\n(?=\[)/);
      for (const block of blocks) {
        const titleMatch = block.match(/\[([^\]]+)\]\(([^)]+)\)/);
        if (titleMatch && results.length < maxResults) {
          const snippet = block.replace(/\[.*?\]\(.*?\)/, '').replace(/\n/g, ' ').trim().slice(0, 300);
          if (snippet.length > 20) {
            results.push({ title: titleMatch[1], url: titleMatch[2], snippet });
          }
        }
      }
      if (results.length > 0) return { ok: true, query, results };
      return { ok: true, query, results: [{ title: `Search: ${query}`, url: '', snippet: md.slice(0, 2000) }] };
    }
    return { ok: false, query, results: [], error: `Search returned ${resp.status}` };
  } catch (err: any) {
    return { ok: false, query, results: [], error: err?.message || 'search failed' };
  }
}

function getGeminiApiKey(): string {
  return (
    (typeof import.meta !== 'undefined' && (import.meta.env?.VITE_API_KEY || import.meta.env?.GEMINI_API_KEY))
    || ''
  ).trim();
}


// ═══════════════════════════════════════════════════════════════════════════════
// CODE SANDBOX — Run Python or JavaScript in an isolated session
// ═══════════════════════════════════════════════════════════════════════════════

export interface CodeExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  artifacts?: string[];
  error?: string;
}

/**
 * Execute Python code in the shell server's sandboxed environment.
 * Code runs in session directory — can read/write files there.
 * Common libraries: json, csv, math, re, urllib, datetime, collections, itertools.
 */
export async function runPython(code: string, sessionDir?: string): Promise<CodeExecResult> {
  try {
    const resp = await fetch(`${SHELL_SERVER}/python`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, sessionDir: sessionDir || '/tmp/general-agent' }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) return { ok: false, stdout: '', stderr: '', exitCode: -1, error: `HTTP ${resp.status}` };
    const data = await resp.json();
    return {
      ok: data.exitCode === 0,
      stdout: data.stdout || '',
      stderr: data.stderr || '',
      exitCode: data.exitCode ?? -1,
      artifacts: data.artifacts,
    };
  } catch (err: any) {
    return { ok: false, stdout: '', stderr: '', exitCode: -1, error: err?.message || 'exec failed' };
  }
}

/**
 * Execute a shell command in the session directory.
 * Use for: file operations, data processing, simple scripts.
 * Blocked: network exfil, sudo, destructive ops outside session.
 */
export async function runShell(command: string, sessionDir?: string): Promise<CodeExecResult> {
  try {
    const resp = await fetch(`${SHELL_SERVER}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, sessionDir: sessionDir || '/tmp/general-agent' }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) return { ok: false, stdout: '', stderr: '', exitCode: -1, error: `HTTP ${resp.status}` };
    const data = await resp.json();
    return {
      ok: data.exitCode === 0,
      stdout: data.stdout || '',
      stderr: data.stderr || '',
      exitCode: data.exitCode ?? -1,
      artifacts: data.artifacts,
    };
  } catch (err: any) {
    return { ok: false, stdout: '', stderr: '', exitCode: -1, error: err?.message || 'exec failed' };
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// FILE READ / WRITE — Access session files
// ═══════════════════════════════════════════════════════════════════════════════

export interface FileResult {
  ok: boolean;
  path?: string;
  content?: string;
  error?: string;
}

/** Read a file from the session workspace via MCP filesystem. */
export async function readFile(filePath: string): Promise<FileResult> {
  try {
    const resp = await fetch(`${SHELL_SERVER}/mcp/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server: 'filesystem', tool: 'read_text_file', args: { path: filePath } }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    const data = await resp.json();
    const text = (data.content || []).map((c: any) => c.text || '').join('\n');
    return { ok: true, path: filePath, content: text };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'read failed' };
  }
}

/** Write content to a file in the session workspace. */
export async function writeFile(filePath: string, content: string): Promise<FileResult> {
  try {
    const resp = await fetch(`${SHELL_SERVER}/mcp/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server: 'filesystem', tool: 'write_file', args: { path: filePath, content } }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    return { ok: true, path: filePath };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'write failed' };
  }
}

/** List files in a directory. */
export async function listFiles(dirPath: string): Promise<{ ok: boolean; files?: string[]; error?: string }> {
  try {
    const resp = await fetch(`${SHELL_SERVER}/mcp/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server: 'filesystem', tool: 'list_directory', args: { path: dirPath } }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    const data = await resp.json();
    const text = (data.content || []).map((c: any) => c.text || '').join('\n');
    const files = text.split('\n').filter(Boolean);
    return { ok: true, files };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'list failed' };
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// PDF READ — Extract text from PDF URLs or local files
// ═══════════════════════════════════════════════════════════════════════════════

export interface PdfReadResult {
  ok: boolean;
  text: string;
  pages?: number;
  error?: string;
}

/**
 * Extract text from a PDF URL using Jina reader (handles PDFs natively)
 * or via python pdfplumber for local files.
 */
export async function readPdf(urlOrPath: string): Promise<PdfReadResult> {
  // If it's a URL, use Jina which handles PDFs
  if (urlOrPath.startsWith('http')) {
    const result = await fetchUrlAsMarkdown(urlOrPath);
    if (result.ok) return { ok: true, text: result.markdown };
    return { ok: false, text: '', error: result.error };
  }
  // Local file: use python with pdfplumber or PyPDF2
  const code = `
import subprocess, sys
try:
    import pdfplumber
except ImportError:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'pdfplumber', '-q'])
    import pdfplumber

with pdfplumber.open("${urlOrPath.replace(/"/g, '\\"')}") as pdf:
    pages = []
    for page in pdf.pages[:30]:  # Cap at 30 pages
        text = page.extract_text() or ''
        pages.append(text)
    print(f"PAGES:{len(pdf.pages)}")
    print("\\n---PAGE_BREAK---\\n".join(pages))
`;
  const result = await runPython(code);
  if (result.ok) {
    const pagesMatch = result.stdout.match(/^PAGES:(\d+)/m);
    const text = result.stdout.replace(/^PAGES:\d+\n?/, '');
    return { ok: true, text: text.slice(0, 50000), pages: pagesMatch ? parseInt(pagesMatch[1]) : undefined };
  }
  return { ok: false, text: '', error: result.stderr || result.error };
}


// ═══════════════════════════════════════════════════════════════════════════════
// SCREENSHOT — Capture webpage visuals
// ═══════════════════════════════════════════════════════════════════════════════

export interface ScreenshotResult {
  ok: boolean;
  base64?: string;
  error?: string;
}

/** Capture a screenshot of a URL via Playwright MCP. */
export async function captureScreenshot(url: string): Promise<ScreenshotResult> {
  try {
    // Navigate first
    const nav = await callMcpTool('playwright', 'browser_navigate', { url });
    if (!nav.ok) return { ok: false, error: nav.error };
    // Wait for page to settle
    await new Promise((r) => setTimeout(r, 2000));
    // Take screenshot
    const shot = await callMcpTool('playwright', 'browser_take_screenshot', {});
    if (!shot.ok) return { ok: false, error: shot.error };
    // The screenshot result may contain base64 image data
    return { ok: true, base64: shot.result };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'screenshot failed' };
  }
}

/** Capture the text content (accessibility tree) of a page. */
export async function capturePageContent(url: string): Promise<{ ok: boolean; content?: string; error?: string }> {
  try {
    const nav = await callMcpTool('playwright', 'browser_navigate', { url });
    if (!nav.ok) return { ok: false, error: nav.error };
    await new Promise((r) => setTimeout(r, 2000));
    const snap = await callMcpTool('playwright', 'browser_snapshot', {});
    return { ok: snap.ok, content: snap.result, error: snap.error };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'capture failed' };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATA TRANSFORM — Parse, filter, aggregate structured data
// ═══════════════════════════════════════════════════════════════════════════════

export interface DataTransformResult {
  ok: boolean;
  output: string;
  rowCount?: number;
  error?: string;
}

/**
 * Run a data transformation using Python.
 * Supports: CSV parsing, JSON manipulation, filtering, aggregation, formatting.
 */
export async function transformData(opts: {
  input: string;
  inputFormat: 'csv' | 'json' | 'text';
  operation: string; // natural language description of what to do
  outputFormat?: 'csv' | 'json' | 'markdown_table' | 'text';
  sessionDir?: string;
}): Promise<DataTransformResult> {
  const outputFormat = opts.outputFormat || 'markdown_table';
  const code = `
import json, csv, io, sys

input_data = """${opts.input.replace(/"""/g, '\\"\\"\\"').slice(0, 20000)}"""
input_format = "${opts.inputFormat}"
output_format = "${outputFormat}"

# Parse input
if input_format == 'csv':
    reader = csv.DictReader(io.StringIO(input_data))
    rows = list(reader)
elif input_format == 'json':
    rows = json.loads(input_data)
    if isinstance(rows, dict):
        rows = [rows]
else:
    rows = [{"text": line} for line in input_data.strip().split("\\n") if line.strip()]

print(f"ROWS:{len(rows)}")

# Output
if output_format == 'json':
    print(json.dumps(rows[:100], indent=2))
elif output_format == 'csv':
    if rows:
        w = csv.DictWriter(io.StringIO(), fieldnames=rows[0].keys())
        buf = io.StringIO()
        w = csv.DictWriter(buf, fieldnames=rows[0].keys())
        w.writeheader()
        w.writerows(rows[:100])
        print(buf.getvalue())
elif output_format == 'markdown_table':
    if rows:
        headers = list(rows[0].keys())
        print("| " + " | ".join(headers) + " |")
        print("| " + " | ".join(["---"] * len(headers)) + " |")
        for row in rows[:50]:
            print("| " + " | ".join(str(row.get(h, ""))[:60] for h in headers) + " |")
else:
    for row in rows[:100]:
        print(str(row))
`;
  const result = await runPython(code, opts.sessionDir);
  if (result.ok) {
    const rowMatch = result.stdout.match(/^ROWS:(\d+)/m);
    const output = result.stdout.replace(/^ROWS:\d+\n?/, '');
    return { ok: true, output, rowCount: rowMatch ? parseInt(rowMatch[1]) : undefined };
  }
  return { ok: false, output: '', error: result.stderr || result.error };
}


// ═══════════════════════════════════════════════════════════════════════════════
// IMAGE GENERATION — Gemini Flash Image
// ═══════════════════════════════════════════════════════════════════════════════

export interface ImageGenResult {
  ok: boolean;
  base64?: string;
  savedPath?: string;
  error?: string;
}

export async function generateImage(opts: {
  prompt: string;
  aspectRatio?: string;
  referenceImageBase64?: string;
  referenceImageMimeType?: string;
  allowedText?: string[];
  sessionDir?: string;
  fileName?: string;
}): Promise<ImageGenResult> {
  try {
    const request: ImageGenerationRequest = {
      mode: opts.referenceImageBase64 ? 'edit' : 'generate',
      imagePrompt: opts.prompt,
      aspectRatio: opts.aspectRatio || '1:1',
      skipPromptReview: true,
      allowedOnImageText: opts.allowedText,
    };
    if (opts.referenceImageBase64) {
      request.primaryReference = {
        data: opts.referenceImageBase64,
        mimeType: opts.referenceImageMimeType || 'image/png',
      };
    }
    const base64 = await generateImageAsset(request);
    let savedPath: string | undefined;
    if (opts.sessionDir && opts.fileName) {
      try {
        const saveResp = await fetch('/api/save-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session: opts.sessionDir.split('/').pop() || 'general',
            name: opts.fileName,
            base64,
            mimeType: 'image/png',
          }),
        });
        if (saveResp.ok) savedPath = (await saveResp.json()).path;
      } catch { /* non-fatal */ }
    }
    return { ok: true, base64, savedPath };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Image generation failed' };
  }
}

export async function downloadImageAsBase64(imageUrl: string): Promise<{
  ok: boolean; base64?: string; mimeType?: string; error?: string;
}> {
  try {
    const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    const contentType = resp.headers.get('content-type') || 'image/png';
    const buffer = await resp.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    return { ok: true, base64, mimeType: contentType };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'download failed' };
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// BROWSER — Navigate and interact with web pages via Playwright MCP
// ═══════════════════════════════════════════════════════════════════════════════

/** Generic MCP tool call via shell server. */
export async function callMcpTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; result?: string; error?: string }> {
  try {
    const resp = await fetch(`${SHELL_SERVER}/mcp/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server: serverName, tool: toolName, args }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) return { ok: false, error: `MCP call failed: ${resp.status}` };
    const data = await resp.json();
    const text = (data.content || [])
      .map((c: any) => c.text || c.url || '')
      .filter(Boolean)
      .join('\n');
    return { ok: true, result: text.slice(0, 10000) };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'MCP call failed' };
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// TOOL CATALOG — Unified list of all tools for the planner prompt
// ═══════════════════════════════════════════════════════════════════════════════

export interface ToolSpec {
  id: string;
  name: string;
  description: string;
  category: 'research' | 'code' | 'media' | 'data' | 'file' | 'memory';
  /** Roles that can use this tool automatically */
  autoForRoles: string[];
}

export const GENERAL_AGENT_TOOLS: ToolSpec[] = [
  {
    id: 'web_fetch',
    name: 'Web Fetch',
    description: 'Read any URL as clean markdown. Great for product pages, articles, docs.',
    category: 'research',
    autoForRoles: ['researcher', 'analyst', 'browser'],
  },
  {
    id: 'web_search',
    name: 'Web Search',
    description: 'Search the internet for current information, trends, competitors.',
    category: 'research',
    autoForRoles: ['researcher', 'analyst'],
  },
  {
    id: 'screenshot',
    name: 'Screenshot',
    description: 'Capture a webpage screenshot for visual reference (requires shell online).',
    category: 'research',
    autoForRoles: ['browser', 'designer'],
  },
  {
    id: 'browser',
    name: 'Browser',
    description: 'Navigate web pages, click, fill forms, extract content (requires shell online).',
    category: 'research',
    autoForRoles: ['browser'],
  },
  {
    id: 'code_python',
    name: 'Python Sandbox',
    description: 'Run Python scripts for calculations, data processing, file generation.',
    category: 'code',
    autoForRoles: ['engineer', 'analyst', 'data_scientist'],
  },
  {
    id: 'code_shell',
    name: 'Shell Command',
    description: 'Run shell commands (ffprobe, curl, jq, etc.) in session directory.',
    category: 'code',
    autoForRoles: ['engineer'],
  },
  {
    id: 'image_gen',
    name: 'Image Generation',
    description: 'Generate images from text prompts using Gemini Flash Image. Supports references.',
    category: 'media',
    autoForRoles: ['designer', 'creative'],
  },
  {
    id: 'pdf_read',
    name: 'PDF Reader',
    description: 'Extract text from PDF URLs or local files.',
    category: 'data',
    autoForRoles: ['researcher', 'analyst'],
  },
  {
    id: 'data_transform',
    name: 'Data Transform',
    description: 'Parse and transform CSV/JSON data. Filter, aggregate, reformat.',
    category: 'data',
    autoForRoles: ['analyst', 'data_scientist', 'engineer'],
  },
  {
    id: 'file_read',
    name: 'File Read',
    description: 'Read files from the session workspace.',
    category: 'file',
    autoForRoles: ['engineer', 'analyst', 'writer'],
  },
  {
    id: 'file_write',
    name: 'File Write',
    description: 'Save files to the session workspace (reports, scripts, data).',
    category: 'file',
    autoForRoles: ['engineer', 'writer', 'designer'],
  },
  {
    id: 'memory',
    name: 'Shared Memory',
    description: 'Store and retrieve key facts shared across all workers in this run.',
    category: 'memory',
    autoForRoles: ['researcher', 'analyst', 'writer'],
  },
  {
    id: 'todo',
    name: 'Task Tracker',
    description: 'Create, assign, and complete tasks. Tracks deliverables across workers.',
    category: 'memory',
    autoForRoles: ['writer', 'analyst', 'engineer'],
  },
];

/** Get tools available for a specific worker role. */
export function getToolsForRole(role: string): ToolSpec[] {
  return GENERAL_AGENT_TOOLS.filter((t) => t.autoForRoles.includes(role));
}

/** Format the tool catalog for the planner prompt. */
export function formatToolCatalogForPlanner(shellOnline: boolean): string {
  const available = shellOnline
    ? GENERAL_AGENT_TOOLS
    : GENERAL_AGENT_TOOLS.filter((t) => !['screenshot', 'browser', 'code_python', 'code_shell'].includes(t.id));

  const lines = available.map((t) => `- **${t.id}** (${t.name}): ${t.description} [auto for: ${t.autoForRoles.join(', ')}]`);
  return `AVAILABLE TOOLS:\n${lines.join('\n')}`;
}
