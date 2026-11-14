# Architecture Documentation

## System Overview

The Dvara Loan Account & Ledger Service is a backend system that manages the complete lifecycle of microfinance loans with double-entry bookkeeping. It is designed for correctness, auditability, and data integrity.

## Architectural Principles

### 1. Derived Balances (No Authoritative Balance Column)

The outstanding balance of any loan is **computed** by querying the ledger, not stored as a mutable field. This eliminates the risk of balance drift between a cached balance and the ledger, making the ledger the single authoritative source of truth.

```
Outstanding = SUM(debits to Loans Receivable) - SUM(credits to Loans Receivable)
```

### 2. Double-Entry Ledger

Every financial event (disbursement, repayment, accrual, write-off) produces a balanced `LedgerTransaction` where total debits equal total credits. This is validated at the application layer before the transaction is committed.

**Disbursement example:**
| Account | Debit | Credit |
|---------|-------|--------|
| Loans Receivable – Principal | ₹1,00,000 | |
| Cash / Bank | | ₹1,00,000 |

**Repayment example (EMI with principal + interest):**
| Account | Debit | Credit |
|---------|-------|--------|
| Cash / Bank | ₹10,000 | |
| Loans Receivable – Principal | | ₹8,000 |
| Interest Income | | ₹2,000 |

### 3. Immutability of Posted Entries

Once a `LedgerEntry` is marked `posted = true`, it is **never modified or deleted**. This is enforced at the application level. Corrections are made through reversal transactions (contra entries) that create equal and opposite entries, preserving a complete audit trail.

### 4. Idempotent Repayment Processing

Every repayment request carries a unique idempotency key. Before processing:
1. Check if the key exists in `IdempotencyKey` table
2. If yes → return the cached response (safe to retry)
3. If no → process the repayment within a database transaction, store the key and response

### 5. Optimistic Concurrency Control

`Loan` and `RepaymentSchedule` tables include a `version` column. Updates use a `WHERE version = expectedVersion` clause. If the version has changed (concurrent modification), the operation fails and can be retried with fresh data.

---

## Loan Products & Repayment Calculation Engine (Phase 2)

### Supported Loan Products

1. **Weekly Group Loan**
   - Repayment Frequency: `WEEKLY`
   - Interest Type: `FLAT`
   - Annual Rate: Stored in basis points (e.g., 1500 bps = 15.00% p.a.)
   - Typical Tenure: 12 to 52 weeks
   - Target Segment: Joint-liability microfinance groups

2. **Monthly EMI Loan**
   - Repayment Frequency: `MONTHLY`
   - Interest Type: `REDUCING_BALANCE`
   - Annual Rate: Stored in basis points (e.g., 1200 bps = 12.00% p.a.)
   - Typical Tenure: 6 to 60 months
   - Target Segment: Individual retail and enterprise borrowers

3. **Flat Rate Loan**
   - Repayment Frequency: `MONTHLY`
   - Interest Type: `FLAT`
   - Annual Rate: Stored in basis points (e.g., 1400 bps = 14.00% p.a.)
   - Typical Tenure: 3 to 36 months
   - Target Segment: Short-term seasonal working capital

---

### Strict BigInt Financial Arithmetic

JavaScript `Number` (IEEE 754 double precision) introduces cumulative rounding errors in financial transactions.
To prevent this:
- **Zero floating-point arithmetic is permitted for monetary calculations.**
- All money amounts are stored and calculated as integer **paise** using TypeScript `BigInt` ($1\text{ INR} = 100\text{ paise}$).
- Interest rates are expressed in integer **basis points** ($1\% = 100\text{ bps}$, $12.50\% = 1250\text{ bps}$).

#### Exact Half-Up Rounding Formula
For numerator $n \ge 0$ and denominator $d > 0$:
$$\text{roundHalfUp}\left(\frac{n}{d}\right) = \left\lfloor \frac{2n + d}{2d} \right\rfloor$$
This formula computes exact half-up rounding (where fractions $\ge 0.5$ round up) using purely integer division without intermediate floating-point casting.

