import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PresenceVm } from "../../../../src/ui/presence/buildPresenceVm";
import { usePresenceVm } from "../../../../src/ui/presence/usePresence";

const USER_ID = "@jason:example.org";

let container: HTMLDivElement;
let root: Root;
let latest: PresenceVm | null = null;

function Probe({ client }: { client: unknown }): null {
    latest = usePresenceVm(client as never, USER_ID, true);
    return null;
}

describe("usePresenceVm", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
        container = document.createElement("div");
        root = createRoot(container);
        latest = null;
    });

    afterEach(() => {
        act(() => root.unmount());
        vi.useRealTimers();
    });

    it("keeps counting how long an idle user has been away", async () => {
        // The server reported "idle, last active 5 minutes ago" just now, and sends
        // nothing more while the user stays idle.
        const user = {
            userId: USER_ID,
            presence: "unavailable",
            currentlyActive: false,
            lastActiveAgo: 5 * 60_000,
            lastPresenceTs: Date.now(),
        };
        const client = { getUser: vi.fn(() => user), on: vi.fn(), removeListener: vi.fn() };

        await act(async () => {
            root.render(<Probe client={client} />);
        });
        expect(latest?.primaryLabel).toBe("Idle");
        expect(latest?.secondaryLabel).toBe("Last active 5m ago");

        await act(async () => {
            vi.advanceTimersByTime(10 * 60_000);
        });
        expect(latest?.secondaryLabel).toBe("Last active 15m ago");
    });
});
