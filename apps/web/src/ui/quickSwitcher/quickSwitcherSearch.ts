/**
 * Finding a conversation by name for the quick switcher (Ctrl+K). With
 * nothing typed it lists where things last happened; typing narrows that to
 * names that start with, contain or spell out what was typed, in that order.
 * Starting with @, # or * looks only at people, channels or spaces.
 */

export type QuickSwitcherKind = "dm" | "channel" | "voice" | "space";

export interface QuickSwitcherItem {
    roomId: string;
    kind: QuickSwitcherKind;
    name: string;
    // Shown on the right: the space a channel is in, or the person's account name.
    detail: string | null;
    // Other names it can be found by, like a person's account name.
    keywords: readonly string[];
    lastActive: number;
    unread: boolean;
    // The red number, as in the room list: mentions, or every message in a DM.
    count: number;
    avatarSources: readonly string[];
    avatarSeed: string;
}

const KINDS_BY_PREFIX: Record<string, ReadonlySet<QuickSwitcherKind>> = {
    "@": new Set<QuickSwitcherKind>(["dm"]),
    "#": new Set<QuickSwitcherKind>(["channel", "voice"]),
    "*": new Set<QuickSwitcherKind>(["space"]),
};
const RECENT_LIMIT = 8;
const RESULT_LIMIT = 30;
const WORD_SEPARATOR = /[\s\-_.#@:/]+/;

export function searchQuickSwitcher(
    items: readonly QuickSwitcherItem[],
    rawQuery: string,
    currentRoomId: string | null,
): QuickSwitcherItem[] {
    let query = rawQuery.trim().toLowerCase();
    const kinds = KINDS_BY_PREFIX[query.charAt(0)] ?? null;
    if (kinds) {
        query = query.slice(1).trim();
    }
    const candidates = kinds ? items.filter((item) => kinds.has(item.kind)) : items;

    if (!query) {
        // Where you are now isn't somewhere to go, and spaces only show when asked for.
        return candidates
            .filter((item) => item.roomId !== currentRoomId && (kinds !== null || item.kind !== "space"))
            .sort(byRecentActivity)
            .slice(0, kinds ? RESULT_LIMIT : RECENT_LIMIT);
    }

    return candidates
        .map((item) => ({ item, score: itemScore(item, query) }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score || byRecentActivity(left.item, right.item))
        .slice(0, RESULT_LIMIT)
        .map((entry) => entry.item);
}

function byRecentActivity(left: QuickSwitcherItem, right: QuickSwitcherItem): number {
    return right.lastActive - left.lastActive || left.name.localeCompare(right.name);
}

// A match on another name counts a little less than the same match on the name itself.
function itemScore(item: QuickSwitcherItem, query: string): number {
    let score = matchScore(item.name, query);
    for (const keyword of item.keywords) {
        score = Math.max(score, matchScore(keyword, query) - 0.5);
    }
    return score;
}

function matchScore(target: string, query: string): number {
    const name = target.toLowerCase();
    if (name === query) {
        return 5;
    }
    if (name.startsWith(query)) {
        return 4;
    }
    if (name.split(WORD_SEPARATOR).some((word) => word.startsWith(query))) {
        return 3;
    }
    if (name.includes(query)) {
        return 2;
    }
    return isSubsequence(query, name) ? 1 : 0;
}

// "gnrl" finds "general": every letter typed, in order, with gaps allowed.
function isSubsequence(query: string, name: string): boolean {
    const wanted = [...query];
    let position = 0;
    for (const char of name) {
        if (char === wanted[position]) {
            position += 1;
            if (position === wanted.length) {
                return true;
            }
        }
    }
    return false;
}
