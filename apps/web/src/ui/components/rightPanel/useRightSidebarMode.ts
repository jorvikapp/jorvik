import { useCallback, useEffect, useState } from "react";

import type { RightSidebarMode } from "./types";

const ROOM_STORAGE_KEY = "heorot.ui.rightSidebarMode";
const DIRECT_STORAGE_KEY = "heorot.ui.rightSidebarMode.direct";

function isRightSidebarMode(value: string | null): value is RightSidebarMode {
    return value === "members" || value === "search" || value === "pins" || value === "info" || value === "closed";
}

function readStoredMode(key: string): RightSidebarMode {
    if (typeof window === "undefined") {
        return "members";
    }

    // DMs had no key of their own at first, so they start from the shared one.
    const raw = window.localStorage.getItem(key) ?? window.localStorage.getItem(ROOM_STORAGE_KEY);
    return isRightSidebarMode(raw) ? raw : "members";
}

// DMs and spaces each remember what the right panel shows. In a DM that is
// usually the other person's profile and in a space the member list, and with
// one shared setting, closing either closed both.
export function useRightSidebarMode(isDirect: boolean): [RightSidebarMode, (mode: RightSidebarMode) => void] {
    const [roomMode, setRoomMode] = useState<RightSidebarMode>(() => readStoredMode(ROOM_STORAGE_KEY));
    const [directMode, setDirectMode] = useState<RightSidebarMode>(() => readStoredMode(DIRECT_STORAGE_KEY));

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        window.localStorage.setItem(ROOM_STORAGE_KEY, roomMode);
    }, [roomMode]);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        window.localStorage.setItem(DIRECT_STORAGE_KEY, directMode);
    }, [directMode]);

    const setMode = useCallback(
        (mode: RightSidebarMode): void => {
            if (isDirect) {
                setDirectMode(mode);
            } else {
                setRoomMode(mode);
            }
        },
        [isDirect],
    );

    return [isDirect ? directMode : roomMode, setMode];
}
