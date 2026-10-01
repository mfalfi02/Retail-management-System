"use client";

import { FormEvent, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CheckCircle2, LoaderCircle, Minus, Plus, Search, ShoppingCart, Trash2 } from "lucide-react";
import { PaymentType } from "@prisma/client";
import { formatCurrency } from "@/lib/utils";
import { searchCatalog, submitCheckout } from "@/app/(dashboard)/pos/actions";

type StoreOption = { id: string; name: string; warehouses: { id: string; name: string }[] };
type Product = { id: string; name: string; sku: string; sellingPrice: string; taxRate: string; imageUrl: string | null; categoryId: string | null; category: string; quantity: string; reservedQuantity: string };
type Customer = { id: string; name: string; customerCode: string };
type Method = { type: PaymentType; name: string };

export function PosRegister({ stores, initialCatalog, customers, paymentMethods }: { stores: StoreOption[]; initialCatalog: Product[]; customers: Customer[]; paymentMethods: Method[] }) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [warehouseId, setWarehouseId] = useState(stores[0]?.warehouses[0]?.id ?? "");
  const [products, setProducts] = useState(initialCatalog);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [customerId, setCustomerId] = useState("");
  const [method, setMethod] = useState<PaymentType>(paymentMethods[0]?.type ?? PaymentType.CASH);
  const [cashReceived, setCashReceived] = useState("");
  const [notice, setNotice] = useState<{ error?: string; sale?: { id: string; invoiceNumber: string; grandTotal: string } } | null>(null);
  const [pending, startTransition] = useTransition();
  const [searching, setSearching] = useState(false);
  const submitting = useRef(false);
  const checkoutKey = useRef<string | null>(null);

  useEffect(() => {
    if (!storeId || !warehouseId) return;
    const timer = setTimeout(() => {
      setSearching(true);
      void searchCatalog({ query, storeId, warehouseId }).then(setProducts).finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, storeId, warehouseId]);

  const byId = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const categories = [...new Set(products.map((product) => product.category))];
  const visibleProducts = products.filter((product) => category === "all" || product.category === category);
  const cartItems = Object.entries(cart).map(([id, quantity]) => ({ product: byId.get(id), quantity })).filter((item): item is { product: Product; quantity: number } => Boolean(item.product));
  const subtotal = cartItems.reduce((sum, item) => sum + Number(item.product.sellingPrice) * item.quantity, 0);
  const tax = cartItems.reduce((sum, item) => sum + Number(item.product.sellingPrice) * item.quantity * Number(item.product.taxRate) / 100, 0);
  const total = subtotal + tax;
  const receivedAmount = cashReceived.trim() === "" ? Number.NaN : Number(cashReceived);
  const cashIsShort = method === PaymentType.CASH && (!Number.isFinite(receivedAmount) || receivedAmount < total);
  const changeDue = method === PaymentType.CASH && Number.isFinite(receivedAmount) ? Math.max(0, receivedAmount - total) : 0;

  function changeQuantity(product: Product, next: number) {
    const available = Number(product.quantity) - Number(product.reservedQuantity);
    setNotice(null);
    checkoutKey.current = null;
    setCart((previous) => {
      const updated = { ...previous };
      if (next <= 0) delete updated[product.id];
      else if (next <= available) updated[product.id] = next;
      return updated;
    });
  }

  function selectStore(nextStoreId: string) {
    const nextStore = stores.find((store) => store.id === nextStoreId);
    setStoreId(nextStoreId);
    setWarehouseId(nextStore?.warehouses[0]?.id ?? "");
    setCart({});
    checkoutKey.current = null;
    setNotice(null);
  }

  function checkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cartItems.length || pending || submitting.current) return;
    if (cashIsShort) return;
    setNotice(null);
    submitting.current = true;
    const key = checkoutKey.current ?? crypto.randomUUID();
    checkoutKey.current = key;
    startTransition(async () => {
      try {
        const result = await submitCheckout({ checkoutKey: key, storeId, warehouseId, customerId: customerId || null, method, items: cartItems.map(({ product, quantity }) => ({ productId: product.id, quantity })) });
        if (result.error) setNotice({ error: result.error });
        else if (result.sale) { setNotice({ sale: result.sale }); setCart({}); setCustomerId(""); setCashReceived(""); checkoutKey.current = null; }
      } finally { submitting.current = false; }
    });
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">Point of sale</h1><p className="mt-1 text-sm text-slate-500">Search or scan a product, add it to the basket, then take payment.</p></div><div className="flex flex-wrap gap-2"><label className="text-xs font-medium text-slate-500">Store<select value={storeId} onChange={(event) => selectStore(event.target.value)} className="mt-1 block h-10 min-w-40 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800">{stores.map((store)=><option key={store.id} value={store.id}>{store.name}</option>)}</select></label><label className="text-xs font-medium text-slate-500">Warehouse<select value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); setCart({}); }} className="mt-1 block h-10 min-w-40 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800">{stores.find((store)=>store.id===storeId)?.warehouses.map((warehouse)=><option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label></div></div>
    {notice?.error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{notice.error}</div>}
    {notice?.sale && <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><span className="flex items-center gap-2"><CheckCircle2 size={18}/> Sale {notice.sale.invoiceNumber} completed · {formatCurrency(notice.sale.grandTotal)}</span><a className="font-semibold underline" href={`/sales/${notice.sale.id}`}>View receipt</a></div>}
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
      <section className="min-w-0 space-y-4"><div className="flex gap-2"><label className="relative min-w-0 flex-1"><span className="sr-only">Search products by name, SKU, or barcode</span><Search aria-hidden size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={query} onChange={(event)=>setQuery(event.target.value)} onKeyDown={(event)=>{ if(event.key === "Enter") event.preventDefault(); }} placeholder="Search name, SKU or barcode…" className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-sm outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"/></label>{searching && <span className="flex items-center text-xs text-slate-500"><LoaderCircle className="animate-spin" size={16}/></span>}</div>
        <div className="flex gap-2 overflow-x-auto pb-1"><button onClick={()=>setCategory("all")} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${category==="all"?"bg-emerald-700 text-white":"bg-white text-slate-600 ring-1 ring-slate-200"}`}>All</button>{categories.map((item)=><button key={item} onClick={()=>setCategory(item)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${category===item?"bg-emerald-700 text-white":"bg-white text-slate-600 ring-1 ring-slate-200"}`}>{item}</button>)}</div>
        {visibleProducts.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{visibleProducts.map((product)=>{const available=Math.max(0,Number(product.quantity)-Number(product.reservedQuantity)); const inCart=cart[product.id]??0; return <button key={product.id} onClick={()=>changeQuantity(product,inCart+1)} disabled={available<=inCart} className="group flex min-h-36 flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-emerald-300 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700"><span><span className="line-clamp-2 font-medium text-slate-900">{product.name}</span><span className="mt-1 block text-xs text-slate-500">{product.sku} · {product.category}</span></span><span className="mt-4 flex items-end justify-between gap-2"><span><span className="block font-semibold text-emerald-800">{formatCurrency(product.sellingPrice)}</span><span className="text-[11px] text-slate-500">Available {available}</span></span><span className="rounded-md bg-emerald-50 p-2 text-emerald-800"><Plus size={16}/></span></span></button>;})}</div> : <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center"><p className="font-medium">No matching products</p><p className="mt-1 text-sm text-slate-500">Try a different search or choose another warehouse.</p></div>}</section>
      <aside className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 xl:sticky xl:top-20"><div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-semibold"><ShoppingCart size={18}/> Current sale</h2><span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{cartItems.length} items</span></div>
        {cartItems.length ? <form onSubmit={checkout} className="mt-4 space-y-4"><div className="max-h-[38vh] space-y-3 overflow-auto pr-1">{cartItems.map(({product,quantity})=><div key={product.id} className="border-b border-slate-100 pb-3"><div className="flex justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-medium">{product.name}</p><p className="text-xs text-slate-500">{formatCurrency(product.sellingPrice)} each</p></div><button type="button" aria-label={`Remove ${product.name}`} onClick={()=>changeQuantity(product,0)} className="self-start rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-700"><Trash2 size={15}/></button></div><div className="mt-2 flex items-center justify-between"><div className="flex items-center gap-2"><button type="button" aria-label={`Decrease ${product.name}`} onClick={()=>changeQuantity(product,quantity-1)} className="rounded border border-slate-200 p-1.5"><Minus size={13}/></button><span className="min-w-6 text-center text-sm tabular-nums">{quantity}</span><button type="button" aria-label={`Increase ${product.name}`} disabled={quantity>=Number(product.quantity)-Number(product.reservedQuantity)} onClick={()=>changeQuantity(product,quantity+1)} className="rounded border border-slate-200 p-1.5 disabled:opacity-40"><Plus size={13}/></button></div><span className="text-sm font-medium">{formatCurrency(Number(product.sellingPrice)*quantity)}</span></div></div>)}</div>
          <label className="block text-xs font-medium text-slate-600">Customer<select value={customerId} onChange={(event)=>{setCustomerId(event.target.value);checkoutKey.current=null;}} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="">Walk-in customer</option>{customers.map((customer)=><option key={customer.id} value={customer.id}>{customer.name} · {customer.customerCode}</option>)}</select></label>
          <label className="block text-xs font-medium text-slate-600">Payment method<select value={method} onChange={(event)=>{setMethod(event.target.value as PaymentType);setCashReceived("");checkoutKey.current=null;}} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">{paymentMethods.map((item)=><option key={item.type} value={item.type}>{item.name}</option>)}</select></label>
          {method === PaymentType.CASH && <div className="space-y-2 rounded-lg bg-slate-50 p-3"><label className="block text-xs font-medium text-slate-600">Cash received<input type="number" inputMode="decimal" min={total} step="0.01" value={cashReceived} onChange={(event)=>setCashReceived(event.target.value)} placeholder={total.toFixed(2)} className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"/></label><div className="flex justify-between text-sm"><span className="text-slate-600">Change</span><span className="font-semibold tabular-nums">{formatCurrency(changeDue)}</span></div>{cashIsShort && <p className="text-xs text-rose-700">Enter at least {formatCurrency(total)} to complete this cash sale.</p>}</div>}
          <div className="space-y-2 border-t border-slate-100 pt-3 text-sm"><div className="flex justify-between text-slate-600"><span>Subtotal</span><span>{formatCurrency(subtotal)}</span></div><div className="flex justify-between text-slate-600"><span>Tax (estimated)</span><span>{formatCurrency(tax)}</span></div><div className="flex justify-between text-base font-semibold"><span>Total</span><span>{formatCurrency(total)}</span></div></div>
          <p className="text-[11px] leading-4 text-slate-500">Final prices, tax, stock, and transaction total are recalculated and validated on the server.</p><button disabled={pending || !warehouseId || cashIsShort} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 font-semibold text-white hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60">{pending?<LoaderCircle className="animate-spin" size={17}/>:null}{pending?"Completing sale…":`Charge ${formatCurrency(total)}`}</button>
        </form> : <div className="mt-8 rounded-lg bg-slate-50 px-4 py-10 text-center"><ShoppingCart className="mx-auto text-slate-300" size={28}/><p className="mt-3 text-sm font-medium text-slate-700">Your cart is empty</p><p className="mt-1 text-xs text-slate-500">Select a product to start a sale.</p></div>}
      </aside>
    </div>
  </div>;
}
