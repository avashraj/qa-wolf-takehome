// EDIT THIS FILE TO COMPLETE ASSIGNMENT QUESTION 1
import { writeFileSync } from "fs";
import { chromium, type Page } from "playwright";
import { validateSortOrder, type Article, type Violation } from "./lib/validate.js";

/**
 * Parses the article count from the CLI argument.
 * Defaults to 100 if no argument is provided.
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
 * Retries an async operation up to `attempts` times with a fixed backoff.
 * A single network hiccup should not fail the entire run.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  backoffMs = 2000
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        console.warn(`  Attempt ${i + 1} failed, retrying in ${backoffMs}ms...`);
        await new Promise((res) => setTimeout(res, backoffMs));
      }
    }
  }
  throw lastError;
}

/**
 * Scrapes up to `limit` articles from the current HN page.
 *
 * Throws immediately if any article has an empty title or an unparseable
 * timestamp. Bad data should fail loudly rather than silently skewing results —
 * `new Date("")` produces an Invalid Date whose comparisons always return false,
 * which would cause sort violations to go undetected.
 */
async function scrapeArticles(page: Page, limit: number): Promise<Article[]> {
  const raw = await page.$$eval(
    ".athing",
    (rows, limit) =>
      rows.slice(0, limit).map((row) => {
        const subtext = row.nextElementSibling;
        const ageEl = subtext?.querySelector(".age");
        return {
          title: row.querySelector(".titleline a")?.textContent ?? "",
          timestamp: ageEl?.getAttribute("title") ?? "",
        };
      }),
    limit
  );

  const articles: Article[] = [];
  for (const { title, timestamp: rawTimestamp } of raw) {
    if (!title) {
      throw new Error(
        `Scraped an article with an empty title — HN's page structure may have changed.`
      );
    }
    // HN's title attribute format is "ISO-datetime unix-epoch"
    // (e.g. "2026-03-03T20:56:56 1772571416"). Extract just the ISO part.
    const timestamp = rawTimestamp.split(" ")[0] ?? "";
    if (!timestamp || isNaN(Date.parse(timestamp))) {
      throw new Error(
        `Article "${title}" has an unparseable timestamp: "${rawTimestamp}". ` +
          `HN's page structure may have changed.`
      );
    }
    articles.push({ title, timestamp, date: new Date(timestamp) });
  }

  return articles;
}

/**
 * Entry point. Paginates through HN /newest, collects `targetCount` articles,
 * validates their sort order, writes results.json, and exits with code 1 on failure.
 */
async function main(): Promise<void> {
  const targetCount = parseArticleCount();
  const start = Date.now();

  console.log(`Validating ${targetCount} articles on Hacker News /newest...\n`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const articles: Article[] = [];
  let violations: Violation[] = [];
  let tieCount = 0;
  let screenshotTaken = false;

  try {
    await withRetry(() =>
      page.goto("https://news.ycombinator.com/newest", { waitUntil: "domcontentloaded" })
    );

    let pageNum = 1;

    while (articles.length < targetCount) {
      await withRetry(() => page.waitForSelector(".athing", { timeout: 10000 }));

      const onPage = await page.$$eval(".athing", (rows) => rows.length);
      const toTake = Math.min(onPage, targetCount - articles.length);
      const batch = await scrapeArticles(page, toTake);

      if (batch.length === 0) {
        console.error(`No articles found on page ${pageNum}. Stopping.`);
        break;
      }

      articles.push(...batch);
      console.log(`Page ${pageNum}: collected ${articles.length}/${targetCount} articles`);

      if (articles.length < targetCount) {
        const moreHref = await page
          .$eval("a.morelink", (el) => el.getAttribute("href"))
          .catch(() => null);

        if (!moreHref) {
          console.error(`No "More" link on page ${pageNum}. Only ${articles.length} articles available.`);
          break;
        }

        await withRetry(() =>
          page.goto(`https://news.ycombinator.com/${moreHref}`, { waitUntil: "domcontentloaded" })
        );
        pageNum++;
      }
    }

    // Validate while the page is still open so we can screenshot on failure.
    if (articles.length >= targetCount) {
      ({ violations, tieCount } = validateSortOrder(articles));

      if (violations.length > 0) {
        await page.screenshot({ path: "failure.png", fullPage: false });
        screenshotTaken = true;
      }
    }
  } finally {
    await browser.close();
  }

  if (articles.length < targetCount) {
    console.error(`\nFailed: expected ${targetCount} articles but only collected ${articles.length}.`);
    process.exit(1);
  }

  const durationMs = Date.now() - start;
  const passed = violations.length === 0;

  console.log(`\nResult:     ${passed ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`Articles:   ${articles.length}`);
  console.log(`Ties:       ${tieCount} (same-minute timestamps — valid per HN's resolution)`);
  console.log(`Violations: ${violations.length}`);
  console.log(`Duration:   ${(durationMs / 1000).toFixed(2)}s`);
  if (screenshotTaken) console.log(`Screenshot: failure.png`);

  if (violations.length > 0) {
    console.log(`\nSort order violations:\n`);
    for (const v of violations) {
      console.log(`  Violation at position ${v.position}:`);
      for (const line of v.context) console.log(line);
      console.log();
    }
  }

  const report = {
    timestamp: new Date().toISOString(),
    targetCount,
    articleCount: articles.length,
    tieCount,
    passed,
    violations: violations.map((v) => ({ position: v.position, context: v.context })),
  };

  writeFileSync("results.json", JSON.stringify(report, null, 2));
  console.log(`\nReport written to results.json`);

  if (!passed) process.exit(1);
}

void main();
