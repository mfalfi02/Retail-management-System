import { Prisma } from "@prisma/client";
import { z } from "zod";
import { BusinessRuleError } from "@/lib/services/errors";
import { money, moneyInput, toDecimal } from "@/lib/services/decimal";
import { writeAudit } from "@/lib/services/audit.service";
import { generateDocumentNumber } from "@/lib/services/numbering.service";
import { runSerializableTransaction } from "@/lib/services/transaction.service";

const journalSchema = z.object({
  createdById: z.string().min(1),
  description: z.string().max(2000).optional(),
  sourceType: z.string().max(40).optional(),
  sourceId: z.string().max(100).optional(),
  entries: z.array(z.object({ accountId: z.string().min(1), debit: moneyInput, credit: moneyInput })).min(2),
});

export type CreateJournalInput = z.input<typeof journalSchema>;

export async function createBalancedJournal(rawInput: CreateJournalInput) {
  const input = journalSchema.parse(rawInput);
  const entries = input.entries.map((entry) => ({ accountId: entry.accountId, debit: money(toDecimal(entry.debit)), credit: money(toDecimal(entry.credit)) }));
  let debitTotal = new Prisma.Decimal(0);
  let creditTotal = new Prisma.Decimal(0);
  for (const entry of entries) {
    if (entry.debit.isNegative() || entry.credit.isNegative()) throw new BusinessRuleError("Journal debit and credit values cannot be negative.");
    if (entry.debit.isZero() === entry.credit.isZero()) throw new BusinessRuleError("Each journal line must have either a debit or a credit.");
    debitTotal = debitTotal.plus(entry.debit);
    creditTotal = creditTotal.plus(entry.credit);
  }
  if (debitTotal.isZero() || !debitTotal.equals(creditTotal)) throw new BusinessRuleError("Journal is not balanced.", "JOURNAL_UNBALANCED");

  return runSerializableTransaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.createdById }, select: { id: true, status: true } });
    if (!user || user.status !== "ACTIVE") throw new BusinessRuleError("Active journal creator is required.");
    const accounts = await tx.account.findMany({ where: { id: { in: entries.map((entry) => entry.accountId) }, active: true }, select: { id: true } });
    if (new Set(accounts.map(({ id }) => id)).size !== new Set(entries.map(({ accountId }) => accountId)).size) throw new BusinessRuleError("Every journal account must exist and be active.");
    const number = await generateDocumentNumber(tx, "invoice.journalPrefix", "JRN");
    const journal = await tx.journal.create({
      data: {
        number, description: input.description, sourceType: input.sourceType, sourceId: input.sourceId,
        entries: { create: entries },
      },
      select: { id: true, number: true },
    });
    await writeAudit(tx, { userId: input.createdById, action: "CREATED", module: "ACCOUNTING", entity: "Journal", entityId: journal.id, newValue: { number, debitTotal: debitTotal.toString(), creditTotal: creditTotal.toString(), sourceType: input.sourceType, sourceId: input.sourceId } });
    return journal;
  });
}
