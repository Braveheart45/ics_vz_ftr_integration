import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors.js';
import logger from '../lib/logger.js';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = req.headers['x-request-id'];

  if (err instanceof AppError) {
    logger.warn({ requestId, code: err.code, status: err.statusCode }, err.message);
    res.status(err.statusCode).json({
      status: 'error',
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
  logger.error({ requestId, err }, message);
  res.status(500).json({
    status: 'error',
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.' },
  });
}
