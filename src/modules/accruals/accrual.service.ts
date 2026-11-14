import prisma from '../../config/database';
import { ledgerService } from '../ledger/ledger.service';
import { auditService } from '../audit/audit.service';
import { ValidationError, NotFoundError } from '../../utils/errors';
import { TriggerAccrualDto, AccrualResult } from './types';
import { LoanStatus } from '@prisma/client';

export class AccrualService {
  async triggerManualAccrual(
    dto: TriggerAccrualDto,
    triggeredById: string,
    ipAddress?: string
  ): Promise<AccrualResult> {
    if (!dto.loanId) {
      throw new ValidationError('loanId is required');
    }

    let interestPaise: bigint;
    try {
      interestPaise = BigInt(dto.interestPaise);
    } catch {
      throw new ValidationError('interestPaise must be a valid integer in paise');
    }

    if (interestPaise <= 0n) {
      throw new ValidationError('interestPaise must be greater than zero');
    }

    const accrualDate = dto.accrualDate ? new Date(dto.accrualDate) : new Date();

    return prisma.$transaction(async (tx) => {
      const loan = await tx.loan.findUnique({
        where: { id: dto.loanId },
      });

      if (!loan) {
        throw new NotFoundError(`Loan with ID '${dto.loanId}' not found`);
      }

      if (loan.status !== LoanStatus.ACTIVE) {
        throw new ValidationError(`Cannot accrue interest on loan in ${loan.status} status`);
      }

      // Check for duplicate accrual on same date
      const existingAccrual = await tx.accrualRecord.findUnique({
        where: {
          loanId_accrualDate: {
            loanId: loan.id,
            accrualDate,
          },
        },
      });

      if (existingAccrual) {
        throw new ValidationError(
          `Interest has already been accrued for loan #${loan.loanNumber} on ${accrualDate.toISOString().split('T')[0]}`
        );
      }

      // Accounts
      const interestReceivable = await ledgerService.getOrCreateLoanAccount(
        loan.id,
        'Interest Receivable',
        'ASSET',
        tx
      );
      const interestIncome = await ledgerService.getOrCreateSystemAccount(
        'Interest Income',
        'INCOME',
        tx
      );

      // Post balanced accrual transaction: Debit Interest Receivable, Credit Interest Income
      const ledgerTx = await ledgerService.postAccrual(
        {
          loanId: loan.id,
          amountPaise: interestPaise,
          receivableAccountId: interestReceivable.id,
          incomeAccountId: interestIncome.id,
          type: 'INTEREST',
          transactionDate: accrualDate,
          description: dto.description ?? `Manual interest accrual for Loan #${loan.loanNumber}`,
        },
        tx
      );

      // Create AccrualRecord
      const record = await tx.accrualRecord.create({
        data: {
          loanId: loan.id,
          accrualDate,
          interestPaise,
        },
      });

      // Audit log
      await auditService.logAction(
        {
          userId: triggeredById,
          action: 'INTEREST_ACCRUED',
          entityType: 'AccrualRecord',
          entityId: record.id,
          after: {
            loanId: loan.id,
            interestPaise: interestPaise.toString(),
            accrualDate: accrualDate.toISOString(),
            ledgerTransactionId: ledgerTx.id,
          },
          ipAddress,
        },
        tx
      );

      return {
        accrualRecordId: record.id,
        loanId: loan.id,
        accrualDate,
        interestPaise,
        ledgerTransactionId: ledgerTx.id,
      };
    });
  }
}

export const accrualService = new AccrualService();
