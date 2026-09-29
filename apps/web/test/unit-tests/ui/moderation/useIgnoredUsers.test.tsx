import { EventEmitter } from "events";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ClientEvent, MatrixEvent } from "matrix-js-sdk/src/matrix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useIgnoredUsers, type IgnoredUsersController } from "../../../../src/ui/moderation/useIgnoredUsers";

let container: HTMLDivElement;
let root: Root;
let controller: IgnoredUsersController;

function makeClient(initial: string[] = []) {
    const emitter = new EventEmitter();
    let ignored = [...initial];
    return Object.assign(emitter, {
        getIgnoredUsers: () => [...ignored],
        setIgnoredUsers: vi.fn(async (next: string[]) => {
            ignored = [...next];
            emitter.emit(ClientEvent.AccountData, new MatrixEvent({ type: "m.ignored_user_list", content: {} }));
            return {};
        }),
        removeListener: emitter.removeListener.bind(emitter),
    });
}

function Probe({ client }: { client: ReturnType<typeof makeClient> }): null {
    controller = useIgnoredUsers(client as never);
    return null;
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

describe("useIgnoredUsers", () => {
    it("blocks and unblocks, keeping everyone else on the list", async () => {
        const client = makeClient(["@old:x"]);
        act(() => root.render(<Probe client={client} />));
        expect(controller.isIgnored("@old:x")).toBe(true);

        await act(async () => controller.setIgnored("@bad:x", true));
        expect(client.setIgnoredUsers).toHaveBeenLastCalledWith(["@old:x", "@bad:x"]);
        expect(controller.isIgnored("@bad:x")).toBe(true);

        await act(async () => controller.setIgnored("@bad:x", true));
        expect(client.setIgnoredUsers).toHaveBeenLastCalledWith(["@old:x", "@bad:x"]);

        await act(async () => controller.setIgnored("@bad:x", false));
        expect(client.setIgnoredUsers).toHaveBeenLastCalledWith(["@old:x"]);
        expect(controller.ignoredUserIds).toEqual(["@old:x"]);
    });

    it("follows changes made on another device", () => {
        const client = makeClient();
        act(() => root.render(<Probe client={client} />));
        act(() => {
            (client as unknown as { getIgnoredUsers: () => string[] }).getIgnoredUsers = () => ["@elsewhere:x"];
            client.emit(ClientEvent.AccountData, new MatrixEvent({ type: "m.ignored_user_list", content: {} }));
        });
        expect(controller.ignoredUserIds).toEqual(["@elsewhere:x"]);
    });
});
