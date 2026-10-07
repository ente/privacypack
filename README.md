# PrivacyPack.org

Pick the mainstream apps you used before, show the privacy-respecting tools you’ve switched to, and share your privacy wins!

Create your pack at [PrivacyPack.org](https://privacypack.org).

![PrivacyPack Banner](public/og-image.png)

## Development Setup

### Prerequisites

- Node.js 22.16.0 and its bundled npm (pinned in `.node-version`, which CI also reads)
- OpenSSL, for the local HTTPS server used by the browser tests

### Local Development

1. Clone the repository

```bash
git clone https://github.com/ente/privacypack.git
cd privacypack
```

2. Install dependencies from the lockfile

```bash
npm ci
```

3. Start the development server

```bash
npm run dev
```

The application will be available at `http://localhost:3000`

### Validation

Install the test browsers, then run the full checks:

```bash
npx playwright install --with-deps chromium webkit
npm run check
```

`npm run check` verifies the asset versions and the catalog, runs the unit tests, typechecks, lints, builds the static export into `out/`, and runs the Playwright suite against that export in Chromium and WebKit. The export is served over local HTTPS by `scripts/serve-export.mjs`, which applies `public/_headers` as Cloudflare Pages documents it: every matching rule applies, and a header set by more than one rule is joined with commas. This makes overlapping rules visible in tests. (The live site was seen to merge identical `Cache-Control` values instead.)

- `npm run test:e2e` tests the existing `out/`. Run `npm run build` first after changing the source.
- `npm run test:e2e:dev` runs the same suite against `next dev`.
- `npm run check` and `npm run test:e2e` serve the export on port 3000, which `npm run dev` also uses: stop the dev server or choose another port (below). `npm run test:e2e:dev` starts its own `next dev`, and Next.js 16 runs only one per checkout, so stop `npm run dev` first. `npm run build` can run while the dev server is up.
- The test server uses port 3000. To test an existing `out/` while something else holds that port, choose another one, for example `PORT=3001 npm run test:e2e`.
- Extra arguments go to Playwright, for example `npm run test:e2e -- tests/export-sharing.spec.ts --project=webkit`.

What the checks cannot prove:

- The header and routing tests use the local emulation of `_headers`, not Cloudflare Pages itself. For example, the live site redirects `/create/` and `/create.html` to `/create` (308), which the local server does not. Check headers, redirects and 404s on a deployment.
- The Web Share API and clipboard are stubbed in the browser tests. They show how the app handles each outcome, not that an operating system share sheet delivers the PNG. Check sharing on real iOS and Android devices.

### Browser support

Next.js 16 compiles for Chrome, Edge and Firefox 111 and Safari 16.4 or later, and Tailwind CSS v4 needs Chrome 111, Safari 16.4 (including iOS) and Firefox 128 or later. Older browsers are not supported.

### How export works

The card is drawn in the browser from the hidden `components/PrivacyPackResult.tsx` with html2canvas into a 3000×3000 PNG. Nothing is uploaded. An image is prepared after each change, once no picker is open, so that Share can call the Web Share API directly from the tap. Without file sharing, Share copies the image to the clipboard, or downloads it.

The card uses the bundled JetBrains Mono font. If it cannot be loaded, for example because a content blocker or iOS Lockdown Mode blocks web fonts, the image uses a system monospace font and the page says so. Each image is fetched once and embedded in the capture, so html2canvas never fetches images itself, and an image that cannot load fails the export rather than leaving a gap. `app/JetBrainsMono.woff2` is a losslessly compressed copy of `app/JetBrainsMono.ttf`, with all glyphs retained; the TTF remains the source. It was generated with FontTools 4.60.2 using `fonttools ttLib.woff2 compress app/JetBrainsMono.ttf`.

### Dependency versions

Three packages deliberately stay behind `npm outdated`:

- `typescript` stays on 6.x. TypeScript 7 has no JavaScript API yet, which `typescript-eslint` (used by `eslint-config-next`) needs.
- `@types/node` follows the Node major in `.node-version` (22), so code cannot typecheck against Node APIs the runtime does not have.
- `html2canvas-pro` stays on 1.x. In 2.x the cloned page's stylesheet can load after rendering starts, which leaves the card unstyled in WebKit, and a slow web font holds the capture until it times out.

### Dependency audit

`npm audit` reports a high-severity advisory for `braces` (GHSA-vfj7-8cjw-p6xm). It reaches the project only through `eslint-config-next`'s lint-time file globbing, is not part of the exported site, and has no patched release yet. Do not run `npm audit fix --force`: it would downgrade `eslint-config-next` to a different Next.js major.

## Add a missing app

New apps can be added to the catalog by modifying `/data/apps.json` and opening a PR. Each app belongs to a category and is either a mainstream app or a privacy-focused alternative.

### App logo requirements

When adding a new app, please ensure the logo meets these specifications:

- Format: JPG
- General: 200x200px, no rounded corners, no transparent background, sufficient padding around the logo
- File size: < 50KB
- Location: Place the logo file in `/public/app-logos/{app_id}.jpg`

After adding or changing images in `public/`, run `npm run assets:generate` to refresh `lib/asset-versions.json`, which gives each image a content-versioned URL, then run `npm run check`. The build fails while the manifest is stale. Catalog validation fully decodes each JPEG to detect corrupt or incomplete files.

## About

PrivacyPack is created and maintained by [Ente](https://ente.io), the makers of Ente Photos and Ente Auth.

## License

PrivacyPack is distributed under the [MIT license](/LICENSE).

### App logo credits

The [Debian Open Use Logo](https://www.debian.org/logos/openlogo-nd.svg) was created by Raul Silva and is copyright © 1999 Software in the Public Interest, Inc. It is used under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), one of the licenses offered on the [Debian logo page](https://www.debian.org/logos/). `public/app-logos/debian.jpg` is a proportionally resized version with white padding, converted to JPEG, and retains the same license.

The [HeliBoard icon](https://github.com/HeliBorg/HeliBoard/blob/bc2b91189d60692090bcf30448ba35a9feef8110/fastlane/metadata/android/en-US/images/icon.png) is by [Fabian OvrWrt](https://github.com/FabianOvrWrt), with contributions from [The Eclectic Dyslexic](https://github.com/the-eclectic-dyslexic), and is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). `public/app-logos/heliboard.jpg` is a resized version with white padding, converted to JPEG, and retains the same license.

The [FlorisBoard icon](https://github.com/florisboard/florisboard/blob/fe1241f4921b3eae923571ff7a3e113a7e10d677/app/src/main/ic_app_icon_stable-playstore.png) is credited to [Nikolay Anzarov (@BloodRaven0)](https://github.com/BloodRaven0) in the [upstream README](https://github.com/florisboard/florisboard/blob/fe1241f4921b3eae923571ff7a3e113a7e10d677/README.md#used-libraries-components-and-icons). Its catalog JPEG was resized and given white padding.

The [FUTO Notes app icon](https://gitlab.futo.org/futo-notes/futo-notes/-/blob/cf29b96514e6be20963786bbcc484c6569c3dc69/assets/images/icon.png) comes from the official FUTO Notes project. `public/app-logos/futo_notes.jpg` is a proportionally resized copy that retains the original white padding, converted to JPEG for app identification. This third-party artwork is excluded from PrivacyPack's MIT license.

The [IzzyOnDroid logo](https://codeberg.org/IzzyOnDroid/assets/src/commit/2685b17e486eea25c07178f355f7ddc073371a44/IzzyOnDroidLogo.png), reworked by Wolfshappen, identifies [IzzyOnDroid](https://izzyondroid.org/). Its background is a registered trademark of IzzySoft; the 3D Android artwork is public domain. `public/app-logos/izzyondroid.jpg` preserves the complete graphic, proportionally resized on white and converted to JPEG. The artwork remains subject to the [official usage terms](https://codeberg.org/IzzyOnDroid/assets/src/commit/d198f018877bf0ad0ed7b5fa853ed87d211a5dba/README.md) and is excluded from PrivacyPack's MIT license.
