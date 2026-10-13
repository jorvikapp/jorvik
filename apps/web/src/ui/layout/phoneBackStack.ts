import { useEffect, useRef } from "react";

// Android's back button, and the back swipe on iPhones, step back through the browser history.
// Without an entry of our own, going back from an open chat would leave Jorvik altogether. So
// while anything the phone layout opens (a chat, the member drawer, a sheet) is showing, there is
// one history entry for all of it, and going back closes the top layer.
const HISTORY_MARKER = "jorvikPhoneLayer";

interface Layer {
    close: () => void;
}

const layers: Layer[] = [];
let ignoredPops = 0;
let listening = false;

function ownEntryIsCurrent(): boolean {
    const state: unknown = window.history.state;
    return typeof state === "object" && state !== null && HISTORY_MARKER in state;
}

function pushOwnEntry(): void {
    const state: unknown = window.history.state;
    const base = typeof state === "object" && state !== null ? state : {};
    window.history.pushState({ ...base, [HISTORY_MARKER]: true }, "");
}

function onPopState(): void {
    if (ignoredPops > 0) {
        ignoredPops -= 1;
        return;
    }
    const top = layers.pop();
    if (!top) {
        return;
    }
    top.close();
    // Keep an entry while layers remain, so the next back closes the next one.
    if (layers.length > 0) {
        pushOwnEntry();
    }
}

export function usePhoneBackLayer(open: boolean, close: () => void): void {
    const closeRef = useRef(close);
    closeRef.current = close;

    useEffect(() => {
        if (!open || typeof window === "undefined") {
            return undefined;
        }
        if (!listening) {
            window.addEventListener("popstate", onPopState);
            listening = true;
        }
        const layer: Layer = { close: () => closeRef.current() };
        layers.push(layer);
        if (layers.length === 1 && !ownEntryIsCurrent()) {
            pushOwnEntry();
        }
        return () => {
            const index = layers.indexOf(layer);
            if (index === -1) {
                // Closed by going back; the entry is already gone.
                return;
            }
            layers.splice(index, 1);
            // Closed from the page. Once nothing is left open, take our entry back off the history,
            // so the next back doesn't land on a step that does nothing.
            if (layers.length === 0 && ownEntryIsCurrent()) {
                ignoredPops += 1;
                window.history.back();
            }
        };
    }, [open]);
}
