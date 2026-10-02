import { describe, expect, it } from "vitest";
import {
  bollinger, crossovers, logReturnStats, normalizeDailyPrices,
  probabilityUp, projectionCone, rsi, sma, summarize,
} from "./signals";

describe("daily observations", () => {
  const day = 86_400_000;
  it("sorts exact midnight samples, keeps the first duplicate and includes today's boundary", () => {
    expect(normalizeDailyPrices([
      [3 * day + 1000, 999], [3 * day, 30], [day, 10],
      [2 * day, 20], [2 * day, 200], [4 * day, 40],
      [day + 1234, 100],
    ], 3 * day + 5000)).toEqual([
      { time: day / 1000, close: 10 },
      { time: 2 * day / 1000, close: 20 },
      { time: 3 * day / 1000, close: 30 },
    ]);
  });
  it("never rounds intraday observations or fills gaps", () => {
    expect(normalizeDailyPrices([[day + 1, 10]], 3 * day)).toEqual([]);
    expect(() => normalizeDailyPrices([[day, 10], [3 * day, 30]], 3 * day))
      .toThrow(/consecutive.*gap/);
    expect(normalizeDailyPrices([], 3 * day)).toEqual([]);
  });
  it("rejects malformed points, even when they would otherwise be filtered out", () => {
    for (const price of [0, -1, NaN, Infinity]) {
      expect(() => normalizeDailyPrices([[day + 1, price]], 3 * day)).toThrow();
    }
    expect(() => normalizeDailyPrices([[NaN, 10]], 3 * day)).toThrow(/timestamp/);
    expect(() => normalizeDailyPrices([], NaN)).toThrow(/Current time/);
    const malformed = [[day]] as unknown as [number, number][];
    expect(() => normalizeDailyPrices(malformed, 3 * day)).toThrow(/Malformed/);
  });
});

describe("daily indicators", () => {
  it("returns compact SMA outputs and permits general finite series", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([2, 3, 4]);
    expect(sma([-2, 0, 2], 3)).toEqual([0]);
    expect(sma([1, 2], 3)).toEqual([]);
  });
  it("uses population variance for Bollinger bands", () => {
    const bands = bollinger([1, 2, 3, 4, 5], 3);
    expect(bands.middle).toEqual([2, 3, 4]);
    for (let index = 0; index < 3; index++) {
      expect(bands.upper[index]).toBeCloseTo(index + 2 + 2 * Math.sqrt(2 / 3), 12);
      expect(bands.lower[index]).toBeCloseTo(index + 2 - 2 * Math.sqrt(2 / 3), 12);
    }
    expect(bollinger(Array(20).fill(10))).toEqual({
      middle: [10], upper: [10], lower: [10],
    });
  });
  it("handles rising, falling and flat RSI with the correct warm-up", () => {
    expect(rsi(Array.from({ length: 17 }, (_, index) => index))).toEqual([100, 100, 100]);
    expect(rsi(Array.from({ length: 16 }, (_, index) => -index))).toEqual([0, 0]);
    expect(rsi(Array(16).fill(10))).toEqual([50, 50]);
    expect(rsi(Array(14).fill(10))).toEqual([]);
  });
  it("seeds RSI with arithmetic means and then uses Wilder recurrence", () => {
    // Changes +2,-1,+2 seed gains=4/3, losses=1/3.
    // Next change -3 gives smoothed gains=8/9, losses=11/9.
    const values = rsi([10, 12, 11, 13, 10, 11], 3);
    expect(values[0]).toBeCloseTo(80, 12);
    expect(values[1]).toBeCloseTo(100 * 8 / 19, 12);
    // Next +1: gains=25/27, losses=22/27.
    expect(values[2]).toBeCloseTo(100 * 25 / 47, 12);
  });
});

