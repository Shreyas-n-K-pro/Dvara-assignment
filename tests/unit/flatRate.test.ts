import {
  calculateFlatRateTotalInterest,
  generateRepaymentSchedule,
} from '../../src/modules/schedules/calculator';
import { InterestType, RepaymentFrequency } from '@prisma/client';

describe('Flat-Rate Calculations & Schedules', () => {
  const startDate = new Date(Date.UTC(2024, 0, 1)); // Jan 1, 2024

  describe('Flat-Rate Interest Formula', () => {
    it('should calculate monthly flat-rate interest correctly: ₹1,00,000 at 12.00% for 12 months', () => {
      // P = 10,000,000 paise
      // Rate = 1200 bps
      // Tenure = 12 months
      // Formula: (10,000,000 * 1200 * 12) / 120000 = 1,200,000 paise (₹12,000)
      const principal = 10000000n;
      const rateBps = 1200;
      const tenure = 12;

      const interest = calculateFlatRateTotalInterest(
        principal,
        rateBps,
        tenure,
        RepaymentFrequency.MONTHLY
      );

      expect(interest).toBe(1200000n);
    });

    it('should calculate weekly flat-rate interest correctly: ₹26,000 at 15.00% for 52 weeks', () => {
      // P = 2,600,000 paise
      // Rate = 1500 bps
      // Tenure = 52 weeks
      // Formula: (2,600,000 * 1500 * 52) / 520000 = 390,000 paise (₹3,900)
      const principal = 2600000n;
      const rateBps = 1500;
      const tenure = 52;

      const interest = calculateFlatRateTotalInterest(
        principal,
        rateBps,
        tenure,
        RepaymentFrequency.WEEKLY
      );

      expect(interest).toBe(390000n);
    });

    it('should apply half-up rounding on fractional interest paise', () => {
      // P = 100,001 paise
      // Rate = 1350 bps
      // Tenure = 5 months
      // Numerator = 100,001 * 1350 * 5 = 675,006,750
      // Denominator = 120,000
      // Fraction = 5625.05625 -> 5625
      const principal = 100001n;
      const rateBps = 1350;
      const tenure = 5;

      const interest = calculateFlatRateTotalInterest(
        principal,
        rateBps,
        tenure,
        RepaymentFrequency.MONTHLY
      );

      expect(interest).toBe(5625n);
    });

    it('should return 0 interest when rate is 0 bps', () => {
      const interest = calculateFlatRateTotalInterest(
        5000000n,
        0,
        12,
        RepaymentFrequency.MONTHLY
      );
      expect(interest).toBe(0n);
    });
  });

  describe('Weekly Group Loan Schedule (Weekly Flat-Rate)', () => {
    it('should generate a 26-week weekly flat schedule and reconcile completely', () => {
      const principal = 2000000n; // ₹20,000
      const rateBps = 1500;       // 15.00% p.a.
      const tenure = 26;          // 26 weeks

      const schedule = generateRepaymentSchedule({
        principalPaise: principal,
        interestRateBps: rateBps,
        tenure,
        frequency: RepaymentFrequency.WEEKLY,
        interestType: InterestType.FLAT,
        startDate,
      });

      expect(schedule.installments).toHaveLength(26);

      // Total interest: (2,000,000 * 1500 * 26) / 520,000 = 150,000 paise (₹1,500)
      expect(schedule.totalInterestPaise).toBe(150000n);
      expect(schedule.totalPrincipalPaise).toBe(principal);
      expect(schedule.totalAmountPaise).toBe(principal + 150000n);

      // Verify each installment due date is 7 days apart
      for (let i = 0; i < tenure - 1; i++) {
        const curr = schedule.installments[i].dueDate.getTime();
        const next = schedule.installments[i + 1].dueDate.getTime();
        expect(next - curr).toBe(7 * 24 * 60 * 60 * 1000);
      }

      // Verify sum of principal equals original principal
      const sumPrincipal = schedule.installments.reduce(
        (sum, inst) => sum + inst.principalPaise,
        0n
      );
      expect(sumPrincipal).toBe(principal);

      // Verify sum of interest equals total interest
      const sumInterest = schedule.installments.reduce(
        (sum, inst) => sum + inst.interestPaise,
        0n
      );
      expect(sumInterest).toBe(150000n);

      // Verify final outstanding is 0
      expect(schedule.installments[25].outstandingPrincipalPaise).toBe(0n);
    });
  });

  describe('Monthly Flat-Rate Loan Schedule', () => {
    it('should generate a 12-month flat schedule with final installment adjustment', () => {
      // P = ₹50,000 = 5,000,000 paise
      // Rate = 1400 bps (14.00%)
      // Tenure = 12 months
      // Total Interest = (5,000,000 * 1400 * 12) / 120,000 = 700,000 paise
      const principal = 5000000n;
      const rateBps = 1400;
      const tenure = 12;

      const schedule = generateRepaymentSchedule({
        principalPaise: principal,
        interestRateBps: rateBps,
        tenure,
        frequency: RepaymentFrequency.MONTHLY,
        interestType: InterestType.FLAT,
        startDate,
      });

      expect(schedule.installments).toHaveLength(12);
      expect(schedule.totalInterestPaise).toBe(700000n);

      let totalPrincipal = 0n;
      let totalInterest = 0n;

      for (const inst of schedule.installments) {
        expect(inst.principalPaise + inst.interestPaise).toBe(inst.totalPaise);
        totalPrincipal += inst.principalPaise;
        totalInterest += inst.interestPaise;
      }

      expect(totalPrincipal).toBe(principal);
      expect(totalInterest).toBe(700000n);
      expect(schedule.installments[11].outstandingPrincipalPaise).toBe(0n);
    });

    it('should adjust final installment for non-divisible numbers', () => {
      // Principal = 10,000 paise, Tenure = 3
      // 10000 / 3 = 3333.33...
      // Inst 1: 3333, Inst 2: 3333, Inst 3: 3334 (sum = 10000)
      const principal = 10000n;
      const rateBps = 1200;
      const tenure = 3;

      const schedule = generateRepaymentSchedule({
        principalPaise: principal,
        interestRateBps: rateBps,
        tenure,
        frequency: RepaymentFrequency.MONTHLY,
        interestType: InterestType.FLAT,
        startDate,
      });

      expect(schedule.installments[0].principalPaise).toBe(3333n);
      expect(schedule.installments[1].principalPaise).toBe(3333n);
      expect(schedule.installments[2].principalPaise).toBe(3334n);

      const sumP = schedule.installments.reduce((sum, inst) => sum + inst.principalPaise, 0n);
      expect(sumP).toBe(principal);
    });
  });
});
