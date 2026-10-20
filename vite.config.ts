import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev-only endpoint that saves generated images to disk under
 * generated-images/<session>/<name>.<ext>.
 */
function saveImagePlugin(): Plugin {
  return {
    name: 'save-image-to-disk',
    configureServer(server) {
      server.middlewares.use('/api/save-image', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method Not Allowed');
          return;
        }
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          try {
            const { session, name, base64, mimeType } = JSON.parse(body);
            if (!session || !name || !base64) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'session, name, and base64 are required' }));
              return;
            }
            const safeSession = String(session).replace(/[^a-zA-Z0-9_-]/g, '_');
            const safeName = String(name).replace(/[^a-zA-Z0-9_.-]/g, '_');
            const ext = mimeType === 'image/jpeg' ? '.jpg' : mimeType === 'image/webp' ? '.webp' : '.png';
            const dir = path.resolve(__dirname, 'generated-images', safeSession);
            fs.mkdirSync(dir, { recursive: true });
            const filePath = path.join(dir, safeName.endsWith(ext) ? safeName : `${safeName}${ext}`);
            fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ saved: true, path: filePath }));
          } catch (error) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'save failed' }));
          }
        });
      });
    },
  };
}

function safeProjectId(id: string): string {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'project';
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

/**
 * Dev-only named Studio project persistence under studio-projects/<id>/.
 * Full session (including base64 images) lives in project.json; meta.json is for listing.
 */
function studioProjectPlugin(): Plugin {
  return {
    name: 'studio-project-disk',
    configureServer(server) {
      const root = path.resolve(__dirname, 'studio-projects');

      const projectDir = (id: string) => path.join(root, safeProjectId(id));

      server.middlewares.use('/api/studio-project/list', async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'Method Not Allowed' });
          return;
        }
        try {
          fs.mkdirSync(root, { recursive: true });
          const entries = fs.readdirSync(root, { withFileTypes: true });
          const projects: Array<Record<string, unknown>> = [];
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const metaPath = path.join(root, entry.name, 'meta.json');
            const projectPath = path.join(root, entry.name, 'project.json');
            try {
              if (fs.existsSync(metaPath)) {
                projects.push(JSON.parse(fs.readFileSync(metaPath, 'utf8')));
              } else if (fs.existsSync(projectPath)) {
                const full = JSON.parse(fs.readFileSync(projectPath, 'utf8')) as {
                  id: string;
                  name: string;
                  createdAt: string;
                  updatedAt: string;
                  assetCount: number;
                  brandName?: string;
                };
                projects.push({
                  id: full.id,
                  name: full.name,
                  createdAt: full.createdAt,
                  updatedAt: full.updatedAt,
                  assetCount: full.assetCount,
                  brandName: full.brandName,
                });
              }
            } catch {
              // skip corrupt folders
            }
          }
          projects.sort((a, b) =>
            String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')),
          );
          sendJson(res, 200, { projects, disk: true });
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : 'list failed' });
        }
      });

      server.middlewares.use('/api/studio-project/load', async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'Method Not Allowed' });
          return;
        }
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const id = url.searchParams.get('id');
          if (!id) {
            sendJson(res, 400, { error: 'id is required' });
            return;
          }
          const projectPath = path.join(projectDir(id), 'project.json');
          if (!fs.existsSync(projectPath)) {
            sendJson(res, 404, { error: 'project not found' });
            return;
          }
          const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
          sendJson(res, 200, { project });
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : 'load failed' });
        }
      });

      server.middlewares.use('/api/studio-project/save', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method Not Allowed' });
          return;
        }
        try {
          const body = JSON.parse(await readRequestBody(req)) as {
            id?: string;
            name?: string;
            project?: Record<string, unknown>;
          };
          const project = body.project;
          if (!project || typeof project !== 'object' || !project.state) {
            sendJson(res, 400, { error: 'project with state is required' });
            return;
          }
          const id = safeProjectId(String(body.id || project.id || randomUUID()));
          const now = new Date().toISOString();
          const dir = projectDir(id);
          fs.mkdirSync(dir, { recursive: true });

          let createdAt = now;
          const existingMeta = path.join(dir, 'meta.json');
          if (fs.existsSync(existingMeta)) {
            try {
              const prev = JSON.parse(fs.readFileSync(existingMeta, 'utf8')) as { createdAt?: string };
              if (prev.createdAt) createdAt = prev.createdAt;
            } catch {
              // ignore
            }
          }

          const record = {
            ...project,
            id,
            name: String(body.name || project.name || 'Untitled project').trim() || 'Untitled project',
            createdAt: typeof project.createdAt === 'string' ? project.createdAt : createdAt,
            updatedAt: now,
            assetCount: typeof project.assetCount === 'number' ? project.assetCount : 0,
            brandName: typeof project.brandName === 'string' ? project.brandName : undefined,
          };

          const meta = {
            id: record.id,
            name: record.name,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            assetCount: record.assetCount,
            brandName: record.brandName,
          };

          fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(record));
          fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
          sendJson(res, 200, { saved: true, project: record, path: dir });
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : 'save failed' });
        }
      });

      server.middlewares.use('/api/studio-project', async (req, res, next) => {
        // Only handle DELETE on the exact base path (not /save /list /load which are above)
        const pathname = (req.url || '').split('?')[0];
        if (pathname !== '/' && pathname !== '') {
          next();
          return;
        }
        if (req.method !== 'DELETE') {
          sendJson(res, 405, { error: 'Method Not Allowed' });
          return;
        }
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const id = url.searchParams.get('id');
          if (!id) {
            sendJson(res, 400, { error: 'id is required' });
            return;
          }
          const dir = projectDir(id);
          if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
          }
          sendJson(res, 200, { deleted: true, id: safeProjectId(id) });
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : 'delete failed' });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        // Lightning Cloudspaces host for this studio (port 3000 ingress).
        allowedHosts: ['3000-01kj68yz3qans2kyt4p4mxrz9x.cloudspaces.litng.ai'],
        // Browser runs on the user's machine; 127.0.0.1:3721 is unreachable there.
        // Proxy shell through Vite so remote studios only need port 3000 exposed.
        proxy: {
          '/agent-shell': {
            target: 'http://127.0.0.1:3721',
            changeOrigin: true,
            rewrite: (p) => p.replace(/^\/agent-shell/, ''),
            timeout: 300_000,
            proxyTimeout: 300_000,
          },
        },
      },
      plugins: [react(), saveImagePlugin(), studioProjectPlugin()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
