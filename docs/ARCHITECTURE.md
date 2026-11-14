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
  // If any operation fails, everything rolls back
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

## Monetary Precision

All monetary values are stored as `BigInt` (MySQL `BIGINT`) in **paise** (the smallest unit of Indian Rupee):

- ₹1,234.56 → stored as `123456`
- ₹0.01 → stored as `1`

This avoids floating-point arithmetic errors entirely. All calculations are done in integer arithmetic, and conversion to rupees happens only at the API response layer.

Interest rates are stored in **basis points** (1/100th of a percent):

- 12.50% → stored as `1250`
- 0.05% → stored as `5`

## Entity Relationships

```
User ──┬── creates → Borrower ── takes → Loan ──┬── has → RepaymentSchedule
       │                                         ├── receives → Repayment → splits → RepaymentAllocation
       │                                         ├── owns → LedgerAccount → has → LedgerEntry
       │                                         └── accrues → AccrualRecord
       └── triggers → AuditLog

LoanProduct ── defines → Loan
LedgerTransaction ── groups → LedgerEntry[]
Repayment ── uses → IdempotencyKey
```

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

## Error Handling

The application uses a centralized error handling architecture:

1. **Custom error classes** (`AppError`, `NotFoundError`, `ValidationError`, etc.) with HTTP status codes and error codes
2. **Express async error handling** via `express-async-errors` – no need for try-catch in route handlers
3. **Centralized error middleware** catches all errors and returns consistent JSON responses
4. **Structured logging** with timestamp, level, and metadata

## Folder Structure Rationale

The project follows a **modular architecture** where each business domain has its own directory under `src/modules/`. Each module will contain:

- `*.controller.ts` – HTTP request handling
- `*.service.ts` – Business logic
- `*.routes.ts` – Route definitions
- `*.validator.ts` – Input validation
- `*.types.ts` – TypeScript interfaces

This separation enables independent development, testing, and potential future extraction into microservices.
