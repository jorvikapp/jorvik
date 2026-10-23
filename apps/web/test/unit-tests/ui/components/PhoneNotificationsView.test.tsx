import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PhoneNotificationsView } from "../../../../src/ui/components/phone/PhoneNotificationsView";
import type { InboxMention } from "../../../../src/ui/notifications/phoneInbox";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

function mention(eventId: string, unread: boolean): InboxMention {
    return { roomId: "!general", eventId, senderId: "@bob:test.local", body: "hey @me", ts: 1000, unread };
}

function renderView(mentions: InboxMention[], onClearMentions = vi.fn()): void {
    act(() => {
        root.render(
            <PhoneNotificationsView
                client={{ getRoom: () => null, getUser: () => null } as unknown as MatrixClient}
                invites={[]}
                mentions={mentions}
                roomName={() => "#general"}
                roomContext={() => "Ops"}
                isDirectRoom={() => false}
                userName={() => "Bob"}
                onOpenMention={() => undefined}
                onAcceptInvite={async () => undefined}
                onDeclineInvite={async () => undefined}
                onClearMentions={onClearMentions}
            />,
        );
    });
}

function clearButton(): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Clear mentions");
}

describe("PhoneNotificationsView", () => {
    // Read mentions used to stay on the list with nothing to clear them: "Mark all read" only
    // showed while one was unread.
    it("offers to clear mentions that are already read", () => {
        const onClearMentions = vi.fn();
        renderView([mention("$a", false), mention("$b", false)], onClearMentions);

        act(() => {
            clearButton()!.click();
        });

        expect(onClearMentions).toHaveBeenCalledTimes(1);
    });

    it("offers it for unread ones too, and not when there's nothing to clear", () => {
        renderView([mention("$a", true)]);
        expect(clearButton()).toBeDefined();

        renderView([]);
        expect(clearButton()).toBeUndefined();
        expect(container.textContent).toContain("Nothing new.");
    });
});
