import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import logger from './lib/logger.js';
import { requestId } from './middleware/requestId.js';
import { errorHandler } from './middleware/errorHandler.js';
import healthRouter     from './routes/health.js';
import reportsRouter    from './routes/reports.js';
import rationalizeRouter from './routes/rationalize.js';

const PORT = Number(process.env.PORT ?? 3001);

const app = express();

// ── security ──────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-Request-ID'],
}));

// ── observability ─────────────────────────────────────────────────────────────
app.use(requestId);
app.use(pinoHttp({ logger, quietReqLogger: true }));

// ── body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));

// ── routes ────────────────────────────────────────────────────────────────────
app.use('/api/health',      healthRouter);
app.use('/api/load-reports', reportsRouter);
app.use('/api/rationalize',  rationalizeRouter);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ status: 'error', error: { code: 'NOT_FOUND', message: 'Route not found.' } });
});

// ── error handler (must be last) ─────────────────────────────────────────────
app.use(errorHandler);

// ── start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV ?? 'development' }, 'Server started');
});

export default app;
