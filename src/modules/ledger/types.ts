import { LedgerAccountType, EntryType, LedgerTransaction, LedgerEntry } from '@prisma/client';

export type LedgerTransactionWithEntries = LedgerTransaction & {
  entries: LedgerEntry[];
};

export interface CreateAccountDto {
  name: string;
  accountType: LedgerAccountType;
  loanId?: string;
}

export interface PostEntryDto {
  ledgerAccountId: string;
  entryType: EntryType;
  amountPaise: bigint;
}

export interface PostTransactionDto {
  transactionRef?: string;
  description: string;
  transactionDate?: Date;
  entries: PostEntryDto[];
  reversalOfId?: string;
}

export interface AccountBalance {
  accountId: string;
  accountName: string;
  accountType: LedgerAccountType;
  loanId: string | null;
  debitTotalPaise: bigint;
  creditTotalPaise: bigint;
  /**
   * Derived balance according to standard accounting sign conventions:
   * - ASSET / EXPENSE: Normal balance is DEBIT (Debits - Credits)
   * - LIABILITY / EQUITY / INCOME: Normal balance is CREDIT (Credits - Debits)
   */
  netBalancePaise: bigint;
}

export interface LoanOutstandingBalance {
  loanId: string;
  principalOutstandingPaise: bigint;
  interestOutstandingPaise: bigint;
  penaltyOutstandingPaise: bigint;
  totalOutstandingPaise: bigint;
}

export interface TrialBalanceAccountSummary {
  accountId: string;
  accountName: string;
  accountType: LedgerAccountType;
  loanId: string | null;
  debitTotalPaise: bigint;
  creditTotalPaise: bigint;
  netBalancePaise: bigint;
}

export interface TrialBalanceReport {
  asOfDate: Date;
  accounts: TrialBalanceAccountSummary[];
  totalDebitsPaise: bigint;
  totalCreditsPaise: bigint;
  differencePaise: bigint;
  isBalanced: boolean;
}
