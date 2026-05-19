# API manual testing (curl / Postman)

Prerequisites:

```bash
npm run sys:init   # or: docker compose up -d && npm run db:setup
npm start          # http://localhost:3000
```

Reset data anytime: `npm run db:setup`

**Postman:** File → Import → Raw text → paste a full `curl` block below (method, URL, headers, and body). Use a **new** request each time you update this doc — old saved bodies may still have invalid UUIDs.

## Seed reference

All IDs must be **RFC 4122** UUIDs (Zod `z.uuid()` requires version `4`–`8` in the 3rd group and variant `8`/`9`/`a`/`b` in the 4th). Patterns like `aaaa-aaaa-aaaa` are rejected.

| Constant | UUID | Notes |
|----------|------|-------|
| Customer `demo` | `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` | any valid customer UUID works |
| `WIDGET-A` | `11111111-1111-4111-8111-111111111111` | $10.00/unit, all warehouses |
| `WIDGET-B` | `22222222-2222-4222-8222-222222222222` | $15.00/unit, all warehouses |
| `GADGET-C` | `33333333-3333-4333-8333-333333333333` | $20.00/unit, all warehouses |
| `SPLIT-EAST` | `44444444-4444-4444-8444-444444444444` | Atlanta + Chicago only |
| `SPLIT-WEST` | `55555555-5555-4555-8555-555555555555` | Dallas, Denver, Phoenix only |
| `SCARCE` | `66666666-6666-4666-8666-666666666666` | 3 in Atlanta, 50 at every other warehouse (max 50 anywhere) |

Shipping addresses must match the geocoding mock **exactly**:

| City | Address |
|------|---------|
| Atlanta | `191 Peachtree St NE, Atlanta, GA` |
| Chicago | `Millennium Park, Chicago, IL` |
| Dallas | `2100 Ross Ave, Dallas, TX` |
| Denver | `1701 Wynkoop St, Denver, CO` |
| Phoenix | `400 E Van Buren St, Phoenix, AZ` |

---

## 1. Health check

```bash
curl -s http://localhost:3000/health
```

Expected: `{"status":"ok"}`

---

## 2. Happy path — create a paid order (Atlanta)

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "x-idempotency-key: 10000000-0000-4000-8000-000000000001" \
  -d "{\"customerId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"creditCardNumber\":\"4111111111111111\",\"shippingAddress\":\"191 Peachtree St NE, Atlanta, GA\",\"items\":[{\"productId\":\"11111111-1111-4111-8111-111111111111\",\"quantity\":2}]}"
```

Expected: **201** — `status: "PAID"`, `warehouseId` for Atlanta, charge = 2 × 1000 = **2000** cents at gateway.

---

## 3. Multi-item order

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "x-idempotency-key: 10000000-0000-4000-8000-000000000002" \
  -d "{\"customerId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"creditCardNumber\":\"4111111111111111\",\"shippingAddress\":\"191 Peachtree St NE, Atlanta, GA\",\"items\":[{\"productId\":\"11111111-1111-4111-8111-111111111111\",\"quantity\":1},{\"productId\":\"22222222-2222-4222-8222-222222222222\",\"quantity\":2}]}"
```

Expected: **201** — total charge = 1×1000 + 2×1500 = **4000** cents.

---

## 4. Geospatial routing — Phoenix fulfillment

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "x-idempotency-key: 10000000-0000-4000-8000-000000000003" \
  -d "{\"customerId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"creditCardNumber\":\"4111111111111111\",\"shippingAddress\":\"400 E Van Buren St, Phoenix, AZ\",\"items\":[{\"productId\":\"11111111-1111-4111-8111-111111111111\",\"quantity\":1}]}"
```

Expected: **201** — `warehouseId` should belong to **Phoenix Warehouse** (closest warehouse with stock).

---

## 5. Split-warehouse — no single warehouse can fulfill (422)

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "x-idempotency-key: 10000000-0000-4000-8000-000000000004" \
  -d "{\"customerId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"creditCardNumber\":\"4111111111111111\",\"shippingAddress\":\"191 Peachtree St NE, Atlanta, GA\",\"items\":[{\"productId\":\"44444444-4444-4444-8444-444444444444\",\"quantity\":1},{\"productId\":\"55555555-5555-4555-8555-555555555555\",\"quantity\":1}]}"
```

