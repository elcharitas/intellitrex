export const SUPPORTED_COINS = [
  { id: "XBTUSD", name: "Bitcoin", symbol: "BTC", pair: "XBTUSD", krakenPair: "XXBTZUSD" },
  { id: "ETHUSDT", name: "Ethereum", symbol: "ETH", pair: "ETHUSDT", krakenPair: "XETHZUSD" },
  { id: "SOLUSDT", name: "Solana", symbol: "SOL", pair: "SOLUSDT", krakenPair: "SOLUSD" },
  { id: "XRPUSDT", name: "XRP", symbol: "XRP", pair: "XRPUSDT", krakenPair: "XXRPZUSD" },
  { id: "ARBUSD", name: "Arbitrum", symbol: "ARB", pair: "ARBUSD", krakenPair: "ARBUSD" },
  { id: "DOTUSDT", name: "Polkadot", symbol: "DOT", pair: "DOTUSDT", krakenPair: "DOTUSD" },
  { id: "LINKUSDT", name: "Chainlink", symbol: "LINK", pair: "LINKUSDT", krakenPair: "LINKUSD" },
  { id: "KSMUSD", name: "Kusama", symbol: "KSM", pair: "KSMUSD", krakenPair: "KSMUSD" },
  { id: "PYTHUSD", name: "Pyth Network", symbol: "PYTH", pair: "PYTHUSD", krakenPair: "PYTHUSD" },
  { id: "SUIUSD", name: "Sui", symbol: "SUI", pair: "SUIUSD", krakenPair: "SUIUSD" },
] as const;

export const TIME_RANGES = [
  { label: "24H", interval: "60", limit: 24 },
  { label: "1W", interval: "1440", limit: 7 },
  { label: "1M", interval: "1440", limit: 30 },
  { label: "1Y", interval: "1440", limit: 365 },
  { label: "ALL", interval: "1440", limit: 720 },
];

export const MODELS = ["XGBoost", "Prophet", "NHITS", "GRU", "Ensemble"] as const;

export const GITHUB_WORKFLOW_REPO = "reallyticsai/Intellitrax_Workflow";

export const CHATBOT_MODES = [
  {
    id: "risk-averse",
    name: "Risk-Averse Mode",
    description: "Focuses on low-risk, long-term investments. Emphasizes established cryptocurrencies with stable performance. Provides in-depth analytics for conservative trading strategies.",
  },
  {
    id: "active-trader",
    name: "Active Trader Mode",
    description: "Designed for frequent traders. Offers real-time market data, quick buy/sell options, and alerts. Incorporates advanced charting tools and indicators for technical analysis.",
  },
  {
    id: "learning",
    name: "Learning Mode",
    description: "Ideal for beginners to learn without financial risk. Offers a simulated environment to practice trading strategies. Provides educational resources, tutorials, and market simulations.",
  },
] as const;
