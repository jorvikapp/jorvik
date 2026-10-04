import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RoomNotificationMode } from "../../../../src/ui/adapters/roomNotificationAdapter";
import { describeRoomNotificationMode, RoomNotificationModePicker } from "../../../../src/ui/notifications/RoomNotificationModePicker";

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

describe("RoomNotificationModePicker", () => {
    it("shows the four choices with the current one checked, and reports a pick", () => {
        const onChange = vi.fn();
        act(() => {
            root.render(<RoomNotificationModePicker value={RoomNotificationMode.MentionsOnly} onChange={onChange} />);
        });
        const radios = [...container.querySelectorAll('[role="radio"]')] as HTMLButtonElement[];
        expect(radios.map((radio) => radio.textContent)).toEqual(["Default", "All messages", "Mentions only", "Mute"]);
        expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "false", "true", "false"]);
        act(() => {
            radios[3].click();
        });
        expect(onChange).toHaveBeenCalledWith(RoomNotificationMode.Mute);
    });

    it("says what each choice does", () => {
        expect(describeRoomNotificationMode(RoomNotificationMode.Mute)).toBe("Nothing here notifies you, not even mentions.");
        expect(describeRoomNotificationMode(RoomNotificationMode.Default)).toBe("Follows your notification settings.");
    });
});
