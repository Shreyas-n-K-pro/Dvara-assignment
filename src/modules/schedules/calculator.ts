/**
 * Repayment Schedule Calculation Engine
 *
 * Implements strict BigInt financial arithmetic with half-up rounding.
 * Zero floating-point arithmetic is used for monetary values.
 *
 * Supports:
 * - Weekly & Monthly repayment frequencies
 * - Flat-rate interest calculation
 * - Reducing-balance standard EMI calculation
 * - Accurate date handling with month-end rollover
 * - 100% exact reconciliation (total principal === original principal)
 */

import { InterestType, RepaymentFrequency, InstallmentStatus } from '@prisma/client';
import { divRoundHalfUp, gcd, bigIntPow } from '../../utils/math';
import { calculateNextDueDate } from '../../utils/date';
import { ValidationError } from '../../utils/errors';

export interface ScheduleGenerationParams {
  principalPaise: bigint;
  interestRateBps: number; // Basis points (e.g., 1200 = 12.00%)
  tenure: number;          // Number of installments (weeks or months)
  frequency: RepaymentFrequency;
  interestType: InterestType;
  startDate: Date;
}

export interface ScheduleInstallment {
  installmentNumber: number;
  dueDate: Date;
  principalPaise: bigint;
  interestPaise: bigint;
  totalPaise: bigint;
  outstandingPrincipalPaise: bigint;
  status: InstallmentStatus;
}

export interface GeneratedSchedule {
  installments: ScheduleInstallment[];
  totalPrincipalPaise: bigint;
  totalInterestPaise: bigint;
  totalAmountPaise: bigint;
  periodicEmiPaise?: bigint;
}

/**
 * Returns the denominator for the periodic interest rate:
 * Monthly: 10,000 bps * 12 months = 120,000
 * Weekly: 10,000 bps * 52 weeks = 520,000
 */
export function getPeriodicRateDenominator(frequency: RepaymentFrequency): bigint {
  switch (frequency) {
    case RepaymentFrequency.MONTHLY:
      return 120000n;
    case RepaymentFrequency.WEEKLY:
      return 520000n;
    default:
      throw new ValidationError(`Unsupported repayment frequency: ${frequency}`);
  }
}

/**
 * Validates input parameters for schedule calculation.
 */
export function validateCalculationParams(params: ScheduleGenerationParams): void {
  if (params.principalPaise <= 0n) {
    throw new ValidationError('Loan principal must be strictly greater than zero paise');
  }

  if (params.interestRateBps < 0) {
    throw new ValidationError('Interest rate in basis points cannot be negative');
  }

  if (params.interestRateBps > 100000) {
    // 1000% annual rate sanity check
    throw new ValidationError('Interest rate in basis points exceeds maximum allowable threshold (100000 bps / 1000%)');
  }

  if (!Number.isInteger(params.tenure) || params.tenure < 1) {
    throw new ValidationError('Tenure must be an integer of at least 1 installment');
  }

  if (params.frequency === RepaymentFrequency.WEEKLY && params.tenure > 520) {
    // Max 10 years weekly
    throw new ValidationError('Weekly loan tenure cannot exceed 520 weeks (10 years)');
  }

  if (params.frequency === RepaymentFrequency.MONTHLY && params.tenure > 360) {
    // Max 30 years monthly
    throw new ValidationError('Monthly loan tenure cannot exceed 360 months (30 years)');
  }

  if (!(params.startDate instanceof Date) || isNaN(params.startDate.getTime())) {
    throw new ValidationError('Invalid loan start date provided');
  }
}

/**
 * Calculates total flat-rate interest for the entire loan tenure.
 *
 * Formula:
 * Total Interest = (P * RateBps * Tenure) / PeriodicDenominator
 * Rounded half-up to the nearest paise.
 */
export function calculateFlatRateTotalInterest(
  principalPaise: bigint,
  interestRateBps: number,
  tenure: number,
  frequency: RepaymentFrequency
): bigint {
  if (interestRateBps === 0) {
    return 0n;
  }

  const denominator = getPeriodicRateDenominator(frequency);
  const numerator = principalPaise * BigInt(interestRateBps) * BigInt(tenure);

  return divRoundHalfUp(numerator, denominator);
}

/**
 * Calculates standard reducing-balance periodic EMI.
 *
 * Standard banking formula:
 *   E = P * [r*(1+r)^n] / [(1+r)^n - 1]
 *
 * Representing r = num_r / den_r:
 *   Let B = den_r / gcd, num_r = num_r / gcd
 *   Let A = B + num_r  (so A/B = 1+r)
 *
 * Then:
 *   E = P * [(A - B) * A^n] / [B * (A^n - B^n)]
 *
 * Calculated completely using BigInt integer arithmetic with half-up rounding.
 */
export function calculateReducingBalanceEmi(
  principalPaise: bigint,
  interestRateBps: number,
  tenure: number,
  frequency: RepaymentFrequency
): bigint {
  if (interestRateBps === 0) {
    return divRoundHalfUp(principalPaise, BigInt(tenure));
  }

  const rawDen = getPeriodicRateDenominator(frequency);
  const rawNum = BigInt(interestRateBps);

  const g = gcd(rawNum, rawDen);
  const numR = rawNum / g;
  const B = rawDen / g;
  const A = B + numR;

  const aPowN = bigIntPow(A, tenure);
  const bPowN = bigIntPow(B, tenure);

  const numerator = principalPaise * (A - B) * aPowN;
  const denominator = B * (aPowN - bPowN);

  return divRoundHalfUp(numerator, denominator);
}

