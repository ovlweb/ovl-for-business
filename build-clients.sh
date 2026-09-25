#!/usr/bin/env bash
# Build the OVL For Business apps on Linux or macOS: the web client and admin panel (static files),
# and the Android, iPhone/iPad, Mac and Linux apps.
#
#   ./build-clients.sh               asks for your server's address and what to build
#   ./build-clients.sh --help        options for unattended builds
#
# Needs Node.js 22.12 or newer; without it, Node.js is downloaded into ~/.ovl/node first (nothing is
# installed system-wide). The builder itself is scripts/build-clients.mjs.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
own_node="$HOME/.ovl/node"

node_ok() {
  "$1" -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 12) ? 0 : 1)' 2>/dev/null
}

download_node() {
  local os arch base sums file sum tmp
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) echo "This script is for Linux and macOS; on Windows, run build-clients.cmd." >&2; exit 1 ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) echo "Install Node.js 22 or newer for $(uname -m) (https://nodejs.org), then run this again." >&2; exit 1 ;;
  esac
  command -v curl >/dev/null || { echo "Install curl (or Node.js 22 or newer), then run this again." >&2; exit 1; }
  base=https://nodejs.org/dist/latest-v22.x
  echo "Node.js 22 or newer is needed; downloading it into $own_node (only for this builder)…"
  sums=$(curl -fsSL "$base/SHASUMS256.txt")
  file=$(printf '%s\n' "$sums" | awk -v want="-$os-$arch.tar.gz" 'substr($2, length($2) - length(want) + 1) == want { print $2; exit }')
  sum=$(printf '%s\n' "$sums" | awk -v f="$file" '$2 == f { print $1 }')
  [[ -n "$file" && -n "$sum" ]] || { echo "No Node.js download was found for $os-$arch." >&2; exit 1; }
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  curl -fL --progress-bar -o "$tmp/$file" "$base/$file"
  if command -v sha256sum >/dev/null; then
    echo "$sum  $tmp/$file" | sha256sum -c --status
  else
    [[ "$(shasum -a 256 "$tmp/$file" | cut -d' ' -f1)" == "$sum" ]]
  fi || { echo "The Node.js download is damaged; please run this again." >&2; exit 1; }
  mkdir -p "$tmp/node"
  tar -xzf "$tmp/$file" -C "$tmp/node" --strip-components 1
  rm -rf "$own_node"
  mkdir -p "$(dirname "$own_node")"
  mv "$tmp/node" "$own_node"
  rm -rf "$tmp"
  trap - EXIT
}

node=$(command -v node || true)
if [[ -z "$node" ]] || ! node_ok "$node"; then
  node="$own_node/bin/node"
  node_ok "$node" || download_node
  # pnpm (through corepack) and npx come with this Node.js.
  export PATH="$own_node/bin:$PATH"
fi

exec "$node" "$here/scripts/build-clients.mjs" "$@"
