import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { errorHandler, requestLogger } from './middleware';
import { config } from './config';
import { NotFoundError } from './utils';
import { repaymentRoutes } from './modules/repayments';
import { loanRoutes } from './modules/loans';
import { authRoutes } from './modules/auth';
import { borrowerRoutes } from './modules/borrowers';
import { ledgerRoutes } from './modules/ledger';
import { accrualRoutes } from './modules/accruals';
import { auditRoutes } from './modules/audit';

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

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/borrowers', borrowerRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/repayments', repaymentRoutes);
app.use('/api/ledger', ledgerRoutes);
app.use('/api/accruals', accrualRoutes);
app.use('/api/audit-logs', auditRoutes);

// Backward-compatible v1 aliases
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/borrowers', borrowerRoutes);
app.use('/api/v1/loans', loanRoutes);
app.use('/api/v1/repayments', repaymentRoutes);
app.use('/api/v1/ledger', ledgerRoutes);
app.use('/api/v1/accruals', accrualRoutes);
app.use('/api/v1/audit-logs', auditRoutes);


// 404 handler for unmatched routes
app.use((_req, _res, next) => {
  next(new NotFoundError('Route not found'));
});

// Centralized error handler (must be last)
app.use(errorHandler);

export default app;
