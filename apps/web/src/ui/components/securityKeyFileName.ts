/**
 * Names a downloaded security key after its account and date, e.g.
 * "jorvik-security-key-lilith-2026-10-01.txt", so keys can be told apart.
 */
export function securityKeyFileName(account: string | null | undefined, date: Date = new Date()): string {
    const localpart = (account ?? "")
        .replace(/^@/, "")
        .split(":")[0]!
        .toLowerCase()
        .replace(/[^a-z0-9._=-]+/g, "-")
        .replace(/^-+|-+$/g, "");
    const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((part) => String(part).padStart(2, "0")).join("-");
    return `${["jorvik-security-key", localpart, day].filter(Boolean).join("-")}.txt`;
}
