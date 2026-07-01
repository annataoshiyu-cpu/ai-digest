#!/usr/bin/env node

// Sends the alt-investments daily digest via Gmail SMTP using nodemailer.
// The report body uses "**bold**" around deal headlines and "• " bullet
// lines per field — this renders those as real HTML bold/newlines instead
// of literal asterisks, while leaving the 【】/━━━/📌 section dividers
// untouched. A markdown-stripped copy is sent as the plain-text fallback.
// Usage: node deliver-alt-digest.js --file /path/to/digest.txt
//        cat digest.txt | node deliver-alt-digest.js

import { readFile } from 'fs/promises';
import nodemailer from 'nodemailer';
import { config as loadEnv } from 'dotenv';
import { join } from 'path';
import { homedir } from 'os';

loadEnv({ path: join(homedir(), '.follow-builders/.env') });

async function getDigestText() {
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
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function digestToHtml(text) {
  const body = escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.7;white-space:pre-wrap;color:#1a1a1a;">${body}</div>`;
}

function stripMarkdown(text) {
  return text.replace(/\*\*(.+?)\*\*/g, '$1');
}

async function main() {
  const text = await getDigestText();
  if (!text || !text.trim()) {
    console.log(JSON.stringify({ status: 'skipped', reason: 'Empty digest' }));
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
    timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric',
  });

  await transporter.sendMail({
    from: `另类投资市场动态日报 <${process.env.GMAIL_USER}>`,
    to: process.env.GMAIL_USER,
    subject: `【另类投资市场动态日报】— ${todayCn}`,
    text: stripMarkdown(text),
    html: digestToHtml(text),
  });

  console.log(JSON.stringify({ status: 'ok', method: 'gmail-smtp', message: `Digest sent to ${process.env.GMAIL_USER}` }));
}

main().catch((e) => {
  console.log(JSON.stringify({ status: 'error', message: e.message }));
  process.exit(1);
});
