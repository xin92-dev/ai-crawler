const fse = require('fs-extra');
const path = require('path');
const dayjs = require('dayjs');

const DATA_DIR = path.resolve(__dirname, '../../data');

async function save(source, articles) {
  await fse.ensureDir(DATA_DIR);
  const date = dayjs().format('YYYY-MM-DD');
  const file = path.join(DATA_DIR, `${source}-${date}.json`);

  let existing = [];
  if (await fse.pathExists(file)) {
    existing = await fse.readJson(file);
  }

  const existingUrls = new Set(existing.map(a => a.url));
  const newArticles = articles.filter(a => !existingUrls.has(a.url));

  if (newArticles.length === 0) return 0;

  await fse.writeJson(file, [...existing, ...newArticles], { spaces: 2 });
  return newArticles.length;
}

async function readAll() {
  await fse.ensureDir(DATA_DIR);
  const files = await fse.readdir(DATA_DIR);
  const jsonFiles = files.filter(f => f.endsWith('.json'));

  const all = [];
  for (const f of jsonFiles) {
    const articles = await fse.readJson(path.join(DATA_DIR, f));
    all.push(...articles);
  }
  return all;
}

module.exports = { save, readAll };
