"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/authorization";
import { runSerializableTransaction } from "@/lib/services/transaction.service";
import { writeAudit } from "@/lib/services/audit.service";

const optional = z.string().trim().max(190).optional().transform((value) => value || null);
const productSchema = z.object({
  sku: z.string().trim().min(1).max(60), name: z.string().trim().min(1).max(180),
  barcode: z.string().trim().max(100).optional().transform((value) => value || null), categoryId: optional, brandId: optional,
  unitId: z.string().min(1), costPrice: z.coerce.number().finite().nonnegative().max(9_999_999_999_999.99),
  sellingPrice: z.coerce.number().finite().positive().max(9_999_999_999_999.99), minimumStock: z.coerce.number().finite().nonnegative().max(999_999_999_999.999),
  taxRate: z.coerce.number().finite().min(0).max(100), description: z.string().trim().max(4000).optional(),
});
function formObject(form: FormData) { return Object.fromEntries(form.entries()); }

export async function createProduct(form: FormData) {
  const user = await requirePermission("product.create");
  const parsed = productSchema.safeParse(formObject(form));
  if (!parsed.success) redirect("/products/new?error=validation");
  let productId: string;
  try {
    const product = await runSerializableTransaction(async (tx) => {
      const created = await tx.product.create({ data: parsed.data });
      await writeAudit(tx, { userId: user.id, action: "CREATED", module: "PRODUCTS", entity: "Product", entityId: created.id, newValue: { sku: created.sku, name: created.name } });
      return created;
    });
    revalidatePath("/products"); revalidatePath("/pos"); revalidatePath("/dashboard");
    productId = product.id;
  } catch {
    redirect("/products/new?error=duplicate");
  }
  redirect(`/products/${productId}`);
}

export async function updateProduct(form: FormData) {
  const user = await requirePermission("product.update");
  const id = z.string().min(1).safeParse(form.get("id"));
  const parsed = productSchema.safeParse(formObject(form));
  if (!id.success || !parsed.success) redirect("/products?error=validation");
  await runSerializableTransaction(async (tx) => {
    const before = await tx.product.findUniqueOrThrow({ where: { id: id.data }, select: { sku: true, name: true, sellingPrice: true } });
    const product = await tx.product.update({ where: { id: id.data }, data: parsed.data });
    await writeAudit(tx, { userId: user.id, action: "UPDATED", module: "PRODUCTS", entity: "Product", entityId: product.id, oldValue: before, newValue: { sku: product.sku, name: product.name, sellingPrice: product.sellingPrice.toString() } });
  });
  revalidatePath("/products"); revalidatePath(`/products/${id.data}`); revalidatePath("/pos");
  redirect(`/products/${id.data}`);
}

const contactSchema = z.object({ name: z.string().trim().min(1).max(150), email: z.union([z.string().trim().email().max(190), z.literal("")]).optional(), phone: z.string().trim().max(30).optional(), address: z.string().trim().max(4000).optional() });
const supplierSchema = contactSchema.extend({ contactPerson: z.string().trim().max(120).optional(), taxNumber: z.string().trim().max(60).optional() });

export async function createCustomer(form: FormData) {
  const user = await requirePermission("customer.manage");
  const parsed = contactSchema.safeParse(formObject(form));
  if (!parsed.success) redirect("/customers/new?error=validation");
  const customerCode = `CUS-${randomUUID().slice(0, 8).toUpperCase()}`;
  const customer = await runSerializableTransaction(async (tx) => {
    const created = await tx.customer.create({ data: { ...parsed.data, email: parsed.data.email || null, customerCode } });
    await writeAudit(tx, { userId: user.id, action: "CREATED", module: "CUSTOMERS", entity: "Customer", entityId: created.id, newValue: { customerCode, name: created.name } });
    return created;
  });
  revalidatePath("/customers"); revalidatePath("/pos");
  redirect(`/customers?created=${customer.customerCode}`);
}

export async function createSupplier(form: FormData) {
  const user = await requirePermission("supplier.manage");
  const parsed = supplierSchema.safeParse(formObject(form));
  if (!parsed.success) redirect("/suppliers/new?error=validation");
  const supplierCode = `SUP-${randomUUID().slice(0, 8).toUpperCase()}`;
  const supplier = await runSerializableTransaction(async (tx) => {
    const created = await tx.supplier.create({ data: { ...parsed.data, email: parsed.data.email || null, supplierCode } });
    await writeAudit(tx, { userId: user.id, action: "CREATED", module: "SUPPLIERS", entity: "Supplier", entityId: created.id, newValue: { supplierCode, name: created.name } });
    return created;
  });
  revalidatePath("/suppliers");
  redirect(`/suppliers?created=${supplier.supplierCode}`);
}

export async function updateCustomer(form:FormData){
  const user=await requirePermission("customer.manage");const id=z.string().min(1).safeParse(form.get("id"));const parsed=contactSchema.safeParse(formObject(form));if(!id.success||!parsed.success)redirect("/customers?error=validation");
  const customer=await runSerializableTransaction(async(tx)=>{const updated=await tx.customer.update({where:{id:id.data},data:{...parsed.data,email:parsed.data.email||null}});await writeAudit(tx,{userId:user.id,action:"UPDATED",module:"CUSTOMERS",entity:"Customer",entityId:updated.id,newValue:{name:updated.name,email:updated.email,phone:updated.phone}});return updated;});
  revalidatePath("/customers");redirect(`/customers/${customer.id}`);
}

export async function updateSupplier(form:FormData){
  const user=await requirePermission("supplier.manage");const id=z.string().min(1).safeParse(form.get("id"));const parsed=supplierSchema.safeParse(formObject(form));if(!id.success||!parsed.success)redirect("/suppliers?error=validation");
  const supplier=await runSerializableTransaction(async(tx)=>{const updated=await tx.supplier.update({where:{id:id.data},data:{...parsed.data,email:parsed.data.email||null}});await writeAudit(tx,{userId:user.id,action:"UPDATED",module:"SUPPLIERS",entity:"Supplier",entityId:updated.id,newValue:{name:updated.name,email:updated.email,phone:updated.phone}});return updated;});
  revalidatePath("/suppliers");redirect(`/suppliers/${supplier.id}`);
}
