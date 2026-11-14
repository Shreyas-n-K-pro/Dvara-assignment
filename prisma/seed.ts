import { PrismaClient, InterestType, RepaymentFrequency } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('Starting database seed...');

  // 1. Create default admin user
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@dvara.com' },
    update: {},
    create: {
      email: 'admin@dvara.com',
      password: '$2b$10$placeholder_hash_replace_in_production',
      name: 'System Admin',
      role: 'ADMIN',
    },
  });
  console.log(`Created admin user: ${adminUser.email}`);

  // 2. Create default loan officer
  const officerUser = await prisma.user.upsert({
    where: { email: 'officer@dvara.com' },
    update: {},
    create: {
      email: 'officer@dvara.com',
      password: '$2b$10$placeholder_hash_replace_in_production',
      name: 'Loan Officer',
      role: 'OFFICER',
    },
  });
  console.log(`Created officer user: ${officerUser.email}`);

  // 3. Create the three required loan products for Phase 2:
  // Product 1: Weekly Group Loan – weekly repayment, flat-rate interest.
  const weeklyGroupLoan = await prisma.loanProduct.upsert({
    where: { name: 'Weekly Group Loan' },
    update: {
      interestType: InterestType.FLAT,
      repaymentFrequency: RepaymentFrequency.WEEKLY,
      interestRateBps: 1500, // 15.00% p.a.
      minTenureMonths: 3,    // ~12 weeks
      maxTenureMonths: 12,   // ~52 weeks
      minAmountPaise: BigInt(500000),   // ₹5,000
      maxAmountPaise: BigInt(10000000), // ₹1,00,000
      penaltyRateBps: 200,
      processingFeeBps: 100,
    },
    create: {
      name: 'Weekly Group Loan',
      description: 'Weekly group lending product with flat-rate interest',
      interestType: InterestType.FLAT,
      repaymentFrequency: RepaymentFrequency.WEEKLY,
      interestRateBps: 1500, // 15.00% p.a.
      minTenureMonths: 3,    // ~12 weeks
      maxTenureMonths: 12,   // ~52 weeks
      minAmountPaise: BigInt(500000),   // ₹5,000
      maxAmountPaise: BigInt(10000000), // ₹1,00,000
      penaltyRateBps: 200,
      processingFeeBps: 100,
    },
  });
  console.log(`Created loan product: ${weeklyGroupLoan.name} (${weeklyGroupLoan.interestType}, ${weeklyGroupLoan.repaymentFrequency})`);

  // Product 2: Monthly EMI Loan – monthly repayment, reducing-balance interest.
  const monthlyEmiLoan = await prisma.loanProduct.upsert({
    where: { name: 'Monthly EMI Loan' },
    update: {
      interestType: InterestType.REDUCING_BALANCE,
      repaymentFrequency: RepaymentFrequency.MONTHLY,
      interestRateBps: 1200, // 12.00% p.a.
      minTenureMonths: 6,
      maxTenureMonths: 60,
      minAmountPaise: BigInt(2000000),   // ₹20,000
      maxAmountPaise: BigInt(100000000), // ₹10,00,000
      penaltyRateBps: 200,
      processingFeeBps: 150,
    },
    create: {
      name: 'Monthly EMI Loan',
      description: 'Standard monthly loan with reducing-balance EMI interest',
      interestType: InterestType.REDUCING_BALANCE,
      repaymentFrequency: RepaymentFrequency.MONTHLY,
      interestRateBps: 1200, // 12.00% p.a.
      minTenureMonths: 6,
      maxTenureMonths: 60,
      minAmountPaise: BigInt(2000000),   // ₹20,000
      maxAmountPaise: BigInt(100000000), // ₹10,00,000
      penaltyRateBps: 200,
      processingFeeBps: 150,
    },
  });
  console.log(`Created loan product: ${monthlyEmiLoan.name} (${monthlyEmiLoan.interestType}, ${monthlyEmiLoan.repaymentFrequency})`);

  // Product 3: Flat Rate Loan – monthly repayment, flat-rate interest.
  const flatRateLoan = await prisma.loanProduct.upsert({
    where: { name: 'Flat Rate Loan' },
    update: {
      interestType: InterestType.FLAT,
      repaymentFrequency: RepaymentFrequency.MONTHLY,
      interestRateBps: 1400, // 14.00% p.a.
      minTenureMonths: 3,
      maxTenureMonths: 36,
      minAmountPaise: BigInt(1000000),  // ₹10,000
      maxAmountPaise: BigInt(50000000), // ₹5,00,000
      penaltyRateBps: 250,
      processingFeeBps: 200,
    },
    create: {
      name: 'Flat Rate Loan',
      description: 'Monthly tenure loan with flat-rate interest calculated on original principal',
      interestType: InterestType.FLAT,
      repaymentFrequency: RepaymentFrequency.MONTHLY,
      interestRateBps: 1400, // 14.00% p.a.
      minTenureMonths: 3,
      maxTenureMonths: 36,
      minAmountPaise: BigInt(1000000),  // ₹10,000
      maxAmountPaise: BigInt(50000000), // ₹5,00,000
      penaltyRateBps: 250,
      processingFeeBps: 200,
    },
  });
  console.log(`Created loan product: ${flatRateLoan.name} (${flatRateLoan.interestType}, ${flatRateLoan.repaymentFrequency})`);

  // 4. Create system ledger accounts (idempotent lookup)
  const systemAccounts = [
    { name: 'Cash / Bank', accountType: 'ASSET' as const },
    { name: 'Loans Receivable - Principal', accountType: 'ASSET' as const },
    { name: 'Accrued Interest Receivable', accountType: 'ASSET' as const },
    { name: 'Interest Income', accountType: 'INCOME' as const },
    { name: 'Penalty Income', accountType: 'INCOME' as const },
    { name: 'Processing Fee Income', accountType: 'INCOME' as const },
    { name: 'Loan Loss Provision', accountType: 'EXPENSE' as const },
  ];

  for (const account of systemAccounts) {
    const existing = await prisma.ledgerAccount.findFirst({
      where: { name: account.name, loanId: null },
    });
    if (!existing) {
      const created = await prisma.ledgerAccount.create({ data: account });
      console.log(`Created ledger account: ${created.name} (${created.accountType})`);
    } else {
      console.log(`Ledger account already exists: ${existing.name}`);
    }
  }

  console.log('Database seed completed successfully.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
