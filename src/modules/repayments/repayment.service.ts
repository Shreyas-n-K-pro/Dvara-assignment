import {
  Prisma,
  LoanStatus,
  InstallmentStatus,
  PaymentMethod,
  RepaymentAllocation,
} from '@prisma/client';
import prisma from '../../config/database';
import { ledgerService } from '../ledger/ledger.service';
import { EntryType } from '../ledger/types';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from '../../utils/errors';
import { computeRequestHash } from '../../utils/idempotency';
import {
  CreateRepaymentDto,
  RepaymentResponseData,
  LoanScheduleInstallmentDetail,
  RepaymentWithDetails,
  LoanBalanceResponse,
} from './types';

interface LockedLoanRow {
  id: string;
  loanNumber: string;
  borrowerId: string;
  productId: string;
  interestType: string;
  repaymentFrequency: string;
  principalPaise: bigint;
  interestRateBps: number;
  tenureMonths: number;
  disbursedAt: Date | null;
  closedAt: Date | null;
  status: LoanStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

interface LockedIdempotencyRow {
  id: string;
  key: string;
  requestHash: string | null;
  response: string | Record<string, unknown> | null;
  statusCode: number | null;
}

export class RepaymentService {
  private readonly maxDeadlockRetries = 5;
  private readonly baseBackoffMs = 50;

  /**
   * Identifies transient database deadlock or lock wait timeout errors that are safe to retry.
   */
  private isRetryableDeadlockError(err: unknown): boolean {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // P2034: Transaction failed due to a write conflict or a deadlock.
      if (err.code === 'P2034') return true;
    }
    const msg = err instanceof Error ? err.message : String(err);
    return (
      msg.includes('Deadlock found') ||
      msg.includes('1213') ||
      msg.includes('Lock wait timeout') ||
      msg.includes('1205')
    );
  }

