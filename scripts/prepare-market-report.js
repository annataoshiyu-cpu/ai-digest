#!/usr/bin/env node

// Fetches stock/commodity index prices (Yahoo Finance, no API key), crypto
// prices (CoinGecko, no API key), and macro/earnings calendars (Financial
// Modeling Prep, needs FMP_API_KEY) — prints raw JSON to stdout for
// remix-market-groq.js to consume.

const INDEX_ASSETS = [
  { symbol: '^GSPC', name: '标普500' },
  { symbol: '^NDX', name: '纳斯达克100' },
  { symbol: '^DJI', name: '道琼斯工业指数' },
  { symbol: '^STOXX50E', name: '欧洲斯托克50' },
  { symbol: '^HSI', name: '恒生指数' },
  { symbol: '^HSTECH', name: '恒生科技指数' },
  { symbol: '000300.SS', name: '沪深300' },
  { symbol: '^N225', name: '日经225' },
  { symbol: '^VIX', name: 'VIX恐慌指数' },
  { symbol: 'CL=F', name: 'WTI原油' },
  { symbol: 'BZ=F', name: '布伦特原油' },
  { symbol: 'GC=F', name: '黄金' },
];

const CRYPTO_ASSETS = [
  { id: 'bitcoin', symbol: 'BTC', name: '比特币' },
  { id: 'ethereum', symbol: 'ETH', name: '以太坊' },
];

const FMP_API_KEY = process.env.FMP_API_KEY;

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function mondayOf(dateObj) {
  const d = new Date(Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

function currentWeekRange(today) {
  const monday = mondayOf(today);
  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);
  return { from: isoDate(monday), to: isoDate(friday) };
}

function baselineClose(rows, cutoffDateStr) {
  let result = null;
  for (const r of rows) {
    if (r.date < cutoffDateStr) result = r;
    else break;
  }
  return result;
}

function computePeriods(rows, latestPrice, latestDateStr) {
  if (!rows || rows.length < 2 || typeof latestPrice !== 'number') return null;
  const latestDateObj = new Date(`${latestDateStr}T00:00:00Z`);
  const weekStartStr = isoDate(mondayOf(latestDateObj));
  const monthStartStr = isoDate(new Date(Date.UTC(latestDateObj.getUTCFullYear(), latestDateObj.getUTCMonth(), 1)));
  const yearStartStr = isoDate(new Date(Date.UTC(latestDateObj.getUTCFullYear(), 0, 1)));

  const toChange = (cutoff) => {
    const base = baselineClose(rows, cutoff);
    if (!base) return null;
    return { changePct: ((latestPrice - base.close) / base.close) * 100, baseDate: base.date, baseClose: base.close };
  };

  return {
    latestDate: latestDateStr,
    latestClose: latestPrice,
    wtd: toChange(weekStartStr),
    mtd: toChange(monthStartStr),
    ytd: toChange(yearStartStr),
  };
}

async function fetchYahooSeries(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d`;
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

async function fetchIndices() {
  const results = [];
  for (const { symbol, name } of INDEX_ASSETS) {
    try {
      const series = await fetchYahooSeries(symbol);
      const periods = computePeriods(series.rows, series.latestPrice, series.latestDate);
      if (!periods) throw new Error('Not enough historical data');
      results.push({ symbol, name, ...periods });
    } catch (e) {
      results.push({ symbol, name, error: e.message });
    }
  }
  return results;
}

async function fetchCoingeckoSeries(id) {
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=400&interval=daily`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const data = await res.json();
  const prices = data?.prices;
  if (!Array.isArray(prices) || prices.length < 2) throw new Error('Missing price series');

  const byDate = new Map();
  for (const [ts, price] of prices) byDate.set(new Date(ts).toISOString().slice(0, 10), price);
  const rows = Array.from(byDate.entries())
    .map(([date, close]) => ({ date, close }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const latest = rows[rows.length - 1];
  return { rows, latestPrice: latest.close, latestDate: latest.date };
}

async function fetchCoingeckoCurrent(id) {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const data = await res.json();
  return { dailyChangePct: data?.[id]?.usd_24h_change };
}

async function fetchCrypto() {
  const results = [];
  for (const { id, symbol, name } of CRYPTO_ASSETS) {
    try {
      const [series, current] = await Promise.all([fetchCoingeckoSeries(id), fetchCoingeckoCurrent(id)]);
      const periods = computePeriods(series.rows, series.latestPrice, series.latestDate);
      if (!periods) throw new Error('Not enough historical data');
      results.push({ id, symbol, name, ...periods, dailyChangePct: current.dailyChangePct });
    } catch (e) {
      results.push({ id, symbol, name, error: e.message });
    }
  }
  return results;
}

async function fetchMacroCalendar(from, to) {
  if (!FMP_API_KEY) return { available: false, reason: 'FMP_API_KEY not set', items: [] };
  try {
    const url = `https://financialmodelingprep.com/api/v3/economic_calendar?from=${from}&to=${to}&apikey=${FMP_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`FMP HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Unexpected economic calendar response');

    const items = data
      .filter((e) => ['US', 'EU', 'CN'].includes(e.country) && (e.impact === 'High' || e.impact === 'Medium'))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 10)
      .map((e) => ({
        date: e.date,
        country: e.country,
        event: e.event,
        previous: e.previous,
        estimate: e.estimate,
        actual: e.actual,
        impact: e.impact,
      }));
    return { available: true, items };
  } catch (e) {
    return { available: false, reason: e.message, items: [] };
  }
}

async function fetchEarningsCalendar(from, to) {
  if (!FMP_API_KEY) return { available: false, reason: 'FMP_API_KEY not set', items: [] };
  try {
    const url = `https://financialmodelingprep.com/api/v3/earning_calendar?from=${from}&to=${to}&apikey=${FMP_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`FMP HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Unexpected earnings calendar response');

    const items = data
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 10)
      .map((e) => ({
        date: e.date,
        symbol: e.symbol,
        time: e.time,
        epsEstimated: e.epsEstimated,
        revenueEstimated: e.revenueEstimated,
      }));
    return { available: true, items };
  } catch (e) {
    return { available: false, reason: e.message, items: [] };
  }
}

async function main() {
  const weekRange = currentWeekRange(new Date());
  const [indices, crypto, macroCalendar, earningsCalendar] = await Promise.all([
    fetchIndices(),
    fetchCrypto(),
    fetchMacroCalendar(weekRange.from, weekRange.to),
    fetchEarningsCalendar(weekRange.from, weekRange.to),
  ]);

  const hasIndexData = indices.some((i) => !i.error);
  const hasCryptoData = crypto.some((c) => !c.error);

  console.log(JSON.stringify({
    status: hasIndexData || hasCryptoData ? 'ok' : 'error',
    generatedAt: new Date().toISOString(),
    weekRange,
    indices,
    crypto,
    macroCalendar,
    earningsCalendar,
  }));
}

main().catch((e) => {
  console.log(JSON.stringify({ status: 'error', message: e.message }));
  process.exit(1);
});
