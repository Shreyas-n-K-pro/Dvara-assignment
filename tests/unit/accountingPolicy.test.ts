import {
  defaultAccountingPolicy,
  DisbursementPolicyParams,
  RepaymentPolicyParams,
  AccrualPolicyParams,
} from '../../src/modules/ledger/policy';
import { EntryType } from '@prisma/client';
import { ValidationError } from '../../src/utils/errors';

describe('Accounting Policy Unit Tests', () => {
  const accountIds = {
    cashBank: 'acc-cash-bank',
    loansReceivable: 'acc-loans-receivable',
    interestReceivable: 'acc-interest-receivable',
    penaltyReceivable: 'acc-penalty-receivable',
    interestIncome: 'acc-interest-income',
    penaltyIncome: 'acc-penalty-income',
  };

  describe('Loan Disbursement Policy', () => {
    it('should build a balanced disbursement transaction', () => {
      const params: DisbursementPolicyParams = {
        loanId: 'loan-1',
        amountPaise: 5000000n, // ₹50,000
        cashBankAccountId: accountIds.cashBank,
        loansReceivableAccountId: accountIds.loansReceivable,
      };

      const tx = defaultAccountingPolicy.buildDisbursementTransaction(params);

      expect(tx.entries).toHaveLength(2);

      const debit = tx.entries.find((e) => e.entryType === EntryType.DEBIT);
      const credit = tx.entries.find((e) => e.entryType === EntryType.CREDIT);

      expect(debit).toBeDefined();
      expect(credit).toBeDefined();
      expect(debit?.ledgerAccountId).toBe(accountIds.loansReceivable);
      expect(debit?.amountPaise).toBe(5000000n);
      expect(credit?.ledgerAccountId).toBe(accountIds.cashBank);
      expect(credit?.amountPaise).toBe(5000000n);
    });

    it('should throw on zero or negative disbursement amount', () => {
      expect(() =>
        defaultAccountingPolicy.buildDisbursementTransaction({
          loanId: 'loan-1',
          amountPaise: 0n,
          cashBankAccountId: accountIds.cashBank,
          loansReceivableAccountId: accountIds.loansReceivable,
        })
      ).toThrow(ValidationError);
    });
  });

  describe('Repayment Policy', () => {
    it('should build balanced repayment splitting principal, accrued interest, and accrued penalty', () => {
      const params: RepaymentPolicyParams = {
        loanId: 'loan-1',
        cashBankAccountId: accountIds.cashBank,
        principalPaise: 400000n, // ₹4,000
        loansReceivableAccountId: accountIds.loansReceivable,
        interestAccruedCollectedPaise: 50000n, // ₹500
        interestReceivableAccountId: accountIds.interestReceivable,
        penaltyAccruedCollectedPaise: 10000n, // ₹100
        penaltyReceivableAccountId: accountIds.penaltyReceivable,
      };

      const tx = defaultAccountingPolicy.buildRepaymentTransaction(params);

      const debit = tx.entries.find((e) => e.entryType === EntryType.DEBIT);
      expect(debit?.amountPaise).toBe(460000n); // 400000 + 50000 + 10000
      expect(debit?.ledgerAccountId).toBe(accountIds.cashBank);

      const credits = tx.entries.filter((e) => e.entryType === EntryType.CREDIT);
      expect(credits).toHaveLength(3);

      const totalCredits = credits.reduce((sum, e) => sum + e.amountPaise, 0n);
      expect(totalCredits).toBe(460000n);
      expect(debit?.amountPaise).toBe(totalCredits);
    });

    it('should credit income accounts for unaccrued interest or penalty collections', () => {
      const params: RepaymentPolicyParams = {
        loanId: 'loan-1',
        cashBankAccountId: accountIds.cashBank,
        principalPaise: 100000n,
        loansReceivableAccountId: accountIds.loansReceivable,
        interestDirectCollectedPaise: 25000n, // Direct interest income
        interestIncomeAccountId: accountIds.interestIncome,
        penaltyDirectCollectedPaise: 5000n, // Direct penalty income
        penaltyIncomeAccountId: accountIds.penaltyIncome,
      };

      const tx = defaultAccountingPolicy.buildRepaymentTransaction(params);

      const debit = tx.entries.find((e) => e.entryType === EntryType.DEBIT);
      expect(debit?.amountPaise).toBe(130000n);

      const incomeCredit = tx.entries.find(
        (e) => e.ledgerAccountId === accountIds.interestIncome
      );
      expect(incomeCredit?.amountPaise).toBe(25000n);

      const penaltyCredit = tx.entries.find(
        (e) => e.ledgerAccountId === accountIds.penaltyIncome
      );
      expect(penaltyCredit?.amountPaise).toBe(5000n);
    });

    it('should throw if total repayment is zero', () => {
      expect(() =>
        defaultAccountingPolicy.buildRepaymentTransaction({
          loanId: 'loan-1',
          cashBankAccountId: accountIds.cashBank,
          principalPaise: 0n,
          loansReceivableAccountId: accountIds.loansReceivable,
        })
      ).toThrow(ValidationError);
    });
  });

  describe('Accrual Policy', () => {
    it('should build balanced interest accrual transaction', () => {
      const params: AccrualPolicyParams = {
        loanId: 'loan-1',
        amountPaise: 75000n,
        receivableAccountId: accountIds.interestReceivable,
        incomeAccountId: accountIds.interestIncome,
        type: 'INTEREST',
      };

      const tx = defaultAccountingPolicy.buildAccrualTransaction(params);

      expect(tx.entries).toHaveLength(2);
      expect(tx.entries[0].entryType).toBe(EntryType.DEBIT);
      expect(tx.entries[0].ledgerAccountId).toBe(accountIds.interestReceivable);
      expect(tx.entries[0].amountPaise).toBe(75000n);
      expect(tx.entries[1].entryType).toBe(EntryType.CREDIT);
      expect(tx.entries[1].ledgerAccountId).toBe(accountIds.interestIncome);
      expect(tx.entries[1].amountPaise).toBe(75000n);
    });

    it('should build balanced penalty accrual transaction', () => {
      const params: AccrualPolicyParams = {
        loanId: 'loan-1',
        amountPaise: 15000n,
        receivableAccountId: accountIds.penaltyReceivable,
        incomeAccountId: accountIds.penaltyIncome,
        type: 'PENALTY',
      };

      const tx = defaultAccountingPolicy.buildAccrualTransaction(params);

      expect(tx.entries).toHaveLength(2);
      expect(tx.entries[0].entryType).toBe(EntryType.DEBIT);
      expect(tx.entries[0].ledgerAccountId).toBe(accountIds.penaltyReceivable);
      expect(tx.entries[1].entryType).toBe(EntryType.CREDIT);
      expect(tx.entries[1].ledgerAccountId).toBe(accountIds.penaltyIncome);
    });

    it('should throw on zero or negative accrual amount', () => {
      expect(() =>
        defaultAccountingPolicy.buildAccrualTransaction({
          loanId: 'loan-1',
          amountPaise: 0n,
          receivableAccountId: accountIds.interestReceivable,
          incomeAccountId: accountIds.interestIncome,
          type: 'INTEREST',
        })
      ).toThrow(ValidationError);
    });
  });
});
