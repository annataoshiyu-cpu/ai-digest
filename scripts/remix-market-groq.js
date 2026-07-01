#!/usr/bin/env node

// Reads raw JSON from prepare-market-report.js (via stdin or --file),
// builds an HTML market report (tables from real data, short Groq-written
// commentary grounded in that data), prints the HTML to stdout.

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
      max_tokens: 512,
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

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtPct(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return '—';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

function pctColor(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return '#666666';
  return v >= 0 ? '#0a7d32' : '#c0392b';
}

function fmtCnDate(iso) {
  if (!iso) return '—';
  const [, m, d] = iso.split('-').map(Number);
  return `${m}月${d}日`;
}

function td(content, extraStyle = '') {
  return `<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;${extraStyle}">${content}</td>`;
}

function assetTableRows(assets) {
  return assets.map((a) => {
    if (a.error) {
      return `<tr>${td(escapeHtml(a.name))}${td('数据暂不可用', 'color:#999999;')}<td colspan="2" style="padding:8px 12px;border-bottom:1px solid #e5e7eb;"></td></tr>`;
    }
    return `<tr>
      ${td(escapeHtml(a.name))}
      ${td(fmtPct(a.wtd?.changePct), `color:${pctColor(a.wtd?.changePct)};font-weight:600;`)}
      ${td(fmtPct(a.mtd?.changePct), `color:${pctColor(a.mtd?.changePct)};font-weight:600;`)}
      ${td(fmtPct(a.ytd?.changePct), `color:${pctColor(a.ytd?.changePct)};font-weight:600;`)}
    </tr>`;
  }).join('\n');
}

function macroTable(macroCalendar) {
  if (!macroCalendar.available) {
    const reason = macroCalendar.reason === 'FMP_API_KEY not set'
      ? '本期未接入宏观日历数据源'
      : `本期宏观日历数据获取失败（${escapeHtml(macroCalendar.reason)}）`;
    return `<p style="font-size:14px;color:#666666;margin:4px 0 0;">${reason}</p>`;
  }
  if (macroCalendar.items.length === 0) {
    return `<p style="font-size:14px;color:#666666;margin:4px 0 0;">本周无重大宏观数据发布</p>`;
  }
  const rows = macroCalendar.items.map((e) => `<tr>
    ${td(escapeHtml(e.date))}
    ${td(escapeHtml(e.country))}
    ${td(escapeHtml(e.event))}
    ${td(e.previous ?? '—')}
    ${td(e.estimate ?? '—')}
  </tr>`).join('\n');
  return `<table style="width:100%;border-collapse:collapse;margin-top:8px;">
    <tr style="background:#0f1b3d;color:#ffffff;">
      ${td('日期', 'color:#ffffff;font-weight:600;')}${td('地区', 'color:#ffffff;font-weight:600;')}${td('事件', 'color:#ffffff;font-weight:600;')}${td('前值', 'color:#ffffff;font-weight:600;')}${td('预期', 'color:#ffffff;font-weight:600;')}
    </tr>
    ${rows}
  </table>`;
}

function earningsTable(earningsCalendar) {
  if (!earningsCalendar.available) {
    const reason = earningsCalendar.reason === 'FMP_API_KEY not set'
      ? '本期未接入财报日历数据源'
      : `本期财报日历数据获取失败（${escapeHtml(earningsCalendar.reason)}）`;
    return `<p style="font-size:14px;color:#666666;margin:4px 0 0;">${reason}</p>`;
  }
  if (earningsCalendar.items.length === 0) {
    return `<p style="font-size:14px;color:#666666;margin:4px 0 0;">本周无重点财报发布</p>`;
  }
  const rows = earningsCalendar.items.map((e) => `<tr>
    ${td(escapeHtml(e.date))}
    ${td(escapeHtml(e.time || '—'))}
    ${td(escapeHtml(e.symbol))}
    ${td(typeof e.epsEstimated === 'number' ? e.epsEstimated.toFixed(2) : '—')}
  </tr>`).join('\n');
  return `<table style="width:100%;border-collapse:collapse;margin-top:8px;">
    <tr style="background:#0f1b3d;color:#ffffff;">
      ${td('日期', 'color:#ffffff;font-weight:600;')}${td('时段', 'color:#ffffff;font-weight:600;')}${td('公司', 'color:#ffffff;font-weight:600;')}${td('预期EPS', 'color:#ffffff;font-weight:600;')}
    </tr>
    ${rows}
  </table>`;
}

async function buildHighlightNote(best, worst) {
  if (!best || !worst) return '本期数据不足，暂无法生成异动点评。';
  const prompt = `Write 2-3 short sentences in Chinese describing this week's best and worst performing tracked assets, in neutral factual language.

Best performer: ${best.name}, WTD change ${fmtPct(best.wtd.changePct)}
Worst performer: ${worst.name}, WTD change ${fmtPct(worst.wtd.changePct)}

Do NOT invent a specific news event or cause you have no evidence for. You may mention general, widely-known macro themes (e.g. AI enthusiasm, interest rate expectations) only as commonly-cited background context, clearly framed as general context rather than a confirmed cause of this specific move. Output only the Chinese text, no preamble.`;
  try {
    return (await callGroq(prompt)).trim();
  } catch (e) {
    return `点评生成失败：${escapeHtml(e.message)}`;
  }
}

async function buildSummary(macroCalendar, earningsCalendar) {
  const macroText = macroCalendar.available && macroCalendar.items.length
    ? macroCalendar.items.map((e) => `${e.date} ${e.country} ${e.event}（前值 ${e.previous ?? 'N/A'}，预期 ${e.estimate ?? 'N/A'}）`).join('; ')
    : '无数据';
  const earningsText = earningsCalendar.available && earningsCalendar.items.length
    ? earningsCalendar.items.map((e) => `${e.date} ${e.symbol}`).join('; ')
    : '无数据';

  const prompt = `Write a concise 2-3 sentence summary in Chinese highlighting what to watch this week, based ONLY on the following real data — do not invent anything beyond it. If a data source says "无数据", don't speculate about it, just don't mention it.

Macro calendar: ${macroText}
Earnings calendar: ${earningsText}

Output only the Chinese text, no preamble.`;
  try {
    return (await callGroq(prompt)).trim();
  } catch (e) {
    return `摘要生成失败：${escapeHtml(e.message)}`;
  }
}

async function main() {
  const raw = await getRawData();
  const data = JSON.parse(raw);

  if (data.status !== 'ok') {
    console.log('<p>市场数据本期不可用，请稍后再试。</p>');
    return;
  }

  const { indices = [], crypto = [], macroCalendar, earningsCalendar, weekRange } = data;
  const allAssets = [...indices, ...crypto];
  const validAssets = allAssets.filter((a) => !a.error && a.wtd && typeof a.wtd.changePct === 'number');
  const sorted = [...validAssets].sort((a, b) => b.wtd.changePct - a.wtd.changePct);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];

  const [highlightNote, summary] = await Promise.all([
    buildHighlightNote(best, worst),
    buildSummary(macroCalendar, earningsCalendar),
  ]);

  const latestDataDate = allAssets.find((a) => !a.error)?.latestDate;
  const sourcesUsed = ['行情: Yahoo Finance', '加密货币: CoinGecko'];
  if (macroCalendar.available || earningsCalendar.available) sourcesUsed.push('宏观/财报日历: Financial Modeling Prep');

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a1a;">
  <div style="background:#0f1b3d;color:#ffffff;border-radius:8px;padding:20px 24px;margin-bottom:20px;">
    <div style="font-size:20px;font-weight:700;">📊 每周市场展望与复盘</div>
    <div style="font-size:14px;color:#c7cedd;margin-top:6px;">本周关注：${fmtCnDate(weekRange?.from)}—${fmtCnDate(weekRange?.to)}</div>
  </div>

  <h3 style="font-size:16px;margin:20px 0 4px;">📅 一、本周宏观日历（${fmtCnDate(weekRange?.from)}—${fmtCnDate(weekRange?.to)}）</h3>
  ${macroTable(macroCalendar)}

  <h3 style="font-size:16px;margin:20px 0 4px;">🏦 二、ECM / IPO 动态</h3>
  <p style="font-size:14px;color:#666666;margin:4px 0 0;">本期未接入ECM/IPO数据源</p>

  <h3 style="font-size:16px;margin:20px 0 4px;">📊 三、本周重要财报</h3>
  ${earningsTable(earningsCalendar)}

  <h3 style="font-size:16px;margin:20px 0 4px;">📈 四、市场表现（WTD / MTD / YTD）</h3>
  <table style="width:100%;border-collapse:collapse;margin-top:8px;">
    <tr style="background:#0f1b3d;color:#ffffff;">
      ${td('资产', 'color:#ffffff;font-weight:600;')}${td('WTD', 'color:#ffffff;font-weight:600;')}${td('MTD', 'color:#ffffff;font-weight:600;')}${td('YTD', 'color:#ffffff;font-weight:600;')}
    </tr>
    ${assetTableRows(indices)}
    ${assetTableRows(crypto)}
  </table>
  <p style="font-size:12px;color:#999999;margin:6px 0 0;">数据截至日期：${fmtCnDate(latestDataDate)}</p>

  <h3 style="font-size:16px;margin:20px 0 4px;">⚡ 五、本周异动资产</h3>
  <p style="font-size:14px;line-height:1.6;margin:4px 0 0;">${escapeHtml(highlightNote)}</p>
  <p style="font-size:12px;color:#999999;margin:6px 0 0;">异动范围仅限本报告追踪的指数与加密货币，覆盖面有限。</p>

  <h3 style="font-size:16px;margin:20px 0 4px;">📰 六、精选公众号观点摘要</h3>
  <p style="font-size:14px;color:#666666;margin:4px 0 0;">本期无用户提供的公众号素材</p>

  <h3 style="font-size:16px;margin:20px 0 4px;">💡 本期要点小结</h3>
  <p style="font-size:14px;line-height:1.6;margin:4px 0 0;">${escapeHtml(summary)}</p>

  <h3 style="font-size:14px;margin:20px 0 4px;color:#666666;">📌 数据来源</h3>
  <p style="font-size:12px;color:#999999;margin:4px 0 0;">${sourcesUsed.join(' | ')}</p>

  <h3 style="font-size:14px;margin:16px 0 4px;color:#666666;">⚠️ 免责声明</h3>
  <p style="font-size:12px;color:#999999;margin:4px 0 0;line-height:1.6;">本简报由自动化脚本基于公开市场数据生成，仅供内部参考与个人信息管理使用，不构成任何投资建议。市场数据可能因数据源或时点差异存在误差，具体数值请以行情终端为准。</p>
</div>`.trim();

  console.log(html);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
