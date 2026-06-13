const cheerio = require('cheerio');
const { get } = require('../utils/request');

// HuggingFace Daily Papers (AK's curation) — same dataset as Papers with Code trending
async function fetchPapersWithCode(days = 1) {
  const since = Date.now() - days * 86400 * 1000;
  const articles = [];
  let page = 1;

  while (true) {
    const html = await get(`https://huggingface.co/papers?page=${page}`);
    const $ = cheerio.load(html);

    let foundOnPage = 0;
    let tooOld = false;

    $('article, [class*="paper"]').each((_, el) => {
      const a = $(el).find('a[href^="/papers/"]').first();
      const href = a.attr('href');
      if (!href || href === '/papers') return;

      const title = $(el).find('h3, h2, [class*="title"]').first().text().trim() || a.text().trim();
      if (!title) return;

      const summary = $(el).find('p, [class*="abstract"]').first().text().trim();
      const dateAttr = $(el).find('time').attr('datetime') || $(el).find('time').text().trim();
      const pubDate = dateAttr ? new Date(dateAttr) : null;

      if (pubDate && pubDate.getTime() < since) {
        tooOld = true;
        return false;
      }

      foundOnPage++;
      articles.push({
        source: 'Papers with Code',
        category: 'research',
        title,
        url: `https://huggingface.co${href}`,
        author: $(el).find('[class*="author"]').text().trim(),
        summary: summary.slice(0, 300),
        publishedAt: pubDate ? pubDate.toISOString() : new Date().toISOString(),
        crawledAt: new Date().toISOString(),
      });
    });

    if (tooOld || foundOnPage === 0 || page >= 10) break;
    page++;
  }

  const seen = new Set();
  return articles.filter(a => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });
}

module.exports = { fetchPapersWithCode };
