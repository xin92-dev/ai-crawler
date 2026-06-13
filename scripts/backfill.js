/**
 * 补爬指定日期范围的文章
 * 用法: node scripts/backfill.js <from> <to>
 * 示例: node scripts/backfill.js 2026-06-01 2026-06-07
 *
 * 专门解决 arXiv max_results=100 导致中间周数据缺失的问题。
 */

require('dotenv').config();
const cheerio = require('cheerio');
const chalk   = require('chalk');
const { get } = require('../src/utils/request');
const { save } = require('../src/storage/store');

const [,, FROM_ARG, TO_ARG] = process.argv;
if (!FROM_ARG || !TO_ARG) {
  console.error('用法: node scripts/backfill.js <from-date> <to-date>');
  console.error('示例: node scripts/backfill.js 2026-06-01 2026-06-07');
  process.exit(1);
}

const fromDate = new Date(FROM_ARG + 'T00:00:00Z');
const toDate   = new Date(TO_ARG   + 'T23:59:59Z');

if (isNaN(fromDate) || isNaN(toDate)) {
  console.error('日期格式无效，请使用 YYYY-MM-DD');
  process.exit(1);
}

// 格式化为 arXiv API 要求的 YYYYMMDDHHmmss
function arxivDate(d) {
  return d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

const ARXIV_QUERIES = [
  { q: 'cat:cs.AI', category: 'AI' },
  { q: 'cat:cs.LG', category: 'Machine Learning' },
  { q: 'cat:cs.CL', category: 'NLP' },
];

// ── arXiv 补爬（用服务端 submittedDate 过滤 + 更大的 max_results） ──
async function backfillArxiv() {
  const articles = [];

  for (const { q, category } of ARXIV_QUERIES) {
    try {
      // 用 start 分页拿满（每次 200，最多 2 页）
      for (let start = 0; start <= 200; start += 200) {
        // arXiv API 要求保留 +/:/[] 为字面量，不能用 encodeURIComponent
        const rawQuery = `${q}+AND+submittedDate:[${arxivDate(fromDate)}+TO+${arxivDate(toDate)}]`;
        const url = `https://export.arxiv.org/api/query?search_query=${rawQuery}&start=${start}&max_results=200&sortBy=submittedDate&sortOrder=descending`;

        const xml = await get(url, { headers: { Accept: 'application/atom+xml' } });
        const $   = cheerio.load(xml, { xmlMode: true });
        const entries = $('entry');

        if (!entries.length) break;

        entries.each((_, el) => {
          const title   = $(el).find('title').first().text().trim();
          const link    = $(el).find('id').text().trim();
          const summary = $(el).find('summary').text().trim();
          const authors = $(el).find('author name').map((_, a) => $(a).text().trim()).get().join(', ');
          const published = $(el).find('published').text().trim();
          if (!title || !link) return;

          const pubDate = published ? new Date(published) : null;

          articles.push({
            source: 'arXiv',
            category,
            title,
            url: link.replace('http://', 'https://'),
            author: authors,
            summary: summary.replace(/\s+/g, ' ').slice(0, 300),
            publishedAt: pubDate ? pubDate.toISOString() : fromDate.toISOString(),
            crawledAt: new Date().toISOString(),
          });
        });

        // 如果返回条目少于请求量，说明已取完
        if (entries.length < 200) break;
      }

      process.stdout.write(chalk.green(`  arXiv [${category}] `));
    } catch (err) {
      process.stdout.write(chalk.red(`  arXiv [${category}] failed: ${err.message}`));
    }
  }

  return articles;
}

// ── HuggingFace Papers 补爬（增大翻页上限到 30 页） ────────
async function backfillPapersWithCode() {
  const articles = [];
  let page = 1;

  while (page <= 30) {
    try {
      const html = await get(`https://huggingface.co/papers?page=${page}`);
      const $ = cheerio.load(html);

      let foundOnPage = 0;
      let tooOld = false;

      $('article, [class*="paper"]').each((_, el) => {
        const a    = $(el).find('a[href^="/papers/"]').first();
        const href = a.attr('href');
        if (!href || href === '/papers') return;

        const title    = $(el).find('h3, h2, [class*="title"]').first().text().trim() || a.text().trim();
        if (!title) return;

        const summary  = $(el).find('p, [class*="abstract"]').first().text().trim();
        const dateAttr = $(el).find('time').attr('datetime') || $(el).find('time').text().trim();
        const pubDate  = dateAttr ? new Date(dateAttr) : null;

        // 比目标范围还新的跳过，比目标范围还老的停止翻页
        if (pubDate) {
          if (pubDate.getTime() > toDate.getTime()) return;   // 太新，继续找
          if (pubDate.getTime() < fromDate.getTime()) { tooOld = true; return false; }
        }

        foundOnPage++;
        articles.push({
          source: 'Papers with Code',
          category: 'research',
          title,
          url: `https://huggingface.co${href}`,
          author: $(el).find('[class*="author"]').text().trim(),
          summary: summary.slice(0, 300),
          publishedAt: pubDate ? pubDate.toISOString() : fromDate.toISOString(),
          crawledAt: new Date().toISOString(),
        });
      });

      if (tooOld || foundOnPage === 0) break;
      page++;
    } catch (err) {
      console.error(chalk.red(`  Papers page ${page} failed: ${err.message}`));
      break;
    }
  }

  const seen = new Set();
  return articles.filter(a => { if (seen.has(a.url)) return false; seen.add(a.url); return true; });
}

// ── HackerNews 补爬（Algolia 时间段查询，本来就准确） ───────
async function backfillHackerNews() {
  const AI_KEYWORDS = ['ai', 'llm', 'gpt', 'machine learning', 'deep learning', 'neural',
    'anthropic', 'openai', 'gemini', 'mistral', 'transformer', 'diffusion', 'agent',
    'claude', 'chatgpt', 'generative', 'reinforcement', 'embedding', 'fine-tun'];

  const since = Math.floor(fromDate.getTime() / 1000);
  const until = Math.floor(toDate.getTime()   / 1000);
  const articles = [];
  let page = 0;

  while (true) {
    const data = await get('https://hn.algolia.com/api/v1/search', {
      params: {
        tags: 'story',
        numericFilters: `created_at_i>${since},created_at_i<${until}`,
        hitsPerPage: 50,
        page,
      },
    });

    if (!data?.hits?.length) break;

    for (const item of data.hits) {
      if (!item.url || !item.title) continue;
      const t = item.title.toLowerCase();
      if (!AI_KEYWORDS.some(kw => t.includes(kw))) continue;
      articles.push({
        source: 'Hacker News',
        category: 'ai',
        title: item.title,
        url: item.url,
        author: item.author || '',
        summary: '',
        score: item.points || 0,
        publishedAt: new Date(item.created_at).toISOString(),
        crawledAt: new Date().toISOString(),
      });
    }

    if (page >= (data.nbPages || 1) - 1) break;
    page++;
  }

  return articles;
}

// ── 主流程 ───────────────────────────────────────────────
async function main() {
  console.log(chalk.bold(`\n📦 补爬 ${FROM_ARG} → ${TO_ARG}\n`));

  const tasks = [
    { name: 'arxiv',          label: 'arXiv',            fn: backfillArxiv         },
    { name: 'paperswithcode', label: 'Papers with Code', fn: backfillPapersWithCode },
    { name: 'hackernews',     label: 'Hacker News',      fn: backfillHackerNews    },
  ];

  let grand = 0;
  for (const { name, label, fn } of tasks) {
    process.stdout.write(chalk.cyan(`  [${label}] fetching... `));
    try {
      const articles = await fn();
      const saved = await save(name, articles);
      console.log(chalk.green(`✓ ${articles.length} fetched, ${saved} new`));
      grand += saved;
    } catch (err) {
      console.log(chalk.red(`✗ ${err.message}`));
    }
  }

  console.log(chalk.bold(`\n✅ 补爬完成，新增 ${grand} 篇\n`));
}

main().catch(err => { console.error(err); process.exit(1); });
