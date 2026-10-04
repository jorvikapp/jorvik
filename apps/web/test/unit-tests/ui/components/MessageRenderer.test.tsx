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
