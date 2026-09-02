/* Team administration — create a sign-in, set a password, remove someone.
 *
 * These are the operations that need the service key, which is why they live
 * here rather than in the browser: creating and deleting auth accounts, and
 * setting a password without knowing the old one. The browser never holds a key
 * that could do any of it.
 *
 * There is deliberately no self-service reset anywhere in the product. Nobody is
 * emailed a link; an administrator sets the password and tells the person. That
 * is Fullstack's choice, and it means the reset path cannot be used against an
 * account by whoever happens to reach the mailbox.
 *
 * Every call is checked twice, server-side: the caller's own token has to be
 * valid, and the profile that token belongs to has to be an admin. A caller
 * claiming to be an admin in the request body proves nothing and is not read.
 */
const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const MIN_PASSWORD = 10;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400'
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS }
  });

async function svc(path: string, opts: any = {}): Promise<any> {
  const r = await fetch(SB_URL + path, {
    method: opts.method ?? 'GET',
    headers: {
      apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY,
      'Content-Type': 'application/json', ...(opts.headers ?? {})
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });
  const text = await r.text();
  let parsed: any = null;
  try{ parsed = text ? JSON.parse(text) : null; }catch(_e){ parsed = null; }
  if(!r.ok){
    const msg = (parsed && (parsed.msg || parsed.message || parsed.error_description || parsed.error)) || ('HTTP ' + r.status);
    const err: any = new Error(String(msg));
    err.status = r.status;
    throw err;
  }
  return parsed;
}

const clean = (v: unknown) => (v == null ? '' : String(v)).trim();
const lower = (v: unknown) => clean(v).toLowerCase();

Deno.serve(async (req: Request) => {
  if(req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if(req.method !== 'POST') return json({ error: 'POST only' }, 405);

  /* ---- 1. is the caller who they say they are ---- */
  const auth = req.headers.get('Authorization') ?? '';
  if(!/^Bearer\s+\S/i.test(auth)) return json({ error: 'sign in first' }, 401);

  let me: any = null;
  try{
    const r = await fetch(SB_URL + '/auth/v1/user', {
      headers: { apikey: SB_KEY, Authorization: auth }
    });
    if(!r.ok) throw new Error('bad token');
    me = await r.json();
  }catch(_e){ return json({ error: 'sign in first' }, 401); }
  if(!me || !me.id) return json({ error: 'sign in first' }, 401);

  /* ---- 2. and are they an admin, according to the database ---- */
  let myProfile: any = null;
  try{
    const rows = await svc('/rest/v1/profiles?id=eq.' + encodeURIComponent(me.id) + '&select=id,email,role');
    myProfile = rows && rows[0];
  }catch(_e){ return json({ error: 'could not read your profile' }, 503); }
  if(!myProfile || myProfile.role !== 'admin'){
    return json({ error: 'administrators only' }, 403);
  }

  let body: any = null;
  try{ body = await req.json(); }catch(_e){ body = null; }
  if(!body || typeof body !== 'object') return json({ error: 'expected a JSON body' }, 400);

  const action   = lower(body.action);
  const email    = lower(body.email);
  const password = clean(body.password);
  const name     = clean(body.name);
  const role     = lower(body.role) === 'admin' ? 'admin' : 'member';

  /* Two verbs, not three. "set" creates the account if there is none and changes
     the password if there is, because the caller cannot reliably know which — and
     an admin pressing the button means the same thing either way. */
  if(['set', 'delete'].indexOf(action) < 0){
    return json({ error: 'action must be set or delete' }, 400);
  }
  if(!email || email.indexOf('@') < 1) return json({ error: 'a valid email is required' }, 400);

  /* Who already exists under that address. */
  let existing: any = null;
  try{
    const found = await svc('/auth/v1/admin/users?page=1&per_page=200');
    const list = (found && (found.users || found)) || [];
    existing = (Array.isArray(list) ? list : []).find((u: any) => lower(u.email) === email) || null;
  }catch(_e){ return json({ error: 'could not read the account list' }, 503); }

  try{
    /* ---------- give them a password, whether or not they had an account ---------- */
    if(action === 'set'){
      if(password.length < MIN_PASSWORD){
        return json({ error: 'password must be at least ' + MIN_PASSWORD + ' characters' }, 400);
      }
      let id: string;
      let created = false;
      if(existing){
        await svc('/auth/v1/admin/users/' + encodeURIComponent(existing.id), {
          method: 'PUT',
          body: { password, email_confirm: true }
        });
        id = existing.id;
      }else{
        /* Confirmed on creation: there is no email step in this product, so an
           unconfirmed account would simply never be able to sign in. */
        const made = await svc('/auth/v1/admin/users', {
          method: 'POST',
          body: { email, password, email_confirm: true }
        });
        id = made.id;
        created = true;
      }
      await svc('/rest/v1/profiles', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: [{ id, email, name: name || email, role, tabs: body.tabs || {} }]
      });
      return json({ ok: true, action, email, created });
    }

    /* ---------- remove someone ---------- */
    if(!existing) return json({ error: 'no account for that email' }, 404);
    if(existing.id === me.id){
      return json({ error: 'you cannot delete your own account' }, 400);
    }
    /* The last admin must not be removable, or nobody can ever administer this
       again — including undoing the deletion. */
    let admins: any[] = [];
    try{ admins = await svc('/rest/v1/profiles?role=eq.admin&select=id'); }catch(_e){ admins = []; }
    const target = await svc('/rest/v1/profiles?id=eq.' + encodeURIComponent(existing.id) + '&select=role');
    if(target && target[0] && target[0].role === 'admin' && admins.length <= 1){
      return json({ error: 'this is the last administrator — promote someone else first' }, 400);
    }

    await svc('/auth/v1/admin/users/' + encodeURIComponent(existing.id), { method: 'DELETE' });
    await svc('/rest/v1/profiles?id=eq.' + encodeURIComponent(existing.id), { method: 'DELETE' }).catch(() => {});
    return json({ ok: true, action, email });
  }catch(e: any){
    /* Never echo the request back — it carries the password. */
    console.error('team-admin ' + action + ' failed:', String(e?.message ?? e));
    return json({ error: String(e?.message ?? 'the operation failed') }, e?.status && e.status < 500 ? e.status : 500);
  }
});
