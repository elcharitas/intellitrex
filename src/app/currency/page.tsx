"use client";

import { useState, useEffect, useMemo } from "react";
import { SUPPORTED_COINS, TIME_RANGES } from "@/lib/constants";
import { TrendingUp, TrendingDown, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { sma, bollinger, rsi, logReturnStats, projectionCone, probabilityUp, summarize, crossovers } from "@/lib/signals";

type Candle = {
  time: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
};

type FearGreed = {
  current: { value: number; classification: string };
  yesterday: { value: number; classification: string };
  lastWeek: { value: number; classification: string };
  lastMonth: { value: number; classification: string };
};

function useCandles(url: string) {
  const [result, setResult] = useState<{ url: string; candles: Candle[]; error: string | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Price request failed");
        const data = await response.json();
        if (!Array.isArray(data.candles) || !data.candles.length || data.candles.some((point: Candle) =>
          !point || !Number.isFinite(point.time) || !Number.isFinite(point.close) || point.close <= 0
        )) throw new Error("Invalid price data");
        // The API selects the time window; never truncate it by candle count.
        if (!controller.signal.aborted) setResult({ url, candles: data.candles, error: null });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ url, candles: [], error: "Price data unavailable. Please try again later." });
      });
    return () => controller.abort();
  }, [url]);
  const current = result?.url === url ? result : null;
  return { candles: current?.candles ?? [], error: current?.error, loading: !current };
}

