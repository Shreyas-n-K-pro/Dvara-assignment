/**
 * Double-Entry Accounting Ledger Service
 *
 * Implements strict double-entry bookkeeping rules:
 * - SUM(DEBIT) === SUM(CREDIT) for every posted transaction.
 * - All amounts are strictly positive BigInt integer paise.
 * - Transactions are posted atomically using Prisma transactions.
 * - Posted entries are strictly immutable (corrections via reversal transactions only).
 * - Balances are derived dynamically from ledger entries (no cached authoritative balances).
 * - Trial balance verification proves ledger integrity.
 */

import prisma from '../../config/database';
import {
  LedgerAccount,
  LedgerAccountType,
  EntryType,
  Prisma,
} from '@prisma/client';
import {
  CreateAccountDto,
  PostTransactionDto,
  AccountBalance,
  LoanOutstandingBalance,
  TrialBalanceReport,
  TrialBalanceAccountSummary,
  LedgerTransactionWithEntries,
} from './types';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from '../../utils/errors';

export class LedgerService {
  /**
   * 1. Creates a new ledger account.
   */
  async createAccount(
    dto: CreateAccountDto,
    tx?: Prisma.TransactionClient
  ): Promise<LedgerAccount> {
    const client = tx ?? prisma;

    if (!dto.name || dto.name.trim().length === 0) {
      throw new ValidationError('Account name is required');
    }

    if (!Object.values(LedgerAccountType).includes(dto.accountType)) {
      throw new ValidationError(`Invalid account type: ${dto.accountType}`);
    }

    // Check if account already exists with same name for this loan (or system level)
    const existing = await client.ledgerAccount.findFirst({
      where: {
        name: dto.name.trim(),
        loanId: dto.loanId ?? null,
      },
    });

    if (existing) {
      throw new ConflictError(
        `Ledger account '${dto.name}' already exists for ${dto.loanId ? `loan #${dto.loanId}` : 'system'}`
      );
    }

    return client.ledgerAccount.create({
      data: {
        name: dto.name.trim(),
        accountType: dto.accountType,
        loanId: dto.loanId ?? null,
      },
    });
  }

  /**
   * Retrieves an account by ID.
   */
  async getAccountById(
    id: string,
    tx?: Prisma.TransactionClient
  ): Promise<LedgerAccount> {
    const client = tx ?? prisma;
    const account = await client.ledgerAccount.findUnique({ where: { id } });
    if (!account) {
      throw new NotFoundError(`Ledger account with ID '${id}' not found`);
    }
    return account;
  }

  /**
   * Helper to retrieve or create a system account.
   */
  async getOrCreateSystemAccount(
    name: string,
    accountType: LedgerAccountType,
    tx?: Prisma.TransactionClient
  ): Promise<LedgerAccount> {
    const client = tx ?? prisma;
    const existing = await client.ledgerAccount.findFirst({
      where: { name, loanId: null },
    });
    if (existing) {
      return existing;
    }
    return client.ledgerAccount.create({
      data: { name, accountType, loanId: null },
    });
  }

  /**
   * Helper to retrieve or create a loan-specific ledger account.
   */
  async getOrCreateLoanAccount(
    loanId: string,
    name: string,
    accountType: LedgerAccountType,
    tx?: Prisma.TransactionClient
  ): Promise<LedgerAccount> {
    const client = tx ?? prisma;
    const existing = await client.ledgerAccount.findFirst({
      where: { name, loanId },
    });
    if (existing) {
      return existing;
    }
    return client.ledgerAccount.create({
      data: { name, accountType, loanId },
    });
  }

