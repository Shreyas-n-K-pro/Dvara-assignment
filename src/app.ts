import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { errorHandler, requestLogger } from './middleware';
import { config } from './config';
import { NotFoundError } from './utils';

const app = express();

// Security middleware
app.use(helmet());
app.use(cors());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use(requestLogger);

// Health check
app.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      environment: config.nodeEnv,
      timestamp: new Date().toISOString(),
    },
  });
});

// API routes placeholder
app.get('/api/v1', (_req, res) => {
  res.json({
    success: true,
    data: {
      message: 'Dvara Loan Account & Ledger Service API',
      version: '1.0.0',
    },
  });
});

// 404 handler for unmatched routes
app.use((_req, _res, next) => {
  next(new NotFoundError('Route not found'));
});

// Centralized error handler (must be last)
app.use(errorHandler);

export default app;
