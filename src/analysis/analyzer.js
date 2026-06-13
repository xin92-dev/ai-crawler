const OpenAI = require('openai');
const { HttpsProxyAgent } = require('https-proxy-agent/dist/index');
const nodeFetch = require('node-fetch');
const fse = require('fs-extra');
const path = require('path');
const dayjs = require('dayjs');
const chalk = require('chalk');

const RESULTS_DIR = path.resolve(__dirname, '../../../results');

const PROVIDER = process.env.AI_PROVIDER || 'groq';

const PROVIDERS = {
  groq: {
    baseURL: 'https://api.groq.com/openai/v1',
    apiKey: process.env.GROQ_API_KEY,
    model: 'llama-3.3-70b-versatile',
  },
  deepseek: {
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: process.env.DEEPSEEK_API_KEY,
    model: 'deepseek-chat',
  },
  gemini: {
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-1.5-flash',
  },
};

const ROLES = {
  pm: {
    name: '产品经理',
    emoji: '📱',
    color: 'magenta',
    sections: [
      {
        key: 'opportunities',
        title: '产品机会点',
        prompt: (list, meta) =>
          `你是一名资深 AI 产品经理，正在为产品团队撰写周报。\n\n` +
          `以下是近期 ${meta.total} 篇 AI/ML 资讯（${meta.range}）：\n\n${list}\n\n` +
          `请从产品视角分析：\n` +
          `1. **值得关注的产品机会**（3-5个）：哪些技术突破可以转化为产品功能？用户痛点如何被新技术解决？\n` +
          `2. **具体场景描述**：每个机会点给出 1-2 句"用户故事"（用户在什么情境下用这个功能）\n` +
          `3. **落地难度评估**：标注 🟢易/🟡中/🔴难\n\n` +
          `输出为 markdown，每个机会点用 ### 标题，语言简洁有力。`,
      },
      {
        key: 'competitive',
        title: '竞品与市场动态',
        prompt: (list, meta) =>
          `你是一名 AI 产品竞品分析师。\n\n` +
          `资讯列表（${meta.total} 篇，${meta.range}）：\n\n${list}\n\n` +
          `请分析：\n` +
          `1. **主要玩家动态**：Google、OpenAI、Meta、Anthropic、Mistral 等有哪些新动作？\n` +
          `2. **差异化策略**：各家当前在哪个方向发力？技术路线有何不同？\n` +
          `3. **市场格局变化**：有无新的潜力选手或颠覆性方向出现？\n` +
          `4. **对我们产品的启示**：1-2 句直接结论。\n\n` +
          `用表格或 bullet 输出，重点突出，避免废话。`,
      },
      {
        key: 'watchlist',
        title: '本周必读清单',
        prompt: (list, meta) =>
          `你是产品经理的信息过滤助手。\n\n` +
          `从以下 ${meta.total} 篇资讯中（${meta.range}）：\n\n${list}\n\n` +
          `为产品经理挑选 **5篇必读文章**，标准：\n` +
          `- 直接影响产品决策\n` +
          `- 包含用户行为/市场数据\n` +
          `- 有竞品新产品/功能发布\n\n` +
          `每篇给出：标题 + 来源 + 一句话说明"为什么产品经理要读这篇"。\n` +
          `格式：编号列表，简洁直接。`,
      },
    ],
  },

  engineer: {
    name: '工程师',
    emoji: '⚙️',
    color: 'cyan',
    sections: [
      {
        key: 'tech_trends',
        title: '技术趋势速览',
        prompt: (list, meta) =>
          `你是一名 AI/ML 系统工程师，为团队撰写技术周报。\n\n` +
          `资讯列表（${meta.total} 篇，${meta.range}）：\n\n${list}\n\n` +
          `请分析：\n` +
          `1. **模型架构动向**：有哪些新的架构思路、训练方法或效率改进？\n` +
          `2. **性能 Benchmark 更新**：有无新的 SOTA 结果？在哪些任务上？\n` +
          `3. **推理与部署**：量化、蒸馏、边缘部署方面有何进展？\n` +
          `4. **值得复现的工作**：哪些论文或项目工程师应该动手跑一跑？\n\n` +
          `用技术精准的语言，bullet + 小标题格式，避免泛泛而谈。`,
      },
      {
        key: 'papers',
        title: '重点论文解读',
        prompt: (list, meta) =>
          `你是 ML 论文解读专家。\n\n` +
          `从以下资讯中（${meta.total} 篇，${meta.range}）：\n\n${list}\n\n` +
          `挑选 **4-6 篇最值得工程师精读的论文**，对每篇提供：\n` +
          `- **核心贡献**（1句话）\n` +
          `- **技术亮点**（2-3个 bullet，具体说方法/结果）\n` +
          `- **工程师视角**：实现难度如何？有无开源代码？对实际系统的影响？\n\n` +
          `用 ### 标题，技术细节要准确，不要模糊化处理。`,
      },
      {
        key: 'infra',
        title: '基础设施与工具链',
        prompt: (list, meta) =>
          `你是 MLOps/AI 基础设施工程师。\n\n` +
          `资讯列表（${meta.total} 篇，${meta.range}）：\n\n${list}\n\n` +
          `重点梳理：\n` +
          `1. **框架与库更新**：PyTorch、JAX、vLLM、TGI、Transformers 等有无重要版本或特性？\n` +
          `2. **训练/推理基础设施**：分布式训练、serving 优化、成本控制方面的进展\n` +
          `3. **新工具推荐**：值得加入工具链的新项目（附理由）\n` +
          `4. **需要注意的 Breaking Change**：有无影响现有系统的变更？\n\n` +
          `直接给出操作建议，格式清晰。`,
      },
    ],
  },

  ops: {
    name: '运营',
    emoji: '📣',
    color: 'yellow',
    sections: [
      {
        key: 'hotspot',
        title: '本周热点话题',
        prompt: (list, meta) =>
          `你是 AI 科技领域的内容运营专家。\n\n` +
          `资讯列表（${meta.total} 篇，${meta.range}）：\n\n${list}\n\n` +
          `请整理出本周 AI 圈最火的 **5-7 个话题**：\n` +
          `- **话题名称**（简洁，适合做标题）\n` +
          `- **热度来源**：为什么这个话题在传播？是争议？突破？还是情绪点？\n` +
          `- **受众画像**：哪类用户最关心这个话题（研究者/开发者/普通用户）？\n` +
          `- **内容切入角度**：如果我们要发一篇文章，最吸引人的角度是什么？\n\n` +
          `语言活泼，有运营感，避免学术腔。`,
      },
      {
        key: 'content_plan',
        title: '内容创作计划',
        prompt: (list, meta) =>
          `你是科技媒体内容策划，负责 AI 方向的选题。\n\n` +
          `基于本周资讯（${meta.total} 篇，${meta.range}）：\n\n${list}\n\n` +
          `输出一份 **本周内容日历**（7天）：\n` +
          `每天建议 1 个选题，包含：\n` +
          `- 标题（10字以内，有吸引力）\n` +
          `- 内容方向（100字以内的策划说明）\n` +
          `- 参考资讯来源（从列表中引用）\n` +
          `- 推荐发布平台（微信公众号/X/LinkedIn/掘金 等）\n\n` +
          `按日期排成表格，易于直接执行。`,
      },
      {
        key: 'community',
        title: '社区舆情与用户声音',
        prompt: (list, meta) =>
          `你是社区运营分析师，关注 AI 领域的用户讨论和舆情走向。\n\n` +
          `资讯列表（${meta.total} 篇，${meta.range}）：\n\n${list}\n\n` +
          `请分析：\n` +
          `1. **当前社区情绪**：整体是兴奋/焦虑/质疑？主要情绪驱动因素是什么？\n` +
          `2. **用户关心的核心问题**：从这些资讯中推断，用户最想知道什么？\n` +
          `3. **争议话题**：有没有分歧明显的话题？正反两方的核心论点是什么？\n` +
          `4. **运营建议**：基于以上，这周社区互动/活动的切入点是什么？\n\n` +
          `语言贴近用户，有洞察力，不要泛泛而谈。`,
      },
    ],
  },

  developer: {
    name: '开发者',
    emoji: '💻',
    color: 'green',
    sections: [
      {
        key: 'tools',
        title: '开源工具与框架',
        prompt: (list, meta) =>
          `你是一名全栈 AI 应用开发者，每周梳理值得关注的开源项目。\n\n` +
          `资讯列表（${meta.total} 篇，${meta.range}）：\n\n${list}\n\n` +
          `请整理：\n` +
          `1. **本周明星开源项目**（3-5个）：名称、stars趋势、核心功能、适用场景\n` +
          `2. **API/SDK 更新**：有哪些重要的 API 变更或新能力释放？\n` +
          `3. **框架生态**：LangChain、LlamaIndex、Haystack、AutoGen 等有无值得关注的更新？\n` +
          `4. **上手难度**：每个项目标注 🟢简单/🟡中等/🔴复杂\n\n` +
          `附上 GitHub 仓库名（如果能从资讯中推断），格式清晰易扫描。`,
      },
      {
        key: 'tutorials',
        title: '实战教程与最佳实践',
        prompt: (list, meta) =>
          `你是开发者社区的技术布道师。\n\n` +
          `从以下资讯中（${meta.total} 篇，${meta.range}）：\n\n${list}\n\n` +
          `挑选 **4-5 个值得动手实践的技术点**，每个提供：\n` +
          `- **做什么**：一句话描述这个技术实践\n` +
          `- **为什么现在做**：当前时机的理由\n` +
          `- **快速上手路径**：3步或更少的起步方法\n` +
          `- **预期收获**：完成后能解决什么问题或获得什么能力\n\n` +
          `面向有一定基础的开发者，跳过基础解释，直接讲关键步骤。`,
      },
      {
        key: 'radar',
        title: '技术雷达：关注 / 试用 / 落地',
        prompt: (list, meta) =>
          `你是开发者技术选型顾问，帮助团队判断哪些技术值得投入。\n\n` +
          `基于本周资讯（${meta.total} 篇，${meta.range}）：\n\n${list}\n\n` +
          `输出技术雷达，分三档：\n\n` +
          `**🔭 关注**（Watch）：新出现、还不成熟，但方向对，保持观察\n` +
          `**🧪 试用**（Trial）：可以在小项目/side project 中试用，有实际价值\n` +
          `**🚀 落地**（Adopt）：成熟稳定，建议在生产项目中采用\n\n` +
          `每档 2-4 项，每项一句理由。简洁，有判断力，不废话。`,
      },
    ],
  },
};

