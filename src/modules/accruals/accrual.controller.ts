import { Response } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { accrualService } from './accrual.service';

export class AccrualController {
  /**
   * POST /api/accruals/run
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
}

export const accrualController = new AccrualController();
