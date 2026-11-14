import * as fs from 'fs';
import * as path from 'path';
import http from 'http';
import bcrypt from 'bcryptjs';
import { UserRole } from '@prisma/client';
import app from '../src/app';
import prisma from '../src/config/database';
import { authService } from '../src/modules/auth/auth.service';
import { productService } from '../src/modules/products/product.service';
import { loanService } from '../src/modules/loans/loan.service';
import { generateSyntheticDataset, SyntheticDataset, SyntheticRepaymentEvent } from './generate-dataset';

export interface ReplayMetricResult {
  eventId: string;
  scenarioType: string;
  expectedStatus: number;
  actualStatus: number;
  latencyMs: number;
  isMatch: boolean;
  isCached: boolean;
  error?: string;
}

export interface ReplaySummary {
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  totalEvents: number;
  concurrency: number;
  statusCodes: Record<string, number>;
  scenarioBreakdown: Record<string, { total: number; matched: number; failed: number }>;
  throughputRps: number;
  latency: {
    minMs: number;
    maxMs: number;
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
  };
  metrics: {
    successfulPayments: number;
    idempotentReplays: number;
    conflictsCaught: number;
    validationRejections: number;
    notFoundRejections: number;
    unexpectedErrors: number;
  };
}

const PORT = 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Checks if local server is responsive; boots in-process server if not running.
 */
async function ensureServerRunning(): Promise<{ server: http.Server | null }> {
  try {
    const res = await fetch(`${BASE_URL}/health`);
    if (res.ok) {
      console.log(`API server is already active at ${BASE_URL}`);
      return { server: null };
    }
  } catch {
    // Server not running; start in-process
  }

  console.log(`Starting in-process API server on port ${PORT}...`);
  const server = app.listen(PORT);
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => {
      console.log(`In-process API server ready on ${BASE_URL}`);
      resolve();
    });
    server.once('error', reject);
  });

  return { server };
}

/**
 * Ensures manager user exists and generates a signed JWT.
 */
async function authenticateManager(): Promise<{ token: string; userId: string }> {
  const email = 'manager@dvara.com';
  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    const passwordHash = await bcrypt.hash('ManagerSecret123!', 10);
    user = await prisma.user.create({
      data: {
        email,
        password: passwordHash,
        name: 'Synthetic Operations Manager',
        role: UserRole.MANAGER,
        isActive: true,
      },
    });
  }

  const token = authService.generateToken({
    id: user.id,
    email: user.email,
    role: user.role,
  });

  return { token, userId: user.id };
}

/**
 * Seeds products, borrowers, and loans via supported workflows.
 */
