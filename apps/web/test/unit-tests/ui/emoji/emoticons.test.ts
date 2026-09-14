import { describe, expect, it } from "vitest";

import { replaceEmoticons } from "../../../../src/ui/emoji/emoticons";

describe("replaceEmoticons", () => {
    it("replaces the noseless, hyphen and equals spellings alike", () => {
        expect(replaceEmoticons(":)")).toBe("\u{1F642}");
        expect(replaceEmoticons(":-)")).toBe("\u{1F642}");
        expect(replaceEmoticons(":=)")).toBe("\u{1F642}");
        expect(replaceEmoticons(":D")).toBe("\u{1F603}");
        expect(replaceEmoticons(":=D")).toBe("\u{1F603}");
    });

    it("replaces emoticons surrounded by text", () => {
        expect(replaceEmoticons("hey :) there")).toBe("hey \u{1F642} there");
        expect(replaceEmoticons("line one :D\nline two ;)")).toBe("line one \u{1F603}\nline two \u{1F609}");
    });

    it("replaces every occurrence", () => {
        expect(replaceEmoticons(":) :( :)")).toBe("\u{1F642} \u{1F641} \u{1F642}");
    });

    it("prefers the longest match", () => {
        expect(replaceEmoticons("</3")).toBe("\u{1F494}");
        expect(replaceEmoticons("<3")).toBe("\u{2764}\u{FE0F}");
    });

    it("leaves URLs alone", () => {
        const url = "https://matrix.jorvik.app/path:)notspaced";
        expect(replaceEmoticons(url)).toBe(url);
        expect(replaceEmoticons("see http://example.org/a")).toBe("see http://example.org/a");
    });

    it("requires a whitespace boundary on both sides", () => {
        expect(replaceEmoticons("a:)b")).toBe("a:)b");
        expect(replaceEmoticons("(:))")).toBe("(:))");
        expect(replaceEmoticons("8)")).toBe("8)");
    });

    it("passes through text with no emoticons", () => {
        expect(replaceEmoticons("nothing to see here")).toBe("nothing to see here");
        expect(replaceEmoticons("")).toBe("");
    });

    it("does not disturb custom pack shortcodes", () => {
        expect(replaceEmoticons("nice :partyparrot: work")).toBe("nice :partyparrot: work");
    });
});
