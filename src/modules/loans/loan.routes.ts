import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { loanController } from './loan.controller';

const router = Router();

router.get('/:id/balance', authenticate, loanController.getBalance.bind(loanController));
router.get('/:id/schedule', authenticate, loanController.getSchedule.bind(loanController));

export default router;
