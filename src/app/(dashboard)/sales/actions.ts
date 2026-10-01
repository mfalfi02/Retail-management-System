"use server";

import { PaymentType } from "@prisma/client";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/authorization";
import { processSaleReturn } from "@/lib/services/sales.service";

export async function createSaleReturn(form:FormData){
  const user=await requirePermission("sale.return");
  const parsed=z.object({saleId:z.string().min(1),saleItemId:z.string().min(1),quantity:z.coerce.number().finite().positive(),reason:z.string().trim().min(1).max(2000),refundMethod:z.nativeEnum(PaymentType),refundReference:z.string().max(120).optional(),requestKey:z.string().uuid()}).safeParse(Object.fromEntries(form.entries()));
  if(!parsed.success) redirect("/sales?error=return");
  const requestHash=createHash("sha256").update(JSON.stringify({userId:user.id,...parsed.data})).digest("hex");
  await processSaleReturn({saleId:parsed.data.saleId,processedById:user.id,reason:parsed.data.reason,refundMethod:parsed.data.refundMethod,refundReference:parsed.data.refundReference,requestKey:parsed.data.requestKey,requestHash,items:[{saleItemId:parsed.data.saleItemId,quantity:parsed.data.quantity}]});
  revalidatePath("/sales"); revalidatePath(`/sales/${parsed.data.saleId}`); revalidatePath("/inventory");
  redirect(`/sales/${parsed.data.saleId}?returned=1`);
}
