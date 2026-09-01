/* Purchase order feed — the endpoint Eagle Labs pulls from.
 *
 * Read-only, and deliberately narrow. It answers one question: which purchase
 * orders has Fullstack authorised, and what is on them. Nothing here can create,
 * change or cancel an order, so the worst a leaked key can do is show a supplier
 * the orders that were already being emailed to them.
 *
 * Only fully signed orders are ever returned. A draft or a half-signed order is
 * not an instruction to manufacture anything, and handing one to a supplier is
 * how a run gets made twice or made early — so `draft` and `pending` are not
 * reachable through any parameter, not merely absent from the default.
 *
 * The key lives in a table that only this function can read, so it exists in no
 * config file, environment variable or repository — the same arrangement the
 * scheduled sync uses.
 */
const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/* Signed means authorised. Nothing else is offered. */
const VISIBLE = ['approved', 'sent'];
const MAX_ROWS = 500;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400'
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS }
  });

async function sb(path: string): Promise<any> {
  const r = await fetch(SB_URL + path, {
    headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }
  });
  if(!r.ok) throw new Error('HTTP ' + r.status);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

/* Constant-time-ish compare so a wrong key cannot be narrowed down by timing. */
function sameKey(a: string, b: string){
  if(a.length !== b.length) return false;
  let diff = 0;
  for(let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const clean = (v: unknown) => (v == null ? '' : String(v));
const dateOnly = (v: unknown) => {
  const s = clean(v);
  return s ? s.slice(0, 10) : null;
};

Deno.serve(async (req: Request) => {
  /* 204 must not carry a body, so the preflight cannot go through json(). */
  if(req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if(req.method !== 'GET') return json({ error: 'GET only' }, 405);

  /* ---- who is asking ---- */
  const given = req.headers.get('x-api-key') ?? '';
  if(!given) return json({ error: 'missing x-api-key header' }, 401);

  let rows: any[] | null = null;
  try{ rows = await sb('/rest/v1/api_keys?select=name,secret,scope&scope=eq.po-feed'); }
  catch(_e){ return json({ error: 'key store unavailable' }, 503); }

  const caller = (rows ?? []).find((k: any) => sameKey(clean(k.secret), given));
  if(!caller) return json({ error: 'unauthorized' }, 401);

  /* ---- what they asked for ---- */
  const u = new URL(req.url);
  const since  = clean(u.searchParams.get('since'));
  const number = clean(u.searchParams.get('number')).toUpperCase();
  const wanted = clean(u.searchParams.get('status')).toLowerCase();

  /* A status outside the signed set is refused rather than quietly ignored, so
     an integration asking for drafts learns that it cannot have them. */
  if(wanted && VISIBLE.indexOf(wanted) < 0){
    return json({ error: 'status must be one of: ' + VISIBLE.join(', '),
                  note: 'unsigned orders are never published' }, 400);
  }
  const statuses = wanted ? [wanted] : VISIBLE;

  let sinceMs = 0;
  if(since){
    const t = new Date(since).getTime();
    if(isNaN(t)) return json({ error: 'since must be an ISO 8601 date' }, 400);
    sinceMs = t;
  }

  try{
    const [poRows, catRows] = await Promise.all([
      sb('/rest/v1/pos?select=id,data'),
      sb('/rest/v1/catalog?select=id,data')
    ]);

    const cat: Record<string, any> = {};
    (catRows ?? []).forEach((r: any) => { cat[r.id] = r.data || {}; });

    const orders = (poRows ?? [])
      .map((r: any) => r.data || {})
      .filter((p: any) => statuses.indexOf(clean(p.status)) >= 0)
      .filter((p: any) => !number || clean(p.number).toUpperCase() === number)
      .filter((p: any) => {
        if(!sinceMs) return true;
        /* When it became actionable for the supplier, not when it was drafted. */
        const t = new Date(clean(p.sentTs) || clean(p.sig2 && p.sig2.ts) || clean(p.created)).getTime();
        return !isNaN(t) && t >= sinceMs;
      })
      .sort((a: any, b: any) => clean(b.created).localeCompare(clean(a.created)))
      .slice(0, MAX_ROWS)
      .map((p: any) => {
        const lines = (p.lines || []).map((l: any) => {
          const it = cat[l.catId] || {};
          return {
            sku: clean(it.sku) || null,
            product: clean(it.name) || null,
            type: clean(it.type) || null,
            flavour: clean(it.flavor) || null,
            size: clean(it.size) || null,
            units: Number(l.qty) || 0
          };
        });
        return {
          po_number: clean(p.number),
          status: clean(p.status),
          issued: clean(p.sig2 && p.sig2.ts) || clean(p.created) || null,
          required_by: dateOnly(p.requiredBy),
          expected_arrival: dateOnly(p.expectedArrival),
          buyer: {
            company: 'Fullstack Fulfilment Australia',
            contact: '07 2111 6366',
            email: 'info@fullstackfs.com.au',
            deliver_to: 'Unit 6, 83 Burnside Rd, Stapylton QLD 4207'
          },
          /* Who the run is being made for. Eagle Labs manufactures against a
             client's brand, so the same products for two clients are two jobs. */
          client: { company: clean(p.client) || null, email: clean(p.clientEmail) || null },
          production_brief: clean(p.production) || null,
          notes: clean(p.notes) || null,
          lines,
          total_units: lines.reduce((s: number, l: any) => s + l.units, 0),
          authorised_by: clean(p.sig1 && p.sig1.name) || null,
          authorised_at: clean(p.sig1 && p.sig1.ts) || null,
          countersigned_by: clean(p.sig2 && p.sig2.name) || null,
          countersigned_at: clean(p.sig2 && p.sig2.ts) || null,
          sent_at: clean(p.sentTs) || null
        };
      });

    return json({
      supplier: caller.name || 'partner',
      generated_at: new Date().toISOString(),
      count: orders.length,
      truncated: orders.length === MAX_ROWS,
      purchase_orders: orders
    });
  }catch(e: any){
    console.error('po-feed failed', String(e?.message ?? e));
    return json({ error: 'could not read purchase orders' }, 500);
  }
});