describe("log returns and projections", () => {
  it("requires 91 closes and uses only the final 90 returns, with population sigma", () => {
    expect(logReturnStats(Array(90).fill(10))).toBeNull();
    const prices = [1e100, ...Array.from({ length: 91 }, (_, index) =>
      Math.exp(index % 2 === 0 ? 0 : 0.2))];
    const stats = logReturnStats(prices)!;
    expect(stats.mu).toBeCloseTo(0, 12);
    expect(stats.sigma).toBeCloseTo(0.2, 12);
    expect(logReturnStats(Array(91).fill(10))).toEqual({ mu: 0, sigma: 0 });
    const small = logReturnStats([1, Math.exp(1), Math.exp(3)], 2)!;
    expect(small.mu).toBeCloseTo(1.5, 12);
    expect(small.sigma).toBeCloseTo(0.5, 12);
  });
  it("computes exactly the median and one-/1.96-sigma exponential bands", () => {
    const cone = projectionCone(100, { mu: 0.02, sigma: 0.1 });
    expect(cone.map(({ day }) => day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const point of cone) {
      const drift = 0.02 * point.day;
      const width = 0.1 * Math.sqrt(point.day);
      expect(point.median).toBeCloseTo(100 * Math.exp(drift), 12);
      expect(point.lower68).toBeCloseTo(100 * Math.exp(drift - width), 12);
      expect(point.upper68).toBeCloseTo(100 * Math.exp(drift + width), 12);
      expect(point.lower95).toBeCloseTo(100 * Math.exp(drift - 1.96 * width), 12);
      expect(point.upper95).toBeCloseTo(100 * Math.exp(drift + 1.96 * width), 12);
    }
    expect(projectionCone(10, { mu: 0, sigma: 0 }, 1)).toEqual([
      { day: 1, median: 10, lower68: 10, upper68: 10, lower95: 10, upper95: 10 },
    ]);
  });
  it("returns half for zero drift and follows the explicit zero-volatility convention", () => {
    expect(probabilityUp({ mu: 0, sigma: 0.2 })).toBe(0.5);
    expect(probabilityUp({ mu: 0, sigma: 0 })).toBe(0.5);
    expect(probabilityUp({ mu: 0.1, sigma: 0 })).toBe(1);
    expect(probabilityUp({ mu: -0.1, sigma: 0 })).toBe(0);
  });
  it.each([
    [1, 0.8413447460685429], [-1, 0.15865525393145707],
    [2, 0.9772498680518208], [3, 0.9986501019683699],
  ])("approximates Phi(%s) within 1e-7", (z, expected) => {
    expect(Math.abs(probabilityUp({ mu: z, sigma: 1 }, 1) - expected)).toBeLessThan(1e-7);
    expect(Math.abs(probabilityUp({ mu: z / Math.sqrt(7), sigma: 1 }) - expected))
      .toBeLessThan(1e-7);
  });
});

describe("votes and crossovers", () => {
  const bands = { upper: 12, middle: 10, lower: 8 };
  it("keeps equality thresholds neutral, with exactly four explained votes", () => {
    for (const rsi14 of [30, 70]) {
      for (const probability of [0.45, 0.55]) {
        for (const close of [8, 12]) {
          const result = summarize({ sma20: 10, sma50: 10, rsi14, probability, close, bands });
          expect(result.label).toBe("Neutral");
          expect(result.score).toBe(0);
          expect(result.votes.map(({ vote }) => vote)).toEqual([0, 0, 0, 0]);
          expect(result.votes.every(({ reason }) => reason.length > 0)).toBe(true);
        }
      }
    }
  });
  it("uses strict directional votes and inclusive score thresholds", () => {
    const bullish = summarize({ sma20: 11, sma50: 10, rsi14: 29, close: 7, bands, probability: 0.56 });
    expect(bullish.score).toBe(4);
    expect(bullish.label).toBe("Bullish");
    expect(bullish.votes.map(({ vote }) => vote)).toEqual([1, 1, 1, 1]);
    const bearish = summarize({ sma20: 9, sma50: 10, rsi14: 71, close: 13, bands, probability: 0.44 });
    expect(bearish.score).toBe(-4);
    expect(bearish.label).toBe("Bearish");
    expect(bearish.votes.map(({ vote }) => vote)).toEqual([-1, -1, -1, -1]);
    expect(summarize({ sma20: 11, sma50: 10, rsi14: 29 }).label).toBe("Bullish");
    expect(summarize({ sma20: 9, sma50: 10, rsi14: 71 }).label).toBe("Bearish");
    expect(summarize({ rsi14: 29 }).label).toBe("Neutral");
  });
  it("marks missing and nonfinite inputs unavailable", () => {
    for (const input of [{}, {
      sma20: Infinity, sma50: 10, rsi14: NaN, close: 10,
      bands: { upper: 12, middle: NaN, lower: 8 }, probability: -Infinity,
    }]) {
      const result = summarize(input);
      expect(result.score).toBe(0);
      expect(result.votes).toHaveLength(4);
      expect(result.votes.every(({ reason }) => reason.includes("Unavailable"))).toBe(true);
    }
  });
  it("tracks the last strict sign, skipping warm-up and equalities", () => {
    expect(crossovers(
      [null, 1, 2, 1, 2, 1, 0, 1, 2],
      [null, 1, 1, 1, 1, 1, 1, 1, 1],
    )).toEqual([{ index: 6, type: "Bearish" }, { index: 8, type: "Bullish" }]);
    expect(crossovers([2, 1, 2], [1, 1, 1])).toEqual([]);
    expect(crossovers([0, 1, 0], [1, 1, 1])).toEqual([]);
    expect(crossovers([null, 2], [1, 1])).toEqual([]);
  });
});

describe("input validation", () => {
  it("rejects invalid periods and nonfinite general series", () => {
    for (const period of [0, -1, 1.5, Infinity, NaN]) {
      expect(() => sma([1, 2], period)).toThrow();
      expect(() => bollinger([1, 2], period)).toThrow();
      expect(() => rsi([1, 2], period)).toThrow();
      expect(() => logReturnStats([1, 2], period)).toThrow();
      expect(() => projectionCone(1, { mu: 0, sigma: 1 }, period)).toThrow();
      expect(() => probabilityUp({ mu: 0, sigma: 1 }, period)).toThrow();
    }
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() => sma([value], 1)).toThrow();
      expect(() => bollinger([value])).toThrow();
      expect(() => rsi([value])).toThrow();
      expect(() => logReturnStats([value])).toThrow();
    }
    expect(() => bollinger([1], 1, -1)).toThrow();
    expect(() => bollinger([1], 1, NaN)).toThrow();
  });
  it("rejects nonpositive log/projection prices and invalid statistics", () => {
    for (const price of [0, -1]) {
      expect(() => logReturnStats([price])).toThrow();
      expect(() => projectionCone(price, { mu: 0, sigma: 0 })).toThrow();
    }
    for (const stats of [{ mu: NaN, sigma: 1 }, { mu: 0, sigma: -1 }, { mu: 0, sigma: Infinity }]) {
      expect(() => probabilityUp(stats)).toThrow();
      expect(() => projectionCone(1, stats)).toThrow();
    }
    expect(() => crossovers([1], [])).toThrow(/aligned/);
    expect(() => crossovers([NaN], [1])).toThrow();
  });
});
