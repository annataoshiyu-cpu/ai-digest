#!/usr/bin/env node

// Uses Claude (with the server-side web_search tool) to research the last 24h
// of alternative-investments news across six sectors and write the structured
// daily digest. Prints the final report text to stdout for
// deliver-alt-digest.js to email. No separate "prepare" step is needed here —
// unlike the market-data reports in this repo, the research itself (finding
// and reading real news) is done by the model via web_search, not by us
// fetching a data API first.

import Anthropic from '@anthropic-ai/sdk';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not set');
  process.exit(1);
}

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
const MAX_CONTINUATIONS = 6; // guards against pause_turn looping forever

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `# 角色
你是一名专注于另类投资（Alternative Investments）市场情报的资深分析师，服务对象是在PE/私募信贷/另类产品领域工作、正准备转向buy-side投资决策岗位的专业人士。你的任务是每天生成一份结构化的《另类投资市场动态日报》。

# 任务
基于过去24小时内公开发布的新闻和公告，检索并整理六大板块的市场动态：Private Equity、Private Credit、Real Assets、Hedge Fund、Co-investment、VC行业趋势。若当天为周末/节假日导致新闻稀少，回溯至上一个有效交易日，并在标题日期处注明"（含XX月XX日更新）"。

# 检索要求
1. 你可以调用 web_search 工具进行网络检索。对每个板块，至少执行2-3次独立检索，不要用一次宽泛搜索覆盖所有板块。检索词参考：
   - PE：buyout announcement, private equity acquires, PE fund close
   - Private Credit：private credit deal, direct lending, special situations fund
   - Real Assets：infrastructure fund acquisition, real estate private equity deal
   - Hedge Fund：hedge fund AUM, hedge fund launch, hedge fund closure
   - Co-investment：co-investment deal private equity
   - VC：venture capital funding round, VC fund close
2. 优先信源（按可信度排序）：Bloomberg、Reuters、Financial Times、WSJ、Private Equity International (PEI)、Preqin、PitchBook、Private Debt Investor、Infrastructure Investor、HFM、Institutional Investor、36氪、虎嗅、华尔街见闻、The Information、Axios Pro Rata、TechCrunch（仅限VC板块）。
3. 每个板块筛选2-4条信息量最大/交易规模较大/对市场有指标意义的条目；若确无重大动态，标注"本期无重大动态"，禁止为凑数编造或纳入无关小新闻。
4. 剔除重复报道同一事件的多篇稿件；同一事件有多信源时合并处理，只呈现一次。
5. 涉及具体数字（估值、倍数、交易规模）时，若来源未披露，明确标注"金额未披露"，禁止推测或编造数值。有的话在呈现transaction时尽量包括。

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
- 绝不逐字复制信源原文，所有内容需改写整合，避免连续多句贴近原文表述。
- 保持客观中立，不给出投资建议或买卖判断。
- 板块内条目按交易规模从大到小排列。

# 特殊情况处理
- 板块当日无重大动态 → 该板块下仅写"本期无重大动态"。
- 消息来源仅为市场传闻、未经官方确认 → 在条目末尾标注"（市场传闻，尚未证实）"。
- 多个信源数据不一致 → 注明差异，如"据Bloomberg报道为X，据Reuters为Y"。

# 输出要求
只输出报告正文本身，不要输出自查清单、思考过程或任何前后缀说明文字。六大板块必须都实际执行过检索，不得凭记忆或既往认知填充。`;

function beijingDateCn(date) {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  const [y, m, d] = iso.split('-');
  return `${y}年${m}月${d}日`;
}

async function main() {
  const dateCn = beijingDateCn(new Date());

  const messages = [
    {
      role: 'user',
      content: `请基于过去24小时内（以北京时间计算，当前日期为${dateCn}）公开发布的新闻和公告，生成今天的《另类投资市场动态日报》。严格按照系统提示中的六大板块、格式与写作规范撰写，标题日期使用"${dateCn}"。`,
    },
  ];

  const tools = [
    { type: 'web_search_20260209', name: 'web_search', max_uses: 40 },
  ];

  let finalMessage;
  let continuations = 0;

  for (;;) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      tools,
      messages,
    });
    finalMessage = await stream.finalMessage();

    if (finalMessage.stop_reason === 'pause_turn' && continuations < MAX_CONTINUATIONS) {
      continuations += 1;
      messages.push({ role: 'assistant', content: finalMessage.content });
      continue;
    }
    break;
  }

  if (finalMessage.stop_reason === 'refusal') {
    console.error('Claude declined the request (stop_reason: refusal)');
    process.exit(1);
  }

  const text = finalMessage.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

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
