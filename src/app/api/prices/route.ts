import { NextRequest, NextResponse } from "next/server";
import { normalizeDailyPrices } from "@/lib/signals";
import { TIME_RANGES } from "@/lib/constants";

// Map our pair IDs to CoinGecko IDs
const PAIR_TO_COINGECKO: Record<string, string> = {
  XXBTZUSD: "bitcoin",
  XETHZUSD: "ethereum",
  SOLUSD: "solana",
  XXRPZUSD: "ripple",
  ARBUSD: "arbitrum",
  DOTUSD: "polkadot",
  LINKUSD: "chainlink",
  KSMUSD: "kusama",
  PYTHUSD: "pyth-network",
  SUIUSD: "sui",
};

export async function GET(req: NextRequest) {
  const pair = req.nextUrl.searchParams.get("pair") || "XXBTZUSD";
  const interval = req.nextUrl.searchParams.get("interval") || "1440";
  const limit = req.nextUrl.searchParams.get("limit") || "30";
  const resolution = req.nextUrl.searchParams.get("resolution");
  const daily = resolution === "daily";

  if (!Object.hasOwn(PAIR_TO_COINGECKO, pair)) {
    return NextResponse.json({ error: "Unsupported currency pair" }, { status: 400 });
  }
  const coinId = PAIR_TO_COINGECKO[pair];
  if (resolution !== null && !daily) {
    return NextResponse.json({ error: "Unsupported resolution" }, { status: 400 });
  }

  // Daily history is independent of the display window and includes indicator warm-up.
  let days = "365";
  if (!daily) {
    const range = TIME_RANGES.find((range) => range.interval === interval && String(range.limit) === limit);
    if (!range) return NextResponse.json({ error: "Unsupported chart range" }, { status: 400 });
    days = range.interval === "60" ? "1" : range.limit > 365 ? "max" : String(range.limit);
  }

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}/${daily ? "market_chart" : "ohlc"}?vs_currency=usd&days=${days}${daily ? "&interval=daily" : ""}`,
      { next: { revalidate: 60 }, signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) throw new Error("Price source unavailable");
    const data = await res.json();

    if (daily) {
      if (!Array.isArray(data.prices)) throw new Error("Daily prices missing");
      const history = normalizeDailyPrices(data.prices, Date.now());
      if (history.length < 91) throw new Error("Insufficient daily history");
      // A close-only observation does not supply an open, high, low, or volume.
      const candles = history.map((point) => ({
        ...point, open: null, high: null, low: null, volume: null,
      }));
      return NextResponse.json({ pair, candles });
    }

    if (!Array.isArray(data) || !data.length || data.some((point) =>
      !Array.isArray(point) || point.length !== 5 ||
      point.some((value) => typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    )) throw new Error("Invalid OHLC response");

    // CoinGecko OHLC format: [[timestamp, open, high, low, close], ...]
    const candles = data.map(
      (c: [number, number, number, number, number]) => ({
        time: Math.floor(c[0] / 1000),
        open: c[1],
        high: c[2],
        low: c[3],
        close: c[4],
        volume: null,
      })
    );

    return NextResponse.json({ pair, candles });
  } catch {
    return NextResponse.json({ error: daily ? "Daily history unavailable" : "Price data unavailable" }, { status: 502 });
  }
}
