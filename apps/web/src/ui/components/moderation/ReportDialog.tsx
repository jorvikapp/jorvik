import React, { useEffect, useState } from "react";

import { MAX_REPORT_REASON_LENGTH } from "../../../core/moderation/reports";
import { RoomDialog } from "../rooms/RoomDialog";

interface ReportDialogProps {
    open: boolean;
    title: string;
    /** Who will see the report, or why this report cannot be sent. */
    note: string;
    /** False when the report would go nowhere; the note says why. */
    canSubmit: boolean;
    onClose: () => void;
    onSubmit: (reason: string) => Promise<void>;
}

export function ReportDialog({ open, title, note, canSubmit, onClose, onSubmit }: ReportDialogProps): React.ReactElement | null {
    const [reason, setReason] = useState("");
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setReason("");
            setSending(false);
            setError(null);
        }
    }, [open]);

    const submit = async (): Promise<void> => {
        const trimmed = reason.trim();
        if (!trimmed) {
            setError("Say what is wrong, so the admins know what to look at.");
            return;
        }
        setSending(true);
        setError(null);
        try {
            await onSubmit(trimmed);
            onClose();
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : "Could not send the report.");
        } finally {
            setSending(false);
        }
    };

    return (
        <RoomDialog
            open={open}
            title={title}
            onClose={onClose}
            footer={
                <>
                    <button type="button" className="room-dialog-button room-dialog-button-secondary" onClick={onClose} disabled={sending}>
                        Cancel
                    </button>
                    {canSubmit ? (
                        <button type="button" className="room-dialog-button room-dialog-button-danger" onClick={() => void submit()} disabled={sending}>
                            {sending ? "Sending..." : "Send report"}
                        </button>
                    ) : null}
                </>
            }
        >
            <p className="room-dialog-muted">{note}</p>
            {canSubmit ? (
                <label className="room-dialog-field">
                    <span>What is wrong?</span>
                    <textarea
                        className="room-dialog-textarea"
                        value={reason}
                        maxLength={MAX_REPORT_REASON_LENGTH}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder="Spam, harassment, something else..."
                        disabled={sending}
                        autoFocus
                    />
                </label>
            ) : null}
            {error ? <p className="room-dialog-error">{error}</p> : null}
        </RoomDialog>
    );
}