---

### Amortization & Repayment Formulas

#### 1. Flat-Rate Calculation
- **Total Interest:**
  $$\text{totalInterestPaise} = \text{roundHalfUp}\left(\frac{P \times R_{\text{bps}} \times n}{\text{periodicDenominator}}\right)$$
  Where:
  - $\text{periodicDenominator} = 120,000$ for Monthly ($10,000 \times 12$)
  - $\text{periodicDenominator} = 520,000$ for Weekly ($10,000 \times 52$)
- **Distribution:**
  - Base principal: $\text{roundHalfUp}(P / n)$
  - Base interest: $\text{roundHalfUp}(\text{totalInterestPaise} / n)$
  - Installment $i \in [1, n-1]$: receives base principal and base interest.
  - Final installment $n$: absorbs any rounding difference:
    $$\text{principal}_n = P - \sum_{i=1}^{n-1} \text{principal}_i$$
    $$\text{interest}_n = \text{totalInterestPaise} - \sum_{i=1}^{n-1} \text{interest}_i$$
  - Guaranteed: $\sum_{i=1}^n \text{principal}_i = P$ and $\sum_{i=1}^n \text{interest}_i = \text{totalInterestPaise}$.

#### 2. Reducing-Balance EMI Calculation
The standard banking EMI formula:
$$E = P \cdot \frac{r(1+r)^n}{(1+r)^n - 1}$$
Where periodic rate $r = \frac{R_{\text{bps}}}{\text{periodicDenominator}} = \frac{num_r}{B}$.
Let $A = B + num_r$ (so $A/B = 1+r$).
In closed-form integer arithmetic:
$$E = P \cdot \frac{(A - B) \cdot A^n}{B \cdot (A^n - B^n)}$$
- Outstanding balance begins at $O_0 = P$.
- For each installment $i \in [1, n-1]$:
  - $\text{interest}_i = \text{roundHalfUp}\left(\frac{O_{i-1} \times R_{\text{bps}}}{\text{periodicDenominator}}\right)$
  - $\text{principal}_i = E - \text{interest}_i$
  - $O_i = O_{i-1} - \text{principal}_i$
- For final installment $n$:
  - $\text{principal}_n = O_{n-1}$ (pays off all remaining balance)
  - $\text{interest}_n = \text{roundHalfUp}\left(\frac{O_{n-1} \times R_{\text{bps}}}{\text{periodicDenominator}}\right)$
  - $O_n = 0\text{ paise}$.
- Telescoping sum guarantees: $\sum_{i=1}^n \text{principal}_i = P$ exactly.

---

### Calendar Date Handling
- **Weekly Repayments:** Due dates advance in exact 7-day increments using UTC arithmetic.
- **Monthly Repayments:** Anchored to original loan start day; automatically clamped to the last day of the target month (e.g., Jan 31 $\to$ Feb 28/29 $\to$ Mar 31) and restored in subsequent 31-day months.

---

### Schedule Reconciliation Engine
Every generated schedule undergoes reconciliation before persistence:
1. $\sum \text{principalPaise} \equiv \text{originalPrincipalPaise}$
2. $\text{principalPaise}_i + \text{interestPaise}_i \equiv \text{totalPaise}_i$ for every installment
3. $\sum \text{principalPaise} + \sum \text{interestPaise} \equiv \sum \text{totalPaise}$
4. $\text{finalOutstandingPrincipal} \equiv 0\text{ paise}$
5. No negative monetary values allowed.

---

## Transaction Strategy

### Prisma Interactive Transactions

All multi-step financial operations use Prisma interactive transactions:

```typescript
await prisma.$transaction(async (tx) => {
  // All operations within this callback are atomic
  const repayment = await tx.repayment.create({ ... });
  const allocation = await tx.repaymentAllocation.create({ ... });
  const ledgerTx = await tx.ledgerTransaction.create({ ... });
  await tx.ledgerEntry.createMany({ ... });
});
```

