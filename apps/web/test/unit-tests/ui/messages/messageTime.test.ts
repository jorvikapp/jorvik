import { describe, expect, it } from "vitest";

import { formatDayDivider, formatMessageTime, localDayKey } from "../../../../src/ui/messages/messageTime";

// Local times, so the expectations hold in any time zone and locale.
const at = (month: number, day: number, hour: number, minute: number, year = 2026): number =>
    new Date(year, month - 1, day, hour, minute).getTime();
const time = (timestamp: number): string =>
    new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
// Friday 9 October 2026, five minutes past midnight.
const now = new Date(at(10, 9, 0, 5));

describe("formatMessageTime", () => {
    it("shows only the time for today", () => {
        expect(formatMessageTime(at(10, 9, 0, 1), now)).toBe(time(at(10, 9, 0, 1)));
    });

    it("says Yesterday for last night, even minutes ago", () => {
        expect(formatMessageTime(at(10, 8, 23, 59), now)).toBe(`Yesterday at ${time(at(10, 8, 23, 59))}`);
    });

    it("names the weekday within the last week", () => {
        const sent = at(10, 6, 14, 2);
        const weekday = new Date(sent).toLocaleDateString([], { weekday: "long" });
        expect(formatMessageTime(sent, now)).toBe(`${weekday} at ${time(sent)}`);
    });

    it("gives the date from a week back, with the year only for other years", () => {
        const lastWeek = at(10, 2, 9, 0);
        const day = new Date(lastWeek).toLocaleDateString([], { day: "numeric", month: "short" });
        expect(formatMessageTime(lastWeek, now)).toBe(`${day} at ${time(lastWeek)}`);

        const lastYear = at(12, 31, 22, 0, 2025);
        const dated = new Date(lastYear).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
        expect(formatMessageTime(lastYear, now)).toBe(`${dated} at ${time(lastYear)}`);
    });

    it("counts calendar days across a daylight saving change", () => {
        // Clocks change in late March in Europe; a 23-hour day is still one day.
        expect(formatMessageTime(at(3, 29, 1, 30), new Date(at(3, 30, 0, 30)))).toBe(`Yesterday at ${time(at(3, 29, 1, 30))}`);
    });
});

describe("formatDayDivider", () => {
    it("says Today, Yesterday, then the full date", () => {
        expect(formatDayDivider(at(10, 9, 0, 1), now)).toBe("Today");
        expect(formatDayDivider(at(10, 8, 23, 59), now)).toBe("Yesterday");
        const sent = at(10, 6, 14, 2);
        expect(formatDayDivider(sent, now)).toBe(
            new Date(sent).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }),
        );
        const lastYear = at(12, 31, 22, 0, 2025);
        expect(formatDayDivider(lastYear, now)).toBe(
            new Date(lastYear).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
        );
    });
});

describe("localDayKey", () => {
    it("changes at local midnight and not before", () => {
        expect(localDayKey(at(10, 8, 0, 0))).toBe(localDayKey(at(10, 8, 23, 59)));
        expect(localDayKey(at(10, 8, 23, 59))).not.toBe(localDayKey(at(10, 9, 0, 0)));
    });
});
