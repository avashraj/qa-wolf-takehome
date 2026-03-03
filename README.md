# Hacker News Sort Order Validator

A Playwright script that validates the first 100 articles on [Hacker News /newest](https://news.ycombinator.com/newest) are sorted from newest to oldest.

Built for the [QA Wolf](https://www.qawolf.com/) QA Engineer take-home assignment.

## Quick Start

```bash
npm install
npx playwright install --with-deps chromium
npm test
```

The script navigates through HN's `/newest` page, collects 100 articles, and verifies their timestamps are in descending order. On success it exits with code 0; on failure it exits with code 1, prints the violations with surrounding context, and saves a screenshot of the page.

You can validate a different number of articles by passing a count:

```bash
npx tsx index.ts 200
```

## Output

Every run produces a `results.json` file with structured pass/fail data:

```json
{
  "timestamp": "2026-03-03T12:00:00.000Z",
  "targetCount": 100,
  "articleCount": 100,
  "tieCount": 12,
  "passed": true,
  "violations": []
}
```

When violations are detected, the script also saves `failure.png` — a screenshot of the page at the time validation ran.

A failing run prints a context window around each violation so the pattern is visible at a glance:

```
  Violation at position 42:
    [40] 2026-03-03T09:12:00  "Some earlier article title..."
    [41] 2026-03-03T09:11:00  "Another article..."
  > [42] 2026-03-03T09:08:00  "This one is older..."
  > [43] 2026-03-03T09:10:00  "But this one is newer — violation"
    [44] 2026-03-03T09:07:00  "Continues normally..."
```

## Running Tests

Unit tests validate the sort-order logic in isolation without launching a browser or hitting the network:

```bash
npm run test:unit
```

The test suite covers: clean descending order, single violations, tied timestamps, multiple violations, and correct context window marking.

## Project Structure

```
├── index.ts              # Entry point — scrapes HN and runs validation
├── lib/
│   └── validate.ts       # Sort validation logic and types (Article, Violation)
├── test/
│   └── validate.test.ts  # Unit tests for validation logic
├── .github/
│   └── workflows/
│       └── test.yml      # CI pipeline
├── results.json          # Generated on each run
└── failure.png           # Generated on validation failure
```

`validate.ts` is extracted into its own module so it can be imported and tested without triggering the browser-based entry point in `index.ts`.

## CI Pipeline

The GitHub Actions workflow (`.github/workflows/test.yml`) runs on two triggers:

- **Pull requests to main** — gates code changes before merge.
- **Daily at 6:00 AM UTC** — monitors HN's sort order as a live system under continuous validation.

Each run executes unit tests first (fast feedback if logic is broken), then the full Playwright validation. Both `results.json` and `failure.png` are uploaded as CI artifacts on every run, whether it passes or fails.

The workflow pins `ubuntu-22.04` because Playwright's `--with-deps` installer references package names that were renamed in Ubuntu 24.04.

## Design Decisions

**Single browser.** The original version ran four browsers in parallel. Cross-browser testing matters when validating your own application's rendering — not when reading server-rendered text from someone else's page. HN serves identical HTML regardless of engine.

**Timestamp parsing.** HN's `.age` element stores timestamps as `"2026-03-03T20:56:56 1772571416"` — an ISO datetime followed by a Unix epoch. `new Date()` on the raw string produces `Invalid Date`, and comparisons on invalid dates silently return `false`. The script strips the trailing epoch before parsing and throws immediately if any timestamp is unparseable.

**Tie handling.** HN timestamps have minute-level resolution, so consecutive articles frequently share the same timestamp. Ties are valid because they don't violate newest-to-oldest ordering. The script counts and logs them explicitly rather than ignoring them silently.

**Retry logic.** Network requests are wrapped in a retry helper (3 attempts, 2-second backoff). A single transient timeout no longer kills the entire run.

**Screenshot on failure.** Attaching visual evidence is standard QA practice so someone debugging doesn't need to reproduce the run to see what happened.

**Data validation at parse time.** Every scraped article is checked for a non-empty title and a valid timestamp before entering the article list. If HN's markup changes, the script fails immediately with a clear message instead of carrying bad data through to comparison.
