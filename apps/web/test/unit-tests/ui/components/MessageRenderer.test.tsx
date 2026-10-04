import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MessageRenderer } from "../../../../src/ui/components/MessageRenderer";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
});

function render(formattedBody: string, body = "fallback"): void {
    act(() => {
        root.render(
            <MessageRenderer
                body={body}
                format="org.matrix.custom.html"
                formattedBody={formattedBody}
                resolveMentionDisplayName={(userId) => (userId === "@riff:matrix.jorvik.app" ? "Riff" : null)}
                ownUserId="@riff:matrix.jorvik.app"
            />,
        );
    });
}

describe("MessageRenderer mention links", () => {
    it("shows a matrix.to link to a user as a mention pill", () => {
        render('hi <a href="https://matrix.to/#/@riff:matrix.jorvik.app">@riff</a>!');
        const pill = container.querySelector(".message-renderer-mention");
        expect(pill?.getAttribute("data-mention-user-id")).toBe("@riff:matrix.jorvik.app");
        expect(pill?.textContent).toBe("@Riff");
        expect(pill?.classList.contains("is-direct")).toBe(true);
        expect(container.textContent).toBe("hi @Riff!");
    });

    it("reads an encoded user ID, as some clients send it", () => {
        render('<a href="https://matrix.to/#/%40bob%3Amatrix.org">Bob</a>');
        expect(container.querySelector(".message-renderer-mention")?.getAttribute("data-mention-user-id")).toBe("@bob:matrix.org");
    });

    it("leaves links to rooms and websites as their text", () => {
        render('<a href="https://matrix.to/#/#jorvik:matrix.jorvik.app">#jorvik</a> and <a href="https://example.org">a site</a>');
        expect(container.querySelector(".message-renderer-mention")).toBeNull();
        expect(container.textContent).toBe("#jorvik and a site");
    });
});

describe("MessageRenderer formatting", () => {
    it("shows inline formatting as the same elements", () => {
        render("<strong>b</strong> <em>i</em> <u>u</u> <del>s</del> <sup>2</sup>");
        expect([...container.querySelectorAll(".message-renderer-html *")].map((el) => el.tagName.toLowerCase())).toEqual(["strong", "em", "u", "s", "sup"]);
    });

    it("shows code exactly as sent, without mentions inside", () => {
        render('<code>@riff:matrix.jorvik.app</code><pre><code class="language-js">a &lt; b\n  c</code></pre>');
        expect(container.querySelector(".message-renderer-code")?.textContent).toBe("@riff:matrix.jorvik.app");
        expect(container.querySelector(".message-renderer-codeblock")?.textContent).toBe("a < b\n  c");
        expect(container.querySelector(".message-renderer-mention")).toBeNull();
    });

    it("hides a spoiler until it is clicked", () => {
        render('see <span data-mx-spoiler="">the ending</span>');
        const spoiler = container.querySelector(".message-renderer-spoiler") as HTMLElement;
        expect(spoiler.getAttribute("role")).toBe("button");
        expect(spoiler.classList.contains("is-revealed")).toBe(false);
        act(() => {
            spoiler.click();
        });
        const revealed = container.querySelector(".message-renderer-spoiler") as HTMLElement;
        expect(revealed.classList.contains("is-revealed")).toBe(true);
        expect(revealed.getAttribute("role")).toBeNull();
    });

    it("opens web links outside, and drops links to anything else", () => {
        render('<a href="https://example.org/a">site</a> <a href="javascript:alert(1)">bad</a>');
        const links = [...container.querySelectorAll("a")];
        expect(links).toHaveLength(1);
        expect(links[0].getAttribute("href")).toBe("https://example.org/a");
        expect(links[0].getAttribute("target")).toBe("_blank");
        expect(links[0].getAttribute("rel")).toBe("noopener noreferrer");
        expect(container.textContent).toBe("site bad");
    });

    it("keeps lists free of stray text, and drops scripts and styles entirely", () => {
        render("<ul>\n<li>one</li>\n<li>two</li>\n</ul><script>alert(1)</script><style>p{}</style><blockquote><p>q</p></blockquote>");
        const list = container.querySelector(".message-renderer-ul") as HTMLElement;
        expect([...list.childNodes].every((child) => child.nodeType === Node.ELEMENT_NODE)).toBe(true);
        expect(container.textContent).toBe("onetwoq");
        expect(container.querySelector(".message-renderer-blockquote .message-renderer-p")?.textContent).toBe("q");
    });
});

describe("MessageRenderer old reply quotes", () => {
    it("leaves out the quote some clients put in front of replies", () => {
        render("<mx-reply><blockquote>In reply to <a href=\"https://matrix.to/#/@a:b\">@a:b</a> old</blockquote></mx-reply>the answer");
        expect(container.textContent).toBe("the answer");
    });
});
