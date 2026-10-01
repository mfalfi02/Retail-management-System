import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";

type Db = Prisma.TransactionClient | { setting: Prisma.TransactionClient["setting"] };

export async function getSettingValue(db: Db, key: string): Promise<Prisma.JsonValue | null> {
  const setting = await db.setting.findUnique({ where: { key }, select: { value: true } });
  return setting?.value ?? null;
}

export async function getSettingString(db: Db, key: string, fallback: string): Promise<string> {
  const value = await getSettingValue(db, key);
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export async function allowsNegativeInventory(db: Db): Promise<boolean> {
  const direct = await getSettingValue(db, "inventory.allowNegativeStock");
  if (typeof direct === "boolean") return direct;
  const general = await getSettingValue(db, "general");
  if (general && typeof general === "object" && !Array.isArray(general)) {
    return general.allowNegativeStock === true;
  }
  return false;
}

export async function generateDocumentNumber(
  db: Db,
  settingKey: string,
  fallbackPrefix: string,
  date = new Date(),
): Promise<string> {
  const prefix = await getSettingString(db, settingKey, fallbackPrefix);
  const datePart = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replaceAll("-", "");
  return `${prefix}-${datePart}-${randomBytes(5).toString("hex").toUpperCase()}`;
}

export const generateSaleInvoiceNumber = (db: Db, date?: Date) => generateDocumentNumber(db, "invoice.salePrefix", "INV", date);
export const generatePurchaseInvoiceNumber = (db: Db, date?: Date) => generateDocumentNumber(db, "invoice.purchasePrefix", "PUR", date);
export const generateStockAdjustmentNumber = (db: Db, date?: Date) => generateDocumentNumber(db, "invoice.adjustmentPrefix", "ADJ", date);
export const generateStockTransferNumber = (db: Db, date?: Date) => generateDocumentNumber(db, "invoice.transferPrefix", "TRF", date);
export const generateSaleReturnNumber = (db: Db, date?: Date) => generateDocumentNumber(db, "invoice.returnPrefix", "RET", date);
export const generatePurchaseReturnNumber = (db: Db, date?: Date) => generateDocumentNumber(db, "invoice.purchaseReturnPrefix", "PRT", date);
export const generateExpenseNumber = (db: Db, date?: Date) => generateDocumentNumber(db, "invoice.expensePrefix", "EXP", date);
export const generateJournalNumber = (db: Db, date?: Date) => generateDocumentNumber(db, "invoice.journalPrefix", "JRN", date);
