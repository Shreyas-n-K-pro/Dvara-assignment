import { isLeapYear, getDaysInMonth, calculateNextDueDate } from '../../src/utils/date';
import { RepaymentFrequency } from '@prisma/client';

describe('Financial Date Utilities', () => {
  describe('isLeapYear', () => {
    it('should correctly identify leap and non-leap years', () => {
      expect(isLeapYear(2024)).toBe(true);  // Divisible by 4
      expect(isLeapYear(2020)).toBe(true);  // Divisible by 4
      expect(isLeapYear(2000)).toBe(true);  // Divisible by 400
      expect(isLeapYear(2023)).toBe(false); // Common year
      expect(isLeapYear(2021)).toBe(false); // Common year
      expect(isLeapYear(1900)).toBe(false); // Century not divisible by 400
      expect(isLeapYear(2100)).toBe(false); // Century not divisible by 400
    });
  });

  describe('getDaysInMonth', () => {
    it('should return 29 days for Feb in leap years and 28 in common years', () => {
      expect(getDaysInMonth(2024, 2)).toBe(29);
      expect(getDaysInMonth(2023, 2)).toBe(28);
    });

    it('should return correct days for 30-day and 31-day months', () => {
      expect(getDaysInMonth(2024, 1)).toBe(31); // Jan
      expect(getDaysInMonth(2024, 3)).toBe(31); // Mar
      expect(getDaysInMonth(2024, 4)).toBe(30); // Apr
      expect(getDaysInMonth(2024, 5)).toBe(31); // May
      expect(getDaysInMonth(2024, 6)).toBe(30); // Jun
      expect(getDaysInMonth(2024, 7)).toBe(31); // Jul
      expect(getDaysInMonth(2024, 8)).toBe(31); // Aug
      expect(getDaysInMonth(2024, 9)).toBe(30); // Sep
      expect(getDaysInMonth(2024, 10)).toBe(31); // Oct
      expect(getDaysInMonth(2024, 11)).toBe(30); // Nov
      expect(getDaysInMonth(2024, 12)).toBe(31); // Dec
    });

    it('should throw on invalid month numbers', () => {
      expect(() => getDaysInMonth(2024, 0)).toThrow('Invalid month');
      expect(() => getDaysInMonth(2024, 13)).toThrow('Invalid month');
    });
  });

  describe('calculateNextDueDate', () => {
    describe('WEEKLY repayments', () => {
      it('should advance exactly 7 days per installment', () => {
        const start = new Date(Date.UTC(2024, 0, 5)); // Friday, Jan 5, 2024

        const d1 = calculateNextDueDate(start, 1, RepaymentFrequency.WEEKLY);
        expect(d1.toISOString()).toBe('2024-01-12T00:00:00.000Z');

        const d2 = calculateNextDueDate(start, 2, RepaymentFrequency.WEEKLY);
        expect(d2.toISOString()).toBe('2024-01-19T00:00:00.000Z');

        const d4 = calculateNextDueDate(start, 4, RepaymentFrequency.WEEKLY);
        expect(d4.toISOString()).toBe('2024-02-02T00:00:00.000Z');

        const d52 = calculateNextDueDate(start, 52, RepaymentFrequency.WEEKLY);
        expect(d52.toISOString()).toBe('2025-01-03T00:00:00.000Z');
      });
    });

    describe('MONTHLY repayments', () => {
      it('should advance regular mid-month dates by exactly one calendar month', () => {
        const start = new Date(Date.UTC(2024, 0, 15)); // Jan 15, 2024

        const d1 = calculateNextDueDate(start, 1, RepaymentFrequency.MONTHLY);
        expect(d1.toISOString()).toBe('2024-02-15T00:00:00.000Z');

        const d2 = calculateNextDueDate(start, 2, RepaymentFrequency.MONTHLY);
        expect(d2.toISOString()).toBe('2024-03-15T00:00:00.000Z');

        const d12 = calculateNextDueDate(start, 12, RepaymentFrequency.MONTHLY);
        expect(d12.toISOString()).toBe('2025-01-15T00:00:00.000Z');
      });

      it('should handle month-end rollover for Jan 31 in a leap year (2024)', () => {
        const start = new Date(Date.UTC(2024, 0, 31)); // Jan 31, 2024

        // Feb 2024 (leap year) -> clamped to 29
        const d1 = calculateNextDueDate(start, 1, RepaymentFrequency.MONTHLY);
        expect(d1.toISOString()).toBe('2024-02-29T00:00:00.000Z');

        // Mar 2024 -> restored to 31
        const d2 = calculateNextDueDate(start, 2, RepaymentFrequency.MONTHLY);
        expect(d2.toISOString()).toBe('2024-03-31T00:00:00.000Z');

        // Apr 2024 -> clamped to 30
        const d3 = calculateNextDueDate(start, 3, RepaymentFrequency.MONTHLY);
        expect(d3.toISOString()).toBe('2024-04-30T00:00:00.000Z');

        // May 2024 -> restored to 31
        const d4 = calculateNextDueDate(start, 4, RepaymentFrequency.MONTHLY);
        expect(d4.toISOString()).toBe('2024-05-31T00:00:00.000Z');
      });

      it('should handle month-end rollover for Jan 31 in a non-leap year (2023)', () => {
        const start = new Date(Date.UTC(2023, 0, 31)); // Jan 31, 2023

        // Feb 2023 (non-leap) -> clamped to 28
        const d1 = calculateNextDueDate(start, 1, RepaymentFrequency.MONTHLY);
        expect(d1.toISOString()).toBe('2023-02-28T00:00:00.000Z');

        // Mar 2023 -> restored to 31
        const d2 = calculateNextDueDate(start, 2, RepaymentFrequency.MONTHLY);
        expect(d2.toISOString()).toBe('2023-03-31T00:00:00.000Z');
      });

      it('should handle Jan 30 clamping in February and restoration in March', () => {
        const start = new Date(Date.UTC(2024, 0, 30)); // Jan 30, 2024

        const d1 = calculateNextDueDate(start, 1, RepaymentFrequency.MONTHLY);
        expect(d1.toISOString()).toBe('2024-02-29T00:00:00.000Z'); // Clamped to Feb 29

        const d2 = calculateNextDueDate(start, 2, RepaymentFrequency.MONTHLY);
        expect(d2.toISOString()).toBe('2024-03-30T00:00:00.000Z'); // Back to 30
      });

      it('should handle multi-year loan date progression', () => {
        const start = new Date(Date.UTC(2024, 5, 20)); // June 20, 2024

        // 36 months later = June 20, 2027
        const d36 = calculateNextDueDate(start, 36, RepaymentFrequency.MONTHLY);
        expect(d36.toISOString()).toBe('2027-06-20T00:00:00.000Z');
      });
    });

    it('should throw when installment number is less than 1', () => {
      const start = new Date();
      expect(() => calculateNextDueDate(start, 0, RepaymentFrequency.MONTHLY)).toThrow(
        'Installment number must be greater than or equal to 1'
      );
    });
  });
});
