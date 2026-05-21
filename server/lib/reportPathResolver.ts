import { execFile } from 'child_process';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { resolve, sep } from 'path';
import { promisify } from 'util';
import { validateInputDirectory } from './rawInventory.js';

const execFileAsync = promisify(execFile);

interface GitReportPath {
  repoUrl: string;
  ref?: string;
  folderPath: string;
}

export interface ResolvedReportPath {
  kind: 'local' | 'git';
  inputLabel: string;
  directory: string;
  cleanup: () => Promise<void>;
}

function parseFragment(fragment: string | undefined): { ref?: string; folderPath?: string } {
  if (!fragment) return {};
  const decoded = decodeURIComponent(fragment.replace(/^#/, '').trim());
  if (!decoded) return {};

  if (decoded.includes('=')) {
    const params = new URLSearchParams(decoded);
    return {
      ref: params.get('ref') ?? params.get('branch') ?? undefined,
      folderPath: params.get('path') ?? params.get('folder') ?? params.get('dir') ?? undefined,
    };
  }

  const colon = decoded.indexOf(':');
  if (colon > 0) {
    return {
      ref: decoded.slice(0, colon),
      folderPath: decoded.slice(colon + 1),
    };
  }

  return { ref: decoded };
}

function parseGitHubTreeUrl(input: string): GitReportPath | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(url.protocol)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const treeIndex = parts.indexOf('tree');
  if (parts.length < 4 || treeIndex !== 2) return null;

  const [owner, repo] = parts;
  const ref = parts[treeIndex + 1];
  const folderPath = parts.slice(treeIndex + 2).join('/') || '.';
  return {
    repoUrl: `${url.origin}/${owner}/${repo.replace(/\.git$/, '')}.git`,
    ref,
    folderPath,
  };
}

function parseGitRemotePath(input: string): GitReportPath | null {
  const trimmed = input.trim();
  const generic = /^(?<repo>(?:https?|ssh|git):\/\/.+?\.git)(?:\/\/(?<folder>[^#]+))?(?:#(?<fragment>.+))?$/.exec(trimmed);
  const ssh = /^(?<repo>git@[^#]+?\.git)(?:\/\/(?<folder>[^#]+))?(?:#(?<fragment>.+))?$/.exec(trimmed);
  const match = generic ?? ssh;
  if (!match?.groups?.repo) return parseGitHubTreeUrl(trimmed);

  const fragment = parseFragment(match.groups.fragment);
  return {
    repoUrl: match.groups.repo,
    ref: fragment.ref,
    folderPath: fragment.folderPath ?? match.groups.folder ?? '.',
  };
}

function assertInside(parent: string, child: string): void {
  const normalizedParent = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  if (child !== parent && !child.startsWith(normalizedParent)) {
    throw new Error('Git folder path escapes the cloned repository.');
  }
}

async function runGit(args: string[], cwd?: string): Promise<void> {
  try {
    await execFileAsync('git', args, {
      cwd,
      timeout: 120000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Git command failed. Confirm Git is installed and the repository is accessible. ${message}`);
  }
}

async function resolveGitReportPath(input: string, spec: GitReportPath): Promise<ResolvedReportPath> {
  const tempRoot = await mkdtemp(resolve(tmpdir(), 'report-rationalizer-'));
  const checkoutDir = resolve(tempRoot, 'repo');

  try {
    const cloneArgs = ['clone', '--depth', '1'];
    if (spec.ref) cloneArgs.push('--branch', spec.ref, '--single-branch');
    cloneArgs.push(spec.repoUrl, checkoutDir);
    await runGit(cloneArgs);

    const requestedFolder = resolve(checkoutDir, spec.folderPath || '.');
    assertInside(checkoutDir, requestedFolder);
    const directory = await validateInputDirectory(requestedFolder);

    return {
      kind: 'git',
      inputLabel: input,
      directory,
      cleanup: () => rm(tempRoot, { recursive: true, force: true }),
    };
  } catch (err) {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}

export async function resolveReportPath(input: string): Promise<ResolvedReportPath> {
  const gitSpec = parseGitRemotePath(input);
  if (gitSpec) return resolveGitReportPath(input, gitSpec);

  const directory = await validateInputDirectory(input);
  return {
    kind: 'local',
    inputLabel: input,
    directory,
    cleanup: async () => undefined,
  };
}
