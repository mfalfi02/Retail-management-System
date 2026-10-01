import { redirect } from "next/navigation";
import { authorizedStoreScopeId, requirePermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";
import { PageHeader } from "@/components/ui/page-header";
import { PurchaseEditor } from "@/components/purchases/purchase-editor";

export default async function NewPurchasePage({searchParams}:{searchParams:Promise<{error?:string}>}){
 const user=await requirePermission("purchase.create");const {error}=await searchParams;const storeId=authorizedStoreScopeId(user);
 const [suppliers,stores,products]=await Promise.all([
  prisma.supplier.findMany({where:{status:"ACTIVE"},orderBy:{name:"asc"},take:500,select:{id:true,name:true}}),
  prisma.store.findMany({where:{status:"ACTIVE",...(storeId?{id:storeId}:{})},orderBy:{name:"asc"},select:{id:true,name:true,warehouses:{where:{status:"ACTIVE"},select:{id:true,name:true},orderBy:{code:"asc"}}}}),
  prisma.product.findMany({where:{status:"ACTIVE"},orderBy:{name:"asc"},take:300,select:{id:true,name:true,sku:true,costPrice:true}}),
 ]);
 if(!stores.length)redirect("/purchases?error=no-store");
 const productOptions=products.map((product)=>({...product,costPrice:product.costPrice.toString()}));
 return <div className="max-w-5xl"><PageHeader title="New purchase" description="Create a purchase order. Stock changes only when receiving is completed."/>{error&&<p role="alert" className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">Purchase could not be created. Check the fields, supplier, and item costs.</p>}<PurchaseEditor suppliers={suppliers} stores={stores} products={productOptions}/></div>;
}
