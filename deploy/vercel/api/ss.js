/* Starshipit CORS proxy.

   The browser cannot call api.starshipit.com directly, so the app sends every
   request here as /api/ss?p=<encoded starshipit path>&<original query>, with the
   two auth headers attached. See SS_PROXY in teamaccess/index.html.

   Status codes are passed through verbatim — the app relies on seeing 429 to back
   off from Starshipit's rate limit, so swallowing it would break syncing. */

const BASE = 'https://api.starshipit.com';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, StarShipIT-Api-Key, Ocp-Apim-Subscription-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  let u;
  try { u = new URL(req.url, 'https://proxy.local'); }
  catch (e) { res.status(400).json({ error: 'bad request url' }); return; }

  const p = u.searchParams.get('p');
  if (!p || p.charAt(0) !== '/') { res.status(400).json({ error: 'missing or invalid p parameter' }); return; }
  u.searchParams.delete('p');
  const qs = u.searchParams.toString();
  const target = BASE + p + (qs ? '?' + qs : '');

  const headers = {
    'Content-Type': 'application/json',
    'StarShipIT-Api-Key': req.headers['starshipit-api-key'] || '',
    'Ocp-Apim-Subscription-Key': req.headers['ocp-apim-subscription-key'] || ''
  };

  try {
    const init = { method: req.method === 'POST' ? 'POST' : 'GET', headers };
    if (init.method === 'POST' && req.body) {
      init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }
    const r = await fetch(target, init);
    const text = await r.text();
    res.status(r.status);
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
    res.send(text);
  } catch (e) {
    res.status(502).json({ error: String((e && e.message) || e) });
  }
};
