import { Response } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { extractIdempotencyKey } from '../../utils/idempotency';
import { repaymentService } from './repayment.service';

export class RepaymentController {
  /**
   * POST /api/repayments
   */
  async createRepayment(req: AuthenticatedRequest, res: Response): Promise<void> {
    const idempotencyKey = extractIdempotencyKey(req.headers['idempotency-key']);
    const result = await repaymentService.processRepayment(
      req.body,
      idempotencyKey,
      req.user?.id
    );

    const statusCode = result.isCached ? 200 : 201;
    res.status(statusCode).json({
      success: true,
      data: result,
    });
  }

  /**
   * GET /api/repayments/:id
   */
  async getRepaymentById(req: AuthenticatedRequest, res: Response): Promise<void> {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const repayment = await repaymentService.getRepaymentById(id);

    res.status(200).json({
      success: true,
      data: repayment,
    });
  }
}

export const repaymentController = new RepaymentController();
