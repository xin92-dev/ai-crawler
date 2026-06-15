require('dotenv').config();
const fse = require('fs-extra');
const path = require('path');
const dayjs = require('dayjs');

const RESULTS_DIR = path.resolve(__dirname, '../results');
const AUDIO_DIR = path.resolve(__dirname, '../results/audio');
const WEB_DIR = path.resolve(__dirname, '../web');

const ROLE_META = {
  pm:       { name: '产品经理', emoji: '📱' },
  developer:{ name: '开发者',   emoji: '💻' },
  engineer: { name: '工程师',   emoji: '⚙️' },
  ops:      { name: '运营',     emoji: '📣' },
};

function weekLabel(dateStr) {
  const LABELS = ['本周', '上周', '上上周', '上上上周', '四周前', '五周前'];
  const date = dayjs(dateStr);
  // find start of ISO week (Monday) for date
  const dow = date.day(); // 0=Sun
  const toMonday = dow === 0 ? 6 : dow - 1;
  const weekStart = date.subtract(toMonday, 'day');
  // find start of current ISO week
  const today = dayjs();
  const todayDow = today.day();
  const todayToMonday = todayDow === 0 ? 6 : todayDow - 1;
  const currentWeekStart = today.subtract(todayToMonday, 'day');
  const weeksAgo = currentWeekStart.diff(weekStart, 'day') / 7;
  return LABELS[Math.round(weeksAgo)] || dateStr;
}

async function buildWebData() {
  const files = await fse.readdir(RESULTS_DIR);
  const mdFiles = files.filter(f => /^analysis-\w+-\d{4}-\d{2}-\d{2}\.md$/.test(f));

  const grouped = {};
  for (const file of mdFiles) {
    const m = file.match(/^analysis-(\w+)-(\d{4}-\d{2}-\d{2})\.md$/);
    if (!m) continue;
    const [, role, date] = m;
    if (!grouped[date]) grouped[date] = {};
    grouped[date][role] = await fse.readFile(path.join(RESULTS_DIR, file), 'utf-8');
  }

  const audioFiles = await fse.readdir(AUDIO_DIR).catch(() => []);

  const dates = Object.keys(grouped).sort();
  const weeks = dates.map((date, i) => {
    const audioFile = `audio-${date}.mp3`;
    const hasAudio = audioFiles.includes(audioFile);
    const roles = Object.entries(grouped[date]).map(([roleKey, content]) => ({
      key: roleKey,
      ...ROLE_META[roleKey],
      content,
    }));
    roles.sort((a, b) => {
      const order = ['pm', 'developer', 'engineer', 'ops'];
      return order.indexOf(a.key) - order.indexOf(b.key);
    });
    return {
      date,
      label: weekLabel(date),
      audioFile: hasAudio ? `audio/${audioFile}` : null,
      roles,
    };
  });

  await fse.ensureDir(WEB_DIR);
  const dataFile = path.join(WEB_DIR, 'data.json');
  await fse.writeJson(dataFile, { generatedAt: new Date().toISOString(), weeks }, { spaces: 2 });

  // copy audio files to web/audio/
  if (audioFiles.length) {
    await fse.ensureDir(path.join(WEB_DIR, 'audio'));
    for (const f of audioFiles.filter(f => f.endsWith('.mp3'))) {
      await fse.copy(path.join(AUDIO_DIR, f), path.join(WEB_DIR, 'audio', f));
    }
    console.log(`  已复制 ${audioFiles.filter(f => f.endsWith('.mp3')).length} 个音频文件`);
  }

  console.log(`✅  Web 数据已生成: ${dataFile}`);
  console.log(`   共 ${weeks.length} 周，${mdFiles.length} 份报告`);
  return dataFile;
}

buildWebData().catch(e => { console.error('构建失败:', e.message); process.exit(1); });
