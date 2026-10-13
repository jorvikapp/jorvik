import { useSyncExternalStore } from "react";

// Phones held upright, and phones on their side: those are wide but short, with a touch
// screen. The desktop app's window never gets narrower than 960px, so it never matches.
export const PHONE_LAYOUT_QUERY = "(max-width: 759px), (pointer: coarse) and (max-height: 500px)";

// On <html>, so CSS for what renders outside the shell (dialogs, sheets, settings) can follow the
// same switch as the shell itself.
export const PHONE_LAYOUT_CLASS = "is-phone-layout";

// Every message asks, so they share one query rather than each making their own.
let sharedQuery: MediaQueryList | null | undefined;

function phoneQuery(): MediaQueryList | null {
    if (sharedQuery === undefined) {
        sharedQuery =
            typeof window !== "undefined" && typeof window.matchMedia === "function"
                ? window.matchMedia(PHONE_LAYOUT_QUERY)
                : null;
    }
    return sharedQuery;
}

export function isPhoneLayout(): boolean {
    return phoneQuery()?.matches ?? false;
}

function subscribe(onChange: () => void): () => void {
    const query = phoneQuery();
    if (!query) {
        return () => undefined;
    }
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
}

export function usePhoneLayout(): boolean {
    return useSyncExternalStore(subscribe, isPhoneLayout, () => false);
}

// The phone layout sizes itself to the visible part of the page, which shrinks when the
// on-screen keyboard opens; without this the message box ends up under the keyboard on iPhones.
export function installPhoneLayout(): void {
    const query = phoneQuery();
    if (!query || typeof document === "undefined") {
        return;
    }

    const root = document.documentElement;
    const applyClass = (): void => {
        root.classList.toggle(PHONE_LAYOUT_CLASS, query.matches);
    };
    applyClass();
    query.addEventListener("change", applyClass);

    const viewport = window.visualViewport;
    if (!viewport) {
        return;
    }
    const applyViewport = (): void => {
        root.style.setProperty("--app-height", `${Math.round(viewport.height)}px`);
        root.style.setProperty("--app-offset-top", `${Math.max(0, Math.round(viewport.offsetTop))}px`);
    };
    applyViewport();
    viewport.addEventListener("resize", applyViewport);
    viewport.addEventListener("scroll", applyViewport);
}
