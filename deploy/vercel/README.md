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

Vercel's edge caches the rewritten response and, for an **external** rewrite like
this one, does not honour cache headers to expire it. All of these were tried and
none caused revalidation:

- `Cache-Control: s-maxage=60, stale-while-revalidate=120`
- `CDN-Cache-Control: max-age=30`
- `Vercel-CDN-Cache-Control: max-age=30`

Observed ages of 870 s, 1339 s and 4323 s against a 600 s origin TTL, with the
headers present on the response. The headers are emitted; the edge ignores them.

**What actually clears the cache is a deployment.** So the publishing loop is:

1. `git push` (updates GitHub Pages, ~20 s)
2. redeploy the Vercel project (purges the edge; live within ~15 s)

This is easy to misdiagnose, because deploying to test a cache header purges the
cache as a side effect and makes the header look effective. Test propagation with a
push **alone**, never straight after a deploy.

## Redeploying

Upload only `vercel.json` and `api/ss.js` (preserving the `api/` folder), targeting
production. Test against a preview deployment first: `/teamaccess/` must show the
current build stamp, and `/api/ss?p=%2Fapi%2Forders%2Fshipped` must return
Starshipit's own JSON (a 403 without keys) rather than a Vercel error page.