### Transaction Boundaries

| Operation | Entities Modified Atomically |
|-----------|------------------------------|
| Loan Disbursement | Loan, LedgerAccount[], RepaymentSchedule[], LedgerTransaction, LedgerEntry[] |
| Repayment Processing | IdempotencyKey, Repayment, RepaymentAllocation[], RepaymentSchedule (status), LedgerTransaction, LedgerEntry[] |
| Interest Accrual | AccrualRecord, LedgerTransaction, LedgerEntry[] |
| Loan Closure | Loan (status), LedgerTransaction, LedgerEntry[] |

### MySQL Isolation Level

MySQL InnoDB defaults to `REPEATABLE READ`, ensuring consistent reads within a transaction. For balance calculations during repayment processing, `SELECT ... FOR UPDATE` is used to acquire row-level locks on relevant ledger accounts.

## Deletion Policies

| Parent → Child | Policy | Rationale |
|----------------|--------|-----------|
| User → Borrower | RESTRICT | Cannot delete user who created borrowers |
| Borrower → Loan | RESTRICT | Cannot delete borrower with loans |
| LoanProduct → Loan | RESTRICT | Cannot delete product in use |
| Loan → RepaymentSchedule | CASCADE | Schedule is integral to loan |
| Loan → Repayment | RESTRICT | Cannot delete loan with payments |
| Loan → AccrualRecord | CASCADE | Accruals are integral to loan |
| Repayment → RepaymentAllocation | CASCADE | Allocations belong to repayment |
| LedgerAccount → LedgerEntry | RESTRICT | Cannot delete account with entries |
| LedgerTransaction → LedgerEntry | CASCADE | Entries belong to transaction |
| User → AuditLog | SetNull | Preserve audit trail if user deleted |

---

## Phase 3: Double-Entry Accounting Ledger

### 1. Architectural Principles
1. **Mathematical Balance Guarantee**: Every posted transaction satisfies $\sum \text{Debit} = \sum \text{Credit}$.
2. **Atomic Ledger Posting**: Ledger transactions and all their entries are inserted inside single atomic database transactions.
3. **Application Immutability**: Posted ledger entries can never be updated or deleted. Corrections are made strictly via compensating contra-reversals.
4. **Derived Balance Engine**: No authoritative loan balance column is stored. Outstanding principal, interest, penalty, and account balances are derived from active ledger entries on demand.

### 2. Account Sign Conventions
Normal balances are determined by account type:
* **Assets & Expenses**: Normal balance is `DEBIT`.
  $$\text{Balance} = \sum \text{Debits} - \sum \text{Credits}$$
* **Liabilities, Equity & Income**: Normal balance is `CREDIT`.
  $$\text{Balance} = \sum \text{Credits} - \sum \text{Debits}$$

### 3. Derived Loan Outstanding Balances
Calculated by summing entries tagged with the given `loanId`:
* **Principal Outstanding**: Balance of the loan's *Loans Receivable* account (`assetBalance = Debits - Credits`).
* **Interest Outstanding**: Balance of the loan's *Interest Receivable* account (`assetBalance = Debits - Credits`).
* **Penalty Outstanding**: Balance of the loan's *Penalty Receivable* account (`assetBalance = Debits - Credits`).
* **Total Outstanding**: $\text{Principal} + \text{Interest} + \text{Penalty}$.

### 4. Accounting Operations & Configurable Policy
* **Disbursement**:
  * Debit: `LOANS_RECEIVABLE` (Asset)
  * Credit: `CASH_BANK` (Asset)
* **Repayment**:
  * Debit: `CASH_BANK` (Asset)
  * Credit: `LOANS_RECEIVABLE` (Principal portion)
  * Credit: `INTEREST_RECEIVABLE` (Accrued interest portion) or `INTEREST_INCOME` (Direct income)
  * Credit: `PENALTY_RECEIVABLE` (Accrued penalty portion) or `PENALTY_INCOME` (Direct income)
