import { Loan, LoanStatus, EntryType } from '@prisma/client';
import prisma from '../../config/database';
import { scheduleService } from '../schedules/schedule.service';
import { ledgerService } from '../ledger/ledger.service';
import { auditService } from '../audit/audit.service';
import { ValidationError, NotFoundError, ConflictError } from '../../utils/errors';
import { CreateLoanDto } from './types';
import { randomUUID } from 'crypto';

export class LoanService {
  /**
   * Creates a new loan application and generates its repayment schedule.
   */
  async createLoan(
    dto: CreateLoanDto,
    createdById: string,
    ipAddress?: string
  ): Promise<Loan> {
    if (!dto.borrowerId || !dto.productId) {
      throw new ValidationError('borrowerId and productId are required');
    }

    let principalPaise: bigint;
    try {
      principalPaise = BigInt(dto.principalPaise);
    } catch {
      throw new ValidationError('principalPaise must be a valid integer in paise');
    }

    if (principalPaise <= 0n) {
      throw new ValidationError('principalPaise must be greater than zero');
    }

    const tenureMonths = Number(dto.tenureMonths);
    if (!tenureMonths || tenureMonths <= 0) {
      throw new ValidationError('tenureMonths must be a positive integer');
    }

    const borrower = await prisma.borrower.findUnique({
      where: { id: dto.borrowerId },
    });
    if (!borrower || !borrower.isActive) {
      throw new NotFoundError(`Borrower with ID '${dto.borrowerId}' not found or inactive`);
    }

    const product = await prisma.loanProduct.findUnique({
      where: { id: dto.productId },
    });
    if (!product || !product.isActive) {
      throw new NotFoundError(`LoanProduct with ID '${dto.productId}' not found or inactive`);
    }

    // Validate product limits
    if (principalPaise < product.minAmountPaise || principalPaise > product.maxAmountPaise) {
      throw new ValidationError(
        `Principal must be between ₹${Number(product.minAmountPaise) / 100} and ₹${Number(product.maxAmountPaise) / 100}`
      );
    }

    if (tenureMonths < product.minTenureMonths || tenureMonths > product.maxTenureMonths) {
      throw new ValidationError(
        `Tenure must be between ${product.minTenureMonths} and ${product.maxTenureMonths} months`
      );
    }

    const loanNumber = dto.loanNumber?.trim() || `LN-${Date.now()}-${randomUUID().substring(0, 6).toUpperCase()}`;

    const existingLoan = await prisma.loan.findUnique({
      where: { loanNumber },
    });
    if (existingLoan) {
      throw new ConflictError(`Loan number '${loanNumber}' already exists`);
    }

    const interestRateBps = dto.interestRateBps ?? product.interestRateBps;
    const interestType = dto.interestType ?? product.interestType;
    const repaymentFrequency = dto.repaymentFrequency ?? product.repaymentFrequency;
    const startDate = dto.startDate ? new Date(dto.startDate) : new Date();

    // Generate repayment schedule
    const generatedSchedule = scheduleService.generateSchedule({
      principalPaise,
      interestRateBps,
      tenure: tenureMonths,
      frequency: repaymentFrequency,
      interestType,
      startDate,
    });

    const loan = await prisma.$transaction(async (tx) => {
      const createdLoan = await tx.loan.create({
        data: {
          loanNumber,
          borrowerId: borrower.id,
          productId: product.id,
          interestType,
          repaymentFrequency,
          principalPaise,
          interestRateBps,
          tenureMonths,
          status: LoanStatus.PENDING,
        },
      });

      // Insert scheduled installments
      await tx.repaymentSchedule.createMany({
        data: generatedSchedule.installments.map((inst) => ({
          loanId: createdLoan.id,
          installmentNumber: inst.installmentNumber,
          dueDate: inst.dueDate,
          principalPaise: inst.principalPaise,
          interestPaise: inst.interestPaise,
          totalPaise: inst.totalPaise,
        })),
      });

      // Audit log
      await auditService.logAction(
        {
          userId: createdById,
          action: 'LOAN_CREATED',
          entityType: 'Loan',
          entityId: createdLoan.id,
          after: {
            loanNumber: createdLoan.loanNumber,
            principalPaise: principalPaise.toString(),
            tenureMonths,
            borrowerId: borrower.id,
          },
          ipAddress,
        },
        tx
      );

      return createdLoan;
    });

    return loan;
  }

  /**
   * Disburses a pending loan, creating initial ledger balances and marking ACTIVE.
   */
  async disburseLoan(
    loanId: string,
    disbursedById: string,
    ipAddress?: string
  ): Promise<Loan> {
    return prisma.$transaction(async (tx) => {
      const lockedLoans = await tx.$queryRaw<Array<Loan>>`
        SELECT * FROM loans WHERE id = ${loanId} FOR UPDATE
      `;

      const loan = lockedLoans[0];
      if (!loan) {
        throw new NotFoundError(`Loan with ID '${loanId}' not found`);
      }

      if (loan.status === LoanStatus.ACTIVE) {
        throw new ValidationError('Loan is already disbursed and active');
      }

      if (loan.status !== LoanStatus.PENDING) {
        throw new ValidationError(`Cannot disburse loan in ${loan.status} status`);
      }

      // Create ledger accounts
      const cashBank = await ledgerService.getOrCreateSystemAccount('Cash and Bank', 'ASSET', tx);
      const loansReceivable = await ledgerService.getOrCreateLoanAccount(
        loan.id,
        'Loans Receivable',
        'ASSET',
        tx
      );
      await ledgerService.getOrCreateLoanAccount(loan.id, 'Interest Receivable', 'ASSET', tx);
      await ledgerService.getOrCreateLoanAccount(loan.id, 'Penalty Receivable', 'ASSET', tx);

      // Post disbursement transaction
      const now = new Date();
      const disbursementTx = await ledgerService.postTransaction(
        {
          description: `Disbursement for Loan #${loan.loanNumber}`,
          transactionDate: now,
          entries: [
            {
              ledgerAccountId: loansReceivable.id,
              entryType: EntryType.DEBIT,
              amountPaise: loan.principalPaise,
            },
            {
              ledgerAccountId: cashBank.id,
              entryType: EntryType.CREDIT,
              amountPaise: loan.principalPaise,
            },
          ],
        },
        tx
      );

      const updatedLoan = await tx.loan.update({
        where: { id: loan.id },
        data: {
          status: LoanStatus.ACTIVE,
          disbursedAt: now,
          version: { increment: 1 },
        },
      });

      // Audit log
      await auditService.logAction(
        {
          userId: disbursedById,
          action: 'LOAN_DISBURSED',
          entityType: 'Loan',
          entityId: updatedLoan.id,
          before: { status: loan.status },
          after: {
            status: updatedLoan.status,
            disbursedAt: now.toISOString(),
            principalPaise: loan.principalPaise.toString(),
          },
          ipAddress,
        },
        tx
      );

      return Object.assign(updatedLoan, {
        disbursementTransactionId: disbursementTx.id,
      });
    });
  }

  /**
   * Retrieves loan by ID.
   */
  async getLoanById(id: string): Promise<Loan> {
    const loan = await prisma.loan.findUnique({
      where: { id },
      include: {
        borrower: true,
        product: true,
        repaymentSchedule: {
          orderBy: { installmentNumber: 'asc' },
        },
      },
    });

    if (!loan) {
      throw new NotFoundError(`Loan with ID '${id}' not found`);
    }

    return loan;
  }
}

export const loanService = new LoanService();
