"use server";

import { PaymentType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission, assertStoreAccess } from "@/lib/auth/authorization";
import { generateExpenseNumber } from "@/lib/services/numbering.service";
import { runSerializableTransaction } from "@/lib/services/transaction.service";
import { writeAudit } from "@/lib/services/audit.service";

export async function createExpense(form:FormData){
 const user=await requirePermission("expense.create");const parsed=z.object({categoryId:z.string().min(1),storeId:z.string().min(1),amount:z.coerce.number().finite().positive().max(9_999_999_999_999.99),expenseDate:z.coerce.date(),paymentMethod:z.nativeEnum(PaymentType),description:z.string().trim().max(4000).optional()}).safeParse(Object.fromEntries(form.entries()));
 if(!parsed.success)redirect("/expenses?error=validation");assertStoreAccess(user,parsed.data.storeId);
 await runSerializableTransaction(async(tx)=>{const number=await generateExpenseNumber(tx);const expense=await tx.expense.create({data:{number,amount:parsed.data.amount,expenseDate:parsed.data.expenseDate,paymentMethod:parsed.data.paymentMethod,description:parsed.data.description||null,status:"DRAFT",categoryId:parsed.data.categoryId,storeId:parsed.data.storeId,createdById:user.id}});await writeAudit(tx,{userId:user.id,action:"CREATED",module:"EXPENSES",entity:"Expense",entityId:expense.id,newValue:{number,amount:expense.amount.toString()}});});
 revalidatePath("/expenses");redirect("/expenses?created=1");
}
