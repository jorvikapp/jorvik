import { createClient, MatrixEvent, User, UserEvent } from "matrix-js-sdk/src/matrix";
import { describe, expect, it, vi } from "vitest";

import { forwardOwnUserEvents } from "../../../../src/core/client/MatrixClientManager";

const ME = "@me:example.org";

function presenceEvent(presence: string): MatrixEvent {
    return new MatrixEvent({ type: "m.presence", sender: ME, content: { presence } });
}

describe("forwardOwnUserEvents", () => {
    it("makes our own presence changes reach client-level listeners, once", () => {
        const client = createClient({ baseUrl: "https://example.org", userId: ME });
        // What startClient stores for us: a bare User, not User.createUser.
        const me = new User(ME);
        client.store.storeUser(me);
        const onPresence = vi.fn();
        client.on(UserEvent.Presence, onPresence);

        me.setPresenceEvent(presenceEvent("online"));
        expect(onPresence).not.toHaveBeenCalled();

        forwardOwnUserEvents(client);
        forwardOwnUserEvents(client);
        me.setPresenceEvent(presenceEvent("unavailable"));
        expect(onPresence).toHaveBeenCalledTimes(1);
        expect(onPresence.mock.calls[0][1]).toBe(me);
    });
});
