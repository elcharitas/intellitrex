"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Brain,
  Shield,
  LineChart,
  Bot,
  Wallet,
  ArrowRight,
} from "lucide-react";

type Market = {
  id: string;
  name: string;
  symbol: string;
  current_price: number | null;
  price_change_percentage_24h: number | null;
  market_cap: number | null;
  total_volume: number | null;
  sparkline_in_7d?: { price: number[] } | null;
  last_updated: string | null;
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function money(value: number | null | undefined, compact = false) {
  if (!finite(value)) return "Unavailable";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: value < 1 ? 6 : 2,
  }).format(value);
}

function Change({ value }: { value: number | null | undefined }) {
  if (!finite(value)) return <span className="text-muted-foreground">Unavailable</span>;
  return (
    <span className={value > 0 ? "text-success" : value < 0 ? "text-danger" : "text-muted-foreground"}>
      {value > 0 ? "+" : ""}{value.toFixed(2)}%
    </span>
  );
}

function MarketChart({ prices, name }: { prices?: number[]; name: string }) {
  if (!Array.isArray(prices) || prices.length < 2 || !prices.every((price) => finite(price) && price > 0)) {
    return <p className="text-sm text-muted-foreground">Seven-day history unavailable</p>;
  }
  const min = Math.min(...prices);
  const span = Math.max(...prices) - min || 1;
  const points = prices.map((price, i) => `${5 + i / (prices.length - 1) * 490},${145 - (price - min) / span * 130}`).join(" ");
  return (
    <svg viewBox="0 0 500 160" className="w-full text-primary" role="img" aria-label={`${name} seven-day price history`}>
      <title>{`${name} seven-day price history from CoinGecko`}</title>
      <polygon points={`5,155 ${points} 495,155`} fill="currentColor" fillOpacity="0.08" />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

const FEATURES = [
  {
    icon: LineChart,
    title: "Live Market Data",
    description:
      "Cryptocurrency prices from CoinGecko, with price history and source-provided daily changes.",
  },
  {
    icon: Brain,
    title: "Market Context",
    description:
      "Compare seven-day price history, market capitalization, trading volume, and daily movers in one place.",
  },
  {
    icon: BarChart3,
    title: "Technical Analysis",
    description:
      "Explore SMA, RSI, Bollinger Bands, and the Fear & Greed Index on the currency dashboard.",
  },
  {
    icon: Bot,
    title: "AI Trading Consultant",
    description:
      "Chat with an AI advisor in 3 modes: Risk-Averse, Active Trader, or Learning. Personalized insights.",
  },
  {
    icon: Wallet,
    title: "Portfolio Analysis",
    description:
      "Connect your Binance account from your profile to review your supported cryptocurrency holdings.",
  },
  {
    icon: Shield,
    title: "Education First",
    description:
      "Understand market data and the methods behind indicators. Analytics are information, not financial advice.",
  },
];

export default function LandingPage() {
  const [markets, setMarkets] = useState<Market[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/markets", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Market request failed");
        const data = await response.json();
        if (!Array.isArray(data.markets) || !data.markets.length) throw new Error("Market data missing");
        if (!controller.signal.aborted) setMarkets(data.markets);
      })
      .catch(() => {
        if (!controller.signal.aborted) setUnavailable(true);
      });
    return () => controller.abort();
  }, []);

  const status = unavailable ? "Market data unavailable. Please try again later." : "Loading market data…";
  const bitcoin = markets?.find((coin) => coin.id === "bitcoin");
  const movers: [string, Market[]][] = [
    ["Gainers", markets?.filter((coin) => finite(coin.price_change_percentage_24h) && coin.price_change_percentage_24h > 0)
      .sort((a, b) => b.price_change_percentage_24h! - a.price_change_percentage_24h!).slice(0, 3) ?? []],
    ["Decliners", markets?.filter((coin) => finite(coin.price_change_percentage_24h) && coin.price_change_percentage_24h < 0)
      .sort((a, b) => a.price_change_percentage_24h! - b.price_change_percentage_24h!).slice(0, 3) ?? []],
  ];

  return (
    <div className="min-h-screen">
      {/* One snapshot feeds every market section; this strip scrolls locally. */}
      <section aria-label="Market ticker" className="overflow-x-auto border-b border-border bg-card">
        {markets ? (
          <div className="flex w-max min-w-full divide-x divide-border">
            {markets.map((coin) => (
              <div key={coin.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <span className="font-semibold uppercase">{coin.symbol}</span>
                <span>{money(coin.current_price)}</span>
                <Change value={coin.price_change_percentage_24h} />
              </div>
            ))}
          </div>
        ) : <p className="px-6 py-3 text-sm text-muted-foreground" role="status">{status}</p>}
      </section>

      {/* Hero */}
      <section className="py-12 px-4 sm:py-20 sm:px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div className="min-w-0">
              <p className="mb-4 text-sm font-semibold uppercase tracking-wider text-primary">IntelliTrex market overview</p>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-foreground leading-tight">
                Markets first. Decisions informed.
              </h1>
              <p className="mt-6 text-lg text-muted-foreground max-w-xl">
                Start with what the market is doing. Explore real cryptocurrency prices,
                compare daily movers, and put price history in context.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-4">
                <Link
                  href="/currency"
                  className="inline-flex items-center justify-center px-8 py-3.5 bg-foreground text-background rounded-full font-medium hover:opacity-90 transition-opacity"
                >
                  Explore Markets
                </Link>
                <Link
                  href="/consultancy"
                  className="inline-flex items-center justify-center px-8 py-3.5 border border-border rounded-full font-medium text-foreground hover:bg-muted transition-colors"
                >
                  Talk to AI Advisor
                </Link>
              </div>
            </div>
            <div className="min-w-0 rounded-3xl border border-border bg-card p-6 sm:p-8">
              <h2 className="text-lg font-semibold">Bitcoin <span className="text-muted-foreground">/ USD</span></h2>
              {bitcoin ? (
                <>
                  <div className="mt-4 flex flex-wrap items-baseline gap-3">
                    <p className="text-3xl sm:text-4xl font-bold">{money(bitcoin.current_price)}</p>
                    <p className="text-sm"><Change value={bitcoin.price_change_percentage_24h} /> <span className="text-muted-foreground">24h</span></p>
                  </div>
                  <div className="mt-6">
                    <MarketChart prices={bitcoin.sparkline_in_7d?.price} name="Bitcoin" />
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Seven-day history · CoinGecko snapshot
                    {bitcoin.last_updated && Number.isFinite(Date.parse(bitcoin.last_updated))
                      ? ` · Updated ${new Date(bitcoin.last_updated).toLocaleString("en-GB", { timeZone: "UTC" })} UTC`
                      : " · Source timestamp unavailable"}
                  </p>
                </>
              ) : <p className="mt-6 text-muted-foreground" role="status">{markets ? "Bitcoin data unavailable." : status}</p>}
            </div>
          </div>
        </div>
      </section>

      {/* Market summary */}
      <section className="py-8 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-2xl font-bold">Market summary</h2>
          <p className="mt-2 mb-6 text-sm text-muted-foreground">
            Leading markets by capitalization · USD · CoinGecko data cached for 60 seconds · Refresh the page for a new snapshot.
          </p>
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            {markets ? (
              <table className="w-full min-w-[720px] text-sm">
                <caption className="sr-only">Market prices, 24-hour changes, capitalization, volume, and seven-day history</caption>
                <thead className="border-b border-border text-muted-foreground">
                  <tr>
                    {["Currency", "Price", "24h change", "Market cap", "24h volume", "7-day history"].map((heading) => (
                      <th key={heading} scope="col" className="px-4 py-4 text-left font-medium">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {markets.map((coin) => (
                    <tr key={coin.id}>
                      <th scope="row" className="px-4 py-3 text-left font-medium">{coin.name} <span className="text-xs uppercase text-muted-foreground">{coin.symbol}</span></th>
                      <td className="px-4 py-3 whitespace-nowrap">{money(coin.current_price)}</td>
                      <td className="px-4 py-3 whitespace-nowrap"><Change value={coin.price_change_percentage_24h} /></td>
                      <td className="px-4 py-3">{money(coin.market_cap, true)}</td>
                      <td className="px-4 py-3">{money(coin.total_volume, true)}</td>
                      <td className="w-36 px-4 py-3"><MarketChart prices={coin.sparkline_in_7d?.price} name={coin.name} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="p-6 text-muted-foreground" role="status">{status}</p>}
          </div>
        </div>
      </section>

      {/* Top movers */}
      <section className="py-12 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-2xl font-bold">Top movers</h2>
          <p className="mt-2 mb-6 text-sm text-muted-foreground">Among the markets shown, ranked by source-provided 24-hour change.</p>
          <div className="grid gap-6 md:grid-cols-2">
            {movers.map(([title, coins]) => (
              <div key={title} className="min-w-0 rounded-2xl border border-border bg-card p-6">
                <h3 className="mb-4 font-semibold">{title}</h3>
                {markets ? (
                  coins.length ? <ul className="space-y-4">
                    {coins.map((coin) => (
                      <li key={coin.id} className="flex flex-wrap justify-between gap-2 text-sm">
                        <span>{coin.name} <span className="uppercase text-muted-foreground">{coin.symbol}</span></span>
                        <Change value={coin.price_change_percentage_24h} />
                      </li>
                    ))}
                  </ul> : <p className="text-sm text-muted-foreground">No {title.toLowerCase()} in this snapshot.</p>
                ) : <p className="text-sm text-muted-foreground" role="status">{status}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground">
              Everything You Need for Informed Trading
            </h2>
            <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
              Move from a market overview to price history, technical indicators,
              and educational tools.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="bg-card rounded-2xl p-8 border border-border hover:border-primary/30 transition-colors"
                >
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                    <Icon className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
            Ready to Trade Smarter?
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Start exploring AI-powered market insights and make data-driven decisions today.
          </p>
          <Link
            href="/currency"
            className="inline-flex items-center gap-2 px-8 py-3.5 bg-primary text-primary-foreground rounded-full font-medium hover:opacity-90 transition-opacity"
          >
            Launch Dashboard <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* Disclaimer */}
      <section className="py-12 px-6 border-t border-border">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong>Disclaimer:</strong> Intellitrex is a research and analytics platform for
            educational purposes. We do not provide financial advice. All trading and
            investment decisions are made at your own risk. Cryptocurrency markets are
            volatile and past performance does not guarantee future results. Always do your
            own research before making investment decisions. By using this platform, you
            acknowledge that Intellitrex and Reallytics AI are not responsible for any
            financial losses.
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            Built by{" "}
            <a
              href="https://github.com/reallyticsai"
              className="text-primary hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Reallytics AI
            </a>{" "}
            &middot; {new Date().getFullYear()}
          </p>
        </div>
      </section>
    </div>
  );
}
