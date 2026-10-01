import { authorizedStoreScopeId, requirePermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";
import { PosRegister } from "@/components/pos/register";

export default async function PosPage() {
  const user = await requirePermission("pos.access");
  const storeId = authorizedStoreScopeId(user);
  const stores = await prisma.store.findMany({ where: { status: "ACTIVE", ...(storeId ? { id: storeId } : {}) }, orderBy: { name: "asc" }, select: { id: true, name: true, warehouses: { where: { status: "ACTIVE" }, orderBy: { code: "asc" }, select: { id: true, name: true } } } });
  const [customers, paymentMethods] = await Promise.all([
    prisma.customer.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, take: 100, select: { id: true, name: true, customerCode: true } }),
    prisma.paymentMethod.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { type: true, name: true } }),
  ]);
  const initialStore = stores[0];
  const products = initialStore?.warehouses[0] ? await prisma.product.findMany({
    where: { status: "ACTIVE" }, orderBy: { name: "asc" }, take: 40,
    select: { id: true, name: true, sku: true, sellingPrice: true, taxRate: true, imageUrl: true, category: { select: { id: true, name: true } }, inventory: { where: { warehouseId: initialStore.warehouses[0].id }, select: { quantity: true, reservedQuantity: true } } },
  }) : [];
  const initialCatalog = products.map((product) => ({ id: product.id, name: product.name, sku: product.sku, sellingPrice: product.sellingPrice.toString(), taxRate: product.taxRate.toString(), imageUrl: product.imageUrl, categoryId: product.category?.id ?? null, category: product.category?.name ?? "Uncategorized", quantity: product.inventory[0]?.quantity.toString() ?? "0", reservedQuantity: product.inventory[0]?.reservedQuantity.toString() ?? "0" }));
  return <PosRegister stores={stores} initialCatalog={initialCatalog} customers={customers} paymentMethods={paymentMethods}/>;
}