* **Interest Accrual**:
  * Debit: `INTEREST_RECEIVABLE` (Asset)
  * Credit: `INTEREST_INCOME` (Income)
* **Penalty Accrual**:
  * Debit: `PENALTY_RECEIVABLE` (Asset)
  * Credit: `PENALTY_INCOME` (Income)

### 5. Transaction Reversal Mechanics
* Reversals create a new compensating transaction tagged as `REVERSAL` referencing `reversalOfId`.
* For every entry in the original transaction, an exact contra-entry is generated (`DEBIT` $\leftrightarrow$ `CREDIT`).
* Both original and reversal transactions are permanently marked as reversed (`isReversed = true`), guaranteeing idempotent, single-reversal invariants.

---

## Phase 4: Repayment Management & Idempotency Engine

### 1. Architectural Overview
Phase 4 implements the end-to-end payment processing pipeline, integrating the double-entry accounting ledger with strict ACID transactions, priority waterfall allocations, and canonical request-hash idempotency controls.

### 2. Repayment Waterfall Allocation
Payments are applied strictly across outstanding schedules prioritized by oldest due installment (`installmentNumber ASC` where status is not `PAID`):
1. **Penalties**: Outstanding penalties are satisfied first.
2. **Accrued Interest**: Installment interest components are satisfied second.
3. **Principal**: Installment principal components are satisfied third.

Installment status automatically updates:
* `PAID`: When both principal and interest components are fully satisfied.
* `PARTIALLY_PAID`: When at least one paise has been applied but balance remains.
* `CLOSED`: When total loan principal, interest, and penalties reach 0 paise, the loan status updates to `CLOSED` and `closedAt` is timestamped.

### 3. Canonical Request Hashing & Idempotency Lifecycle
1. **Header Requirement**: Clients must provide the `Idempotency-Key` HTTP header.
2. **Canonical Hashing**: Request method, normalized path, and lexicographically sorted JSON payload are digested using SHA-256.
3. **Replay Invariant**:
   * Same Key + Identical Request Hash $\to$ Returns cached HTTP response payload (HTTP 200/201).
   * Same Key + Modified Request $\to$ Rejects with HTTP 409 Conflict.
4. **Atomicity Guarantee**: `IdempotencyKey`, `Repayment`, `RepaymentAllocation`, `RepaymentSchedule` status updates, `LedgerTransaction`, `LedgerEntry`, and `AuditLog` records commit atomically inside `prisma.$transaction`.
5. **Rollback Safety**: Any operational failure triggers an immediate database-level rollback; no partial postings, dirty balances, or orphan idempotency records remain.

---

## Phase 5: Concurrent Repayment Safety & Database Locking

### 1. Database-Level Row Locking (`SELECT ... FOR UPDATE`)
To prevent concurrent race conditions where two payments might consume the same outstanding balance, the service acquires an exclusive row lock (`X` lock) on the target loan before reading or modifying balances:

```sql
SELECT * FROM loans WHERE id = ? FOR UPDATE;
```

This guarantees strict transaction serialization at the MySQL InnoDB engine level.

### 2. Post-Lock Balance Validation
All balance calculations are performed strictly **after** obtaining the row lock:
1. Lock `loans` row by `id`.
2. Check `idempotency_keys` with `FOR UPDATE` to handle in-flight concurrent duplicates.
3. Fetch derived ledger balances (`getLoanBalances(loan.id, tx)`).
4. Assert `amountPaise <= balances.totalOutstanding`.
5. Under concurrent contention, the winning transaction reduces the balance; the waiting transaction unblocks, re-reads the updated committed ledger balance, and either processes the remainder or rejects overpayment with HTTP 400.

### 3. Consistent Lock Hierarchy
To eliminate deadlock hazards, transactions acquire locks in a deterministic order:
$$\text{loans (by id)} \longrightarrow \text{idempotency\_keys (by key)} \longrightarrow \text{repayment\_schedules (ORDER BY installmentNumber ASC)}$$