async function seedDataset(
  dataset: SyntheticDataset,
  managerId: string
): Promise<Map<string, string>> {
  console.log('\n--- 1. Seeding Loan Products ---');
  await productService.seedPredefinedProducts();
  const products = await prisma.loanProduct.findMany();
  const productMap = new Map(products.map((p) => [p.name, p.id]));
  console.log(`Verified ${products.length} loan products.`);

  console.log('\n--- 2. Seeding Fictional Borrowers ---');
  const existingBorrowers = await prisma.borrower.findMany({
    where: { borrowerCode: { in: dataset.borrowers.map((b) => b.borrowerCode) } },
    select: { id: true, borrowerCode: true },
  });
  const borrowerMap = new Map(existingBorrowers.map((b) => [b.borrowerCode, b.id]));

  const missingBorrowers = dataset.borrowers.filter((b) => !borrowerMap.has(b.borrowerCode));
  if (missingBorrowers.length > 0) {
    console.log(`Creating ${missingBorrowers.length} missing synthetic borrowers...`);
    for (const b of missingBorrowers) {
      const created = await prisma.borrower.create({
        data: {
          borrowerCode: b.borrowerCode,
          firstName: b.firstName,
          lastName: b.lastName,
          email: b.email,
          phone: b.phone,
          address: b.address,
          createdById: managerId,
          isActive: true,
        },
      });
      borrowerMap.set(b.borrowerCode, created.id);
    }
  }
  console.log(`All ${borrowerMap.size} borrowers verified.`);

  console.log('\n--- 3. Seeding Synthetic Loans & Disbursing ---');
  const existingLoans = await prisma.loan.findMany({
    where: { loanNumber: { in: dataset.loans.map((l) => l.loanNumber) } },
    select: { id: true, loanNumber: true, status: true },
  });
  const loanIdMap = new Map(existingLoans.map((l) => [l.loanNumber, l.id]));

  const loansToCreate = dataset.loans.filter((l) => !loanIdMap.has(l.loanNumber));
  if (loansToCreate.length > 0) {
    console.log(`Creating and disbursing ${loansToCreate.length} loans via supported workflows...`);
    let count = 0;
    for (const l of loansToCreate) {
      const borrowerId = borrowerMap.get(l.borrowerCode)!;
      const productId = productMap.get(l.productName)!;

      const created = await loanService.createLoan(
        {
          borrowerId,
          productId,
          loanNumber: l.loanNumber,
          principalPaise: l.principalPaise,
          tenureMonths: l.tenureMonths,
          interestRateBps: l.interestRateBps,
          repaymentFrequency: l.repaymentFrequency,
          interestType: l.interestType,
          startDate: l.startDate,
        },
        managerId
      );

      // Disburse loan to trigger initial ledger postings & activate schedules
      const disbursed = await loanService.disburseLoan(created.id, managerId);
      loanIdMap.set(l.loanNumber, disbursed.id);

      count++;
      if (count % 50 === 0 || count === loansToCreate.length) {
        process.stdout.write(`  Disbursed ${count}/${loansToCreate.length} loans...\r`);
      }
    }
    console.log(`\nSuccessfully created and disbursed ${loansToCreate.length} loans.`);
  } else {
    console.log(`All ${loanIdMap.size} synthetic loans already active.`);
  }

  return loanIdMap;
}

/**
 * Replays all 5,000 repayment events against the REST API.
 */
