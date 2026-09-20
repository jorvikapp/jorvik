import { describe, expect, it } from "vitest";

import {
    CATEGORY_STATE_EVENT,
    CHANNEL_ORDER_STATE_EVENT,
    readCategoriesFromStateSnapshot,
    readChannelOrderFromStateSnapshot,
} from "../../../../src/core/stores/CategoryStore";

/**
 * Space ordering moved from downloading a room's entire state to requesting the two
 * singleton state events. These pin down that a missing event reads the same either way,
 * so the change cannot silently clear a configured order that the old path preserved.
 */
describe("absent state events read identically via snapshot or single-event fetch", () => {
    it("categories: absent from a full snapshot yields none", () => {
        expect(readCategoriesFromStateSnapshot([])).toEqual([]);
    });

    it("categories: a 404 wrapped as null content yields the same none", () => {
        expect(
            readCategoriesFromStateSnapshot([{ type: CATEGORY_STATE_EVENT, state_key: "", content: null }]),
        ).toEqual([]);
    });

    it("channel order: absent from a full snapshot yields none", () => {
        expect(readChannelOrderFromStateSnapshot([])).toEqual([]);
    });

    it("channel order: a 404 wrapped as null content yields the same none", () => {
        expect(
            readChannelOrderFromStateSnapshot([{ type: CHANNEL_ORDER_STATE_EVENT, state_key: "", content: null }]),
        ).toEqual([]);
    });

    it("a configured order is preserved when the event exists", () => {
        const order = ["!a:example.org", "!b:example.org"];
        expect(
            readChannelOrderFromStateSnapshot([
                { type: CHANNEL_ORDER_STATE_EVENT, state_key: "", content: { order } },
            ]),
        ).toEqual(order);
    });

    it("configured categories are preserved when the event exists", () => {
        const categories = [{ id: "cat-1", name: "General", roomIds: ["!a:example.org"] }];
        const read = readCategoriesFromStateSnapshot([
            { type: CATEGORY_STATE_EVENT, state_key: "", content: { categories } },
        ]);
        expect(read).toHaveLength(1);
        expect(read[0]?.name).toBe("General");
    });

    it("a non-root state key is ignored, as the snapshot reader always did", () => {
        expect(
            readChannelOrderFromStateSnapshot([
                { type: CHANNEL_ORDER_STATE_EVENT, state_key: "not-root", content: { order: ["!a:example.org"] } },
            ]),
        ).toEqual([]);
    });
});
