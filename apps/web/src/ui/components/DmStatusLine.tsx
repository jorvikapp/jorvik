import React from "react";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import { useUserActivity } from "../activity/useActivity";
import { statusLinkHref } from "../presence/statusLink";
import { ActivityGlyph, shortActivityText } from "./activity/ActivityLine";

/**
 * The line under a person's name in the DM list: the game they play or the music they listen to, when
 * they share it with us;
 * otherwise their status message; otherwise nothing, and the row stays a single line.
 */
export function DmStatusLine({
    client,
    userId,
    statusMessage,
}: {
    client?: MatrixClient | null;
    userId: string | null | undefined;
    statusMessage: string | null | undefined;
}): React.ReactElement | null {
    // Only people who chose to share their game with us ever reach the activity store.
    const activity = useUserActivity(userId);

    if (activity) {
        const text = shortActivityText(activity);
        return (
            <span className="room-item-status is-activity" title={text}>
                <span className="room-item-status-icon" aria-hidden="true">
                    <ActivityGlyph client={client} activity={activity} />
                </span>
                <span className="room-item-status-text">{text}</span>
            </span>
        );
    }

    const status = statusMessage?.trim();
    if (!status) {
        return null;
    }

    const href = statusLinkHref(status);
    if (href) {
        // The row itself is a button, which can't hold a real link; this opens the address on its own
        // and leaves the click on the rest of the row to open the chat.
        const open = (event: React.MouseEvent): void => {
            event.preventDefault();
            event.stopPropagation();
            window.open(href, "_blank", "noopener,noreferrer");
        };
        return (
            <span className="room-item-status" title={href}>
                <span
                    className="room-item-status-text room-item-status-link"
                    role="link"
                    data-href={href}
                    onClick={open}
                    onAuxClick={(event) => {
                        if (event.button === 1) {
                            open(event);
                        }
                    }}
                >
                    {status}
                </span>
            </span>
        );
    }

    return (
        <span className="room-item-status" title={status}>
            <span className="room-item-status-text">{status}</span>
        </span>
    );
}
