import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/ui/hooks/useUserBadges", () => ({
    useUserBadges: (userId: string | null | undefined) => (userId === "@riff:matrix.jorvik.app" ? ["staff", "bug_finder"] : []),
}));

import { UserBadges } from "../../../../src/ui/components/badges/UserBadges";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
});

function render(element: React.ReactElement): void {
    act(() => {
        root.render(element);
    });
}

describe("UserBadges", () => {
    it("renders nothing for someone without badges", () => {
        render(<UserBadges userId="@nobody:matrix.jorvik.app" />);
        expect(container.innerHTML).toBe("");
    });

    it("shows each badge as a named icon next to a name", () => {
        render(<UserBadges userId="@riff:matrix.jorvik.app" />);
        const badges = [...container.querySelectorAll(".user-badge")];
        expect(badges.map((badge) => badge.getAttribute("aria-label"))).toEqual(["Staff", "Bug Finder"]);
        expect(badges.every((badge) => badge.getAttribute("role") === "img" && badge.querySelector("svg"))).toBe(true);
    });

    it("spells the badges out on a profile", () => {
        render(<UserBadges userId="@riff:matrix.jorvik.app" variant="chips" className="rp-profile-badges" />);
        const wrapper = container.querySelector(".user-badges");
        expect(wrapper?.className).toBe("user-badges user-badges-chips rp-profile-badges");
        expect(wrapper?.textContent).toBe("StaffBug Finder");
        expect(container.querySelector("[role=img]")).toBeNull();
    });
});
