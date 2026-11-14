import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { authenticate, authorize } from '../../middleware/auth';
import { accrualController } from './accrual.controller';

const router = Router();

// Phase 6 backward-compatible single loan manual accrual
router.post(
  '/manual',
  authenticate,
  authorize(UserRole.MANAGER),
  accrualController.triggerAccrual.bind(accrualController)
);

// Phase 7 protected manual trigger for overdue interest and penalty accrual
router.post(
  '/overdue',
  authenticate,
  authorize(UserRole.MANAGER),
  accrualController.runOverdueAccruals.bind(accrualController)
);

router.post(
  '/run',
  authenticate,
  authorize(UserRole.MANAGER),
  accrualController.runOverdueAccruals.bind(accrualController)
);

// Scheduler management endpoints
router.get(
  '/scheduler/status',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.AUDITOR),
  accrualController.getSchedulerStatus.bind(accrualController)
);

router.post(
  '/scheduler/start',
  authenticate,
  authorize(UserRole.MANAGER),
  accrualController.startScheduler.bind(accrualController)
);

router.post(
  '/scheduler/stop',
  authenticate,
  authorize(UserRole.MANAGER),
  accrualController.stopScheduler.bind(accrualController)
);

export default router;
