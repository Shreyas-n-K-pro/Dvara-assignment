/**
 * Configurable Accounting Policy for Double-Entry Ledger
 *
 * Encapsulates accounting rules and journal entry construction for:
 * 1. Loan Disbursement
 * 2. Repayment (principal, interest, penalty, unaccrued income)
 * 3. Interest Accrual
 * 4. Penalty Accrual
 *
 * Ensures all generated transactions are balanced and adhere to
 * standard accounting conventions.
 */

import { EntryType } from '@prisma/client';
import { PostTransactionDto, PostEntryDto } from './types';
import { ValidationError } from '../../utils/errors';

export interface StandardAccountIds {
  cashBankAccountId: string;
  loansReceivableAccountId: string;
  interestReceivableAccountId: string;
  penaltyReceivableAccountId: string;
  interestIncomeAccountId: string;
  penaltyIncomeAccountId: string;
}

export interface DisbursementPolicyParams {
  transactionDate?: Date;
  loanId: string;
  amountPaise: bigint;
  loansReceivableAccountId: string;
  cashBankAccountId: string;
  description?: string;
}

export interface RepaymentPolicyParams {
  transactionDate?: Date;
  loanId: string;
  cashBankAccountId: string;
  principalPaise: bigint;
  loansReceivableAccountId: string;
  interestAccruedCollectedPaise?: bigint;
  interestReceivableAccountId?: string;
  interestDirectCollectedPaise?: bigint;
  interestIncomeAccountId?: string;
  penaltyAccruedCollectedPaise?: bigint;
  penaltyReceivableAccountId?: string;
  penaltyDirectCollectedPaise?: bigint;
  penaltyIncomeAccountId?: string;
  description?: string;
}

export interface AccrualPolicyParams {
  transactionDate?: Date;
  loanId: string;
  amountPaise: bigint;
  receivableAccountId: string;
  incomeAccountId: string;
  type: 'INTEREST' | 'PENALTY';
  description?: string;
}

export interface AccountingPolicy {
  buildDisbursementTransaction(params: DisbursementPolicyParams): PostTransactionDto;
  buildRepaymentTransaction(params: RepaymentPolicyParams): PostTransactionDto;
  buildAccrualTransaction(params: AccrualPolicyParams): PostTransactionDto;
}

export class DefaultAccountingPolicy implements AccountingPolicy {
  /**
   * 1. Loan disbursement:
   *    Debit: Loans Receivable
   *    Credit: Cash/Bank
   */
  buildDisbursementTransaction(params: DisbursementPolicyParams): PostTransactionDto {
    if (params.amountPaise <= 0n) {
      throw new ValidationError('Disbursement amount must be greater than zero');
    }

    const entries: PostEntryDto[] = [
      {
        ledgerAccountId: params.loansReceivableAccountId,
        entryType: EntryType.DEBIT,
        amountPaise: params.amountPaise,
      },
      {
        ledgerAccountId: params.cashBankAccountId,
        entryType: EntryType.CREDIT,
        amountPaise: params.amountPaise,
      },
    ];

    return {
      description: params.description ?? `Loan disbursement for Loan #${params.loanId}`,
      transactionDate: params.transactionDate ?? new Date(),
      entries,
    };
  }

  /**
   * 2. Repayment:
   *    Debit: Cash/Bank
   *    Credit: Loans Receivable for principal collected
   *    Credit: Interest Receivable for previously accrued interest collected
   *    Credit: Penalty Receivable for previously accrued penalties collected
   *    For interest or penalty collected without previous accrual, credit corresponding income account instead.
   */
  buildRepaymentTransaction(params: RepaymentPolicyParams): PostTransactionDto {
    const principal = params.principalPaise ?? 0n;
    const interestAccrued = params.interestAccruedCollectedPaise ?? 0n;
    const interestDirect = params.interestDirectCollectedPaise ?? 0n;
    const penaltyAccrued = params.penaltyAccruedCollectedPaise ?? 0n;
    const penaltyDirect = params.penaltyDirectCollectedPaise ?? 0n;

    const totalCollected =
      principal + interestAccrued + interestDirect + penaltyAccrued + penaltyDirect;

    if (totalCollected <= 0n) {
      throw new ValidationError('Repayment total amount must be greater than zero');
    }

    const entries: PostEntryDto[] = [];

    // Total Debit to Cash/Bank
    entries.push({
      ledgerAccountId: params.cashBankAccountId,
      entryType: EntryType.DEBIT,
      amountPaise: totalCollected,
    });

    // Credit Loans Receivable (Principal)
    if (principal > 0n) {
      entries.push({
        ledgerAccountId: params.loansReceivableAccountId,
        entryType: EntryType.CREDIT,
        amountPaise: principal,
      });
    }

    // Credit Interest Receivable (Previously accrued interest)
    if (interestAccrued > 0n) {
      if (!params.interestReceivableAccountId) {
        throw new ValidationError('Interest receivable account ID required for accrued interest collection');
      }
      entries.push({
        ledgerAccountId: params.interestReceivableAccountId,
        entryType: EntryType.CREDIT,
        amountPaise: interestAccrued,
      });
    }

    // Credit Interest Income (Direct / unaccrued interest collected)
    if (interestDirect > 0n) {
      if (!params.interestIncomeAccountId) {
        throw new ValidationError('Interest income account ID required for direct interest collection');
      }
      entries.push({
        ledgerAccountId: params.interestIncomeAccountId,
        entryType: EntryType.CREDIT,
        amountPaise: interestDirect,
      });
    }

    // Credit Penalty Receivable (Previously accrued penalty)
    if (penaltyAccrued > 0n) {
      if (!params.penaltyReceivableAccountId) {
        throw new ValidationError('Penalty receivable account ID required for accrued penalty collection');
      }
      entries.push({
        ledgerAccountId: params.penaltyReceivableAccountId,
        entryType: EntryType.CREDIT,
        amountPaise: penaltyAccrued,
      });
    }

    // Credit Penalty Income (Direct / unaccrued penalty collected)
    if (penaltyDirect > 0n) {
      if (!params.penaltyIncomeAccountId) {
        throw new ValidationError('Penalty income account ID required for direct penalty collection');
      }
      entries.push({
        ledgerAccountId: params.penaltyIncomeAccountId,
        entryType: EntryType.CREDIT,
        amountPaise: penaltyDirect,
      });
    }

    return {
      description: params.description ?? `Repayment collected for Loan #${params.loanId}`,
      transactionDate: params.transactionDate ?? new Date(),
      entries,
    };
  }

  /**
   * 3. Accrual (Interest or Penalty):
   *    Debit: Receivable Account
   *    Credit: Income Account
   */
  buildAccrualTransaction(params: AccrualPolicyParams): PostTransactionDto {
    if (params.amountPaise <= 0n) {
      throw new ValidationError(`${params.type} accrual amount must be greater than zero`);
    }

    const entries: PostEntryDto[] = [
      {
        ledgerAccountId: params.receivableAccountId,
        entryType: EntryType.DEBIT,
        amountPaise: params.amountPaise,
      },
      {
        ledgerAccountId: params.incomeAccountId,
        entryType: EntryType.CREDIT,
        amountPaise: params.amountPaise,
      },
    ];

    const label = params.type === 'INTEREST' ? 'Interest' : 'Penalty';
    return {
      description: params.description ?? `${label} accrual for Loan #${params.loanId}`,
      transactionDate: params.transactionDate ?? new Date(),
      entries,
    };
  }
}

export const defaultAccountingPolicy = new DefaultAccountingPolicy();
