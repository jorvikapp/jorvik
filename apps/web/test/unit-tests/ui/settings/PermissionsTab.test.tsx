import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PermissionsTab } from "../../../../src/ui/settings/server/tabs/PermissionsTab";

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

const POWER_LEVELS = {
    users: { "@me:example.org": 100, "@mod:example.org": 50 },
    users_default: 0,
    events_default: 100,
    state_default: 50,
    invite: 0,
    kick: 50,
    ban: 50,
    redact: 50,
    events: { "m.room.name": 50, "m.room.power_levels": 100, "org.example.custom": 20 },
};

async function renderTab(): Promise<void> {
    const room = {
        roomId: "!space:example.org",
        currentState: {
            getStateEvents: (type: string) => (type === "m.room.power_levels" ? { getContent: () => POWER_LEVELS } : null),
            maySendStateEvent: () => true,
        },
    };
    const client = { getUserId: () => "@me:example.org" };
    await act(async () => {
        root.render(<PermissionsTab client={client as never} spaceRoom={room as never} onToast={() => undefined} />);
    });
}

describe("PermissionsTab", () => {
    it("names what each rank allows, not the fields it's stored in", async () => {
        await renderTab();
        const labels = Array.from(container.querySelectorAll(".settings-power-grid .settings-field span")).map(
            (span) => span.textContent,
        );
        expect(labels).toEqual([
            "Members' rank",
            "Send messages",
            "Change settings",
            "Invite people",
            "Remove people",
            "Ban people",
            "Delete other people's messages",
        ]);
        expect(container.textContent).toContain("Your rank: 100");
        for (const raw of ["users_default", "events_default", "state_default", "power level", "PL"]) {
            expect(container.textContent).not.toContain(raw);
        }
    });

    it("says which change each specific rank is for, in order, and shows unknown ones as they are", async () => {
        await renderTab();
        const rows = Array.from(container.querySelectorAll(".settings-table"))[0].querySelectorAll("tbody tr");
        const cells = Array.from(rows).map((row) => Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent));
        expect(cells).toEqual([
            ["Change ranks and permissions", "100"],
            ["Change the name", "50"],
            ["org.example.custom", "20"],
        ]);
    });
});
