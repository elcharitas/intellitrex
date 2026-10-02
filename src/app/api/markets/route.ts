import { NextResponse } from "next/server";

export async function GET() {
  try {
    // One cached source request supplies prices, 24h changes, and 7-day history.
    const response = await fetch(
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=true",
      { next: { revalidate: 60 }, signal: AbortSignal.timeout(10000) }
    );
    if (!response.ok) throw new Error("Market source unavailable");
    const markets = await response.json();
    if (!Array.isArray(markets) || !markets.length || markets.some((coin) =>
      !coin || typeof coin.id !== "string" || typeof coin.name !== "string" || typeof coin.symbol !== "string"
    )) throw new Error("Invalid market response");

    return NextResponse.json({ markets });
  } catch {
    return NextResponse.json({ error: "Market data unavailable" }, { status: 502 });
  }
}
