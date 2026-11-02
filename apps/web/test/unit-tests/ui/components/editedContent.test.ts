import { describe, expect, it } from "vitest";
import type { MatrixEvent } from "matrix-js-sdk/src/matrix";

import { resolveEditedMessageContent } from "../../../../src/ui/components/Timeline";

const edit = (content: Record<string, unknown>, decryptionFailed = false): MatrixEvent =>
    ({
        isDecryptionFailure: () => decryptionFailed,
        getContent: () => content,
        getType: () => "m.room.message",
    }) as unknown as MatrixEvent;

describe("resolveEditedMessageContent", () => {
    it("shows what an edit changed a message to", () => {
        expect(
            resolveEditedMessageContent(
                edit({ msgtype: "m.text", body: "* fixed", "m.new_content": { msgtype: "m.text", body: "fixed" } }),
            ),
        ).toEqual({ msgtype: "m.text", body: "fixed" });
    });

    it("ignores an edit it couldn't decrypt, so the message isn't replaced by the decryption error", () => {
        expect(
            resolveEditedMessageContent(
                edit({ msgtype: "m.bad.encrypted", body: "** Unable to decrypt: DecryptionError: unknown session **" }, true),
            ),
        ).toBeNull();
    });
});
