import { Request, Response } from 'express';
import { authService } from './auth.service';
import { AuthenticatedRequest } from '../../middleware/auth';

export class AuthController {
  /**
   * POST /api/auth/register
   */
  async register(req: Request, res: Response): Promise<void> {
    const user = await authService.register(req.body, undefined, req.ip);
    res.status(201).json({
      success: true,
      data: user,
    });
  }

  /**
   * POST /api/auth/login
   */
  async login(req: Request, res: Response): Promise<void> {
    const authData = await authService.login(req.body, req.ip);
    res.status(200).json({
      success: true,
      data: authData,
    });
  }

  /**
   * GET /api/auth/me
   */
  async getMe(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = await authService.getUserById(req.user!.id);
    res.status(200).json({
      success: true,
      data: user,
    });
  }
}

export const authController = new AuthController();
