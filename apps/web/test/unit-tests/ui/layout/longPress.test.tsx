import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LONG_PRESS_MS, useLongPress } from "../../../../src/ui/layout/longPress";

let container: HTMLDivElement;
let root: Root;

function Probe({ onLongPress }: { onLongPress: (target: Element, point: { x: number; y: number }) => void }): React.ReactElement {
    const press = useLongPress(".item", onLongPress);
    return (
        <div onPointerDown={press.onPointerDown}>
            <div className="item" data-id="one">
                <span className="text">hold me</span>
            </div>
            <textarea className="box" />
        </div>
    );
}

// jsdom has no PointerEvent, so build one from a MouseEvent.
function pointer(type: string, target: EventTarget, options: { x?: number; y?: number; pointerType?: string } = {}): void {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: options.x ?? 10, clientY: options.y ?? 10 });
    Object.defineProperty(event, "pointerType", { value: options.pointerType ?? "touch" });
    Object.defineProperty(event, "pointerId", { value: 1 });
    Object.defineProperty(event, "isPrimary", { value: true });
    act(() => {
        target.dispatchEvent(event);
    });
}

function query(selector: string): Element {
    const element = container.querySelector(selector);
    if (!element) {
        throw new Error(`missing ${selector}`);
    }
    return element;
}

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
    vi.useRealTimers();
});

describe("useLongPress", () => {
    it("fires on the item held, where the finger is", () => {
        const onLongPress = vi.fn();
        act(() => root.render(<Probe onLongPress={onLongPress} />));

        pointer("pointerdown", query(".text"), { x: 40, y: 50 });
        act(() => vi.advanceTimersByTime(LONG_PRESS_MS - 1));
        expect(onLongPress).not.toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(1));

        expect(onLongPress).toHaveBeenCalledTimes(1);
        expect((onLongPress.mock.calls[0][0] as HTMLElement).dataset.id).toBe("one");
        expect(onLongPress.mock.calls[0][1]).toEqual({ x: 40, y: 50 });
    });

    it("lets go when the finger moves, lifts early, or the list scrolls", () => {
        const onLongPress = vi.fn();
        act(() => root.render(<Probe onLongPress={onLongPress} />));

        pointer("pointerdown", query(".text"), { x: 10, y: 10 });
        pointer("pointermove", window, { x: 10, y: 30 });
        act(() => vi.advanceTimersByTime(LONG_PRESS_MS * 2));

        pointer("pointerdown", query(".text"));
        pointer("pointerup", window);
        act(() => vi.advanceTimersByTime(LONG_PRESS_MS * 2));

        pointer("pointerdown", query(".text"));
        act(() => {
            window.dispatchEvent(new Event("scroll"));
        });
        act(() => vi.advanceTimersByTime(LONG_PRESS_MS * 2));

        expect(onLongPress).not.toHaveBeenCalled();
    });

    it("is for fingers: a mouse, or a press in a text box, does nothing", () => {
        const onLongPress = vi.fn();
        act(() => root.render(<Probe onLongPress={onLongPress} />));

        pointer("pointerdown", query(".text"), { pointerType: "mouse" });
        act(() => vi.advanceTimersByTime(LONG_PRESS_MS * 2));
        pointer("pointerdown", query(".box"));
        act(() => vi.advanceTimersByTime(LONG_PRESS_MS * 2));

        expect(onLongPress).not.toHaveBeenCalled();
    });

    it("swallows the tap from lifting that finger, but not the next tap", () => {
        act(() => root.render(<Probe onLongPress={vi.fn()} />));
        const onClick = vi.fn();
        query(".text").addEventListener("click", onClick);

        pointer("pointerdown", query(".text"));
        act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
        pointer("pointerup", window);
        (query(".text") as HTMLElement).click();
        expect(onClick).not.toHaveBeenCalled();

        act(() => vi.advanceTimersByTime(100));
        (query(".text") as HTMLElement).click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
