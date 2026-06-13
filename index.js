require('dotenv').config();
const chalk = require('chalk');
const { Command } = require('commander');
const cron = require('node-cron');

const { fetchHackerNews } = require('./src/crawlers/hackernews');
const { fetchArxiv } = require('./src/crawlers/arxiv');
const { fetchPapersWithCode } = require('./src/crawlers/paperswithcode');
const { fetchHuggingFace } = require('./src/crawlers/huggingface');
const { fetchOpenAIBlog } = require('./src/crawlers/openai');
const { save, readAll } = require('./src/storage/store');
const { exportData } = require('./src/utils/export');
const { analyzeArticles, listRoles } = require('./src/analysis/analyzer');

const SOURCES = {
  hackernews:     { fn: fetchHackerNews,     label: 'Hacker News' },
  arxiv:          { fn: fetchArxiv,          label: 'arXiv' },
  paperswithcode: { fn: fetchPapersWithCode,  label: 'Papers with Code' },
  huggingface:    { fn: fetchHuggingFace,    label: 'Hugging Face Blog' },
  openai:         { fn: fetchOpenAIBlog,     label: 'OpenAI Blog' },
};

async function runSource(name, source, days) {
  process.stdout.write(chalk.cyan(`  [${source.label}] fetching... `));
  try {
    const articles = await source.fn(days);
    const saved = await save(name, articles);
    console.log(chalk.green(`✓ ${articles.length} fetched, ${saved} new`));
    return articles;
  } catch (err) {
    console.log(chalk.red(`✗ ${err.message}`));
    return [];
  }
}

async function crawlAll(targets, options) {
  const days = Number(options.days) || 1;
  const names = targets.length ? targets : Object.keys(SOURCES);
  const rangeLabel = days === 1 ? 'today' : `last ${days} days`;
  console.log(chalk.bold(`\n🕷  Crawling ${rangeLabel} — ${new Date().toLocaleString()}\n`));

  let total = 0;
  for (const name of names) {
    const source = SOURCES[name];
    if (!source) { console.log(chalk.yellow(`  Unknown source: ${name}`)); continue; }
    const articles = await runSource(name, source, days);
    total += articles.length;
  }

  console.log(chalk.bold(`\n✅ Done. ${total} articles fetched.\n`));
}

async function list(options) {
  const all = await readAll();
  let items = all;

  if (options.source) {
    items = items.filter(a => a.source.toLowerCase().includes(options.source.toLowerCase()));
  }
  if (options.keyword) {
    const kw = options.keyword.toLowerCase();
    items = items.filter(a =>
      a.title.toLowerCase().includes(kw) ||
      (a.summary || '').toLowerCase().includes(kw)
    );
  }

  items = items
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, Number(options.limit) || 20);

  if (!items.length) {
    console.log(chalk.yellow('No articles found. Run `node index.js crawl` first.'));
    return;
  }

  console.log(chalk.bold(`\n📰 ${items.length} articles:\n`));
  for (const a of items) {
    console.log(chalk.green(`[${a.source}]`) + ' ' + chalk.bold(a.title));
    if (a.summary) console.log(chalk.gray('  ' + a.summary.slice(0, 120) + '...'));
    console.log(chalk.blue('  ' + a.url));
    console.log();
  }
}

async function exportCmd(options) {
  const all = await readAll();
  let items = all;

  if (options.source) {
    items = items.filter(a => a.source.toLowerCase().includes(options.source.toLowerCase()));
  }
  if (options.keyword) {
    const kw = options.keyword.toLowerCase();
    items = items.filter(a =>
      a.title.toLowerCase().includes(kw) ||
      (a.summary || '').toLowerCase().includes(kw)
    );
  }
  if (options.days) {
    const since = Date.now() - Number(options.days) * 86400 * 1000;
    items = items.filter(a => new Date(a.publishedAt).getTime() >= since);
  }

  items = items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  const formats = options.format ? options.format.split(',') : ['json', 'csv', 'md'];
  const files = await exportData(items, formats);

  console.log(chalk.bold(`\n✅ Exported ${items.length} articles:\n`));
  files.forEach(f => console.log(chalk.blue('  ' + f)));
  console.log();
}

async function analyzeCmd(options) {
  if (options.listRoles) {
    const roles = listRoles();
    console.log(chalk.bold('\n可用角色:\n'));
    for (const r of roles) {
      console.log(`  ${r.emoji}  ${chalk.bold(r.key.padEnd(12))} ${r.name}`);
      console.log(chalk.gray(`       分析模块: ${r.sections.join(' · ')}`));
      console.log();
    }
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(chalk.red('Error: ANTHROPIC_API_KEY 未设置'));
    console.log(chalk.gray('  在 .env 文件中添加: ANTHROPIC_API_KEY=sk-ant-...'));
    process.exit(1);
  }

  const all = await readAll();
  let items = all;

  if (options.source) {
    items = items.filter(a => a.source.toLowerCase().includes(options.source.toLowerCase()));
  }
  if (options.days) {
    const since = Date.now() - Number(options.days) * 86400 * 1000;
    items = items.filter(a => new Date(a.publishedAt).getTime() >= since);
  }

  items = items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  if (!items.length) {
    console.log(chalk.yellow('没有找到文章，请先运行 `node index.js crawl`'));
    return;
  }

  const roles = options.role ? options.role.split(',').map(r => r.trim()) : ['pm'];

  for (const role of roles) {
    try {
      const outFile = await analyzeArticles(items, { days: options.days, role });
      console.log(chalk.bold(`\n✅ 分析完成:\n`));
      console.log(chalk.blue('  ' + outFile));
      console.log();
    } catch (err) {
      console.log(chalk.red(`\n✗ [${role}] 分析失败: ${err.message}`));
    }
  }
}

function scheduleJob(cronExpr) {
  console.log(chalk.bold(`\n⏰ Scheduler started (${cronExpr})\n`));
  crawlAll([], { days: 1 });
  cron.schedule(cronExpr, () => crawlAll([], { days: 1 }));
}

const program = new Command();

program
  .name('learning-crawler')
  .description('AI & tech article crawler')
  .version('1.0.0');

program
  .command('crawl [sources...]')
  .description('Crawl articles. Sources: ' + Object.keys(SOURCES).join(', '))
  .option('-d, --days <n>', 'how many days back to fetch', '1')
  .action(crawlAll);

program
  .command('list')
  .description('List saved articles')
  .option('-s, --source <name>', 'filter by source')
  .option('-k, --keyword <word>', 'filter by keyword')
  .option('-l, --limit <n>', 'max results', '20')
  .action(list);

program
  .command('export')
  .description('Export articles to results/ folder (json, csv, md)')
  .option('-s, --source <name>', 'filter by source')
  .option('-k, --keyword <word>', 'filter by keyword')
  .option('-d, --days <n>', 'only last N days')
  .option('-f, --format <formats>', 'comma-separated: json,csv,md', 'json,csv,md')
  .action(exportCmd);

program
  .command('analyze')
  .description('用 Claude AI 分析文章，支持角色: pm / engineer / ops / developer')
  .option('-r, --role <roles>', '角色（逗号分隔多个）: pm,engineer,ops,developer', 'pm')
  .option('-s, --source <name>', '按来源筛选')
  .option('-d, --days <n>', '最近 N 天的文章')
  .option('-l, --list-roles', '列出所有可用角色')
  .action(analyzeCmd);

program
  .command('schedule [cron]')
  .description('Run on a schedule (default: every 6 hours)')
  .action((expr) => scheduleJob(expr || '0 */6 * * *'));

program.parse();
