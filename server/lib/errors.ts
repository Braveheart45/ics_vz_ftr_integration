export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function badRequest(code: string, message: string, details?: unknown): AppError {
  return new AppError(400, code, message, details);
}

export function notFound(code: string, message: string): AppError {
  return new AppError(404, code, message);
}

export function internalError(message: string, details?: unknown): AppError {
  return new AppError(500, 'INTERNAL_ERROR', message, details);
}
