const cheerio = require('cheerio');
const { get } = require('../utils/request');

// OpenAI blocks scrapers; use their sitemap-linked RSS alternatives:
// - Anthropic News RSS
// - Google DeepMind Blog RSS
// - The Gradient RSS
const FEEDS = [
  { url: 'https://www.technologyreview.com/feed/',                      source: 'MIT Tech Review' },
  { url: 'https://deepmind.google/blog/rss.xml',                        source: 'Google DeepMind' },
  { url: 'https://thegradient.pub/rss/',                                source: 'The Gradient' },
];

async function fetchOpenAIBlog(days = 1) {
  const since = Date.now() - days * 86400 * 1000;
  const articles = [];

  for (const feed of FEEDS) {
    try {
      const xml = await get(feed.url, { headers: { Accept: 'application/rss+xml, text/xml' } });
      const $ = cheerio.load(xml, { xmlMode: true });

      $('item, entry').each((_, el) => {
        const title = $(el).find('title').first().text().trim();
        const link = $(el).find('link').text().trim()
          || $(el).find('link').attr('href')
          || $(el).find('guid').text().trim();
        const summary = $(el).find('description, summary, content').first()
          .text().replace(/<[^>]+>/g, '').trim();
        const author = $(el).find('author name, dc\\:creator, author').first().text().trim();
        const pubDate = $(el).find('pubDate, published, updated').first().text().trim();

        if (!title || !link) return;

        const pub = pubDate ? new Date(pubDate) : null;
        if (pub && pub.getTime() < since) return;

        articles.push({
          source: feed.source,
          category: 'ai',
          title,
          url: link,
          author,
          summary: summary.slice(0, 300),
          publishedAt: pub ? pub.toISOString() : new Date().toISOString(),
          crawledAt: new Date().toISOString(),
        });
      });
    } catch (err) {
      console.error(`${feed.source} failed: ${err.message}`);
    }
  }

  return articles;
}

module.exports = { fetchOpenAIBlog };
