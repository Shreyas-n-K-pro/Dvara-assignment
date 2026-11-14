import * as fs from 'fs';
import * as path from 'path';
import { scheduleService } from '../src/modules/schedules/schedule.service';
import { InterestType, RepaymentFrequency } from '@prisma/client';

export interface SyntheticBorrower {
  borrowerCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
}

export interface SyntheticLoanProduct {
  name: string;
  description: string;
  interestType: InterestType;
  repaymentFrequency: RepaymentFrequency;
  interestRateBps: number;
  minTenureMonths: number;
  maxTenureMonths: number;
  minAmountPaise: string;
  maxAmountPaise: string;
  penaltyRateBps: number;
  gracePeriodDays: number;
}

export interface SyntheticLoan {
  loanNumber: string;
  borrowerCode: string;
  productName: string;
  principalPaise: string;
  tenureMonths: number;
  interestRateBps: number;
  repaymentFrequency: RepaymentFrequency;
  interestType: InterestType;
  startDate: string;
  totalScheduleInstallments: number;
  installmentAmountPaise: string;
}

export interface SyntheticRepaymentEvent {
  eventId: string;
  idempotencyKey: string;
  loanNumber: string;
  loanId?: string; // Filled dynamically during replay
  borrowerCode: string;
  amountPaise: string;
  paymentDate: string; // ISO date of actual payment
  arrivalTimestamp: string; // ISO timestamp when received at API
  paymentReference: string;
  scenarioType:
    | 'VALID_REGULAR'
    | 'VALID_PARTIAL'
    | 'VALID_PREPAYMENT'
    | 'VALID_ODD_AMOUNT'
    | 'DUPLICATE_RETRY'
    | 'CONFLICT_KEY'
    | 'INVALID_NEGATIVE'
    | 'INVALID_ZERO'
    | 'INVALID_LOAN';
  expectedStatus: 200 | 201 | 400 | 404 | 409;
  originalEventId?: string;
  isOutOfOrder?: boolean;
}

export interface SyntheticDataset {
  metadata: {
    generatedAt: string;
    seed: number;
    borrowerCount: number;
    productCount: number;
    loanCount: number;
    totalEvents: number;
    eventBreakdown: {
      validUnique: number;
      duplicateRetries: number;
      conflicts: number;
      invalidNegative: number;
      invalidZero: number;
      invalidLoan: number;
    };
  };
  borrowers: SyntheticBorrower[];
  products: SyntheticLoanProduct[];
  loans: SyntheticLoan[];
  events: SyntheticRepaymentEvent[];
}

/**
 * Deterministic PRNG using Mulberry32 algorithm.
 */