  /**
   * 2 & 3. Posts a balanced double-entry transaction atomically.
   *
   * Enforces:
   * - SUM(DEBIT) === SUM(CREDIT)
   * - At least one DEBIT entry and at least one CREDIT entry
   * - All entry amounts > 0n
   * - All referenced accounts exist and are active
   * - Atomic execution inside transaction
   */
  async postTransaction(
    dto: PostTransactionDto,
    externalTx?: Prisma.TransactionClient
  ): Promise<LedgerTransactionWithEntries> {
    this.validateTransactionDraft(dto);

    const execute = async (tx: Prisma.TransactionClient): Promise<LedgerTransactionWithEntries> => {
      // Validate all accounts exist and are active
      const accountIds = Array.from(new Set(dto.entries.map((e) => e.ledgerAccountId)));
      const accounts = await tx.ledgerAccount.findMany({
        where: { id: { in: accountIds } },
      });

      if (accounts.length !== accountIds.length) {
        const foundIds = new Set(accounts.map((a) => a.id));
        const missingIds = accountIds.filter((id) => !foundIds.has(id));
        throw new NotFoundError(`Invalid account reference(s): ${missingIds.join(', ')}`);
      }

      for (const account of accounts) {
        if (!account.isActive) {
          throw new ValidationError(
            `Cannot post to inactive ledger account: '${account.name}' (${account.id})`
          );
        }
      }

      // Check reversal validity if this is a reversal
      if (dto.reversalOfId) {
        const original = await tx.ledgerTransaction.findUnique({
          where: { id: dto.reversalOfId },
          include: { reversedBy: true },
        });

        if (!original) {
          throw new NotFoundError(`Transaction to reverse '${dto.reversalOfId}' not found`);
        }

        if (!original.posted) {
          throw new ValidationError('Cannot reverse an unposted transaction');
        }

        if (original.reversedBy) {
          throw new ConflictError(
            `Transaction '${dto.reversalOfId}' has already been reversed by transaction '${original.reversedBy.id}'`
          );
        }
      }

      // Create header and entries atomically
      const transaction = await tx.ledgerTransaction.create({
        data: {
          transactionRef: dto.transactionRef,
          description: dto.description,
          transactionDate: dto.transactionDate ?? new Date(),
          posted: true,
          reversalOfId: dto.reversalOfId,
          entries: {
            create: dto.entries.map((entry) => ({
              ledgerAccountId: entry.ledgerAccountId,
              entryType: entry.entryType,
              amountPaise: entry.amountPaise,
              posted: true,
            })),
          },
        },
        include: {
          entries: true,
        },
      });

      return transaction;
    };

    if (externalTx) {
      return execute(externalTx);
    }
    return prisma.$transaction(execute);
  }

  /**
   * 4. Calculates the derived balance of an individual ledger account.
   *
   * Sign conventions:
   * - ASSET / EXPENSE: Normal balance is DEBIT (Debits - Credits)
   * - LIABILITY / EQUITY / INCOME: Normal balance is CREDIT (Credits - Debits)
   */
  async getAccountBalance(
    accountId: string,
    asOfDate?: Date,
    tx?: Prisma.TransactionClient
  ): Promise<AccountBalance> {
    const client = tx ?? prisma;
    const account = await this.getAccountById(accountId, client);

    const dateFilter = asOfDate
      ? { transaction: { transactionDate: { lte: asOfDate } } }
      : {};

    const [debitAgg, creditAgg] = await Promise.all([
      client.ledgerEntry.aggregate({
        _sum: { amountPaise: true },
        where: {
          ledgerAccountId: accountId,
          entryType: EntryType.DEBIT,
          posted: true,
          ...dateFilter,
        },
      }),
      client.ledgerEntry.aggregate({
        _sum: { amountPaise: true },
        where: {
          ledgerAccountId: accountId,
          entryType: EntryType.CREDIT,
          posted: true,
          ...dateFilter,
        },
      }),
    ]);

    const debitTotalPaise = debitAgg._sum.amountPaise ?? 0n;
    const creditTotalPaise = creditAgg._sum.amountPaise ?? 0n;

    let netBalancePaise: bigint;
    if (
      account.accountType === LedgerAccountType.ASSET ||
      account.accountType === LedgerAccountType.EXPENSE
    ) {
      netBalancePaise = debitTotalPaise - creditTotalPaise;
    } else {
      netBalancePaise = creditTotalPaise - debitTotalPaise;
    }

    return {
      accountId: account.id,
      accountName: account.name,
      accountType: account.accountType,
      loanId: account.loanId,
      debitTotalPaise,
      creditTotalPaise,
      netBalancePaise,
    };
  }