Expected: **422** — `"No single warehouse has sufficient stock to fulfill the entire order."`

---

## 6. Insufficient stock everywhere (422)

No warehouse stocks more than **50** units of `SCARCE`. The router picks the **closest warehouse that can fulfill the whole order** (not “closest warehouse only”), so qty 10 from Atlanta correctly returned **201** in your run — a farther warehouse had enough. Use qty **51** to force **422**.

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "x-idempotency-key: 10000000-0000-4000-8000-000000000005" \
  -d "{\"customerId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"creditCardNumber\":\"4111111111111111\",\"shippingAddress\":\"191 Peachtree St NE, Atlanta, GA\",\"items\":[{\"productId\":\"66666666-6666-4666-8666-666666666666\",\"quantity\":51}]}"
```

Expected: **422** — `"No single warehouse has sufficient stock to fulfill the entire order."`

---

## 7. Unknown shipping address (400)

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "x-idempotency-key: 10000000-0000-4000-8000-000000000006" \
  -d "{\"customerId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"creditCardNumber\":\"4111111111111111\",\"shippingAddress\":\"742 Evergreen Terrace, Springfield\",\"items\":[{\"productId\":\"11111111-1111-4111-8111-111111111111\",\"quantity\":1}]}"
```

Expected: **400** — `"Unserviceable shipping address location"`

---

## 8. Validation — missing idempotency key (400)

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d "{\"customerId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"creditCardNumber\":\"4111111111111111\",\"shippingAddress\":\"191 Peachtree St NE, Atlanta, GA\",\"items\":[{\"productId\":\"11111111-1111-4111-8111-111111111111\",\"quantity\":1}]}"
```

Expected: **400** — `"Invalid payload structure"`

---

## 9. Validation — duplicate productId in items (400)

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "x-idempotency-key: 10000000-0000-4000-8000-000000000007" \
  -d "{\"customerId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"creditCardNumber\":\"4111111111111111\",\"shippingAddress\":\"191 Peachtree St NE, Atlanta, GA\",\"items\":[{\"productId\":\"11111111-1111-4111-8111-111111111111\",\"quantity\":1},{\"productId\":\"11111111-1111-4111-8111-111111111111\",\"quantity\":2}]}"
```

Expected: **400** — `"Invalid payload structure"`

---

## 10. Idempotency — replay returns cached response (200)

Run twice with the **same** `x-idempotency-key` (first request):

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "x-idempotency-key: 10000000-0000-4000-8000-000000000010" \
  -d "{\"customerId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"creditCardNumber\":\"4111111111111111\",\"shippingAddress\":\"Millennium Park, Chicago, IL\",\"items\":[{\"productId\":\"33333333-3333-4333-8333-333333333333\",\"quantity\":1}]}"
```

Replay (same key, same body):

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "x-idempotency-key: 10000000-0000-4000-8000-000000000010" \
  -d "{\"customerId\":\"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa\",\"creditCardNumber\":\"4111111111111111\",\"shippingAddress\":\"Millennium Park, Chicago, IL\",\"items\":[{\"productId\":\"33333333-3333-4333-8333-333333333333\",\"quantity\":1}]}"
```

Expected: first call **201** `PAID`; second call **200** with `"cached": true` and the same `orderId`.

---

## Postman tips

1. Import each `curl` block as-is (File → Import → Raw text).
2. After `db:setup`, use a fresh `x-idempotency-key` per new order (except test #10, which reuses the same key on purpose).
3. UUIDs in the table above must include version/variant nibbles (`4` and `8` in groups 3–4) or the API returns **400**.

## Scenarios requiring automated tests

These paths use in-memory gateway hooks and are covered by Jest, not plain HTTP:

| Scenario | HTTP | How to test |
|----------|------|-------------|
| Payment failure + inventory restore | 402 | `PaymentClient.testables.forceFailure()` |
| In-flight duplicate (409) | 409 | `forcePending()` or concurrent requests |
| Reconciliation sweeper | — | Stale `PENDING_PAYMENT` rows + scheduler |
