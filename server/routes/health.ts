import { existsSync, statSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { Router } from 'express';

const router = Router();

const startedAt = Date.now();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..', '..');

function docPresent(name: string): boolean {
  try {
    const p = resolve(PROJECT_ROOT, name);
    return existsSync(p) && statSync(p).size > 0;
  } catch {
    return false;
  }
}

router.get('/', (_req, res) => {
  res.json({
    status: 'healthy',
    version: process.env.npm_package_version ?? '0.1.0',
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    services: {
      analysis: process.env.OPENAI_API_KEY
        ? 'connected'
        : 'not_configured',
    },
    config: {
      skillsDocLoaded: docPresent('SKILLS.md'),
      examplesDocLoaded: docPresent('EXAMPLES.md'),
    },
  });
});

export default router;
