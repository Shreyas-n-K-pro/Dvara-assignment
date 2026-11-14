import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { authController } from './auth.controller';

const router = Router();

router.post('/register', authController.register.bind(authController));
router.post('/login', authController.login.bind(authController));
router.get('/me', authenticate, authController.getMe.bind(authController));

export default router;
