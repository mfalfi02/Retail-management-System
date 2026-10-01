# Retail Management System

A modular retail operations workspace built with Next.js App Router, TypeScript, MySQL and Prisma. The current foundation includes server-side authentication, role/permission data, multi-store entities, a database-backed dashboard, and a relational schema for the core retail workflows.

## Requirements

- Node.js 20.9 or newer (Node 22 recommended)
- npm
- MySQL 8 or compatible MariaDB (XAMPP is suitable)

## Setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to your MySQL connection. The default local XAMPP value is `mysql://root:@localhost:3306/retail_management`.
3. Create the database if it does not exist:

   ```sql
   CREATE DATABASE retail_management CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```

4. Generate the Prisma client: `npm run db:generate`
5. Apply the included initial migration: `npm run db:deploy` (or use `npm run db:push` for local schema prototyping)
6. Add development sample data: `npm run db:seed`
7. Start the app: `npm run dev`

Open <http://localhost:3000>. If your MySQL password is not empty, URL-encode it in `DATABASE_URL` rather than using the example value.

The follow-up migrations add schema stability/backfills, purchase returns, hashed server-side sessions, unique POS checkout keys, refund settlements, sale-return idempotency keys, and the `role.manage` permission. Review the historical backfill choices in `20260927010000_schema_stability/migration.sql` against production data before applying with `npm run db:deploy`. If there are old purchases but no users, add an appropriate user or backfill creator IDs before deployment. `db:push` is intended for local prototyping, not for tracking shared migration history.

If the existing database was initialized with `db:push`, check its migration history before using `db:deploy`. Baseline the existing schema against the initial migration first; applying an unbaselined initial migration to tables that already exist will fail. Never use `prisma migrate reset` against a database containing data you need to keep.

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | MySQL connection URL |
| `NEXTAUTH_URL` | Local application URL retained for compatibility with the requested setup |
| `NEXT_PUBLIC_APP_NAME` | Public application label |

No real `.env` file is committed. `.env` and `.env.local` are ignored by Git.

## Development accounts

The seed creates one super administrator, two administrators, one manager, two cashiers, one inventory staff member, one purchasing staff member, and one accounting staff member. All seed accounts use the development-only password `Demo-Only-2026!`; change it immediately. The seed script refuses to run when `NODE_ENV=production`.

Usernames: `superadmin`, `admin1`, `admin2`, `manager`, `cashier1`, `cashier2`, `inventory`, `purchasing`, `accounting`.

## Authentication and authorization

Staff sign in at `/login` with a seeded username or email. Passwords use bcrypt hashes. Login returns a generic credential error for unknown, inactive, or incorrectly authenticated accounts. Successful and failed attempts are recorded in `AuditLog` without passwords, hashes, cookies, or session tokens.

Sessions use 256-bit random opaque tokens. The browser stores only the token in an HTTP-only, `SameSite=Lax` cookie (`Secure` in production); MySQL stores only its SHA-256 hash and a 12-hour expiration in `AuthSession`. Logout revokes the database session and clears the cookie. Current-user responses include only safe identity fields, roles, permissions, and the assigned `storeId`.

The existing `Role`, `Permission`, `UserRole`, and `RolePermission` tables remain the single RBAC source. Permission keys follow `prisma/seed.ts`; multiple roles combine their grants, and `SUPER_ADMIN` bypasses permission checks. Store-scoped services restrict users to their assigned store; only `SUPER_ADMIN` may cross stores. Middleware checks for a session cookie early, while server-side helpers/services validate the session and enforce authorization for actual data access.

There is no application-level login rate limiter yet. Deployments should add rate limiting at the edge or reverse proxy before exposing login publicly. Demo credentials are development-only and must be changed outside local development.

## Architecture

- `src/app`: App Router pages and Route Handlers
- `src/components`: reusable interface components
- `src/lib/auth`: password handling, opaque database-backed sessions, and role/permission/store authorization
- `src/lib/db`: Prisma client singleton
- `src/lib/services`: transaction-safe inventory, sales, purchasing, stock documents, audit, accounting, and document numbering
- `prisma/schema.prisma`: MySQL relational data model
- `prisma/seed.ts`: repeatable development sample data

The schema has stores and warehouses, users/roles/permissions, product master data, per-warehouse inventory and stock movements, customers/suppliers, purchases, sales, payments, returns, promotions, expenses, journals, settings and audit logs. Money is stored in fixed precision decimals. Foreign keys and unique constraints protect important identifiers.

## Business workflow design

Inventory is represented per product and warehouse. Stock movements retain the reason, quantity and source reference for stock events; operational services apply inventory changes and movement inserts in a single Prisma transaction. Sales belong to a store, warehouse and cashier, and may have split payment records. Purchases belong to a supplier/store/warehouse and support receiving quantities. Sale returns create refund settlements transactionally; old returns predating settlement records remain unsettled historical returns. Customers and suppliers are shared master records without a store ownership column, while their transaction histories and report totals are store-scoped.

Available inventory is derived as `quantity - reservedQuantity` with `calculateAvailableQuantity` in `src/lib/services/inventory.ts`. Never update stock without a movement in the same transaction. Sale completion, purchase receiving (including only newly received quantities), returns, adjustments, and transfers must be transactional. An adjustment starts in `DRAFT`; creating it alone must not change inventory. A sale return links to the original sale item so services can sum prior returns and reject quantities above the original sold amount. Journals must validate nonnegative debit/credit and balanced totals in their service before writing.

Settings use the flexible JSON `Setting` model. Expected keys include `company.name`, `company.address`, `company.phone`, `currency`, `timezone`, `inventory.allowNegativeStock`, `invoice.salePrefix`, `invoice.purchasePrefix`, and `receipt.footer`.

`ProductVariant` is future-ready only: stock, purchase, sale, and return items currently reference `Product`, so variant-level transactions and inventory are not supported yet. Transaction payment fields use the `PaymentType` enum for the MVP; `PaymentMethod` stores enabled display methods, while replacing transaction enum fields with custom method IDs would require a data migration.

## Commands

- `npm run dev` — development server
- `npm run build` / `npm start` — production build and server
- `npm run lint` — ESLint
- `npm run typecheck` — TypeScript check
- `npm test` — database-independent unit tests
- `npm run test:integration` — critical retail workflow tests (requires seeded/migrated MySQL)
- `npm run db:generate` — regenerate Prisma client
- `npm run db:migrate` / `npm run db:deploy` — create a development migration / apply committed migrations
- `npm run db:push` — synchronize schema to local database
- `npm run db:seed` — create development data
- `npm run db:studio` — open Prisma Studio

## Current implementation scope

The application includes a responsive permission-aware shell, database-backed authentication and editable user/role administration, dashboard analytics, product catalog, transactional POS checkout, inventory/movement/adjustment pages, purchase create/approve/receive/return flows, sales history and returns with refund settlement, customer/supplier histories, expense entry, operational and estimated-margin reports, CSV export, and print support. Financial calculations use server-side Prisma Decimal values; checkout, sale-return, and purchase-receiving requests have idempotency keys. Customers and suppliers are shared master data across stores; transaction history, counts, and report totals remain scoped by store. Product variants are not wired into stock transactions, there is no login rate limiter in the application, and payment/accounting reconciliation is not automated. Database-backed routes require reachable MySQL and all migrations to be applied.
# Retail-management-System
