import {
  calculateReducingBalanceEmi,
  generateRepaymentSchedule,
} from '../../src/modules/schedules/calculator';
import { InterestType, RepaymentFrequency } from '@prisma/client';

describe('Reducing-Balance EMI Calculations', () => {
  const startDate = new Date(Date.UTC(2024, 0, 1)); // Jan 1, 2024

  describe('EMI Calculation Formula Benchmarks', () => {
    it('should match standard banking benchmark: ₹1,00,000 at 12.00% for 12 months', () => {
      // P = ₹1,00,000 = 10,000,000 paise
      // Rate = 1200 bps (1% monthly)
      // Tenure = 12 months
      // Standard Formula: E = 100000 * (0.01 * 1.01^12) / (1.01^12 - 1) = 8,884.8788...
      // Rounded half-up = 8,884.88 = 888488 paise
      const principal = 10000000n;
      const rateBps = 1200;
      const tenure = 12;

      const emi = calculateReducingBalanceEmi(
        principal,
        rateBps,
        tenure,
        RepaymentFrequency.MONTHLY
      );

      expect(emi).toBe(888488n);
    });

    it('should match standard banking benchmark: ₹50,000 at 10.50% for 24 months', () => {
      // P = ₹50,000 = 5,000,000 paise
      // Rate = 1050 bps (0.875% monthly = 10.5% / 12)
      // Tenure = 24 months
      // Standard formula: E = 50000 * (0.00875 * 1.00875^24) / (1.00875^24 - 1) = 2,318.79979...
      // Rounded half-up = 2,318.80 = 231880 paise
      const principal = 5000000n;
      const rateBps = 1050;
      const tenure = 24;

      const emi = calculateReducingBalanceEmi(
        principal,
        rateBps,
        tenure,
        RepaymentFrequency.MONTHLY
      );

      expect(emi).toBe(231880n);
    });

    it('should support weekly reducing-balance EMI: ₹20,000 at 15.00% for 52 weeks', () => {
      // P = ₹20,000 = 2,000,000 paise
      // Rate = 1500 bps (15%)
      // Tenure = 52 weeks
      // r_weekly = 15 / 5200 = 0.002884615...
      const principal = 2000000n;
      const rateBps = 1500;
      const tenure = 52;

      const emi = calculateReducingBalanceEmi(
        principal,
        rateBps,
        tenure,
        RepaymentFrequency.WEEKLY
      );

      // Verify EMI is reasonable (greater than principal/tenure: 2000000/52 = 38461)
      expect(emi).toBeGreaterThan(38461n);
      expect(emi).toBeLessThan(50000n);
    });
  });

  describe('Zero and Invalid Interest Rates', () => {
    it('should handle zero interest rate by dividing principal evenly', () => {
      const principal = 1200000n; // ₹12,000
      const tenure = 12;

      const emi = calculateReducingBalanceEmi(
        principal,
        0,
        tenure,
        RepaymentFrequency.MONTHLY
      );

      expect(emi).toBe(100000n); // exactly ₹1,000 per month

      const schedule = generateRepaymentSchedule({
        principalPaise: principal,
        interestRateBps: 0,
        tenure,
        frequency: RepaymentFrequency.MONTHLY,
        interestType: InterestType.REDUCING_BALANCE,
        startDate,
      });

      expect(schedule.totalInterestPaise).toBe(0n);
      expect(schedule.totalPrincipalPaise).toBe(principal);
      expect(schedule.totalAmountPaise).toBe(principal);

      for (const inst of schedule.installments) {
        expect(inst.interestPaise).toBe(0n);
        expect(inst.principalPaise).toBe(100000n);
        expect(inst.totalPaise).toBe(100000n);
      }
    });

    it('should throw ValidationError on negative interest rate', () => {
      expect(() =>
        generateRepaymentSchedule({
          principalPaise: 1000000n,
          interestRateBps: -500,
          tenure: 12,
          frequency: RepaymentFrequency.MONTHLY,
          interestType: InterestType.REDUCING_BALANCE,
          startDate,
        })
      ).toThrow('Interest rate in basis points cannot be negative');
    });

    it('should throw ValidationError on zero or negative principal', () => {
      expect(() =>
        generateRepaymentSchedule({
          principalPaise: 0n,
          interestRateBps: 1200,
          tenure: 12,
          frequency: RepaymentFrequency.MONTHLY,
          interestType: InterestType.REDUCING_BALANCE,
          startDate,
        })
      ).toThrow('Loan principal must be strictly greater than zero paise');

      expect(() =>
        generateRepaymentSchedule({
          principalPaise: -1000n,
          interestRateBps: 1200,
          tenure: 12,
          frequency: RepaymentFrequency.MONTHLY,
          interestType: InterestType.REDUCING_BALANCE,
          startDate,
        })
      ).toThrow('Loan principal must be strictly greater than zero paise');
    });

    it('should throw ValidationError on invalid tenure', () => {
      expect(() =>
        generateRepaymentSchedule({
          principalPaise: 1000000n,
          interestRateBps: 1200,
          tenure: 0,
          frequency: RepaymentFrequency.MONTHLY,
          interestType: InterestType.REDUCING_BALANCE,
          startDate,
        })
      ).toThrow('Tenure must be an integer of at least 1 installment');
    });
  });

  describe('Different Tenures', () => {
    it('should handle 1-month tenure (single bullet installment)', () => {
      const principal = 1000000n; // ₹10,000
      const rateBps = 1200; // 1% per month

      const schedule = generateRepaymentSchedule({
        principalPaise: principal,
        interestRateBps: rateBps,
        tenure: 1,
        frequency: RepaymentFrequency.MONTHLY,
        interestType: InterestType.REDUCING_BALANCE,
        startDate,
      });

      expect(schedule.installments).toHaveLength(1);
      const inst = schedule.installments[0];
      expect(inst.principalPaise).toBe(principal);
      expect(inst.interestPaise).toBe(10000n); // 1% of 10,000 = 100
      expect(inst.totalPaise).toBe(1010000n);
      expect(inst.outstandingPrincipalPaise).toBe(0n);
    });

    it('should handle 60-month tenure with correct amortization behavior', () => {
      const principal = 50000000n; // ₹5,00,000
      const rateBps = 1200;
      const tenure = 60;

      const schedule = generateRepaymentSchedule({
        principalPaise: principal,
        interestRateBps: rateBps,
        tenure,
        frequency: RepaymentFrequency.MONTHLY,
        interestType: InterestType.REDUCING_BALANCE,
        startDate,
      });

      expect(schedule.installments).toHaveLength(60);

      // Verify that interest component decreases monotonically
      for (let i = 0; i < tenure - 1; i++) {
        expect(schedule.installments[i].interestPaise).toBeGreaterThanOrEqual(
          schedule.installments[i + 1].interestPaise
        );
      }

      // Verify that principal component increases monotonically (except possibly the final reconciled one)
      for (let i = 0; i < tenure - 2; i++) {
        expect(schedule.installments[i].principalPaise).toBeLessThanOrEqual(
          schedule.installments[i + 1].principalPaise
        );
      }

      // Final outstanding balance must be exactly 0
      expect(schedule.installments[59].outstandingPrincipalPaise).toBe(0n);

      // Total principal must equal original principal
      const totalPrincipal = schedule.installments.reduce(
        (sum, inst) => sum + inst.principalPaise,
        0n
      );
      expect(totalPrincipal).toBe(principal);
    });

    it('should handle long tenure: 240 months (20-year loan)', () => {
      const principal = 250000000n; // ₹25,00,000
      const rateBps = 850; // 8.5% p.a.
      const tenure = 240;

      const schedule = generateRepaymentSchedule({
        principalPaise: principal,
        interestRateBps: rateBps,
        tenure,
        frequency: RepaymentFrequency.MONTHLY,
        interestType: InterestType.REDUCING_BALANCE,
        startDate,
      });

      expect(schedule.installments).toHaveLength(240);
      expect(schedule.installments[239].outstandingPrincipalPaise).toBe(0n);

      const totalPrincipal = schedule.installments.reduce(
        (sum, inst) => sum + inst.principalPaise,
        0n
      );
      expect(totalPrincipal).toBe(principal);
    });
  });

  describe('Large Loan Values & Precision', () => {
    it('should calculate ₹100 Crore (10^11 paise) loan without overflow or precision loss', () => {
      // 100 Crore = 1,000,000,000 INR = 100,000,000,000 paise
      const principal = 100000000000n;
      const rateBps = 950; // 9.50%
      const tenure = 120; // 10 years

      const schedule = generateRepaymentSchedule({
        principalPaise: principal,
        interestRateBps: rateBps,
        tenure,
        frequency: RepaymentFrequency.MONTHLY,
        interestType: InterestType.REDUCING_BALANCE,
        startDate,
      });

      expect(schedule.installments).toHaveLength(120);

      const sumPrincipal = schedule.installments.reduce(
        (sum, inst) => sum + inst.principalPaise,
        0n
      );
      expect(sumPrincipal).toBe(principal);
      expect(schedule.installments[119].outstandingPrincipalPaise).toBe(0n);
    });
  });

  describe('Rounding Edge Cases and Final Installment Reconciliation', () => {
    it('should reconcile odd principal amounts with odd interest rates', () => {
      const principal = 9999999n; // ₹99,999.99
      const rateBps = 1337;       // 13.37% p.a.
      const tenure = 7;           // 7 months (prime number)

      const schedule = generateRepaymentSchedule({
        principalPaise: principal,
        interestRateBps: rateBps,
        tenure,
        frequency: RepaymentFrequency.MONTHLY,
        interestType: InterestType.REDUCING_BALANCE,
        startDate,
      });

      let accumulatedPrincipal = 0n;
      for (const inst of schedule.installments) {
        expect(inst.principalPaise + inst.interestPaise).toBe(inst.totalPaise);
        accumulatedPrincipal += inst.principalPaise;
      }

      expect(accumulatedPrincipal).toBe(principal);
      expect(schedule.installments[tenure - 1].outstandingPrincipalPaise).toBe(0n);
    });
  });
});
