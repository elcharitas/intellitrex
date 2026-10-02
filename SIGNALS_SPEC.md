# Spec: Price signals (replaces the ML forecasts)

## Problem
The forecast dropdown on /currency (XGBoost, Prophet, NHITS, GRU, Ensemble)
reads CSV files from a separate GitHub repository. Those requests return
nothing, so users see no forecast line, and the Bollinger Bands panel shows
"N/A". We replace the models with transparent statistical signals, computed
from price history, that anyone can check by hand.

## Users
People on /currency who want to know what simple statistics say about a
coin, with the method visible and a clear "not financial advice" label.

## Signals (all computed from daily closing prices)
1. **SMA crossover.** Simple moving averages over 20 and 50 days. Bullish
   when SMA 20 crosses above SMA 50 (golden cross), bearish when it crosses
   below (death cross). Mark each crossover on the chart.
2. **Bollinger Bands.** 20-day SMA plus and minus 2 standard deviations
   (population standard deviation over the same 20 days). Draw the band on
   the chart and show the latest upper, middle and lower values in the
   Bollinger panel.
3. **RSI 14.** Relative Strength Index with Wilder smoothing. Overbought
   above 70, oversold below 30.
4. **7-day probability cone.** Assume daily log returns are normally
   distributed (geometric Brownian motion). Estimate the daily drift `mu`
   and volatility `sigma` from the last 90 daily log returns. For day
   t = 1..7 after the last close P0:
   - median: `P0 * exp(mu * t)`
   - 68% band: `P0 * exp(mu * t +/- sigma * sqrt(t))`
   - 95% band: `P0 * exp(mu * t +/- 1.96 * sigma * sqrt(t))`
   Draw it as a shaded cone after the last candle.
5. **Chance of closing higher in 7 days.**
   `P(up) = Phi(mu * 7 / (sigma * sqrt(7)))`, where Phi is the standard
   normal CDF. Show it as a percentage.

## Signal summary card
Show an overall label (Bullish, Bearish or Neutral) from a simple vote:

| Signal | +1 | -1 | 0 |
|---|---|---|---|
| SMA trend | SMA 20 above SMA 50 | SMA 20 below SMA 50 | not enough data |
| RSI 14 | below 30 | above 70 | otherwise |
| Bollinger | close below lower band | close above upper band | inside |
| P(up) | above 55% | below 45% | otherwise |

A total of 2 or more is Bullish, -2 or less is Bearish, anything else is
Neutral. List each vote with its reason. Label the card "Statistical
signals, not financial advice."

## Acceptance criteria
- [x] `src/lib/signals.ts` exports pure functions `sma`, `bollinger`, `rsi`,
      `logReturnStats`, `projectionCone`, `probabilityUp` and `summarize`,
      with no React and no network calls.
- [x] `src/lib/signals.test.ts` passes with `npm test` (Vitest). It covers
      at least: SMA of [1,2,3,4,5] with window 3 is [2,3,4]; RSI of a
      strictly rising series is 100; `probabilityUp` is 0.5 when mu = 0.
- [x] On /currency the forecast dropdown is replaced by signal toggles
      (SMA crossover, Bollinger, RSI, Probability cone), each drawn on the
      chart.
- [x] The Bollinger panel shows real numbers, not N/A.
- [x] The currency page makes no request to /api/forecasts or GitHub.
- [x] `npm run build` passes, and `npx eslint` reports no errors in the
      files you changed. The repo has 5 pre-existing lint errors in other
      files: do not fix or suppress them, and do not edit unrelated files.

Verified on 2026-10-02 using Node 24: tests, build, changed-file lint, BTC/ETH
browser checks, and independent Python calculations. The five-error count
records the original baseline; related currency fetching changes resolve two,
while three unrelated errors remain untouched.

## Data
Signals need at least 91 consecutive daily closes for 90 daily log returns.
`/api/prices` must be able to return daily candles (for example a
`resolution=daily` query backed by CoinGecko
`market_chart?interval=daily`), keeping the `{ pair, candles }` shape.
Daily resolution requests up to 365 days independently of the display range.
Close-only observations have `open`, `high`, `low`, and `volume` set to `null`;
OHLC responses also use `null` for unavailable volume. Never manufacture those
fields or substitute a different coin when a pair is unsupported.

## Out of scope
Machine-learning models, backtesting, changes to premium gating, and the AI
advisor.

## Task list
1. Add Vitest as a dev dependency and an `npm test` script.
2. Implement `src/lib/signals.ts` with its tests.
3. Add daily-resolution support to `/api/prices`.
4. Draw the signals and the summary card on /currency, and stop using the
   forecast CSVs.
5. Run tests, build and eslint on the changed files, then show the final diff.

## Approved Session 2 clarifications

Recovered from GitHub PR #1, `smqd19/intellitrex`, head pinned to
`8b245073265ae7aa7729defc413e994e65d2f491`. The original formulas and acceptance
criteria above are retained; the 90-close requirement is corrected to 91.

- Normalize raw CoinGecko `[timestampMilliseconds, price]` observations using an
  explicit `now` in milliseconds. Reject malformed points and nonfinite or
  nonpositive prices. Keep only observed UTC-midnight timestamps at or before
  the current UTC midnight, including today's boundary (closing the preceding
  day). Remove intraday points, including the trailing live observation, and
  future points. Sort retained observations; deduplicate exact timestamps,
  keeping the first observed duplicate. Never round timestamps or fill gaps.
  Reject nonconsecutive retained daily samples with a clear error.
  Normalized `DailyClose.time` is Unix seconds.
- Estimate `mu` as the mean of the final 90 log returns, requiring the final
  91 closes. Estimate `sigma` with population variance (divisor 90).
  Insufficient history returns `null`, not fabricated estimates.
- Seed RSI14 from the means of gains and losses over the first 14 changes;
  subsequent averages use Wilder's `(previous * 13 + current) / 14`.
  Flat gain = loss = 0 returns 50; rising returns 100; falling returns 0.
- At zero volatility, P(up) is 1 for positive `mu`, 0 for negative `mu`, and
  0.5 for zero `mu`. Otherwise use the specified normal CDF, with approximation
  absolute error within `1e-7`.
- Equality is neutral: equal SMAs, RSI exactly 30 or 70, P(up) exactly 45% or
  55%, and close exactly on either Bollinger bound. Missing/nonfinite summary
  inputs yield a zero vote with an unavailable reason. Always return four
  votes and their reasons.
- Crossovers use aligned input indices and remember the last strict
  fast-versus-slow sign. Equalities do not change it: above → equal → above
  is not a cross. The first non-equal relation is not itself a cross.
  Null warm-up entries provide no relation.
- Anchor the cone to the last completed daily close. Plot future days 1..7 at
  `anchorTime + day * 86400` (Unix seconds). The pure cone function returns day
  offsets; the chart maps them to timestamps. Use exactly the exponential
  formulas above, without a `-0.5 * sigma²` drift adjustment.
- Compact SMA/Bollinger results start at input index `period - 1`; compact
  RSI results start at input index `period`. Initial daily indicator warm-up
  gaps are permitted on 1Y: do not fabricate earlier history.
- Pure calculations have no React or fetch dependencies. Periods and day
  horizons must be positive safe integers. General SMA/RSI series must be
  finite; logs and projection anchors require positive prices. Volatility
  and the Bollinger multiplier must be finite and nonnegative.