export function createRng(seed: number) {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = [
  'Aarav', 'Vihaan', 'Vivaan', 'Ananya', 'Diya', 'Advik', 'Kabir', 'Anaya',
  'Ishaan', 'Rahul', 'Priya', 'Amit', 'Sunita', 'Rajesh', 'Sneha', 'Vikram',
  'Neha', 'Arjun', 'Pooja', 'Suresh', 'Meera', 'Deepak', 'Kavita', 'Sanjay',
  'Divya', 'Manoj', 'Ritu', 'Alok', 'Swati', 'Gaurav', 'Shilpa', 'Naveen',
  'Preeti', 'Rohan', 'Bhavna', 'Kiran', 'Nidhi', 'Harish', 'Geeta', 'Anil',
  'Shruti', 'Santosh', 'Usha', 'Ashok', 'Rekha', 'Pradeep', 'Madhu', 'Vinod'
];

const LAST_NAMES = [
  'Sharma', 'Patel', 'Verma', 'Iyer', 'Singh', 'Nair', 'Gupta', 'Rao',
  'Kulkarni', 'Joshi', 'Deshmukh', 'Reddy', 'Mehta', 'Bhat', 'Das', 'Chatterjee',
  'Mukherjee', 'Banerjee', 'Chauhan', 'Thakur', 'Yadav', 'Mishra', 'Pandey', 'Shukla',
  'Nambiar', 'Menon', 'Pillai', 'Shetty', 'Hegde', 'Gowda', 'Naidu', 'Kumar'
];

const CITIES = ['Bangalore', 'Chennai', 'Mumbai', 'Pune', 'Hyderabad', 'Delhi', 'Jaipur', 'Kochi'];

export function generateSyntheticDataset(seed = 42): SyntheticDataset {
  const rng = createRng(seed);

  function randomInt(min: number, max: number): number {
    return Math.floor(rng() * (max - min + 1)) + min;
  }

  function pick<T>(arr: T[]): T {
    return arr[randomInt(0, arr.length - 1)];
  }

  // 1. Exactly Three Products
  const products: SyntheticLoanProduct[] = [
    {
      name: 'Weekly Group Loan',
      description: 'Weekly group lending product with flat-rate interest',
      interestType: InterestType.FLAT,
      repaymentFrequency: RepaymentFrequency.WEEKLY,
      interestRateBps: 1500, // 15.00% p.a.
      minTenureMonths: 3,
      maxTenureMonths: 12,
      minAmountPaise: '500000',
      maxAmountPaise: '10000000',
      penaltyRateBps: 200,
      gracePeriodDays: 2,
    },
    {
      name: 'Monthly EMI Loan',
      description: 'Standard monthly loan with reducing-balance EMI interest',
      interestType: InterestType.REDUCING_BALANCE,
      repaymentFrequency: RepaymentFrequency.MONTHLY,
      interestRateBps: 1200, // 12.00% p.a.
      minTenureMonths: 6,
      maxTenureMonths: 60,
      minAmountPaise: '2000000',
      maxAmountPaise: '100000000',
      penaltyRateBps: 200,
      gracePeriodDays: 3,
    },
    {
      name: 'Flat Rate Loan',
      description: 'Monthly tenure loan with flat-rate interest calculated on original principal',
      interestType: InterestType.FLAT,
      repaymentFrequency: RepaymentFrequency.MONTHLY,
      interestRateBps: 1400, // 14.00% p.a.
      minTenureMonths: 3,
      maxTenureMonths: 36,
      minAmountPaise: '1000000',
      maxAmountPaise: '50000000',
      penaltyRateBps: 250,
      gracePeriodDays: 5,
    },
  ];

  // 2. Generate 300 Fictional Borrowers
  const borrowers: SyntheticBorrower[] = [];
  for (let i = 1; i <= 300; i++) {
    const fn = pick(FIRST_NAMES);
    const ln = pick(LAST_NAMES);
    const city = pick(CITIES);
    const code = `BW-SYN-${String(i).padStart(3, '0')}`;
    borrowers.push({
      borrowerCode: code,
      firstName: fn,
      lastName: ln,
      email: `synthetic.${fn.toLowerCase()}.${ln.toLowerCase()}.${i}@dvara-test.local`,
      phone: `98${String(10000000 + i).slice(1)}`,
      address: `House #${i}, 4th Cross, Indiranagar, ${city}`,
    });
  }

  // 3. Generate 300 Synthetic Loans (100 Weekly, 100 Monthly EMI, 100 Flat Rate)
  const loans: SyntheticLoan[] = [];
  for (let i = 1; i <= 300; i++) {
    let productName: string;
    let frequency: RepaymentFrequency;
    let interestType: InterestType;
    let rateBps: number;
    let tenureMonths: number;
    let principalPaise: bigint;
    let loanNumber: string;

    const borrowerCode = borrowers[i - 1].borrowerCode;
    const dayOffset = (i % 60);
    const startDate = new Date(Date.UTC(2026, 0, 1 + dayOffset));

    if (i <= 100) {
      // Weekly Group Loan
      productName = 'Weekly Group Loan';
      frequency = RepaymentFrequency.WEEKLY;
      interestType = InterestType.FLAT;
      rateBps = 1500;
      tenureMonths = randomInt(6, 12); // 26 - 52 weeks
      principalPaise = BigInt(randomInt(40000, 95000)) * 100n; // ₹40k - ₹95k
      loanNumber = `LN-SYN-W${String(i).padStart(3, '0')}`;
    } else if (i <= 200) {
      // Monthly EMI Loan
      productName = 'Monthly EMI Loan';
      frequency = RepaymentFrequency.MONTHLY;
      interestType = InterestType.REDUCING_BALANCE;
      rateBps = 1200;
      tenureMonths = randomInt(12, 24); // 12 - 24 months
      principalPaise = BigInt(randomInt(50000, 150000)) * 100n; // ₹50k - ₹150k
      loanNumber = `LN-SYN-M${String(i - 100).padStart(3, '0')}`;
    } else {
      // Flat Rate Loan
      productName = 'Flat Rate Loan';
      frequency = RepaymentFrequency.MONTHLY;
      interestType = InterestType.FLAT;
      rateBps = 1400;
      tenureMonths = randomInt(12, 24); // 12 - 24 months
      principalPaise = BigInt(randomInt(40000, 120000)) * 100n; // ₹40k - ₹120k
      loanNumber = `LN-SYN-F${String(i - 200).padStart(3, '0')}`;
    }

    const schedule = scheduleService.generateSchedule({
      principalPaise,
      interestRateBps: rateBps,
      tenure: tenureMonths,
      frequency,
      interestType,
      startDate,
    });

    const avgInstallment = schedule.installments.length > 0
      ? schedule.installments[0].totalPaise.toString()
      : '0';

    loans.push({
      loanNumber,
      borrowerCode,
      productName,
      principalPaise: principalPaise.toString(),
      tenureMonths,
      interestRateBps: rateBps,
      repaymentFrequency: frequency,
      interestType,
      startDate: startDate.toISOString(),
      totalScheduleInstallments: schedule.installments.length,
      installmentAmountPaise: avgInstallment,
    });
  }

  // 4. Generate Exactly 5,000 Repayment Events
  // Breakdown:
  // - 4,300 unique valid financial repayment events
  // - 500 deliberate retries (identical payload + same idempotencyKey)
  // - 50 deliberate conflicts (same key + modified payload)
  // - 150 invalid events (50 negative, 50 zero, 50 invalid loan ID)
  // Total = 4,300 + 500 + 50 + 150 = 5,000

  const validEvents: SyntheticRepaymentEvent[] = [];
  const baseArrivalEpoch = Date.UTC(2026, 3, 1, 9, 0, 0); // 2026-04-01 09:00:00 UTC

  for (let idx = 0; idx < 4300; idx++) {
    const loan = loans[idx % loans.length];
    const installmentAmount = BigInt(loan.installmentAmountPaise);

    // Scenario selection
    const rand = rng();
    let scenarioType: SyntheticRepaymentEvent['scenarioType'];
    let amountPaise: bigint;

    if (rand < 0.45) {
      // 45%: Partial payment (25% to 60% of installment)
      scenarioType = 'VALID_PARTIAL';
      const pct = BigInt(randomInt(25, 60));
      amountPaise = (installmentAmount * pct) / 100n;
      if (amountPaise <= 0n) amountPaise = 50000n; // ₹500
    } else if (rand < 0.75) {
      // 30%: Regular exact installment payment
      scenarioType = 'VALID_REGULAR';
      amountPaise = installmentAmount;
    } else if (rand < 0.90) {
      // 15%: Small odd paise amount (e.g. ₹750.50)
      scenarioType = 'VALID_ODD_AMOUNT';
      amountPaise = BigInt(randomInt(250, 1500)) * 100n + BigInt(randomInt(1, 99));
    } else {
      // 10%: Prepayment (1.2x to 1.5x of installment)
      scenarioType = 'VALID_PREPAYMENT';
      const multiplier = BigInt(randomInt(12, 15));
      amountPaise = (installmentAmount * multiplier) / 10n;
    }

    // Payment date: between loan start date and 90 days after
    const loanStart = new Date(loan.startDate).getTime();
    const paymentDayOffset = randomInt(5, 120);
    const paymentDate = new Date(loanStart + paymentDayOffset * 86400000);

    // Arrival timestamp: base arrival window with deliberate out-of-order jitter
    const arrivalSeconds = idx * 60 + randomInt(-300, 300);
    const arrivalTimestamp = new Date(baseArrivalEpoch + arrivalSeconds * 1000);

    const isOutOfOrder = paymentDayOffset % 7 === 0;

    const idempotencyKey = `IDEM-VAL-${String(idx + 1).padStart(5, '0')}`;
    const paymentReference = `REF-SYN-${loan.loanNumber}-${String(idx + 1).padStart(5, '0')}`;

    validEvents.push({
      eventId: `EVT-TMP-${idx + 1}`,
      idempotencyKey,
      loanNumber: loan.loanNumber,
      borrowerCode: loan.borrowerCode,
      amountPaise: amountPaise.toString(),
      paymentDate: paymentDate.toISOString().split('T')[0],
      arrivalTimestamp: arrivalTimestamp.toISOString(),
      paymentReference,
      scenarioType,
      expectedStatus: 201, // Valid financial payment
      isOutOfOrder,
    });
  }

  // 5. Deliberate Duplicate Retries (500 events)
  const duplicateEvents: SyntheticRepaymentEvent[] = [];
  const retryCandidates = validEvents.slice(0, 500);

  for (let i = 0; i < retryCandidates.length; i++) {
    const original = retryCandidates[i];
    const origArrival = new Date(original.arrivalTimestamp).getTime();
    const retryArrival = new Date(origArrival + (randomInt(30, 600) * 1000));

    duplicateEvents.push({
      eventId: `EVT-TMP-DUP-${i + 1}`,
      idempotencyKey: original.idempotencyKey,
      loanNumber: original.loanNumber,
      borrowerCode: original.borrowerCode,
      amountPaise: original.amountPaise,
      paymentDate: original.paymentDate,
      arrivalTimestamp: retryArrival.toISOString(),
      paymentReference: original.paymentReference,
      scenarioType: 'DUPLICATE_RETRY',
      expectedStatus: 200, // Replay returns cached 200 response
      originalEventId: original.eventId,
    });
  }

  // 6. Deliberate Conflicts (50 events)
  const conflictEvents: SyntheticRepaymentEvent[] = [];
  const conflictCandidates = validEvents.slice(500, 550);

  for (let i = 0; i < conflictCandidates.length; i++) {
    const original = conflictCandidates[i];
    const origArrival = new Date(original.arrivalTimestamp).getTime();
    const conflictArrival = new Date(origArrival + (randomInt(45, 450) * 1000));

    // Alter amount by adding 10,000 paise (₹100)
    const alteredAmount = (BigInt(original.amountPaise) + 10000n).toString();

    conflictEvents.push({
      eventId: `EVT-TMP-CONF-${i + 1}`,
      idempotencyKey: original.idempotencyKey,
      loanNumber: original.loanNumber,
      borrowerCode: original.borrowerCode,
      amountPaise: alteredAmount,
      paymentDate: original.paymentDate,
      arrivalTimestamp: conflictArrival.toISOString(),
      paymentReference: `${original.paymentReference}-MOD`,
      scenarioType: 'CONFLICT_KEY',
      expectedStatus: 409, // Conflict
      originalEventId: original.eventId,
    });
  }

  // 7. Invalid Event Scenarios (150 events: 50 negative, 50 zero, 50 non-existent loan)
  const invalidEvents: SyntheticRepaymentEvent[] = [];
  for (let i = 0; i < 50; i++) {
    const loan = loans[i % loans.length];
    const arrival = new Date(baseArrivalEpoch + (4300 * 60 + i * 30) * 1000);
    // Negative
    invalidEvents.push({
      eventId: `EVT-TMP-INV-NEG-${i + 1}`,
      idempotencyKey: `IDEM-INV-NEG-${String(i + 1).padStart(3, '0')}`,
      loanNumber: loan.loanNumber,
      borrowerCode: loan.borrowerCode,
      amountPaise: '-50000',
      paymentDate: '2026-04-10',
      arrivalTimestamp: arrival.toISOString(),
      paymentReference: `REF-INV-NEG-${i + 1}`,
      scenarioType: 'INVALID_NEGATIVE',
      expectedStatus: 400,
    });

    // Zero
    const arrivalZero = new Date(arrival.getTime() + 10000);
    invalidEvents.push({
      eventId: `EVT-TMP-INV-ZERO-${i + 1}`,
      idempotencyKey: `IDEM-INV-ZERO-${String(i + 1).padStart(3, '0')}`,
      loanNumber: loan.loanNumber,
      borrowerCode: loan.borrowerCode,
      amountPaise: '0',
      paymentDate: '2026-04-10',
      arrivalTimestamp: arrivalZero.toISOString(),
      paymentReference: `REF-INV-ZERO-${i + 1}`,
      scenarioType: 'INVALID_ZERO',
      expectedStatus: 400,
    });

    // Invalid Non-existent Loan
    const arrivalLoan = new Date(arrival.getTime() + 20000);
    invalidEvents.push({
      eventId: `EVT-TMP-INV-LOAN-${i + 1}`,
      idempotencyKey: `IDEM-INV-LOAN-${String(i + 1).padStart(3, '0')}`,
      loanNumber: 'LN-NON-EXISTENT-999',
      borrowerCode: 'BW-SYN-001',
      amountPaise: '500000',
      paymentDate: '2026-04-10',
      arrivalTimestamp: arrivalLoan.toISOString(),
      paymentReference: `REF-INV-LOAN-${i + 1}`,
      scenarioType: 'INVALID_LOAN',
      expectedStatus: 404,
    });
  }

  // Combine all 5,000 events
  const allEvents = [
    ...validEvents,
    ...duplicateEvents,
    ...conflictEvents,
    ...invalidEvents,
  ];

  if (allEvents.length !== 5000) {
    throw new Error(`Expected exactly 5,000 events, generated ${allEvents.length}`);
  }

  // Sort strictly by arrivalTimestamp to simulate chronological wire arrival
  allEvents.sort((a, b) => new Date(a.arrivalTimestamp).getTime() - new Date(b.arrivalTimestamp).getTime());

  // Assign clean sequential event IDs in arrival order
  for (let i = 0; i < allEvents.length; i++) {
    allEvents[i].eventId = `EVT-${String(i + 1).padStart(4, '0')}`;
  }

  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      seed,
      borrowerCount: borrowers.length,
      productCount: products.length,
      loanCount: loans.length,
      totalEvents: allEvents.length,
      eventBreakdown: {
        validUnique: validEvents.length,
        duplicateRetries: duplicateEvents.length,
        conflicts: conflictEvents.length,
        invalidNegative: 50,
        invalidZero: 50,
        invalidLoan: 50,
      },
    },
    borrowers,
    products,
    loans,
    events: allEvents,
  };
}

// CLI runner
if (require.main === module) {
  const targetDir = path.resolve(__dirname, '../data');
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const outputPath = path.join(targetDir, 'synthetic-dataset.json');
  console.log('Generating deterministic synthetic dataset (seed = 42)...');
  const dataset = generateSyntheticDataset(42);

  fs.writeFileSync(outputPath, JSON.stringify(dataset, null, 2), 'utf-8');
  console.log(`Successfully generated synthetic dataset with:`);
  console.log(`- Borrowers: ${dataset.borrowers.length}`);
  console.log(`- Products:  ${dataset.products.length}`);
  console.log(`- Loans:     ${dataset.loans.length}`);
  console.log(`- Events:    ${dataset.events.length}`);
  console.log(`Output written to: ${outputPath}`);
}
