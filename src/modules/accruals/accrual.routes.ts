import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { authenticate, authorize } from '../../middleware/auth';
import { accrualController } from './accrual.controller';

const router = Router();

// Manual accrual trigger: MANAGER only (LOAN_OFFICER and AUDITOR forbidden)
router.post(
  '/run',
  authenticate,
  authorize(UserRole.MANAGER),
  accrualController.triggerAccrual.bind(accrualController)
);

router.post(
  '/manual',
  authenticate,
  authorize(UserRole.MANAGER),
  accrualController.triggerAccrual.bind(accrualController)
);

export default router;
