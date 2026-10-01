CREATE TABLE `PurchaseReceiving` (
    `id` VARCHAR(191) NOT NULL,
    `requestKey` CHAR(36) NOT NULL,
    `requestHash` CHAR(64) NOT NULL,
    `purchaseId` VARCHAR(191) NOT NULL,
    `receivedById` VARCHAR(191) NOT NULL,
    `itemCount` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `PurchaseReceiving_requestKey_key`(`requestKey`),
    INDEX `PurchaseReceiving_purchaseId_createdAt_idx`(`purchaseId`, `createdAt`),
    INDEX `PurchaseReceiving_receivedById_idx`(`receivedById`),
    PRIMARY KEY (`id`),
    CONSTRAINT `PurchaseReceiving_purchaseId_fkey` FOREIGN KEY (`purchaseId`) REFERENCES `Purchase`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `PurchaseReceiving_receivedById_fkey` FOREIGN KEY (`receivedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
