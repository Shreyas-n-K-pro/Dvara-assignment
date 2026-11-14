import request from 'supertest';
import app from '../../src/app';
import prisma from '../../src/config/database';
import { ledgerService } from '../../src/modules/ledger/ledger.service';
import { EntryType, LoanStatus, InstallmentStatus, LoanProduct } from '@prisma/client';
import { randomUUID } from 'crypto';

describe('PHASE 5 – Concurrent Repayment Safety Integration Tests', () => {
  let testUser: { id: string; email: string };
  let testBorrower: { id: string; borrowerCode: string };
  let zeroInterestProduct: LoanProduct;

  beforeAll(async () => {
    // 1. Create officer user
    const email = `concurrency-officer-${Date.now()}@dvara.test`;
    testUser = await prisma.user.create({
      data: {
        email,
        password: 'hashed-password',
        name: 'Concurrency Officer',
        role: 'OFFICER',
      },
    });

    // 2. Create borrower
    testBorrower = await prisma.borrower.create({
      data: {
        borrowerCode: `BOR-CC-${Date.now()}`,
        firstName: 'Ramesh',
        lastName: 'Kumar',
        phone: '9123456789',
        createdById: testUser.id,
      },
    });

    // 3. Create loan product with 0% interest to purely test principal contention
    zeroInterestProduct = await prisma.loanProduct.create({
      data: {
        name: `Concurrency Test Product ${Date.now()}`,
        interestRateBps: 0,
        minAmountPaise: 10000n,
        maxAmountPaise: 100000000n,
        minTenureMonths: 1,
        maxTenureMonths: 24,
        repaymentFrequency: 'MONTHLY',
        interestType: 'FLAT',
      },
    });
  });

  afterAll(async () => {
    try {
      await prisma.$executeRaw`SET FOREIGN_KEY_CHECKS = 0;`;
      await prisma.repaymentAllocation.deleteMany();
      await prisma.repayment.deleteMany();
      await prisma.idempotencyKey.deleteMany();
      await prisma.repaymentSchedule.deleteMany();
      await prisma.ledgerEntry.deleteMany();
      await prisma.ledgerTransaction.deleteMany();
      await prisma.ledgerAccount.deleteMany();
      await prisma.loan.deleteMany();
      await prisma.loanProduct.deleteMany();
      await prisma.borrower.deleteMany();
      await prisma.auditLog.deleteMany();
      await prisma.user.deleteMany();
      await prisma.$executeRaw`SET FOREIGN_KEY_CHECKS = 1;`;
    } finally {
      await prisma.$disconnect();
    }
  });

  /**
   * Helper to create and disburse a loan with exact principal and 0 interest.
   */
  async function createDisbursedLoan(principalPaise: bigint = 1000000n) {
    const loan = await prisma.loan.create({
      data: {
        loanNumber: `LN-CC-${randomUUID().substring(0, 8)}`,
        borrowerId: testBorrower.id,
        productId: zeroInterestProduct.id,
        principalPaise,
        interestRateBps: 0,
        tenureMonths: 2,
        repaymentFrequency: 'MONTHLY',
        interestType: 'FLAT',
        status: LoanStatus.ACTIVE,
        disbursedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    // Create 2 installments splitting principal equally
    const halfPrincipal = principalPaise / 2n;
    await prisma.repaymentSchedule.create({
      data: {
        loanId: loan.id,
        installmentNumber: 1,
        dueDate: new Date('2026-02-01T00:00:00.000Z'),
        principalPaise: halfPrincipal,
        interestPaise: 0n,
        totalPaise: halfPrincipal,
        status: InstallmentStatus.PENDING,
      },
    });

    await prisma.repaymentSchedule.create({
      data: {
        loanId: loan.id,
        installmentNumber: 2,
        dueDate: new Date('2026-03-01T00:00:00.000Z'),
        principalPaise: principalPaise - halfPrincipal,
        interestPaise: 0n,
        totalPaise: principalPaise - halfPrincipal,
        status: InstallmentStatus.PENDING,
      },
    });

    // Create system and loan ledger accounts
    const cashBank = await ledgerService.getOrCreateSystemAccount('Cash and Bank', 'ASSET');
    const loansReceivable = await ledgerService.getOrCreateLoanAccount(
      loan.id,
      'Loans Receivable',
      'ASSET'
    );

    // Post disbursement: Debit Loans Receivable, Credit Cash and Bank
    await ledgerService.postTransaction({
      description: `Disbursement for ${loan.loanNumber}`,
      transactionDate: new Date('2026-01-01T00:00:00.000Z'),
      entries: [
        {
          ledgerAccountId: loansReceivable.id,
          entryType: EntryType.DEBIT,
          amountPaise: principalPaise,
        },
        {
          ledgerAccountId: cashBank.id,
          entryType: EntryType.CREDIT,
          amountPaise: principalPaise,
        },
      ],
    });

    return loan;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST CASE A: Simultaneous Over-Consuming Requests (Race for Principal)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Test Case A: Competing Concurrent Repayments', () => {
    it('should allow one payment to succeed and reject the other when combined amount exceeds outstanding principal', async () => {
      // Outstanding principal: ₹10,000 (1,000,000 paise)
      const loan = await createDisbursedLoan(1000000n);

      const initialBalances = await ledgerService.getLoanBalances(loan.id);
      expect(initialBalances.principalOutstanding).toBe(1000000n);

      // Launch two simultaneous requests:
      // Payment A: ₹7,000 (700,000 paise)
      // Payment B: ₹6,000 (600,000 paise)
      const keyA = `concurrent-A-${randomUUID()}`;
      const keyB = `concurrent-B-${randomUUID()}`;

      const [resA, resB] = await Promise.all([
        request(app)
          .post('/api/repayments')
          .set('Idempotency-Key', keyA)
          .send({
            loanId: loan.id,
            amountPaise: 700000, // ₹7,000
            paymentDate: '2026-02-01T10:00:00.000Z',
            paymentReference: 'REF-CONCURRENT-A',
          }),
        request(app)
          .post('/api/repayments')
          .set('Idempotency-Key', keyB)
          .send({
            loanId: loan.id,
            amountPaise: 600000, // ₹6,000
            paymentDate: '2026-02-01T10:00:00.000Z',
            paymentReference: 'REF-CONCURRENT-B',
          }),
      ]);

      // Determine which request won the lock and succeeded
      const [succeeded, rejected] = resA.status === 201 ? [resA, resB] : [resB, resA];

      // 1. One payment succeeds (HTTP 201)
      expect(succeeded.status).toBe(201);
      expect(succeeded.body.success).toBe(true);

      // 2. One payment is rejected due to insufficient outstanding balance (HTTP 400)
      expect(rejected.status).toBe(400);
      expect(rejected.body.success).toBe(false);
      expect(rejected.body.error.code).toBe('VALIDATION_ERROR');
      expect(rejected.body.error.message).toContain('exceeds total outstanding balance');

      // 3. Outstanding principal is ₹3,000 (if ₹7,000 won) or ₹4,000 (if ₹6,000 won)
      const finalBalances = await ledgerService.getLoanBalances(loan.id);
      if (succeeded.body.data.repayment.amountPaise === '700000') {
        expect(finalBalances.principalOutstanding).toBe(300000n); // ₹3,000 (300,000 paise)
        expect(finalBalances.totalOutstanding).toBe(300000n);
      } else {
        expect(finalBalances.principalOutstanding).toBe(400000n); // ₹4,000 (400,000 paise)
        expect(finalBalances.totalOutstanding).toBe(400000n);
      }

      // 4. The ledger remains balanced
      const tb = await ledgerService.getTrialBalance();
      expect(tb.isBalanced).toBe(true);
      expect(tb.differencePaise).toBe(0n);

      // 5. Exactly 1 repayment was recorded in the database
      const repayments = await prisma.repayment.findMany({
        where: { loanId: loan.id },
      });
      expect(repayments).toHaveLength(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST CASE B: Simultaneous Identical Requests with Same Idempotency Key
  // ───────────────────────────────────────────────────────────────────────────
  describe('Test Case B: Simultaneous Duplicate Idempotency Key Requests', () => {
    it('should create exactly one repayment, one ledger transaction, and return identical successful responses', async () => {
      const loan = await createDisbursedLoan(1000000n); // ₹10,000
      const sharedKey = `shared-idem-${randomUUID()}`;

      const payload = {
        loanId: loan.id,
        amountPaise: 500000, // ₹5,000
        paymentDate: '2026-02-01T10:00:00.000Z',
        paymentReference: 'SIMULTANEOUS-IDEM-REF',
      };

      // Launch two simultaneous identical requests with the SAME key
      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/repayments')
          .set('Idempotency-Key', sharedKey)
          .send(payload),
        request(app)
          .post('/api/repayments')
          .set('Idempotency-Key', sharedKey)
          .send(payload),
      ]);

      // Both requests return successful HTTP 2xx
      expect([200, 201]).toContain(res1.status);
      expect([200, 201]).toContain(res2.status);
      expect(res1.body.success).toBe(true);
      expect(res2.body.success).toBe(true);

      // Both return the exact same repayment ID and data
      const repaymentId1 = res1.body.data.repayment.id;
      const repaymentId2 = res2.body.data.repayment.id;
      expect(repaymentId1).toBe(repaymentId2);
      expect(res1.body.data.repayment.amountPaise).toBe('500000');
      expect(res2.body.data.repayment.amountPaise).toBe('500000');

      // Exactly ONE repayment record in the database
      const repayments = await prisma.repayment.findMany({
        where: { loanId: loan.id },
      });
      expect(repayments).toHaveLength(1);

      // Exactly ONE ledger credit entry on Loans Receivable
      const accounts = await prisma.ledgerAccount.findMany({
        where: { loanId: loan.id, name: 'Loans Receivable' },
      });
      const creditEntries = await prisma.ledgerEntry.findMany({
        where: {
          ledgerAccountId: accounts[0].id,
          entryType: EntryType.CREDIT,
        },
      });
      expect(creditEntries).toHaveLength(1);
      expect(creditEntries[0].amountPaise).toBe(500000n);

      // Derived balance: ₹10,000 - ₹5,000 = ₹5,000 (500,000 paise)
      const balances = await ledgerService.getLoanBalances(loan.id);
      expect(balances.principalOutstanding).toBe(500000n);
      expect(balances.totalOutstanding).toBe(500000n);

      // Ledger is strictly balanced
      const tb = await ledgerService.getTrialBalance();
      expect(tb.isBalanced).toBe(true);
      expect(tb.differencePaise).toBe(0n);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST CASE C: Simultaneous Valid Requests within Outstanding Balance
  // ───────────────────────────────────────────────────────────────────────────
  describe('Test Case C: Simultaneous Non-Exceeding Distinct Payments', () => {
    it('should allow both payments to succeed when their combined amount is within outstanding balance', async () => {
      // Outstanding principal: ₹10,000 (1,000,000 paise)
      const loan = await createDisbursedLoan(1000000n);

      const key1 = `distinct-1-${randomUUID()}`;
      const key2 = `distinct-2-${randomUUID()}`;

      // Payment 1: ₹4,000 (400,000 paise)
      // Payment 2: ₹5,000 (500,000 paise)
      // Combined: ₹9,000 <= ₹10,000
      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/repayments')
          .set('Idempotency-Key', key1)
          .send({
            loanId: loan.id,
            amountPaise: 400000, // ₹4,000
            paymentDate: '2026-02-01T10:00:00.000Z',
            paymentReference: 'PAY-4000',
          }),
        request(app)
          .post('/api/repayments')
          .set('Idempotency-Key', key2)
          .send({
            loanId: loan.id,
            amountPaise: 500000, // ₹5,000
            paymentDate: '2026-02-01T10:00:00.000Z',
            paymentReference: 'PAY-5000',
          }),
      ]);

      // Both valid payments succeed
      expect(res1.status).toBe(201);
      expect(res1.body.success).toBe(true);
      expect(res2.status).toBe(201);
      expect(res2.body.success).toBe(true);

      // Two repayment records created
      const repayments = await prisma.repayment.findMany({
        where: { loanId: loan.id },
      });
      expect(repayments).toHaveLength(2);

      // Derived balance is correct: ₹10,000 - ₹4,000 - ₹5,000 = ₹1,000 (100,000 paise)
      const balances = await ledgerService.getLoanBalances(loan.id);
      expect(balances.principalOutstanding).toBe(100000n);
      expect(balances.totalOutstanding).toBe(100000n);

      // Ledger remains balanced
      const tb = await ledgerService.getTrialBalance();
      expect(tb.isBalanced).toBe(true);
      expect(tb.differencePaise).toBe(0n);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // MULTI-ITERATION REPEATABILITY STRESS TEST
  // ───────────────────────────────────────────────────────────────────────────
  describe('Multi-iteration Concurrency Stability', () => {
    it('should reliably maintain consistency across multiple consecutive concurrent runs', async () => {
      for (let i = 0; i < 3; i++) {
        const loan = await createDisbursedLoan(1000000n);

        const [resA, resB] = await Promise.all([
          request(app)
            .post('/api/repayments')
            .set('Idempotency-Key', `stress-A-${i}-${randomUUID()}`)
            .send({
              loanId: loan.id,
              amountPaise: 700000,
              paymentDate: '2026-02-01T10:00:00.000Z',
              paymentReference: `STRESS-A-${i}`,
            }),
          request(app)
            .post('/api/repayments')
            .set('Idempotency-Key', `stress-B-${i}-${randomUUID()}`)
            .send({
              loanId: loan.id,
              amountPaise: 600000,
              paymentDate: '2026-02-01T10:00:00.000Z',
              paymentReference: `STRESS-B-${i}`,
            }),
        ]);

        const statuses = [resA.status, resB.status].sort();
        expect(statuses).toEqual([201, 400]);

        const tb = await ledgerService.getTrialBalance();
        expect(tb.isBalanced).toBe(true);
      }
    });
  });
});