const providerConfig = PROVIDERS[PROVIDER];
if (!providerConfig) throw new Error(`Unknown AI_PROVIDER: ${PROVIDER}`);

const PROXY = process.env.http_proxy || process.env.https_proxy || 'http://127.0.0.1:7890';
const proxyAgent = new HttpsProxyAgent(PROXY);

const client = new OpenAI({
  baseURL: providerConfig.baseURL,
  apiKey: providerConfig.apiKey,
  fetch: (url, init) => nodeFetch(url, { ...init, agent: proxyAgent }),
});

function buildArticleList(articles) {
  return articles
    .slice(0, 80)
    .map((a, i) =>
      `${i + 1}. [${a.source}] ${a.title}` +
      (a.summary ? `\n   ${a.summary.slice(0, 150)}` : '')
    )
    .join('\n\n');
}

async function streamSection(prompt) {
  const stream = await client.chat.completions.create({
    model: providerConfig.model,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
  });

  let fullText = '';
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content || '';
    if (text) {
      process.stdout.write(text);
      fullText += text;
    }
  }
  console.log();
  return fullText;
}

async function analyzeArticles(articles, options = {}) {
  const roleKey = options.role || 'pm';
  const role = ROLES[roleKey];

  if (!role) {
    const valid = Object.keys(ROLES).join(', ');
    throw new Error(`Unknown role "${roleKey}". Valid roles: ${valid}`);
  }

  const date = dayjs().format('YYYY-MM-DD');
  const dayRange = options.days ? `最近 ${options.days} 天` : '今日';
  const meta = { total: articles.length, range: dayRange };
  const articleList = buildArticleList(articles);

  const colorFn = chalk[role.color] || chalk.white;

  console.log(colorFn(`\n${role.emoji}  角色：${role.name} | ${meta.total} 篇文章 | ${dayRange}\n`));

  let output = `# ${role.emoji} AI 资讯分析 — ${role.name}视角\n\n`;
  output += `**日期：** ${date}  |  **范围：** ${dayRange}  |  **文章数：** ${meta.total}\n\n---\n\n`;

  for (let i = 0; i < role.sections.length; i++) {
    const section = role.sections[i];
    console.log(colorFn(`\n[${i + 1}/${role.sections.length}] ${section.title}...\n`));

    output += `## ${section.title}\n\n`;
    const result = await streamSection(section.prompt(articleList, meta), colorFn);
    output += result + '\n\n---\n\n';
  }

  await fse.ensureDir(RESULTS_DIR);
  const outFile = path.join(RESULTS_DIR, `analysis-${roleKey}-${date}.md`);
  await fse.writeFile(outFile, output, 'utf-8');

  return outFile;
}

function listRoles() {
  return Object.entries(ROLES).map(([key, r]) => ({
    key,
    name: r.name,
    emoji: r.emoji,
    sections: r.sections.map(s => s.title),
  }));
}

module.exports = { analyzeArticles, listRoles, ROLES };
