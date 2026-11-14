import { Response } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { auditService } from './audit.service';

export class AuditController {
  /**
   * GET /api/audit-logs
   */
  async listLogs(req: AuthenticatedRequest, res: Response): Promise<void> {
    const filter = {
      entityType: req.query.entityType as string | undefined,
      entityId: req.query.entityId as string | undefined,
      userId: req.query.userId as string | undefined,
      action: req.query.action as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
    };

    const logs = await auditService.getAuditLogs(filter);
    res.status(200).json({
      success: true,
      data: logs,
    });
  }

  /**
   * GET /api/audit-logs/:id
   */
  async getLogById(req: AuthenticatedRequest, res: Response): Promise<void> {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const log = await auditService.getAuditLogById(id);
    res.status(200).json({
      success: true,
      data: log,
    });
  }
}

export const auditController = new AuditController();
