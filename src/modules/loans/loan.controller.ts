import { Request, Response } from 'express';
import { repaymentService } from '../repayments/repayment.service';

export class LoanController {
  /**
   * GET /api/loans/:id/balance
   */
  async getBalance(req: Request, res: Response): Promise<void> {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const balanceData = await repaymentService.getLoanBalance(id);

    res.status(200).json({
      success: true,
      data: balanceData,
    });
  }

  /**
   * GET /api/loans/:id/schedule
   */
  async getSchedule(req: Request, res: Response): Promise<void> {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const scheduleData = await repaymentService.getLoanSchedule(id);

    res.status(200).json({
      success: true,
      data: scheduleData,
    });
  }
}

export const loanController = new LoanController();
