# syntax=docker/dockerfile:1.7
# Static site on nginx. Using COPY (not a runtime bind) because picoRMM's
# compose runner writes the repo inside its own container namespace,
# so bind-mounting ./ at runtime resolves to an empty path on the host
# daemon. COPY streams files to the daemon at build time, sidestepping
# that mount-scope problem.
FROM nginx:alpine
COPY index.html style.css favicon.svg /usr/share/nginx/html/
EXPOSE 80
