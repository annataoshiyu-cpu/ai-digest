---
name: follow-builders-setup
description: 完整设置 follow-builders AI日报系统，包括安装、邮件推送、GitHub Actions 云端定时发送（Mac 关机也能收到）、Groq 摘要生成。当用户提到设置 AI日报、follow-builders 安装、自动发送日报到邮件、配置日报推送，或想重新配置这套系统时，使用此 skill。
---

# Follow Builders 完整安装与配置指南

本 skill 记录了完整的 follow-builders AI日报系统搭建流程，包括本地安装、邮件推送、以及 Mac 关机时也能自动发送的云端方案。

## 系统架构

```
prepare-digest.js  →  Groq (Llama 3.3) 整理摘要  →  Resend 发送邮件
     ↑                        ↑
  本地 crontab           GitHub Actions
（Mac 开着时）           （Mac 关机也能跑）
```

---

## Step 1：安装 follow-builders

```bash
git clone https://github.com/zarazhangrui/follow-builders.git ~/.claude/skills/follow-builders
cd ~/.claude/skills/follow-builders/scripts && npm install
```

需要先安装 Node.js（[nodejs.org](https://nodejs.org)）。

---

## Step 2：基本配置

创建用户配置目录和文件：

```bash
mkdir -p ~/.follow-builders
```

创建 `~/.follow-builders/config.json`：

```json
{
  "platform": "other",
  "language": "bilingual",
  "timezone": "Asia/Shanghai",
  "frequency": "daily",
  "deliveryTime": "08:00",
  "delivery": {
    "method": "email",
    "email": "YOUR_EMAIL@gmail.com"
  },
  "onboardingComplete": true
}
```

语言选项：`"en"`（英文）/ `"zh"`（中文）/ `"bilingual"`（中英双语）

---

## Step 3：配置邮件推送（Resend）

1. 去 [resend.com](https://resend.com) 免费注册
2. 在 API Keys 页面创建一个 Key
3. 注意：**只能发送到注册 Resend 时用的邮箱**，除非验证了自己的域名

创建 `~/.follow-builders/.env`：

```bash
RESEND_API_KEY=your_resend_api_key_here
```

---

## Step 4：配置 Groq API（用于 AI 摘要生成）

1. 去 [console.groq.com](https://console.groq.com) 免费注册，获取 API Key
2. 追加到 `.env`：

```bash
echo "GROQ_API_KEY=your_groq_api_key_here" >> ~/.follow-builders/.env
```

把 `remix-groq.js` 复制到 follow-builders scripts 目录（见下方脚本内容）。

---

## Step 5：创建 remix-groq.js

将以下文件保存到 `~/.claude/skills/follow-builders/scripts/remix-groq.js`：

> 该脚本从 stdin 读取 prepare-digest.js 输出的 JSON，调用 Groq API 生成中英双语摘要，输出到 stdout。
> 完整脚本见本 skill 目录下的 `scripts/remix-groq.js`。

---

## Step 6：设置本地 crontab（Mac 开着时）

```bash
SKILL_DIR="$HOME/.claude/skills/follow-builders"
ENV_FILE="$HOME/.follow-builders/.env"

(crontab -l 2>/dev/null | grep -v "follow-builders"; echo "0 8 * * * cd $SKILL_DIR/scripts && node prepare-digest.js 2>/dev/null | GROQ_API_KEY=\$(grep GROQ_API_KEY $ENV_FILE | cut -d= -f2) RESEND_API_KEY=\$(grep RESEND_API_KEY $ENV_FILE | cut -d= -f2) node remix-groq.js 2>/dev/null | RESEND_API_KEY=\$(grep RESEND_API_KEY $ENV_FILE | cut -d= -f2) node deliver.js 2>/dev/null") | crontab -
```

---

## Step 7：GitHub Actions（Mac 关机时也能发）

### 7.1 创建 GitHub 仓库

在 GitHub 上新建一个空仓库（如 `ai-digest`）。

### 7.2 仓库文件结构

```
ai-digest/
├── .github/workflows/daily-digest.yml
├── scripts/remix-groq.js
└── package.json
```

`package.json` 内容：
```json
{
  "name": "ai-digest",
  "version": "1.0.0",
  "type": "module"
}
```

### 7.3 Workflow 文件（`.github/workflows/daily-digest.yml`）

```yaml
name: AI Builders Daily Digest

on:
  schedule:
    - cron: '0 0 * * *'  # 08:00 Beijing time (UTC+8)
  workflow_dispatch:

jobs:
  digest:
    runs-on: ubuntu-latest
    steps:
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Clone follow-builders
        run: git clone https://github.com/zarazhangrui/follow-builders.git

      - name: Install dependencies
        run: cd follow-builders/scripts && npm install

      - name: Checkout this repo
        uses: actions/checkout@v4
        with:
          path: this-repo

      - name: Fetch raw content
        run: |
          cd follow-builders/scripts
          node prepare-digest.js > /tmp/raw-data.json

      - name: Generate digest with Groq
        env:
          GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
        run: |
          cd follow-builders/scripts
          cat /tmp/raw-data.json | GROQ_API_KEY=$GROQ_API_KEY node ../../this-repo/scripts/remix-groq.js > /tmp/digest.txt

      - name: Send email via Resend
        env:
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          DELIVERY_EMAIL: ${{ secrets.DELIVERY_EMAIL }}
        run: |
          node -e "
          import('node:fs').then(async ({readFileSync}) => {
            const text = readFileSync('/tmp/digest.txt', 'utf-8');
            if (!text.trim()) throw new Error('Digest is empty');
            const today = new Date().toLocaleDateString('en-US', {
              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            });
            const res = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + process.env.RESEND_API_KEY
              },
              body: JSON.stringify({
                from: 'AI Builders Digest <digest@resend.dev>',
                to: [process.env.DELIVERY_EMAIL],
                subject: 'AI Builders Digest — ' + today,
                text: text
              })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(JSON.stringify(data));
            console.log('Email sent:', JSON.stringify(data));
          });
          "
```

### 7.4 添加 GitHub Secrets

在仓库设置 → Secrets and variables → Actions 中添加：

| Secret 名称 | 说明 |
|-------------|------|
| `GROQ_API_KEY` | Groq API Key |
| `RESEND_API_KEY` | Resend API Key |
| `DELIVERY_EMAIL` | 收件邮箱 |

---

## Step 8：Claude Code 定时任务

在 Claude Code 中设置每日定时运行（需要 Claude Code 保持打开）：

使用 `/schedule` 创建定时任务，prompt 内容：
- 运行 prepare-digest.js 抓取内容
- 用 Claude 生成中英双语摘要
- 通过 deliver.js 发送到邮箱

---

## 日常使用

| 方式 | 命令 | 说明 |
|------|------|------|
| 手动获取 | `/ai` | 立即生成并展示当天日报 |
| 本地定时 | 自动 | Mac 开着时每天 8 点发邮件 |
| 云端定时 | 自动 | Mac 关机时由 GitHub Actions 发邮件 |

---

## 常见问题

**Resend 报错"只能发到自己邮箱"**
→ 你的 Resend 账号注册邮箱和收件邮箱不同。换用注册邮箱，或在 Resend 验证自己的域名。

**Gemini API 报 429 quota 超限**
→ 改用 Groq（免费且无配额问题）。

**crontab 任务跑了但邮件是空的**
→ 原来的 crontab 直接把 JSON 发出去了，需要加 remix-groq.js 中间步骤。

**GitHub Actions 报 Groq API 错误**
→ 检查 GitHub Secrets 中的 GROQ_API_KEY 是否正确填写。
