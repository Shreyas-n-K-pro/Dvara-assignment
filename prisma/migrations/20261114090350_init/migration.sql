-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `role` ENUM('ADMIN', 'OFFICER') NOT NULL DEFAULT 'OFFICER',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_email_idx`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `borrowers` (
    `id` VARCHAR(191) NOT NULL,
    `borrowerCode` VARCHAR(191) NOT NULL,
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NOT NULL,
    `address` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `borrowers_borrowerCode_key`(`borrowerCode`),
    INDEX `borrowers_borrowerCode_idx`(`borrowerCode`),
    INDEX `borrowers_createdById_idx`(`createdById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `loan_products` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `interestRateBps` INTEGER NOT NULL,
    `minTenureMonths` INTEGER NOT NULL,
    `maxTenureMonths` INTEGER NOT NULL,
    `minAmountPaise` BIGINT NOT NULL,
    `maxAmountPaise` BIGINT NOT NULL,
    `penaltyRateBps` INTEGER NOT NULL DEFAULT 0,
    `processingFeeBps` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `loan_products_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `loans` (
    `id` VARCHAR(191) NOT NULL,
    `loanNumber` VARCHAR(191) NOT NULL,
    `borrowerId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `principalPaise` BIGINT NOT NULL,
    `interestRateBps` INTEGER NOT NULL,
    `tenureMonths` INTEGER NOT NULL,
    `disbursedAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `status` ENUM('PENDING', 'ACTIVE', 'CLOSED', 'DEFAULTED', 'WRITTEN_OFF') NOT NULL DEFAULT 'PENDING',
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `loans_loanNumber_key`(`loanNumber`),
    INDEX `loans_loanNumber_idx`(`loanNumber`),
    INDEX `loans_borrowerId_idx`(`borrowerId`),
    INDEX `loans_status_idx`(`status`),
    INDEX `loans_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `repayment_schedules` (
    `id` VARCHAR(191) NOT NULL,
    `loanId` VARCHAR(191) NOT NULL,
    `installmentNumber` INTEGER NOT NULL,
    `dueDate` DATETIME(3) NOT NULL,
    `principalPaise` BIGINT NOT NULL,
    `interestPaise` BIGINT NOT NULL,
    `totalPaise` BIGINT NOT NULL,
    `status` ENUM('PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE') NOT NULL DEFAULT 'PENDING',
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `repayment_schedules_loanId_installmentNumber_idx`(`loanId`, `installmentNumber`),
    INDEX `repayment_schedules_dueDate_idx`(`dueDate`),
    INDEX `repayment_schedules_status_idx`(`status`),
    UNIQUE INDEX `repayment_schedules_loanId_installmentNumber_key`(`loanId`, `installmentNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `repayments` (
    `id` VARCHAR(191) NOT NULL,
    `loanId` VARCHAR(191) NOT NULL,
    `amountPaise` BIGINT NOT NULL,
    `paymentDate` DATETIME(3) NOT NULL,
    `paymentMethod` ENUM('CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'AUTO_DEBIT') NOT NULL DEFAULT 'BANK_TRANSFER',
    `referenceNumber` VARCHAR(191) NULL,
    `idempotencyKeyId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `repayments_idempotencyKeyId_key`(`idempotencyKeyId`),
    INDEX `repayments_loanId_idx`(`loanId`),
    INDEX `repayments_paymentDate_idx`(`paymentDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `repayment_allocations` (
    `id` VARCHAR(191) NOT NULL,
    `repaymentId` VARCHAR(191) NOT NULL,
    `scheduleId` VARCHAR(191) NOT NULL,
    `principalPaise` BIGINT NOT NULL,
    `interestPaise` BIGINT NOT NULL,
    `penaltyPaise` BIGINT NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `repayment_allocations_repaymentId_idx`(`repaymentId`),
    INDEX `repayment_allocations_scheduleId_idx`(`scheduleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ledger_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `accountType` ENUM('ASSET', 'LIABILITY', 'INCOME', 'EXPENSE', 'EQUITY') NOT NULL,
    `loanId` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ledger_accounts_accountType_idx`(`accountType`),
    INDEX `ledger_accounts_loanId_idx`(`loanId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ledger_transactions` (
    `id` VARCHAR(191) NOT NULL,
    `transactionRef` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `transactionDate` DATETIME(3) NOT NULL,
    `posted` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ledger_transactions_transactionRef_key`(`transactionRef`),
    INDEX `ledger_transactions_transactionDate_idx`(`transactionDate`),
    INDEX `ledger_transactions_posted_idx`(`posted`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ledger_entries` (
    `id` VARCHAR(191) NOT NULL,
    `ledgerTransactionId` VARCHAR(191) NOT NULL,
    `ledgerAccountId` VARCHAR(191) NOT NULL,
    `entryType` ENUM('DEBIT', 'CREDIT') NOT NULL,
    `amountPaise` BIGINT NOT NULL,
    `posted` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ledger_entries_ledgerTransactionId_idx`(`ledgerTransactionId`),
    INDEX `ledger_entries_ledgerAccountId_idx`(`ledgerAccountId`),
    INDEX `ledger_entries_posted_idx`(`posted`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idempotency_keys` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `response` JSON NULL,
    `statusCode` INTEGER NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `idempotency_keys_key_key`(`key`),
    INDEX `idempotency_keys_key_idx`(`key`),
    INDEX `idempotency_keys_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `accrual_records` (
    `id` VARCHAR(191) NOT NULL,
    `loanId` VARCHAR(191) NOT NULL,
    `accrualDate` DATE NOT NULL,
    `interestPaise` BIGINT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `accrual_records_loanId_idx`(`loanId`),
    INDEX `accrual_records_accrualDate_idx`(`accrualDate`),
    UNIQUE INDEX `accrual_records_loanId_accrualDate_key`(`loanId`, `accrualDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `ipAddress` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `audit_logs_userId_idx`(`userId`),
    INDEX `audit_logs_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `borrowers` ADD CONSTRAINT `borrowers_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `loans` ADD CONSTRAINT `loans_borrowerId_fkey` FOREIGN KEY (`borrowerId`) REFERENCES `borrowers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `loans` ADD CONSTRAINT `loans_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `loan_products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repayment_schedules` ADD CONSTRAINT `repayment_schedules_loanId_fkey` FOREIGN KEY (`loanId`) REFERENCES `loans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repayments` ADD CONSTRAINT `repayments_loanId_fkey` FOREIGN KEY (`loanId`) REFERENCES `loans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repayments` ADD CONSTRAINT `repayments_idempotencyKeyId_fkey` FOREIGN KEY (`idempotencyKeyId`) REFERENCES `idempotency_keys`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repayment_allocations` ADD CONSTRAINT `repayment_allocations_repaymentId_fkey` FOREIGN KEY (`repaymentId`) REFERENCES `repayments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `repayment_allocations` ADD CONSTRAINT `repayment_allocations_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `repayment_schedules`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ledger_accounts` ADD CONSTRAINT `ledger_accounts_loanId_fkey` FOREIGN KEY (`loanId`) REFERENCES `loans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ledger_entries` ADD CONSTRAINT `ledger_entries_ledgerTransactionId_fkey` FOREIGN KEY (`ledgerTransactionId`) REFERENCES `ledger_transactions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ledger_entries` ADD CONSTRAINT `ledger_entries_ledgerAccountId_fkey` FOREIGN KEY (`ledgerAccountId`) REFERENCES `ledger_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accrual_records` ADD CONSTRAINT `accrual_records_loanId_fkey` FOREIGN KEY (`loanId`) REFERENCES `loans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
