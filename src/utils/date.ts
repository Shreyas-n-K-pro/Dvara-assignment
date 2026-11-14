/**
 * Financial Date Calculation Utilities
 *
 * Provides accurate date arithmetic for weekly and monthly loan repayment schedules.
 * Ensures consistent UTC date handling, leap-year calculations, and month-end clamping.
 */

import { RepaymentFrequency } from '@prisma/client';

/**
 * Checks if a given year is a leap year (Gregorian calendar).
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Returns the number of days in a given month (1-indexed: 1 = Jan, 12 = Dec).
 */
export function getDaysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:  // January
    case 3:  // March
    case 5:  // May
    case 7:  // July
    case 8:  // August
    case 10: // October
    case 12: // December
      return 31;
    case 4:  // April
    case 6:  // June
    case 9:  // September
    case 11: // November
      return 30;
    case 2:  // February
      return isLeapYear(year) ? 29 : 28;
    default:
      throw new Error(`Invalid month: ${month}. Must be between 1 and 12.`);
  }
}

/**
 * Calculates the due date for a specific installment number.
 *
 * For WEEKLY:
 * - Adds exactly (installmentNumber * 7) days to the start date using UTC arithmetic.
 *
 * For MONTHLY:
 * - Advances by installmentNumber calendar months.
 * - Anchors to the start date's day of the month.
 * - Clamps to the last day of the target month when the target month has fewer days
 *   (e.g., Jan 31 -> Feb 28/29 -> Mar 31).
 * - Restores the original anchor day in subsequent months with enough days.
 *
 * @param startDate Disbursement or loan start date
 * @param installmentNumber 1-based installment index (1, 2, 3...)
 * @param frequency RepaymentFrequency.WEEKLY | RepaymentFrequency.MONTHLY
 * @returns Date object representing the exact due date at 00:00:00 UTC
 */
export function calculateNextDueDate(
  startDate: Date,
  installmentNumber: number,
  frequency: RepaymentFrequency
): Date {
  if (installmentNumber < 1) {
    throw new Error('Installment number must be greater than or equal to 1');
  }

  // Work strictly in UTC
  const startYear = startDate.getUTCFullYear();
  const startMonth = startDate.getUTCMonth(); // 0-indexed
  const startDay = startDate.getUTCDate();

  if (frequency === RepaymentFrequency.WEEKLY) {
    const dueDate = new Date(Date.UTC(startYear, startMonth, startDay));
    dueDate.setUTCDate(dueDate.getUTCDate() + installmentNumber * 7);
    return dueDate;
  }

  if (frequency === RepaymentFrequency.MONTHLY) {
    const totalMonths = startMonth + installmentNumber;
    const targetYear = startYear + Math.floor(totalMonths / 12);
    const targetMonth0 = totalMonths % 12; // 0-indexed
    const targetMonth1 = targetMonth0 + 1; // 1-indexed

    const maxDays = getDaysInMonth(targetYear, targetMonth1);
    const actualDay = Math.min(startDay, maxDays);

    return new Date(Date.UTC(targetYear, targetMonth0, actualDay));
  }

  throw new Error(`Unsupported repayment frequency: ${frequency}`);
}

/**
 * Normalizes a date to UTC midnight (00:00:00.000Z).
 */
export function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
