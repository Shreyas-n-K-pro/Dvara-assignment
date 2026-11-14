import { Response } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { ledgerService } from './ledger.service';
import { auditService } from '../audit/audit.service';

export class LedgerController {
  /**
   * GET /api/ledger/accounts
   */
  async listAccounts(_req: AuthenticatedRequest, res: Response): Promise<void> {
    const trialBalance = await ledgerService.getTrialBalance();
    res.status(200).json({
      success: true,
      data: trialBalance.accounts,
    });
  }

  /**
   * GET /api/ledger/trial-balance
   */
  async getTrialBalance(_req: AuthenticatedRequest, res: Response): Promise<void> {
    const trialBalance = await ledgerService.getTrialBalance();
    res.status(200).json({
      success: true,
      data: trialBalance,
    });
  }

  /**
   * GET /api/ledger/transactions/:id
   */
  async getTransaction(req: AuthenticatedRequest, res: Response): Promise<void> {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const tx = await ledgerService.getTransactionById(id);
    res.status(200).json({
      success: true,
      data: tx,
    });
  }

  /**
   * POST /api/ledger/transactions/:id/reverse
   */
  async reverseTransaction(req: AuthenticatedRequest, res: Response): Promise<void> {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const reason = req.body?.reason as string | undefined;

    const reversalTx = await ledgerService.reverseTransaction(id, reason);

    // Audit log
    await auditService.logAction({
      userId: req.user!.id,
      action: 'TRANSACTION_REVERSED',
      entityType: 'LedgerTransaction',
      entityId: reversalTx.id,
      before: { originalTransactionId: id },
      after: {
        reversalTransactionId: reversalTx.id,
        reason,
      },
      ipAddress: req.ip,
    });

    res.status(200).json({
      success: true,
      data: reversalTx,
    });
  }
}

export const ledgerController = new LedgerController();
