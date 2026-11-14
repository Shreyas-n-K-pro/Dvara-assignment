import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { authenticate, authorize } from '../../middleware/auth';
import { ledgerController } from './ledger.controller';

const router = Router();

// Complete ledger viewing: MANAGER and AUDITOR only (LOAN_OFFICER forbidden)
router.get(
  '/accounts',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.AUDITOR),
  ledgerController.listAccounts.bind(ledgerController)
);

router.get(
  '/trial-balance',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.AUDITOR),
  ledgerController.getTrialBalance.bind(ledgerController)
);

router.get(
  '/transactions/:id',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.AUDITOR),
  ledgerController.getTransaction.bind(ledgerController)
);

// Transaction reversal: MANAGER only (LOAN_OFFICER and AUDITOR forbidden)
router.post(
  '/transactions/:id/reverse',
  authenticate,
  authorize(UserRole.MANAGER),
  ledgerController.reverseTransaction.bind(ledgerController)
);

export default router;
