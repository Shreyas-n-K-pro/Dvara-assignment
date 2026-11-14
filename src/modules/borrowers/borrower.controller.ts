import { Response } from 'express';
import { AuthenticatedRequest } from '../../middleware/auth';
import { borrowerService } from './borrower.service';

export class BorrowerController {
  async createBorrower(req: AuthenticatedRequest, res: Response): Promise<void> {
    const borrower = await borrowerService.createBorrower(
      req.body,
      req.user!.id,
      req.ip
    );
    res.status(201).json({
      success: true,
      data: borrower,
    });
  }

  async getBorrowerById(req: AuthenticatedRequest, res: Response): Promise<void> {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const borrower = await borrowerService.getBorrowerById(id);
    res.status(200).json({
      success: true,
      data: borrower,
    });
  }

  async listBorrowers(_req: AuthenticatedRequest, res: Response): Promise<void> {
    const borrowers = await borrowerService.listBorrowers();
    res.status(200).json({
      success: true,
      data: borrowers,
    });
  }
}

export const borrowerController = new BorrowerController();
