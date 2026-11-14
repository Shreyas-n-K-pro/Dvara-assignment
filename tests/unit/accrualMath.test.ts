import {
  calculateDailyInterest,
  calculateDailyPenalty,
  isInstallmentOverdue,
  truncateToUtcMidnight,
  addDaysToDate,
  roundHalfUpDivision,
} from '../../src/modules/accruals/accrual.math';

describe('Accrual Mathematical Engine Unit Tests', () => {
  describe('Daily Interest Calculations (ACTUAL/365)', () => {
    it('should accurately calculate daily interest with half-up rounding', () => {
      // Principal: ₹100,000 (10,000,000 paise)
      // Rate: 1200 bps (12.00% p.a.)
      // Annual interest = 1,200,000 paise
      // Daily = 1,200,000 / 365 = 3,287.671... -> 3,288 paise (₹32.88)
      const interest = calculateDailyInterest(10000000n, 1200);
      expect(interest).toBe(3288n);
    });

    it('should return 0 when principal or rate is zero or negative', () => {
      expect(calculateDailyInterest(0n, 1200)).toBe(0n);
      expect(calculateDailyInterest(10000000n, 0)).toBe(0n);
      expect(calculateDailyInterest(-5000n, 1200)).toBe(0n);
      expect(calculateDailyInterest(10000000n, -100)).toBe(0n);
    });

    it('should handle small amounts correctly', () => {
      // 100 paise (₹1) at 1200 bps (12%)
      // 100 * 1200 / 3,650,000 = 0.0328 paise -> 0n
      expect(calculateDailyInterest(100n, 1200)).toBe(0n);
    });

    it('should handle large loan amounts without precision loss', () => {
      // Principal: ₹10,000,000 (1,000,000,000 paise)
      // Rate: 1800 bps (18.00% p.a.)
      // Annual: 180,000,000 paise
      // Daily: 180,000,000 / 365 = 493,150.6849... -> 493,151 paise
      const interest = calculateDailyInterest(1000000000n, 1800);
      expect(interest).toBe(493151n);
    });
  });

  describe('Daily Penalty Calculations (ACTUAL/365)', () => {
    it('should accurately calculate daily penalty with half-up rounding', () => {
      // Unpaid installment: ₹10,000 (1,000,000 paise)
      // Penalty Rate: 2400 bps (24.00% p.a.)
      // Annual penalty = 240,000 paise
      // Daily = 240,000 / 365 = 657.534... -> 658 paise (₹6.58)
      const penalty = calculateDailyPenalty(1000000n, 2400);
      expect(penalty).toBe(658n);
    });

    it('should return 0 when installment amount or rate is zero or negative', () => {
      expect(calculateDailyPenalty(0n, 2400)).toBe(0n);
      expect(calculateDailyPenalty(1000000n, 0)).toBe(0n);
      expect(calculateDailyPenalty(-1000n, 2400)).toBe(0n);
      expect(calculateDailyPenalty(1000000n, -500)).toBe(0n);
    });
  });

  describe('Grace Period and Overdue Checks', () => {
    const dueDate = new Date('2026-05-10T10:00:00Z');

    it('should not consider installment overdue on due date', () => {
      const asOf = new Date('2026-05-10T15:00:00Z');
      const res = isInstallmentOverdue(dueDate, asOf, 0);
      expect(res.isOverdue).toBe(false);
    });

    it('should consider installment overdue on next day when grace period is 0', () => {
      const asOf = new Date('2026-05-11T00:00:00Z');
      const res = isInstallmentOverdue(dueDate, asOf, 0);
      expect(res.isOverdue).toBe(true);
    });

    it('should respect positive grace period', () => {
      // Grace period = 3 days (May 10 + 3 days = May 13)
      const gracePeriod = 3;

      // On May 12: within grace
      expect(isInstallmentOverdue(dueDate, new Date('2026-05-12T00:00:00Z'), gracePeriod).isOverdue).toBe(false);

      // On May 13: last day of grace
      expect(isInstallmentOverdue(dueDate, new Date('2026-05-13T00:00:00Z'), gracePeriod).isOverdue).toBe(false);

      // On May 14: past grace period -> OVERDUE
      expect(isInstallmentOverdue(dueDate, new Date('2026-05-14T00:00:00Z'), gracePeriod).isOverdue).toBe(true);
    });
  });

  describe('Date Helpers & Division', () => {
    it('should normalize dates to UTC midnight', () => {
      const d = new Date('2026-08-15T18:45:30.123Z');
      const midnight = truncateToUtcMidnight(d);
      expect(midnight.toISOString()).toBe('2026-08-15T00:00:00.000Z');
    });

    it('should correctly add days in UTC', () => {
      const d = new Date('2026-02-28T00:00:00.000Z');
      const nextDay = addDaysToDate(d, 1);
      expect(nextDay.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    });

    it('should throw on division by zero', () => {
      expect(() => roundHalfUpDivision(100n, 0n)).toThrow('Division by zero');
    });
  });
});
