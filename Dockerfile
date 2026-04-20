# syntax=docker/dockerfile:1.7
# Static site on nginx — no build step, just copy the files.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html style.css favicon.svg /usr/share/nginx/html/
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O- http://localhost/ >/dev/null || exit 1
