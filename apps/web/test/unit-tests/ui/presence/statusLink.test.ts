import { describe, expect, it } from "vitest";

import { statusLinkHref } from "../../../../src/ui/presence/statusLink";

describe("statusLinkHref", () => {
    it("links a status that is one web address", () => {
        expect(statusLinkHref("https://twitch.tv/somebody")).toBe("https://twitch.tv/somebody");
        expect(statusLinkHref("twitch.tv/somebody")).toBe("https://twitch.tv/somebody");
        expect(statusLinkHref("  www.example.com  ")).toBe("https://www.example.com/");
        expect(statusLinkHref("http://example.org/a?b=1#c")).toBe("http://example.org/a?b=1#c");
    });

    it("leaves ordinary text alone", () => {
        expect(statusLinkHref("back in 5")).toBeNull();
        expect(statusLinkHref("live at twitch.tv/somebody")).toBeNull();
        expect(statusLinkHref("brb...")).toBeNull();
        expect(statusLinkHref("v1.0")).toBeNull();
        expect(statusLinkHref("me@example.com")).toBeNull();
        expect(statusLinkHref("")).toBeNull();
        expect(statusLinkHref(null)).toBeNull();
    });

    it("never links anything but http and https", () => {
        expect(statusLinkHref("javascript:alert(1)")).toBeNull();
        expect(statusLinkHref("file:///etc/passwd")).toBeNull();
        expect(statusLinkHref("data:text/html,hi")).toBeNull();
        expect(statusLinkHref("https://localhost/x")).toBeNull();
    });
});
