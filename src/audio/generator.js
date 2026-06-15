const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { HttpsProxyAgent } = require('https-proxy-agent/dist/index');
const nodeFetch = require('node-fetch');
const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
const fse = require('fs-extra');
const path = require('path');
const dayjs = require('dayjs');
const chalk = require('chalk');

const RESULTS_DIR = path.resolve(__dirname, '../../results');
const AUDIO_DIR = path.resolve(__dirname, '../../results/audio');

const PROXY = process.env.http_proxy || process.env.https_proxy || process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
const proxyAgent = PROXY ? new HttpsProxyAgent(PROXY) : null;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  ...(proxyAgent && { httpAgent: proxyAgent }),
});

const geminiClient = new OpenAI({
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
  apiKey: process.env.GEMINI_API_KEY,
  fetch: proxyAgent ? (url, init) => nodeFetch(url, { ...init, agent: proxyAgent }) : undefined,
});

const groqClient = new OpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: process.env.GROQ_API_KEY,
  fetch: proxyAgent ? (url, init) => nodeFetch(url, { ...init, agent: proxyAgent }) : undefined,
});

function getPollyClient() {
  const config = { region: process.env.AWS_REGION || 'us-east-1' };
  if (process.env.AWS_ACCESS_KEY_ID) {
    config.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
  }
  return new PollyClient(config);
}

async function generateScript(markdownContents, rangeLabel) {
  const combined = markdownContents
    .map(({ role, content }) => `=== ${role} ===\n${content.slice(0, 800)}`)
    .join('\n\n');

  const prompt =
    `你是一名 AI 资讯播客主持人，需要将以下多角色分析报告整合成一段流畅的中文播客脚本（3-5分钟，约600-900字）。\n\n` +
    `报告范围：${rangeLabel}\n\n${combined}\n\n` +
    `要求：\n` +
    `1. 开头用一句话点题，结尾有简短总结\n` +
    `2. 按"产品视角→开发者视角→工程师视角→运营视角"顺序展开，每个视角2-3个核心观点\n` +
    `3. 语言口语化，像真实播客一样自然流畅，避免列表格式\n` +
    `4. 只输出脚本正文，不要标题或备注`;

  const providers = [
    { name: 'GROQ',      call: () => groqClient.chat.completions.create({ model: 'llama-3.3-70b-versatile', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }).then(r => r.choices[0].message.content.trim()) },
    { name: 'Gemini',    call: () => geminiClient.chat.completions.create({ model: 'gemini-2.0-flash', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }).then(r => r.choices[0].message.content.trim()) },
    { name: 'Anthropic', call: () => anthropic.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }).then(r => r.content[0].text.trim()) },
  ];

  for (const p of providers) {
    try {
      const text = await p.call();
      console.log(chalk.gray(`  [脚本引擎: ${p.name}]`));
      return text;
    } catch (e) {
      console.log(chalk.yellow(`  ${p.name} 不可用，切换下一个... (${e.message.slice(0, 60)})`));
    }
  }
  throw new Error('所有脚本生成引擎均不可用');
}

async function synthesizeSpeech(script, outFile) {
  const polly = getPollyClient();
  const command = new SynthesizeSpeechCommand({
    Text: script,
    OutputFormat: 'mp3',
    VoiceId: 'Zhiyu',
    Engine: 'neural',
    LanguageCode: 'cmn-CN',
  });

  const response = await polly.send(command);
  const chunks = [];
  for await (const chunk of response.AudioStream) {
    chunks.push(chunk);
  }
  await fse.outputFile(outFile, Buffer.concat(chunks));
}

async function generateAudio(dateLabel) {
  await fse.ensureDir(AUDIO_DIR);

  const files = await fse.readdir(RESULTS_DIR);
  const mdFiles = files.filter(f => f.endsWith(`-${dateLabel}.md`));

  if (!mdFiles.length) {
    throw new Error(`没有找到 ${dateLabel} 的报告文件`);
  }

  const ROLE_NAMES = { pm: '产品经理', developer: '开发者', engineer: '工程师', ops: '运营' };
  const markdownContents = [];

  for (const file of mdFiles) {
    const roleMatch = file.match(/^analysis-(\w+)-/);
    if (!roleMatch) continue;
    const role = ROLE_NAMES[roleMatch[1]] || roleMatch[1];
    const content = await fse.readFile(path.join(RESULTS_DIR, file), 'utf-8');
    markdownContents.push({ role, content });
  }

  const rangeLabel = `${dateLabel} 周报`;
  console.log(chalk.cyan(`\n🎙  生成播客脚本（${dateLabel}）...\n`));
  const script = await generateScript(markdownContents, rangeLabel);

  const scriptFile = path.join(AUDIO_DIR, `script-${dateLabel}.txt`);
  await fse.outputFile(scriptFile, script, 'utf-8');
  console.log(chalk.gray(`  脚本已保存: ${scriptFile}`));
  console.log(chalk.gray('\n--- 脚本预览 ---'));
  console.log(chalk.white(script.slice(0, 300) + '...'));
  console.log(chalk.gray('----------------\n'));

  const audioFile = path.join(AUDIO_DIR, `audio-${dateLabel}.mp3`);
  console.log(chalk.cyan(`🔊  合成语音...\n`));
  await synthesizeSpeech(script, audioFile);

  console.log(chalk.green(`✅  音频已生成: ${audioFile}\n`));
  return { scriptFile, audioFile };
}

module.exports = { generateAudio };
