ALTER TABLE `SaleReturn`
    ADD COLUMN `requestKey` CHAR(36) NULL,
    ADD COLUMN `requestHash` CHAR(64) NULL,
    ADD UNIQUE INDEX `SaleReturn_requestKey_key`(`requestKey`);
