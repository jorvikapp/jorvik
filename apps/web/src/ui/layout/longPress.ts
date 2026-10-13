import { useCallback, useEffect, useRef } from "react";

export const LONG_PRESS_MS = 450;
// A finger drifting further than this is scrolling or swiping, not pressing.
export const LONG_PRESS_MOVE_PX = 8;

interface Press {
    pointerId: number;
    x: number;
    y: number;
    timer: number;
    target: Element;
}

// Press and hold with a finger or pen. A mouse already has its right button for the same thing,
// and touch screens on Android fire contextmenu late and iPhones never do.
export function useLongPress(
    selector: string,
    onLongPress: (target: Element, point: { x: number; y: number }) => void,
): { onPointerDown: (event: React.PointerEvent<HTMLElement>) => void } {
    const pressRef = useRef<Press | null>(null);
    const onLongPressRef = useRef(onLongPress);
    onLongPressRef.current = onLongPress;
    const detachRef = useRef<(() => void) | null>(null);

    const cancel = useCallback((): void => {
        const press = pressRef.current;
        if (press) {
            window.clearTimeout(press.timer);
            pressRef.current = null;
        }
        detachRef.current?.();
        detachRef.current = null;
    }, []);

    useEffect(() => cancel, [cancel]);

    const onPointerDown = useCallback(
        (event: React.PointerEvent<HTMLElement>): void => {
            if (event.pointerType === "mouse" || !event.isPrimary) {
                return;
            }
            const target = (event.target as Element | null)?.closest(selector);
            if (!target || (event.target as Element).closest('textarea, input, select, [contenteditable="true"]')) {
                return;
            }
            cancel();

            const onMove = (move: PointerEvent): void => {
                const press = pressRef.current;
                if (!press || move.pointerId !== press.pointerId) {
                    return;
                }
                if (Math.hypot(move.clientX - press.x, move.clientY - press.y) > LONG_PRESS_MOVE_PX) {
                    cancel();
                }
            };
            const onEnd = (end: PointerEvent): void => {
                if (pressRef.current && end.pointerId === pressRef.current.pointerId) {
                    cancel();
                }
            };
            const onScroll = (): void => cancel();
            // On the window, so a swipe that captures the pointer elsewhere still cancels the press.
            window.addEventListener("pointermove", onMove, true);
            window.addEventListener("pointerup", onEnd, true);
            window.addEventListener("pointercancel", onEnd, true);
            window.addEventListener("scroll", onScroll, true);
            detachRef.current = () => {
                window.removeEventListener("pointermove", onMove, true);
                window.removeEventListener("pointerup", onEnd, true);
                window.removeEventListener("pointercancel", onEnd, true);
                window.removeEventListener("scroll", onScroll, true);
            };

            const point = { x: event.clientX, y: event.clientY };
            const timer = window.setTimeout(() => {
                pressRef.current = null;
                detachRef.current?.();
                detachRef.current = null;
                swallowFollowUps();
                try {
                    navigator.vibrate?.(10);
                } catch {
                    // Not offered everywhere.
                }
                onLongPressRef.current(target, point);
            }, LONG_PRESS_MS);
            pressRef.current = { pointerId: event.pointerId, x: point.x, y: point.y, timer, target };
        },
        [cancel, selector],
    );

    return { onPointerDown };
}

// Lifting the finger after a long press would also tap what is under it, and Android follows up
// with its own contextmenu event. Only that press's follow-ups go: the next real tap must work.
function swallowFollowUps(): void {
    const stop = (event: Event): void => {
        event.preventDefault();
        event.stopPropagation();
    };
    const release = (): void => {
        window.removeEventListener("click", stop, true);
        window.removeEventListener("contextmenu", stop, true);
        window.removeEventListener("pointerup", releaseSoon, true);
        window.removeEventListener("pointercancel", releaseSoon, true);
    };
    // The click a release causes arrives straight after its pointerup.
    const releaseSoon = (): void => {
        window.setTimeout(release, 80);
    };
    window.addEventListener("click", stop, true);
    window.addEventListener("contextmenu", stop, true);
    window.addEventListener("pointerup", releaseSoon, true);
    window.addEventListener("pointercancel", releaseSoon, true);
    // In case the release never reaches us.
    window.setTimeout(release, 3000);
}
