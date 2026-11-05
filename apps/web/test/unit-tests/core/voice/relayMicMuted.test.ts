import { describe, expect, it } from "vitest";

import { relayMicMuted } from "../../../../src/core/voice/voiceService";

describe("relayMicMuted", () => {
    it("counts someone in a call with no mic published as muted: they joined muted", () => {
        expect(relayMicMuted({ micPublished: false })).toBe(true);
    });

    it("goes by the mic's own state once it's published", () => {
        expect(relayMicMuted({ micPublished: true, micMuted: true })).toBe(true);
        expect(relayMicMuted({ micPublished: true, micMuted: false })).toBe(false);
    });

    it("doesn't guess when the relay says nothing about the mic", () => {
        expect(relayMicMuted({})).toBeUndefined();
    });
});
