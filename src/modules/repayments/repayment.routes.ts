import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { authenticate, authorize } from '../../middleware/auth';
import { repaymentController } from './repayment.controller';

const router = Router();

// Post repayment: LOAN_OFFICER and MANAGER only (AUDITOR forbidden)
router.post(
  '/',
  authenticate,
  authorize(UserRole.LOAN_OFFICER, UserRole.MANAGER),
  repaymentController.createRepayment.bind(repaymentController)
);

// View repayment: LOAN_OFFICER, MANAGER, AUDITOR
router.get(
  '/:id',
  authenticate,
  authorize(UserRole.LOAN_OFFICER, UserRole.MANAGER, UserRole.AUDITOR),
  repaymentController.getRepaymentById.bind(repaymentController)
);

export default router;
