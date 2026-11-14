import prisma from '../../config/database';
import { ledgerService } from '../ledger/ledger.service';
import { auditService } from '../audit/audit.service';
import { ValidationError, NotFoundError } from '../../utils/errors';
import {
  TriggerAccrualDto,
  AccrualResult,
  RunOverdueAccrualDto,
  AccrualJobSummary,
  AccrualType,
} from './types';
import {
  calculateDailyInterest,
  calculateDailyPenalty,
  isInstallmentOverdue,
  truncateToUtcMidnight,
} from './accrual.math';
import { LoanStatus, InstallmentStatus, Prisma } from '@prisma/client';
import { logger } from '../../utils/logger';

export class AccrualService {
  /**
   * 1. Manual interest accrual trigger (Phase 6 backward compatibility)
   */
  async triggerManualAccrual(
    dto: TriggerAccrualDto,
    triggeredById: string,
    ipAddress?: string
  ): Promise<AccrualResult> {
    if (!dto.loanId) {
      throw new ValidationError('loanId is required');
    }

    let interestPaise: bigint;
    try {
      interestPaise = BigInt(dto.interestPaise);
    } catch {
      throw new ValidationError('interestPaise must be a valid integer in paise');
    }

    if (interestPaise <= 0n) {
      throw new ValidationError('interestPaise must be greater than zero');
    }

    const accrualDate = dto.accrualDate
      ? truncateToUtcMidnight(new Date(dto.accrualDate))
      : truncateToUtcMidnight(new Date());

    return prisma.$transaction(async (tx) => {
      const loan = await tx.loan.findUnique({
        where: { id: dto.loanId },
      });

      if (!loan) {
        throw new NotFoundError(`Loan with ID '${dto.loanId}' not found`);
      }

      if (loan.status !== LoanStatus.ACTIVE) {
        throw new ValidationError(`Cannot accrue interest on loan in ${loan.status} status`);
      }

      // Check for duplicate accrual on same date
      const existingAccrual = await tx.accrualRecord.findFirst({
        where: {
          loanId: loan.id,
          accrualDate,
          scheduleId: null,
          accrualType: AccrualType.INTEREST,
        },
      });

      if (existingAccrual) {
        throw new ValidationError(
          `Interest has already been accrued for loan #${loan.loanNumber} on ${accrualDate.toISOString().split('T')[0]}`
        );
      }

      // Accounts
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

      // Post balanced accrual transaction: Debit Interest Receivable, Credit Interest Income
      const ledgerTx = await ledgerService.postAccrual(
        {
          loanId: loan.id,
          amountPaise: interestPaise,
          receivableAccountId: interestReceivable.id,
          incomeAccountId: interestIncome.id,
          type: 'INTEREST',
          transactionDate: accrualDate,
          description: dto.description ?? `Manual interest accrual for Loan #${loan.loanNumber}`,
        },
        tx
      );

      // Create AccrualRecord
      const record = await tx.accrualRecord.create({
        data: {
          loanId: loan.id,
          accrualDate,
          accrualType: AccrualType.INTEREST,
          amountPaise: interestPaise,
          interestPaise,
        },
      });

      // Audit log
      await auditService.logAction(
        {
          userId: triggeredById,
          action: 'INTEREST_ACCRUED',
          entityType: 'AccrualRecord',
          entityId: record.id,
          after: {
            loanId: loan.id,
            interestPaise: interestPaise.toString(),
            accrualDate: accrualDate.toISOString(),
            ledgerTransactionId: ledgerTx.id,
          },
          ipAddress,
        },
        tx
      );

      return {
        accrualRecordId: record.id,
        loanId: loan.id,
        accrualDate,
        interestPaise,
        ledgerTransactionId: ledgerTx.id,
      };
    });
  }

