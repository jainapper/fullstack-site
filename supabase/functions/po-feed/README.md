# Purchase order feed — integration notes for Eagle Labs

Everything Fullstack has authorised, as JSON. Read-only: nothing here can create,
change or cancel an order.

**Endpoint**

```
GET https://fofghcaqgwgixjshmubt.supabase.co/functions/v1/po-feed
```

**Authentication** — one header. Fullstack issues the key; treat it like a
password and keep it server-side.

```
x-api-key: <the key Fullstack gave you>
```

```bash
curl -s https://fofghcaqgwgixjshmubt.supabase.co/functions/v1/po-feed \
     -H "x-api-key: $FULLSTACK_PO_KEY"
```

## What you get

```json
{
  "supplier": "Eagle Labs",
  "generated_at": "2026-09-01T04:10:00.000Z",
  "count": 1,
  "truncated": false,
  "purchase_orders": [
    {
      "po_number": "PO-2026-0048",
      "status": "approved",
      "issued": "2026-08-30T03:00:00Z",
      "required_by": "2026-10-01",
      "expected_arrival": "2026-10-20",
      "buyer": {
        "company": "Fullstack Fulfilment Australia",
        "contact": "07 2111 6366",
        "email": "info@fullstackfs.com.au",
        "deliver_to": "Unit 6, 83 Burnside Rd, Stapylton QLD 4207"
      },
      "client": { "company": "Health Icons", "email": "orders@healthicons.com.au" },
      "production_brief": "Label revision C, matte finish. 24-month expiry.",
      "notes": "Need to order to keep par level on the products.",
      "lines": [
        {
          "sku": "FS-AU029-30-150WBWC",
          "product": "Carb Smart",
          "type": "capsule",
          "flavour": null,
          "size": "1 capsule (450 mg) - 30 servings",
          "units": 1000
        }
      ],
      "total_units": 1000,
      "authorised_by": "Jai Napper",
      "authorised_at": "2026-08-30T02:00:00Z",
      "countersigned_by": "Darlene McGlynn",
      "countersigned_at": "2026-08-30T03:00:00Z",
      "sent_at": null
    }
  ]
}
```

`client.company` is who the run is being made for. The same products for two
different clients are two different jobs, so key your import on
`po_number`, and treat `client.company` as the brand.

## Parameters

| Parameter | Example | What it does |
|---|---|---|
| `since` | `?since=2026-08-01T00:00:00Z` | Only orders authorised or sent at or after this moment. ISO 8601. Use it to poll for what is new. |
| `status` | `?status=sent` | `approved` or `sent` only. |
| `number` | `?number=PO-2026-0048` | A single order. Case-insensitive. |

Polling once every 15 minutes with `since` set to your last successful poll is
plenty — purchase orders are raised by hand, not in volume.

## What you will never see

**Only fully signed orders are published.** Every Fullstack purchase order needs
two signatures from two different people, and one that does not have both is not
an instruction to manufacture anything. Drafts and half-signed orders are not
merely absent from the default — `?status=draft` and `?status=pending` are
refused with `400`, so an integration that asks for them finds out rather than
quietly receiving nothing.

If an order is withdrawn after you have seen it, it stops appearing. Treat a
`po_number` that vanishes as cancelled, and check with Fullstack before making it.

## Responses

| Code | Meaning |
|---|---|
| `200` | Fine. |
| `400` | A parameter was wrong — the body says which. |
| `401` | Missing or wrong `x-api-key`. |
| `405` | Something other than `GET`. |
| `500` / `503` | Our end. Retry with backoff; nothing is lost. |

At most 500 orders come back at once. `truncated: true` means there are more —
narrow with `since`.

---

## For Fullstack, not for Eagle Labs

The key is generated inside the database by `supabase/001_po_feed_api_keys.sql`
and stored in `public.api_keys`, which has row level security on and no policies
— so nothing but this function can read it, and it exists in no config file or
repository.

Read it once to hand over:

```sql
select secret from public.api_keys where name = 'Eagle Labs' and scope = 'po-feed';
```

Rotate it (their old key stops working immediately), or revoke it:

```sql
update public.api_keys set secret = encode(gen_random_bytes(32), 'hex')
 where name = 'Eagle Labs' and scope = 'po-feed';

delete from public.api_keys where name = 'Eagle Labs' and scope = 'po-feed';
```

To give another supplier their own key, insert a row with a different `name` and
the same `po-feed` scope. The response names the holder back to them, so a wrong
key is obvious from the first call.

Deploy with JWT verification **off** — the function does its own key check, which
is what lets a supplier call it without a Supabase account:

```
supabase functions deploy po-feed --project-ref fofghcaqgwgixjshmubt --no-verify-jwt
```
