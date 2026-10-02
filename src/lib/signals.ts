export type DailyClose = { time: number; close: number };
export type ReturnStats = { mu: number; sigma: number };

const DAY_MS = 86_400_000;

function finite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function positive(value: number, name: string): void {
  finite(value, name);
  if (value <= 0) throw new Error(`${name} must be positive`);
}

function periodSize(period: number): void {
  if (!Number.isSafeInteger(period) || period < 1) {
    throw new Error("Period must be a positive safe integer");
  }
}

function validatePrices(prices: readonly number[], requirePositive = false): void {
  for (const price of prices) {
    if (requirePositive) positive(price, "Price");
    else finite(price, "Price");
  }
}

export function normalizeDailyPrices(
  prices: readonly (readonly [number, number])[],
  now: number,
): DailyClose[] {
  finite(now, "Current time");
  const boundary = Math.floor(now / DAY_MS) * DAY_MS;
  const retained = new Map<number, number>();
  for (const point of prices) {
    if (!Array.isArray(point) || point.length !== 2) {
      throw new Error("Malformed price observation: expected [timestamp, price]");
    }
    const [timestamp, price] = point;
    finite(timestamp, "Observation timestamp");
    positive(price, "Observation price");
    // A midnight observation closes the preceding day. Never round intraday points.
    if (timestamp > boundary || timestamp % DAY_MS !== 0) continue;
    if (!retained.has(timestamp)) retained.set(timestamp, price);
  }
  const daily = [...retained]
    .sort(([a], [b]) => a - b)
    .map(([timestamp, close]) => ({ time: timestamp / 1000, close }));
  for (let index = 1; index < daily.length; index++) {
    if (daily[index].time - daily[index - 1].time !== DAY_MS / 1000) {
      throw new Error("Daily prices must have consecutive UTC-midnight samples; gap detected");
    }
  }
  return daily;
}

export function sma(prices: readonly number[], period: number): number[] {
  periodSize(period);
  validatePrices(prices);
  const result: number[] = [];
  for (let end = period; end <= prices.length; end++) {
    const window = prices.slice(end - period, end);
    result.push(window.reduce((sum, price) => sum + price / period, 0));
  }
  return result;
}

export function bollinger(
  prices: readonly number[],
  period = 20,
  mult = 2,
): { middle: number[]; upper: number[]; lower: number[] } {
  periodSize(period);
  finite(mult, "Band multiplier");
  if (mult < 0) throw new Error("Band multiplier must be nonnegative");
  const middle = sma(prices, period);
  const upper: number[] = [];
  const lower: number[] = [];
  for (let index = 0; index < middle.length; index++) {
    const variance = prices.slice(index, index + period)
      .reduce((sum, price) => sum + (price - middle[index]) ** 2 / period, 0);
    const width = mult * Math.sqrt(variance);
    upper.push(middle[index] + width);
    lower.push(middle[index] - width);
  }
  return { middle, upper, lower };
}

export function rsi(prices: readonly number[], period = 14): number[] {
  periodSize(period);
  validatePrices(prices);
  if (prices.length <= period) return [];
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= period; index++) {
    const change = prices[index] - prices[index - 1];
    gain += Math.max(change, 0) / period;
    loss += Math.max(-change, 0) / period;
  }
  const value = () => gain === 0 && loss === 0 ? 50
    : loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  const result = [value()];
  for (let index = period + 1; index < prices.length; index++) {
    const change = prices[index] - prices[index - 1];
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
    result.push(value());
  }
  return result;
}

export function logReturnStats(prices: readonly number[], window = 90): ReturnStats | null {
  periodSize(window);
  validatePrices(prices, true);
  if (prices.length <= window) return null;
  const returns: number[] = [];
  for (let index = prices.length - window; index < prices.length; index++) {
    // Difference of logs avoids overflow/underflow in the price ratio.
    returns.push(Math.log(prices[index]) - Math.log(prices[index - 1]));
  }
  const mu = returns.reduce((sum, value) => sum + value / window, 0);
  const variance = returns.reduce((sum, value) => sum + (value - mu) ** 2 / window, 0);
  return { mu, sigma: Math.sqrt(variance) };
}

function validateStats(stats: ReturnStats): void {
  finite(stats.mu, "Drift");
  finite(stats.sigma, "Volatility");
  if (stats.sigma < 0) throw new Error("Volatility must be nonnegative");
}

