import prisma from '../../src/config/database';
import { ledgerService } from '../../src/modules/ledger/ledger.service';
import { defaultAccountingPolicy } from '../../src/modules/ledger/policy';
import { LedgerAccountType, EntryType, Loan } from '@prisma/client';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from '../../src/utils/errors';

describe('Double-Entry Accounting Ledger Integration Tests', () => {
  let cashAccount: { id: string };
  let loansRecAccount: { id: string };
  let interestRecAccount: { id: string };
  let penaltyRecAccount: { id: string };
  let interestIncomeAccount: { id: string };
  let penaltyIncomeAccount: { id: string };

  let testLoan: Loan;
  let testLoanId: string;

  beforeAll(async () => {
    // 1. Create a real User, Borrower, and Loan for valid foreign key references
    const user = await prisma.user.create({
      data: {
        email: `officer-${Date.now()}@dvara.com`,
        password: 'test-hash-password',
        name: 'Test Officer',
      },
    });

    const borrower = await prisma.borrower.create({
      data: {
        borrowerCode: `BW-${Date.now()}`,
        firstName: 'Ledger',
        lastName: 'Borrower',
        phone: '9876543210',
        createdById: user.id,
      },
    });

    let product = await prisma.loanProduct.findFirst();
    if (!product) {
      product = await prisma.loanProduct.create({
        data: {
          name: `Test Product ${Date.now()}`,
          interestRateBps: 1200,
          minTenureMonths: 6,
          maxTenureMonths: 60,
          minAmountPaise: 1000000n,
          maxAmountPaise: 50000000n,
        },
      });
    }

    testLoan = await prisma.loan.create({
      data: {
        loanNumber: `LN-${Date.now()}`,
        borrowerId: borrower.id,
        productId: product.id,
        principalPaise: 10000000n,
        interestRateBps: 1200,
        tenureMonths: 12,
      },
    });
    testLoanId = testLoan.id;

    // 2. Set up dedicated test accounts
    cashAccount = await ledgerService.createAccount({
      name: `Test Cash/Bank ${Date.now()}`,
      accountType: LedgerAccountType.ASSET,
    });

    loansRecAccount = await ledgerService.createAccount({
      name: `Loans Receivable - Principal`,
      accountType: LedgerAccountType.ASSET,
      loanId: testLoanId,
    });

    interestRecAccount = await ledgerService.createAccount({
      name: `Interest Receivable`,
      accountType: LedgerAccountType.ASSET,
      loanId: testLoanId,
    });

    penaltyRecAccount = await ledgerService.createAccount({
      name: `Penalty Receivable`,
      accountType: LedgerAccountType.ASSET,
      loanId: testLoanId,
    });

    interestIncomeAccount = await ledgerService.createAccount({
      name: `Test Interest Income ${Date.now()}`,
      accountType: LedgerAccountType.INCOME,
    });

    penaltyIncomeAccount = await ledgerService.createAccount({
      name: `Test Penalty Income ${Date.now()}`,
      accountType: LedgerAccountType.INCOME,
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('1. Ledger Account Creation & Validation', () => {
    it('should create a valid ledger account', async () => {
      const account = await ledgerService.createAccount({
        name: `Test Asset Account ${Date.now()}`,
        accountType: LedgerAccountType.ASSET,
      });

      expect(account.id).toBeDefined();
      expect(account.isActive).toBe(true);
    });

    it('should reject duplicate account name for the same scope', async () => {
      const name = `Duplicate Test Account ${Date.now()}`;
      await ledgerService.createAccount({
        name,
        accountType: LedgerAccountType.LIABILITY,
      });

      await expect(
        ledgerService.createAccount({
          name,
          accountType: LedgerAccountType.LIABILITY,
        })
      ).rejects.toThrow(ConflictError);
    });

    it('should reject empty account name', async () => {
      await expect(
        ledgerService.createAccount({
          name: '',
          accountType: LedgerAccountType.ASSET,
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('2. Loan Disbursement Balances', () => {
    it('should post disbursement and update loan principal outstanding', async () => {
      const disbursementAmount = 10000000n; // ₹1,00,000

      const dto = defaultAccountingPolicy.buildDisbursementTransaction({
        loanId: testLoanId,
        amountPaise: disbursementAmount,
        loansReceivableAccountId: loansRecAccount.id,
        cashBankAccountId: cashAccount.id,
      });

      const tx = await ledgerService.postTransaction(dto);

      expect(tx.posted).toBe(true);
      expect(tx.entries).toHaveLength(2);

      // Verify Loans Receivable balance (Asset: Debits - Credits)
      const loansRecBal = await ledgerService.getAccountBalance(loansRecAccount.id);
      expect(loansRecBal.debitTotalPaise).toBe(disbursementAmount);
      expect(loansRecBal.creditTotalPaise).toBe(0n);
      expect(loansRecBal.netBalancePaise).toBe(disbursementAmount);

      // Verify Cash/Bank balance (Asset: Credits increased)
      const cashBal = await ledgerService.getAccountBalance(cashAccount.id);
      expect(cashBal.creditTotalPaise).toBe(disbursementAmount);

      // Verify derived loan outstanding
      const outstanding = await ledgerService.getLoanOutstanding(testLoanId);
      expect(outstanding.principalOutstandingPaise).toBe(disbursementAmount);
      expect(outstanding.interestOutstandingPaise).toBe(0n);
      expect(outstanding.penaltyOutstandingPaise).toBe(0n);
      expect(outstanding.totalOutstandingPaise).toBe(disbursementAmount);
    });
  });

  describe('3. Interest & Penalty Accrual Balances', () => {
    it('should accrue interest and update loan interest outstanding', async () => {
      const interestAmount = 100000n; // ₹1,000

      const dto = defaultAccountingPolicy.buildAccrualTransaction({
        loanId: testLoanId,
        amountPaise: interestAmount,
        receivableAccountId: interestRecAccount.id,
        incomeAccountId: interestIncomeAccount.id,
        type: 'INTEREST',
      });

      await ledgerService.postTransaction(dto);

      // Verify Interest Receivable balance (Asset: Debit balance)
      const recBal = await ledgerService.getAccountBalance(interestRecAccount.id);
      expect(recBal.netBalancePaise).toBe(interestAmount);

      // Verify Interest Income balance (Income: Credit balance)
      const incBal = await ledgerService.getAccountBalance(interestIncomeAccount.id);
      expect(incBal.netBalancePaise).toBe(interestAmount);

      // Verify derived loan outstanding includes interest
      const outstanding = await ledgerService.getLoanOutstanding(testLoanId);
      expect(outstanding.principalOutstandingPaise).toBe(10000000n);
      expect(outstanding.interestOutstandingPaise).toBe(interestAmount);
      expect(outstanding.totalOutstandingPaise).toBe(10000000n + interestAmount);
    });

    it('should accrue penalty and update loan penalty outstanding', async () => {
      const penaltyAmount = 25000n; // ₹250

      const dto = defaultAccountingPolicy.buildAccrualTransaction({
        loanId: testLoanId,
        amountPaise: penaltyAmount,
        receivableAccountId: penaltyRecAccount.id,
        incomeAccountId: penaltyIncomeAccount.id,
        type: 'PENALTY',
      });

      await ledgerService.postTransaction(dto);

      // Verify Penalty Receivable balance
      const recBal = await ledgerService.getAccountBalance(penaltyRecAccount.id);
      expect(recBal.netBalancePaise).toBe(penaltyAmount);

      // Verify Penalty Income balance
      const incBal = await ledgerService.getAccountBalance(penaltyIncomeAccount.id);
      expect(incBal.netBalancePaise).toBe(penaltyAmount);

      // Verify total loan outstanding
      const outstanding = await ledgerService.getLoanOutstanding(testLoanId);
      expect(outstanding.penaltyOutstandingPaise).toBe(penaltyAmount);
      expect(outstanding.totalOutstandingPaise).toBe(10000000n + 100000n + penaltyAmount);
    });
  });

  describe('4. Repayment Balances & Allocation', () => {
    it('should process repayment and reduce principal and receivable balances', async () => {
      // Repay ₹10,000 principal + ₹1,000 accrued interest + ₹250 accrued penalty = ₹11,250
      const principalPaid = 1000000n; // ₹10,000
      const interestPaid = 100000n;   // ₹1,000
      const penaltyPaid = 25000n;     // ₹250

      const dto = defaultAccountingPolicy.buildRepaymentTransaction({
        loanId: testLoanId,
        cashBankAccountId: cashAccount.id,
        principalPaise: principalPaid,
        loansReceivableAccountId: loansRecAccount.id,
        interestAccruedCollectedPaise: interestPaid,
        interestReceivableAccountId: interestRecAccount.id,
        penaltyAccruedCollectedPaise: penaltyPaid,
        penaltyReceivableAccountId: penaltyRecAccount.id,
      });

      const tx = await ledgerService.postTransaction(dto);
      expect(tx.posted).toBe(true);

      // Verify Interest Receivable is completely cleared to 0
      const intRecBal = await ledgerService.getAccountBalance(interestRecAccount.id);
      expect(intRecBal.netBalancePaise).toBe(0n);

      // Verify Penalty Receivable is completely cleared to 0
      const penRecBal = await ledgerService.getAccountBalance(penaltyRecAccount.id);
      expect(penRecBal.netBalancePaise).toBe(0n);

      // Verify Loans Receivable principal reduced by ₹10,000
      const loansRecBal = await ledgerService.getAccountBalance(loansRecAccount.id);
      expect(loansRecBal.netBalancePaise).toBe(9000000n); // ₹90,000 remaining

      // Verify derived loan outstanding reflects exact reduction
      const outstanding = await ledgerService.getLoanOutstanding(testLoanId);
      expect(outstanding.principalOutstandingPaise).toBe(9000000n);
      expect(outstanding.interestOutstandingPaise).toBe(0n);
      expect(outstanding.penaltyOutstandingPaise).toBe(0n);
      expect(outstanding.totalOutstandingPaise).toBe(9000000n);
    });

    it('should support direct income crediting for unaccrued interest collected', async () => {
      const directInterest = 50000n; // ₹500

      const dto = defaultAccountingPolicy.buildRepaymentTransaction({
        loanId: testLoanId,
        cashBankAccountId: cashAccount.id,
        principalPaise: 0n,
        loansReceivableAccountId: loansRecAccount.id,
        interestDirectCollectedPaise: directInterest,
        interestIncomeAccountId: interestIncomeAccount.id,
      });

      await ledgerService.postTransaction(dto);

      // Interest Income should increase directly
      const incBal = await ledgerService.getAccountBalance(interestIncomeAccount.id);
      expect(incBal.netBalancePaise).toBe(100000n + directInterest);
    });
  });

  describe('5. Transaction Reversal & Compensating Entries', () => {
    it('should reverse a transaction and restore original balances', async () => {
      // Create a standalone transaction to reverse
      const txToReverse = await ledgerService.postTransaction({
        description: 'Temporary transaction to reverse',
        entries: [
          {
            ledgerAccountId: loansRecAccount.id,
            entryType: EntryType.DEBIT,
            amountPaise: 500000n,
          },
          {
            ledgerAccountId: cashAccount.id,
            entryType: EntryType.CREDIT,
            amountPaise: 500000n,
          },
        ],
      });

      const balBefore = await ledgerService.getAccountBalance(loansRecAccount.id);

      // Execute reversal
      const reversalTx = await ledgerService.reverseTransaction(
        txToReverse.id,
        'Correction reversal'
      );

      expect(reversalTx.posted).toBe(true);
      expect(reversalTx.reversalOfId).toBe(txToReverse.id);

      // Verify contra entries: original DEBIT became CREDIT
      const contraCredit = reversalTx.entries.find(
        (e) => e.ledgerAccountId === loansRecAccount.id
      );
      expect(contraCredit?.entryType).toBe(EntryType.CREDIT);
      expect(contraCredit?.amountPaise).toBe(500000n);

      // Verify balance restored to pre-transaction level
      const balAfter = await ledgerService.getAccountBalance(loansRecAccount.id);
      expect(balAfter.netBalancePaise).toBe(balBefore.netBalancePaise - 500000n);
    });

    it('should reject double reversal of the same transaction', async () => {
      const tx = await ledgerService.postTransaction({
        description: 'Single-use transaction',
        entries: [
          {
            ledgerAccountId: loansRecAccount.id,
            entryType: EntryType.DEBIT,
            amountPaise: 100000n,
          },
          {
            ledgerAccountId: cashAccount.id,
            entryType: EntryType.CREDIT,
            amountPaise: 100000n,
          },
        ],
      });

      // First reversal succeeds
      await ledgerService.reverseTransaction(tx.id);

      // Second reversal must be rejected
      await expect(ledgerService.reverseTransaction(tx.id)).rejects.toThrow(
        ConflictError
      );
    });

    it('should throw NotFoundError when reversing a non-existent transaction', async () => {
      await expect(
        ledgerService.reverseTransaction('non-existent-tx-id')
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('6. Trial Balance Verification', () => {
    it('should prove that total debits strictly equal total credits across all accounts', async () => {
      const trialBalance = await ledgerService.getTrialBalance();

      expect(trialBalance.isBalanced).toBe(true);
      expect(trialBalance.differencePaise).toBe(0n);
      expect(trialBalance.totalDebitsPaise).toBe(trialBalance.totalCreditsPaise);
      expect(trialBalance.totalDebitsPaise).toBeGreaterThan(0n);
      expect(trialBalance.accounts.length).toBeGreaterThan(0);
    });
  });

  describe('7. Invalid Posting Rejection & Error Rules', () => {
    it('should reject unbalanced transactions (SUM(DEBIT) != SUM(CREDIT))', async () => {
      await expect(
        ledgerService.postTransaction({
          description: 'Unbalanced transaction',
          entries: [
            {
              ledgerAccountId: loansRecAccount.id,
              entryType: EntryType.DEBIT,
              amountPaise: 100000n,
            },
            {
              ledgerAccountId: cashAccount.id,
              entryType: EntryType.CREDIT,
              amountPaise: 90000n, // Unbalanced by 10,000 paise
            },
          ],
        })
      ).rejects.toThrow('Transaction unbalanced');
    });

    it('should reject transactions missing debit entries', async () => {
      await expect(
        ledgerService.postTransaction({
          description: 'Credits only',
          entries: [
            {
              ledgerAccountId: cashAccount.id,
              entryType: EntryType.CREDIT,
              amountPaise: 100000n,
            },
            {
              ledgerAccountId: interestIncomeAccount.id,
              entryType: EntryType.CREDIT,
              amountPaise: 100000n,
            },
          ],
        })
      ).rejects.toThrow('missing debit entries');
    });

    it('should reject transactions missing credit entries', async () => {
      await expect(
        ledgerService.postTransaction({
          description: 'Debits only',
          entries: [
            {
              ledgerAccountId: loansRecAccount.id,
              entryType: EntryType.DEBIT,
              amountPaise: 100000n,
            },
            {
              ledgerAccountId: interestRecAccount.id,
              entryType: EntryType.DEBIT,
              amountPaise: 100000n,
            },
          ],
        })
      ).rejects.toThrow('missing credit entries');
    });

    it('should reject transactions with zero amount entries', async () => {
      await expect(
        ledgerService.postTransaction({
          description: 'Zero amount entry',
          entries: [
            {
              ledgerAccountId: loansRecAccount.id,
              entryType: EntryType.DEBIT,
              amountPaise: 0n,
            },
            {
              ledgerAccountId: cashAccount.id,
              entryType: EntryType.CREDIT,
              amountPaise: 0n,
            },
          ],
        })
      ).rejects.toThrow('must be strictly greater than zero');
    });

    it('should reject transactions with negative amount entries', async () => {
      await expect(
        ledgerService.postTransaction({
          description: 'Negative amount entry',
          entries: [
            {
              ledgerAccountId: loansRecAccount.id,
              entryType: EntryType.DEBIT,
              amountPaise: -1000n,
            },
            {
              ledgerAccountId: cashAccount.id,
              entryType: EntryType.CREDIT,
              amountPaise: -1000n,
            },
          ],
        })
      ).rejects.toThrow('must be strictly greater than zero');
    });

    it('should reject transactions referencing non-existent accounts', async () => {
      await expect(
        ledgerService.postTransaction({
          description: 'Non-existent account',
          entries: [
            {
              ledgerAccountId: 'non-existent-account-id',
              entryType: EntryType.DEBIT,
              amountPaise: 50000n,
            },
            {
              ledgerAccountId: cashAccount.id,
              entryType: EntryType.CREDIT,
              amountPaise: 50000n,
            },
          ],
        })
      ).rejects.toThrow(NotFoundError);
    });

    it('should reject posting to inactive accounts', async () => {
      const inactiveAccount = await prisma.ledgerAccount.create({
        data: {
          name: `Inactive Account ${Date.now()}`,
          accountType: LedgerAccountType.ASSET,
          isActive: false,
        },
      });

      await expect(
        ledgerService.postTransaction({
          description: 'Post to inactive',
          entries: [
            {
              ledgerAccountId: inactiveAccount.id,
              entryType: EntryType.DEBIT,
              amountPaise: 50000n,
            },
            {
              ledgerAccountId: cashAccount.id,
              entryType: EntryType.CREDIT,
              amountPaise: 50000n,
            },
          ],
        })
      ).rejects.toThrow('Cannot post to inactive ledger account');
    });
  });

  describe('8. Transaction Rollback & Atomicity', () => {
    it('should roll back completely if any entry fails validation inside the transaction', async () => {
      const initialTxCount = await prisma.ledgerTransaction.count();
      const initialEntryCount = await prisma.ledgerEntry.count();

      await expect(
        ledgerService.postTransaction({
          description: 'Rollback test',
          entries: [
            {
              ledgerAccountId: loansRecAccount.id,
              entryType: EntryType.DEBIT,
              amountPaise: 500000n,
            },
            {
              ledgerAccountId: 'non-existent-account',
              entryType: EntryType.CREDIT,
              amountPaise: 500000n,
            },
          ],
        })
      ).rejects.toThrow();

      // Ensure no rows were committed
      const finalTxCount = await prisma.ledgerTransaction.count();
      const finalEntryCount = await prisma.ledgerEntry.count();

      expect(finalTxCount).toBe(initialTxCount);
      expect(finalEntryCount).toBe(initialEntryCount);
    });
  });

  describe('9. Immutability Controls', () => {
    it('should forbid updating posted entries through application controls', async () => {
      await expect(ledgerService.updateEntry()).rejects.toThrow(ForbiddenError);
    });

    it('should forbid deleting posted entries through application controls', async () => {
      await expect(ledgerService.deleteEntry()).rejects.toThrow(ForbiddenError);
    });
  });
});