/**
 * Generates the complete repayment schedule based on product configuration and loan terms.
 */
export function generateRepaymentSchedule(params: ScheduleGenerationParams): GeneratedSchedule {
  validateCalculationParams(params);

  if (params.interestType === InterestType.FLAT) {
    return generateFlatRateSchedule(params);
  }

  if (params.interestType === InterestType.REDUCING_BALANCE) {
    return generateReducingBalanceSchedule(params);
  }

  throw new ValidationError(`Unsupported interest type: ${params.interestType}`);
}

/**
 * Generates a Flat-Rate repayment schedule.
 *
 * - Calculates interest on original principal for the entire tenure.
 * - Distributes principal and interest evenly across installments.
 * - Adjusts the final installment for any rounding differences to ensure:
 *   1) Sum of principal components === original principal.
 *   2) Sum of interest components === total calculated flat-rate interest.
 */
function generateFlatRateSchedule(params: ScheduleGenerationParams): GeneratedSchedule {
  const { principalPaise, interestRateBps, tenure, frequency, startDate } = params;

  const totalInterestPaise = calculateFlatRateTotalInterest(
    principalPaise,
    interestRateBps,
    tenure,
    frequency
  );

  const installments: ScheduleInstallment[] = [];
  const tenureBig = BigInt(tenure);

  const basePrincipal = divRoundHalfUp(principalPaise, tenureBig);
  const baseInterest = divRoundHalfUp(totalInterestPaise, tenureBig);

  let accumulatedPrincipal = 0n;
  let accumulatedInterest = 0n;
  let currentOutstanding = principalPaise;

  for (let i = 1; i <= tenure; i++) {
    const dueDate = calculateNextDueDate(startDate, i, frequency);

    let instPrincipal: bigint;
    let instInterest: bigint;

    if (i === tenure) {
      // Final installment absorbs all rounding adjustments
      instPrincipal = principalPaise - accumulatedPrincipal;
      instInterest = totalInterestPaise - accumulatedInterest;
    } else {
      instPrincipal = basePrincipal;
      instInterest = baseInterest;
      accumulatedPrincipal += instPrincipal;
      accumulatedInterest += instInterest;
    }

    currentOutstanding -= instPrincipal;

    installments.push({
      installmentNumber: i,
      dueDate,
      principalPaise: instPrincipal,
      interestPaise: instInterest,
      totalPaise: instPrincipal + instInterest,
      outstandingPrincipalPaise: currentOutstanding,
      status: InstallmentStatus.PENDING,
    });
  }

  return {
    installments,
    totalPrincipalPaise: principalPaise,
    totalInterestPaise,
    totalAmountPaise: principalPaise + totalInterestPaise,
  };
}

/**
 * Generates a Reducing-Balance repayment schedule.
 *
 * - Computes the fixed periodic EMI.
 * - For each installment, computes interest on the beginning outstanding balance.
 * - Principal portion = EMI - Interest.
 * - For the final installment, pays off the exact remaining principal balance,
 *   reconciling any 1-paise variance in the final total payment.
 */
function generateReducingBalanceSchedule(params: ScheduleGenerationParams): GeneratedSchedule {
  const { principalPaise, interestRateBps, tenure, frequency, startDate } = params;

  const periodicDenom = getPeriodicRateDenominator(frequency);
  const rateNum = BigInt(interestRateBps);

  const emiPaise = calculateReducingBalanceEmi(
    principalPaise,
    interestRateBps,
    tenure,
    frequency
  );

  const installments: ScheduleInstallment[] = [];
  let currentOutstanding = principalPaise;
  let totalInterestAccrued = 0n;

  for (let i = 1; i <= tenure; i++) {
    const dueDate = calculateNextDueDate(startDate, i, frequency);

    // Interest on the beginning outstanding balance for this period
    let instInterest = 0n;
    if (interestRateBps > 0 && currentOutstanding > 0n) {
      instInterest = divRoundHalfUp(currentOutstanding * rateNum, periodicDenom);
    }

    let instPrincipal: bigint;

    if (i === tenure) {
      // Final installment clears all remaining outstanding principal
      instPrincipal = currentOutstanding;
    } else {
      instPrincipal = emiPaise - instInterest;

      // Guard rails against extreme edge cases
      if (instPrincipal > currentOutstanding) {
        instPrincipal = currentOutstanding;
      } else if (instPrincipal < 0n) {
        // If interest exceeds EMI (negative amortization), principal component is 0
        instPrincipal = 0n;
      }
    }

    currentOutstanding -= instPrincipal;
    totalInterestAccrued += instInterest;

    installments.push({
      installmentNumber: i,
      dueDate,
      principalPaise: instPrincipal,
      interestPaise: instInterest,
      totalPaise: instPrincipal + instInterest,
      outstandingPrincipalPaise: currentOutstanding,
      status: InstallmentStatus.PENDING,
    });
  }

  return {
    installments,
    totalPrincipalPaise: principalPaise,
    totalInterestPaise: totalInterestAccrued,
    totalAmountPaise: principalPaise + totalInterestAccrued,
    periodicEmiPaise: emiPaise,
  };
}
