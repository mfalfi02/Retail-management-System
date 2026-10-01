import { PrismaClient, AccountType, PaymentType } from "@prisma/client";
import { hash } from "bcryptjs";
import { assertDemoSeedEnvironment } from "../src/lib/services/seed-safety";

const prisma = new PrismaClient();
const permissionKeys = ["dashboard.view", "pos.access", "sale.create", "sale.view", "sale.return", "product.create", "product.update", "product.delete", "product.view", "inventory.view", "inventory.adjust", "inventory.transfer", "purchase.create", "purchase.approve", "purchase.view", "purchase.receive", "purchase.return", "customer.manage", "supplier.manage", "report.view", "user.manage", "settings.manage", "payment.manage", "expense.manage", "expense.create", "accounting.view", "accounting.journal.create"];
const roles: Record<string, string[]> = {
  SUPER_ADMIN: ["*"], ADMIN: permissionKeys,
  MANAGER: ["dashboard.view", "sale.view", "sale.return", "product.view", "inventory.view", "purchase.view", "purchase.create", "purchase.approve", "purchase.receive", "customer.manage", "supplier.manage", "report.view"],
  CASHIER: ["dashboard.view", "pos.access", "sale.create", "sale.view", "customer.manage"],
  INVENTORY_STAFF: ["dashboard.view", "product.view", "product.create", "product.update", "inventory.view", "inventory.adjust", "inventory.transfer"],
  PURCHASING: ["dashboard.view", "supplier.manage", "purchase.view", "purchase.create", "purchase.approve", "purchase.receive", "purchase.return"],
  ACCOUNTING: ["dashboard.view", "payment.manage", "expense.manage", "expense.create", "accounting.view", "accounting.journal.create", "report.view"],
  STAFF: ["dashboard.view"],
};

