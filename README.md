# omayoglu.com

Personal landing page for Sol Omayoglu. Hand-written static HTML + CSS — no framework.

## Deploy

Cloudflare Pages:

1. Cloudflare dashboard → Pages → **Create project** → Connect to Git → `picoSols/omayoglu-com`
2. Framework preset: **None**. Build command: *(empty)*. Output directory: `/`.
3. After first deploy, Pages → **Custom domains** → add `omayoglu.com` and `www.omayoglu.com`. Cloudflare updates DNS + issues the TLS cert automatically.

Every push to `main` auto-deploys.

## Files

- `index.html` — single-page site
- `style.css` — hand-written, dark-first with `prefers-color-scheme: light` fallback
- `favicon.svg` — monogram

## License

All rights reserved.
