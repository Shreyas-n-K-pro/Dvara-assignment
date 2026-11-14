import { productService } from '../../src/modules/products/product.service';
import { PREDEFINED_PRODUCTS } from '../../src/modules/products/predefined';
import { InterestType, RepaymentFrequency, LoanProduct } from '@prisma/client';
import { ValidationError } from '../../src/utils/errors';

describe('Loan Product Validation & Rules', () => {
  const mockProduct: LoanProduct = {
    id: 'prod-123',
    name: 'Standard Monthly Product',
    description: 'Test product',
    interestType: InterestType.REDUCING_BALANCE,
    repaymentFrequency: RepaymentFrequency.MONTHLY,
    interestRateBps: 1200,
    minTenureMonths: 6,
    maxTenureMonths: 36,
    minAmountPaise: 1000000n,  // ₹10,000
    maxAmountPaise: 50000000n, // ₹5,00,000
    penaltyRateBps: 200,
    processingFeeBps: 100,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  describe('Predefined Products Configuration', () => {
    it('should define Weekly Group Loan with weekly flat-rate interest', () => {
      const p = PREDEFINED_PRODUCTS.WEEKLY_GROUP_LOAN;
      expect(p.name).toBe('Weekly Group Loan');
      expect(p.interestType).toBe(InterestType.FLAT);
      expect(p.repaymentFrequency).toBe(RepaymentFrequency.WEEKLY);
      expect(p.interestRateBps).toBe(1500);
      expect(p.minAmountPaise).toBe(500000n);
      expect(p.maxAmountPaise).toBe(10000000n);
    });

    it('should define Monthly EMI Loan with monthly reducing-balance interest', () => {
      const p = PREDEFINED_PRODUCTS.MONTHLY_EMI_LOAN;
      expect(p.name).toBe('Monthly EMI Loan');
      expect(p.interestType).toBe(InterestType.REDUCING_BALANCE);
      expect(p.repaymentFrequency).toBe(RepaymentFrequency.MONTHLY);
      expect(p.interestRateBps).toBe(1200);
      expect(p.minAmountPaise).toBe(2000000n);
      expect(p.maxAmountPaise).toBe(100000000n);
    });

    it('should define Flat Rate Loan with monthly flat-rate interest', () => {
      const p = PREDEFINED_PRODUCTS.FLAT_RATE_LOAN;
      expect(p.name).toBe('Flat Rate Loan');
      expect(p.interestType).toBe(InterestType.FLAT);
      expect(p.repaymentFrequency).toBe(RepaymentFrequency.MONTHLY);
      expect(p.interestRateBps).toBe(1400);
      expect(p.minAmountPaise).toBe(1000000n);
      expect(p.maxAmountPaise).toBe(50000000n);
    });
  });

  describe('validateLoanAgainstProduct', () => {
    it('should pass valid loan application within bounds', () => {
      expect(() =>
        productService.validateLoanAgainstProduct(
          mockProduct,
          25000000n, // ₹2,50,000 (between ₹10k and ₹5L)
          12         // 12 months (between 6 and 36)
        )
      ).not.toThrow();
    });

    it('should reject application with principal below minimum amount', () => {
      expect(() =>
        productService.validateLoanAgainstProduct(
          mockProduct,
          500000n, // ₹5,000 (min is ₹10,000)
          12
        )
      ).toThrow(ValidationError);
    });

    it('should reject application with principal above maximum amount', () => {
      expect(() =>
        productService.validateLoanAgainstProduct(
          mockProduct,
          60000000n, // ₹6,00,000 (max is ₹5,00,000)
          12
        )
      ).toThrow(ValidationError);
    });

    it('should reject application with tenure below minimum tenure', () => {
      expect(() =>
        productService.validateLoanAgainstProduct(
          mockProduct,
          10000000n,
          3 // 3 months (min is 6)
        )
      ).toThrow(ValidationError);
    });

    it('should reject application with tenure above maximum tenure', () => {
      expect(() =>
        productService.validateLoanAgainstProduct(
          mockProduct,
          10000000n,
          48 // 48 months (max is 36)
        )
      ).toThrow(ValidationError);
    });

    it('should reject application for inactive product', () => {
      const inactiveProduct: LoanProduct = {
        ...mockProduct,
        isActive: false,
      };

      expect(() =>
        productService.validateLoanAgainstProduct(inactiveProduct, 10000000n, 12)
      ).toThrow("is inactive and cannot be applied for");
    });
  });
});
