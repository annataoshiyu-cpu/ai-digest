#!/usr/bin/env node

// Reads raw JSON from prepare-digest.js (via stdin or --file),
// calls Gemini API to generate a bilingual digest, prints result to stdout.

import { readFile } from 'fs/promises';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY not set');
  process.exit(1);
}

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

async function callGemini(prompt) {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 8192 }
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error: ${err}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function getRawData() {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf('--file');
  if (fileIdx !== -1 && args[fileIdx + 1]) {
    return await readFile(args[fileIdx + 1], 'utf-8');
  }
  if (args[0] && !args[0].startsWith('--')) {
    return await readFile(args[0], 'utf-8');
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

async function main() {
  const raw = await getRawData();
  const data = JSON.parse(raw);

  if (data.status !== 'ok') {
    console.error('Feed error:', data);
    process.exit(1);
  }

  const { config, x, podcasts, blogs, prompts, stats } = data;

  if (stats.podcastEpisodes === 0 && stats.xBuilders === 0) {
    console.log('No new updates from your builders today. Check back tomorrow!');
    return;
  }

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const sections = [];

  // --- X / TWITTER ---
  const tweetSummaries = [];
  for (const builder of (x || [])) {
    if (!builder.tweets || builder.tweets.length === 0) continue;
    const substantive = builder.tweets.filter(t => t.text && t.text.length > 30);
    if (substantive.length === 0) continue;

    const tweetLines = substantive.map(t =>
      `Tweet: ${t.text}\nURL: ${t.url}\nLikes: ${t.likes}`
    ).join('\n\n');

    const prompt = `${prompts.summarize_tweets}

Builder: ${builder.name}
Bio: ${builder.bio}

Recent posts:
${tweetLines}

Language instruction: Write in BILINGUAL mode — for each builder, write the English summary first, then the Chinese translation directly below (separated by a blank line). Include the tweet URL(s) after both versions. Do NOT output all English first then all Chinese. Interleave them paragraph by paragraph.`;

    try {
      const summary = await callGemini(prompt);
      tweetSummaries.push(summary.trim());
    } catch (e) {
      console.error(`Failed to summarize ${builder.name}:`, e.message);
    }
  }

  if (tweetSummaries.length > 0) {
    sections.push(`X / TWITTER\n${'─'.repeat(40)}\n\n${tweetSummaries.join('\n\n---\n\n')}`);
  }

  // --- BLOGS ---
  const blogSummaries = [];
  for (const blog of (blogs || [])) {
    if (!blog.content && !blog.description) continue;

    const prompt = `${prompts.summarize_blogs}

Blog: ${blog.name}
Title: ${blog.title}
URL: ${blog.url}
${blog.author ? `Author: ${blog.author}` : ''}
Content:
${(blog.content || blog.description || '').slice(0, 6000)}

Language instruction: Write in BILINGUAL mode — English summary first, then Chinese translation directly below (separated by a blank line). Include the article URL after both versions.`;

    try {
      const summary = await callGemini(prompt);
      blogSummaries.push(summary.trim());
    } catch (e) {
      console.error(`Failed to summarize blog ${blog.name}:`, e.message);
    }
  }

  if (blogSummaries.length > 0) {
    sections.push(`OFFICIAL BLOGS\n${'─'.repeat(40)}\n\n${blogSummaries.join('\n\n---\n\n')}`);
  }

  // --- PODCASTS ---
  const podcastSummaries = [];
  for (const pod of (podcasts || [])) {
    if (!pod.transcript) continue;

    const prompt = `${prompts.summarize_podcast}

Podcast: ${pod.name}
Episode: ${pod.title}
URL: ${pod.url}
Transcript (first 8000 chars):
${pod.transcript.slice(0, 8000)}

Language instruction: Write in BILINGUAL mode — English summary first, then Chinese translation directly below (separated by a blank line). Include the episode URL after both versions.`;

    try {
      const summary = await callGemini(prompt);
      podcastSummaries.push(summary.trim());
    } catch (e) {
      console.error(`Failed to summarize podcast ${pod.name}:`, e.message);
    }
  }

  if (podcastSummaries.length > 0) {
    sections.push(`PODCASTS\n${'─'.repeat(40)}\n\n${podcastSummaries.join('\n\n---\n\n')}`);
  }

  const digest = [
    `AI Builders Digest — ${today}`,
    '═'.repeat(50),
    '',
    sections.join('\n\n' + '═'.repeat(50) + '\n\n'),
    '',
    '─'.repeat(50),
    'Generated through the Follow Builders skill: https://github.com/zarazhangrui/follow-builders'
  ].join('\n');

  console.log(digest);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
