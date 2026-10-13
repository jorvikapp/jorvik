import { useEffect, useRef, type RefObject } from "react";

// How far a finger may move before the gesture counts as a swipe or a scroll.
export const SWIPE_SLOP_PX = 12;
// A swipe finishes past this share of the width, or when flicked faster than this (px per ms).
export const SWIPE_COMPLETE_FRACTION = 0.3;
export const SWIPE_COMPLETE_VELOCITY = 0.5;

export type GestureAxis = "undecided" | "horizontal" | "vertical";
export type SwipeDirection = 1 | -1;

export function gestureAxis(dx: number, dy: number, slop = SWIPE_SLOP_PX): GestureAxis {
    if (Math.abs(dx) < slop && Math.abs(dy) < slop) {
        return "undecided";
    }
    return Math.abs(dx) > Math.abs(dy) * 1.25 ? "horizontal" : "vertical";
}

// distance and velocity are measured in the swipe's own direction: positive means towards
// finishing it, so a finger that went right and came back counts as not finishing.
export function swipeCompletes(distance: number, width: number, velocity: number): boolean {
    if (distance <= 0) {
        return false;
    }
    return distance > width * SWIPE_COMPLETE_FRACTION || (distance > SWIPE_SLOP_PX && velocity > SWIPE_COMPLETE_VELOCITY);
}

// A code block or wide table scrolls sideways itself; a swipe that starts in one only moves the
// panel once the block can't scroll any further that way.
export function scrollsSidewaysWithin(target: EventTarget | null, boundary: Element, direction: SwipeDirection): boolean {
    let node = target instanceof Element ? target : null;
    while (node && node !== boundary) {
        if (node instanceof HTMLElement && node.scrollWidth > node.clientWidth + 1) {
            const overflowX = getComputedStyle(node).overflowX;
            if (overflowX === "auto" || overflowX === "scroll") {
                // The finger moving right shows what is further left.
                const canScroll = direction === 1 ? node.scrollLeft > 0 : node.scrollLeft < node.scrollWidth - node.clientWidth - 1;
                if (canScroll) {
                    return true;
                }
            }
        }
        node = node.parentElement;
    }
    return false;
}

export function startsInTextInput(target: EventTarget | null): boolean {
    return target instanceof Element && Boolean(target.closest('textarea, input, select, [contenteditable="true"]'));
}

export interface HorizontalSwipeHandlers {
    // Whether a drag that has turned out sideways may move something: +1 is a finger moving right.
    canStart: (direction: SwipeDirection, target: EventTarget | null) => boolean;
    onMove: (dx: number) => void;
    onEnd: (dx: number, velocity: number) => void;
}

interface Sample {
    x: number;
    t: number;
}

// Sideways drags on touch screens, for the phone layout's panels. Vertical drags are left to the
// browser, so lists still scroll; the element needs `touch-action: pan-y` for that split to work.
export function useHorizontalSwipe(
    ref: RefObject<HTMLElement | null>,
    enabled: boolean,
    handlers: HorizontalSwipeHandlers,
): void {
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;

    useEffect(() => {
        const element = ref.current;
        if (!element || !enabled) {
            return undefined;
        }

        let gesture: { id: number; x: number; y: number; target: EventTarget | null; axis: GestureAxis } | null = null;
        let samples: Sample[] = [];

        const velocity = (): number => {
            const last = samples[samples.length - 1];
            const first = samples.find((sample) => last.t - sample.t <= 100) ?? last;
            return last && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
        };

        // The finger lifting after a swipe would also tap whatever is under it.
        const swallowNextClick = (): void => {
            const swallow = (event: MouseEvent): void => {
                event.stopPropagation();
                event.preventDefault();
            };
            window.addEventListener("click", swallow, { capture: true, once: true });
            window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 400);
        };

        const onPointerDown = (event: PointerEvent): void => {
            // A mouse drag selects text; swipes are for fingers and pens.
            if (event.pointerType === "mouse" || gesture) {
                return;
            }
            gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, target: event.target, axis: "undecided" };
            samples = [{ x: event.clientX, t: event.timeStamp }];
        };

        const onPointerMove = (event: PointerEvent): void => {
            if (!gesture || event.pointerId !== gesture.id) {
                return;
            }
            const dx = event.clientX - gesture.x;
            const dy = event.clientY - gesture.y;
            if (gesture.axis === "undecided") {
                const axis = gestureAxis(dx, dy);
                if (axis === "undecided") {
                    return;
                }
                const direction: SwipeDirection = dx > 0 ? 1 : -1;
                if (axis === "vertical" || !handlersRef.current.canStart(direction, gesture.target)) {
                    gesture.axis = "vertical";
                    return;
                }
                gesture.axis = "horizontal";
                try {
                    element.setPointerCapture(event.pointerId);
                } catch {
                    // The pointer is already gone.
                }
            }
            if (gesture.axis !== "horizontal") {
                return;
            }
            samples.push({ x: event.clientX, t: event.timeStamp });
            if (samples.length > 8) {
                samples.shift();
            }
            handlersRef.current.onMove(dx);
        };

        const finish = (event: PointerEvent, cancelled: boolean): void => {
            if (!gesture || event.pointerId !== gesture.id) {
                return;
            }
            if (gesture.axis === "horizontal") {
                const dx = cancelled ? 0 : event.clientX - gesture.x;
                handlersRef.current.onEnd(dx, cancelled ? 0 : velocity());
                swallowNextClick();
            }
            gesture = null;
            samples = [];
        };
        const onPointerUp = (event: PointerEvent): void => finish(event, false);
        const onPointerCancel = (event: PointerEvent): void => finish(event, true);

        element.addEventListener("pointerdown", onPointerDown);
        element.addEventListener("pointermove", onPointerMove);
        element.addEventListener("pointerup", onPointerUp);
        element.addEventListener("pointercancel", onPointerCancel);
        return () => {
            element.removeEventListener("pointerdown", onPointerDown);
            element.removeEventListener("pointermove", onPointerMove);
            element.removeEventListener("pointerup", onPointerUp);
            element.removeEventListener("pointercancel", onPointerCancel);
        };
    }, [enabled, ref]);
}