  /**
   * Processes a loan repayment safely under concurrency with database-level row locking
   * (SELECT FOR UPDATE), deadlock retry loop, waterfall allocation, and strict idempotency.
   */
  async processRepayment(
    dto: CreateRepaymentDto,
    idempotencyKey: string,
    userId?: string
  ): Promise<RepaymentResponseData> {
    let attempt = 0;
    while (true) {
      try {
        return await this.executeRepayment(dto, idempotencyKey, userId);
      } catch (err) {
        attempt++;
        if (attempt <= this.maxDeadlockRetries && this.isRetryableDeadlockError(err)) {
          const jitter = Math.floor(Math.random() * 50);
          const backoff = this.baseBackoffMs * Math.pow(2, attempt) + jitter;
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * Internal transactional worker implementing the full repayment workflow under exclusive lock.
   */
  private async executeRepayment(
    dto: CreateRepaymentDto,
    idempotencyKey: string,
    userId?: string
  ): Promise<RepaymentResponseData> {
    // 1. Basic input validation
    if (!dto.loanId || typeof dto.loanId !== 'string') {
      throw new ValidationError('Valid loanId is required');
    }

    if (!dto.paymentReference || typeof dto.paymentReference !== 'string') {
      throw new ValidationError('Valid paymentReference is required');
    }

    let amountPaise: bigint;
    try {
      amountPaise = BigInt(dto.amountPaise);
    } catch {
      throw new ValidationError('amountPaise must be a valid integer in paise');
    }

    if (amountPaise <= 0n) {
      throw new ValidationError('Repayment amount must be greater than zero');
    }

    const paymentDate = dto.paymentDate ? new Date(dto.paymentDate) : new Date();
    if (isNaN(paymentDate.getTime())) {
      throw new ValidationError('paymentDate must be a valid ISO date');
    }

    const paymentMethod = dto.paymentMethod ?? PaymentMethod.BANK_TRANSFER;

    // 2. Canonical request hashing for idempotency
    const requestHash = computeRequestHash('POST', '/api/repayments', {
      loanId: dto.loanId,
      amountPaise: amountPaise.toString(),
      paymentDate: paymentDate.toISOString(),
      paymentReference: dto.paymentReference.trim(),
    });

    // 3. Fast pre-check: if idempotency key already exists and committed, return immediately
    const existingKey = await prisma.idempotencyKey.findUnique({
      where: { key: idempotencyKey },
    });

    if (existingKey) {
      if (existingKey.requestHash && existingKey.requestHash !== requestHash) {
        throw new ConflictError(
          'Idempotency key has already been used with different request parameters'
        );
      }

      if (existingKey.response && existingKey.statusCode) {
        const cached = existingKey.response as unknown as RepaymentResponseData;
        return {
          ...cached,
          isCached: true,
        };
      }
    }

    try {
      // 4. Atomic transaction executing financial workflow
      return await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          // A. REQUIREMENT 1 & 7: Lock the loan row using SELECT ... FOR UPDATE (consistent lock ordering)
          const lockedLoans = await tx.$queryRaw<LockedLoanRow[]>`
            SELECT * FROM loans WHERE id = ${dto.loanId} FOR UPDATE
          `;

          const loan = lockedLoans[0];
          if (!loan) {
            throw new NotFoundError(`Loan with ID '${dto.loanId}' not found`);
          }

          // B. Concurrent Idempotency Check: check if another concurrent transaction committed this key
          // while this transaction was waiting for the loan lock
          const lockedKeys = await tx.$queryRaw<LockedIdempotencyRow[]>`
            SELECT * FROM idempotency_keys WHERE \`key\` = ${idempotencyKey} FOR UPDATE
          `;

          const existingKeyInTx = lockedKeys[0];
          if (existingKeyInTx) {
            if (existingKeyInTx.requestHash && existingKeyInTx.requestHash !== requestHash) {
              throw new ConflictError(
                'Idempotency key has already been used with different request parameters'
              );
            }

            if (existingKeyInTx.response) {
              const cached = (typeof existingKeyInTx.response === 'string'
                ? JSON.parse(existingKeyInTx.response)
                : existingKeyInTx.response) as RepaymentResponseData;
              return {
                ...cached,
                isCached: true,
              };
            }
          }

          // C. Validate loan status after acquiring exclusive lock
          if (loan.status === LoanStatus.CLOSED) {
            throw new ValidationError('Cannot process repayment for closed loan');
          }

          if (loan.status !== LoanStatus.ACTIVE) {
            throw new ValidationError(
              `Cannot process repayment for loan in ${loan.status} status`
            );
          }

          // D. REQUIREMENT 2 & 4 & 5: Derive loan outstanding balances AFTER obtaining lock
          const balances = await ledgerService.getLoanBalances(loan.id, tx);

          if (balances.totalOutstanding <= 0n) {
            throw new ValidationError('Loan has no outstanding balance');
          }

          // Validate overpayment under lock: prevents negative balances and prevents double-spending
          if (amountPaise > balances.totalOutstanding) {
            throw new ValidationError(
              `Repayment amount (${amountPaise} paise) exceeds total outstanding balance (${balances.totalOutstanding} paise)`
            );
          }

          // E. REQUIREMENT 7: Fetch repayment schedules ordered consistently by installment number
          const schedules = await tx.repaymentSchedule.findMany({
            where: { loanId: loan.id },
            include: { allocations: true },
            orderBy: { installmentNumber: 'asc' },
          });

          // F. Waterfall allocation:
          // 1. Penalties
          // 2. Accrued Interest
          // 3. Principal
          // Prioritizing oldest outstanding installments
          let remainingToAllocate: bigint = amountPaise;
          let totalPenaltyPaid: bigint = 0n;
          let totalInterestPaid: bigint = 0n;
          let totalPrincipalPaid: bigint = 0n;

          // 1. Penalties
          const penaltyOutstanding = balances.penaltyOutstanding;
          const penaltyToPay: bigint =
            remainingToAllocate < penaltyOutstanding
              ? remainingToAllocate
              : penaltyOutstanding;

          totalPenaltyPaid = penaltyToPay;
          remainingToAllocate -= penaltyToPay;

          // 2 & 3. Accrued interest and principal across installments
          const allocationsToCreate: Array<{
            scheduleId: string;
            installmentNumber: number;
            principalPaise: bigint;
            interestPaise: bigint;
            penaltyPaise: bigint;
            balanceRemainingPaise: bigint;
          }> = [];

          let unassignedPenalty: bigint = totalPenaltyPaid;

          for (const schedule of schedules) {
            if (remainingToAllocate === 0n && unassignedPenalty === 0n) {
              break;
            }

            const alreadyPaidPrincipal = schedule.allocations.reduce(
              (sum: bigint, a: RepaymentAllocation) => sum + a.principalPaise,
              0n
            );
            const alreadyPaidInterest = schedule.allocations.reduce(
              (sum: bigint, a: RepaymentAllocation) => sum + a.interestPaise,
              0n
            );

            const principalDue: bigint =
              schedule.principalPaise > alreadyPaidPrincipal
                ? schedule.principalPaise - alreadyPaidPrincipal
                : 0n;
            const interestDue: bigint =
              schedule.interestPaise > alreadyPaidInterest
                ? schedule.interestPaise - alreadyPaidInterest
                : 0n;

            if (principalDue === 0n && interestDue === 0n && unassignedPenalty === 0n) {
              continue;
            }

            // Assign penalty to oldest outstanding schedule
            const instPenalty: bigint = unassignedPenalty > 0n ? unassignedPenalty : 0n;
            unassignedPenalty = 0n;

            // Waterfall: Interest first
            const instInterest: bigint =
              remainingToAllocate < interestDue ? remainingToAllocate : interestDue;
            remainingToAllocate -= instInterest;
            totalInterestPaid += instInterest;

            // Waterfall: Principal second
            const instPrincipal: bigint =
              remainingToAllocate < principalDue ? remainingToAllocate : principalDue;
            remainingToAllocate -= instPrincipal;
            totalPrincipalPaid += instPrincipal;

            const newTotalPaidPrincipal: bigint = alreadyPaidPrincipal + instPrincipal;
            const newTotalPaidInterest: bigint = alreadyPaidInterest + instInterest;

            const instTotalDue: bigint = schedule.principalPaise + schedule.interestPaise;
            const instTotalPaid: bigint = newTotalPaidPrincipal + newTotalPaidInterest;
            const balanceRemaining: bigint =
              instTotalDue > instTotalPaid ? instTotalDue - instTotalPaid : 0n;

            allocationsToCreate.push({
              scheduleId: schedule.id,
              installmentNumber: schedule.installmentNumber,
              principalPaise: instPrincipal,
              interestPaise: instInterest,
              penaltyPaise: instPenalty,
              balanceRemainingPaise: balanceRemaining,
            });

            const isFullyPaid =
              newTotalPaidPrincipal >= schedule.principalPaise &&
              newTotalPaidInterest >= schedule.interestPaise;

            await tx.repaymentSchedule.update({
              where: { id: schedule.id },
              data: {
                status: isFullyPaid
                  ? InstallmentStatus.PAID
                  : InstallmentStatus.PARTIALLY_PAID,
                version: { increment: 1 },
              },
            });
          }

          // If there is any remaining amount (e.g. advance principal prepayment beyond scheduled interest)
          if (remainingToAllocate > 0n) {
            totalPrincipalPaid += remainingToAllocate;
            remainingToAllocate = 0n;
          }

          // G. Determine if loan is fully paid off
          const newPrincipalOutstanding: bigint =
            balances.principalOutstanding - totalPrincipalPaid;
          const newInterestOutstanding: bigint =
            balances.interestOutstanding - totalInterestPaid;
          const newPenaltyOutstanding: bigint =
            balances.penaltyOutstanding - totalPenaltyPaid;
          const isLoanFullyClosed =
            newPrincipalOutstanding <= 0n &&
            newInterestOutstanding <= 0n &&
            newPenaltyOutstanding <= 0n;

          let updatedLoanStatus: LoanStatus = loan.status;
          if (isLoanFullyClosed) {
            updatedLoanStatus = LoanStatus.CLOSED;
            await tx.loan.update({
              where: { id: loan.id },
              data: {
                status: LoanStatus.CLOSED,
                closedAt: paymentDate,
                version: { increment: 1 },
              },
            });
          }

          // H. REQUIREMENT 3: Double-Entry Accounting Ledger Posting inside the same transaction
          const cashBank = await ledgerService.getOrCreateSystemAccount(
            'Cash and Bank',
            'ASSET',
            tx
          );
          const loansReceivable = await ledgerService.getOrCreateLoanAccount(
            loan.id,
            'Loans Receivable',
            'ASSET',
            tx
          );
          const interestReceivable = await ledgerService.getOrCreateLoanAccount(
            loan.id,
            'Interest Receivable',
            'ASSET',
            tx
          );
          const interestIncome = await ledgerService.getOrCreateSystemAccount(
            'Interest Income',
            'INCOME',
            tx
          );
          const penaltyReceivable = await ledgerService.getOrCreateLoanAccount(
            loan.id,
            'Penalty Receivable',
            'ASSET',
            tx
          );
          const penaltyIncome = await ledgerService.getOrCreateSystemAccount(
            'Penalty Income',
            'INCOME',
            tx
          );

          // Split interest between accrued vs direct income
          const interestAccrued: bigint =
            totalInterestPaid < balances.interestOutstanding
              ? totalInterestPaid
              : balances.interestOutstanding;
          const interestDirect: bigint = totalInterestPaid - interestAccrued;

          // Split penalty between accrued vs direct income
          const penaltyAccrued: bigint =
            totalPenaltyPaid < balances.penaltyOutstanding
              ? totalPenaltyPaid
              : balances.penaltyOutstanding;
          const penaltyDirect: bigint = totalPenaltyPaid - penaltyAccrued;

          // Build balanced entries: SUM(DEBIT) === SUM(CREDIT)
          const ledgerEntries: Array<{
            ledgerAccountId: string;
            entryType: EntryType;
            amountPaise: bigint;
          }> = [];

          // 1. Debit Cash/Bank for total received
          ledgerEntries.push({
            ledgerAccountId: cashBank.id,
            entryType: EntryType.DEBIT,
            amountPaise,
          });

          // 2. Credit Loans Receivable for principal
          if (totalPrincipalPaid > 0n) {
            ledgerEntries.push({
              ledgerAccountId: loansReceivable.id,
              entryType: EntryType.CREDIT,
              amountPaise: totalPrincipalPaid,
            });
          }

          // 3. Credit Interest Receivable for accrued interest
          if (interestAccrued > 0n) {
            ledgerEntries.push({
              ledgerAccountId: interestReceivable.id,
              entryType: EntryType.CREDIT,
              amountPaise: interestAccrued,
            });
          }

          // 4. Credit Interest Income for direct unaccrued interest
          if (interestDirect > 0n) {
            ledgerEntries.push({
              ledgerAccountId: interestIncome.id,
              entryType: EntryType.CREDIT,
              amountPaise: interestDirect,
            });
          }

          // 5. Credit Penalty Receivable for accrued penalty
          if (penaltyAccrued > 0n) {
            ledgerEntries.push({
              ledgerAccountId: penaltyReceivable.id,
              entryType: EntryType.CREDIT,
              amountPaise: penaltyAccrued,
            });
          }

          // 6. Credit Penalty Income for direct unaccrued penalty
          if (penaltyDirect > 0n) {
            ledgerEntries.push({
              ledgerAccountId: penaltyIncome.id,
              entryType: EntryType.CREDIT,
              amountPaise: penaltyDirect,
            });
          }

          const ledgerTx = await ledgerService.postTransaction(
            {
              description: `Repayment of ₹${Number(amountPaise) / 100} for Loan #${loan.loanNumber}`,
              transactionDate: paymentDate,
              entries: ledgerEntries,
            },
            tx
          );

          // I. Create Idempotency Key record inside the transaction
          const idempotencyRecord = await tx.idempotencyKey.create({
            data: {
              key: idempotencyKey,
              requestHash,
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
            },
          });

          // J. Create Repayment record
          const repayment = await tx.repayment.create({
            data: {
              loanId: loan.id,
              amountPaise,
              paymentDate,
              paymentMethod,
              referenceNumber: dto.paymentReference.trim(),
              idempotencyKeyId: idempotencyRecord.id,
            },
          });

          // K. Create Repayment Allocations
          if (allocationsToCreate.length > 0) {
            await tx.repaymentAllocation.createMany({
              data: allocationsToCreate.map((a) => ({
                repaymentId: repayment.id,
                scheduleId: a.scheduleId,
                principalPaise: a.principalPaise,
                interestPaise: a.interestPaise,
                penaltyPaise: a.penaltyPaise,
              })),
            });
          }

          // L. Create Audit Log
          await tx.auditLog.create({
            data: {
              userId: userId ?? null,
              action: 'REPAYMENT_PROCESSED',
              entityType: 'Repayment',
              entityId: repayment.id,
              before: {
                loanStatus: loan.status,
                principalOutstanding: balances.principalOutstanding.toString(),
                interestOutstanding: balances.interestOutstanding.toString(),
                penaltyOutstanding: balances.penaltyOutstanding.toString(),
                totalOutstanding: balances.totalOutstanding.toString(),
              },
              after: {
                repaymentId: repayment.id,
                amountPaise: amountPaise.toString(),
                totalPrincipalPaid: totalPrincipalPaid.toString(),
                totalInterestPaid: totalInterestPaid.toString(),
                totalPenaltyPaid: totalPenaltyPaid.toString(),
                newPrincipalOutstanding: (newPrincipalOutstanding > 0n ? newPrincipalOutstanding : 0n).toString(),
                newInterestOutstanding: (newInterestOutstanding > 0n ? newInterestOutstanding : 0n).toString(),
                newPenaltyOutstanding: (newPenaltyOutstanding > 0n ? newPenaltyOutstanding : 0n).toString(),
                newTotalOutstanding: (
                  (newPrincipalOutstanding > 0n ? newPrincipalOutstanding : 0n) +
                  (newInterestOutstanding > 0n ? newInterestOutstanding : 0n) +
                  (newPenaltyOutstanding > 0n ? newPenaltyOutstanding : 0n)
                ).toString(),
                ledgerTransactionId: ledgerTx.id,
              },
            },
          });

          // M. Prepare final response
          const responseData: RepaymentResponseData = {
            repayment: {
              id: repayment.id,
              loanId: loan.id,
              amountPaise,
              paymentDate,
              paymentReference: repayment.referenceNumber,
              paymentMethod: repayment.paymentMethod,
              ledgerTransactionId: ledgerTx.id,
              allocations: allocationsToCreate.map((a) => ({
                scheduleId: a.scheduleId,
                installmentNumber: a.installmentNumber,
                principalPaise: a.principalPaise,
                interestPaise: a.interestPaise,
                penaltyPaise: a.penaltyPaise,
                balanceRemainingPaise: a.balanceRemainingPaise,
              })),
            },
            balances: {
              principalOutstanding:
                newPrincipalOutstanding > 0n ? newPrincipalOutstanding : 0n,
              interestOutstanding:
                newInterestOutstanding > 0n ? newInterestOutstanding : 0n,
              penaltyOutstanding:
                newPenaltyOutstanding > 0n ? newPenaltyOutstanding : 0n,
              totalOutstanding:
                (newPrincipalOutstanding > 0n ? newPrincipalOutstanding : 0n) +
                (newInterestOutstanding > 0n ? newInterestOutstanding : 0n) +
                (newPenaltyOutstanding > 0n ? newPenaltyOutstanding : 0n),
            },
            loanStatus: updatedLoanStatus,
            isCached: false,
          };

          // N. Cache response in IdempotencyKey
          await tx.idempotencyKey.update({
            where: { id: idempotencyRecord.id },
            data: {
              response: JSON.parse(JSON.stringify(responseData)),
              statusCode: 201,
            },
          });

          return responseData;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          timeout: 15000,
        }
      );
    } catch (err: unknown) {
      // Check if another concurrent request already inserted the key
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Query the committed record
        const committedKey = await prisma.idempotencyKey.findUnique({
          where: { key: idempotencyKey },
        });

        if (committedKey) {
          if (committedKey.requestHash && committedKey.requestHash !== requestHash) {
            throw new ConflictError(
              'Idempotency key has already been used with different request parameters'
            );
          }

          if (committedKey.response) {
            const cached = committedKey.response as unknown as RepaymentResponseData;
            return {
              ...cached,
              isCached: true,
            };
          }
        }
      }

      throw err;
    }
  }

  /**
   * Retrieves a repayment by ID with its allocations and loan info.
   */
  async getRepaymentById(id: string): Promise<RepaymentWithDetails> {
    const repayment = await prisma.repayment.findUnique({
      where: { id },
      include: {
        allocations: {
          include: {
            schedule: true,
          },
        },
        loan: true,
        idempotencyKey: true,
      },
    });

    if (!repayment) {
      throw new NotFoundError(`Repayment with ID '${id}' not found`);
    }

    return repayment;
  }

  /**
   * Retrieves derived balances for a loan.
   */
  async getLoanBalance(loanId: string): Promise<LoanBalanceResponse> {
    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
    });

