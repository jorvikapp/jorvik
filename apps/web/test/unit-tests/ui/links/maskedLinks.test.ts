import { afterEach, describe, expect, it } from "vitest";

import { isMaskedLink, isTrustedLinkHost, linkHost, trustLinkHost } from "../../../../src/ui/links/maskedLinks";

afterEach(() => {
    window.localStorage.clear();
});

describe("isMaskedLink", () => {
    it.each([
        ["https://www.jorvik.app", "https://www.jorvik.app/"],
        ["www.jorvik.app/download", "https://www.jorvik.app/download"],
        ["https://www.jorvik.app/blog", "https://www.jorvik.app/download"],
        ["me@example.org", "mailto:me@example.org"],
    ])("%s going to %s hides nothing", (text, href) => {
        expect(isMaskedLink(text, href)).toBe(false);
    });

    it.each([
        ["Jorvik", "https://www.jorvik.app/"],
        ["the download page", "https://www.jorvik.app/download"],
        ["https://www.jorvik.app", "https://evil.example/"],
        ["jorvik.app", "https://www.jorvik.app/"],
        ["someone@example.org", "mailto:other@example.org"],
        ["", "https://www.jorvik.app/"],
    ])("%s going to %s is masked", (text, href) => {
        expect(isMaskedLink(text, href)).toBe(true);
    });
});

describe("trusted sites", () => {
    it("remembers a site on this device, ignoring case", () => {
        expect(isTrustedLinkHost("www.jorvik.app")).toBe(false);
        trustLinkHost("WWW.Jorvik.App");
        trustLinkHost("www.jorvik.app");
        expect(isTrustedLinkHost("www.jorvik.app")).toBe(true);
        expect(JSON.parse(window.localStorage.getItem("jorvik.trusted_link_hosts") ?? "[]")).toEqual(["www.jorvik.app"]);
    });

    it("ignores a broken list", () => {
        window.localStorage.setItem("jorvik.trusted_link_hosts", "{not json");
        expect(isTrustedLinkHost("www.jorvik.app")).toBe(false);
    });

    it("finds the site of a link", () => {
        expect(linkHost("https://WWW.Jorvik.App/x")).toBe("www.jorvik.app");
        expect(linkHost("mailto:me@example.org")).toBeNull();
        expect(linkHost("not a url")).toBeNull();
    });
});
