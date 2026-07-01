#!/usr/bin/env node

// Fetches US stock index prices (Yahoo Finance chart endpoint, no API key)
// and crypto prices (CoinGecko, no API key), prints raw JSON to stdout for
// remix-market-groq.js to consume.

const YAHOO_SYMBOLS = [
  { symbol: '^GSPC', name: 'S&P 500' },
  { symbol: '^DJI', name: 'Dow Jones Industrial Average' },
  { symbol: '^IXIC', name: 'Nasdaq Composite' },
  { symbol: '^VIX', name: 'CBOE Volatility Index (VIX)' },
];

const CRYPTO_IDS = ['bitcoin', 'ethereum'];

async function fetchYahooSeries(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`;
  // A browser User-Agent avoids Yahoo blocking requests that look like bots.
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; weekly-market-report/1.0)' } });
  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(data?.chart?.error?.description || 'No chart data returned');

  const { meta, timestamp, indicators } = result;
  const closes = indicators?.quote?.[0]?.close;
  if (!timestamp || !closes) throw new Error('Missing timestamp/close series');

  const rows = timestamp
    .map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: closes[i] }))
    .filter((r) => typeof r.close === 'number');

  const latestPrice = typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : rows[rows.length - 1]?.close;
  const latestDate = meta.regularMarketTime
    ? new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10)
    : rows[rows.length - 1]?.date;

  return { rows, latestPrice, latestDate };
}

function weeklyChange({ rows, latestPrice, latestDate }) {
  if (!rows || rows.length < 2 || typeof latestPrice !== 'number') return null;
  const latestDateObj = new Date(latestDate);

  let priorIdx = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    const diffDays = (latestDateObj - new Date(rows[i].date)) / 86400000;
    if (diffDays >= 7) {
      priorIdx = i;
      break;
    }
  }
  if (priorIdx === -1) priorIdx = Math.max(0, rows.length - 6); // fallback: ~5 trading days back

  const prior = rows[priorIdx];
  const changePct = ((latestPrice - prior.close) / prior.close) * 100;

  return {
    latestDate,
    latestClose: latestPrice,
    priorDate: prior.date,
    priorClose: prior.close,
    changePct,
  };
}

async function fetchIndices() {
  const results = [];
  for (const { symbol, name } of YAHOO_SYMBOLS) {
    try {
      const series = await fetchYahooSeries(symbol);
      const change = weeklyChange(series);
      if (!change) throw new Error('Not enough historical data');
      results.push({ symbol, name, ...change });
    } catch (e) {
      results.push({ symbol, name, error: e.message });
    }
  }
  return results;
}

async function fetchCrypto() {
  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${CRYPTO_IDS.join(',')}&price_change_percentage=24h,7d`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    const data = await res.json();
    return data.map((c) => ({
      id: c.id,
      symbol: (c.symbol || '').toUpperCase(),
      name: c.name,
      price: c.current_price,
      dailyChangePct: c.price_change_percentage_24h_in_currency,
      weeklyChangePct: c.price_change_percentage_7d_in_currency,
    }));
  } catch (e) {
    return [{ error: e.message }];
  }
}

async function main() {
  const [indices, crypto] = await Promise.all([fetchIndices(), fetchCrypto()]);
  const hasIndexData = indices.some((i) => !i.error);
  const hasCryptoData = crypto.some((c) => !c.error);

  console.log(JSON.stringify({
    status: hasIndexData || hasCryptoData ? 'ok' : 'error',
    generatedAt: new Date().toISOString(),
    indices,
    crypto,
  }));
}

main().catch((e) => {
  console.log(JSON.stringify({ status: 'error', message: e.message }));
  process.exit(1);
});
