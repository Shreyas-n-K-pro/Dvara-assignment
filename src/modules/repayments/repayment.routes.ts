import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { repaymentController } from './repayment.controller';

const router = Router();

router.post('/', authenticate, repaymentController.createRepayment.bind(repaymentController));
router.get('/:id', authenticate, repaymentController.getRepaymentById.bind(repaymentController));

export default router;
