import { Response } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { accrualService } from './accrual.service';
import { accrualScheduler } from './accrual.scheduler';

export class AccrualController {
  /**
   * POST /api/accruals/manual
   * Manual interest accrual for a single loan (Phase 6 backward compatibility)
   */
  async triggerAccrual(req: AuthenticatedRequest, res: Response): Promise<void> {
    const result = await accrualService.triggerManualAccrual(
      req.body,
      req.user!.id,
      req.ip
    );

    res.status(200).json({
      success: true,
      data: result,
    });
  }

  /**
   * POST /api/accruals/overdue (or /api/accruals/run)
   * Protected manual trigger for overdue interest and penalty accrual across loans
   */
  async runOverdueAccruals(req: AuthenticatedRequest, res: Response): Promise<void> {
    const summary = await accrualService.processOverdueAccruals(
      req.body,
      req.user!.id,
      req.ip
    );

    res.status(200).json({
      success: true,
      data: summary,
    });
  }

  /**
   * GET /api/accruals/scheduler/status
   */
  async getSchedulerStatus(_req: AuthenticatedRequest, res: Response): Promise<void> {
    const status = accrualScheduler.getStatus();
    res.status(200).json({
      success: true,
      data: status,
    });
  }

  /**
   * POST /api/accruals/scheduler/start
   */
  async startScheduler(req: AuthenticatedRequest, res: Response): Promise<void> {
    const expression = req.body?.cronExpression as string | undefined;
    accrualScheduler.start(expression);
    res.status(200).json({
      success: true,
      message: 'Accrual scheduler started',
      data: accrualScheduler.getStatus(),
    });
  }

  /**
   * POST /api/accruals/scheduler/stop
   */
  async stopScheduler(_req: AuthenticatedRequest, res: Response): Promise<void> {
    accrualScheduler.stop();
    res.status(200).json({
      success: true,
      message: 'Accrual scheduler stopped',
      data: accrualScheduler.getStatus(),
    });
  }
}

export const accrualController = new AccrualController();
