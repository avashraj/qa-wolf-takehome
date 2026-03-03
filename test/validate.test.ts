import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSortOrder, type Article } from "../lib/validate.js";

function article(isoTimestamp: string, title = "Test Article"): Article {
  return { title, timestamp: isoTimestamp, date: new Date(isoTimestamp) };
}

test("passes when articles are sorted newest to oldest", () => {
  const articles = [
    article("2024-01-03T10:00:00"),
    article("2024-01-02T10:00:00"),
    article("2024-01-01T10:00:00"),
  ];
  const { violations, tieCount } = validateSortOrder(articles);
  assert.equal(violations.length, 0);
  assert.equal(tieCount, 0);
});

test("detects a sort order violation at the correct position", () => {
  const articles = [
    article("2024-01-03T10:00:00"),
    article("2024-01-01T10:00:00"), // older — violation starts here (position 2)
    article("2024-01-02T10:00:00"), // newer than previous
  ];
  const { violations } = validateSortOrder(articles);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]!.position, 2);
});

test("counts ties without flagging them as violations", () => {
  const articles = [
    article("2024-01-02T10:00:00"),
    article("2024-01-02T10:00:00"), // same timestamp — tie, not a violation
    article("2024-01-01T10:00:00"),
  ];
  const { violations, tieCount } = validateSortOrder(articles);
  assert.equal(violations.length, 0);
  assert.equal(tieCount, 1);
});

test("detects multiple violations independently", () => {
  const articles = [
    article("2024-01-04T10:00:00"),
    article("2024-01-01T10:00:00"), // violation 1 at position 2
    article("2024-01-03T10:00:00"),
    article("2024-01-02T10:00:00"), // violation 2 at position 4
    article("2024-01-05T10:00:00"),
  ];
  const { violations } = validateSortOrder(articles);
  assert.equal(violations.length, 2);
  assert.equal(violations[0]!.position, 2);
  assert.equal(violations[1]!.position, 4);
});

test("context window marks only the violating pair with >", () => {
  const articles = [
    article("2024-01-07T10:00:00"), // [1] context before
    article("2024-01-06T10:00:00"), // [2] context before
    article("2024-01-04T10:00:00"), // [3] violating — older than [4]
    article("2024-01-05T10:00:00"), // [4] violating — newer than [3]
    article("2024-01-03T10:00:00"), // [5] context after
    article("2024-01-02T10:00:00"), // [6] context after
  ];
  const { violations } = validateSortOrder(articles);
  assert.equal(violations.length, 1);

  const ctx = violations[0]!.context;
  assert.equal(ctx.length, 6); // full window: positions 1–6
  assert.ok(!ctx[0]!.startsWith("  >"), "position 1 should not be marked");
  assert.ok(!ctx[1]!.startsWith("  >"), "position 2 should not be marked");
  assert.ok(ctx[2]!.startsWith("  >"), "position 3 (older) should be marked");
  assert.ok(ctx[3]!.startsWith("  >"), "position 4 (newer) should be marked");
  assert.ok(!ctx[4]!.startsWith("  >"), "position 5 should not be marked");
  assert.ok(!ctx[5]!.startsWith("  >"), "position 6 should not be marked");
});