export function projectionCone(p0: number, stats: ReturnStats, days = 7): {
  day: number; median: number; lower68: number; upper68: number;
  lower95: number; upper95: number;
}[] {
  positive(p0, "Anchor price");
  validateStats(stats);
  periodSize(days);
  return Array.from({ length: days }, (_, index) => {
    const day = index + 1;
    const drift = stats.mu * day;
    const spread = stats.sigma * Math.sqrt(day);
    return {
      day,
      median: p0 * Math.exp(drift),
      lower68: p0 * Math.exp(drift - spread),
      upper68: p0 * Math.exp(drift + spread),
      lower95: p0 * Math.exp(drift - 1.96 * spread),
      upper95: p0 * Math.exp(drift + 1.96 * spread),
    };
  });
}

export function probabilityUp(stats: ReturnStats, days = 7): number {
  validateStats(stats);
  periodSize(days);
  if (stats.mu === 0) return 0.5;
  if (stats.sigma === 0) return stats.mu > 0 ? 1 : 0;
  const z = stats.mu * Math.sqrt(days) / stats.sigma;
  // Abramowitz & Stegun 26.2.17: absolute CDF error < 7.5e-8.
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const polynomial = t * (0.319381530 + t * (-0.356563782
    + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const tail = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) * polynomial;
  return z > 0 ? 1 - tail : tail;
}

export function crossovers(
  fast: readonly (number | null)[],
  slow: readonly (number | null)[],
): { index: number; type: "Bullish" | "Bearish" }[] {
  if (fast.length !== slow.length) throw new Error("Crossover series must be aligned");
  const result: { index: number; type: "Bullish" | "Bearish" }[] = [];
  let previous = 0;
  for (let index = 0; index < fast.length; index++) {
    const f = fast[index];
    const s = slow[index];
    if (f !== null) finite(f, "Fast average");
    if (s !== null) finite(s, "Slow average");
    if (f === null || s === null) continue;
    const sign = f > s ? 1 : f < s ? -1 : 0;
    if (sign === 0) continue;
    if (previous !== 0 && sign !== previous) {
      result.push({ index, type: sign > 0 ? "Bullish" : "Bearish" });
    }
    previous = sign;
  }
  return result;
}

export function summarize(input: {
  sma20?: number | null; sma50?: number | null; rsi14?: number | null;
  close?: number | null;
  bands?: { upper: number; middle: number; lower: number } | null;
  probability?: number | null;
}): {
  label: "Bullish" | "Bearish" | "Neutral"; score: number;
  votes: { name: string; vote: -1 | 0 | 1; reason: string }[];
} {
  const votes: { name: string; vote: -1 | 0 | 1; reason: string }[] = [];
  const available = (value: number | null | undefined): value is number =>
    typeof value === "number" && Number.isFinite(value);
  const add = (name: string, ready: boolean, bullish: boolean, bearish: boolean,
    reasons: [string, string, string]) => {
    const vote = ready ? bullish ? 1 : bearish ? -1 : 0 : 0;
    votes.push({ name, vote, reason: ready ? reasons[vote === 1 ? 0 : vote === -1 ? 1 : 2]
      : "Unavailable: not enough finite data" });
  };
  const trendReady = available(input.sma20) && available(input.sma50);
  add("SMA trend", trendReady,
    trendReady && input.sma20! > input.sma50!, trendReady && input.sma20! < input.sma50!,
    ["SMA 20 above SMA 50", "SMA 20 below SMA 50", "SMA 20 equals SMA 50"]);
  const rsiReady = available(input.rsi14);
  add("RSI 14", rsiReady, rsiReady && input.rsi14! < 30, rsiReady && input.rsi14! > 70,
    ["RSI below 30", "RSI above 70", "RSI between 30 and 70 inclusive"]);
  const bandsReady = available(input.close) && !!input.bands
    && available(input.bands.upper) && available(input.bands.middle)
    && available(input.bands.lower);
  add("Bollinger", bandsReady,
    bandsReady && input.close! < input.bands!.lower,
    bandsReady && input.close! > input.bands!.upper,
    ["Close below lower band", "Close above upper band", "Close inside or on bands"]);
  const probabilityReady = available(input.probability);
  add("P(up)", probabilityReady,
    probabilityReady && input.probability! > 0.55,
    probabilityReady && input.probability! < 0.45,
    ["P(up) above 55%", "P(up) below 45%", "P(up) between 45% and 55% inclusive"]);
  const score = votes.reduce((sum, { vote }) => sum + vote, 0);
  return { label: score >= 2 ? "Bullish" : score <= -2 ? "Bearish" : "Neutral", score, votes };
}
