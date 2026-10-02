<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Commands

- Use Node 24 LTS for installation and verification (`node --version`); do not change the user's global default.
- Install locked dependencies with `npm ci`; develop with `npm run dev`.
- Verify with `npm test`, `npm run build`, and `npx --no-install eslint <changed-JS/TS-files>`.
- Record baseline failures before editing. Report unrelated lint/test/build failures; do not fix or suppress them merely to obtain green output.

## Data rules

- Use real API data only in the product: no hardcoded market prices, changes, volumes, valuations, invented news, or fabricated fallback candles. Test fixtures belong only in tests.
- Missing numeric fields stay `null` or absent in API responses and show "Unavailable" in the UI; never substitute zero or retain another coin/range's stale data.
- Prefer source-provided 24h change fields. Only derive a 24h change if the timestamps actually span 24 hours.
- Select chart windows by source timestamps/duration, never by treating days as candle counts. Plot candles, overlays, and projections on one time scale.
- Follow `SIGNALS_SPEC.md`; keep calculations pure, use sufficient completed daily history, and never fill missing observations or fabricate warm-up data.

## UI rules

- Preserve IntelliTrex branding, existing financial disclaimers, and light/dark modes. Label statistical signals and projections "not financial advice".
- Check source values, request frequency, failed-request states, both themes, and mobile through desktop layouts for changed market UI.
- Verify no horizontal page overflow at 320px and desktop widths; ticker/table scrolling must remain local to their containers.

## Git rules

- Use one feature branch per task, never work directly on `main`, and preserve unrelated local changes. Carry reviewed commits forward when assembling a combined PR.
- Before pushing, run `git remote -v`; confirm the branch is not `main` and the target is the user's fork, not upstream or the `local` backlink. Never push directly to `main`.
- Inspect the full diff and run `git diff --check` before keeping or committing work. Use logical commits; never commit secrets or disable tests/lint rules to make checks pass.
