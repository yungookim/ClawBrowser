import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const REPORT_PATH = path.join('docs', 'ops', 'browser-automation-report.md');
const BASELINE_PATH = path.join('docs', 'ops', 'browser-automation-baseline.json');
const ERROR_THRESHOLD = 0.05;
const STAGEHAND_DROP_THRESHOLD = 0.10;

function resolveLogRoot() {
  const base = process.env.CLAW_LOG_DIR
    ? path.resolve(process.env.CLAW_LOG_DIR)
    : path.join(os.homedir(), '.clawbrowser', 'workspace', 'logs');
  return path.join(base, 'browser-automation');
}

async function listDirs(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function readJson(filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

async function collectRuns(root) {
  const runs = [];
  const dates = await listDirs(root);
  for (const date of dates) {
    const dateDir = path.join(root, date);
    const traces = await listDirs(dateDir);
    for (const traceId of traces) {
      const traceDir = path.join(dateDir, traceId);
      const summaryPath = path.join(traceDir, 'summary.json');
      const attemptsPath = path.join(traceDir, 'attempt.jsonl');
      let summary = null;
      let attempts = [];
      try {
        summary = await readJson(summaryPath);
      } catch {
        summary = null;
      }
      try {
        const content = await fs.readFile(attemptsPath, 'utf-8');
        attempts = content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
      } catch {
        attempts = [];
      }
      if (summary || attempts.length) {
        runs.push({ traceId, date, summary, attempts });
      }
    }
  }
  return runs;
}

function aggregate(runs) {
  const stats = {
    totalRuns: runs.length,
    totalAttempts: 0,
    successes: 0,
    failures: 0,
    providers: {},
    errorTypes: {},
  };

  for (const run of runs) {
    const attempts = run.attempts || [];
    for (const attempt of attempts) {
      if (attempt.event !== 'success' && attempt.event !== 'failure') continue;
      const provider = attempt.provider || 'unknown';
      if (!stats.providers[provider]) {
        stats.providers[provider] = { attempts: 0, successes: 0, failures: 0 };
      }
      stats.providers[provider].attempts += 1;
      stats.totalAttempts += 1;
      if (attempt.event === 'success') {
        stats.providers[provider].successes += 1;
        stats.successes += 1;
      } else {
        stats.providers[provider].failures += 1;
        stats.failures += 1;
        const reason = String(attempt.reason || 'unknown').split('\n')[0];
        stats.errorTypes[reason] = (stats.errorTypes[reason] || 0) + 1;
      }
    }
  }

  return stats;
}

function calculateRates(stats) {
  const stagehand = stats.providers.stagehand || { attempts: 0, successes: 0 };
  const webview = stats.providers.webview || { attempts: 0, successes: 0 };
  return {
    stagehandRate: stagehand.attempts ? stagehand.successes / stagehand.attempts : 0,
    webviewRate: webview.attempts ? webview.successes / webview.attempts : 0,
  };
}

async function writeReport(stats, rates, regressions) {
  await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true });
  const lines = [];
  lines.push('# Browser Automation Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`Total runs: ${stats.totalRuns}`);
  lines.push(`Total attempts: ${stats.totalAttempts}`);
  lines.push(`Successes: ${stats.successes}`);
  lines.push(`Failures: ${stats.failures}`);
  lines.push('');
  lines.push(`Stagehand success rate: ${(rates.stagehandRate * 100).toFixed(1)}%`);
  lines.push(`Webview success rate: ${(rates.webviewRate * 100).toFixed(1)}%`);
  lines.push('');
  lines.push('## Top Error Types');
  const errorEntries = Object.entries(stats.errorTypes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  if (!errorEntries.length) {
    lines.push('- None');
  } else {
    for (const [reason, count] of errorEntries) {
      lines.push(`- ${reason} (${count})`);
    }
  }
  lines.push('');
  lines.push('## Regression Check');
  if (!regressions.length) {
    lines.push('- No regressions detected.');
  } else {
    for (const regression of regressions) {
      lines.push(`- ${regression}`);
    }
  }
  lines.push('');

  await fs.writeFile(REPORT_PATH, lines.join('\n'), 'utf-8');
}

async function loadBaseline() {
  try {
    return await readJson(BASELINE_PATH);
  } catch {
    return null;
  }
}

async function writeBaseline(stats, rates) {
  const payload = {
    generatedAt: new Date().toISOString(),
    stagehandRate: rates.stagehandRate,
    webviewRate: rates.webviewRate,
    errorTypes: stats.errorTypes,
    totalAttempts: stats.totalAttempts,
  };
  await fs.mkdir(path.dirname(BASELINE_PATH), { recursive: true });
  await fs.writeFile(BASELINE_PATH, JSON.stringify(payload, null, 2), 'utf-8');
}

function detectRegressions(stats, rates, baseline) {
  const regressions = [];
  if (!baseline) return regressions;

  if (typeof baseline.stagehandRate === 'number') {
    if (baseline.stagehandRate - rates.stagehandRate > STAGEHAND_DROP_THRESHOLD) {
      regressions.push(`Stagehand success rate dropped from ${(baseline.stagehandRate * 100).toFixed(1)}% to ${(rates.stagehandRate * 100).toFixed(1)}%.`);
    }
  }

  const baselineErrors = baseline.errorTypes || {};
  const totalAttempts = stats.totalAttempts || 1;
  for (const [reason, count] of Object.entries(stats.errorTypes)) {
    if (!baselineErrors[reason]) {
      const share = count / totalAttempts;
      if (share > ERROR_THRESHOLD) {
        regressions.push(`New error type "${reason}" at ${(share * 100).toFixed(1)}% of attempts.`);
      }
    }
  }

  return regressions;
}

async function main() {
  const root = resolveLogRoot();
  const runs = await collectRuns(root);
  const stats = aggregate(runs);
  const rates = calculateRates(stats);

  const baseline = await loadBaseline();
  const regressions = detectRegressions(stats, rates, baseline);

  if (!baseline) {
    await writeBaseline(stats, rates);
  }

  await writeReport(stats, rates, regressions);

  if (regressions.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Analyzer failed:', err);
  process.exitCode = 1;
});
