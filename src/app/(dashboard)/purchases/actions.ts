"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission, assertStoreAccess } from "@/lib/auth/authorization";
import { createPurchase, approvePurchase, receivePurchase, processPurchaseReturn } from "@/lib/services/purchases.service";

export async function createPurchaseAction(form:FormData){
  const user=await requirePermission("purchase.create");
  const parsed=z.object({supplierId:z.string().min(1),storeId:z.string().min(1),warehouseId:z.string().min(1),items:z.string().min(2),notes:z.string().max(4000).optional()}).safeParse(Object.fromEntries(form.entries()));
  if(!parsed.success) redirect("/purchases/new?error=validation");
  let decoded:unknown;try{decoded=JSON.parse(parsed.data.items);}catch{redirect("/purchases/new?error=validation");}
  const items=z.array(z.object({productId:z.string().min(1),quantity:z.number().finite().positive(),unitCost:z.number().finite().nonnegative()})).min(1).max(100).safeParse(decoded);
  if(!items.success) redirect("/purchases/new?error=validation");
  assertStoreAccess(user,parsed.data.storeId);
  let purchaseId:string;
  try{const purchase=await createPurchase({supplierId:parsed.data.supplierId,storeId:parsed.data.storeId,warehouseId:parsed.data.warehouseId,createdById:user.id,notes:parsed.data.notes,items:items.data});purchaseId=purchase.id;}catch{redirect("/purchases/new?error=operation");}
  revalidatePath("/purchases");redirect(`/purchases/${purchaseId}`);
}

export async function approvePurchaseAction(form:FormData){const user=await requirePermission("purchase.approve");const id=z.string().min(1).safeParse(form.get("id"));if(!id.success)redirect("/purchases?error=validation");await approvePurchase(id.data,user.id);revalidatePath("/purchases");redirect(`/purchases/${id.data}`);}

export async function receivePurchaseAction(form:FormData){
  const user=await requirePermission("purchase.receive");const parsed=z.object({id:z.string().min(1),requestKey:z.string().uuid()}).safeParse({id:form.get("id"),requestKey:form.get("requestKey")});if(!parsed.success)redirect("/purchases?error=validation");const id=parsed.data.id;
  const lines=[...form.entries()].filter(([key])=>key.startsWith("receive-")).map(([key,value])=>({purchaseItemId:key.slice("receive-".length),quantity:Number(value)})).filter((item)=>item.quantity>0);
  const items=z.array(z.object({purchaseItemId:z.string().min(1),quantity:z.number().finite().positive()})).min(1).max(100).safeParse(lines);if(!items.success)redirect(`/purchases/${id}?error=validation`);
  await receivePurchase({purchaseId:id,receivedById:user.id,requestKey:parsed.data.requestKey,items:items.data});revalidatePath("/purchases");revalidatePath(`/purchases/${id}`);revalidatePath("/inventory");redirect(`/purchases/${id}?received=1`);
}

export async function returnPurchaseAction(form:FormData){
  const user=await requirePermission("purchase.return");const parsed=z.object({id:z.string().min(1),purchaseItemId:z.string().min(1),quantity:z.coerce.number().finite().positive(),reason:z.string().trim().min(1).max(2000)}).safeParse(Object.fromEntries(form.entries()));if(!parsed.success)redirect("/purchases?error=validation");
  await processPurchaseReturn({purchaseId:parsed.data.id,processedById:user.id,reason:parsed.data.reason,items:[{purchaseItemId:parsed.data.purchaseItemId,quantity:parsed.data.quantity}]});revalidatePath(`/purchases/${parsed.data.id}`);revalidatePath("/inventory");redirect(`/purchases/${parsed.data.id}?returned=1`);
}
