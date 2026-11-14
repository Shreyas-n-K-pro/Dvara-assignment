import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { authenticate, authorize } from '../../middleware/auth';
import { loanController } from './loan.controller';

const router = Router();

// Create loan: LOAN_OFFICER, MANAGER (AUDITOR rejected)
router.post(
  '/',
  authenticate,
  authorize(UserRole.LOAN_OFFICER, UserRole.MANAGER),
  loanController.createLoan.bind(loanController)
);

// Disburse loan: LOAN_OFFICER, MANAGER (AUDITOR rejected)
router.post(
  '/:id/disburse',
  authenticate,
  authorize(UserRole.LOAN_OFFICER, UserRole.MANAGER),
  loanController.disburseLoan.bind(loanController)
);

// Read loan info: LOAN_OFFICER, MANAGER, AUDITOR
router.get(
  '/:id',
  authenticate,
  authorize(UserRole.LOAN_OFFICER, UserRole.MANAGER, UserRole.AUDITOR),
  loanController.getLoan.bind(loanController)
);

router.get(
  '/:id/balance',
  authenticate,
  authorize(UserRole.LOAN_OFFICER, UserRole.MANAGER, UserRole.AUDITOR),
  loanController.getBalance.bind(loanController)
);

router.get(
  '/:id/schedule',
  authenticate,
  authorize(UserRole.LOAN_OFFICER, UserRole.MANAGER, UserRole.AUDITOR),
  loanController.getSchedule.bind(loanController)
);

export default router;
