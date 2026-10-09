// When a message was sent, in words that keep their meaning as the days go by:
// "14:02" today, "Yesterday at 14:02", "Monday at 14:02" within the week, then the
// date. Day dividers say "Today", "Yesterday" or the full date. All in the user's
// locale; days are calendar days, so 23:59 last night is "Yesterday".

function timeOfDay(date: Date): string {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** A key that changes at local midnight. */
export function localDayKey(timestamp: number): string {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** Whole calendar days from `date` to `now`: 0 today, 1 yesterday, negative in the future. */
function daysBefore(date: Date, now: Date): number {
    // Date.UTC on the local calendar dates keeps daylight saving out of the count.
    const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((today - day) / 86_400_000);
}

/** The time on a message: "14:02", "Yesterday at 14:02", "Monday at 14:02", "6 Oct at 14:02". */
export function formatMessageTime(timestamp: number, now: Date = new Date()): string {
    const date = new Date(timestamp);
    const time = timeOfDay(date);
    const days = daysBefore(date, now);
    if (days === 0) {
        return time;
    }
    if (days === 1) {
        return `Yesterday at ${time}`;
    }
    if (days > 1 && days < 7) {
        return `${date.toLocaleDateString([], { weekday: "long" })} at ${time}`;
    }
    const sameYear = date.getFullYear() === now.getFullYear();
    const day = date.toLocaleDateString([], sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
    return `${day} at ${time}`;
}

/** The label on the line between days: "Today", "Yesterday", or "Monday 6 October". */
export function formatDayDivider(timestamp: number, now: Date = new Date()): string {
    const date = new Date(timestamp);
    const days = daysBefore(date, now);
    if (days === 0) {
        return "Today";
    }
    if (days === 1) {
        return "Yesterday";
    }
    const sameYear = date.getFullYear() === now.getFullYear();
    return date.toLocaleDateString(
        [],
        sameYear
            ? { weekday: "long", day: "numeric", month: "long" }
            : { weekday: "long", day: "numeric", month: "long", year: "numeric" },
    );
}

/** The full date and time, for a tooltip. */
export function formatFullTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleString([], {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}
