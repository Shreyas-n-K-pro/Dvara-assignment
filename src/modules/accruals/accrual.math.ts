/**
 * Overdue Interest & Penalty Accrual Mathematical Engine
 *
 * Implements strict, documented financial calculation rules:
 * - Day-count basis: ACTUAL/365 (365 days per year).
 * - Interest rate divisor: 10,000 basis points * 365 = 3,650,000.
 * - Integer paise arithmetic using safe BigInt operations.
 * - Half-up rounding to the nearest integer paise (>= 0.5 paise rounds up).
 * - Zero floating-point operations.
 */

export const DAYS_PER_YEAR = 365n;
export const BPS_DIVISOR = 10000n;
export const ANNUAL_DIVISOR = BPS_DIVISOR * DAYS_PER_YEAR; // 3,650,000n

/**
 * Truncates a date to UTC midnight (00:00:00.000Z) for consistent daily calendar arithmetic.
 */
export function truncateToUtcMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0)
  );
}

/**
 * Adds integer days to a date in UTC.
 */
export function addDaysToDate(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return truncateToUtcMidnight(result);
}

/**
 * Checks whether an installment is overdue on asOfDate, accounting for grace period.
 *
 * Example:
 * - dueDate: Jan 10
 * - gracePeriodDays: 3 days
 * - Grace covers: Jan 10, Jan 11, Jan 12, Jan 13 (grace cutoff is Jan 13 midnight)
 * - Overdue on: Jan 14 and onwards (asOfDate > Jan 13)
 */
export function isInstallmentOverdue(
  dueDate: Date,
  asOfDate: Date,
  gracePeriodDays: number
): { isOverdue: boolean; graceCutoffDate: Date } {
  const normalizedDue = truncateToUtcMidnight(dueDate);
  const normalizedAsOf = truncateToUtcMidnight(asOfDate);
  const graceCutoffDate = addDaysToDate(normalizedDue, Math.max(0, gracePeriodDays));

  return {
    isOverdue: normalizedAsOf.getTime() > graceCutoffDate.getTime(),
    graceCutoffDate,
  };
}

/**
 * Computes daily interest on outstanding overdue principal using ACTUAL/365 basis.
 *
 * Formula:
 * Daily Interest = roundHalfUp(unpaidPrincipalPaise * interestRateBps / 3,650,000)
 */
export function calculateDailyInterest(
  unpaidPrincipalPaise: bigint,
  interestRateBps: number
): bigint {
  if (unpaidPrincipalPaise <= 0n || interestRateBps <= 0) {
    return 0n;
  }

  const numerator = unpaidPrincipalPaise * BigInt(interestRateBps);
  return roundHalfUpDivision(numerator, ANNUAL_DIVISOR);
}

/**
 * Computes daily penalty on unpaid overdue installment amount using ACTUAL/365 basis.
 *
 * Formula:
 * Daily Penalty = roundHalfUp(unpaidInstalmentPaise * penaltyRateBps / 3,650,000)
 */
export function calculateDailyPenalty(
  unpaidInstalmentPaise: bigint,
  penaltyRateBps: number
): bigint {
  if (unpaidInstalmentPaise <= 0n || penaltyRateBps <= 0) {
    return 0n;
  }

  const numerator = unpaidInstalmentPaise * BigInt(penaltyRateBps);
  return roundHalfUpDivision(numerator, ANNUAL_DIVISOR);
}

/**
 * Strict Half-Up integer division: (numerator + divisor / 2) / divisor.
 *
 * Equivalent to: (2 * numerator + divisor) / (2 * divisor)
 */
export function roundHalfUpDivision(numerator: bigint, divisor: bigint): bigint {
  if (divisor === 0n) {
    throw new Error('Division by zero');
  }

  if (numerator <= 0n) {
    return 0n;
  }

  return (numerator * 2n + divisor) / (divisor * 2n);
}