  /**
   * 5. Derives the total outstanding balance of a loan from posted entries.
   *
   * Outstanding amounts are computed strictly from the ledger accounts tagged with `loanId`:
   * - Principal: Net debit balance of Loans Receivable accounts for this loan.
   * - Accrued Interest: Net debit balance of Interest Receivable accounts for this loan.
   * - Accrued Penalty: Net debit balance of Penalty Receivable accounts for this loan.
   */
  async getLoanOutstanding(
    loanId: string,
    asOfDate?: Date,
    tx?: Prisma.TransactionClient
  ): Promise<LoanOutstandingBalance> {
    const client = tx ?? prisma;

    const accounts = await client.ledgerAccount.findMany({
      where: { loanId },
    });

    let principalOutstanding = 0n;
    let interestOutstanding = 0n;
    let penaltyOutstanding = 0n;

    for (const acc of accounts) {
      const balance = await this.getAccountBalance(acc.id, asOfDate, client);

      const nameLower = acc.name.toLowerCase();
      if (nameLower.includes('principal') || nameLower.includes('receivable - principal') || nameLower.includes('loans receivable')) {
        principalOutstanding += balance.netBalancePaise;
      } else if (nameLower.includes('interest')) {
        interestOutstanding += balance.netBalancePaise;
      } else if (nameLower.includes('penalty')) {
        penaltyOutstanding += balance.netBalancePaise;
      }
    }

    return {
      loanId,
      principalOutstandingPaise: principalOutstanding,
      interestOutstandingPaise: interestOutstanding,
      penaltyOutstandingPaise: penaltyOutstanding,
      totalOutstandingPaise: principalOutstanding + interestOutstanding + penaltyOutstanding,
    };
  }

  /**
   * 6. Generates a complete Trial Balance report and verifies that:
   * SUM(ALL DEBITS) === SUM(ALL CREDITS)
   */
  async getTrialBalance(
    asOfDate?: Date,
    tx?: Prisma.TransactionClient
  ): Promise<TrialBalanceReport> {
    const client = tx ?? prisma;

    const accounts = await client.ledgerAccount.findMany({
      where: { isActive: true },
      orderBy: [{ accountType: 'asc' }, { name: 'asc' }],
    });

    let totalDebits = 0n;
    let totalCredits = 0n;
    const summaries: TrialBalanceAccountSummary[] = [];

    for (const acc of accounts) {
      const bal = await this.getAccountBalance(acc.id, asOfDate, client);

      totalDebits += bal.debitTotalPaise;
      totalCredits += bal.creditTotalPaise;

      summaries.push({
        accountId: acc.id,
        accountName: acc.name,
        accountType: acc.accountType,
        loanId: acc.loanId,
        debitTotalPaise: bal.debitTotalPaise,
        creditTotalPaise: bal.creditTotalPaise,
        netBalancePaise: bal.netBalancePaise,
      });
    }

    const differencePaise = totalDebits - totalCredits;
    const isBalanced = differencePaise === 0n;

    return {
      asOfDate: asOfDate ?? new Date(),
      accounts: summaries,
      totalDebitsPaise: totalDebits,
      totalCreditsPaise: totalCredits,
      differencePaise,
      isBalanced,
    };
  }

