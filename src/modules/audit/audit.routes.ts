import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { authenticate, authorize } from '../../middleware/auth';
import { auditController } from './audit.controller';

const router = Router();

// View audit logs: MANAGER and AUDITOR only (LOAN_OFFICER forbidden)
router.get(
  '/',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.AUDITOR),
  auditController.listLogs.bind(auditController)
);

router.get(
  '/:id',
  authenticate,
  authorize(UserRole.MANAGER, UserRole.AUDITOR),
  auditController.getLogById.bind(auditController)
);

export default router;
