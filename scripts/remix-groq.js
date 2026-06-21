#!/usr/bin/env node

// Reads raw JSON from prepare-digest.js (via stdin),
// calls Groq API to generate a bilingual digest, prints result to stdout.

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
      'Authorization': `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2048,
      temperature: 0.7
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq API error: ${err}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8');
  const data = JSON.parse(raw);

  if (data.status !== 'ok') {
    process.exit(1);
  }

  const { x, podcasts, blogs, prompts, stats } = data;

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
      `Tweet: ${t.text}\nURL: ${t.url}`
    ).join('\n\n');

    const prompt = `${prompts.summarize_tweets}

Builder: ${builder.name}
Bio: ${builder.bio}

Recent posts:
${tweetLines}

Language: Write in BILINGUAL mode — English summary first, then Chinese translation directly below (separated by a blank line). Include the tweet URL(s) after both versions. Interleave English and Chinese, do NOT output all English first.`;

    try {
      const summary = await callGroq(prompt);
      tweetSummaries.push(summary.trim());
    } catch (e) {
      // skip on error
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
Content:
${(blog.content || blog.description || '').slice(0, 4000)}

Language: Write in BILINGUAL mode — English summary first, then Chinese translation directly below (separated by a blank line). Include the article URL after both versions.`;

    try {
      const summary = await callGroq(prompt);
      blogSummaries.push(summary.trim());
    } catch (e) {
      // skip on error
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
Transcript (first 4000 chars):
${pod.transcript.slice(0, 4000)}

Language: Write in BILINGUAL mode — English summary first, then Chinese translation directly below (separated by a blank line). Include the episode URL after both versions.`;

    try {
      const summary = await callGroq(prompt);
      podcastSummaries.push(summary.trim());
    } catch (e) {
      // skip on error
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
