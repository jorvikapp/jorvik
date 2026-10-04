import { describe, expect, it, vi } from "vitest";

import { formatMessage } from "../../../../src/ui/formatting/formatMessage";

const RIFF = "@riff:matrix.jorvik.app";

function createClient(hasRoom = true) {
    const room = hasRoom
        ? { roomId: "!room:example.org", getMember: (userId: string) => (userId === RIFF ? { userId, membership: "join" } : null) }
        : null;
    return {
        getRoom: vi.fn(() => room),
        mxcUrlToHttp: vi.fn((mxc: string, width?: number, height?: number) => {
            const baseUrl = `https://cdn.example/${mxc.replace("mxc://", "")}`;
            return typeof width === "number" && typeof height === "number" ? `${baseUrl}?w=${width}&h=${height}` : baseUrl;
        }),
    };
}

const party = vi.fn(async (_client: unknown, _room: unknown, token: string) =>
    token === ":party:" ? { shortcode: ":party:", url: "mxc://example.org/party", name: "party" } : null,
);

async function format(text: string, resolver = vi.fn(async () => null) as never) {
    return formatMessage(text, { roomId: "!room:example.org", localDomain: "matrix.jorvik.app" }, resolver, createClient() as never);
}

async function html(text: string): Promise<string> {
    const result = await format(text);
    if (!("formatted_body" in result.content)) {
        throw new Error(`Expected HTML for ${JSON.stringify(text)}`);
    }
    expect(result.content.body).toBe(text);
    return result.content.formatted_body;
}

describe("formatMessage: plain text stays plain", () => {
    it.each([
        "hello world",
        "two lines\nof text",
        "see https://example.org/a_b_c for more",
        "2 * 3 * 4 = 24",
        "snake_case_names and file_name.txt",
        "#general is a channel, not a heading",
        "&amp; and <b> stay as typed",
        "[x](javascript:alert(1))",
    ])("%s", async (text) => {
        const result = await format(text);
        expect(result.content).toEqual({ body: text });
        expect(result.mentionedUserIds).toEqual([]);
    });

    it("returns plain body when the room is missing", async () => {
        const result = await formatMessage("**hi**", { roomId: "!missing", localDomain: null }, vi.fn() as never, createClient(false) as never);
        expect(result.content).toEqual({ body: "**hi**" });
    });
});

describe("formatMessage: Discord-style markdown", () => {
    it("handles the inline styles", async () => {
        expect(await html("**bold** *it* _it2_ __under__ ~~gone~~ ||secret|| `code`")).toBe(
            '<strong>bold</strong> <em>it</em> <em>it2</em> <u>under</u> <s>gone</s> <span data-mx-spoiler="">secret</span> <code>code</code>',
        );
    });

    it("lets a spoiler hold other formatting", async () => {
        expect(await html("||**loud**||")).toBe('<span data-mx-spoiler=""><strong>loud</strong></span>');
    });

    it("keeps code blocks exactly as typed", async () => {
        expect(await html("```js\nconst a = 1 < 2; // **not bold** @riff\n```")).toBe(
            '<pre><code class="language-js">const a = 1 &lt; 2; // **not bold** @riff\n</code></pre>',
        );
    });

    it("quotes only the > line, like Discord", async () => {
        expect(await html("> quoted\nmy reply")).toBe("<blockquote>\n<p>quoted</p>\n</blockquote>\n<p>my reply</p>");
    });

    it("quotes everything after >>>", async () => {
        expect(await html("intro\n>>> one\ntwo")).toBe("<p>intro</p>\n<blockquote>\n<p>one<br>\ntwo</p>\n</blockquote>");
    });

    it("makes lists, headings and masked links", async () => {
        expect(await html("- one\n- two")).toBe("<ul>\n<li>one</li>\n<li>two</li>\n</ul>");
        expect(await html("# Title")).toBe("<h1>Title</h1>");
        expect(await html("[the site](https://example.org)")).toBe('<a href="https://example.org">the site</a>');
    });

    it("escapes HTML typed by hand", async () => {
        expect(await html("<b>hi</b> **x**")).toBe("&lt;b&gt;hi&lt;/b&gt; <strong>x</strong>");
    });
});

describe("formatMessage: mentions and emoji", () => {
    it("links mentions, also inside formatting, and reports them", async () => {
        const result = await format("**@riff** look");
        expect(result.content).toMatchObject({ formatted_body: `<strong><a href="https://matrix.to/#/${RIFF}">@riff</a></strong> look` });
        expect(result.mentionedUserIds).toEqual([RIFF]);
    });

    it("does not mention anyone from inside code", async () => {
        const result = await format("`@riff` is the name");
        expect(result.content).toMatchObject({ formatted_body: "<code>@riff</code> is the name" });
        expect(result.mentionedUserIds).toEqual([]);
    });

    it("sends a lone mention with a link", async () => {
        const result = await format("@riff hi");
        expect(result.content).toMatchObject({ formatted_body: `<a href="https://matrix.to/#/${RIFF}">@riff</a> hi` });
    });

    it("replaces custom emoji, escapes around them and keeps line breaks", async () => {
        party.mockClear();
        const result = await format("a < b :party:\nnext :party:", party as never);
        expect(result.content).toMatchObject({
            formatted_body:
                'a &lt; b <img data-mx-emoticon="true" alt=":party:" title=":party:" height="24" width="24" src="https://cdn.example/example.org/party?w=24&amp;h=24" /><br>\nnext <img data-mx-emoticon="true" alt=":party:" title=":party:" height="24" width="24" src="https://cdn.example/example.org/party?w=24&amp;h=24" />',
        });
        expect(party).toHaveBeenCalledTimes(1);
    });

    it("leaves shortcodes inside links alone", async () => {
        party.mockClear();
        const result = await format("https://example.org/:party:/x", party as never);
        expect(result.content).toEqual({ body: "https://example.org/:party:/x" });
    });
});

describe("formatMessage: links", () => {
    it("leaves bare emails and full mentions on other servers alone", async () => {
        expect(await html("**x** mail me@example.org")).toBe("<strong>x</strong> mail me@example.org");
        expect(await html("**x** ask @bob:example.com")).toBe("<strong>x</strong> ask @bob:example.com");
    });
});
