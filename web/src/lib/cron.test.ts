import { describe, expect, it } from "vitest";
import { describeCron, formatInZone } from "./cron.ts";

/**
 * The sentence next to the expression is only worth having if it is *right*. A describer that
 * guesses is worse than no describer: the operator stops reading the raw field and trusts a
 * sentence that lies. So two halves are pinned here — what it says, and what it refuses to say.
 */

describe("describeCron", () => {
  it("names the pattern from the issue", () => {
    expect(describeCron("0 9 * * 1-5")).toBe("every weekday at 09:00");
  });

  it.each([
    ["* * * * *", "every minute"],
    ["*/15 * * * *", "every 15 minutes"],
    ["*/5 * * * 1-5", "every 5 minutes on weekdays"],
    ["0 * * * *", "every hour, on the hour"],
    ["30 * * * *", "every hour at :30"],
    ["0,30 * * * *", "every hour at :00 and :30"],
    ["0 */2 * * *", "every 2 hours, on the hour"],
    ["15 */6 * * *", "every 6 hours at :15"],
    ["0 9 * * *", "every day at 09:00"],
    ["0 0 * * *", "every day at 00:00"],
    ["30 3 * * *", "every day at 03:30"],
    ["0 9,17 * * *", "every day at 09:00 and 17:00"],
    ["0 0 * * 0", "every Sunday at 00:00"],
    ["0 9 * * 7", "every Sunday at 09:00"],
    ["0 9 * * 1,4", "every Monday and Thursday at 09:00"],
    ["0 10 * * 0,6", "every weekend day at 10:00"],
    ["0 9 * * mon-fri", "every weekday at 09:00"],
    ["0 2 1 * *", "the 1st of every month at 02:00"],
    ["0 2 1,15 * *", "the 1st and 15th of every month at 02:00"],
    ["0 2 22 * *", "the 22nd of every month at 02:00"],
    ["0 0 1 1 *", "the 1st of January at 00:00"],
    ["0 0 1 jan,jul *", "the 1st of January and July at 00:00"],
    ["*/10 9 * * *", "every 10 minutes between 09:00 and 09:59"],
  ])("%s → %s", (expression, sentence) => {
    expect(describeCron(expression)).toBe(sentence);
  });

  it("expands croner's shorthands", () => {
    expect(describeCron("@daily")).toBe("every day at 00:00");
    expect(describeCron("@hourly")).toBe("every hour, on the hour");
    expect(describeCron("@weekly")).toBe("every Sunday at 00:00");
    expect(describeCron("@monthly")).toBe("the 1st of every month at 00:00");
    expect(describeCron("@yearly")).toBe("the 1st of January at 00:00");
  });

  it("reads the six-field form with seconds first", () => {
    expect(describeCron("* * * * * *")).toBe("every second");
    expect(describeCron("*/30 * * * * *")).toBe("every 30 seconds");
    // A leading `0` is the six-field way of writing the five-field expression, and must not
    // change the sentence — otherwise the same schedule reads differently depending on how it
    // happened to be typed.
    expect(describeCron("0 0 9 * * 1-5")).toBe("every weekday at 09:00");
    expect(describeCron("30 0 9 * * *")).toBe("every day at 09:00:30");
  });

  describe("refuses rather than guesses", () => {
    it.each([
      // Not a cron expression at all.
      ["", "empty"],
      ["   ", "blank"],
      ["0 9 * *", "four fields"],
      ["0 9 * * * * *", "seven fields"],
      ["nonsense", "a word"],
      ["0 99 * * *", "an hour out of range"],
      ["0 9 * * 9", "a weekday out of range"],
      ["0 9 * * mo", "an unknown day alias"],
      ["0 9 */0 * *", "a zero step"],
      // Legal cron this describer will not put a sentence to. Day-of-month AND day-of-week are
      // ORed by cron, and no short English sentence says that unambiguously.
      ["0 9 1 * 1", "day-of-month and day-of-week together"],
      // Eight separate clock times is a table, not a sentence.
      ["0 0,3,6,9,12,15,18,21 * * *", "more times than a sentence can carry"],
    ])("%s (%s)", (expression) => {
      expect(describeCron(expression)).toBeNull();
    });

    it("never throws on junk", () => {
      for (const junk of ["* * * * $", "-,-,- * * * *", "0 9 * * ,", "/ / / / /", "0-99/ * * * *"]) {
        expect(() => describeCron(junk)).not.toThrow();
      }
    });
  });
});

describe("formatInZone", () => {
  // 2026-03-02T02:00:00Z. The point is that the same instant reads as a different wall clock
  // in each zone — which is exactly the mistake the schedule screen has to make impossible.
  const instant = Date.UTC(2026, 2, 2, 2, 0, 0);

  it("renders the instant in the schedule's zone, not the browser's", () => {
    const london = formatInZone(instant, "Europe/London");
    const saigon = formatInZone(instant, "Asia/Ho_Chi_Minh");
    expect(london).toContain("02:00");
    expect(saigon).toContain("09:00");
    expect(london).not.toBe(saigon);
  });

  it("falls back to the local zone rather than throwing on a zone it cannot resolve", () => {
    expect(() => formatInZone(instant, "Mars/Olympus_Mons")).not.toThrow();
    expect(formatInZone(instant, "Mars/Olympus_Mons")).not.toBe("");
  });
});
