import { describe, expect, it } from "vitest";

import { tokenizeMessage } from "../../../../src/ui/components/Timeline";

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
