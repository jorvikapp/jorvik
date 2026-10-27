import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => ({
    availability: "available" as "available" | "needs_home_screen" | "unsupported",
    enabled: false,
    enablePush: vi.fn(),
    disablePush: vi.fn(),
}));
vi.mock("../../../../src/core/push/webPush", () => ({
    getWebPushConfig: (config: { web_push?: unknown } | null) => (config?.web_push ? { gatewayUrl: "g", appId: "a", vapidPublicKey: "k" } : null),
    getPushAvailability: () => push.availability,
    isPushEnabledHere: () => push.enabled,
    enablePush: push.enablePush,
    disablePush: push.disablePush,
}));
const matrix = vi.hoisted(() => ({ value: { client: {}, config: { web_push: {} } as Record<string, unknown> } }));
vi.mock("../../../../src/ui/providers/MatrixProvider", () => ({ useMatrix: () => matrix.value }));

import { NotificationsTab } from "../../../../src/ui/settings/user/tabs/NotificationsTab";

let container: HTMLDivElement;
let root: Root;

const SETTINGS = {
    notificationsEnabled: false,
    notificationBodyEnabled: true,
    audioNotificationsEnabled: true,
    customMessageSoundDataUrl: null,
    customMessageSoundName: null,
} as never;

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    push.availability = "available";
    push.enabled = false;
    push.enablePush.mockReset().mockResolvedValue(undefined);
    push.disablePush.mockReset().mockResolvedValue(undefined);
    matrix.value = { client: {}, config: { web_push: {} } };
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

async function render(): Promise<void> {
    await act(async () => {
        root.render(<NotificationsTab settings={SETTINGS} onChange={() => undefined} />);
    });
}

function pushToggle(): HTMLInputElement | null {
    const label = Array.from(container.querySelectorAll("label")).find((candidate) =>
        candidate.textContent?.includes("Push notifications on this device"),
    );
    return label?.querySelector("input") ?? null;
}

describe("NotificationsTab push card", () => {
    it("turns push on for this device from the switch", async () => {
        await render();
        await act(async () => {
            pushToggle()?.click();
        });
        expect(push.enablePush).toHaveBeenCalledWith(matrix.value.client, expect.anything(), { hideBody: false });
        expect(pushToggle()?.checked).toBe(true);
    });

    it("shows why when it couldn't be turned on", async () => {
        push.enablePush.mockRejectedValue(new Error("Notifications are blocked for Jorvik."));
        await render();
        await act(async () => {
            pushToggle()?.click();
        });
        expect(container.textContent).toContain("Notifications are blocked for Jorvik.");
        expect(pushToggle()?.checked).toBe(false);
    });

    it("tells iPhone users to add Jorvik to the Home Screen", async () => {
        push.availability = "needs_home_screen";
        await render();
        expect(container.textContent).toContain("Add to Home Screen");
        expect(pushToggle()).toBeNull();
    });

    it("hides the card in the desktop app, which has no push service", async () => {
        (window as { heorotDesktop?: unknown }).heorotDesktop = {};
        try {
            await render();
            expect(container.textContent).not.toContain("Push notifications");
        } finally {
            delete (window as { heorotDesktop?: unknown }).heorotDesktop;
        }
    });

    it("hides the card where the server has no push gateway", async () => {
        matrix.value = { client: {}, config: {} };
        await render();
        expect(container.textContent).not.toContain("Push notifications");
    });
});

describe("NotificationsTab notifications while Jorvik is open", () => {
    const realNotification = (globalThis as { Notification?: unknown }).Notification;

    function stubNotification(permission: string, answer = permission): void {
        (globalThis as { Notification?: unknown }).Notification = {
            permission,
            requestPermission: vi.fn(async () => answer),
        };
    }

    afterEach(() => {
        (globalThis as { Notification?: unknown }).Notification = realNotification;
    });

    function desktopToggle(): HTMLInputElement | null {
        const label = Array.from(container.querySelectorAll("label")).find((candidate) =>
            candidate.textContent?.includes("Enable desktop notifications"),
        );
        return label?.querySelector("input") ?? null;
    }

    it("says in plain words when this browser blocks them", async () => {
        stubNotification("denied");
        await render();
        expect(container.textContent).toContain("Notifications are blocked for Jorvik. Allow them in this browser's settings.");
        expect(container.textContent).not.toContain("Permission:");
    });

    it("says nothing extra once they're allowed", async () => {
        stubNotification("granted");
        await render();
        expect(container.textContent).not.toContain("blocked");
        expect(container.textContent).not.toContain("can't show notifications");
    });

    it("asks again when the browser's prompt was only closed", async () => {
        stubNotification("default", "default");
        const onChange = vi.fn();
        await act(async () => {
            root.render(<NotificationsTab settings={SETTINGS} onChange={onChange} />);
        });
        await act(async () => {
            desktopToggle()?.click();
        });
        expect(container.textContent).toContain("Try again and choose Allow.");
        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ notificationsEnabled: false }));
    });
});
