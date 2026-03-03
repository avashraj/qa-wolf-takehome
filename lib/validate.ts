/** A single Hacker News article scraped from the page, with a validated date. */
export interface Article {
  title: string;
  timestamp: string;
  date: Date;
}

/** A sort order violation with surrounding context lines. */
export interface Violation {
  position: number;  // 1-based index of the older article in the violating pair
  context: string[]; // formatted lines showing articles around the violation
}

/**
 * Validates that `articles` are sorted from newest to oldest.
 *
 * Ties (consecutive articles sharing the same minute-resolution timestamp) are
 * valid — HN groups simultaneous submissions together. They are counted and
 * reported but do not constitute a failure.
 *
 * For each violation, a 2-article context window before and after the
 * offending pair is included so the failure pattern is visible at a glance.
 */
export function validateSortOrder(
  articles: Article[]
): { violations: Violation[]; tieCount: number } {
  const violations: Violation[] = [];
  let tieCount = 0;

  for (let i = 0; i < articles.length - 1; i++) {
    const curr = articles[i]!;
    const next = articles[i + 1]!;

    if (curr.date.getTime() === next.date.getTime()) {
      tieCount++;
      continue;
    }

    if (curr.date < next.date) {
      // curr is older than next — sort order violated
      const windowStart = Math.max(0, i - 2);
      const windowEnd = Math.min(articles.length - 1, i + 3);

      // 1-based positions of the violating pair: i+1 and i+2
      const context = articles.slice(windowStart, windowEnd + 1).map((a, idx) => {
        const pos = windowStart + idx + 1;
        const marker = pos === i + 1 || pos === i + 2 ? ">" : " ";
        return `  ${marker} [${String(pos).padStart(3)}] ${a.timestamp}  "${a.title.slice(0, 60)}"`;
      });

      violations.push({ position: i + 1, context });
    }
  }

  return { violations, tieCount };
}
