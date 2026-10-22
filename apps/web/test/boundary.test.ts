import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDir = path.resolve(__dirname, '..');

describe('apps/web - Architecture and client boundaries', () => {
  it('ensures bootstrap.ts is protected with server-only import', () => {
    const bootstrapPath = path.join(webDir, 'src', 'server', 'bootstrap.ts');
    const content = fs.readFileSync(bootstrapPath, 'utf-8');

    expect(content).toContain("import 'server-only';");
  });

  it('ensures no API routes exist under apps/web/app', () => {
    const apiRouteDir = path.join(webDir, 'app', 'api');
    expect(fs.existsSync(apiRouteDir)).toBe(false);
  });

  it('ensures no client components import config package or server bootstrap', () => {
    function checkDir(dir: string): void {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          checkDir(fullPath);
        } else if (entry.isFile() && /\.(tsx|jsx|ts|js)$/.test(entry.name)) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const isClientComponent =
            content.includes("'use client'") || content.includes('"use client"');

          if (isClientComponent) {
            expect(content).not.toContain('@affiliate-content-os/config');
            expect(content).not.toContain('bootstrapWebServer');
            expect(content).not.toContain('process.env');
          }
        }
      }
    }

    checkDir(path.join(webDir, 'app'));
    checkDir(path.join(webDir, 'src'));
  });
});
