import { PrismaClient, InterestType, RepaymentFrequency, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('Starting database seed...');

  // 1. Create default seeded system users with bcrypt hashes
  const managerHash = await bcrypt.hash('ManagerSecret123!', 10);
  const officerHash = await bcrypt.hash('OfficerSecret123!', 10);
  const auditorHash = await bcrypt.hash('AuditorSecret123!', 10);

  const managerUser = await prisma.user.upsert({
    where: { email: 'manager@dvara.com' },
    update: { password: managerHash, role: UserRole.MANAGER },
    create: {
      email: 'manager@dvara.com',
      password: managerHash,
      name: 'Operations Manager',
      role: UserRole.MANAGER,
    },
  });
  console.log(`Created/updated manager user: ${managerUser.email} (${managerUser.role})`);

  const officerUser = await prisma.user.upsert({
    where: { email: 'officer@dvara.com' },
    update: { password: officerHash, role: UserRole.LOAN_OFFICER },
    create: {
      email: 'officer@dvara.com',
      password: officerHash,
      name: 'Loan Officer',
      role: UserRole.LOAN_OFFICER,
    },
  });
  console.log(`Created/updated loan officer user: ${officerUser.email} (${officerUser.role})`);

  const auditorUser = await prisma.user.upsert({
    where: { email: 'auditor@dvara.com' },
    update: { password: auditorHash, role: UserRole.AUDITOR },
    create: {
      email: 'auditor@dvara.com',
      password: auditorHash,
      name: 'Financial Auditor',
      role: UserRole.AUDITOR,
    },
  });
  console.log(`Created/updated auditor user: ${auditorUser.email} (${auditorUser.role})`);

  // 2. Create the three required loan products for Phase 2 & 7:
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
      gracePeriodDays: 3,
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
      gracePeriodDays: 3,
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
      gracePeriodDays: 3,
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
      gracePeriodDays: 3,
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
      gracePeriodDays: 3,
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
      gracePeriodDays: 3,
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
