import { describe, expect, it } from "vitest";

import {
    SWIPE_SLOP_PX,
    gestureAxis,
    scrollsSidewaysWithin,
    startsInTextInput,
    swipeCompletes,
} from "../../../../src/ui/layout/swipe";

describe("gestureAxis", () => {
    it("waits until the finger has moved past the slop", () => {
        expect(gestureAxis(5, 3)).toBe("undecided");
        expect(gestureAxis(-SWIPE_SLOP_PX + 1, 0)).toBe("undecided");
    });

    it("calls a mostly sideways drag horizontal, either way", () => {
        expect(gestureAxis(30, 10)).toBe("horizontal");
        expect(gestureAxis(-30, -12)).toBe("horizontal");
    });

    it("leaves diagonal and upright drags to the list, so it still scrolls", () => {
        expect(gestureAxis(20, 18)).toBe("vertical");
        expect(gestureAxis(2, 40)).toBe("vertical");
    });
});

describe("swipeCompletes", () => {
    it("finishes past 30% of the width", () => {
        expect(swipeCompletes(130, 390, 0)).toBe(true);
        expect(swipeCompletes(100, 390, 0)).toBe(false);
    });

    it("finishes a short flick", () => {
        expect(swipeCompletes(40, 390, 0.8)).toBe(true);
    });

    it("never finishes a swipe that was brought back", () => {
        expect(swipeCompletes(0, 390, 2)).toBe(false);
        expect(swipeCompletes(-50, 390, 2)).toBe(false);
    });

    it("ignores a fast twitch that never left the slop", () => {
        expect(swipeCompletes(SWIPE_SLOP_PX, 390, 3)).toBe(false);
    });
});

function sidewaysScroller(scrollLeft: number): HTMLElement {
    const element = document.createElement("pre");
    element.style.overflowX = "auto";
    Object.defineProperty(element, "scrollWidth", { configurable: true, value: 600 });
    Object.defineProperty(element, "clientWidth", { configurable: true, value: 300 });
    Object.defineProperty(element, "scrollLeft", { configurable: true, writable: true, value: scrollLeft });
    return element;
}

describe("scrollsSidewaysWithin", () => {
    it("lets a code block scroll before the panel moves", () => {
        const pane = document.createElement("section");
        const block = sidewaysScroller(120);
        const text = document.createElement("span");
        block.appendChild(text);
        pane.appendChild(block);

        expect(scrollsSidewaysWithin(text, pane, 1)).toBe(true);
        expect(scrollsSidewaysWithin(text, pane, -1)).toBe(true);
    });

    it("moves the panel once the block can't scroll any further that way", () => {
        const pane = document.createElement("section");
        const atStart = sidewaysScroller(0);
        const atEnd = sidewaysScroller(300);
        pane.append(atStart, atEnd);

        // A finger moving right shows what is further left; at the start there is nothing.
        expect(scrollsSidewaysWithin(atStart, pane, 1)).toBe(false);
        expect(scrollsSidewaysWithin(atStart, pane, -1)).toBe(true);
        expect(scrollsSidewaysWithin(atEnd, pane, -1)).toBe(false);
        expect(scrollsSidewaysWithin(atEnd, pane, 1)).toBe(true);
    });

    it("ignores content that doesn't overflow", () => {
        const pane = document.createElement("section");
        const text = document.createElement("p");
        pane.appendChild(text);
        expect(scrollsSidewaysWithin(text, pane, 1)).toBe(false);
    });
});

describe("startsInTextInput", () => {
    it("keeps drags in the message box for moving the caret", () => {
        const box = document.createElement("textarea");
        expect(startsInTextInput(box)).toBe(true);
        expect(startsInTextInput(document.createElement("div"))).toBe(false);
        expect(startsInTextInput(null)).toBe(false);
    });
});
