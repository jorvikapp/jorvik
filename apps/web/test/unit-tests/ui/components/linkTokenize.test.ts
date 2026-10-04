import { describe, expect, it } from "vitest";

import { containsDirectMention, tokenizeMessage } from "../../../../src/ui/components/Timeline";

const links = (body: string) =>
    tokenizeMessage(body)
        .filter((segment) => segment.type === "link")
        .map((segment) => (segment as { href: string }).href);

describe("tokenizeMessage links", () => {
    it("keeps parentheses that belong to the URL", () => {
        expect(links("background reading https://en.wikipedia.org/wiki/Matrix_(protocol)")).toEqual([
            "https://en.wikipedia.org/wiki/Matrix_(protocol)",
        ]);
        expect(links("see https://example.com/a_(b)_c. next")).toEqual(["https://example.com/a_(b)_c"]);
    });

    it("drops a closing parenthesis or punctuation that only ends the sentence", () => {
        const segments = tokenizeMessage("(see https://example.com)");
        expect(links("(see https://example.com)")).toEqual(["https://example.com"]);
        expect(segments.map((segment) => segment.value).join("")).toBe("(see https://example.com)");
        expect(links("go to www.example.com, now")).toEqual(["https://www.example.com"]);
        expect(links("is it https://example.com/x?")).toEqual(["https://example.com/x"]);
    });
});

describe("containsDirectMention", () => {
    const ME = "@riff:matrix.jorvik.app";

    it("trusts the message's m.mentions, whatever its text says", () => {
        expect(containsDirectMention({ "m.mentions": { user_ids: [ME] } }, "@riff look", ME)).toBe(true);
        expect(containsDirectMention({ "m.mentions": { user_ids: [ME] } }, "Riff look", ME)).toBe(true);
    });

    it("still finds your full ID in the text of older messages", () => {
        expect(containsDirectMention({}, "hey @riff:matrix.jorvik.app", ME)).toBe(true);
    });

    it("is false for anyone else, or for an empty mentions list", () => {
        expect(containsDirectMention({ "m.mentions": { user_ids: ["@bob:matrix.org"] } }, "@riff", ME)).toBe(false);
        expect(containsDirectMention({ "m.mentions": {} }, "@riff", ME)).toBe(false);
        expect(containsDirectMention({ "m.mentions": { user_ids: [ME] } }, "@riff", null)).toBe(false);
    });
});
