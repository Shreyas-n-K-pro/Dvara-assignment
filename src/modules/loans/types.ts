import { InterestType, RepaymentFrequency } from '@prisma/client';

export interface CreateLoanDto {
  loanNumber?: string;
  borrowerId: string;
  productId: string;
  principalPaise: bigint | number | string;
  tenureMonths: number;
  interestRateBps?: number;
  interestType?: InterestType;
  repaymentFrequency?: RepaymentFrequency;
  startDate?: Date | string;
}
