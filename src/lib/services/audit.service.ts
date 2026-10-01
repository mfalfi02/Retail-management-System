import { Prisma } from "@prisma/client";

const sensitiveKey = /password|secret|token|authorization|cookie/i;

function safeAuditValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  const normalized = JSON.parse(JSON.stringify(value, (key, item: unknown) => {
    if (sensitiveKey.test(key)) return "[REDACTED]";
    if (item instanceof Prisma.Decimal) return item.toString();
    if (typeof item === "bigint") return item.toString();
    return item;
  })) as Prisma.InputJsonValue;
  return normalized;
}

export async function writeAudit(
  tx: Prisma.TransactionClient,
  entry: {
    userId?: string | null;
    action: string;
    module: string;
    entity?: string;
    entityId?: string;
    oldValue?: unknown;
    newValue?: unknown;
    ip?: string | null;
    userAgent?: string | null;
  },
) {
  const oldValue = safeAuditValue(entry.oldValue);
  const newValue = safeAuditValue(entry.newValue);
  return tx.auditLog.create({
    data: {
      userId: entry.userId ?? null,
      action: entry.action,
      module: entry.module,
      entity: entry.entity,
      entityId: entry.entityId,
      ...(oldValue === undefined ? {} : { oldValue }),
      ...(newValue === undefined ? {} : { newValue }),
      ip: entry.ip,
      userAgent: entry.userAgent,
    },
  });
}
