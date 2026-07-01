#!/usr/bin/env node

// Fetches the past week's US stock index closes (Stooq, no API key) and
// crypto prices (CoinGecko, no API key), prints raw JSON to stdout for
// remix-market-groq.js to consume.

const STOOQ_SYMBOLS = [
  { symbol: '^spx', name: 'S&P 500' },
  { symbol: '^dji', name: 'Dow Jones Industrial Average' },
  { symbol: '^ndq', name: 'Nasdaq Composite' },
  { symbol: '^vix', name: 'CBOE Volatility Index (VIX)' },
];

const CRYPTO_IDS = ['bitcoin', 'ethereum'];

async function fetchStooqSeries(symbol) {
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Stooq HTTP ${res.status}`);
  const text = (await res.text()).trim();
  const lines = text.split('\n').filter(Boolean);
  if (lines.length < 2 || !lines[0].startsWith('Date')) {
    throw new Error('Unexpected Stooq response format');
  }
  return lines.slice(1).map((line) => {
    const [date, , , , close] = line.split(',');
    return { date, close: parseFloat(close) };
  });
}

function weeklyChange(rows) {
  if (!rows || rows.length < 2) return null;
  const latest = rows[rows.length - 1];
  const latestDate = new Date(latest.date);

  let priorIdx = -1;
  for (let i = rows.length - 2; i >= 0; i--) {
    const diffDays = (latestDate - new Date(rows[i].date)) / 86400000;
    if (diffDays >= 7) {
      priorIdx = i;
      break;
    }
  }
  if (priorIdx === -1) priorIdx = Math.max(0, rows.length - 6); // fallback: ~5 trading days back

  const prior = rows[priorIdx];
  const changePct = ((latest.close - prior.close) / prior.close) * 100;

  return {
    latestDate: latest.date,
    latestClose: latest.close,
    priorDate: prior.date,
    priorClose: prior.close,
    changePct,
  };
}

async function fetchIndices() {
  const results = [];
  for (const { symbol, name } of STOOQ_SYMBOLS) {
    try {
      const rows = await fetchStooqSeries(symbol);
      const change = weeklyChange(rows);
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
