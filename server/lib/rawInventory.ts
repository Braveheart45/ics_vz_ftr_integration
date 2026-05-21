import { readdir, readFile, stat } from 'fs/promises';
import { basename, extname, join, relative, resolve } from 'path';

const SKIP_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.vite',
]);

const TEXT_EXTENSIONS = new Set([
  '.sql',
  '.lkml',
  '.lookml',
  '.qvs',
  '.dax',
  '.m',
  '.json',
  '.yaml',
  '.yml',
  '.xml',
  '.csv',
  '.tsv',
  '.txt',
  '.md',
  '.ini',
  '.properties',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
]);

const MAX_FILES_PER_ESTATE = 400;
const MAX_CHARS_PER_FILE = 25000;
const MAX_TOTAL_CHARS = 900000;

export interface RawFileItem {
  path: string;
  name: string;
  extension: string;
  sizeBytes: number;
  isText: boolean;
  content: string | null;
  contentTruncated: boolean;
}

export async function validateInputDirectory(input: string): Promise<string> {
  const dir = resolve(input.trim());
  const s = await stat(dir).catch(() => null);
  if (!s?.isDirectory()) {
    throw new Error(`Path '${input}' is not a readable directory.`);
  }
  return dir;
}

function isTextFile(filePath: string): boolean {
  return TEXT_EXTENSIONS.has(extname(filePath).toLowerCase());
}

async function walkFiles(root: string, current: string, files: string[]): Promise<void> {
  if (files.length >= MAX_FILES_PER_ESTATE) return;

  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (files.length >= MAX_FILES_PER_ESTATE) return;
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) {
        await walkFiles(root, join(current, entry.name), files);
      }
      continue;
    }
    if (entry.isFile()) files.push(join(current, entry.name));
  }
}

export async function collectRawFiles(root: string): Promise<RawFileItem[]> {
  const directory = await validateInputDirectory(root);
  const paths: string[] = [];
  await walkFiles(directory, directory, paths);

  let remainingChars = MAX_TOTAL_CHARS;
  const rawFiles: RawFileItem[] = [];

  for (const filePath of paths.sort((a, b) => a.localeCompare(b))) {
    const s = await stat(filePath);
    const extension = extname(filePath).toLowerCase();
    const isText = isTextFile(filePath);
    let content: string | null = null;
    let contentTruncated = false;

    if (isText && remainingChars > 0) {
      const raw = await readFile(filePath, 'utf-8');
      const budget = Math.min(MAX_CHARS_PER_FILE, remainingChars);
      content = raw.length > budget ? raw.slice(0, budget) : raw;
      contentTruncated = raw.length > budget;
      remainingChars -= content.length;
    } else if (isText) {
      content = '';
      contentTruncated = true;
    }

    rawFiles.push({
      path: relative(directory, filePath).replace(/\\/g, '/'),
      name: basename(filePath),
      extension,
      sizeBytes: s.size,
      isText,
      content,
      contentTruncated,
    });
  }

  if (rawFiles.length === 0) {
    throw new Error(`No files found under '${directory}'.`);
  }

  return rawFiles;
}
