import { describe, expect, it } from "vitest";

import { securityKeyFileName } from "../../../../src/ui/components/securityKeyFileName";

const DAY = new Date(2026, 9, 1, 15, 30);

describe("securityKeyFileName", () => {
    it("names the file after the account and the day", () => {
        expect(securityKeyFileName("@lilith:matrix.jorvik.app", DAY)).toBe("jorvik-security-key-lilith-2026-10-01.txt");
    });

    it("takes the short form shown on the setup screen", () => {
        expect(securityKeyFileName("@riff", DAY)).toBe("jorvik-security-key-riff-2026-10-01.txt");
    });

    it("keeps only characters that are safe in a file name", () => {
        expect(securityKeyFileName("@B0xxy th3/f3ar3d:x", DAY)).toBe("jorvik-security-key-b0xxy-th3-f3ar3d-2026-10-01.txt");
    });

    it("still gives a dated name without an account", () => {
        expect(securityKeyFileName(null, DAY)).toBe("jorvik-security-key-2026-10-01.txt");
    });
});
