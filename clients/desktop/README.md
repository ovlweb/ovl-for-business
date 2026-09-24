# OVL Business — macOS, Windows & Linux

The desktop apps are a [Tauri 2](https://tauri.app) shell around the web client
(`clients/web`): small native binaries using the system webview.

## Requirements

- Rust (stable) — https://rustup.rs
- Platform dependencies — https://tauri.app/start/prerequisites/
  (Linux: `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`)

## Develop / build

```bash
pnpm install
export VITE_API_URL=https://business.example.com   # where the API lives
pnpm --filter @ovl/desktop dev                      # runs the web dev server inside a native window
pnpm --filter @ovl/desktop build                    # .dmg / .msi / .exe / .deb / .AppImage / .rpm
```

App icons live in `src-tauri/icons` and are generated from `clients/web/public/icon.png`
with `pnpm --filter @ovl/desktop icons`.

Cross-platform release builds run in GitHub Actions (`.github/workflows/native.yml`),
since macOS and Windows installers must be built on those systems.
