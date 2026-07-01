#!/usr/bin/env node

// Fetches recent alternative-investments news headlines via Google News RSS
// (free, no API key needed) — runs the 2-3 targeted queries per sector
// required by the digest spec, dedupes results, and prints raw JSON to
// stdout for remix-alt-digest-groq.js to turn into the formatted report.

const SECTIONS = [
  {
    name: 'Private Equity',
    queries: ['buyout announcement', 'private equity acquires', 'PE fund close'],
  },
  {
    name: 'Private Credit',
    queries: ['private credit deal', 'direct lending fund', 'special situations fund'],
  },
  {
    name: 'Real Assets',
    queries: ['infrastructure fund acquisition', 'real estate private equity deal'],
  },
  {
    name: 'Hedge Fund',
    queries: ['hedge fund AUM', 'hedge fund launch', 'hedge fund closure'],
  },
  {
    name: 'Co-investment',
    queries: ['co-investment deal private equity'],
  },
  {
    name: 'VC',
    queries: ['venture capital funding round', 'VC fund close'],
  },
];

// A 2-day window absorbs weekends/holidays without extra logic — the remix
// step is told to fall back to "本期无重大动态" when nothing material shows up.
const NEWS_WINDOW = process.env.NEWS_WINDOW || 'when:2d';
const MAX_ITEMS_PER_SECTION = 15;

function stripCdata(s) {
  return s.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function tagValue(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
  const m = block.match(re);
  return m ? decodeEntities(stripCdata(m[1])).trim() : '';
}

function parseItems(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const title = tagValue(block, 'title');
    const link = tagValue(block, 'link');
    const pubDate = tagValue(block, 'pubDate');
    const source = tagValue(block, 'source');
    if (title) items.push({ title, link, pubDate, source });
  }
  return items;
}

async function fetchQuery(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} ${NEWS_WINDOW}`)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; alt-investments-digest/1.0)' },
  });
  if (!res.ok) throw new Error(`Google News HTTP ${res.status}`);
  const xml = await res.text();
  return parseItems(xml);
}

function normalizeTitle(title) {
  return title.toLowerCase().replace(/[^a-z0-9一-龥]+/g, ' ').trim();
}

function dedupe(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = normalizeTitle(item.title).slice(0, 60);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

async function fetchSection(section) {
  const perQuery = await Promise.all(
    section.queries.map((q) => fetchQuery(q).catch(() => [])),
  );
  const merged = dedupe(perQuery.flat()).slice(0, MAX_ITEMS_PER_SECTION);
  return { name: section.name, queries: section.queries, items: merged };
}

async function main() {
  const sections = await Promise.all(SECTIONS.map(fetchSection));
  const hasData = sections.some((s) => s.items.length > 0);

  console.log(JSON.stringify({
    status: hasData ? 'ok' : 'error',
    generatedAt: new Date().toISOString(),
    sections,
  }));
}

main().catch((e) => {
  console.log(JSON.stringify({ status: 'error', message: e.message }));
  process.exit(1);
});
