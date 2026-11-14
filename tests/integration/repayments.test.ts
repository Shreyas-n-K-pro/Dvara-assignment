import request from 'supertest';
import app from '../../src/app';
import prisma from '../../src/config/database';
import { ledgerService } from '../../src/modules/ledger/ledger.service';
import { EntryType, LoanStatus, InstallmentStatus, LoanProduct } from '@prisma/client';
import { randomUUID } from 'crypto';

describe('Repayments API & Idempotency Integration Tests', () => {
  let testUser: { id: string; email: string };
  let testBorrower: { id: string; borrowerCode: string };
  let testProduct: LoanProduct;

  beforeAll(async () => {
    // 1. Create or find test user
    const email = `repay-officer-${Date.now()}@dvara.test`;
    testUser = await prisma.user.create({
      data: {
        email,
        password: 'hashed-password',
        name: 'Repayment Officer',
        role: 'OFFICER',
      },
    });

    // 2. Create test borrower
    const borrowerCode = `BOR-RP-${Date.now()}`;
    testBorrower = await prisma.borrower.create({
      data: {
        borrowerCode,
        firstName: 'Anita',
        lastName: 'Sharma',
        phone: '9876543210',
        createdById: testUser.id,
      },
    });

    // 3. Create test loan product
    testProduct = await prisma.loanProduct.create({
      data: {
        name: `Monthly Repayment Test Loan ${Date.now()}`,
        interestRateBps: 1200, // 12%
        minAmountPaise: 100000n,
        maxAmountPaise: 100000000n,
        minTenureMonths: 1,
        maxTenureMonths: 60,
        repaymentFrequency: 'MONTHLY',
        interestType: 'FLAT',
      },
    });
  });

  afterAll(async () => {
    // Clean up created records in reverse order
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
   * Helper to create and disburse a test loan with 3 installments.
   */
  async function createDisbursedLoan(principalPaise: bigint = 300000n) {
    const loanNumber = `LN-RP-${randomUUID().substring(0, 8)}`;
    const loan = await prisma.loan.create({
      data: {
        loanNumber,
        borrowerId: testBorrower.id,
        productId: testProduct.id,
        principalPaise,
        interestRateBps: 1200,
        tenureMonths: 3,
        repaymentFrequency: 'MONTHLY',
        interestType: 'FLAT',
        status: LoanStatus.ACTIVE,
        disbursedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    // Generate 3 installments
    // Principal: 100,000 paise per installment (₹1,000)
    // Interest: 3,000 paise per installment (₹30)
    const inst1 = await prisma.repaymentSchedule.create({
      data: {
        loanId: loan.id,
        installmentNumber: 1,
        dueDate: new Date('2026-02-01T00:00:00.000Z'),
        principalPaise: 100000n,
        interestPaise: 3000n,
        totalPaise: 103000n,
        status: InstallmentStatus.PENDING,
      },
    });

    const inst2 = await prisma.repaymentSchedule.create({
      data: {
        loanId: loan.id,
        installmentNumber: 2,
        dueDate: new Date('2026-03-01T00:00:00.000Z'),
        principalPaise: 100000n,
        interestPaise: 3000n,
        totalPaise: 103000n,
        status: InstallmentStatus.PENDING,
      },
    });

    const inst3 = await prisma.repaymentSchedule.create({
      data: {
        loanId: loan.id,
        installmentNumber: 3,
        dueDate: new Date('2026-04-01T00:00:00.000Z'),
        principalPaise: 100000n,
        interestPaise: 3000n,
        totalPaise: 103000n,
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
    const interestReceivable = await ledgerService.getOrCreateLoanAccount(
      loan.id,
      'Interest Receivable',
      'ASSET'
    );
    const interestIncome = await ledgerService.getOrCreateSystemAccount('Interest Income', 'INCOME');

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

    // Post initial interest accrual: Debit Interest Receivable (9,000 paise), Credit Interest Income
    await ledgerService.postTransaction({
      description: `Interest Accrual for ${loan.loanNumber}`,
      transactionDate: new Date('2026-01-01T00:00:00.000Z'),
      entries: [
        {
          ledgerAccountId: interestReceivable.id,
          entryType: EntryType.DEBIT,
          amountPaise: 9000n,
        },
        {
          ledgerAccountId: interestIncome.id,
          entryType: EntryType.CREDIT,
          amountPaise: 9000n,
        },
      ],
    });

    return { loan, installments: [inst1, inst2, inst3] };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 1: Successful repayment
  // ───────────────────────────────────────────────────────────────────────────
  it('1. should process a successful repayment and update schedules and ledger balances', async () => {
    const { loan } = await createDisbursedLoan(300000n);
    const idempotencyKey = `idem-${randomUUID()}`;

    // Pay installment 1 in full: 103,000 paise (₹1,030: ₹1,000 principal + ₹30 interest)
    const response = await request(app)
      .post('/api/repayments')
      .set('Idempotency-Key', idempotencyKey)
      .send({
        loanId: loan.id,
        amountPaise: 103000,
        paymentDate: '2026-02-01T10:00:00.000Z',
        paymentReference: 'UPI-TXN-1001',
      })
      .expect(201);

    expect(response.body.success).toBe(true);
    const data = response.body.data;
    expect(data.repayment.id).toBeDefined();
    expect(data.repayment.amountPaise).toBe('103000');
    expect(data.repayment.allocations).toHaveLength(1);
    expect(data.repayment.allocations[0].installmentNumber).toBe(1);
    expect(data.repayment.allocations[0].interestPaise).toBe('3000');
    expect(data.repayment.allocations[0].principalPaise).toBe('100000');
    expect(data.isCached).toBe(false);

    // Verify derived balances reduced:
    // Principal was 300,000 -> now 200,000
    // Interest was 9,000 -> now 6,000
    // Total outstanding was 309,000 -> now 206,000
    expect(data.balances.principalOutstanding).toBe('200000');
    expect(data.balances.interestOutstanding).toBe('6000');
    expect(data.balances.totalOutstanding).toBe('206000');
    expect(data.loanStatus).toBe(LoanStatus.ACTIVE);

    // Verify schedule status for installment 1 is PAID
    const schedule1 = await prisma.repaymentSchedule.findUnique({
      where: { loanId_installmentNumber: { loanId: loan.id, installmentNumber: 1 } },
    });
    expect(schedule1?.status).toBe(InstallmentStatus.PAID);

    // Verify trial balance is strictly balanced
    const tb = await ledgerService.getTrialBalance();
    expect(tb.isBalanced).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 2: Repeated repayment request (Idempotency)
  // ───────────────────────────────────────────────────────────────────────────
  it('2. should return cached response and guarantee exactly one financial posting on duplicate request', async () => {
    const { loan } = await createDisbursedLoan(300000n);
    const idempotencyKey = `idem-${randomUUID()}`;

    const payload = {
      loanId: loan.id,
      amountPaise: 50000, // Partial payment: ₹500
      paymentDate: '2026-02-01T10:00:00.000Z',
      paymentReference: 'REF-IDEM-001',
    };

    // First request
    const res1 = await request(app)
      .post('/api/repayments')
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(201);

    const repaymentId1 = res1.body.data.repayment.id;
    expect(res1.body.data.isCached).toBe(false);

    // Second request with exact same key and payload
    const res2 = await request(app)
      .post('/api/repayments')
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(200);

    const repaymentId2 = res2.body.data.repayment.id;
    expect(repaymentId2).toBe(repaymentId1);
    expect(res2.body.data.isCached).toBe(true);

    // Verify exactly ONE repayment record in the database for this loan
    const repaymentCount = await prisma.repayment.count({
      where: { loanId: loan.id },
    });
    expect(repaymentCount).toBe(1);

    // Verify ledger trial balance remains balanced
    const tb = await ledgerService.getTrialBalance();
    expect(tb.isBalanced).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 3: Same key with modified amount (Conflict)
  // ───────────────────────────────────────────────────────────────────────────
  it('3. should return HTTP 409 Conflict when reusing key with different amount', async () => {
    const { loan } = await createDisbursedLoan(300000n);
    const idempotencyKey = `idem-${randomUUID()}`;

    // First request with ₹1,000
    await request(app)
      .post('/api/repayments')
      .set('Idempotency-Key', idempotencyKey)
      .send({
        loanId: loan.id,
        amountPaise: 100000,
        paymentDate: '2026-02-01T10:00:00.000Z',
        paymentReference: 'REF-CONF-001',
      })
      .expect(201);

    // Second request with SAME key but modified amount ₹2,000
    const res = await request(app)
      .post('/api/repayments')
      .set('Idempotency-Key', idempotencyKey)
      .send({
        loanId: loan.id,
        amountPaise: 200000,
        paymentDate: '2026-02-01T10:00:00.000Z',
        paymentReference: 'REF-CONF-001',
      })
      .expect(409);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.message).toContain('already been used with different request parameters');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 4: Negative amount
  // ───────────────────────────────────────────────────────────────────────────
  it('4. should reject negative repayment amount with HTTP 400', async () => {
    const { loan } = await createDisbursedLoan(300000n);

    const res = await request(app)
      .post('/api/repayments')
      .set('Idempotency-Key', `idem-${randomUUID()}`)
      .send({
        loanId: loan.id,
        amountPaise: -50000,
        paymentDate: '2026-02-01T10:00:00.000Z',
        paymentReference: 'REF-NEG',
      })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('greater than zero');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 5: Zero amount
  // ───────────────────────────────────────────────────────────────────────────
  it('5. should reject zero repayment amount with HTTP 400', async () => {
    const { loan } = await createDisbursedLoan(300000n);

    const res = await request(app)
      .post('/api/repayments')
      .set('Idempotency-Key', `idem-${randomUUID()}`)
      .send({
        loanId: loan.id,
        amountPaise: 0,
        paymentDate: '2026-02-01T10:00:00.000Z',
        paymentReference: 'REF-ZERO',
      })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('greater than zero');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 6: Closed loan repayment
  // ───────────────────────────────────────────────────────────────────────────
  it('6. should reject repayment on closed loan with HTTP 400', async () => {
    const { loan } = await createDisbursedLoan(300000n);

    // Mark loan as closed
    await prisma.loan.update({
      where: { id: loan.id },
      data: { status: LoanStatus.CLOSED, closedAt: new Date() },
    });

    const res = await request(app)
      .post('/api/repayments')
      .set('Idempotency-Key', `idem-${randomUUID()}`)
      .send({
        loanId: loan.id,
        amountPaise: 100000,
        paymentDate: '2026-02-01T10:00:00.000Z',
        paymentReference: 'REF-CLOSED',
      })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('closed loan');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 7: Overpayment
  // ──────────────────────────────────────────────────────────────────────────
  it('7. should reject overpayment exceeding total outstanding balance with HTTP 400', async () => {
    const { loan } = await createDisbursedLoan(300000n);
    // Total outstanding is 300,000 (principal) + 9,000 (interest) = 309,000 paise

    const res = await request(app)
      .post('/api/repayments')
      .set('Idempotency-Key', `idem-${randomUUID()}`)
      .send({
        loanId: loan.id,
        amountPaise: 500000, // 500,000 > 309,000
        paymentDate: '2026-02-01T10:00:00.000Z',
        paymentReference: 'REF-OVERPAY',
      })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toContain('exceeds total outstanding balance');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 8: Transaction rollback on failure
  // ───────────────────────────────────────────────────────────────────────────
  it('8. should completely roll back database state if posting fails midway', async () => {
    const { loan } = await createDisbursedLoan(300000n);
    const idempotencyKey = `idem-fail-${randomUUID()}`;

    // Deactivate the cash and bank account to trigger an atomic ledger failure
    const cashBank = await prisma.ledgerAccount.findFirst({
      where: { name: 'Cash and Bank' },
    });
    if (cashBank) {
      await prisma.ledgerAccount.update({
        where: { id: cashBank.id },
        data: { isActive: false },
      });
    }

    // Attempt repayment - will fail inside prisma.$transaction when ledger asserts account is active
    await request(app)
      .post('/api/repayments')
      .set('Idempotency-Key', idempotencyKey)
      .send({
        loanId: loan.id,
        amountPaise: 103000,
        paymentDate: '2026-02-01T10:00:00.000Z',
        paymentReference: 'REF-FAIL',
      })
      .expect(400);

    // Restore cash and bank account
    if (cashBank) {
      await prisma.ledgerAccount.update({
        where: { id: cashBank.id },
        data: { isActive: true },
      });
    }

    // Verify that NO repayment record was committed
    const repayments = await prisma.repayment.findMany({
      where: { loanId: loan.id },
    });
    expect(repayments).toHaveLength(0);

    // Verify that NO idempotency record was committed
    const keyRecord = await prisma.idempotencyKey.findUnique({
      where: { key: idempotencyKey },
    });
    expect(keyRecord).toBeNull();

    // Verify installment 1 remained PENDING
    const schedule = await prisma.repaymentSchedule.findUnique({
      where: { loanId_installmentNumber: { loanId: loan.id, installmentNumber: 1 } },
    });
    expect(schedule?.status).toBe(InstallmentStatus.PENDING);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 9: Query Endpoints
  // ───────────────────────────────────────────────────────────────────────────
  describe('Query APIs', () => {
    it('should retrieve loan balance via GET /api/loans/:id/balance', async () => {
      const { loan } = await createDisbursedLoan(300000n);

      const res = await request(app)
        .get(`/api/loans/${loan.id}/balance`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.loanId).toBe(loan.id);
      expect(res.body.data.balances.principalOutstanding).toBe('300000');
      expect(res.body.data.balances.interestOutstanding).toBe('9000');
      expect(res.body.data.balances.totalOutstanding).toBe('309000');
    });

    it('should retrieve loan schedule via GET /api/loans/:id/schedule', async () => {
      const { loan } = await createDisbursedLoan(300000n);

      const res = await request(app)
        .get(`/api/loans/${loan.id}/schedule`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.data[0].installmentNumber).toBe(1);
      expect(res.body.data[0].principalPaise).toBe('100000');
      expect(res.body.data[0].interestPaise).toBe('3000');
      expect(res.body.data[0].totalPaise).toBe('103000');
      expect(res.body.data[0].status).toBe(InstallmentStatus.PENDING);
      expect(res.body.data[0].remainingTotalPaise).toBe('103000');
    });

    it('should retrieve repayment details via GET /api/repayments/:id', async () => {
      const { loan } = await createDisbursedLoan(300000n);
      const idempotencyKey = `idem-${randomUUID()}`;

      const postRes = await request(app)
        .post('/api/repayments')
        .set('Idempotency-Key', idempotencyKey)
        .send({
          loanId: loan.id,
          amountPaise: 103000,
          paymentDate: '2026-02-01T10:00:00.000Z',
          paymentReference: 'UPI-GET-TEST',
        })
        .expect(201);

      const repaymentId = postRes.body.data.repayment.id;

      const getRes = await request(app)
        .get(`/api/repayments/${repaymentId}`)
        .expect(200);

      expect(getRes.body.success).toBe(true);
      expect(getRes.body.data.id).toBe(repaymentId);
      expect(getRes.body.data.amountPaise).toBe('103000');
      expect(getRes.body.data.allocations).toHaveLength(1);
    });

    it('should return 404 for non-existent repayment ID', async () => {
      await request(app)
        .get(`/api/repayments/${randomUUID()}`)
        .expect(404);
    });

    it('should return 400 when Idempotency-Key header is missing', async () => {
      const { loan } = await createDisbursedLoan(300000n);

      const res = await request(app)
        .post('/api/repayments')
        .send({
          loanId: loan.id,
          amountPaise: 103000,
          paymentDate: '2026-02-01T10:00:00.000Z',
          paymentReference: 'NO-KEY',
        })
        .expect(400);

      expect(res.body.error.message).toContain('Idempotency-Key header is required');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST 10: Complete Loan Payoff & Closure
  // ───────────────────────────────────────────────────────────────────────────
  it('10. should close loan automatically when total balance is fully repaid', async () => {
    const { loan } = await createDisbursedLoan(300000n);
    // Total outstanding: 309,000 paise (₹3,090)

    const res = await request(app)
      .post('/api/repayments')
      .set('Idempotency-Key', `idem-full-${randomUUID()}`)
      .send({
        loanId: loan.id,
        amountPaise: 309000,
        paymentDate: '2026-02-01T10:00:00.000Z',
        paymentReference: 'FULL-PAYOFF',
      })
      .expect(201);

    expect(res.body.data.loanStatus).toBe(LoanStatus.CLOSED);
    expect(res.body.data.balances.totalOutstanding).toBe('0');

    // Verify all 3 installments are marked PAID
    const schedules = await prisma.repaymentSchedule.findMany({
      where: { loanId: loan.id },
      orderBy: { installmentNumber: 'asc' },
    });
    for (const s of schedules) {
      expect(s.status).toBe(InstallmentStatus.PAID);
    }

    // Verify loan record in DB is CLOSED
    const closedLoan = await prisma.loan.findUnique({
      where: { id: loan.id },
    });
    expect(closedLoan?.status).toBe(LoanStatus.CLOSED);
    expect(closedLoan?.closedAt).toBeDefined();
  });
});