async function main() {
  assertDemoSeedEnvironment(process.env.NODE_ENV);
  const password = await hash("Demo-Only-2026!", 12);
  const store = await prisma.store.upsert({ where: { code: "JKT-01" }, update: {}, create: { code: "JKT-01", name: "Jakarta Central", address: "Jakarta, Indonesia", phone: "+62 21 555 0100" } });
  const mainWarehouse = await prisma.warehouse.upsert({ where: { storeId_code: { storeId: store.id, code: "MAIN" } }, update: {}, create: { code: "MAIN", name: "Main Warehouse", storeId: store.id } });
  const frontWarehouse = await prisma.warehouse.upsert({ where: { storeId_code: { storeId: store.id, code: "FRONT" } }, update: {}, create: { code: "FRONT", name: "Retail Front", address: "Jakarta, Indonesia", storeId: store.id } });
  const category = await prisma.category.upsert({ where: { name: "General" }, update: {}, create: { name: "General" } });
  const grocery = await prisma.category.upsert({ where: { name: "Grocery" }, update: {}, create: { name: "Grocery" } });
  const brand = await prisma.brand.upsert({ where: { name: "House Brand" }, update: {}, create: { name: "House Brand" } });
  const dailyGoods = await prisma.brand.upsert({ where: { name: "Daily Goods" }, update: {}, create: { name: "Daily Goods" } });
  const unit = await prisma.unit.upsert({ where: { symbol: "pcs" }, update: {}, create: { name: "Pieces", symbol: "pcs" } });
  const bottleUnit = await prisma.unit.upsert({ where: { symbol: "btl" }, update: {}, create: { name: "Bottle", symbol: "btl" } });
  const boxUnit = await prisma.unit.upsert({ where: { symbol: "box" }, update: {}, create: { name: "Box", symbol: "box" } });
  const products = [
    { sku: "DEMO-001", barcode: "899000000001", name: "Everyday Essentials", costPrice: 45000, sellingPrice: 65000, minimumStock: 10, categoryId: category.id, brandId: brand.id, unitId: unit.id },
    { sku: "DEMO-002", barcode: "899000000002", name: "Mineral Water 600ml", costPrice: 2500, sellingPrice: 4000, minimumStock: 24, categoryId: grocery.id, brandId: dailyGoods.id, unitId: bottleUnit.id },
    { sku: "DEMO-003", barcode: "899000000003", name: "Snack Pack", costPrice: 7000, sellingPrice: 10000, minimumStock: 12, categoryId: grocery.id, brandId: dailyGoods.id, unitId: boxUnit.id },
  ];
  for (const product of products) await prisma.product.upsert({ where: { sku: product.sku }, update: {}, create: product });
  await prisma.supplier.upsert({ where: { supplierCode: "SUP-001" }, update: {}, create: { supplierCode: "SUP-001", name: "Demo Supply Co.", phone: "+62 21 555 0110" } });
  await prisma.supplier.upsert({ where: { supplierCode: "SUP-002" }, update: {}, create: { supplierCode: "SUP-002", name: "Fresh Goods Distributor", phone: "+62 21 555 0120" } });
  await prisma.customer.upsert({ where: { customerCode: "CUS-WALKIN" }, update: {}, create: { customerCode: "CUS-WALKIN", name: "Walk-in Customer" } });
  await prisma.customer.upsert({ where: { customerCode: "CUS-001" }, update: {}, create: { customerCode: "CUS-001", name: "Demo Member", email: "member@example.test", phone: "+62 812 0000 0001", loyaltyPoints: 120 } });
  for (const type of Object.values(PaymentType)) await prisma.paymentMethod.upsert({ where: { type }, update: {}, create: { type, name: type.replaceAll("_", " ") } });
  const accountData: { code: string; name: string; type: AccountType }[] = [
    { code: "1000", name: "Cash and bank", type: "ASSET" }, { code: "1200", name: "Inventory", type: "ASSET" },
    { code: "2000", name: "Accounts payable", type: "LIABILITY" }, { code: "3000", name: "Owner equity", type: "EQUITY" },
    { code: "4000", name: "Sales revenue", type: "REVENUE" }, { code: "5000", name: "Cost of goods sold", type: "EXPENSE" },
  ];
  for (const account of accountData) await prisma.account.upsert({ where: { code: account.code }, update: {}, create: account });
  for (const name of ["Rent", "Utilities", "Store Supplies", "Transportation"]) await prisma.expenseCategory.upsert({ where: { name }, update: {}, create: { name } });
  const permissions = new Map<string, string>();
  for (const key of permissionKeys) {
    const row = await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
    permissions.set(key, row.id);
  }
  await prisma.permission.upsert({ where: { key: "role.manage" }, update: { description: "Manage role permission assignments" }, create: { key: "role.manage", description: "Manage role permission assignments" } });
  for (const [roleName, keys] of Object.entries(roles)) {
    const role = await prisma.role.upsert({ where: { name: roleName }, update: {}, create: { name: roleName, description: `Development role: ${roleName}` } });
    const expanded = keys.includes("*") ? [...permissionKeys, "*"] : keys;
    for (const key of expanded) {
      let id = permissions.get(key);
      if (!id) id = (await prisma.permission.upsert({ where: { key }, update: {}, create: { key } })).id;
      await prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: id } }, update: {}, create: { roleId: role.id, permissionId: id } });
    }
  }
  const users = [
    ["Super Administrator", "superadmin", "SUPER_ADMIN"], ["Administrator One", "admin1", "ADMIN"], ["Administrator Two", "admin2", "ADMIN"],
    ["Store Manager", "manager", "MANAGER"], ["Cashier One", "cashier1", "CASHIER"], ["Cashier Two", "cashier2", "CASHIER"],
    ["Inventory Staff", "inventory", "INVENTORY_STAFF"], ["Purchasing Staff", "purchasing", "PURCHASING"], ["Accounting Staff", "accounting", "ACCOUNTING"],
  ];
  for (const [name, username, roleName] of users) {
    const user = await prisma.user.upsert({ where: { username }, update: {}, create: { name, username, email: `${username}@example.test`, passwordHash: password, storeId: store.id } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, update: {}, create: { userId: user.id, roleId: role.id } });
  }
  const superAdmin = await prisma.user.findUniqueOrThrow({ where: { username: "superadmin" }, select: { id: true } });
  const initialStock = [
    { sku: "DEMO-001", main: "40", front: "10" },
    { sku: "DEMO-002", main: "240", front: "60" },
    { sku: "DEMO-003", main: "80", front: "20" },
  ];
  await prisma.$transaction(async (tx) => {
    for (const stock of initialStock) {
      const product = await tx.product.findUniqueOrThrow({ where: { sku: stock.sku }, select: { id: true, costPrice: true } });
      for (const [warehouseId, quantity] of [[mainWarehouse.id, stock.main], [frontWarehouse.id, stock.front]] as const) {
        const existing = await tx.inventory.findUnique({ where: { productId_warehouseId: { productId: product.id, warehouseId } } });
        if (existing) continue;
        await tx.inventory.create({ data: { productId: product.id, warehouseId, quantity, averageCost: product.costPrice } });
        await tx.stockMovement.create({ data: { productId: product.id, warehouseId, quantity, unitCost: product.costPrice, type: "INITIAL_STOCK", createdById: superAdmin.id, referenceType: "SEED", referenceId: "DEMO-INITIAL" } });
      }
    }
  });
  const settings = [
    ["company.name", "Retail Management System"], ["company.address", "Jakarta, Indonesia"],
    ["company.phone", "+62 21 555 0100"], ["company.email", "hello@example.test"],
    ["currency", "IDR"], ["timezone", "Asia/Jakarta"], ["inventory.allowNegativeStock", false],
    ["invoice.salePrefix", "INV"], ["invoice.purchasePrefix", "PUR"], ["invoice.purchaseReturnPrefix", "PRT"],
    ["invoice.returnPrefix", "RET"], ["invoice.refundPrefix", "RFD"], ["invoice.adjustmentPrefix", "ADJ"], ["invoice.transferPrefix", "TRF"],
    ["invoice.expensePrefix", "EXP"], ["invoice.journalPrefix", "JRN"], ["receipt.footer", "Thank you for shopping with us."],
    ["general", { companyName: "Retail Management System", currency: "IDR", timezone: "Asia/Jakarta", invoicePrefix: "INV", allowNegativeStock: false, lowStockThreshold: 10 }],
  ] as const;
  for (const [key, value] of settings) await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  console.info(`Development seed complete. Store ${store.code}; warehouses MAIN and FRONT. Demo password is documented in README.`);
}

main().finally(async () => prisma.$disconnect());
