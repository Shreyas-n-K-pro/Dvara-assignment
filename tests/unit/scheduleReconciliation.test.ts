import { scheduleService } from '../../src/modules/schedules/schedule.service';
import { PREDEFINED_PRODUCTS } from '../../src/modules/products/predefined';
import { InterestType, RepaymentFrequency } from '@prisma/client';
import { ValidationError } from '../../src/utils/errors';

describe('Schedule Reconciliation Engine', () => {
  const startDate = new Date(Date.UTC(2024, 0, 15));

  describe('Product 1: Weekly Group Loan (Weekly, Flat Rate)', () => {
    it('should reconcile a 26-week loan completely', () => {
      const product = PREDEFINED_PRODUCTS.WEEKLY_GROUP_LOAN;
      const principal = 5000000n; // ₹50,000
      const tenure = 26; // 26 weeks

      const schedule = scheduleService.generateSchedule({
        principalPaise: principal,
        interestRateBps: product.interestRateBps,
        tenure,
        frequency: RepaymentFrequency.WEEKLY,
        interestType: InterestType.FLAT,
        startDate,
      });

      const result = scheduleService.reconcileSchedule(principal, schedule);

      expect(result.isReconciled).toBe(true);
      expect(result.originalPrincipalPaise).toBe(principal);
      expect(result.scheduledPrincipalPaise).toBe(principal);
      expect(result.principalDifferencePaise).toBe(0n);
      expect(result.installmentCount).toBe(26);
    });

    it('should reconcile a 52-week full-year weekly group loan', () => {
      const product = PREDEFINED_PRODUCTS.WEEKLY_GROUP_LOAN;
      const principal = 8000000n; // ₹80,000
      const tenure = 52; // 52 weeks

      const schedule = scheduleService.generateSchedule({
        principalPaise: principal,
        interestRateBps: product.interestRateBps,
        tenure,
        frequency: RepaymentFrequency.WEEKLY,
        interestType: InterestType.FLAT,
        startDate,
      });

      const result = scheduleService.reconcileSchedule(principal, schedule);

      expect(result.isReconciled).toBe(true);
      expect(result.principalDifferencePaise).toBe(0n);
      expect(result.installmentCount).toBe(52);
    });
  });

  describe('Product 2: Monthly EMI Loan (Monthly, Reducing Balance)', () => {
    it('should reconcile a 12-month reducing balance loan', () => {
      const product = PREDEFINED_PRODUCTS.MONTHLY_EMI_LOAN;
      const principal = 10000000n; // ₹1,00,000
      const tenure = 12;

      const schedule = scheduleService.generateSchedule({
        principalPaise: principal,
        interestRateBps: product.interestRateBps,
        tenure,
        frequency: RepaymentFrequency.MONTHLY,
        interestType: InterestType.REDUCING_BALANCE,
        startDate,
      });

      const result = scheduleService.reconcileSchedule(principal, schedule);

      expect(result.isReconciled).toBe(true);
      expect(result.scheduledPrincipalPaise).toBe(principal);
      expect(result.principalDifferencePaise).toBe(0n);
    });

    it('should reconcile a 60-month long tenure reducing balance loan', () => {
      const product = PREDEFINED_PRODUCTS.MONTHLY_EMI_LOAN;
      const principal = 50000000n; // ₹5,00,000
      const tenure = 60;

      const schedule = scheduleService.generateSchedule({
        principalPaise: principal,
        interestRateBps: product.interestRateBps,
        tenure,
        frequency: RepaymentFrequency.MONTHLY,
        interestType: InterestType.REDUCING_BALANCE,
        startDate,
      });

      const result = scheduleService.reconcileSchedule(principal, schedule);

      expect(result.isReconciled).toBe(true);
      expect(result.principalDifferencePaise).toBe(0n);
      expect(result.installmentCount).toBe(60);
    });
  });

  describe('Product 3: Flat Rate Loan (Monthly, Flat Rate)', () => {
    it('should reconcile a 24-month monthly flat loan', () => {
      const product = PREDEFINED_PRODUCTS.FLAT_RATE_LOAN;
      const principal = 25000000n; // ₹2,50,000
      const tenure = 24;

      const schedule = scheduleService.generateSchedule({
        principalPaise: principal,
        interestRateBps: product.interestRateBps,
        tenure,
        frequency: RepaymentFrequency.MONTHLY,
        interestType: InterestType.FLAT,
        startDate,
      });

      const result = scheduleService.reconcileSchedule(principal, schedule);

      expect(result.isReconciled).toBe(true);
      expect(result.scheduledPrincipalPaise).toBe(principal);
      expect(result.principalDifferencePaise).toBe(0n);
    });
  });

  describe('Reconciliation Failure Detection', () => {
    it('should throw ValidationError if schedule principal does not match original', () => {
      const schedule = scheduleService.generateSchedule({
        principalPaise: 1000000n,
        interestRateBps: 1200,
        tenure: 12,
        frequency: RepaymentFrequency.MONTHLY,
        interestType: InterestType.REDUCING_BALANCE,
        startDate,
      });

      // Pass wrong original principal
      expect(() =>
        scheduleService.reconcileSchedule(2000000n, schedule)
      ).toThrow(ValidationError);
    });

    it('should throw ValidationError if any installment has internal sum mismatch', () => {
      const schedule = scheduleService.generateSchedule({
        principalPaise: 1000000n,
        interestRateBps: 1200,
        tenure: 12,
        frequency: RepaymentFrequency.MONTHLY,
        interestType: InterestType.REDUCING_BALANCE,
        startDate,
      });

      // Tamper with one installment
      schedule.installments[0].totalPaise += 100n;

      expect(() =>
        scheduleService.reconcileSchedule(1000000n, schedule)
      ).toThrow('internal sum mismatch');
    });

    it('should throw ValidationError if final outstanding principal is non-zero', () => {
      const schedule = scheduleService.generateSchedule({
        principalPaise: 1000000n,
        interestRateBps: 1200,
        tenure: 12,
        frequency: RepaymentFrequency.MONTHLY,
        interestType: InterestType.REDUCING_BALANCE,
        startDate,
      });

      // Tamper with final balance
      schedule.installments[11].outstandingPrincipalPaise = 50n;

      expect(() =>
        scheduleService.reconcileSchedule(1000000n, schedule)
      ).toThrow('Final outstanding balance is 50 paise, expected 0 paise');
    });
  });
});
