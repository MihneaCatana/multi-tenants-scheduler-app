## Add Price Field to Services (RON / lei)

### 1. Database Migration
**New file:** `backend/src/db/migrations/tenant/0006_add_service_price.sql`
```sql
ALTER TABLE "services" ADD COLUMN "price" numeric(10,2);
```
**Update:** `backend/src/db/migrations/tenant/meta/_journal.json` — add entry idx 6 with tag `0006_add_service_price`

### 2. Drizzle Schema
**File:** `backend/src/db/schema/tenant/services.ts`
- Add column: `price: numeric('price', { precision: 10, scale: 2 })` — nullable, so existing rows are unaffected

### 3. Backend Validation
**File:** `backend/src/modules/services-catalog/schema.ts`
- Add to `createServiceBody`: `price: z.number().nonnegative().optional()`
- `updateServiceBody` inherits automatically via `.partial()`

### 4. Backend Service Layer
**File:** `backend/src/modules/services-catalog/service.ts`
- Add `price` to `createService` input type and `.values()` call
- `updateService` is generic (spreads `Record<string, unknown>`) — no change needed

### 5. Frontend Type
**File:** `frontend/src/lib/types.ts`
- Add `price: number | null;` to `Service` interface

### 6. Frontend API
**File:** `frontend/src/lib/api.ts`
- Add `price?: number;` to `createService` and `updateService` body types

### 7. Frontend ServicesTab UI
**File:** `frontend/src/features/scheduling/tabs/ServicesTab.tsx`
- **Schema**: add `price: z.coerce.number().nonnegative().optional().or(z.literal(''))` to `serviceSchema`
- **Table**: add "Price" column after "Buffers", displaying formatted price (e.g. `50,00 lei` or "—" if null)
- **Form modal**: add price input field (numeric, step 0.01, min 0)
- **Form defaultValues**: include `price` from initial values (or undefined)
- **Payload construction**: include `price` when submitting
- **i18n keys**: add `svc_colPrice`, `svc_fieldPrice`, `svc_priceFormat` for "X,XX lei" formatting

### 8. i18n
**File:** `frontend/src/lib/i18n/translations.ts`
- Add `svc_colPrice`, `svc_fieldPrice` keys in EN and RO
- Use `toLocaleString('ro-RO')` for RON number formatting in the table cell