import { InterestType, RepaymentFrequency } from '@prisma/client';
import { CreateProductDto } from './types';

/**
 * Predefined Loan Products required by Phase 2:
 *
 * 1. Weekly Group Loan – weekly repayment, flat-rate interest.
 * 2. Monthly EMI Loan – monthly repayment, reducing-balance interest.
 * 3. Flat Rate Loan – monthly repayment, flat-rate interest.
 */
export const PREDEFINED_PRODUCTS: Record<string, CreateProductDto> = {
  WEEKLY_GROUP_LOAN: {
    name: 'Weekly Group Loan',
    description: 'Weekly group lending product with flat-rate interest',
    interestType: InterestType.FLAT,
    repaymentFrequency: RepaymentFrequency.WEEKLY,
    interestRateBps: 1500, // 15.00% p.a.
    minTenureMonths: 3,    // 12 weeks
    maxTenureMonths: 12,   // 52 weeks
    minAmountPaise: 500000n,   // ₹5,000
    maxAmountPaise: 10000000n, // ₹1,00,000
    penaltyRateBps: 200,   // 2.00% late payment penalty
    processingFeeBps: 100, // 1.00% processing fee
  },
  MONTHLY_EMI_LOAN: {
    name: 'Monthly EMI Loan',
    description: 'Standard monthly loan with reducing-balance EMI interest',
    interestType: InterestType.REDUCING_BALANCE,
    repaymentFrequency: RepaymentFrequency.MONTHLY,
    interestRateBps: 1200, // 12.00% p.a.
    minTenureMonths: 6,
    maxTenureMonths: 60,
    minAmountPaise: 2000000n,   // ₹20,000
    maxAmountPaise: 100000000n, // ₹10,00,000
    penaltyRateBps: 200,   // 2.00% late payment penalty
    processingFeeBps: 150, // 1.50% processing fee
  },
  FLAT_RATE_LOAN: {
    name: 'Flat Rate Loan',
    description: 'Monthly tenure loan with flat-rate interest calculated on original principal',
    interestType: InterestType.FLAT,
    repaymentFrequency: RepaymentFrequency.MONTHLY,
    interestRateBps: 1400, // 14.00% p.a.
    minTenureMonths: 3,
    maxTenureMonths: 36,
    minAmountPaise: 1000000n,  // ₹10,000
    maxAmountPaise: 50000000n, // ₹5,00,000
    penaltyRateBps: 250,   // 2.50% late payment penalty
    processingFeeBps: 200, // 2.00% processing fee
  },
};