  /**
   * 7. Reverses a posted transaction by creating a compensating contra transaction.
   *
   * Every original DEBIT is posted as a CREDIT of equal amount.
   * Every original CREDIT is posted as a DEBIT of equal amount.
   * The original transaction remains completely intact and immutable.
   */
  async reverseTransaction(
    transactionId: string,
    reason?: string,
    externalTx?: Prisma.TransactionClient
  ): Promise<LedgerTransactionWithEntries> {
    const client = externalTx ?? prisma;

    const original = await client.ledgerTransaction.findUnique({
      where: { id: transactionId },
      include: {
        entries: true,
        reversedBy: true,
      },
    });

    if (!original) {
      throw new NotFoundError(`Transaction '${transactionId}' to reverse not found`);
    }

    if (!original.posted) {
      throw new ValidationError('Cannot reverse an unposted transaction');
    }

    if (original.reversedBy) {
      throw new ConflictError(
        `Transaction '${transactionId}' has already been reversed by transaction '${original.reversedBy.id}'`
      );
    }

    // Invert every entry: DEBIT -> CREDIT, CREDIT -> DEBIT
    const contraEntries: {
      ledgerAccountId: string;
      entryType: EntryType;
      amountPaise: bigint;
    }[] = original.entries.map((entry) => ({
      ledgerAccountId: entry.ledgerAccountId,
      entryType: entry.entryType === EntryType.DEBIT ? EntryType.CREDIT : EntryType.DEBIT,
      amountPaise: entry.amountPaise,
    }));

    const reversalDescription =
      reason ?? `Reversal of transaction #${original.transactionRef}: ${original.description}`;

    return this.postTransaction(
      {
        description: reversalDescription,
        transactionDate: new Date(),
        entries: contraEntries,
        reversalOfId: original.id,
      },
      client
    );
  }

  /**
   * Application-level immutability guard: Prevents updating posted ledger entries.
   */
  async updateEntry(): Promise<never> {
    throw new ForbiddenError(
      'Posted ledger entries are strictly immutable and cannot be updated. Use a compensating reversal transaction instead.'
    );
  }

  /**
   * Application-level immutability guard: Prevents deleting posted ledger entries.
   */
  async deleteEntry(): Promise<never> {
    throw new ForbiddenError(
      'Posted ledger entries are strictly immutable and cannot be deleted. Use a compensating reversal transaction instead.'
    );
  }

  /**
   * Validates transaction draft for double-entry invariants before execution.
   */
  private validateTransactionDraft(dto: PostTransactionDto): void {
    if (!dto.description || dto.description.trim().length === 0) {
      throw new ValidationError('Transaction description is required');
    }

    if (!dto.entries || dto.entries.length < 2) {
      throw new ValidationError(
        'A double-entry transaction must contain at least two entries (at least one debit and one credit)'
      );
    }

    let hasDebit = false;
    let hasCredit = false;
    let sumDebits = 0n;
    let sumCredits = 0n;

    for (let i = 0; i < dto.entries.length; i++) {
      const entry = dto.entries[i];

      if (!entry.ledgerAccountId) {
        throw new ValidationError(`Entry #${i + 1} is missing a ledger account reference`);
      }

      if (entry.amountPaise <= 0n) {
        throw new ValidationError(
          `Entry #${i + 1} has invalid amount: ${entry.amountPaise} paise. Entry amounts must be strictly greater than zero.`
        );
      }

      if (entry.entryType === EntryType.DEBIT) {
        hasDebit = true;
        sumDebits += entry.amountPaise;
      } else if (entry.entryType === EntryType.CREDIT) {
        hasCredit = true;
        sumCredits += entry.amountPaise;
      } else {
        throw new ValidationError(`Entry #${i + 1} has invalid entry type: ${entry.entryType}`);
      }
    }

    if (!hasDebit) {
      throw new ValidationError('Transaction rejected: missing debit entries');
    }

    if (!hasCredit) {
      throw new ValidationError('Transaction rejected: missing credit entries');
    }

    if (sumDebits !== sumCredits) {
      throw new ValidationError(
        `Transaction unbalanced: total debits (${sumDebits} paise) !== total credits (${sumCredits} paise). Difference: ${sumDebits - sumCredits} paise.`
      );
    }
  }
}

export const ledgerService = new LedgerService();
