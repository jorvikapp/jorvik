import { describe, expect, it } from "vitest";

import type { CoreConfig } from "../../../../src/core/config/configTypes";
import { describeAccount } from "../../../../src/core/config/serverDefaults";

const config = {
    default_server_config: { "m.homeserver": { base_url: "https://matrix.jorvik.app", server_name: "matrix.jorvik.app" } },
} as unknown as CoreConfig;

describe("describeAccount", () => {
    it("shortens accounts on the app's own server to the name", () => {
        expect(describeAccount("@admin:matrix.jorvik.app", config)).toBe("@admin");
        expect(describeAccount("@xuruh:matrix.jorvik.app", config)).toBe("@xuruh");
    });

    it("keeps the full ID for other servers, where the name alone is ambiguous", () => {
        expect(describeAccount("@admin:matrix.org", config)).toBe("@admin:matrix.org");
        expect(describeAccount("@admin:evil-matrix.jorvik.app", config)).toBe("@admin:evil-matrix.jorvik.app");
    });

    it("keeps the full ID when no default server is configured", () => {
        expect(describeAccount("@admin:matrix.jorvik.app", null)).toBe("@admin:matrix.jorvik.app");
    });
});
