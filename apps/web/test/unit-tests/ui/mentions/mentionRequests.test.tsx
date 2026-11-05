import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { requestMention, useMentionRequests } from "../../../../src/ui/mentions/mentionRequests";

function MessageBox({ roomId, onMention }: { roomId: string; onMention: (userId: string) => void }): null {
    useMentionRequests(roomId, onMention);
    return null;
}

describe("Mention from someone's menu", () => {
    it("reaches the message box of that room only, and nothing once it's gone", () => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        const general = vi.fn();
        const random = vi.fn();
        const root = createRoot(document.createElement("div"));
        act(() =>
            root.render(
                <>
                    <MessageBox roomId="!general" onMention={general} />
                    <MessageBox roomId="!random" onMention={random} />
                </>,
            ),
        );
        expect(requestMention("!general", "@riff:example.org")).toBe(true);
        expect(general).toHaveBeenCalledWith("@riff:example.org");
        expect(random).not.toHaveBeenCalled();

        act(() => root.unmount());
        expect(requestMention("!general", "@riff:example.org")).toBe(false);
        expect(general).toHaveBeenCalledTimes(1);
    });
});
