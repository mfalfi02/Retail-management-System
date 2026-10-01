"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertStoreAccess, requireAuth, requirePermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { runSerializableTransaction } from "@/lib/services/transaction.service";
import { writeAudit } from "@/lib/services/audit.service";

export async function changePassword(form:FormData){
 const user=await requireAuth();const parsed=z.object({currentPassword:z.string().min(1).max(200),newPassword:z.string().min(12).max(200),confirmPassword:z.string().min(12).max(200)}).safeParse(Object.fromEntries(form.entries()));
 if(!parsed.success||parsed.data.newPassword!==parsed.data.confirmPassword)redirect("/settings?tab=profile&error=password");
 const row=await prisma.user.findUnique({where:{id:user.id},select:{passwordHash:true}});if(!row||!(await verifyPassword(parsed.data.currentPassword,row.passwordHash)))redirect("/settings?tab=profile&error=password");
 const passwordHash=await hashPassword(parsed.data.newPassword);
 await runSerializableTransaction(async(tx)=>{await tx.user.update({where:{id:user.id},data:{passwordHash}});await writeAudit(tx,{userId:user.id,action:"PASSWORD_CHANGED",module:"AUTH",entity:"User",entityId:user.id});});
 revalidatePath("/settings");redirect("/settings?tab=profile&updated=password");
}

export async function updateStoreSettings(form:FormData){
 const user=await requirePermission("settings.manage");const parsed=z.object({storeId:z.string().min(1),name:z.string().trim().min(1).max(120),address:z.string().trim().max(4000).optional(),phone:z.string().trim().max(30).optional(),email:z.union([z.string().trim().email().max(190),z.literal("")]).optional()}).safeParse(Object.fromEntries(form.entries()));
 if(!parsed.success)redirect("/settings?tab=store&error=validation");assertStoreAccess(user,parsed.data.storeId);
 await runSerializableTransaction(async(tx)=>{const before=await tx.store.findUniqueOrThrow({where:{id:parsed.data.storeId},select:{name:true,address:true,phone:true,email:true}});const updated=await tx.store.update({where:{id:parsed.data.storeId},data:{name:parsed.data.name,address:parsed.data.address||null,phone:parsed.data.phone||null,email:parsed.data.email||null}});await writeAudit(tx,{userId:user.id,action:"UPDATED",module:"SETTINGS",entity:"Store",entityId:updated.id,oldValue:before,newValue:{name:updated.name,address:updated.address,phone:updated.phone,email:updated.email}});});
 revalidatePath("/settings");redirect("/settings?tab=store&updated=store");
}
