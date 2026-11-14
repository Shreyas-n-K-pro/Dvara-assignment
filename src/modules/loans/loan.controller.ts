import { Response } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { loanService } from './loan.service';
import { repaymentService } from '../repayments/repayment.service';

export class LoanController {
  /**
   * POST /api/loans
   */
  async createLoan(req: AuthenticatedRequest, res: Response): Promise<void> {
    const loan = await loanService.createLoan(req.body, req.user!.id, req.ip);
    res.status(201).json({
      success: true,
      data: loan,
    });
  }

  /**
   * POST /api/loans/:id/disburse
   */
  async disburseLoan(req: AuthenticatedRequest, res: Response): Promise<void> {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const loan = await loanService.disburseLoan(id, req.user!.id, req.ip);
    res.status(200).json({
      success: true,
      data: loan,
    });
  }

  /**
   * GET /api/loans/:id
   */
  async getLoan(req: AuthenticatedRequest, res: Response): Promise<void> {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const loan = await loanService.getLoanById(id);
    res.status(200).json({
      success: true,
      data: loan,
    });
  }

  /**
   * GET /api/loans/:id/balance
   */
  async getBalance(req: AuthenticatedRequest, res: Response): Promise<void> {
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
  async getSchedule(req: AuthenticatedRequest, res: Response): Promise<void> {
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
