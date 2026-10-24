import { EventEmitter } from "events";
import { ClientEvent } from "matrix-js-sdk/src/matrix";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ACTIVITY_PRIVACY_EVENT } from "../../../../src/core/activity/activityPrivacy";
import { useActivityPrivacyMigration } from "../../../../src/ui/activity/useActivityPrivacy";

let container: HTMLDivElement;
let root: Root;

function fakeClient({ synced, stored }: { synced: boolean; stored?: object }) {
    const emitter = new EventEmitter();
    const client = Object.assign(emitter, {
        synced,
        isInitialSyncComplete: () => client.synced,
        getAccountData: (type: string) => (type === ACTIVITY_PRIVACY_EVENT && stored ? { getContent: () => stored } : undefined),
        setAccountData: vi.fn(async () => undefined),
        removeListener: emitter.removeListener.bind(emitter),
    });
    return client;
}

function Probe({ client, legacy, onMigrated }: { client: unknown; legacy: boolean; onMigrated: () => void }): null {
    useActivityPrivacyMigration(client as never, legacy, onMigrated);
    return null;
}

async function render(client: unknown, legacy: boolean, onMigrated: () => void): Promise<void> {
    await act(async () => {
        root.render(<Probe client={client} legacy={legacy} onMigrated={onMigrated} />);
    });
}

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

describe("useActivityPrivacyMigration", () => {
    it("waits for the first sync, then carries 1.0.27's switch over once", async () => {
        const client = fakeClient({ synced: false });
        const onMigrated = vi.fn();
        await render(client, true, onMigrated);
        expect(client.setAccountData).not.toHaveBeenCalled();

        client.synced = true;
        await act(async () => {
            client.emit(ClientEvent.Sync, "PREPARED");
        });
        expect(client.setAccountData).toHaveBeenCalledWith(
            ACTIVITY_PRIVACY_EVENT,
            expect.objectContaining({ enabled: true, space_scope: "small", share_with_friends: true }),
        );
        expect(onMigrated).toHaveBeenCalledTimes(1);

        await act(async () => {
            client.emit(ClientEvent.Sync, "SYNCING");
        });
        expect(client.setAccountData).toHaveBeenCalledTimes(1);
    });

    it("never overrides settings the account already has", async () => {
        const client = fakeClient({ synced: true, stored: { enabled: false } });
        const onMigrated = vi.fn();
        await render(client, true, onMigrated);
        expect(client.setAccountData).not.toHaveBeenCalled();
        expect(onMigrated).toHaveBeenCalled();
    });

    it("does nothing for someone who never had the switch on", async () => {
        const client = fakeClient({ synced: true });
        await render(client, false, vi.fn());
        expect(client.setAccountData).not.toHaveBeenCalled();
    });
});
