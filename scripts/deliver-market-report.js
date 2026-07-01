#!/usr/bin/env node

// Sends the weekly market report (HTML) via Gmail SMTP using nodemailer.
// Usage: node deliver-market-report.js --file /path/to/report.html
//        cat report.html | node deliver-market-report.js

import { readFile } from 'fs/promises';
import nodemailer from 'nodemailer';
import { config as loadEnv } from 'dotenv';
import { join } from 'path';
import { homedir } from 'os';

loadEnv({ path: join(homedir(), '.follow-builders/.env') });

async function getReportHtml() {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf('--file');
  if (fileIdx !== -1 && args[fileIdx + 1]) {
    return await readFile(args[fileIdx + 1], 'utf-8');
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

async function main() {
  const html = await getReportHtml();
  if (!html || !html.trim()) {
    console.log(JSON.stringify({ status: 'skipped', reason: 'Empty report' }));
    return;
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  const todayCn = new Date().toLocaleDateString('zh-CN', {
    month: 'long', day: 'numeric',
  });

  await transporter.sendMail({
    from: `市场周报 <${process.env.GMAIL_USER}>`,
    to: process.env.GMAIL_USER,
    subject: `【市场周报】— ${todayCn}`,
    html,
  });

  console.log(JSON.stringify({ status: 'ok', method: 'gmail-smtp', message: `Report sent to ${process.env.GMAIL_USER}` }));
}

main().catch((e) => {
  console.log(JSON.stringify({ status: 'error', message: e.message }));
  process.exit(1);
});
