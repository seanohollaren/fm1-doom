# The installer site: doom.deadlockinteractive.com

A Vite + React page that installs Doom on an M-VAVE FM-1 from the browser, and the AWS set-up that hosts it.
Same shape as `static-personal-site`: `frontend/` is built to static files, `infra/` (CDK) puts them in S3 behind
CloudFront with a certificate and a Route 53 record, and a push to `main` deploys through GitHub Actions.

The site holds **no game data**. The page downloads id Software's shareware `DOOM1.WAD` (v1.9) from a public
mirror into the visitor's browser when they press "Fetch it" (or takes their own copy), cuts it down to one level,
converts it and packs it in the browser, then installs over USB-MIDI.

The mirrors are in `frontend/src/site.ts` (`sharewareMirrors`): the Internet Archive's cross-site endpoint first,
a pinned GitHub raw file second. The page accepts only the exact file (size and SHA-256), so a mirror can go
away or go bad without harm: the visitor is told to use their own copy. Each mirror's host must also be in
`connect-src` in `security-headers.json`; a test checks that.

## What is where

| Path | What |
| --- | --- |
| `frontend/src` | The page. `steps/` are the six wizard steps, `components/` the drawn FM-1, the status readout, the memory map, the manual. `styles/tokens.css` holds every colour and face. |
| `frontend/src/lib/useInstaller.ts` | All the page's state: the file, the connection, the install run. |
| `../web/*.js` | The install logic itself, shared with the single-file page (`web/installer.html`): `wadcut.js` (cut a WAD), `convert.js` (run the converter), `datapack.js` (pack), `install.js` (the install flow over MIDI), `vendor/felucca/` (Felucca's package and update-protocol code, unmodified). The site imports them as `@fm1/...`. |
| `frontend/public/firmware`, `public/whdgen`, `src/firmware.json` | **Committed build outputs**: the firmware-only package, rp2040-doom's data converter as WebAssembly, and their hashes. Written by `sync_firmware.py`. |
| `security-headers.json` | The content security policy and permissions policy. CloudFront sends them; `npm run preview` sends the same. |
| `infra/` | CDK: `DoomSiteCertStack` (us-east-1, for CloudFront) and `DoomSiteFrontendStack` (us-west-2: bucket, distribution, DNS). |
| `../.github/workflows/deploy.yml` | Test, build, `cdk deploy` on a push to `main` that touches `site/` or `web/`. |

## Working on it

```bash
cd site/frontend
npm ci
npm run dev        # http://localhost:5173
npm test           # the install flow against a stand-in FM-1, the WAD pipeline, the shipped files
npm run build && npm run preview   # the built site under its real security headers, http://127.0.0.1:5181
```

- `?demo` (development server only) runs the page against a stand-in FM-1, so the whole install can be watched
  without a device. `?demo=FM-1_666` starts from the Doom firmware; `&stop=30` makes the data transfer fail.
  The stand-in is not in a production build.
- `?force=1` is the real test mode: the second block of game data is rewritten even if the FM-1 already holds it.
- The WAD tests need `wads/doom1.wad` and the controls test needs the `rp2040-doom` clone; both are skipped
  without them (as in CI). `.npmrc` turns off npm's automatic peer installs: npm 10 cannot resolve vitest's
  optional peers from scratch.

## Releasing a firmware build

Only a build that has run on a real FM-1 goes on the site.

```bash
sh firmware/build.sh && python3 firmware/pack.py data/e1m1_6h.whx   # as in NOTES.md
sh web/build_whdgen.sh                                              # only if the converter changed
python3 site/sync_firmware.py b6                                    # copies the outputs into site/frontend
cd site/frontend && npm test                                        # the shareware WAD must still give the tested data
```

Then edit `buildNotes` in `frontend/src/site.ts` (what a player should know about this build), check the controls
list (`src/lib/controls.ts`; the test compares it with the firmware source), commit, and push.

## Deploying

A merge to `main` that touches `site/` or `web/` deploys: `.github/workflows/deploy.yml` runs the tests, builds
the frontend, runs `cdk deploy` for both stacks, then checks that the live page answers and serves exactly the
committed firmware and converter. `ci.yml` runs the same checks (and a `cdk synth`) on every pull request.
Nobody deploys by hand.

- **DNS.** `deadlockinteractive.com` already has its hosted zone (`Z07104152PEL021SX0LUQ`, in
  `infra/cdk.context.json`) and the registrar points at it. The zone also carries the records of the Squarespace
  site on the apex and `www`; the stacks add only `doom.` (A and AAAA) and the certificate's validation record.
- **The deploy role**, `github-actions-deploy-fm1-doom`, is made once, with admin credentials, by
  `scripts/setup-github-oidc.sh` (the same arrangement as beverage-chilling): GitHub's OIDC tokens for this
  repository may assume it, and it may do nothing but assume CDK's bootstrap roles in us-east-1 and us-west-2.
  Until it exists the deploy job fails at "Configure AWS credentials".
- **Source.** The page's footer links to this repository, because the firmware it serves is GPL: the
  repository must be public while the site is live.
