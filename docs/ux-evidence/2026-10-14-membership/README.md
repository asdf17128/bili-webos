# Membership and automatic quality — 2026-10-14

Unreleased `2.3.0 member-test.6`, installed and tested on the LG C4. No GitHub release, push or Homebrew update.

- `before/results.json`: old HEAD App/storage/PlayerPage with the new controlled-browser fixture, 0/2. Existing source was restored after the comparison.
- `after-expanded/results.json`: new behavior, 3/3. Real React and API flow, controlled decoder. The later identity screenshot waits for the drawer transition; it is a fixture account.
- `policy.log`: 4 preference/membership/device-boundary tests.
- `verify-ux.log`: initial gate failure, missing `.js` extension in a new storage import used by Node tests. Preserved.
- `verify-ux-final.log`: full gate passes after the import fix, including legacy Node runtimes, build, ES2016 parse and 73/73 player cases.
- `tv-before-ready.json`: initial TV assertion fired before metadata arrived. Preferences and stream codec had switched; width was still zero. Preserved as a tool sampling failure, not silently relabeled a pass.
- `tv-results.json`: same package after waiting for media readiness, 6/6 including restoring viewing. Actual decoded resolution, codecs, time and frame/audio-byte counters; no claim of panel Dolby notification or Atmos speaker output.
- `restored-check.json`: original video title/position/paused state and all other settings restored. User-requested automatic quality remains enabled. No private viewing position/title is exported.
- `environment.json`: installed file hashes and loaded bundle identity.
- `source-sha256.json`, `package-sha256.json`: source and private test-package identity. IPK stays local in `.release/`.

Run local checks with `bash tools/verify.sh --no-tv --ux`. The member cases are in `tools/test-player-loading.mjs` (`LOADING_FILTER='member '`, with Vite on port 5173); policy cases are in `app/src/utils/qualityPreference.test.js` and registered in verify.

Raw original session state stays in `/tmp/bili-member-20261014/private-before-deploy.json` with mode 0600. Public screenshots use fixture data. Final network simulator results are included separately; anonymous account actions remain explicit skips.