  /**
   * 2. Overdue Interest and Penalty Accrual Engine (Phase 7 Scheduled Job)
   *
   * Iterates through all active loans, evaluates overdue installments past grace periods,
   * handles partial payments, posts balanced double-entry ledger transactions,
   * and creates immutable AccrualRecord entries.
   */
  async processOverdueAccruals(
    dto: RunOverdueAccrualDto = {},
    triggeredById?: string,
    ipAddress?: string
  ): Promise<AccrualJobSummary> {
    const startTime = Date.now();
    const asOfDate = dto.asOfDate
      ? truncateToUtcMidnight(new Date(dto.asOfDate))
      : truncateToUtcMidnight(new Date());

    const summary: AccrualJobSummary = {
      asOfDate,
      activeLoansChecked: 0,
      overdueInstalmentsFound: 0,
      interestAccrualsCreated: 0,
      penaltyAccrualsCreated: 0,
      totalInterestAccruedPaise: 0n,
      totalPenaltyAccruedPaise: 0n,
      skippedDueToGracePeriod: 0,
      skippedAlreadyAccrued: 0,
      ledgerTransactionsPosted: 0,
      durationMs: 0,
    };

    // Find active loans
    const loanWhere: Prisma.LoanWhereInput = {
      status: LoanStatus.ACTIVE,
      ...(dto.loanId ? { id: dto.loanId } : {}),
    };

    const activeLoans = await prisma.loan.findMany({
      where: loanWhere,
      select: { id: true, loanNumber: true },
      orderBy: { id: 'asc' },
    });

    summary.activeLoansChecked = activeLoans.length;

    for (const loanInfo of activeLoans) {
      await this.processLoanOverdueAccruals(
        loanInfo.id,
        asOfDate,
        summary,
        triggeredById,
        ipAddress
      );
    }

    summary.durationMs = Date.now() - startTime;
    logger.info('Overdue accrual run completed', {
      asOfDate: asOfDate.toISOString(),
      summary: {
        activeLoansChecked: summary.activeLoansChecked,
        overdueInstalmentsFound: summary.overdueInstalmentsFound,
        interestAccrualsCreated: summary.interestAccrualsCreated,
        penaltyAccrualsCreated: summary.penaltyAccrualsCreated,
        totalInterestPaise: summary.totalInterestAccruedPaise.toString(),
        totalPenaltyPaise: summary.totalPenaltyAccruedPaise.toString(),
        durationMs: summary.durationMs,
      },
    });

    return summary;
  }

