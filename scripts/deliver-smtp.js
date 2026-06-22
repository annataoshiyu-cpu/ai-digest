#!/usr/bin/env node

// Sends digest via Gmail SMTP using nodemailer.
// Usage: node deliver-smtp.js --file /path/to/digest.txt
//        echo "text" | node deliver-smtp.js

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
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  await transporter.sendMail({
    from: `AI Builders Digest <${process.env.GMAIL_USER}>`,
    to: process.env.GMAIL_USER,
    subject: `AI Builders Digest — ${today}`,
    text
  });

  console.log(JSON.stringify({ status: 'ok', method: 'gmail-smtp', message: `Digest sent to ${process.env.GMAIL_USER}` }));
}

main().catch(e => {
  console.log(JSON.stringify({ status: 'error', message: e.message }));
  process.exit(1);
});