function formatPrice(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price)) return "Unavailable";
  if (price >= 1000) return `$${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  return `$${price.toFixed(4)}`;
}

function FearGreedGauge({ value, label }: { value: number; label: string }) {
  const getColor = (v: number) => {
    if (v <= 25) return "bg-danger text-white";
    if (v <= 45) return "bg-red-300 text-red-900";
    if (v <= 55) return "bg-yellow-300 text-yellow-900";
    if (v <= 75) return "bg-green-300 text-green-900";
    return "bg-success text-white";
  };
  const getLabel = (v: number) => {
    if (v <= 25) return "Extreme Fear";
    if (v <= 45) return "Fear";
    if (v <= 55) return "Neutral";
    if (v <= 75) return "Greed";
    return "Extreme Greed";
  };
  return (
    <div
      className={cn(
        "rounded-xl p-3 text-center min-w-[100px]",
        getColor(value)
      )}
    >
      <p className="text-xs font-medium opacity-80">{label}</p>
      <p className="text-xl font-bold">{value}%</p>
      <p className="text-xs font-medium">{getLabel(value)}</p>
    </div>
  );
}

export default function CurrencyPage() {
  const [selectedCoin, setSelectedCoin] = useState(SUPPORTED_COINS[0] as typeof SUPPORTED_COINS[number]);
  const [timeRange, setTimeRange] = useState(TIME_RANGES[1]);
  const [fearGreed, setFearGreed] = useState<FearGreed | null>(null);
  const [fearGreedError, setFearGreedError] = useState(false);
  const [showSMA, setShowSMA] = useState(true);
  const [showRSI, setShowRSI] = useState(false);
  const [showBollinger, setShowBollinger] = useState(true);
  const [showCone, setShowCone] = useState(false);
  const [hover, setHover] = useState<{ url: string; index: number } | null>(null);
  const chartUrl = `/api/prices?pair=${selectedCoin.krakenPair}&interval=${timeRange.interval}&limit=${timeRange.limit}`;
  const { candles, loading, error } = useCandles(chartUrl);
  const history = useCandles(`/api/prices?pair=${selectedCoin.krakenPair}&resolution=daily`);
  const daily = history.candles;

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/fear-greed", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Sentiment unavailable");
        const data = await response.json();
        if (![data.current, data.yesterday, data.lastWeek, data.lastMonth].every((entry) =>
          entry && Number.isFinite(entry.value) && entry.value >= 0 && entry.value <= 100
        )) throw new Error("Invalid sentiment data");
        if (!controller.signal.aborted) setFearGreed(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFearGreedError(true);
      });
    return () => controller.abort();
  }, []);

  const signals = useMemo(() => {
    const closes = daily.map((point) => point.close);
    const fast = sma(closes, 20);
    const slow = sma(closes, 50);
    const bands = bollinger(closes);
    const strength = rsi(closes);
    const stats = logReturnStats(closes);
    const probability = stats ? probabilityUp(stats) : null;
    const series = daily.map((point, i) => ({
      ...point, fast: fast[i - 19] ?? null, slow: slow[i - 49] ?? null,
      upper: bands.upper[i - 19] ?? null, middle: bands.middle[i - 19] ?? null,
      lower: bands.lower[i - 19] ?? null, strength: strength[i - 14] ?? null,
    }));
    const last = series.at(-1);
    const cone = stats && last ? projectionCone(last.close, stats).map((point) => ({
      ...point, time: last.time + point.day * 86400,
    })) : [];
    const markers = crossovers(series.map((point) => point.fast), series.map((point) => point.slow))
      .map((cross) => ({ ...cross, time: series[cross.index].time, price: series[cross.index].fast! }));
    const summary = summarize({
      sma20: last?.fast, sma50: last?.slow, rsi14: last?.strength, close: last?.close, probability,
      bands: last?.upper != null ? { upper: last.upper, middle: last.middle!, lower: last.lower! } : null,
    });
    return { series, last, cone, probability, markers, summary };
  }, [daily]);

  const latestCandle = candles[candles.length - 1];
  const firstCandle = candles[0];
  const priceChange =
    latestCandle && firstCandle
      ? ((latestCandle.close - firstCandle.close) / firstCandle.close) * 100
      : null;
  const highs = candles.map((c) => c.high).filter((value): value is number => value !== null && Number.isFinite(value));
  const lows = candles.map((c) => c.low).filter((value): value is number => value !== null && Number.isFinite(value));
  const highOfDay = highs.length ? Math.max(...highs) : null;
  const lowOfDay = lows.length ? Math.min(...lows) : null;
  const startTime = firstCandle?.time ?? 0;
  const lastTime = latestCandle?.time ?? 0;
  const inWindow = (point: { time: number }) => point.time >= startTime && point.time <= lastTime;
  const visibleSignals = signals.series.filter(inWindow);
  const coneReady = !!latestCandle && signals.cone.length === 7 && signals.cone[0].time > lastTime;
  const cone = showCone && coneReady ? signals.cone : [];
  const endTime = cone.at(-1)?.time ?? lastTime;
  const historyMessage = history.loading ? "Loading daily signal history…"
    : history.error ? "Daily signal history unavailable. Please try again later." : null;

  // Chart dimensions with padding for axes
  const padL = 70; // left padding for Y-axis labels
  const padB = 30; // bottom padding for X-axis labels
  const padR = 10;
  const padT = 10;
  const svgW = 700;
  const svgH = 340;
  const chartW = svgW - padL - padR;
  const chartH = svgH - padB - padT;

  // Only visible overlays affect the price scale, not off-screen daily history.
  const visiblePrices = [
    ...candles.flatMap((c) => [c.low ?? c.close, c.high ?? c.close]),
    ...(showSMA ? visibleSignals.flatMap((point) => [point.fast, point.slow]) : []),
    ...(showBollinger ? visibleSignals.flatMap((point) => [point.upper, point.lower]) : []),
    ...cone.flatMap((point) => [point.lower95, point.upper95]),
  ].filter((value): value is number => value !== null && Number.isFinite(value));
  const minPrice = visiblePrices.length ? Math.min(...visiblePrices) * 0.995 : 0;
  const maxPrice = visiblePrices.length ? Math.max(...visiblePrices) * 1.005 : 1;
  const priceRange = maxPrice - minPrice || 1;

  // Candles, daily indicators, and projections share a Unix-time scale.
  const toX = (time: number) => padL + (time - startTime) / Math.max(endTime - startTime, 1) * chartW;
  const toY = (price: number) =>
    padT + chartH - ((price - minPrice) / priceRange) * chartH;

  // Y-axis tick values (5 ticks)
  const yTicks = Array.from({ length: 5 }, (_, i) => minPrice + (priceRange * i) / 4);

  // UTC axis includes the explicitly labelled future extension when the cone is on.
  const xLabels = candles.length > 1
    ? Array.from({ length: 6 }, (_, i) => {
        const time = startTime + (endTime - startTime) * i / 5;
        const d = new Date(time * 1000);
        return {
          x: toX(time),
          label: timeRange.interval === "60" && !cone.length
            ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })
            : d.toLocaleDateString("en-GB", { month: "short", day: "numeric", timeZone: "UTC", year: timeRange.limit >= 365 ? "2-digit" : undefined }),
        };
      })
    : [];

  const priceLine =
    candles.length > 1
      ? candles.map((c) => `${toX(c.time)},${toY(c.close)}`).join(" ")
      : "";

  const signalLine = (key: "fast" | "slow" | "upper" | "middle" | "lower") => visibleSignals
    .filter((point) => point[key] !== null)
    .map((point) => `${toX(point.time)},${toY(point[key]!)}`).join(" ");
  const lastRSI = signals.last?.strength ?? null;
  const hoverCandle = hover?.url === chartUrl ? candles[hover.index] : undefined;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (candles.length < 2) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * svgW;
    const dataX = mouseX - padL;
    const time = startTime + dataX / chartW * (endTime - startTime);
    if (dataX < 0 || time > lastTime) { setHover(null); return; }
    const index = candles.reduce((nearest, candle, i) =>
      Math.abs(candle.time - time) < Math.abs(candles[nearest].time - time) ? i : nearest, 0);
    setHover((current) => current?.url === chartUrl && current.index === index ? current : { url: chartUrl, index });
  };

  return (
    <div className="min-h-screen py-8 px-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-foreground mb-8">Currency</h1>

        <div className="grid lg:grid-cols-5 gap-6">
          {/* Left: Chart area */}
          <div className="lg:col-span-3 space-y-6">
            {/* Coin selector + time range */}
            <div className="bg-card rounded-2xl p-6 border border-border">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <div>
                  <label className="text-sm text-muted-foreground">Select Currency</label>
                  <select
                    value={selectedCoin.id}
                    onChange={(e) => {
                      const coin = SUPPORTED_COINS.find((c) => c.id === e.target.value);
                      if (coin) setSelectedCoin(coin);
                    }}
                    className="ml-3 px-4 py-2 rounded-lg border border-border bg-card text-foreground text-sm"
                  >
                    {SUPPORTED_COINS.map((coin) => (
                      <option key={coin.id} value={coin.id}>
                        {coin.name} ({coin.symbol})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
                  {TIME_RANGES.map((tr) => (
                    <button
                      key={tr.label}
                      onClick={() => setTimeRange(tr)}
                      className={cn(
                        "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                        timeRange.label === tr.label
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {tr.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Price badges */}
              {latestCandle && priceChange !== null && (
                <div className="flex items-center gap-3 mb-4">
                  <span
                    className={cn(
                      "px-3 py-1 rounded-full text-xs font-medium",
                      priceChange >= 0
                        ? "bg-success/10 text-success"
                        : "bg-danger/10 text-danger"
                    )}
                  >
                    {priceChange >= 0 ? (
                      <TrendingUp className="w-3 h-3 inline mr-1" />
                    ) : (
                      <TrendingDown className="w-3 h-3 inline mr-1" />
                    )}
                    {priceChange.toFixed(1)}%
                  </span>
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
                    {formatPrice(latestCandle.close)}
                  </span>
                </div>
              )}

              {/* SVG Chart */}
              <div className="relative w-full bg-muted/30 rounded-xl overflow-hidden" style={{ aspectRatio: `${svgW}/${svgH}` }}>
                {loading ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Activity className="w-8 h-8 text-muted-foreground animate-pulse" />
                  </div>
                ) : error ? (
                  <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted-foreground" role="status">{error}</p>
                ) : (
                  <svg
                    viewBox={`0 0 ${svgW} ${svgH}`}
                    className="w-full h-full"
                    preserveAspectRatio="xMidYMid meet"
                    role="img"
                    aria-label={`${selectedCoin.symbol} price and signal chart`}
                    onMouseMove={handleMouseMove}
                    onMouseLeave={() => setHover(null)}
                  >
                    {/* Y-axis labels + grid lines */}
                    {yTicks.map((price, i) => (
                      <g key={`y-${i}`}>
                        <line
                          x1={padL}
                          y1={toY(price)}
                          x2={svgW - padR}
                          y2={toY(price)}
                          stroke="currentColor"
                          strokeOpacity={0.08}
                        />
                        <text
                          x={padL - 6}
                          y={toY(price) + 3}
                          textAnchor="end"
                          fill="currentColor"
                          fillOpacity={0.4}
                          fontSize="9"
                          fontFamily="system-ui"
                        >
                          {price >= 1000
                            ? `$${(price / 1000).toFixed(1)}K`
                            : price >= 1
                            ? `$${price.toFixed(1)}`
                            : `$${price.toFixed(4)}`}
                        </text>
                      </g>
                    ))}

                    {/* X-axis date labels */}
                    {xLabels.map((lbl, i) => (
                      <text
                        key={`x-${i}`}
                        x={lbl.x}
                        y={svgH - 6}
                        textAnchor={i === 0 ? "start" : i === xLabels.length - 1 ? "end" : "middle"}
                        fill="currentColor"
                        fillOpacity={0.4}
                        fontSize="9"
                        fontFamily="system-ui"
                      >
                        {lbl.label}
                      </text>
                    ))}

                    {/* Bollinger band fill */}
                    {showBollinger && signalLine("upper") && (() => {
                      const upper = signalLine("upper");
                      const lower = signalLine("lower");
                      const fillPoly = `${upper} ${lower.split(" ").reverse().join(" ")}`;
                      return (
                        <>
                          <polygon points={fillPoly} fill="#a78bfa" fillOpacity="0.06" />
                          <polyline aria-label="Bollinger upper" points={upper} fill="none" stroke="#22c55e" strokeWidth="1.2" />
                          <polyline aria-label="Bollinger middle" points={signalLine("middle")} fill="none" stroke="#a78bfa" strokeWidth="1.2" />
                          <polyline aria-label="Bollinger lower" points={lower} fill="none" stroke="#ef4444" strokeWidth="1.2" />
                          {visibleSignals.length === 1 && (["upper", "middle", "lower"] as const).map((key) => (
                            <circle key={key} cx={toX(visibleSignals[0].time)} cy={toY(visibleSignals[0][key]!)} r="3" fill="#a78bfa" />
                          ))}
                        </>
                      );
                    })()}

                    {/* Price line */}
                    {priceLine && (
                      <>
                        <defs>
                          <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.15" />
                            <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        <polygon
                          points={`${priceLine} ${toX(lastTime)},${padT + chartH} ${toX(startTime)},${padT + chartH}`}
                          fill="url(#priceGrad)"
                        />
                        <polyline aria-label="Observed price" points={priceLine} fill="none" stroke="#22c55e" strokeWidth="2" />
                      </>
                    )}

                    {/* Daily SMA lines and strict crossover markers */}
                    {showSMA && (
                      <>
                        {(["fast", "slow"] as const).map((key) => (
                          <g key={key} aria-label={key === "fast" ? "SMA 20" : "SMA 50"}>
                            <polyline points={signalLine(key)} fill="none" stroke={key === "fast" ? "#f59e0b" : "#5b7cfa"} strokeWidth="1.5" />
                            {visibleSignals.length === 1 && visibleSignals[0][key] !== null && (
                              <circle cx={toX(visibleSignals[0].time)} cy={toY(visibleSignals[0][key]!)} r="3" fill={key === "fast" ? "#f59e0b" : "#5b7cfa"} />
                            )}
                          </g>
                        ))}
                        {signals.markers.filter(inWindow).map((marker) => (
                          <circle key={marker.time} aria-label={`${marker.type} SMA crossover`} cx={toX(marker.time)} cy={toY(marker.price)} r="4" fill={marker.type === "Bullish" ? "#22c55e" : "#ef4444"}>
                            <title>{`${marker.type} SMA crossover · ${new Date(marker.time * 1000).toISOString()}`}</title>
                          </circle>
                        ))}
                      </>
                    )}

                    {/* Projection points occupy real future days, not candle slots. */}
                    {cone.length > 0 && (
                      <>
                        {(["95", "68"] as const).map((band) => (
                          <polygon key={band} aria-label={`${band}% probability band`}
                            points={[...cone.map((point) => `${toX(point.time)},${toY(point[`upper${band}`])}`),
                              ...[...cone].reverse().map((point) => `${toX(point.time)},${toY(point[`lower${band}`])}`)].join(" ")}
                            fill="#5b7cfa" fillOpacity={band === "95" ? 0.08 : 0.18} />
                        ))}
                        <polyline aria-label="Projection median" points={cone.map((point) => `${toX(point.time)},${toY(point.median)}`).join(" ")} fill="none" stroke="#5b7cfa" strokeWidth="2" strokeDasharray="6 3" />
                        <line x1={toX(lastTime)} x2={toX(lastTime)} y1={padT} y2={padT + chartH} stroke="currentColor" strokeOpacity="0.3" strokeDasharray="3 3" />
                      </>
                    )}

                    {/* Hover crosshair + tooltip */}
                    {hoverCandle && (
                      <>
                        <line
                          x1={toX(hoverCandle.time)}
                          y1={padT}
                          x2={toX(hoverCandle.time)}
                          y2={padT + chartH}
                          stroke="currentColor"
                          strokeOpacity={0.2}
                          strokeDasharray="3 3"
                        />
                        <circle
                          cx={toX(hoverCandle.time)}
                          cy={toY(hoverCandle.close)}
                          r="4"
                          fill="#22c55e"
                          stroke="white"
                          strokeWidth="1.5"
                        />
                        <rect
                          x={Math.min(toX(hoverCandle.time) - 55, svgW - padR - 115)}
                          y={Math.max(toY(hoverCandle.close) - 42, padT)}
                          width="110"
                          height="36"
                          rx="6"
                          fill="var(--card, #1a1d2e)"
                          stroke="var(--border, #2a2f45)"
                          strokeWidth="1"
                        />
                        <text
                          x={Math.min(toX(hoverCandle.time), svgW - padR - 60)}
                          y={Math.max(toY(hoverCandle.close) - 26, padT + 14)}
                          textAnchor="middle"
                          fill="var(--foreground, #e2e8f0)"
                          fontSize="10"
                          fontWeight="600"
                          fontFamily="system-ui"
                        >
                          {formatPrice(hoverCandle.close)}
                        </text>
                        <text
                          x={Math.min(toX(hoverCandle.time), svgW - padR - 60)}
                          y={Math.max(toY(hoverCandle.close) - 12, padT + 28)}
                          textAnchor="middle"
                          fill="var(--muted-foreground, #94a3b8)"
                          fontSize="8"
                          fontFamily="system-ui"
                        >
                          {new Date(hoverCandle.time * 1000).toLocaleString("en-GB", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: "UTC",
                          })}
                        </text>
                      </>
                    )}
                  </svg>
                )}
              </div>

              {showRSI && !loading && !error && (
                <div className="mt-4">
                  <p className="mb-2 text-xs text-muted-foreground">RSI 14 · Daily observations · Same UTC time axis</p>
                  {visibleSignals.some((point) => point.strength !== null) ? (
                    <svg viewBox="0 0 700 140" className="w-full" role="img" aria-label="RSI 14 daily chart">
                      {([30, 70] as const).map((value) => (
                        <g key={value}>
                          <text x={padL - 6} y={15 + (100 - value) * 1.1} textAnchor="end" fill="currentColor" fontSize="10">{value}</text>
                          <line x1={padL} x2={svgW - padR} y1={15 + (100 - value) * 1.1} y2={15 + (100 - value) * 1.1} stroke="currentColor" strokeOpacity="0.15" strokeDasharray="3 3" />
                        </g>
                      ))}
                      <polyline points={visibleSignals.filter((point) => point.strength !== null)
                        .map((point) => `${toX(point.time)},${15 + (100 - point.strength!) * 1.1}`).join(" ")}
                        fill="none" stroke="#5b7cfa" strokeWidth="2" />
                      {visibleSignals.filter((point) => point.strength !== null).map((point) => (
                        <circle key={point.time} cx={toX(point.time)} cy={15 + (100 - point.strength!) * 1.1} r="2" fill="#5b7cfa" />
                      ))}
                    </svg>
                  ) : <p className="text-sm text-muted-foreground">No completed daily RSI observation in this window.</p>}
                </div>
              )}

              {/* Indicator toggles */}
              <div className="flex flex-wrap gap-3 mt-4">
                {[
                  { label: "SMA crossover", active: showSMA, toggle: () => setShowSMA(!showSMA), color: "bg-yellow-500" },
                  { label: "RSI 14", active: showRSI, toggle: () => setShowRSI(!showRSI), color: "bg-blue-500" },
                  {
                    label: "Bollinger",
                    active: showBollinger,
                    toggle: () => setShowBollinger(!showBollinger),
                    color: "bg-purple-500",
                  },
                  { label: "Probability cone", active: showCone, toggle: () => setShowCone(!showCone), color: "bg-primary" },
                ].map((ind) => (
                  <button
                    key={ind.label}
                    onClick={ind.toggle}
                    aria-pressed={ind.active}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                      ind.active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <span className={cn("inline-block w-2 h-2 rounded-full mr-1.5", ind.color)} />
                    {ind.label}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {timeRange.label} historical window · UTC · Daily SMA 20 (amber), SMA 50 (blue), Bollinger bands.
                {cone.length > 0 ? " + 7-day statistical projection (not a guarantee)." : ""}
              </p>
              {historyMessage && <p className="mt-3 text-sm text-muted-foreground" role="status">{historyMessage}</p>}
              {showCone && !historyMessage && !coneReady && <p className="mt-3 text-sm text-muted-foreground">Projection unavailable: no current daily anchor for this chart.</p>}
            </div>

            {/* Bollinger Bands display */}
            {showBollinger && (
              <div className="bg-card rounded-2xl p-6 border border-border">
                <h3 className="font-semibold text-foreground mb-4">Bollinger Bands (20 daily closes, 2σ)</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {[
                    {
                      label: "Upper Bound",
                      value: signals.last?.upper,
                    },
                    {
                      label: "Lower Bound",
                      value: signals.last?.lower,
                    },
                    {
                      label: "20 Day SMA",
                      value: signals.last?.middle,
                    },
                  ].map((b) => (
                    <div key={b.label}>
                      <p className="text-xs text-muted-foreground">{b.label}</p>
                      <p className="text-lg font-semibold text-foreground">
                        {formatPrice(b.value)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* RSI display */}
            {showRSI && lastRSI !== null && (
              <div className="bg-card rounded-2xl p-6 border border-border">
                <h3 className="font-semibold text-foreground mb-2">RSI (14)</h3>
                <div className="flex items-center gap-4">
                  <span className="text-2xl font-bold text-foreground">
                    {lastRSI?.toFixed(1)}
                  </span>
                  <span
                    className={cn(
                      "px-2 py-1 rounded text-xs font-medium",
                      lastRSI > 70
                        ? "bg-danger/10 text-danger"
                        : lastRSI < 30
                        ? "bg-success/10 text-success"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {lastRSI > 70
                      ? "Overbought"
                      : lastRSI < 30
                      ? "Oversold"
                      : "Neutral"}
                  </span>
                </div>
              </div>
            )}

          </div>

          {/* Right: Stats panel */}
          <div className="lg:col-span-2 space-y-6">
            {/* Price stats */}
            <div className="bg-card rounded-2xl p-6 border border-border">
              <h3 className="font-semibold text-foreground mb-4">Price</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-success/10 p-4 text-center">
                  <p className="text-xl font-bold text-success">
                    {formatPrice(latestCandle?.close)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Latest chart close</p>
                </div>
                <div
                  className={cn(
                    "rounded-xl p-4 text-center",
                    priceChange === null ? "bg-muted" : priceChange >= 0 ? "bg-success/10" : "bg-danger/10"
                  )}
                >
                  <p
                    className={cn(
                      "text-xl font-bold",
                      priceChange === null ? "text-muted-foreground" : priceChange >= 0 ? "text-success" : "text-danger"
                    )}
                  >
                    {priceChange === null ? "Unavailable" : `${priceChange.toFixed(2)}%`}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{timeRange.label} range change</p>
                </div>
                <div className="rounded-xl border border-border p-4 text-center">
                  <p className="text-lg font-semibold text-foreground">
                    {formatPrice(highOfDay)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Highest</p>
                </div>
                <div className="rounded-xl border border-border p-4 text-center">
                  <p className="text-lg font-semibold text-foreground">
                    {formatPrice(lowOfDay)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Lowest</p>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-2xl p-6 border border-border">
              <h3 className="font-semibold text-foreground mb-4">Statistical signals, not financial advice.</h3>
              {historyMessage ? <p className="text-sm text-muted-foreground" role="status">{historyMessage}</p> : (
                <>
                  <p className={cn("text-2xl font-bold", signals.summary.label === "Bullish" ? "text-success" : signals.summary.label === "Bearish" ? "text-danger" : "text-muted-foreground")}>
                    {signals.summary.label} <span className="text-sm font-normal">· Vote total {signals.summary.score}</span>
                  </p>
                  <dl className="my-5 grid grid-cols-2 gap-4 text-sm">
                    <div><dt className="text-muted-foreground">SMA 20</dt><dd>{formatPrice(signals.last?.fast)}</dd></div>
                    <div><dt className="text-muted-foreground">SMA 50</dt><dd>{formatPrice(signals.last?.slow)}</dd></div>
                    <div><dt className="text-muted-foreground">RSI 14</dt><dd>{lastRSI === null ? "Unavailable" : lastRSI.toFixed(1)}</dd></div>
                    <div><dt className="text-muted-foreground">P(up) in 7 days</dt><dd>{signals.probability === null ? "Unavailable" : `${(signals.probability * 100).toFixed(1)}%`}</dd></div>
                  </dl>
                  <ul className="space-y-3 text-sm">
                    {signals.summary.votes.map((vote) => (
                      <li key={vote.name}><span className="font-semibold">{vote.name}: {vote.vote > 0 ? "+1" : vote.vote}</span><p className="text-muted-foreground">{vote.reason}</p></li>
                    ))}
                  </ul>
                  <p className="mt-5 text-xs text-muted-foreground">
                    {daily.length} observed daily closes. Last completed close at {signals.last ? new Date(signals.last.time * 1000).toISOString() : "unavailable"}.
                    Return drift and volatility use the last 90 daily log returns.
                  </p>
                </>
              )}
            </div>

            {showCone && cone.length > 0 && (
              <div className="bg-card rounded-2xl p-6 border border-border">
                <h3 className="font-semibold text-foreground mb-3">7-day probability cone</h3>
                <p className="text-xs text-muted-foreground mb-4">Anchor: {formatPrice(signals.last?.close)} at {new Date(signals.last!.time * 1000).toISOString()}. Assumes normally distributed daily log returns.</p>
                <dl className="space-y-2 text-sm">
                  <div><dt className="text-muted-foreground">Day 7 median</dt><dd>{formatPrice(cone[6].median)}</dd></div>
                  <div><dt className="text-muted-foreground">Day 7 68% interval</dt><dd>{formatPrice(cone[6].lower68)} – {formatPrice(cone[6].upper68)}</dd></div>
                  <div><dt className="text-muted-foreground">Day 7 95% interval</dt><dd>{formatPrice(cone[6].lower95)} – {formatPrice(cone[6].upper95)}</dd></div>
                </dl>
              </div>
            )}

            {/* Fear & Greed */}
            {fearGreed && (
              <div className="bg-card rounded-2xl p-6 border border-border">
                <h3 className="font-semibold text-foreground mb-4">Fear and Greed Index</h3>
                <div className="grid grid-cols-2 gap-3">
                  <FearGreedGauge value={fearGreed.current.value} label="Now" />
                  <FearGreedGauge value={fearGreed.yesterday.value} label="Yesterday" />
                  <FearGreedGauge value={fearGreed.lastWeek.value} label="Last Week" />
                  <FearGreedGauge value={fearGreed.lastMonth.value} label="Last Month" />
                </div>
              </div>
            )}
            {fearGreedError && <p className="text-sm text-muted-foreground">Fear & Greed data unavailable.</p>}
          </div>
        </div>
        <p className="mt-8 text-xs text-muted-foreground">
          IntelliTrex provides research and educational analytics, not financial advice. Cryptocurrency markets are volatile.
          Statistical projections describe a model, not a guarantee of future performance.
        </p>
      </div>
    </div>
  );
}
