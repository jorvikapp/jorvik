import { useEffect, useRef, useState } from "react";

const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
const CHECK_INTERVAL_MS = 5_000;

/**
 * How long the user has been inactive, as far as this device can tell.
 *
 * The desktop app can read the system's idle time, which also covers input to
 * other apps, so someone gaming with Jorvik in the background stays Online.
 * Some systems cannot report it and return 0 forever (GNOME on Wayland, where
 * Chromium only speaks KDE's idle protocol), which would read as "always
 * active". So the system value only counts once it has been seen above zero;
 * until then, and in the browser, activity inside Jorvik is all there is.
 */
export function resolveIdleMs(pageIdleMs: number, systemIdleMs: number | null, systemIdleWorks: boolean): number {
    return systemIdleWorks && systemIdleMs !== null ? systemIdleMs : pageIdleMs;
}

/**
 * True while the user has been inactive for at least `thresholdMs`; always
 * false when `thresholdMs` is 0. Activity in the window ends it at once, and
 * activity elsewhere (desktop only) within one check interval.
 */
export function useAutoIdle(thresholdMs: number): boolean {
    const [away, setAway] = useState(false);
    const awayRef = useRef(false);
    const systemIdleWorksRef = useRef(false);

    useEffect(() => {
        const update = (next: boolean): void => {
            if (awayRef.current !== next) {
                awayRef.current = next;
                setAway(next);
            }
        };

        if (thresholdMs <= 0) {
            update(false);
            return undefined;
        }

        let cancelled = false;
        let lastActivityMs = Date.now();
        const markActive = (): void => {
            lastActivityMs = Date.now();
            update(false);
        };
        const onVisibilityChange = (): void => {
            if (document.visibilityState === "visible") {
                markActive();
            }
        };

        for (const eventName of ACTIVITY_EVENTS) {
            window.addEventListener(eventName, markActive, { capture: true, passive: true });
        }
        window.addEventListener("focus", markActive);
        document.addEventListener("visibilitychange", onVisibilityChange);

        const check = async (): Promise<void> => {
            let systemIdleMs: number | null = null;
            const getSystemIdleSeconds = window.heorotDesktop?.getSystemIdleSeconds;
            if (getSystemIdleSeconds) {
                try {
                    const seconds = await getSystemIdleSeconds();
                    if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0) {
                        systemIdleMs = seconds * 1000;
                        if (seconds > 0) {
                            systemIdleWorksRef.current = true;
                        }
                    }
                } catch {
                    // Fall back to activity inside the window.
                }
            }
            if (cancelled) {
                return;
            }

            const idleMs = resolveIdleMs(Date.now() - lastActivityMs, systemIdleMs, systemIdleWorksRef.current);
            update(idleMs >= thresholdMs);
        };

        const intervalId = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
            for (const eventName of ACTIVITY_EVENTS) {
                window.removeEventListener(eventName, markActive, { capture: true });
            }
            window.removeEventListener("focus", markActive);
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, [thresholdMs]);

    return away;
}
