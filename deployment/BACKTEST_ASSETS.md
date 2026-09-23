# Backtest static assets

The September 2026 production deployment omitted the `data` directory. Both
backtest HTML/JavaScript files loaded, but their price requests returned HTTP 404.
The datasets were already committed; re-fetching prices was not required.

Run `npm run build` before deploying Pages. `wrangler.toml` now points to
`.pages-dist`, built from tracked public assets and two explicitly allowed data
files. The build fails if either dataset is missing or empty. Other data,
deployment files, server code, environment files and repository metadata are
not copied into the public directory. Do not deploy the repository root or
rely on `.wranglerignore` to filter a Pages upload.

Verify the build with `node scripts/check-backtest-deployment.mjs`. After a
preview or production deployment, pass its URL to the same command to verify
HTTP status, JSON content type and exact equality with the source prices.

Both simulations execute entirely in the browser. Price acquisition is a local
Python script and the downloaded datasets are static files. There is no
Cloudflare calculation, database or scheduled trading process to migrate for
these pages. A future static host can serve `.pages-dist`; the site's separate
Pages Functions and authentication still require their existing backend.
