import {
  LoanStatus,
  InstallmentStatus,
  PaymentMethod,
  Repayment,
  RepaymentAllocation,
  RepaymentSchedule,
  IdempotencyKey,
  Loan,
} from '@prisma/client';
import { LoanBalance } from '../ledger/types';

export type RepaymentWithDetails = Repayment & {
  allocations: (RepaymentAllocation & { schedule: RepaymentSchedule })[];
  loan: Loan;
  idempotencyKey: IdempotencyKey | null;
};

export interface LoanBalanceResponse {
  loanId: string;
  loanNumber: string;
  status: LoanStatus;
  balances: LoanBalance;
}


export interface CreateRepaymentDto {
  loanId: string;
  amountPaise: bigint | number | string;
  paymentDate: Date | string;
  paymentReference: string;
  paymentMethod?: PaymentMethod;
}

export interface RepaymentAllocationDetail {
  id?: string;
  scheduleId: string;
  installmentNumber: number;
  principalPaise: bigint;
  interestPaise: bigint;
  penaltyPaise: bigint;
  balanceRemainingPaise?: bigint;
}

export interface RepaymentResponseData {
  repayment: {
    id: string;
    loanId: string;
    amountPaise: bigint;
    paymentDate: Date;
    paymentReference: string | null;
    paymentMethod: PaymentMethod;
    allocations: RepaymentAllocationDetail[];
    ledgerTransactionId?: string;
  };
  balances: LoanBalance;
  loanStatus: LoanStatus;
  isCached?: boolean;
}

export interface LoanScheduleInstallmentDetail {
  id: string;
  installmentNumber: number;
  dueDate: Date;
  principalPaise: bigint;
  interestPaise: bigint;
  totalPaise: bigint;
  status: InstallmentStatus;
  paidPrincipalPaise: bigint;
  paidInterestPaise: bigint;
  paidPenaltyPaise: bigint;
  remainingPrincipalPaise: bigint;
  remainingInterestPaise: bigint;
  remainingTotalPaise: bigint;
}
