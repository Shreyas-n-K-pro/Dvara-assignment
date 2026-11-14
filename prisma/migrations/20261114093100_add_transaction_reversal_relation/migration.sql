-- AlterTable
ALTER TABLE `ledger_transactions` ADD COLUMN `reversalOfId` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `ledger_transactions_reversalOfId_key` ON `ledger_transactions`(`reversalOfId`);

-- AddForeignKey
ALTER TABLE `ledger_transactions` ADD CONSTRAINT `ledger_transactions_reversalOfId_fkey` FOREIGN KEY (`reversalOfId`) REFERENCES `ledger_transactions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