### 4. Bounded Deadlock Retries
Transient database contention (MySQL error `1213: ER_LOCK_DEADLOCK`, `1205: Lock wait timeout`, or Prisma `P2034`) is resolved using a bounded retry mechanism with exponential backoff and randomized jitter:
$$\text{backoff} = 50\text{ms} \times 2^{\text{attempt}} + \text{jitter}(0, 50\text{ms}) \quad (\le 5\text{ attempts})$$

---

## Phase 6: Authentication, Role-Based Access Control (RBAC), and Audit Trail

### 1. Authentication Architecture
* **JWT Tokens**: Secure stateless token issuance and verification via signed JSON Web Tokens (`jsonwebtoken`), embedding user ID, email, and role claims with configurable expiration (`JWT_EXPIRES_IN`).
* **Bcrypt Password Hashing**: Passwords hashed using `bcryptjs` (salt rounds = 10) with constant-time verification.
* **Sensitive Data Hygiene**: Passwords and raw secrets are sanitized from all service responses and audit logs (`sanitizeUser`).
* **HTTP 401 Unauthorized**: Enforced on missing, malformed, invalid, or expired tokens.

### 2. Role-Based Access Control (RBAC) Matrix
Permissions are verified on the backend by centralized `authenticate` and `authorize` middleware:

| Operation | Route | Method | LOAN_OFFICER | MANAGER | AUDITOR |
| :--- | :--- | :---: | :---: | :---: | :---: |
| Register / Login | `/api/auth/*` | POST | Public | Public | Public |
| Current Profile | `/api/auth/me` | GET | Allowed | Allowed | Allowed |
| Create Borrower | `/api/borrowers` | POST | **Allowed** | **Allowed** | 403 Forbidden |
| View Borrowers | `/api/borrowers` | GET | Allowed | Allowed | Allowed |
| Create Loan | `/api/loans` | POST | **Allowed** | **Allowed** | 403 Forbidden |
| Disburse Loan | `/api/loans/:id/disburse` | POST | **Allowed** | **Allowed** | 403 Forbidden |
| Post Repayment | `/api/repayments` | POST | **Allowed** | **Allowed** | 403 Forbidden |
| View Loan / Schedule | `/api/loans/:id/*` | GET | Allowed | Allowed | Allowed |
| View Complete Ledger | `/api/ledger/*` | GET | 403 Forbidden | **Allowed** | **Allowed** |
| Reverse Transaction | `/api/ledger/transactions/:id/reverse` | POST | 403 Forbidden | **Allowed** | 403 Forbidden |
| Manual Accrual Run | `/api/accruals/manual` | POST | 403 Forbidden | **Allowed** | 403 Forbidden |
| View Audit Logs | `/api/audit-logs` | GET | 403 Forbidden | **Allowed** | **Allowed** |

### 3. Append-Only Audit Trail
* **Automated Audit Hooks**: Every sensitive lifecycle operation (borrower creation, loan application, disbursement, repayment, ledger reversal, interest accrual, user registration/login) records an immutable audit entry.
* **Audit Metadata Captured**:
  * `userId`: Actor UUID.
  * `action`: Action enum (`BORROWER_CREATED`, `LOAN_CREATED`, `LOAN_DISBURSED`, `REPAYMENT_PROCESSED`, `TRANSACTION_REVERSED`, `INTEREST_ACCRUED`, `USER_REGISTERED`, `USER_LOGIN`).
  * `entityType`: Target entity model (`Borrower`, `Loan`, `Repayment`, `LedgerTransaction`, `AccrualRecord`, `User`).
  * `entityId`: Unique ID of target entity.
  * `before`: JSON snapshot of entity state prior to action.
  * `after`: JSON snapshot of entity state post-action.
  * `ipAddress`: Client IP address.
  * `createdAt`: Immutable ISO 8601 timestamp.
* **Strict Immutability**: normal application endpoints cannot update or delete audit records (`updateAuditLog` and `deleteAuditLog` throw `ForbiddenError`).




