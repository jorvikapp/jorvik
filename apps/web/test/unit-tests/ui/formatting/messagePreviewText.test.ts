import { describe, expect, it } from "vitest";

import { messagePreviewText, SPOILER_PLACEHOLDER } from "../../../../src/ui/formatting/messagePreviewText";

const html = (formatted_body: string, body = "unused") => ({ body, format: "org.matrix.custom.html", formatted_body });

describe("messagePreviewText", () => {
    it("uses the plain body, without an old reply quote", () => {
        expect(messagePreviewText({ body: "> <@a:b> hi\n\nmy answer" })).toBe("my answer");
        expect(messagePreviewText({ body: 42 })).toBe("");
        expect(messagePreviewText({ body: "> typed quote\nmy words" })).toBe("> typed quote\nmy words");
    });

    it("hides spoilers and leaves out formatting marks", () => {
        expect(messagePreviewText(html('<strong>Big</strong> news: <span data-mx-spoiler="">he lives</span>', "**Big** news: ||he lives||"))).toBe(
            `Big news: ${SPOILER_PLACEHOLDER}`,
        );
    });

    it("keeps line breaks and blocks as lines, and code as written", () => {
        expect(messagePreviewText(html("<blockquote>\n<p>quoted</p>\n</blockquote>\n<p>reply<br>\nmore</p>"))).toBe("quoted\nreply\nmore");
        expect(messagePreviewText(html("<pre><code>a  =  1\n</code></pre>"))).toBe("a  =  1");
    });

    it("skips old reply quotes and shows emoji by name", () => {
        expect(
            messagePreviewText(html('<mx-reply><blockquote>In reply to secret</blockquote></mx-reply>ok <img data-mx-emoticon alt=":party:" src="x">')),
        ).toBe("ok :party:");
    });
});
