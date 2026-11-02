import { describe, expect, it } from "vitest";
import { DecryptionFailureCode } from "matrix-js-sdk/src/crypto-api";

import {
    collapseSentBeforeJoining,
    isSentBeforeJoining,
    UNDECRYPTABLE_PREVIEW,
    undecryptableText,
} from "../../../../src/ui/messages/undecryptable";
import { messagePreviewText } from "../../../../src/ui/formatting/messagePreviewText";

interface FakeEvent {
    id: string;
    isDecryptionFailure: () => boolean;
    decryptionFailureReason: DecryptionFailureCode | null;
}

const readable = (id: string): FakeEvent => ({ id, isDecryptionFailure: () => false, decryptionFailureReason: null });
const failed = (id: string, reason: DecryptionFailureCode): FakeEvent => ({
    id,
    isDecryptionFailure: () => true,
    decryptionFailureReason: reason,
});
const beforeJoining = (id: string): FakeEvent => failed(id, DecryptionFailureCode.HISTORICAL_MESSAGE_USER_NOT_JOINED);
const ids = (events: FakeEvent[]): string[] => events.map((event) => event.id);

describe("isSentBeforeJoining", () => {
    it("is only messages that failed because we weren't in the room", () => {
        expect(isSentBeforeJoining(beforeJoining("a"))).toBe(true);
        expect(isSentBeforeJoining(failed("b", DecryptionFailureCode.MEGOLM_UNKNOWN_INBOUND_SESSION_ID))).toBe(false);
        expect(isSentBeforeJoining(readable("c"))).toBe(false);
        // A reason left over from an earlier try doesn't count once the message is readable.
        expect(
            isSentBeforeJoining({
                isDecryptionFailure: () => false,
                decryptionFailureReason: DecryptionFailureCode.HISTORICAL_MESSAGE_USER_NOT_JOINED,
            }),
        ).toBe(false);
    });
});

describe("collapseSentBeforeJoining", () => {
    it("keeps the first message of each run from before joining, and drops the rest of it", () => {
        const events = [
            readable("old plain"),
            beforeJoining("b1"),
            beforeJoining("b2"),
            beforeJoining("b3"),
            readable("after joining"),
            beforeJoining("b4"),
            beforeJoining("b5"),
        ];
        expect(ids(collapseSentBeforeJoining(events))).toEqual(["old plain", "b1", "after joining", "b4"]);
    });

    it("leaves other messages that couldn't be decrypted one by one", () => {
        const events = [
            failed("w1", DecryptionFailureCode.MEGOLM_UNKNOWN_INBOUND_SESSION_ID),
            failed("w2", DecryptionFailureCode.MEGOLM_UNKNOWN_INBOUND_SESSION_ID),
            beforeJoining("b1"),
            failed("w3", DecryptionFailureCode.UNKNOWN_ERROR),
        ];
        expect(ids(collapseSentBeforeJoining(events))).toEqual(["w1", "w2", "b1", "w3"]);
    });

    it("keeps a message out of the run once an edit you can read has replaced it", () => {
        const events = [beforeJoining("b1"), beforeJoining("b2 edited later"), beforeJoining("b3")];
        const stillUnreadable = (event: FakeEvent) => event.id !== "b2 edited later";
        expect(ids(collapseSentBeforeJoining(events, stillUnreadable))).toEqual(["b1", "b2 edited later", "b3"]);
    });

    it("changes nothing when every message can be read", () => {
        const events = [readable("a"), readable("b")];
        expect(collapseSentBeforeJoining(events)).toEqual(events);
        expect(collapseSentBeforeJoining([])).toEqual([]);
    });
});

describe("undecryptableText", () => {
    it("says why in plain words, never the SDK's error", () => {
        const all = Object.values(DecryptionFailureCode).map((reason) => undecryptableText(failed("x", reason)));
        for (const text of all) {
            expect(text).not.toMatch(/Unable to decrypt|DecryptionError|megolm|olm/i);
            expect(text.length).toBeGreaterThan(0);
        }
        expect(undecryptableText(beforeJoining("x"))).toBe("Sent before you joined, so you can't read it.");
        expect(undecryptableText(failed("x", DecryptionFailureCode.MEGOLM_UNKNOWN_INBOUND_SESSION_ID))).toBe(
            "Waiting for the key to this message. This can take a while.",
        );
        expect(undecryptableText(failed("x", DecryptionFailureCode.HISTORICAL_MESSAGE_BACKUP_UNCONFIGURED))).toContain(
            "Settings > Encryption & Recovery",
        );
        expect(undecryptableText({ isDecryptionFailure: () => true, decryptionFailureReason: null })).toBe(
            "This message couldn't be decrypted.",
        );
    });
});

describe("messagePreviewText of a message that couldn't be decrypted", () => {
    it("names it, instead of quoting the error", () => {
        expect(
            messagePreviewText({
                msgtype: "m.bad.encrypted",
                body: "** Unable to decrypt: DecryptionError: This message was sent when we were not a member of the room. **",
            }),
        ).toBe(UNDECRYPTABLE_PREVIEW);
    });
});
