import { describe, expect, it } from "vitest";

import { searchQuickSwitcher, type QuickSwitcherItem } from "../../../../src/ui/quickSwitcher/quickSwitcherSearch";

function item(roomId: string, kind: QuickSwitcherItem["kind"], name: string, lastActive: number, keywords: string[] = []): QuickSwitcherItem {
    return { roomId, kind, name, detail: null, keywords, lastActive, unread: false, count: 0, avatarSources: [], avatarSeed: roomId };
}

const ITEMS = [
    item("!general", "channel", "general", 50),
    item("!gaming", "channel", "gaming-news", 40),
    item("!lounge", "voice", "Lounge", 30),
    item("!riff", "dm", "Riff", 60, ["@riff"]),
    item("!xuruh", "dm", "Xuruh", 10, ["@xuruh"]),
    item("!ops", "space", "Ops", 70),
    item("!big", "channel", "big general chat", 80),
];

const names = (results: QuickSwitcherItem[]) => results.map((result) => result.name);

describe("searchQuickSwitcher", () => {
    it("lists recent conversations when nothing is typed, without the current one or spaces", () => {
        expect(names(searchQuickSwitcher(ITEMS, "", "!riff"))).toEqual(["big general chat", "general", "gaming-news", "Lounge", "Xuruh"]);
    });

    it("puts names that start with the text first, then words, then anywhere, then spelled out", () => {
        expect(names(searchQuickSwitcher(ITEMS, "gen", null))).toEqual(["general", "big general chat"]);
        expect(names(searchQuickSwitcher(ITEMS, "news", null))).toEqual(["gaming-news"]);
        // Equal matches: the one with something newer in it first.
        expect(names(searchQuickSwitcher(ITEMS, "gnrl", null))).toEqual(["big general chat", "general"]);
    });

    it("ignores case and finds people by account name", () => {
        expect(names(searchQuickSwitcher(ITEMS, "LOUNGE", null))).toEqual(["Lounge"]);
        expect(names(searchQuickSwitcher(ITEMS, "@xuruh", null))).toEqual(["Xuruh"]);
    });

    it("narrows to people, channels or spaces with @, # or *", () => {
        expect(names(searchQuickSwitcher(ITEMS, "@", null))).toEqual(["Riff", "Xuruh"]);
        expect(names(searchQuickSwitcher(ITEMS, "# g", null))).toEqual(["general", "gaming-news", "big general chat", "Lounge"]);
        expect(names(searchQuickSwitcher(ITEMS, "*", null))).toEqual(["Ops"]);
        expect(names(searchQuickSwitcher(ITEMS, "*gen", null))).toEqual([]);
    });
});
