import { afterEach, describe, expect, it, vi } from "vitest";

import { commandShortcutLabel, usesCommandKey } from "../../../../src/ui/utils/keyboard";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("keyboard shortcut labels", () => {
    it("uses Ctrl away from Apple keyboards", () => {
        vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
        expect(usesCommandKey()).toBe(false);
        expect(commandShortcutLabel("K")).toBe("Ctrl+K");
        expect(commandShortcutLabel("Shift+I")).toBe("Ctrl+Shift+I");
    });

    it("uses Command symbols on Apple keyboards", () => {
        vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
        expect(usesCommandKey()).toBe(true);
        expect(commandShortcutLabel("K")).toBe("⌘K");
        expect(commandShortcutLabel("Shift+I")).toBe("⌘⇧I");
    });
});
