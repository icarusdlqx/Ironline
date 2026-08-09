# Hosting IRONLINE

The game is a static site — no server, no database, no API. Anything that can
serve files can host it.

## Cloudflare (what this repo is set up for)

Cloudflare builds straight from the repository, so a push to `main` is a
deploy. It works with a private repo, which GitHub Pages does not without a
paid plan.

Connecting a repo now creates a **Worker serving static assets** rather than a
Pages project — same thing for a static site, but the dashboard looks different
and the address is `*.workers.dev` rather than `*.pages.dev`. The live URL is
under **Workers & Pages → the project → Domains**, and it has an enable switch
that is **off by default**: with it off the Overview tab reads "No URLs
enabled" and nothing is reachable however well the build went.

**Settings**, in the Cloudflare dashboard under **Workers & Pages → your
project → Settings → Build**:

| Field                  | Value           |
| ---------------------- | --------------- |
| Build command          | `npm run build` |
| Build output directory | `dist`          |
| Production branch      | `main`          |

Node version comes from `.node-version` in the repository root, so there is
nothing to set for it.

`npm run build` runs `tsc --noEmit` before Vite, so a type error fails the
Cloudflare build and never reaches the live site. The rest of the checks —
lint, and the test suite — run on GitHub Actions (`.github/workflows/ci.yml`)
and mark the commit rather than blocking the deploy.

### Deploying on command rather than on push

Every push to `main` deploys. To publish without pushing, open the project in
the dashboard, go to **Deployments**, and use **New deployment**. Pushing to
any other branch produces a preview deployment on its own URL and leaves
production alone — which is the way to look at a change before it is live.

### Caching

`public/_headers` is copied into the build output and read by Cloudflare.
Fingerprinted assets are cached for a year; `index.html` is not cached at all.
Without that second rule a phone that has played once keeps loading the build
it first saw, and no amount of pushing changes what you get.

## Playing on a phone

The site works in Safari on iOS and macOS. On a phone:

- **Drag** the ground to move the camera, **pinch** to zoom.
- **Tap** one of your mechs to select it; **tap** an enemy to attack it.
- **Tap** open ground to send the selection there.
- Everything else is on the buttons along the bottom.

Add it to the home screen (Share → Add to Home Screen) and it opens full
screen with no browser chrome.

## Somewhere else

`npm run build` writes a plain static site to `dist/`. Upload that directory
anywhere — Netlify, an S3 bucket, a folder on a web server. The build uses
relative asset paths, so it works from a domain root or from a subdirectory
without configuration.

`npm run build:single` writes `dist-single/ironline.html`: the entire game,
including every asset, as one file that can be emailed or opened from a disk.
