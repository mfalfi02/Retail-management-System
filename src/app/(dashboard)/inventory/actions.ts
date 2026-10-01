"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission, assertStoreAccess } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";
import { createStockAdjustment, approveStockAdjustment, completeStockAdjustment } from "@/lib/services/stock-documents.service";

export async function createAdjustment(form: FormData) {
  const user=await requirePermission("inventory.adjust");
  const parsed=z.object({warehouseId:z.string().min(1),productId:z.string().min(1),quantityDelta:z.coerce.number().finite().refine((value)=>value!==0),reason:z.string().trim().min(1).max(255)}).safeParse(Object.fromEntries(form.entries()));
  if(!parsed.success) redirect("/inventory?tab=adjustments&error=validation");
  const warehouse=await prisma.warehouse.findUnique({where:{id:parsed.data.warehouseId},select:{id:true,storeId:true}});
  if(!warehouse) redirect("/inventory?tab=adjustments&error=warehouse");
  assertStoreAccess(user,warehouse.storeId);
  await createStockAdjustment({warehouseId:warehouse.id,createdById:user.id,reason:parsed.data.reason,items:[{productId:parsed.data.productId,quantityDelta:parsed.data.quantityDelta}]});
  revalidatePath("/inventory");
  redirect("/inventory?tab=adjustments&created=1");
}

export async function approveAdjustmentAction(form: FormData) {
  const user=await requirePermission("inventory.adjust");
  const id=z.string().min(1).safeParse(form.get("id")); if(!id.success) redirect("/inventory?tab=adjustments&error=validation");
  await approveStockAdjustment(id.data,user.id); revalidatePath("/inventory"); redirect("/inventory?tab=adjustments");
}

export async function completeAdjustmentAction(form: FormData) {
  const user=await requirePermission("inventory.adjust");
  const id=z.string().min(1).safeParse(form.get("id")); if(!id.success) redirect("/inventory?tab=adjustments&error=validation");
  await completeStockAdjustment(id.data,user.id); revalidatePath("/inventory"); redirect("/inventory?tab=adjustments&completed=1");
}
