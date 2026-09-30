import { describe, expect, it } from "vitest";

import { plainUserDisplayName } from "../../../../src/core/users/userDisplayName";

const ID = "@admin:matrix.jorvik.app";

function user(fields: { displayName?: string; rawDisplayName?: string }) {
    return { userId: ID, ...fields } as never;
}

describe("plainUserDisplayName", () => {
    it("prefers the plain name over the store's disambiguated one", () => {
        // What the store leaves after a room where @xuruh is also "Xuruh".
        expect(plainUserDisplayName(user({ displayName: `Xuruh (${ID})`, rawDisplayName: "Xuruh" }))).toBe("Xuruh");
    });

    it("strips the disambiguation when no plain name is recorded", () => {
        expect(plainUserDisplayName(user({ displayName: `Xuruh (${ID})`, rawDisplayName: ID }))).toBe("Xuruh");
    });

    it("uses a display name that only presence supplied", () => {
        expect(plainUserDisplayName(user({ displayName: "Xuruh", rawDisplayName: ID }))).toBe("Xuruh");
    });

    it("keeps brackets that are part of the name itself", () => {
        expect(plainUserDisplayName(user({ displayName: "Xuruh (away)", rawDisplayName: "Xuruh (away)" }))).toBe(
            "Xuruh (away)",
        );
    });

    it("returns undefined when only the user ID is known", () => {
        expect(plainUserDisplayName(user({ displayName: ID, rawDisplayName: ID }))).toBeUndefined();
        expect(plainUserDisplayName(null)).toBeUndefined();
    });
});
