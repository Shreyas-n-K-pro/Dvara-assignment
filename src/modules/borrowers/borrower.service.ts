import prisma from '../../config/database';
import { CreateBorrowerDto } from './types';
import { ValidationError, ConflictError, NotFoundError } from '../../utils/errors';
import { auditService } from '../audit/audit.service';
import { Borrower } from '@prisma/client';

export class BorrowerService {
  async createBorrower(
    dto: CreateBorrowerDto,
    createdById: string,
    ipAddress?: string
  ): Promise<Borrower> {
    if (!dto.firstName || !dto.lastName || !dto.phone) {
      throw new ValidationError('firstName, lastName, and phone are required');
    }

    const code =
      dto.borrowerCode && dto.borrowerCode.trim().length > 0
        ? dto.borrowerCode.trim().toUpperCase()
        : `BW-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const existing = await prisma.borrower.findUnique({
      where: { borrowerCode: code },
    });

    if (existing) {
      throw new ConflictError(`Borrower with code '${code}' already exists`);
    }

    const borrower = await prisma.borrower.create({
      data: {
        borrowerCode: code,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        email: dto.email ? dto.email.trim().toLowerCase() : null,
        phone: dto.phone.trim(),
        address: dto.address ? dto.address.trim() : null,
        createdById,
        isActive: true,
      },
    });

    await auditService.logAction({
      userId: createdById,
      action: 'BORROWER_CREATED',
      entityType: 'Borrower',
      entityId: borrower.id,
      after: {
        borrowerCode: borrower.borrowerCode,
        firstName: borrower.firstName,
        lastName: borrower.lastName,
        phone: borrower.phone,
      },
      ipAddress,
    });

    return borrower;
  }

  async getBorrowerById(id: string): Promise<Borrower> {
    const borrower = await prisma.borrower.findUnique({
      where: { id },
    });

    if (!borrower) {
      throw new NotFoundError(`Borrower with ID '${id}' not found`);
    }

    return borrower;
  }

  async listBorrowers(): Promise<Borrower[]> {
    return prisma.borrower.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }
}

export const borrowerService = new BorrowerService();
