import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { resolveLoginServer, serverLabel, type LoginServer } from "../../../core/config/loginServer";
import { RoomDialog } from "../rooms/RoomDialog";

interface ServerSettingsDialogProps {
    open: boolean;
    defaultHomeserver: string;
    current: LoginServer | null;
    onClose: () => void;
    // null: back to the default server.
    onSaved: (server: LoginServer | null) => void;
}

/** The sign-in screen's settings: which Matrix server to sign in to, or create an account on. */
export function ServerSettingsDialog({
    open,
    defaultHomeserver,
    current,
    onClose,
    onSaved,
}: ServerSettingsDialogProps): React.ReactElement | null {
    const defaultName = serverLabel(defaultHomeserver);
    const [input, setInput] = useState("");
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setInput(current?.serverName ?? "");
            setError(null);
            setChecking(false);
        }
    }, [current, open]);

    if (!open || typeof document === "undefined") {
        return null;
    }

    const save = async (event?: React.FormEvent): Promise<void> => {
        event?.preventDefault();
        const wanted = input.trim();
        if (!wanted || wanted.toLowerCase() === defaultName.toLowerCase()) {
            onSaved(null);
            return;
        }
        setChecking(true);
        setError(null);
        try {
            onSaved(await resolveLoginServer(wanted));
        } catch (resolveError) {
            setError(resolveError instanceof Error ? resolveError.message : "That server couldn't be used.");
        } finally {
            setChecking(false);
        }
    };

    return createPortal(
        <RoomDialog
            open
            title="Server"
            onClose={onClose}
            className="server-settings-dialog"
            footer={
                <>
                    {current ? (
                        <button
                            type="button"
                            className="room-dialog-button room-dialog-button-secondary server-settings-default"
                            onClick={() => onSaved(null)}
                            disabled={checking}
                        >
                            Use {defaultName}
                        </button>
                    ) : null}
                    <button type="button" className="room-dialog-button room-dialog-button-secondary" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="room-dialog-button room-dialog-button-primary"
                        onClick={() => void save()}
                        disabled={checking}
                    >
                        {checking ? "Checking..." : "Save"}
                    </button>
                </>
            }
        >
            <form className="server-settings-form" onSubmit={(event) => void save(event)}>
                <p className="server-settings-intro">
                    Jorvik signs in to {defaultName}. To use an account on another Matrix server, enter that server
                    here. It stays your default on this device until you change it.
                </p>
                <label className="room-dialog-field">
                    Server
                    <input
                        className="room-dialog-input"
                        type="text"
                        inputMode="url"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        value={input}
                        onChange={(event) => setInput(event.target.value)}
                        placeholder={defaultName}
                        disabled={checking}
                        autoFocus
                    />
                </label>
                <p className="server-settings-note">
                    Voice channels, calls and GIFs only work on servers that run Jorvik's voice service.
                </p>
                {error ? <p className="room-dialog-error">{error}</p> : null}
            </form>
        </RoomDialog>,
        document.body,
    );
}