    if (!loan) {
      throw new NotFoundError(`Loan with ID '${loanId}' not found`);
    }

    const balances = await ledgerService.getLoanBalances(loanId);

    return {
      loanId: loan.id,
      loanNumber: loan.loanNumber,
      status: loan.status,
      balances,
    };
  }

  /**
   * Retrieves full repayment schedule for a loan with payment allocations and remaining balances.
   */
  async getLoanSchedule(loanId: string): Promise<LoanScheduleInstallmentDetail[]> {
    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
    });

    if (!loan) {
      throw new NotFoundError(`Loan with ID '${loanId}' not found`);
    }

    const schedules = await prisma.repaymentSchedule.findMany({
      where: { loanId },
      include: {
        allocations: true,
      },
      orderBy: {
        installmentNumber: 'asc',
      },
    });

    return schedules.map((schedule) => {
      const paidPrincipal: bigint = schedule.allocations.reduce(
        (sum: bigint, a: RepaymentAllocation) => sum + a.principalPaise,
        0n
      );
      const paidInterest: bigint = schedule.allocations.reduce(
        (sum: bigint, a: RepaymentAllocation) => sum + a.interestPaise,
        0n
      );
      const paidPenalty: bigint = schedule.allocations.reduce(
        (sum: bigint, a: RepaymentAllocation) => sum + a.penaltyPaise,
        0n
      );

      const remainingPrincipal: bigint =
        schedule.principalPaise > paidPrincipal
          ? schedule.principalPaise - paidPrincipal
          : 0n;
      const remainingInterest: bigint =
        schedule.interestPaise > paidInterest
          ? schedule.interestPaise - paidInterest
          : 0n;

      return {
        id: schedule.id,
        installmentNumber: schedule.installmentNumber,
        dueDate: schedule.dueDate,
        principalPaise: schedule.principalPaise,
        interestPaise: schedule.interestPaise,
        totalPaise: schedule.totalPaise,
        status: schedule.status,
        paidPrincipalPaise: paidPrincipal,
        paidInterestPaise: paidInterest,
        paidPenaltyPaise: paidPenalty,
        remainingPrincipalPaise: remainingPrincipal,
        remainingInterestPaise: remainingInterest,
        remainingTotalPaise: remainingPrincipal + remainingInterest,
      };
    });
  }
}

export const repaymentService = new RepaymentService();
