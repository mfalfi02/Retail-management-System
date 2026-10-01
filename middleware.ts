import { NextRequest, NextResponse } from "next/server";

const protectedPrefixes = [
  "/dashboard", "/pos", "/sales", "/products", "/inventory", "/purchases", "/customers",
  "/suppliers", "/reports", "/audit-logs", "/settings", "/users", "/warehouses", "/expenses", "/accounting",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    || (pathname.startsWith("/api/") && !pathname.startsWith("/api/auth/"));
  if (!isProtected || request.cookies.has("retail_session")) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
