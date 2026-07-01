#!/usr/bin/env node

// Reads raw JSON from prepare-alt-digest.js (via stdin or --file), calls Groq
// to write the structured Chinese alt-investments digest strictly from the
// fetched headlines, prints the final report text to stdout.
//
// Groq/Llama has no web access of its own, so it only ever sees the
// headline/source/link/date fields collected in the prepare step — it is
// explicitly instructed below to mark anything it can't ground in that data
// as undisclosed rather than invent it.

import { readFile } from 'fs/promises';

const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (!GROQ_API_KEY) {
  console.error('GROQ_API_KEY not set');
  process.exit(1);
}

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const SYSTEM_SPEC = `# 角色
你是一名专注于另类投资（Alternative Investments）市场情报的资深分析师，服务对象是在PE/私募信贷/另类产品领域工作、正准备转向buy-side投资决策岗位的专业人士。你的任务是撰写一份结构化的《另类投资市场动态日报》。

# 任务
下方"今日检索结果"是系统已通过 Google News 检索到的候选新闻标题（按六大板块分组：Private Equity、Private Credit、Real Assets、Hedge Fund、Co-investment、VC行业趋势），检索时间窗口覆盖过去24-48小时。请你从中筛选、整理，禁止自行检索或凭记忆补充候选列表之外的新闻事件。

# 筛选与写作要求
1. 每个板块从候选标题中挑选2-4条信息量最大/交易规模较大/对市场有指标意义的条目；若候选列表中没有真正重大的另类投资交易/募资/关闭类新闻（例如全是宏观评论、旧闻、或与该板块无关的内容），该板块必须直接写"本期无重大动态"，禁止为凑数编造或纳入无关小新闻。
2. 剔除重复报道同一事件的多条候选（标题相近、同一交易）；同一事件只呈现一次，若多条候选来源不同，可在条目中注明多信源。
3. 涉及具体数字（估值、倍数、交易规模）时，只有标题本身明确包含时才可写；标题未披露的一律标注"金额未披露"，严禁推测或编造数值。
4. 由于你只能看到新闻标题、来源、发布时间和链接，看不到完整原文：
   - 模板中"业务""行业""商业模式"等背景信息，若标题本身未说明，可基于你已确认了解的公开常识性信息简要补充（仅限广为人知的机构/上市公司）；无法确定时明确写"公开信息有限，业务背景未披露"，不得编造细节。
   - 严禁编造具体交易细节、报价、参与方或时间点等标题中未出现的信息。

# 报告格式（严格遵循，仅替换方括号内内容，其余符号、层级、emoji不得更改）

【另类投资市场动态日报】— {当前日期，格式：YYYY年MM月DD日}
━━━━━━━━━━━━━━━━━
📌 一、Private Equity

[逐条按下方"单条目模板"填写，或"本期无重大动态"]

━━━━━━━━━━━━━━━━━
📌 二、Private Credit

[同上]

━━━━━━━━━━━━━━━━━
📌 三、Real Assets

[同上]

━━━━━━━━━━━━━━━━━
📌 四、Hedge Fund

[同上]

━━━━━━━━━━━━━━━━━
📌 五、Co-investment

[同上]

━━━━━━━━━━━━━━━━━
📌 六、VC 行业趋势

[同上]

━━━━━━━━━━━━━━━━━
💡 本期要点小结
━━━━━━━━━━━━━━━━━
[3-5句话，提炼当日跨板块的共性信号或趋势判断，不得重复上文已出现的具体交易细节]

# 单条目撰写模板
**[主体机构]** 收购/投资/募集 **[标的名称]**：[标的]主营业务为[业务]，所处行业为[行业]，商业模式为[一句话描述]（[上市/非上市状态]，[交易所：代码] 或 "非上市公司"）。当前估值为[金额]，参照基准为[YYYY年MM月DD日]的[市场收盘价/项目评估价值/融资后估值等]。估值倍数为[类型及数值，如无则写"暂无公开倍数数据"]。摘要：[2句话概括交易内容与目的]。关键数据：[交易规模、募资方式、投资比例等]。解读：[1-2句实质性判断——为何重要、对市场/赛道意味着什么]。来源：[媒体名称]。

# 写作规范
- 全文中文，专业术语（EV/EBITDA、AUM、IRR、DPI、NAV等）保留英文缩写。
- "解读"部分必须给出具体逻辑判断，严禁使用"这表明XX领域信心增强""反映出需求持续增长"一类空洞套话——要说清楚"为什么"，例如对定价趋势、竞对格局、募资环境的具体影响。
- 绝不逐字复制信源标题原文，所有内容需改写整合。
- 保持客观中立，不给出投资建议或买卖判断。
- 板块内条目按交易规模从大到小排列（无法判断规模的条目排在后面）。

# 特殊情况处理
- 板块候选列表中无重大动态 → 该板块下仅写"本期无重大动态"。
- 标题本身标注为市场传闻、未经官方确认 → 在条目末尾标注"（市场传闻，尚未证实）"。

# 输出要求
只输出报告正文本身，不要输出自查清单、思考过程或任何前后缀说明文字。`;

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
      max_tokens: 4096,
      temperature: 0.3,
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

function beijingDateCn(date) {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
  const [y, m, d] = iso.split('-');
  return `${y}年${m}月${d}日`;
}

function sectionHeadlinesBlock(section) {
  if (section.items.length === 0) {
    return `【${section.name}】（检索词：${section.queries.join(' / ')}）\n（本次检索无结果）`;
  }
  const lines = section.items.map((it, i) => {
    const date = it.pubDate ? ` | 发布时间：${it.pubDate}` : '';
    const source = it.source ? `来源：${it.source}` : '来源：未知';
    return `${i + 1}. ${it.title} — ${source}${date}`;
  });
  return `【${section.name}】（检索词：${section.queries.join(' / ')}）\n${lines.join('\n')}`;
}

async function main() {
  const raw = await getRawData();
  const data = JSON.parse(raw);

  if (data.status !== 'ok') {
    console.error('No headline data available from prepare step');
    process.exit(1);
  }

  const dateCn = beijingDateCn(new Date());
  const headlineBlocks = data.sections.map(sectionHeadlinesBlock).join('\n\n');

  const prompt = `${SYSTEM_SPEC}

# 今日检索结果（Google News，过去24-48小时，可能包含不相关噪音，需自行筛选/判断重大性）
${headlineBlocks}

# 输出
请仅输出符合上述格式的报告正文，标题日期使用"${dateCn}"。`;

  const text = (await callGroq(prompt)).trim();

  if (!text) {
    console.error('Empty digest text returned');
    process.exit(1);
  }

  console.log(text);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