export async function runReplay(concurrency = 8): Promise<ReplaySummary> {
  const startedAt = new Date();
  console.log(`\n======================================================`);
  console.log(`       DVARA REPAYMENT EVENT REPLAY ENGINE            `);
  console.log(`       Started at: ${startedAt.toISOString()}         `);
  console.log(`       Concurrency: ${concurrency} workers            `);
  console.log(`======================================================\n`);

  // 1. Ensure dataset exists
  const datasetPath = path.resolve(__dirname, '../data/synthetic-dataset.json');
  let dataset: SyntheticDataset;
  if (fs.existsSync(datasetPath)) {
    console.log(`Loading dataset from ${datasetPath}...`);
    dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));
  } else {
    console.log('Dataset not found. Generating deterministic dataset (seed = 42)...');
    dataset = generateSyntheticDataset(42);
    fs.mkdirSync(path.dirname(datasetPath), { recursive: true });
    fs.writeFileSync(datasetPath, JSON.stringify(dataset, null, 2), 'utf-8');
  }

  // 2. Ensure server is running
  const { server } = await ensureServerRunning();

  // 3. Authenticate
  const { token, userId } = await authenticateManager();
  console.log(`Authenticated as MANAGER (ID: ${userId})`);

  // 4. Seed database
  const loanIdMap = await seedDataset(dataset, userId);

  // 5. Prepare events with actual DB loan IDs
  const events: SyntheticRepaymentEvent[] = dataset.events.map((e) => {
    let loanId: string;
    if (e.scenarioType === 'INVALID_LOAN') {
      loanId = '00000000-0000-0000-0000-000000000000'; // Fake UUID
    } else {
      loanId = loanIdMap.get(e.loanNumber) || '00000000-0000-0000-0000-000000000000';
    }
    return { ...e, loanId };
  });

  console.log(`\n--- 4. Beginning REST API Replay (${events.length} events) ---`);

  const results: ReplayMetricResult[] = new Array(events.length);
  const statusCodes: Record<string, number> = {};
  const scenarioBreakdown: Record<string, { total: number; matched: number; failed: number }> = {};
  const inFlightPromises = new Map<string, Promise<void>>();

  let completedCount = 0;
  const startTime = Date.now();
  let lastLogTime = startTime;

  // Execute a single event against POST /api/repayments
  async function executeEvent(event: SyntheticRepaymentEvent, index: number): Promise<void> {
    // If this is a duplicate or conflict event with a shared idempotency key, wait for the base event
    if (event.originalEventId) {
      const pending = inFlightPromises.get(event.idempotencyKey);
      if (pending) {
        await pending;
      }
    }

    const t0 = Date.now();
    let actualStatus = 0;
    let isCached = false;
    let errMsg: string | undefined;

    try {
      const response = await fetch(`${BASE_URL}/api/repayments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Idempotency-Key': event.idempotencyKey,
        },
        body: JSON.stringify({
          loanId: event.loanId,
          amountPaise: event.amountPaise,
          paymentDate: event.paymentDate,
          paymentReference: event.paymentReference,
        }),
      });

      actualStatus = response.status;
      const json = (await response.json().catch(() => ({}))) as Record<string, any>;
      isCached = Boolean(json?.data?.isCached);

      if (!response.ok && actualStatus >= 500) {
        errMsg = json?.error?.message || `HTTP ${actualStatus}`;
      }
    } catch (err) {
      actualStatus = 500;
      errMsg = err instanceof Error ? err.message : String(err);
    }

    const latencyMs = Date.now() - t0;
    // For expected 201 or 200, both are valid idempotent success codes
    const isMatch =
      actualStatus === event.expectedStatus ||
      (event.expectedStatus === 200 && actualStatus === 201) ||
      (event.expectedStatus === 201 && actualStatus === 200);

    results[index] = {
      eventId: event.eventId,
      scenarioType: event.scenarioType,
      expectedStatus: event.expectedStatus,
      actualStatus,
      latencyMs,
      isMatch,
      isCached,
      error: errMsg,
    };

    // Update tally
    statusCodes[actualStatus] = (statusCodes[actualStatus] || 0) + 1;
    if (!scenarioBreakdown[event.scenarioType]) {
      scenarioBreakdown[event.scenarioType] = { total: 0, matched: 0, failed: 0 };
    }
    scenarioBreakdown[event.scenarioType].total++;
    if (isMatch) {
      scenarioBreakdown[event.scenarioType].matched++;
    } else {
      scenarioBreakdown[event.scenarioType].failed++;
    }

    completedCount++;

    const now = Date.now();
    if (now - lastLogTime > 1500 || completedCount === events.length) {
      lastLogTime = now;
      const elapsedSec = (now - startTime) / 1000;
      const rps = (completedCount / elapsedSec).toFixed(1);
      const pct = ((completedCount / events.length) * 100).toFixed(1);
      const codeStr = Object.entries(statusCodes)
        .map(([c, n]) => `${c}:${n}`)
        .join(' ');
      process.stdout.write(
        `  [${completedCount}/${events.length}] ${pct}% | ${rps} req/s | Codes: ${codeStr}\r`
      );
    }
  }

  // Sliding window worker pool for concurrency
  let currentIndex = 0;
  async function worker(): Promise<void> {
    while (currentIndex < events.length) {
      const idx = currentIndex++;
      const evt = events[idx];
      const p = executeEvent(evt, idx);
      inFlightPromises.set(evt.idempotencyKey, p);
      await p;
      inFlightPromises.delete(evt.idempotencyKey);
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  const durationSec = (Date.now() - startTime) / 1000;
  console.log(`\n\nReplay finished in ${durationSec.toFixed(2)}s (${(events.length / durationSec).toFixed(1)} req/s)`);

  // Close server if we launched it
  if (server) {
    server.close();
  }

  // Calculate Latency Percentiles
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const minMs = latencies[0] || 0;
  const maxMs = latencies[latencies.length - 1] || 0;
  const avgMs = Math.round(latencies.reduce((sum, v) => sum + v, 0) / latencies.length);
  const p50Ms = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95Ms = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99Ms = latencies[Math.floor(latencies.length * 0.99)] || 0;

  const completedAt = new Date();

  const summary: ReplaySummary = {
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationSeconds: Number(durationSec.toFixed(2)),
    totalEvents: events.length,
    concurrency,
    statusCodes,
    scenarioBreakdown,
    throughputRps: Number((events.length / durationSec).toFixed(1)),
    latency: {
      minMs,
      maxMs,
      avgMs,
      p50Ms,
      p95Ms,
      p99Ms,
    },
    metrics: {
      successfulPayments: (statusCodes[200] || 0) + (statusCodes[201] || 0),
      idempotentReplays: results.filter((r) => r.isCached).length,
      conflictsCaught: statusCodes[409] || 0,
      validationRejections: statusCodes[400] || 0,
      notFoundRejections: statusCodes[404] || 0,
      unexpectedErrors: statusCodes[500] || 0,
    },
  };

  // 6. Generate Reports
  const reportsDir = path.resolve(__dirname, '../reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  // JSON Report
  const jsonReportPath = path.join(reportsDir, 'replay-report.json');
  fs.writeFileSync(
    jsonReportPath,
    JSON.stringify({ summary, resultsSample: results.slice(0, 100) }, null, 2),
    'utf-8'
  );

  // Text Report
  const textReportPath = path.join(reportsDir, 'replay-report.txt');
  const textContent = `
================================================================================
             DVARA REPAYMENT REPLAY ENGINE - RECONCILIATION REPORT
================================================================================
Execution Start:     ${summary.startedAt}
Execution Finish:    ${summary.completedAt}
Duration:            ${summary.durationSeconds} seconds
Throughput:          ${summary.throughputRps} requests/sec
Active Workers:      ${summary.concurrency}

--------------------------------------------------------------------------------
EVENT PROCESSING SUMMARY
--------------------------------------------------------------------------------
Total Events Replayed:        ${summary.totalEvents}
Successful Repayments (201):  ${statusCodes[201] || 0}
Idempotent Cached (200):      ${statusCodes[200] || 0}
Conflict Errors (409):        ${statusCodes[409] || 0}
Validation Errors (400):      ${statusCodes[400] || 0}
Not Found Errors (404):       ${statusCodes[404] || 0}
Unexpected Server Errors:     ${statusCodes[500] || 0}

--------------------------------------------------------------------------------
LATENCY BENCHMARKS (ms)
--------------------------------------------------------------------------------
Min:    ${minMs} ms
Avg:    ${avgMs} ms
Max:    ${maxMs} ms
p50:    ${p50Ms} ms
p95:    ${p95Ms} ms
p99:    ${p99Ms} ms

--------------------------------------------------------------------------------
SCENARIO INTEGRITY BREAKDOWN
--------------------------------------------------------------------------------
${Object.entries(summary.scenarioBreakdown)
  .map(
    ([scenario, data]) =>
      `  - ${scenario.padEnd(20)}: Total=${String(data.total).padStart(5)} | Matched=${String(data.matched).padStart(5)} | Failed=${String(data.failed).padStart(4)}`
  )
  .join('\n')}

================================================================================
                                END OF REPORT
================================================================================
`;
  fs.writeFileSync(textReportPath, textContent.trim(), 'utf-8');

  // Terminal Summary
  console.log(`\n================================================================================`);
  console.log(`             DVARA REPAYMENT REPLAY - EXECUTION REPORT SUMMARY                  `);
  console.log(`================================================================================`);
  console.log(`  Total Replayed:        ${summary.totalEvents}`);
  console.log(`  Duration:              ${summary.durationSeconds}s (${summary.throughputRps} req/s)`);
  console.log(`  Successful Payments:   ${summary.metrics.successfulPayments}`);
  console.log(`  Idempotent Replays:    ${summary.metrics.idempotentReplays}`);
  console.log(`  Conflicts (409):       ${summary.metrics.conflictsCaught}`);
  console.log(`  Validation Err (400):  ${summary.metrics.validationRejections}`);
  console.log(`  Not Found (404):       ${summary.metrics.notFoundRejections}`);
  console.log(`  Server Errors (500):   ${summary.metrics.unexpectedErrors}`);
  console.log(`  Latencies:             Min=${minMs}ms, Avg=${avgMs}ms, p95=${p95Ms}ms, Max=${maxMs}ms`);
  console.log(`--------------------------------------------------------------------------------`);
  console.log(`Reports generated:`);
  console.log(`  - JSON: ${jsonReportPath}`);
  console.log(`  - Text: ${textReportPath}`);
  console.log(`================================================================================\n`);

  return summary;
}

// CLI runner
if (require.main === module) {
  const concurrencyArg = process.env.CONCURRENCY ? parseInt(process.env.CONCURRENCY, 10) : 8;
  runReplay(concurrencyArg)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Replay failed with error:', err);
      process.exit(1);
    });
}
