# Dvara Loan Account & Ledger Service

A production-grade Loan Account Management and Double-Entry Ledger Service built with Node.js, TypeScript, Express.js, Prisma ORM, and MySQL.

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (v20+) |
| Language | TypeScript (strict mode) |
| Framework | Express.js |
| ORM | Prisma 5 |
| Database | MySQL 8 |
| Containerization | Docker & Docker Compose |
| Testing | Jest + Supertest |
| Linting | ESLint + TypeScript ESLint |

## Project Structure

```
├── prisma/
│   ├── schema.prisma          # Database schema (13 entities)
│   └── seed.ts                # Database seeding script
├── src/
│   ├── config/
│   │   ├── index.ts           # Application configuration
│   │   └── database.ts        # Prisma client instance
│   ├── middleware/
│   │   ├── errorHandler.ts    # Centralized error handling
│   │   ├── requestLogger.ts   # HTTP request logging
│   │   └── index.ts
│   ├── modules/
│   │   ├── auth/              # Authentication & authorization
│   │   ├── borrowers/         # Borrower management
│   │   ├── products/          # Loan product definitions
│   │   ├── loans/             # Loan lifecycle management
│   │   ├── schedules/         # Repayment schedule generation
│   │   ├── repayments/        # Payment processing
│   │   ├── ledger/            # Double-entry ledger
│   │   ├── accruals/          # Interest accrual engine
│   │   └── audit/             # Audit trail
│   ├── utils/
│   │   ├── errors.ts          # Custom error classes
│   │   ├── logger.ts          # Structured logger
│   │   └── index.ts
│   ├── app.ts                 # Express app setup
│   └── server.ts              # Server entry point
├── tests/
│   ├── unit/                  # Unit tests
│   └── integration/           # Integration tests
├── docker-compose.yml         # MySQL 8 container
├── tsconfig.json              # TypeScript configuration (strict)
├── tsconfig.test.json         # TypeScript config for tests
├── jest.config.js             # Jest configuration
├── eslint.config.mjs          # ESLint configuration
├── .env.example               # Environment variable template
└── .gitignore
```

## Prerequisites

- **Node.js** v20 or higher
- **npm** v9 or higher
- **Docker** and **Docker Compose**
- **Git**

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/Shreyas-n-K-pro/Dvara-assignment.git
cd Dvara-assignment
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

```bash
cp .env.example .env
# Edit .env with your desired database credentials
```

### 4. Start MySQL via Docker

```bash
docker compose up -d
```

Wait for MySQL to be healthy:

```bash
docker compose ps
```

### 5. Run database migrations

```bash
npx prisma migrate dev --name init
```

### 6. Generate Prisma client

```bash
npx prisma generate
```

### 7. Seed the database

```bash
npx prisma db seed
```

### 8. Start the development server

```bash
npm run dev
```

The API will be available at `http://localhost:3000`.

### 9. Verify the setup

```bash
# Health check
curl http://localhost:3000/health

# API info
curl http://localhost:3000/api/v1
```

## Available Scripts

