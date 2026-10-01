-- Extend the existing retail schema without recreating existing tables.
-- Backfill historical creators before making these references required.

-- Existing transfer status was free-form. Normalize unknown values before
-- converting it to a database enum.
UPDATE `StockTransfer`
SET `status` = 'DRAFT'
WHERE `status` NOT IN ('DRAFT', 'PENDING', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED');

ALTER TABLE `StockAdjustment`
  ADD COLUMN `status` ENUM('DRAFT', 'APPROVED', 'COMPLETED', 'CANCELLED') NULL;
UPDATE `StockAdjustment` SET `status` = 'COMPLETED' WHERE `status` IS NULL;
ALTER TABLE `StockAdjustment`
  MODIFY `status` ENUM('DRAFT', 'APPROVED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT';

ALTER TABLE `StockTransfer`
  MODIFY `status` ENUM('DRAFT', 'PENDING', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT';

ALTER TABLE `Purchase` ADD COLUMN `createdById` VARCHAR(191) NULL;
UPDATE `Purchase`
SET `createdById` = (
  SELECT `id` FROM `User`
  ORDER BY (`username` = 'superadmin') DESC, `createdAt` ASC
  LIMIT 1
)
WHERE `createdById` IS NULL;
ALTER TABLE `Purchase` MODIFY `createdById` VARCHAR(191) NOT NULL;

ALTER TABLE `SaleReturn` ADD COLUMN `createdById` VARCHAR(191) NULL;
UPDATE `SaleReturn` AS `r`
JOIN `Sale` AS `s` ON `s`.`id` = `r`.`saleId`
SET `r`.`createdById` = `s`.`cashierId`
WHERE `r`.`createdById` IS NULL;
ALTER TABLE `SaleReturn` MODIFY `createdById` VARCHAR(191) NOT NULL;

CREATE INDEX `StockAdjustment_status_createdAt_idx` ON `StockAdjustment`(`status`, `createdAt`);
CREATE INDEX `Purchase_status_purchaseDate_idx` ON `Purchase`(`status`, `purchaseDate`);
CREATE INDEX `Sale_status_saleDate_idx` ON `Sale`(`status`, `saleDate`);
CREATE INDEX `SaleReturnItem_saleItemId_idx` ON `SaleReturnItem`(`saleItemId`);

ALTER TABLE `StockMovement`
  ADD CONSTRAINT `StockMovement_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `StockAdjustment`
  ADD CONSTRAINT `StockAdjustment_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `StockTransfer`
  ADD CONSTRAINT `StockTransfer_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `Purchase`
  ADD CONSTRAINT `Purchase_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `SaleReturn`
  ADD CONSTRAINT `SaleReturn_createdById_fkey`
  FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `SaleReturnItem`
  ADD CONSTRAINT `SaleReturnItem_saleItemId_fkey`
  FOREIGN KEY (`saleItemId`) REFERENCES `SaleItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
