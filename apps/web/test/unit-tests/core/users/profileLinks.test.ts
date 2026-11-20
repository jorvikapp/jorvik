import { describe, expect, it } from "vitest";

import { describeProfileLink, MAX_PROFILE_LINKS, profileLinksFrom, webLinkHref } from "../../../../src/core/users/profileLinks";

describe("webLinkHref", () => {
    it("takes bare and full web addresses", () => {
        expect(webLinkHref("twitch.tv/xuruh")).toBe("https://twitch.tv/xuruh");
        expect(webLinkHref(" https://www.youtube.com/@xuruh ")).toBe("https://www.youtube.com/@xuruh");
    });

    it("refuses other kinds of link, text and addresses with a login in them", () => {
        for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "hello there", "me@example.com", "localhost", "https://user:pw@twitch.tv/x", ""]) {
            expect(webLinkHref(bad), bad).toBeNull();
        }
    });
});

describe("profileLinksFrom", () => {
    it("keeps web addresses only, without repeats, up to the limit", () => {
        expect(profileLinksFrom(["twitch.tv/a", "https://twitch.tv/a", 5, "javascript:x", "jorvik.app"])).toEqual(["https://twitch.tv/a", "https://jorvik.app/"]);
        expect(profileLinksFrom("twitch.tv/a")).toEqual([]);
        expect(profileLinksFrom(Array.from({ length: 9 }, (_, i) => `site${i}.com`))).toHaveLength(MAX_PROFILE_LINKS);
        expect(profileLinksFrom([`https://x.com/${"a".repeat(400)}`])).toEqual([]);
    });
});

describe("describeProfileLink", () => {
    it("names the site and the account", () => {
        expect(describeProfileLink("https://www.twitch.tv/xuruh")).toMatchObject({ site: "Twitch", kind: "twitch", label: "xuruh" });
        expect(describeProfileLink("https://m.youtube.com/@xuruh")).toMatchObject({ site: "YouTube", label: "@xuruh" });
        expect(describeProfileLink("https://twitter.com/xuruh")).toMatchObject({ site: "X", label: "@xuruh" });
        expect(describeProfileLink("https://bsky.app/profile/xuruh.bsky.social")).toMatchObject({ site: "Bluesky", label: "@xuruh.bsky.social" });
    });

    it("shows anything else as a website with its real address", () => {
        expect(describeProfileLink("https://jorvik.app/")).toMatchObject({ site: "Website", kind: "web", label: "jorvik.app" });
        expect(describeProfileLink("https://twitch.tv.evil.example/xuruh")).toMatchObject({ site: "Website", label: "twitch.tv.evil.example/xuruh" });
        expect(describeProfileLink("https://www.youtube.com/watch?v=abc")).toMatchObject({ site: "YouTube", label: "youtube.com/watch" });
    });
});
