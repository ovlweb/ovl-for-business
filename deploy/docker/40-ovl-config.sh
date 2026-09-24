#!/bin/sh
# Write the runtime configuration of the single-page app from environment variables.
set -eu
API_URL="${OVL_API_URL:-}"
printf "window.__OVL_CONFIG__ = { apiUrl: '%s' };\n" "$API_URL" > /usr/share/nginx/html/config.js
