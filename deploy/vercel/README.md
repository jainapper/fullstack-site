# Vercel edge config for fullstackfs.com.au

**These files are NOT deployed from this repo.** The Vercel project
`fullstack-fulfillment` takes plain uploads and is not git-linked. This copy exists
so the config can never be lost again — it previously lived *only* inside the Vercel
deployment and had never been committed anywhere.

## How publishing actually works

1. `git push` updates GitHub Pages (`jainapper.github.io/fullstack-site`).
2. The Vercel project rewrites `/:path*` to that Pages build, and serves
   `api/ss.js` on the domain for the Starshipit proxy.
3. Because the deployment contains **only** these two files, nothing shadows the
   rewrite, so a push reaches the live domain within about 10 minutes
   (GitHub Pages sends `Cache-Control: max-age=600`).

## The failure this fixed

Until 31 Aug 2026 the deployment also held static copies of `/` and `/teamaccess/*`
from 13 Aug. Vercel serves matching static files *before* applying rewrites, so those
copies shadowed the rewrite and the live domain served an 18-day-old build while Pages
was current. Pushes appeared to do nothing, and redeploying did not help because a
redeploy re-uploads the same files.

**Never add site files to this deployment.** If the live domain goes stale again,
check `age` and `last-modified` on `https://www.fullstackfs.com.au/teamaccess/`:
an `age` equal to the deployment's own age means a file is baked in again.

## Edge caching

Vercel's edge held the rewrite far longer than GitHub Pages' `max-age=600` — ages of
1339 s and 870 s were observed against a 600 s origin TTL, so a push could take 20+
minutes to appear.

`s-maxage` on `Cache-Control` did **not** fix this; Vercel's CDN ignored it for
external rewrites. What works is the dedicated `Vercel-CDN-Cache-Control` (and the
vendor-neutral `CDN-Cache-Control`), now set to `max-age=30`.

Note that a production deployment also purges the edge cache, which can make a broken
cache setting look like it is working. Test propagation by pushing to git alone,
without redeploying.

## Redeploying

Upload only `vercel.json` and `api/ss.js` (preserving the `api/` folder), targeting
production. Test against a preview deployment first: `/teamaccess/` must show the
current build stamp, and `/api/ss?p=%2Fapi%2Forders%2Fshipped` must return
Starshipit's own JSON (a 403 without keys) rather than a Vercel error page.
