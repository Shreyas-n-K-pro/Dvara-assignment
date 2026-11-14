import request from 'supertest';
import app from '../../src/app';
import prisma from '../../src/config/database';
import { authService } from '../../src/modules/auth/auth.service';
import { ledgerService } from '../../src/modules/ledger/ledger.service';
import { accrualScheduler } from '../../src/modules/accruals/accrual.scheduler';
import { accrualService } from '../../src/modules/accruals/accrual.service';
import {
  calculateDailyInterest,
  calculateDailyPenalty,
} from '../../src/modules/accruals/accrual.math';
import { UserRole, LoanStatus, InstallmentStatus, PaymentMethod } from '@prisma/client';

describe('Phase 7: Overdue Interest and Penalty Accrual Integration Tests', () => {
  let managerToken: string;
  let officerToken: string;
  let auditorToken: string;
  let managerUser: { id: string };

  let testBorrower: { id: string };
  let productWithGrace: { id: string };
  let productNoGrace: { id: string };

  beforeAll(async () => {
    // 1. Create users for testing RBAC
    const mgr = await authService.register({
      email: `mgr-accrual-${Date.now()}@test.dvara.com`,
      password: 'Password123!',
      name: 'Accrual Manager',
      role: UserRole.MANAGER,
    });
    managerToken = authService.generateToken(mgr);
    managerUser = mgr;

    const off = await authService.register({
      email: `off-accrual-${Date.now()}@test.dvara.com`,
      password: 'Password123!',
      name: 'Accrual Officer',
      role: UserRole.LOAN_OFFICER,
    });
    officerToken = authService.generateToken(off);

    const aud = await authService.register({
      email: `aud-accrual-${Date.now()}@test.dvara.com`,
      password: 'Password123!',
      name: 'Accrual Auditor',
      role: UserRole.AUDITOR,
    });
    auditorToken = authService.generateToken(aud);

    // 2. Create Borrower
    testBorrower = await prisma.borrower.create({
      data: {
        borrowerCode: `BOR-ACC-${Date.now()}`,
        firstName: 'Ramesh',
        lastName: 'Kumar',
        phone: '9876543299',
        createdById: managerUser.id,
      },
    });

    // 3. Create Loan Products: one with grace period, one without
    productWithGrace = await prisma.loanProduct.create({
      data: {
        name: `Product With Grace ${Date.now()}`,
        interestRateBps: 1200, // 12% p.a.
        penaltyRateBps: 2400,  // 24% p.a.
        gracePeriodDays: 3,    // 3 days grace
        minAmountPaise: 100000n,
        maxAmountPaise: 100000000n,
        minTenureMonths: 1,
        maxTenureMonths: 24,
        repaymentFrequency: 'MONTHLY',
        interestType: 'FLAT',
      },
    });

    productNoGrace = await prisma.loanProduct.create({
      data: {
        name: `Product No Grace ${Date.now()}`,
        interestRateBps: 1800, // 18% p.a.
        penaltyRateBps: 3600,  // 36% p.a.
        gracePeriodDays: 0,    // 0 days grace
        minAmountPaise: 100000n,
        maxAmountPaise: 100000000n,
        minTenureMonths: 1,
        maxTenureMonths: 24,
        repaymentFrequency: 'MONTHLY',
        interestType: 'FLAT',
      },
    });
  });

  afterAll(async () => {
    accrualScheduler.stop();
    try {
      await prisma.$executeRaw`SET FOREIGN_KEY_CHECKS = 0;`;
      await prisma.accrualRecord.deleteMany();
      await prisma.auditLog.deleteMany();
      await prisma.repaymentAllocation.deleteMany();
      await prisma.repayment.deleteMany();
      await prisma.idempotencyKey.deleteMany();
      await prisma.repaymentSchedule.deleteMany();
      await prisma.ledgerEntry.deleteMany();
      await prisma.ledgerTransaction.deleteMany();
      await prisma.ledgerAccount.deleteMany();
      await prisma.loan.deleteMany();
      await prisma.borrower.deleteMany();
      await prisma.loanProduct.deleteMany();
      await prisma.user.deleteMany();
      await prisma.$executeRaw`SET FOREIGN_KEY_CHECKS = 1;`;
    } catch {
      // Ignore cleanup error
    }
  });

  describe('1. Overdue Instalment Identification & Calculation', () => {
    let overdueLoanId: string;
    let scheduleId: string;
    const principalPaise = 10000000n; // ₹100,000
    const interestPaise = 100000n;    // ₹1,000
    const totalPaise = principalPaise + interestPaise;

    beforeAll(async () => {
      // Create an active loan with an installment past due date
      const loan = await prisma.loan.create({
        data: {
          loanNumber: `LN-OVD-${Date.now()}`,
          borrowerId: testBorrower.id,
          productId: productNoGrace.id,
          principalPaise,
          interestRateBps: 1800, // 18%
          tenureMonths: 1,
          status: LoanStatus.ACTIVE,
          disbursedAt: new Date('2026-01-01T00:00:00Z'),
        },
      });
      overdueLoanId = loan.id;

      // Create overdue installment: dueDate was Jan 15, 2026
      const schedule = await prisma.repaymentSchedule.create({
        data: {
          loanId: loan.id,
          installmentNumber: 1,
          dueDate: new Date('2026-01-15T00:00:00Z'),
          principalPaise,
          interestPaise,
          totalPaise,
          status: InstallmentStatus.PENDING,
        },
      });
      scheduleId = schedule.id;
    });

    it('should identify overdue installment, calculate daily interest and penalty, and post balanced ledger entries', async () => {
      // Evaluate as of Jan 20, 2026 (5 days past due)
      const asOfDate = new Date('2026-01-20T00:00:00Z');

      const summary = await accrualService.processOverdueAccruals(
        { asOfDate, loanId: overdueLoanId },
        managerUser.id
      );

      expect(summary.activeLoansChecked).toBe(1);
      expect(summary.overdueInstalmentsFound).toBe(1);
      expect(summary.interestAccrualsCreated).toBe(1);
      expect(summary.penaltyAccrualsCreated).toBe(1);

      // Verify exact daily interest: ₹100,000 at 18% / 365 = 4931.5 paise -> 4932 paise
      const expectedInterest = calculateDailyInterest(principalPaise, 1800);
      expect(summary.totalInterestAccruedPaise).toBe(expectedInterest);

      // Verify exact daily penalty: ₹101,000 at 36% / 365 = 9961.64 paise -> 9962 paise
      const expectedPenalty = calculateDailyPenalty(totalPaise, 3600);
      expect(summary.totalPenaltyAccruedPaise).toBe(expectedPenalty);

      // Verify installment status transitioned to OVERDUE
      const updatedSchedule = await prisma.repaymentSchedule.findUnique({
        where: { id: scheduleId },
      });
      expect(updatedSchedule?.status).toBe(InstallmentStatus.OVERDUE);

      // Verify AccrualRecords created in database
      const records = await prisma.accrualRecord.findMany({
        where: { scheduleId },
      });
      expect(records.length).toBe(2);
      expect(records.some((r) => r.accrualType === 'INTEREST' && r.amountPaise === expectedInterest)).toBe(true);
      expect(records.some((r) => r.accrualType === 'PENALTY' && r.amountPaise === expectedPenalty)).toBe(true);

      // Verify Trial Balance remains balanced
      const trialBalance = await ledgerService.getTrialBalance();
      expect(trialBalance.isBalanced).toBe(true);
      expect(trialBalance.differencePaise).toBe(0n);
    });
  });

  describe('2. Configurable Grace Period Business Policy', () => {
    let graceLoanId: string;
    const dueDate = new Date('2026-05-10T00:00:00Z');

    beforeAll(async () => {
      // Product has 3 days grace period (grace covers May 10, 11, 12, 13)
      const loan = await prisma.loan.create({
        data: {
          loanNumber: `LN-GRC-${Date.now()}`,
          borrowerId: testBorrower.id,
          productId: productWithGrace.id,
          principalPaise: 5000000n,
          interestRateBps: 1200,
          tenureMonths: 1,
          status: LoanStatus.ACTIVE,
          disbursedAt: new Date('2026-04-10T00:00:00Z'),
        },
      });
      graceLoanId = loan.id;

      await prisma.repaymentSchedule.create({
        data: {
          loanId: loan.id,
          installmentNumber: 1,
          dueDate,
          principalPaise: 5000000n,
          interestPaise: 50000n,
          totalPaise: 5050000n,
          status: InstallmentStatus.PENDING,
        },
      });
    });

    it('should NOT accrue overdue interest or penalty when evaluation is within grace period', async () => {
      // Within grace: May 12, 2026 (dueDate + 2 days, grace is 3 days)
      const asOfDate = new Date('2026-05-12T00:00:00Z');

      const summary = await accrualService.processOverdueAccruals(
        { asOfDate, loanId: graceLoanId },
        managerUser.id
      );

      expect(summary.skippedDueToGracePeriod).toBe(1);
      expect(summary.interestAccrualsCreated).toBe(0);
      expect(summary.penaltyAccrualsCreated).toBe(0);
    });

    it('should NOT accrue overdue interest or penalty on grace cutoff date itself', async () => {
      // On grace cutoff date: May 13, 2026 (dueDate + 3 days)
      const asOfDate = new Date('2026-05-13T00:00:00Z');

      const summary = await accrualService.processOverdueAccruals(
        { asOfDate, loanId: graceLoanId },
        managerUser.id
      );

      expect(summary.skippedDueToGracePeriod).toBe(1);
      expect(summary.interestAccrualsCreated).toBe(0);
      expect(summary.penaltyAccrualsCreated).toBe(0);
    });

    it('should accrue interest and penalty immediately once evaluation is past grace cutoff', async () => {
      // Past grace: May 14, 2026 (dueDate + 4 days)
      const asOfDate = new Date('2026-05-14T00:00:00Z');

      const summary = await accrualService.processOverdueAccruals(
        { asOfDate, loanId: graceLoanId },
        managerUser.id
      );

      expect(summary.overdueInstalmentsFound).toBe(1);
      expect(summary.interestAccrualsCreated).toBe(1);
      expect(summary.penaltyAccrualsCreated).toBe(1);
    });
  });

  describe('3. Partial Payments Handling', () => {
    let partialLoanId: string;
    let partialScheduleId: string;
    const initialPrincipal = 10000000n; // ₹100,000
    const initialInterest = 100000n;     // ₹1,000
    const totalAmount = initialPrincipal + initialInterest; // ₹101,000

    beforeAll(async () => {
      const loan = await prisma.loan.create({
        data: {
          loanNumber: `LN-PART-${Date.now()}`,
          borrowerId: testBorrower.id,
          productId: productNoGrace.id,
          principalPaise: initialPrincipal,
          interestRateBps: 1800,
          tenureMonths: 1,
          status: LoanStatus.ACTIVE,
          disbursedAt: new Date('2026-01-01T00:00:00Z'),
        },
      });
      partialLoanId = loan.id;

      const schedule = await prisma.repaymentSchedule.create({
        data: {
          loanId: loan.id,
          installmentNumber: 1,
          dueDate: new Date('2026-01-10T00:00:00Z'),
          principalPaise: initialPrincipal,
          interestPaise: initialInterest,
          totalPaise: totalAmount,
          status: InstallmentStatus.PARTIALLY_PAID,
        },
      });
      partialScheduleId = schedule.id;

      // Simulate partial payment of ₹60,000: ₹1,000 interest and ₹59,000 principal
      const repayment = await prisma.repayment.create({
        data: {
          loanId: loan.id,
          amountPaise: 6000000n,
          paymentDate: new Date('2026-01-12T00:00:00Z'),
          paymentMethod: PaymentMethod.BANK_TRANSFER,
          referenceNumber: 'PARTIAL-REF-1',
        },
      });

      await prisma.repaymentAllocation.create({
        data: {
          repaymentId: repayment.id,
          scheduleId: schedule.id,
          principalPaise: 5900000n, // ₹59,000 principal paid
          interestPaise: 100000n,   // ₹1,000 interest paid
          penaltyPaise: 0n,
        },
      });
    });

    it('should calculate daily interest ONLY on unpaid principal and penalty on unpaid installment amount', async () => {
      // Remaining unpaid principal = ₹100,000 - ₹59,000 = ₹41,000 (4,100,000 paise)
      // Remaining unpaid installment = ₹101,000 - ₹60,000 = ₹41,000 (4,100,000 paise)
      const remainingUnpaidPrincipal = 4100000n;
      const remainingUnpaidInstalment = 4100000n;

      const asOfDate = new Date('2026-01-18T00:00:00Z');

      const summary = await accrualService.processOverdueAccruals(
        { asOfDate, loanId: partialLoanId },
        managerUser.id
      );

      const expectedInterest = calculateDailyInterest(remainingUnpaidPrincipal, 1800);
      const expectedPenalty = calculateDailyPenalty(remainingUnpaidInstalment, 3600);

      expect(summary.totalInterestAccruedPaise).toBe(expectedInterest);
      expect(summary.totalPenaltyAccruedPaise).toBe(expectedPenalty);

      // Verify AccrualRecord amounts match remaining unpaid base
      const recordInterest = await prisma.accrualRecord.findFirst({
        where: { scheduleId: partialScheduleId, accrualType: 'INTEREST', accrualDate: asOfDate },
      });
      expect(recordInterest?.amountPaise).toBe(expectedInterest);
    });
  });

  describe('4. Idempotency & Repeated Executions', () => {
    let idemLoanId: string;
    let idemScheduleId: string;
    const asOfDate = new Date('2026-03-01T00:00:00Z');

    beforeAll(async () => {
      const loan = await prisma.loan.create({
        data: {
          loanNumber: `LN-IDEM-${Date.now()}`,
          borrowerId: testBorrower.id,
          productId: productNoGrace.id,
          principalPaise: 2000000n,
          interestRateBps: 1800,
          tenureMonths: 1,
          status: LoanStatus.ACTIVE,
          disbursedAt: new Date('2026-01-01T00:00:00Z'),
        },
      });
      idemLoanId = loan.id;

      const sched = await prisma.repaymentSchedule.create({
        data: {
          loanId: loan.id,
          installmentNumber: 1,
          dueDate: new Date('2026-02-01T00:00:00Z'),
          principalPaise: 2000000n,
          interestPaise: 20000n,
          totalPaise: 2020000n,
          status: InstallmentStatus.PENDING,
        },
      });
      idemScheduleId = sched.id;
    });

    it('should accrue on first execution, and skip duplicate accruals on subsequent executions for same date', async () => {
      // First run: should accrue
      const firstRun = await accrualService.processOverdueAccruals(
        { asOfDate, loanId: idemLoanId },
        managerUser.id
      );
      expect(firstRun.interestAccrualsCreated).toBe(1);
      expect(firstRun.penaltyAccrualsCreated).toBe(1);

      // Second run on same date: should detect existing records and skip
      const secondRun = await accrualService.processOverdueAccruals(
        { asOfDate, loanId: idemLoanId },
        managerUser.id
      );
      expect(secondRun.interestAccrualsCreated).toBe(0);
      expect(secondRun.penaltyAccrualsCreated).toBe(0);
      expect(secondRun.skippedAlreadyAccrued).toBe(2);

      // Verify exactly 2 accrual records exist for this schedule and date
      const records = await prisma.accrualRecord.findMany({
        where: { scheduleId: idemScheduleId, accrualDate: asOfDate },
      });
      expect(records.length).toBe(2);
    });

    it('should reject duplicate inserts at database unique constraint level', async () => {
      // Attempting direct raw duplicate insert must fail with P2002
      await expect(
        prisma.accrualRecord.create({
          data: {
            loanId: idemLoanId,
            scheduleId: idemScheduleId,
            accrualDate: asOfDate,
            accrualType: 'INTEREST',
            amountPaise: 500n,
          },
        })
      ).rejects.toThrow();
    });
  });

  describe('5. Concurrent Scheduler Execution Safety', () => {
    let concLoanId: string;
    const concDate = new Date('2026-04-01T00:00:00Z');

    beforeAll(async () => {
      const loan = await prisma.loan.create({
        data: {
          loanNumber: `LN-CONC-${Date.now()}`,
          borrowerId: testBorrower.id,
          productId: productNoGrace.id,
          principalPaise: 5000000n,
          interestRateBps: 1800,
          tenureMonths: 1,
          status: LoanStatus.ACTIVE,
          disbursedAt: new Date('2026-02-01T00:00:00Z'),
        },
      });
      concLoanId = loan.id;

      await prisma.repaymentSchedule.create({
        data: {
          loanId: loan.id,
          installmentNumber: 1,
          dueDate: new Date('2026-03-01T00:00:00Z'),
          principalPaise: 5000000n,
          interestPaise: 50000n,
          totalPaise: 5050000n,
          status: InstallmentStatus.PENDING,
        },
      });
    });

    it('should safely serialize concurrent execution attempts without double posting', async () => {
      // Launch two concurrent runs for the exact same loan and date
      const [runA, runB] = await Promise.all([
        accrualService.processOverdueAccruals({ asOfDate: concDate, loanId: concLoanId }, managerUser.id),
        accrualService.processOverdueAccruals({ asOfDate: concDate, loanId: concLoanId }, managerUser.id),
      ]);

      // Together, exactly 1 interest accrual and 1 penalty accrual should be created
      const totalInterestCreated = runA.interestAccrualsCreated + runB.interestAccrualsCreated;
      const totalPenaltyCreated = runA.penaltyAccrualsCreated + runB.penaltyAccrualsCreated;

      expect(totalInterestCreated).toBe(1);
      expect(totalPenaltyCreated).toBe(1);

      // Verify trial balance remains balanced
      const trialBalance = await ledgerService.getTrialBalance();
      expect(trialBalance.isBalanced).toBe(true);
    });
  });

  describe('6. Protected Manual Trigger & Scheduler REST API', () => {
    it('should reject unauthenticated request with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/accruals/overdue')
        .set('x-test-no-auth', 'true')
        .send({});

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject LOAN_OFFICER with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/accruals/overdue')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should reject AUDITOR with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/accruals/overdue')
        .set('Authorization', `Bearer ${auditorToken}`)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should allow MANAGER to trigger overdue accruals via POST /api/accruals/overdue', async () => {
      const res = await request(app)
        .post('/api/accruals/overdue')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ asOfDate: '2026-06-01' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.activeLoansChecked).toBeDefined();
    });

    it('should allow MANAGER to trigger overdue accruals via POST /api/accruals/run', async () => {
      const res = await request(app)
        .post('/api/accruals/run')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ asOfDate: '2026-06-01' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should allow AUDITOR and MANAGER to inspect scheduler status', async () => {
      const res = await request(app)
        .get('/api/accruals/scheduler/status')
        .set('Authorization', `Bearer ${auditorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.cronExpression).toBeDefined();
    });

    it('should allow MANAGER to start and stop scheduler via API', async () => {
      const startRes = await request(app)
        .post('/api/accruals/scheduler/start')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ cronExpression: '0 1 * * *' });

      expect(startRes.status).toBe(200);
      expect(startRes.body.data.isRunning).toBe(true);

      const stopRes = await request(app)
        .post('/api/accruals/scheduler/stop')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({});

      expect(stopRes.status).toBe(200);
      expect(stopRes.body.data.isRunning).toBe(false);
    });
  });
});
