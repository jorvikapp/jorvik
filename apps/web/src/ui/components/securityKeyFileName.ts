/**
 * "jorvik-security-key-lilith-2026-10-01.txt". Every download used to be
 * security-key.txt, so people collected a pile of look-alike files with no way
 * to tell which key belonged to which account, or which one was ever saved.
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
