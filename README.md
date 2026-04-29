# omayoglu.com

Personal landing page for Sol Omayoglu. Hand-written static HTML + CSS — no framework. Shipped as an nginx container via picoRMM onto the Mac mini, fronted by Cloudflare Tunnel.

## Local

```bash
docker compose up --build
open http://localhost:8090
```

## Deploy (picoRMM)

1. **Create workload** — picoRMM admin → *Workloads* → New → backend `compose`, source `picoSols/omayoglu-com` (branch `master`).
2. **Rebuild** — open the workload card → Rebuild. Runs provision + up as one async job.
3. **Route the hostname** — MSP-managed step: point `omayoglu.com` (and `www`) at the tunnel service hitting `http://omayoglu-com-web:80`. Cloudflare issues the edge cert automatically.

Every `git push origin master` followed by a Rebuild from the dashboard ships the update.

## Files

- `index.html` · `style.css` · `favicon.svg` — the site
- `.well-known/mta-sts.txt` — SMTP MTA-STS policy served from `mta-sts.omayoglu.com`
- `Dockerfile` — nginx:alpine serving the static files
- `nginx.conf` — security headers, caching, gzip, healthz
- `docker-compose.yml` — single service exposed on 127.0.0.1:8090

## Mail Security

`mta-sts.omayoglu.com/.well-known/mta-sts.txt` is prepared for MTA-STS in
`testing` mode against the current registrar forwarding MX hosts. DNS still
needs `_mta-sts` and `_smtp._tls` TXT records, plus a Cloudflare route for the
`mta-sts` hostname, before receiving MTAs will consume it. Move from
`mode: testing` to `mode: enforce` only after TLS reports are clean.

## License

All rights reserved.
