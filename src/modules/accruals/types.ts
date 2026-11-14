import { AccrualType } from '@prisma/client';

export { AccrualType };

export interface TriggerAccrualDto {
  loanId: string;
  accrualDate?: Date | string;
  interestPaise: bigint | number | string;
  description?: string;
}

export interface AccrualResult {
  accrualRecordId: string;
  loanId: string;
  accrualDate: Date;
  interestPaise: bigint;
  ledgerTransactionId: string;
}

export interface RunOverdueAccrualDto {
  asOfDate?: Date | string;
  loanId?: string;
}

export interface OverdueInstallmentCalculation {
  scheduleId: string;
  loanId: string;
  installmentNumber: number;
  dueDate: Date;
  graceCutoffDate: Date;
  unpaidPrincipalPaise: bigint;
  unpaidInstalmentPaise: bigint;
  dailyInterestPaise: bigint;
  dailyPenaltyPaise: bigint;
  isOverdue: boolean;
}

export interface AccrualJobSummary {
  asOfDate: Date;
  activeLoansChecked: number;
  overdueInstalmentsFound: number;
  interestAccrualsCreated: number;
  penaltyAccrualsCreated: number;
  totalInterestAccruedPaise: bigint;
  totalPenaltyAccruedPaise: bigint;
  skippedDueToGracePeriod: number;
  skippedAlreadyAccrued: number;
  ledgerTransactionsPosted: number;
  durationMs: number;
}

export interface SchedulerStatus {
  isRunning: boolean;
  isJobExecuting: boolean;
  cronExpression: string;
  lastRunAt: Date | null;
  lastSummary: AccrualJobSummary | null;
}
