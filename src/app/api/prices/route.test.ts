import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TIME_RANGES } from "@/lib/constants";
import { GET } from "./route";

const day = 86_400_000;
const now = Date.UTC(2026, 9, 2, 12);
const boundary = Date.UTC(2026, 9, 2);
const dailyFixture = Array.from({ length: 91 }, (_, i) => [boundary - (90 - i) * day, 100 + i]);
const fetchSource = vi.fn<typeof fetch>();
const request = (query = "") => new NextRequest(`http://localhost/api/prices?${query}`);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubGlobal("fetch", fetchSource);
  fetchSource.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("price data contract", () => {
  it("keeps source OHLC values and the full requested window without fabricated volume", async () => {
    const source = [[boundary - day, 100, 105, 95, 102], [boundary, 102, 110, 99, 108]];
    fetchSource.mockResolvedValueOnce(Response.json(source));
    const response = await GET(request("pair=XETHZUSD&interval=1440&limit=7"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      pair: "XETHZUSD",
      candles: [
        { time: (boundary - day) / 1000, open: 100, high: 105, low: 95, close: 102, volume: null },
        { time: boundary / 1000, open: 102, high: 110, low: 99, close: 108, volume: null },
      ],
    });
    expect(fetchSource).toHaveBeenCalledOnce();
    expect(fetchSource.mock.calls[0][0]).toContain("/ethereum/ohlc?vs_currency=usd&days=7");
    expect(fetchSource.mock.calls[0][1]).toMatchObject({ next: { revalidate: 60 } });
  });

  it.each(TIME_RANGES)("preserves supported window $label", async (range) => {
    fetchSource.mockResolvedValueOnce(Response.json([[boundary, 100, 105, 95, 102]]));
    const response = await GET(request(`interval=${range.interval}&limit=${range.limit}`));
    expect(response.status).toBe(200);
    const days = range.label === "24H" ? "1" : range.label === "ALL" ? "max" : String(range.limit);
    expect(fetchSource.mock.calls[0][0]).toContain(`/ohlc?vs_currency=usd&days=${days}`);
    expect(fetchSource).toHaveBeenCalledOnce();
  });

  it("requests sufficient daily history independently of a short display range", async () => {
    fetchSource.mockResolvedValueOnce(Response.json({
      prices: [...dailyFixture, [boundary, 999], [now, 200]],
    }));
    const response = await GET(request("pair=XXBTZUSD&resolution=daily&limit=7"));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(Object.keys(data).sort()).toEqual(["candles", "pair"]);
    expect(data.candles).toHaveLength(91);
    expect(data.candles.at(-1)).toEqual({
      time: boundary / 1000, close: 190, open: null, high: null, low: null, volume: null,
    });
    expect(fetchSource).toHaveBeenCalledOnce();
    expect(fetchSource.mock.calls[0][0]).toContain("market_chart?vs_currency=usd&days=365&interval=daily");
  });

  it.each(["UNKNOWN", "constructor", "toString", "__proto__"])("rejects unsupported pair %s before a source request", async (pair) => {
    const response = await GET(request(`pair=${pair}`));
    expect(response.status).toBe(400);
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it.each([
    "interval=1440&limit=7%26vs_currency%3Deur",
    "interval=1440&limit=NaN",
    "interval=30&limit=7",
    "interval=60&limit=7",
    "interval=1440&limit=999999",
    "resolution=hourly",
    "resolution=daily%26vs_currency%3Deur",
  ])("rejects unsupported or injected window inputs: %s", async (query) => {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it("returns an honest error on rate limits rather than manufacturing fallback candles", async () => {
    fetchSource.mockResolvedValueOnce(Response.json({ error: "rate limited" }, { status: 429 }));
    const response = await GET(request("interval=60&limit=24"));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Price data unavailable" });
    expect(fetchSource).toHaveBeenCalledOnce();
  });

  it.each([
    { prices: dailyFixture.slice(1) },
    { prices: dailyFixture.filter((_, i) => i !== 40) },
    { prices: [[boundary, 0]] },
    { prices: null },
  ])("rejects insufficient, gapped or malformed daily history: %j", async (source) => {
    fetchSource.mockResolvedValueOnce(Response.json(source));
    const response = await GET(request("resolution=daily"));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Daily history unavailable" });
  });

  it.each([[], [[boundary, 1, null, 1, 1]], { prices: dailyFixture }])("rejects malformed OHLC: %j", async (source) => {
    fetchSource.mockResolvedValueOnce(Response.json(source));
    expect((await GET(request())).status).toBe(502);
  });

  it("handles transport failures without returning zero prices", async () => {
    fetchSource.mockRejectedValueOnce(new Error("offline"));
    const response = await GET(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Price data unavailable" });
  });
});