  /**
   * Processes overdue accruals for an individual loan under an exclusive transaction row lock.
   */
  private async processLoanOverdueAccruals(
    loanId: string,
    asOfDate: Date,
    summary: AccrualJobSummary,
    triggeredById?: string,
    ipAddress?: string
  ): Promise<void> {
    try {
      await prisma.$transaction(
        async (tx) => {
          // 1. Acquire exclusive row lock on loan
          const lockedLoans = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM loans WHERE id = ${loanId} FOR UPDATE
          `;

          if (lockedLoans.length === 0) {
            return;
          }

          const loan = await tx.loan.findUnique({
            where: { id: loanId },
            include: {
              product: true,
              repaymentSchedule: {
                include: {
                  allocations: true,
                },
                orderBy: { installmentNumber: 'asc' },
              },
            },
          });

          if (!loan || loan.status !== LoanStatus.ACTIVE) {
            return;
          }

          const product = loan.product;
          const gracePeriodDays = product.gracePeriodDays ?? 0;
          const interestRateBps = loan.interestRateBps || product.interestRateBps;
          const penaltyRateBps = product.penaltyRateBps ?? 0;

          for (const schedule of loan.repaymentSchedule) {
            // Compute payments already allocated to this installment
            const paidPrincipal = schedule.allocations.reduce(
              (sum, a) => sum + a.principalPaise,
              0n
            );
            const paidInterest = schedule.allocations.reduce(
              (sum, a) => sum + a.interestPaise,
              0n
            );

            const unpaidPrincipal =
              schedule.principalPaise > paidPrincipal
                ? schedule.principalPaise - paidPrincipal
                : 0n;

            const unpaidInstalment =
              schedule.totalPaise > paidPrincipal + paidInterest
                ? schedule.totalPaise - (paidPrincipal + paidInterest)
                : 0n;

            // If fully satisfied, update status to PAID if needed and skip
            if (unpaidPrincipal === 0n && unpaidInstalment === 0n) {
              if (schedule.status !== InstallmentStatus.PAID) {
                await tx.repaymentSchedule.update({
                  where: { id: schedule.id },
                  data: { status: InstallmentStatus.PAID },
                });
              }
              continue;
            }

            // Check grace period and overdue condition
            const { isOverdue } = isInstallmentOverdue(
              schedule.dueDate,
              asOfDate,
              gracePeriodDays
            );

            if (!isOverdue) {
              summary.skippedDueToGracePeriod++;
              continue;
            }

            summary.overdueInstalmentsFound++;

            // Transition status to OVERDUE if PENDING
            if (schedule.status === InstallmentStatus.PENDING) {
              await tx.repaymentSchedule.update({
                where: { id: schedule.id },
                data: { status: InstallmentStatus.OVERDUE },
              });
            }

            // Calculate daily interest and penalty
            const dailyInterestPaise = calculateDailyInterest(
              unpaidPrincipal,
              interestRateBps
            );
            const dailyPenaltyPaise = calculateDailyPenalty(
              unpaidInstalment,
              penaltyRateBps
            );

            // 1. Accrue Daily Overdue Interest
            if (dailyInterestPaise > 0n) {
              const existingInterest = await tx.accrualRecord.findFirst({
                where: {
                  scheduleId: schedule.id,
                  accrualDate: asOfDate,
                  accrualType: AccrualType.INTEREST,
                },
              });

              if (existingInterest) {
                summary.skippedAlreadyAccrued++;
              } else {
                try {
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

                  const ledgerTx = await ledgerService.postAccrual(
                    {
                      loanId: loan.id,
                      amountPaise: dailyInterestPaise,
                      receivableAccountId: interestReceivable.id,
                      incomeAccountId: interestIncome.id,
                      type: 'INTEREST',
                      transactionDate: asOfDate,
                      description: `Overdue interest for Loan #${loan.loanNumber} Inst #${schedule.installmentNumber}`,
                    },
                    tx
                  );

                  const record = await tx.accrualRecord.create({
                    data: {
                      loanId: loan.id,
                      scheduleId: schedule.id,
                      accrualDate: asOfDate,
                      accrualType: AccrualType.INTEREST,
                      amountPaise: dailyInterestPaise,
                      interestPaise: dailyInterestPaise,
                    },
                  });

                  await auditService.logAction(
                    {
                      userId: triggeredById ?? null,
                      action: 'INTEREST_ACCRUED',
                      entityType: 'AccrualRecord',
                      entityId: record.id,
                      after: {
                        loanId: loan.id,
                        scheduleId: schedule.id,
                        installmentNumber: schedule.installmentNumber,
                        interestPaise: dailyInterestPaise.toString(),
                        unpaidPrincipalPaise: unpaidPrincipal.toString(),
                        accrualDate: asOfDate.toISOString(),
                        ledgerTransactionId: ledgerTx.id,
                      },
                      ipAddress,
                    },
                    tx
                  );

                  summary.interestAccrualsCreated++;
                  summary.totalInterestAccruedPaise += dailyInterestPaise;
                  summary.ledgerTransactionsPosted++;
                } catch (err: unknown) {
                  // If concurrent run created it first (P2002 duplicate key), handle safely
                  if (
                    err instanceof Prisma.PrismaClientKnownRequestError &&
                    err.code === 'P2002'
                  ) {
                    summary.skippedAlreadyAccrued++;
                  } else {
                    throw err;
                  }
                }
              }
            }

            // 2. Accrue Daily Overdue Penalty
            if (dailyPenaltyPaise > 0n) {
              const existingPenalty = await tx.accrualRecord.findFirst({
                where: {
                  scheduleId: schedule.id,
                  accrualDate: asOfDate,
                  accrualType: AccrualType.PENALTY,
                },
              });

              if (existingPenalty) {
                summary.skippedAlreadyAccrued++;
              } else {
                try {
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

                  const ledgerTx = await ledgerService.postAccrual(
                    {
                      loanId: loan.id,
                      amountPaise: dailyPenaltyPaise,
                      receivableAccountId: penaltyReceivable.id,
                      incomeAccountId: penaltyIncome.id,
                      type: 'PENALTY',
                      transactionDate: asOfDate,
                      description: `Overdue penalty for Loan #${loan.loanNumber} Inst #${schedule.installmentNumber}`,
                    },
                    tx
                  );

                  const record = await tx.accrualRecord.create({
                    data: {
                      loanId: loan.id,
                      scheduleId: schedule.id,
                      accrualDate: asOfDate,
                      accrualType: AccrualType.PENALTY,
                      amountPaise: dailyPenaltyPaise,
                      penaltyPaise: dailyPenaltyPaise,
                    },
                  });

                  await auditService.logAction(
                    {
                      userId: triggeredById ?? null,
                      action: 'PENALTY_ACCRUED',
                      entityType: 'AccrualRecord',
                      entityId: record.id,
                      after: {
                        loanId: loan.id,
                        scheduleId: schedule.id,
                        installmentNumber: schedule.installmentNumber,
                        penaltyPaise: dailyPenaltyPaise.toString(),
                        unpaidInstalmentPaise: unpaidInstalment.toString(),
                        accrualDate: asOfDate.toISOString(),
                        ledgerTransactionId: ledgerTx.id,
                      },
                      ipAddress,
                    },
                    tx
                  );

                  summary.penaltyAccrualsCreated++;
                  summary.totalPenaltyAccruedPaise += dailyPenaltyPaise;
                  summary.ledgerTransactionsPosted++;
                } catch (err: unknown) {
                  // If concurrent run created it first (P2002 duplicate key), handle safely
                  if (
                    err instanceof Prisma.PrismaClientKnownRequestError &&
                    err.code === 'P2002'
                  ) {
                    summary.skippedAlreadyAccrued++;
                  } else {
                    throw err;
                  }
                }
              }
            }
          }
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          timeout: 20000,
        }
      );
    } catch (error) {
      logger.error('Error processing overdue accruals for loan', {
        loanId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

export const accrualService = new AccrualService();
