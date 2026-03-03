// EDIT THIS FILE TO COMPLETE ASSIGNMENT QUESTION 1
import { writeFileSync } from "fs";
import { chromium, firefox, webkit, type Browser, type Page } from "playwright";

/** A single Hacker News article scraped from the page. */
interface Article {
  title: string;
  timestamp: string;
}

/** The validation result for a single browser run. */
interface BrowserResult {
  browserName: string;
  passed: boolean;
  failures: string[];
  articleCount: number;
  durationMs: number;
}

/** A browser configuration entry describing how to launch it. */
interface BrowserConfig {
  name: string;
  launch: () => Promise<Browser>;
}

/**
 * Parses the article count from the CLI argument.
 * Defaults to 100 if no argument is provided.
 *
 * @returns The number of articles to validate.
 */
function parseArticleCount(): number {
  const arg = process.argv[2];
  if (arg === undefined) return 100;

  const count = Number(arg);
  if (!Number.isInteger(count) || count <= 0) {
    console.error(`Usage: npx tsx index.ts [count]\n  count: positive integer (default: 100)`);
    process.exit(1);
  }
  return count;
}

/**
 * Scrapes up to `limit` articles from the current Hacker News page.
 *
 * @param page - The Playwright page object, already navigated to an HN /newest page.
 * @param limit - Maximum number of articles to extract from this page.
 * @returns An array of articles with their titles and ISO timestamps.
 */
async function scrapeArticles(page: Page, limit: number): Promise<Article[]> {
  return page.$$eval(
    ".athing",
    (rows, limit) => {
      return rows.slice(0, limit).map((row) => {
        const subtext = row.nextElementSibling;
        const ageEl = subtext?.querySelector(".age");
        const title = row.querySelector(".titleline a")?.textContent ?? "Unknown";
        const timestamp = ageEl?.getAttribute("title") ?? "";
        return { title, timestamp };
      });
    },
    limit
  );
}

/**
 * Launches a browser, paginates through Hacker News /newest to collect
 * `targetCount` articles, and validates they are sorted newest to oldest.
 *
 * @param launchFn - A function that launches and returns a Playwright Browser.
 * @param browserName - Display name of the browser (used in log prefixes).
 * @param targetCount - Number of articles to collect and validate.
 * @returns A BrowserResult with pass/fail status, failures, and timing.
 */
async function runForBrowser(
  launchFn: () => Promise<Browser>,
  browserName: string,
  targetCount: number
): Promise<BrowserResult> {
  const tag = `[${browserName}]`;
  const start = Date.now();
  const browser = await launchFn();
  const context = await browser.newContext();
  const page = await context.newPage();

  const articles: Article[] = [];

  try {
    console.log(`${tag} Navigating to Hacker News /newest...`);
    await page.goto("https://news.ycombinator.com/newest", {
      waitUntil: "domcontentloaded",
    });

    let pageNum = 1;

    while (articles.length < targetCount) {
      await page.waitForSelector(".athing", { timeout: 10000 });

      const articlesOnPage = await page.$$eval(".athing", (rows) => rows.length);
      const remaining = targetCount - articles.length;
      const toTake = Math.min(articlesOnPage, remaining);
      const pageArticles = await scrapeArticles(page, toTake);

      if (pageArticles.length === 0) {
        console.error(`${tag} No articles found on page ${pageNum}. Stopping.`);
        break;
      }

      articles.push(...pageArticles);
      console.log(`${tag} Page ${pageNum}: collected ${articles.length}/${targetCount} articles`);

      if (articles.length < targetCount) {
        const moreHref = await page
          .$eval("a.morelink", (el) => el.getAttribute("href"))
          .catch(() => null);

        if (!moreHref) {
          console.error(`${tag} No "More" link found on page ${pageNum}. Only ${articles.length} articles available.`);
          break;
        }

        await page.goto(`https://news.ycombinator.com/${moreHref}`, {
          waitUntil: "domcontentloaded",
        });
        pageNum++;
      }
    }
  } finally {
    await browser.close();
  }

  const durationMs = Date.now() - start;

  if (articles.length < targetCount) {
    return {
      browserName,
      passed: false,
      failures: [`Expected ${targetCount} articles but only collected ${articles.length}.`],
      articleCount: articles.length,
      durationMs,
    };
  }

  const failures: string[] = [];

  for (let i = 0; i < articles.length - 1; i++) {
    const current = new Date(articles[i]!.timestamp);
    const next = new Date(articles[i + 1]!.timestamp);

    if (current < next) {
      failures.push(
        `Article ${i + 1} ("${articles[i]!.title.slice(0, 40)}") is OLDER than ` +
        `article ${i + 2} ("${articles[i + 1]!.title.slice(0, 40)}")\n` +
        `  ${articles[i]!.timestamp} < ${articles[i + 1]!.timestamp}`
      );
    }
  }

  return {
    browserName,
    passed: failures.length === 0,
    failures,
    articleCount: articles.length,
    durationMs,
  };
}

/**
 * Entry point. Parses CLI args, runs all browsers in parallel,
 * and prints a summary report with per-browser timing.
 */
async function main(): Promise<void> {
  const targetCount = parseArticleCount();
  const wallStart = Date.now();

  const BROWSERS: BrowserConfig[] = [
    { name: "Firefox",        launch: () => firefox.launch({ headless: true }) },
    { name: "WebKit",         launch: () => webkit.launch({ headless: true }) },
    { name: "Chromium",       launch: () => chromium.launch({ headless: true}) },
    { name: "Microsoft Edge", launch: () => chromium.launch({ channel: "msedge", headless: true }) },
  ];

  console.log(`Starting validation of ${targetCount} articles across ${BROWSERS.length} browsers in parallel...\n`);

  const results = await Promise.all(
    BROWSERS.map(({ name, launch }) => runForBrowser(launch, name, targetCount))
  );

  const wallMs = Date.now() - wallStart;
  const bar = "═".repeat(52);

  console.log(`\n${bar}`);
  console.log(` RESULTS  (${targetCount} articles, ${BROWSERS.length} browsers)`);
  console.log(bar);
  console.log(` ${"Browser".padEnd(18)} ${"Status".padEnd(10)} Time`);
  console.log(` ${"-".repeat(18)} ${"-".repeat(10)} ------`);

  for (const r of results) {
    const status = r.passed ? "✅ PASS" : "❌ FAIL";
    const time = `${(r.durationMs / 1000).toFixed(2)}s`;
    console.log(` ${r.browserName.padEnd(18)} ${status.padEnd(10)} ${time}`);
  }

  console.log(bar);
  console.log(` Total wall time: ${(wallMs / 1000).toFixed(2)}s (ran in parallel)`);
  console.log(`${bar}\n`);

  const allPassed = results.every((r) => r.passed);
  const report = {
    timestamp: new Date().toISOString(),
    targetCount,
    results: results.map((r) => ({
      browser: r.browserName,
      passed: r.passed,
      durationMs: r.durationMs,
      failures: r.failures,
    })),
    allPassed,
  };

  const reportPath = "results.json";
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Report written to ${reportPath}\n`);

  const failedBrowsers = results.filter((r) => !r.passed);
  if (failedBrowsers.length > 0) {
    for (const r of failedBrowsers) {
      console.log(`Failures in ${r.browserName}:`);
      r.failures.forEach((f) => console.log(`  ❌ ${f}`));
      console.log();
    }
    process.exit(1);
  }
}

void main();
