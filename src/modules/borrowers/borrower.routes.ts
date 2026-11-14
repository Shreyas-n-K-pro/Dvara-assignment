import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { authenticate, authorize } from '../../middleware/auth';
import { borrowerController } from './borrower.controller';

const router = Router();

// Create borrower: LOAN_OFFICER and MANAGER only (AUDITOR forbidden)
router.post(
  '/',
  authenticate,
  authorize(UserRole.LOAN_OFFICER, UserRole.MANAGER),
  borrowerController.createBorrower.bind(borrowerController)
);

// Read borrowers: LOAN_OFFICER, MANAGER, AUDITOR
router.get(
  '/',
  authenticate,
  authorize(UserRole.LOAN_OFFICER, UserRole.MANAGER, UserRole.AUDITOR),
  borrowerController.listBorrowers.bind(borrowerController)
);

router.get(
  '/:id',
  authenticate,
  authorize(UserRole.LOAN_OFFICER, UserRole.MANAGER, UserRole.AUDITOR),
  borrowerController.getBorrowerById.bind(borrowerController)
);

export default router;
