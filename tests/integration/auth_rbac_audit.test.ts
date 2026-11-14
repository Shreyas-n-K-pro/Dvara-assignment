import request from 'supertest';
import app from '../../src/app';
import prisma from '../../src/config/database';
import { authService } from '../../src/modules/auth/auth.service';
import { auditService } from '../../src/modules/audit/audit.service';
import { UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';

describe('Phase 6: Authentication, RBAC, and Audit Trail Integration Tests', () => {
  let officerToken: string;
  let managerToken: string;
  let auditorToken: string;

  let officerId: string;

  let testProduct: { id: string };
  let testBorrowerId: string;
  let testLoanId: string;
  let testDisbursedLoanId: string;
  let testTransactionId: string;

  beforeAll(async () => {
    // 1. Create a Loan Product for testing
    testProduct = await prisma.loanProduct.create({
      data: {
        name: `Auth Test Product ${Date.now()}`,
        interestRateBps: 1200,
        minAmountPaise: 100000n,
        maxAmountPaise: 50000000n,
        minTenureMonths: 1,
        maxTenureMonths: 36,
        repaymentFrequency: 'MONTHLY',
        interestType: 'FLAT',
      },
    });

    // 2. Register / Create users for each role using authService
    const officerRes = await authService.register({
      email: `officer-${Date.now()}@test.dvara.com`,
      password: 'Password123!',
      name: 'Test Loan Officer',
      role: UserRole.LOAN_OFFICER,
    });
    officerToken = authService.generateToken(officerRes);
    officerId = officerRes.id;

    const managerRes = await authService.register({
      email: `manager-${Date.now()}@test.dvara.com`,
      password: 'Password123!',
      name: 'Test Manager',
      role: UserRole.MANAGER,
    });
    managerToken = authService.generateToken(managerRes);

    const auditorRes = await authService.register({
      email: `auditor-${Date.now()}@test.dvara.com`,
      password: 'Password123!',
      name: 'Test Auditor',
      role: UserRole.AUDITOR,
    });
    auditorToken = authService.generateToken(auditorRes);
  });

  afterAll(async () => {
    try {
      await prisma.user.deleteMany({
        where: { email: { contains: '@test.dvara.com' } },
      });
    } catch {
      // Ignore cleanup errors
    } finally {
      await prisma.$disconnect();
    }
  }, 10000);

  describe('1. Authentication & Security Invariants', () => {
    it('should register a new user and never expose password', async () => {
      const email = `new-user-${Date.now()}@test.dvara.com`;
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email,
          password: 'SecurePassword123!',
          name: 'Jane Doe',
          role: 'LOAN_OFFICER',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe(email);
      expect(res.body.data.role).toBe('LOAN_OFFICER');
      expect(res.body.data.password).toBeUndefined();
    });

    it('should reject registration with duplicate email with 409 Conflict', async () => {
      const email = `dup-${Date.now()}@test.dvara.com`;
      await request(app)
        .post('/api/auth/register')
        .send({
          email,
          password: 'Password123!',
          name: 'First User',
          role: 'LOAN_OFFICER',
        });

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email,
          password: 'Password123!',
          name: 'Second User',
          role: 'LOAN_OFFICER',
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('should login successfully with correct credentials and never expose password', async () => {
      const email = `login-test-${Date.now()}@test.dvara.com`;
      await request(app)
        .post('/api/auth/register')
        .send({
          email,
          password: 'ValidPassword123!',
          name: 'Login User',
          role: 'MANAGER',
        });

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email,
          password: 'ValidPassword123!',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.user.email).toBe(email);
      expect(res.body.data.user.password).toBeUndefined();
    });

    it('should reject login with wrong password with 401 Unauthorized', async () => {
      const email = `bad-pw-${Date.now()}@test.dvara.com`;
      await request(app)
        .post('/api/auth/register')
        .send({
          email,
          password: 'CorrectPassword123!',
          name: 'Bad Pw User',
        });

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email,
          password: 'WrongPassword!',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject login for non-existent email with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@dvara.com',
          password: 'AnyPassword123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should get current user profile with valid JWT Bearer token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${officerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(officerId);
      expect(res.body.data.role).toBe('LOAN_OFFICER');
      expect(res.body.data.password).toBeUndefined();
    });

    it('should reject request with invalid JWT with 401 Unauthorized', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid.jwt.token');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should reject request without credentials with 401 Unauthorized when auth required', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('x-test-no-auth', 'true');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('2. Role-Based Access Control (RBAC) Matrix', () => {
    describe('POST /api/borrowers (Create Borrower)', () => {
      it('should allow LOAN_OFFICER to create a borrower', async () => {
        const res = await request(app)
          .post('/api/borrowers')
          .set('Authorization', `Bearer ${officerToken}`)
          .send({
            firstName: 'Officer',
            lastName: 'Borrower',
            phone: '9876543211',
            email: 'officer.b@test.com',
          });

        expect([200, 201]).toContain(res.status);
        expect(res.body.success).toBe(true);
        expect(res.body.data.id).toBeDefined();
        testBorrowerId = res.body.data.id;
      });

      it('should allow MANAGER to create a borrower', async () => {
        const res = await request(app)
          .post('/api/borrowers')
          .set('Authorization', `Bearer ${managerToken}`)
          .send({
            firstName: 'Manager',
            lastName: 'Borrower',
            phone: '9876543212',
          });

        expect([200, 201]).toContain(res.status);
        expect(res.body.success).toBe(true);
      });

      it('should reject AUDITOR with 403 Forbidden', async () => {
        const res = await request(app)
          .post('/api/borrowers')
          .set('Authorization', `Bearer ${auditorToken}`)
          .send({
            firstName: 'Auditor',
            lastName: 'Borrower',
            phone: '9876543213',
          });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });
    });

    describe('POST /api/loans (Create Loan)', () => {
      it('should allow LOAN_OFFICER to create a loan', async () => {
        const res = await request(app)
          .post('/api/loans')
          .set('Authorization', `Bearer ${officerToken}`)
          .send({
            borrowerId: testBorrowerId,
            productId: testProduct.id,
            principalPaise: 10000000, // ₹100,000
            interestRateBps: 1200,
            tenureMonths: 12,
          });

        expect([200, 201]).toContain(res.status);
        expect(res.body.success).toBe(true);
        expect(res.body.data.id).toBeDefined();
        testLoanId = res.body.data.id;
      });

      it('should allow MANAGER to create a loan', async () => {
        const res = await request(app)
          .post('/api/loans')
          .set('Authorization', `Bearer ${managerToken}`)
          .send({
            borrowerId: testBorrowerId,
            productId: testProduct.id,
            principalPaise: 5000000, // ₹50,000
            interestRateBps: 1200,
            tenureMonths: 6,
          });

        expect([200, 201]).toContain(res.status);
        expect(res.body.success).toBe(true);
        testDisbursedLoanId = res.body.data.id;
      });

      it('should reject AUDITOR with 403 Forbidden', async () => {
        const res = await request(app)
          .post('/api/loans')
          .set('Authorization', `Bearer ${auditorToken}`)
          .send({
            borrowerId: testBorrowerId,
            productId: testProduct.id,
            principalPaise: 5000000,
            interestRateBps: 1200,
            tenureMonths: 6,
          });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });
    });

    describe('POST /api/loans/:id/disburse (Disburse Loan)', () => {
      it('should reject AUDITOR with 403 Forbidden', async () => {
        const res = await request(app)
          .post(`/api/loans/${testLoanId}/disburse`)
          .set('Authorization', `Bearer ${auditorToken}`)
          .send({});

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
      });

      it('should allow LOAN_OFFICER to disburse a loan', async () => {
        const res = await request(app)
          .post(`/api/loans/${testLoanId}/disburse`)
          .set('Authorization', `Bearer ${officerToken}`)
          .send({});

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('ACTIVE');
        expect(res.body.data.disbursementTransactionId).toBeDefined();
        testTransactionId = res.body.data.disbursementTransactionId;
      });

      it('should allow MANAGER to disburse a loan', async () => {
        const res = await request(app)
          .post(`/api/loans/${testDisbursedLoanId}/disburse`)
          .set('Authorization', `Bearer ${managerToken}`)
          .send({});

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('ACTIVE');
      });
    });

    describe('POST /api/repayments (Post Repayment)', () => {
      it('should reject AUDITOR with 403 Forbidden', async () => {
        const res = await request(app)
          .post('/api/repayments')
          .set('Authorization', `Bearer ${auditorToken}`)
          .set('Idempotency-Key', `idem-auditor-${randomUUID()}`)
          .send({
            loanId: testLoanId,
            amountPaise: 500000,
            paymentDate: new Date().toISOString(),
            paymentReference: 'AUD-REF-1',
          });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
      });

      it('should allow LOAN_OFFICER to post repayment', async () => {
        const res = await request(app)
          .post('/api/repayments')
          .set('Authorization', `Bearer ${officerToken}`)
          .set('Idempotency-Key', `idem-officer-${randomUUID()}`)
          .send({
            loanId: testLoanId,
            amountPaise: 500000, // ₹5,000
            paymentDate: new Date().toISOString(),
            paymentReference: 'OFF-REF-1',
          });

        expect([200, 201]).toContain(res.status);
        expect(res.body.success).toBe(true);
        expect(res.body.data.repayment.id).toBeDefined();
      });

      it('should allow MANAGER to post repayment', async () => {
        const res = await request(app)
          .post('/api/repayments')
          .set('Authorization', `Bearer ${managerToken}`)
          .set('Idempotency-Key', `idem-mgr-${randomUUID()}`)
          .send({
            loanId: testLoanId,
            amountPaise: 500000, // ₹5,000
            paymentDate: new Date().toISOString(),
            paymentReference: 'MGR-REF-1',
          });

        expect([200, 201]).toContain(res.status);
        expect(res.body.success).toBe(true);
      });
    });

    describe('GET /api/ledger/accounts & /api/ledger/trial-balance (Ledger Access)', () => {
      it('should reject LOAN_OFFICER from viewing ledger accounts with 403 Forbidden', async () => {
        const res = await request(app)
          .get('/api/ledger/accounts')
          .set('Authorization', `Bearer ${officerToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
      });

      it('should reject LOAN_OFFICER from viewing trial balance with 403 Forbidden', async () => {
        const res = await request(app)
          .get('/api/ledger/trial-balance')
          .set('Authorization', `Bearer ${officerToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
      });

      it('should allow MANAGER to view trial balance', async () => {
        const res = await request(app)
          .get('/api/ledger/trial-balance')
          .set('Authorization', `Bearer ${managerToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.isBalanced).toBe(true);
      });

      it('should allow AUDITOR to view trial balance', async () => {
        const res = await request(app)
          .get('/api/ledger/trial-balance')
          .set('Authorization', `Bearer ${auditorToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.isBalanced).toBe(true);
      });
    });

    describe('POST /api/ledger/transactions/:id/reverse (Transaction Reversal)', () => {
      it('should reject LOAN_OFFICER from reversing transactions with 403 Forbidden', async () => {
        const res = await request(app)
          .post(`/api/ledger/transactions/${testTransactionId}/reverse`)
          .set('Authorization', `Bearer ${officerToken}`)
          .send({ reason: 'Officer unauthorized reversal' });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
      });

      it('should reject AUDITOR from reversing transactions with 403 Forbidden', async () => {
        const res = await request(app)
          .post(`/api/ledger/transactions/${testTransactionId}/reverse`)
          .set('Authorization', `Bearer ${auditorToken}`)
          .send({ reason: 'Auditor unauthorized reversal' });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
      });

      it('should allow MANAGER to reverse a transaction', async () => {
        const res = await request(app)
          .post(`/api/ledger/transactions/${testTransactionId}/reverse`)
          .set('Authorization', `Bearer ${managerToken}`)
          .send({ reason: 'Manager reversal for accounting correction' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.id).toBeDefined();
        expect(res.body.data.reversalOfId).toBe(testTransactionId);
      });
    });

    describe('POST /api/accruals/manual (Manual Accrual)', () => {
      it('should reject LOAN_OFFICER from triggering manual accrual with 403 Forbidden', async () => {
        const res = await request(app)
          .post('/api/accruals/manual')
          .set('Authorization', `Bearer ${officerToken}`)
          .send({
            loanId: testDisbursedLoanId,
            interestPaise: 50000,
          });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
      });

      it('should reject AUDITOR from triggering manual accrual with 403 Forbidden', async () => {
        const res = await request(app)
          .post('/api/accruals/manual')
          .set('Authorization', `Bearer ${auditorToken}`)
          .send({
            loanId: testDisbursedLoanId,
            interestPaise: 50000,
          });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
      });

      it('should allow MANAGER to trigger manual accrual', async () => {
        const res = await request(app)
          .post('/api/accruals/manual')
          .set('Authorization', `Bearer ${managerToken}`)
          .send({
            loanId: testDisbursedLoanId,
            interestPaise: 50000, // ₹500
            description: 'Manual interest accrual by manager',
          });

        expect([200, 201]).toContain(res.status);
        expect(res.body.success).toBe(true);
        expect(res.body.data.accrualRecordId).toBeDefined();
      });
    });

    describe('GET /api/audit-logs (Audit Log Access)', () => {
      it('should reject LOAN_OFFICER from viewing audit logs with 403 Forbidden', async () => {
        const res = await request(app)
          .get('/api/audit-logs')
          .set('Authorization', `Bearer ${officerToken}`);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
      });

      it('should allow MANAGER to view audit logs', async () => {
        const res = await request(app)
          .get('/api/audit-logs')
          .set('Authorization', `Bearer ${managerToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data.length).toBeGreaterThan(0);
      });

      it('should allow AUDITOR to view audit logs', async () => {
        const res = await request(app)
          .get('/api/audit-logs')
          .set('Authorization', `Bearer ${auditorToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(res.body.data.length).toBeGreaterThan(0);
      });
    });

    describe('Read-Only Routes for AUDITOR', () => {
      it('should allow AUDITOR to view borrowers', async () => {
        const res = await request(app)
          .get('/api/borrowers')
          .set('Authorization', `Bearer ${auditorToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      });

      it('should allow AUDITOR to view loan details', async () => {
        const res = await request(app)
          .get(`/api/loans/${testLoanId}`)
          .set('Authorization', `Bearer ${auditorToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      });

      it('should allow AUDITOR to view loan schedule', async () => {
        const res = await request(app)
          .get(`/api/loans/${testLoanId}/schedule`)
          .set('Authorization', `Bearer ${auditorToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      });

      it('should allow AUDITOR to view loan balance', async () => {
        const res = await request(app)
          .get(`/api/loans/${testLoanId}/balance`)
          .set('Authorization', `Bearer ${auditorToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      });
    });
  });

  describe('3. Audit Trail Verification & Immutability', () => {
    it('should have recorded audit log entries for all sensitive actions', async () => {
      const logs = await auditService.getAuditLogs({});
      expect(logs.length).toBeGreaterThan(0);

      const actions = logs.map((l) => l.action);
      expect(actions).toContain('BORROWER_CREATED');
      expect(actions).toContain('LOAN_CREATED');
      expect(actions).toContain('LOAN_DISBURSED');
      expect(
        actions.includes('REPAYMENT_PROCESSED') || actions.includes('REPAYMENT_POSTED')
      ).toBe(true);
      expect(actions).toContain('TRANSACTION_REVERSED');
      expect(actions).toContain('INTEREST_ACCRUED');

      // Verify structure of an audit log entry
      const disburseLog = logs.find((l) => l.action === 'LOAN_DISBURSED');
      expect(disburseLog).toBeDefined();
      expect(disburseLog!.entityType).toBe('Loan');
      expect(disburseLog!.userId).toBeDefined();
      expect(disburseLog!.createdAt).toBeDefined();
    });

    it('should prevent mutating audit logs (append-only enforcement)', () => {
      expect(() => auditService.updateAuditLog()).toThrow(
        /immutable and cannot be updated/
      );
    });

    it('should prevent deleting audit logs (append-only enforcement)', () => {
      expect(() => auditService.deleteAuditLog()).toThrow(
        /immutable and cannot be deleted/
      );
    });
  });
});
