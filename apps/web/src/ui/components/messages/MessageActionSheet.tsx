import React from "react";

import { BottomSheet } from "../phone/BottomSheet";
import { QUICK_REACTIONS } from "../ReactionPicker";

interface MessageActionSheetProps {
    open: boolean;
    senderName: string;
    preview: string;
    canEdit: boolean;
    canDelete: boolean;
    canCopyText: boolean;
    canReport: boolean;
    /** The message didn't go out: offer Retry, Edit, Copy text and Delete only. */
    unsent?: boolean;
    onRetry?: () => void;
    onClose: () => void;
    onQuickReact: (key: string) => void;
    onMoreReactions: () => void;
    onReply: () => void;
    onEdit: () => void;
    onDelete: () => void;
    onReport: () => void;
    onCopyLink: () => void;
    onCopyText: () => void;
}

// On phones, holding a message opens this instead of the right-click menu: the same actions,
// sized for a thumb.
export function MessageActionSheet({
    open,
    senderName,
    preview,
    canEdit,
    canDelete,
    canCopyText,
    canReport,
    unsent = false,
    onRetry,
    onClose,
    onQuickReact,
    onMoreReactions,
    onReply,
    onEdit,
    onDelete,
    onReport,
    onCopyLink,
    onCopyText,
}: MessageActionSheetProps): React.ReactElement | null {
    const run = (action: () => void): void => {
        onClose();
        action();
    };

    if (unsent) {
        return (
            <BottomSheet open={open} label="Message actions" onClose={onClose} className="message-action-sheet">
                <div className="message-action-sheet-preview">
                    <span className="message-action-sheet-sender">Not sent</span>
                    <span className="message-action-sheet-body">{preview}</span>
                </div>
                <div className="sheet-group">
                    {onRetry ? (
                        <button type="button" className="sheet-item" onClick={() => run(onRetry)}>
                            Retry
                        </button>
                    ) : null}
                    {canEdit ? (
                        <button type="button" className="sheet-item" onClick={() => run(onEdit)}>
                            Edit message
                        </button>
                    ) : null}
                    {canCopyText ? (
                        <button type="button" className="sheet-item" onClick={() => run(onCopyText)}>
                            Copy text
                        </button>
                    ) : null}
                </div>
                <div className="sheet-group">
                    <button type="button" className="sheet-item sheet-item-danger" onClick={() => run(onDelete)}>
                        Delete message
                    </button>
                </div>
            </BottomSheet>
        );
    }

    return (
        <BottomSheet open={open} label="Message actions" onClose={onClose} className="message-action-sheet">
            <div className="message-action-sheet-preview">
                <span className="message-action-sheet-sender">{senderName}</span>
                <span className="message-action-sheet-body">{preview}</span>
            </div>
            <div className="message-action-sheet-reactions">
                {QUICK_REACTIONS.slice(0, 6).map((reaction) => (
                    <button
                        key={reaction}
                        type="button"
                        className="message-action-sheet-reaction"
                        aria-label={`React with ${reaction}`}
                        onClick={() => run(() => onQuickReact(reaction))}
                    >
                        {reaction}
                    </button>
                ))}
                <button
                    type="button"
                    className="message-action-sheet-reaction message-action-sheet-reaction-more"
                    aria-label="More reactions"
                    onClick={() => run(onMoreReactions)}
                >
                    +
                </button>
            </div>
            <div className="sheet-group">
                <button type="button" className="sheet-item" onClick={() => run(onReply)}>
                    Reply
                </button>
                {canEdit ? (
                    <button type="button" className="sheet-item" onClick={() => run(onEdit)}>
                        Edit message
                    </button>
                ) : null}
                {canCopyText ? (
                    <button type="button" className="sheet-item" onClick={() => run(onCopyText)}>
                        Copy text
                    </button>
                ) : null}
                <button type="button" className="sheet-item" onClick={() => run(onCopyLink)}>
                    Copy message link
                </button>
            </div>
            {canDelete || canReport ? (
                <div className="sheet-group">
                    {canDelete ? (
                        <button type="button" className="sheet-item sheet-item-danger" onClick={() => run(onDelete)}>
                            Delete message
                        </button>
                    ) : null}
                    {canReport ? (
                        <button type="button" className="sheet-item sheet-item-danger" onClick={() => run(onReport)}>
                            Report message
                        </button>
                    ) : null}
                </div>
            ) : null}
        </BottomSheet>
    );
}
