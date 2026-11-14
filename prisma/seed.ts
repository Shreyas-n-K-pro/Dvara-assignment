import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('Starting database seed...');

  // Create default admin user
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

  // Create default loan officer
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

  // Create sample loan products
  const personalLoan = await prisma.loanProduct.upsert({
    where: { name: 'Personal Loan' },
    update: {},
    create: {
      name: 'Personal Loan',
      description: 'Unsecured personal loan for salaried individuals',
      interestRateBps: 1200, // 12.00%
      minTenureMonths: 6,
      maxTenureMonths: 60,
      minAmountPaise: BigInt(5000000), // ₹50,000
      maxAmountPaise: BigInt(200000000), // ₹20,00,000
      penaltyRateBps: 200, // 2.00%
      processingFeeBps: 150, // 1.50%
    },
  });
  console.log(`Created loan product: ${personalLoan.name}`);

  const microLoan = await prisma.loanProduct.upsert({
    where: { name: 'Micro Enterprise Loan' },
    update: {},
    create: {
      name: 'Micro Enterprise Loan',
      description: 'Small business loan for micro enterprises',
      interestRateBps: 1500, // 15.00%
      minTenureMonths: 3,
      maxTenureMonths: 36,
      minAmountPaise: BigInt(1000000), // ₹10,000
      maxAmountPaise: BigInt(50000000), // ₹5,00,000
      penaltyRateBps: 250, // 2.50%
      processingFeeBps: 200, // 2.00%
    },
  });
  console.log(`Created loan product: ${microLoan.name}`);

  // Create system ledger accounts
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
    const created = await prisma.ledgerAccount.create({
      data: account,
    });
    console.log(`Created ledger account: ${created.name} (${created.accountType})`);
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
