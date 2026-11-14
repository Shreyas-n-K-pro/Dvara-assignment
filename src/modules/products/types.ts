import { InterestType, RepaymentFrequency } from '@prisma/client';

export interface CreateProductDto {
  name: string;
  description?: string;
  interestType: InterestType;
  repaymentFrequency: RepaymentFrequency;
  interestRateBps: number;
  minTenureMonths: number;
  maxTenureMonths: number;
  minAmountPaise: bigint;
  maxAmountPaise: bigint;
  penaltyRateBps?: number;
  processingFeeBps?: number;
}

export interface ProductResponse {
  id: string;
  name: string;
  description: string | null;
  interestType: InterestType;
  repaymentFrequency: RepaymentFrequency;
  interestRateBps: number;
  minTenureMonths: number;
  maxTenureMonths: number;
  minAmountPaise: bigint;
  maxAmountPaise: bigint;
  penaltyRateBps: number;
  processingFeeBps: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
