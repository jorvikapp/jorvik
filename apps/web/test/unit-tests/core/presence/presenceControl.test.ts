import { afterEach, describe, expect, it, vi } from "vitest";

import {
    applyPresenceSelection,
    resetPresencePublishState,
    type PresenceChoice,
} from "../../../../src/core/presence/presenceControl";

function makeClient() {
    return {
        getSafeUserId: () => "@me:example.org",
        setSyncPresence: vi.fn(),
        setPresence: vi.fn(async () => undefined),
        http: { authedRequest: vi.fn(async () => ({})) },
    };
}

async function publish(choice: PresenceChoice, statusMessage = "") {
    const client = makeClient();
    await applyPresenceSelection(client as never, { choice, statusMessage });
    return client;
}

afterEach(() => {
    resetPresencePublishState();
});

describe("applyPresenceSelection", () => {
    it("sends Do Not Disturb as MSC3026 busy, bypassing setPresence's value check", async () => {
        const client = await publish("dnd", "heads down");

        expect(client.setPresence).not.toHaveBeenCalled();
        expect(client.http.authedRequest).toHaveBeenCalledWith(
            "PUT",
            "/presence/%40me%3Aexample.org/status",
            undefined,
            { presence: "org.matrix.msc3026.busy", status_msg: "heads down" },
        );
    });

    it("still uses setPresence for the standard states", async () => {
        for (const [choice, presence] of [
            ["online", "online"],
            ["idle", "unavailable"],
            ["invisible", "offline"],
        ] as const) {
            resetPresencePublishState();
            const client = await publish(choice);
            expect(client.http.authedRequest).not.toHaveBeenCalled();
            expect(client.setPresence).toHaveBeenCalledWith({ presence, status_msg: undefined });
        }
    });
});
