import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { resolveReportPath } from '../lib/reportPathResolver.js';
import { collectRawFiles, type RawFileItem } from '../lib/rawInventory.js';
import { badRequest } from '../lib/errors.js';
import logger from '../lib/logger.js';

const router = Router();

const LoadReportsSchema = z.object({
  sourcePath: z.string().min(1, 'sourcePath is required').max(2000),
  targetPath: z.string().min(1, 'targetPath is required').max(2000),
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = LoadReportsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest(
        'VALIDATION_ERROR',
        'Invalid request body.',
        parsed.error.flatten().fieldErrors,
      );
    }

    const { sourcePath, targetPath } = parsed.data;
    const requestId = req.headers['x-request-id'];

    logger.info({ requestId, sourcePath, targetPath }, 'Loading report inventory from paths');

    const resolvedPaths = await Promise.all([
      resolveReportPath(sourcePath).catch(err => {
        throw badRequest('INVALID_SOURCE_PATH', `Source path: ${(err as Error).message}`);
      }),
      resolveReportPath(targetPath).catch(err => {
        throw badRequest('INVALID_TARGET_PATH', `Reference path: ${(err as Error).message}`);
      }),
    ]);

    const [resolvedSource, resolvedTarget] = resolvedPaths;

    let sourceFiles: RawFileItem[] = [];
    let targetFiles: RawFileItem[] = [];
    try {
      [sourceFiles, targetFiles] = await Promise.all([
        collectRawFiles(resolvedSource.directory).catch(err => {
          throw badRequest('SOURCE_LOAD_ERROR', `Failed to load source artefacts: ${(err as Error).message}`);
        }),
        collectRawFiles(resolvedTarget.directory).catch(err => {
          throw badRequest('TARGET_LOAD_ERROR', `Failed to load reference artefacts: ${(err as Error).message}`);
        }),
      ]);
    } finally {
      await Promise.all(resolvedPaths.map(p => p.cleanup().catch(() => undefined)));
    }

    if (sourceFiles.length === 0) {
      throw badRequest('NO_SOURCE_FILES', 'No files found in source path.');
    }
    if (targetFiles.length === 0) {
      throw badRequest('NO_TARGET_FILES', 'No files found in reference path.');
    }

    logger.info(
      {
        requestId,
        sourceFileCount: sourceFiles.length,
        targetFileCount: targetFiles.length,
        sourceKind: resolvedSource.kind,
        targetKind: resolvedTarget.kind,
      },
      'Raw report artefacts loaded',
    );

    res.json({
      status: 'ok',
      sourceFiles,
      targetFiles,
      sources: [],
      sourceIndex: [],
      targetIndex: [],
      targets: [],
    });
  } catch (err) {
    next(err);
  }
});

export default router;
