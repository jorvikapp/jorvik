import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ComposerBar } from "../../../../src/ui/components/composer/ComposerBar";

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

const noop = (): void => undefined;

async function renderBar(props: { value?: string; hasFilesToSend?: boolean; attachMenu?: boolean }): Promise<void> {
    await act(async () => {
        root.render(
            <ComposerBar
                disabled={false}
                dragActive={false}
                value={props.value ?? ""}
                placeholder="Message #general"
                textareaRef={React.createRef()}
                emojiButtonRef={React.createRef()}
                onChange={noop}
                onCursorActivity={noop}
                onBlur={noop}
                onKeyDown={noop}
                onPaste={noop}
                onDragEnter={noop}
                onDragOver={noop}
                onDragLeave={noop}
                onDrop={noop}
                onAttach={noop}
                attachMenu={props.attachMenu}
                showSend
                hasFilesToSend={props.hasFilesToSend}
                onSend={noop}
                onToggleEmoji={noop}
                onToggleGif={noop}
                emojiPicker={null}
                gifPicker={null}
            />,
        );
    });
}

function sendButton(): Element | null {
    return container.querySelector('button[aria-label="Send message"]');
}

describe("ComposerBar on phones", () => {
    it("has nothing to send with an empty box", async () => {
        await renderBar({});
        expect(sendButton()).toBeNull();
    });

    it("offers to send a picked photo even with no text, since Return only starts a new line", async () => {
        await renderBar({ hasFilesToSend: true });
        expect(sendButton()).not.toBeNull();
    });

    it("says the + opens a menu when it does", async () => {
        await renderBar({ attachMenu: true });
        expect(container.querySelector('button[aria-label="Upload attachment"]')?.getAttribute("aria-haspopup")).toBe("dialog");
    });
});
