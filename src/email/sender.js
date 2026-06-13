const nodemailer = require('nodemailer');
const { marked } = require('marked');
const fse = require('fs-extra');
const path = require('path');
const dayjs = require('dayjs');
const chalk = require('chalk');

const RESULTS_DIR = path.resolve(__dirname, '../../../results');
const SUBSCRIBERS_FILE = path.resolve(__dirname, '../../subscribers.json');

const ROLE_NAMES = {
  pm: '产品经理',
  developer: '开发者',
  engineer: '工程师',
  ops: '运营',
};

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SES_SMTP_HOST || `email-smtp.${process.env.AWS_REGION || 'ap-northeast-3'}.amazonaws.com`,
    port: 587,
    secure: false,
    auth: {
      user: process.env.SES_SMTP_USER,
      pass: process.env.SES_SMTP_PASS,
    },
  });
}

async function getLatestReport(role) {
  if (!await fse.pathExists(RESULTS_DIR)) return null;
  const files = await fse.readdir(RESULTS_DIR);
  const matched = files
    .filter(f => f.startsWith(`analysis-${role}-`) && f.endsWith('.md'))
    .sort()
    .reverse();
  if (!matched.length) return null;
  return fse.readFile(path.join(RESULTS_DIR, matched[0]), 'utf-8');
}

function buildHtml(subscriber, reports) {
  const date = dayjs().format('YYYY-MM-DD');
  let html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px;">
      <h1 style="color: #1a1a1a; border-bottom: 2px solid #eee; padding-bottom: 12px;">
        🤖 AI 资讯周报 — ${date}
      </h1>
      <p style="color: #666;">你好 ${subscriber.name}，以下是本期为你定制的 AI 资讯分析。</p>
  `;

  for (const { role, content } of reports) {
    html += `
      <div style="margin: 32px 0; padding: 24px; background: #f9f9f9; border-radius: 8px;">
        <h2 style="color: #333; margin-top: 0;">${ROLE_NAMES[role] || role} 视角</h2>
        ${marked(content)}
      </div>
    `;
  }

  html += `
      <p style="color: #999; font-size: 12px; margin-top: 32px; border-top: 1px solid #eee; padding-top: 12px;">
        由 ai-crawler 自动生成 · ${date}
      </p>
    </div>
  `;
  return html;
}

async function sendEmails() {
  if (!await fse.pathExists(SUBSCRIBERS_FILE)) {
    console.log(chalk.yellow('  未找到 subscribers.json，跳过邮件发送'));
    return;
  }

  if (!process.env.SES_SMTP_USER || !process.env.SES_SMTP_PASS) {
    console.log(chalk.yellow('  未配置 SES_SMTP_USER / SES_SMTP_PASS，跳过邮件发送'));
    return;
  }

  const subscribers = await fse.readJson(SUBSCRIBERS_FILE);
  const transporter = createTransporter();

  for (const sub of subscribers) {
    const reports = [];
    for (const role of sub.roles) {
      const content = await getLatestReport(role);
      if (content) reports.push({ role, content });
    }

    if (!reports.length) {
      console.log(chalk.yellow(`  ${sub.email}：没有可发送的报告`));
      continue;
    }

    try {
      await transporter.sendMail({
        from: `"AI 周报" <${process.env.SES_FROM_EMAIL}>`,
        to: sub.email,
        subject: `🤖 AI 资讯周报 — ${dayjs().format('YYYY-MM-DD')}`,
        html: buildHtml(sub, reports),
      });
      console.log(chalk.green(`  ✓ 已发送给 ${sub.name} <${sub.email}>`));
    } catch (err) {
      console.log(chalk.red(`  ✗ 发送给 ${sub.email} 失败: ${err.message}`));
    }
  }
}

module.exports = { sendEmails };
