# Hosting IRONLINE

The game is a static site — no server, no database, no API. Anything that can
serve files can host it.

## GitHub Pages (what this repo is set up for)

`.github/workflows/deploy.yml` builds and publishes on every push to `main`,
and can be run by hand from the **Actions** tab → **Deploy** → **Run workflow**
when you want to publish without pushing.

**One-time setup**, on GitHub:

1. Repository **Settings** → **Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.

That is the whole of it. The next push to `main` publishes to:

    https://icarusdlqx.github.io/Ironline/

The workflow refuses to publish a build that does not compile, does not lint,
or fails its tests, so the live site is never a broken one. It also copies the
self-contained `ironline.html` alongside, at
`https://icarusdlqx.github.io/Ironline/ironline.html`, for playing offline.

## Playing on a phone

The site works in Safari on iOS and macOS. On a phone:

- **Drag** the ground to move the camera, **pinch** to zoom.
- **Tap** one of your mechs to select it; **tap** an enemy to attack it.
- **Tap** open ground to send the selection there.
- Everything else is on the buttons along the bottom.

Add it to the home screen (Share → Add to Home Screen) and it opens full
screen with no browser chrome.

## Somewhere other than GitHub Pages

`npm run build` writes a plain static site to `dist/`. Upload that directory
anywhere — Cloudflare Pages, Netlify, an S3 bucket, a folder on a web server.
The build uses relative asset paths, so it works from a domain root or from a
subdirectory without configuration.

`npm run build:single` writes `dist-single/ironline.html`: the entire game,
including every asset, as one file that can be emailed or opened from a disk.
