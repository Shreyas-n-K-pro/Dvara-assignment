-- DropIndex
DROP INDEX `accrual_records_loanId_accrualDate_key` ON `accrual_records`;

-- AlterTable
ALTER TABLE `accrual_records` ADD COLUMN `accrualType` ENUM('INTEREST', 'PENALTY') NOT NULL DEFAULT 'INTEREST',
    ADD COLUMN `amountPaise` BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN `penaltyPaise` BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN `scheduleId` VARCHAR(191) NULL,
    MODIFY `interestPaise` BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `loan_products` ADD COLUMN `gracePeriodDays` INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX `accrual_records_scheduleId_idx` ON `accrual_records`(`scheduleId`);

-- CreateIndex
CREATE UNIQUE INDEX `unique_schedule_date_type` ON `accrual_records`(`scheduleId`, `accrualDate`, `accrualType`);

-- AddForeignKey
ALTER TABLE `accrual_records` ADD CONSTRAINT `accrual_records_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `repayment_schedules`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
