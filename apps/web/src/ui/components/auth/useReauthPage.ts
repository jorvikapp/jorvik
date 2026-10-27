import { useCallback, useEffect, useRef, useState } from "react";

import type { ReauthPageWay } from "../../../core/auth/reauth";

/**
 * Opens the server's page for a step it does itself (single sign-on, approving on the account page),
 * and calls `onDone` when that page says it's finished. Only a page opened in a browser window can say
 * so; the desktop app opens it in the browser, and people come back and continue themselves.
 */
export function useReauthPage(way: ReauthPageWay | null, onDone: () => void): { opened: boolean; open: () => void } {
    const [openedUrl, setOpenedUrl] = useState<string | null>(null);
    const pageRef = useRef<Window | null>(null);
    const onDoneRef = useRef(onDone);
    useEffect(() => {
        onDoneRef.current = onDone;
    });

    const url = way?.url ?? null;
    const opened = url !== null && openedUrl === url;

    useEffect(() => {
        if (!opened) {
            return;
        }
        // Synapse's page tells the window that opened it.
        const onMessage = (event: MessageEvent): void => {
            if (event.data === "authDone" && pageRef.current !== null && event.source === pageRef.current) {
                onDoneRef.current();
            }
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [opened]);

    const open = useCallback((): void => {
        if (!url) {
            return;
        }
        pageRef.current = window.open(url, "_blank");
        setOpenedUrl(url);
    }, [url]);

    return { opened, open };
}