| Script | Description |
|--------|------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm start` | Start production server |
| `npm test` | Run all tests |
| `npm run test:unit` | Run unit tests only |
| `npm run test:integration` | Run integration tests only |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run lint` | Run ESLint |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:migrate` | Run database migrations |
| `npm run prisma:seed` | Seed the database |
| `npm run prisma:studio` | Open Prisma Studio GUI |
| `npm run docker:up` | Start MySQL container |
| `npm run docker:down` | Stop MySQL container |

## Supported Loan Products (Phase 2)

The engine provides 3 core loan products:

| Product | Frequency | Interest Type | Default Rate | Tenure Range | Amount Range |
|---------|-----------|---------------|--------------|--------------|--------------|
| **Weekly Group Loan** | `WEEKLY` | `FLAT` | 1500 bps (15.00%) | 12 to 52 weeks | ₹5,000 to ₹1,00,000 |
| **Monthly EMI Loan** | `MONTHLY` | `REDUCING_BALANCE` | 1200 bps (12.00%) | 6 to 60 months | ₹20,000 to ₹10,00,000 |
| **Flat Rate Loan** | `MONTHLY` | `FLAT` | 1400 bps (14.00%) | 3 to 36 months | ₹10,000 to ₹5,00,000 |

### Financial Calculation Engine Guarantees

- **No Floating-Point Math:** All calculations use integer paise (`BigInt`).
- **Half-Up Rounding:** Rounding follows strict half-up rules ($\ge 0.5$ paise rounds up).
- **Exact Schedule Reconciliation:**
  $$\sum \text{principalPaise} \equiv \text{originalPrincipalPaise}$$
  $$\sum \text{interestPaise} \equiv \text{totalCalculatedInterestPaise}$$
  $$\text{principalPaise}_i + \text{interestPaise}_i \equiv \text{totalPaise}_i \quad \forall i$$
- **Calendar & Month-End Handling:** Safe UTC handling with month-end date clamping (e.g. Jan 31 $\to$ Feb 28/29 $\to$ Mar 31).

## Double-Entry Accounting Ledger (Phase 3)

The ledger subsystem enforces strict double-entry bookkeeping rules:

### Core Capabilities
1. **Atomic Transaction Posting:** Every ledger transaction guarantees $\sum \text{DEBIT} \equiv \sum \text{CREDIT}$. Rejects any unbalanced, zero, negative, or invalid-account postings.
2. **Derived Balance Engine:** Neither loans nor accounts store authoritative mutable balances. Balances are derived dynamically:
   - **Assets & Expenses:** $\text{Debits} - \text{Credits}$
   - **Liabilities, Income & Equity:** $\text{Credits} - \text{Debits}$
   - **Loan Outstanding:** $\text{Principal Outstanding} + \text{Interest Outstanding} + \text{Penalty Outstanding}$
3. **Transaction Reversals:** Posted entries are immutable. Errors are corrected exclusively via compensating contra-reversal transactions (`isReversed = true`, referencing `reversalOfId`).
4. **Trial Balance Verification:** Verification engine ensuring global ledger integrity:
   $$\sum_{\text{all}} \text{Debits} \equiv \sum_{\text{all}} \text{Credits}$$
5. **Configurable Accounting Policies:** Declarative policy driving disbursements, repayments, interest accruals, and penalty accruals.


## Database Schema

The service uses 13 interconnected entities implementing a complete loan lifecycle with double-entry accounting:

### Core Entities

- **User** – System users (admins, loan officers)
- **Borrower** – Loan applicants with unique borrower codes
- **LoanProduct** – Loan templates with rates in basis points
- **Loan** – Issued loans with status lifecycle management

### Repayment Entities

- **RepaymentSchedule** – EMI installment schedule
- **Repayment** – Payment events with idempotency
- **RepaymentAllocation** – How each payment splits across installments

### Ledger Entities (Double-Entry Accounting)

- **LedgerAccount** – Chart of accounts (ASSET, LIABILITY, INCOME, EXPENSE, EQUITY)
- **LedgerTransaction** – Balanced group of entries
- **LedgerEntry** – Individual debit/credit entries (immutable once posted)

### Supporting Entities

- **IdempotencyKey** – Prevents duplicate payment processing
- **AccrualRecord** – Daily interest accrual tracking
- **AuditLog** – Complete audit trail with before/after snapshots

### Key Design Decisions

1. **No authoritative balance column** – Outstanding balances derived from ledger entries
2. **BIGINT for money** – All monetary values stored in paise (1 INR = 100 paise)
3. **Basis points for rates** – Interest rates as integers (1250 = 12.50%)
4. **Immutable posted entries** – Corrections via reversal transactions only
5. **Optimistic locking** – Version columns on Loan and RepaymentSchedule
6. **Prisma interactive transactions** – Atomic multi-table operations

## API Endpoints

### Available Endpoints

| Method | Path | Header | Description |
|--------|------|--------|-------------|
| GET | `/health` | - | Health check |
| GET | `/api/v1` | - | API metadata |
| POST | `/api/repayments` | `Idempotency-Key` (required) | Process loan repayment with waterfall allocation and atomic double-entry ledger posting |
| GET | `/api/repayments/:id` | - | Retrieve repayment details, schedule allocations, and idempotency status |
| GET | `/api/loans/:id/balance` | - | Retrieve derived outstanding balances (principal, interest, penalty, total) |
| GET | `/api/loans/:id/schedule` | - | Retrieve repayment installment schedule with paid and remaining balances |


## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | MySQL connection string | *required* |
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment | `development` |
| `JWT_SECRET` | JWT signing secret | *required in production* |
| `JWT_EXPIRES_IN` | JWT expiry duration | `24h` |

## License

ISC
