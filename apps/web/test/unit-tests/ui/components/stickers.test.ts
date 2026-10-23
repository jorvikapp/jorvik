import { MatrixEvent } from "matrix-js-sdk/src/matrix";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/ui/notifications/sound", () => ({ playNotificationSound: async () => undefined }));

const { isRenderableMessage, toReplyPreviewBody } = await import("../../../../src/ui/components/Timeline");
const { notificationMessageForEvent } = await import("../../../../src/ui/notifications/useElementLikeNotifications");

function sticker(content: Record<string, unknown>, extra: Record<string, unknown> = {}): MatrixEvent {
    return new MatrixEvent({
        type: "m.sticker",
        room_id: "!room:example.org",
        sender: "@bob:example.org",
        event_id: "$sticker",
        content,
        ...extra,
    });
}

const THUMBS_UP = { body: "Thumbs up", url: "mxc://example.org/thumbs", info: { w: 256, h: 256, mimetype: "image/png" } };

describe("stickers", () => {
    // They counted as unread, but the timeline only showed m.room.message, so nothing new appeared.
    it("show in the timeline", () => {
        expect(isRenderableMessage(sticker(THUMBS_UP))).toBe(true);
    });

    it("don't show once redacted", () => {
        const redacted = sticker({}, { unsigned: { redacted_because: { type: "m.room.redaction", sender: "@bob:example.org" } } });
        expect(isRenderableMessage(redacted)).toBe(false);
    });

    it("say they're a sticker in reply previews and notifications", () => {
        expect(toReplyPreviewBody(THUMBS_UP, true)).toBe("[Sticker] Thumbs up");
        expect(toReplyPreviewBody({ url: "mxc://example.org/thumbs" }, true)).toBe("[Sticker]");
        expect(notificationMessageForEvent(sticker(THUMBS_UP))).toBe("[Sticker] Thumbs up");
    });
});
