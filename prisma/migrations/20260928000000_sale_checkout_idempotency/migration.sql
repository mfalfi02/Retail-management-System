ALTER TABLE `Sale`
    ADD COLUMN `checkoutKey` CHAR(36) NULL,
    ADD COLUMN `checkoutHash` CHAR(64) NULL,
    ADD UNIQUE INDEX `Sale_checkoutKey_key`(`checkoutKey`);
