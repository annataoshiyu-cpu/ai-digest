#!/usr/bin/env node

// Reads raw JSON from prepare-market-report.js (via stdin or --file),
// calls Groq API to generate a bilingual market commentary, prints the
// full report to stdout.

import { readFile } from 'fs/promises';

const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (!GROQ_API_KEY) {
  console.error('GROQ_API_KEY not set');
  process.exit(1);
}

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

async function callGroq(prompt) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1024,
      temperature: 0.5,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq API error: ${err}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

async function getRawData() {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf('--file');
  if (fileIdx !== -1 && args[fileIdx + 1]) {
    return await readFile(args[fileIdx + 1], 'utf-8');
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

function formatIndex(i) {
  if (i.error) return `${i.name} (${i.symbol}): data unavailable (${i.error})`;
  const sign = i.changePct >= 0 ? '+' : '';
  return `${i.name} (${i.symbol}): ${i.latestClose} (${sign}${i.changePct.toFixed(2)}% since ${i.priorDate})`;
}

function formatCrypto(c) {
  if (c.error) return `Crypto data unavailable (${c.error})`;
  const sign = (v) => (v >= 0 ? '+' : '');
  const daily = typeof c.dailyChangePct === 'number' ? `${sign(c.dailyChangePct)}${c.dailyChangePct.toFixed(2)}%` : 'n/a';
  const weekly = typeof c.weeklyChangePct === 'number' ? `${sign(c.weeklyChangePct)}${c.weeklyChangePct.toFixed(2)}%` : 'n/a';
  return `${c.name} (${c.symbol}): $${c.price} (24h ${daily}, 7d ${weekly})`;
}

async function main() {
  const raw = await getRawData();
  const data = JSON.parse(raw);

  if (data.status !== 'ok') {
    console.log('Market data unavailable for this run — check back next time.');
    return;
  }

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const indexLines = (data.indices || []).map(formatIndex).join('\n');
  const cryptoLines = (data.crypto || []).map(formatCrypto).join('\n');

  const prompt = `You are writing a concise weekly market report covering the past week's US stock market and crypto performance.

Raw data:

US Indices (weekly % change):
${indexLines}

Crypto (24h and 7-day % change):
${cryptoLines}

Write a short market commentary (3-5 short paragraphs) explaining what happened this week in plain language, noting the most notable moves. Do NOT invent specific news events or causes you are not given data for — describe the moves themselves and, only if the direction/magnitude clearly implies it (e.g. VIX spiking alongside falling indices means rising fear), note the general market mood.

Language: Write in BILINGUAL mode — English first, then the Chinese translation directly below it (separated by a blank line).`;

  let commentary;
  try {
    commentary = (await callGroq(prompt)).trim();
  } catch (e) {
    commentary = `(AI commentary unavailable: ${e.message})`;
  }

  const report = [
    `Weekly Market Report — ${today}`,
    '═'.repeat(50),
    '',
    'US STOCK INDICES',
    '─'.repeat(40),
    indexLines,
    '',
    'CRYPTO',
    '─'.repeat(40),
    cryptoLines,
    '',
    '═'.repeat(50),
    '',
    commentary,
  ].join('\n');

  console.log(report);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
