# Deployment (recommended: Cloudflare Pages)

This project is best deployed as a **static site** so it does not consume always-on server resources.
The simulation runs in the user's browser (JS + WASM), using local CPU/GPU resources.

## Why this approach

- Near-zero idle infra cost (no backend server required)
- Fast interactive performance (no per-frame network latency)
- Easy scaling via CDN delivery

## One-time setup in Cloudflare Pages

1. Push this repo to GitHub.
2. In Cloudflare Dashboard, create a new **Pages** project from that repo.
3. Configure build settings:
   - **Framework preset**: `Vite`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. Deploy.

## Post-deploy smoke test (2 minutes)

1. Load the app once, then hard refresh once.
2. Open DevTools Network and confirm:
   - `index.html` is revalidated (not long-lived immutable)
   - `/assets/*` are long-cache immutable
   - `.wasm` is cached and served successfully
3. Start/pause/reset simulation to confirm no runtime errors.

## Important note about WASM artifacts

This project imports WASM bindings from `pkg/` at build time. Keep `pkg/` artifacts committed so Cloudflare can build without installing Rust/wasm-pack in CI.

When Rust/WASM code changes, regenerate and commit `pkg/`:

```bash
bash build-wasm.sh
```

## Local verification before pushing

```bash
npm ci
npm run build
npm run preview
```

## Caching policy

`public/_headers` sets:

- `index.html` and route responses: revalidate each request
- fingerprinted assets and wasm: long immutable cache

This keeps updates safe while minimizing repeat bandwidth/cost.

## Netlify fallback (if needed)

`netlify.toml` is now configured as a backup static target:

- Build command: `npm ci && npm run build`
- Publish directory: `dist`
- Cache headers mirror the Cloudflare strategy (HTML revalidate, assets/wasm immutable)

## Future extension (optional)

If you later need very large experiment sweeps, add an opt-in remote batch runner. Keep default mode local-first for lowest cost and best interactivity.
