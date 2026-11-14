import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils';

export function requestLogger(req: Request, _res: Response, next: NextFunction): void {
  logger.info(`${req.method} ${req.path}`, {
    query: req.query as Record<string, unknown>,
    ip: req.ip,
  });
  next();
}
