import React, { useEffect, useRef, useState } from "react";

import {
    MAX_STATUS_MESSAGE_LENGTH,
    PRESENCE_CHOICES,
    type PresenceChoice,
} from "../../../core/presence/presenceControl";

interface StatusMenuProps {
    choice: PresenceChoice;
    statusMessage: string;
    error: string | null;
    onChoose: (choice: PresenceChoice) => void;
    onStatusMessage: (statusMessage: string) => void;
    onClose: () => void;
}

export function StatusMenu({
    choice,
    statusMessage,
    error,
    onChoose,
    onStatusMessage,
    onClose,
}: StatusMenuProps): React.ReactElement {
    const [draft, setDraft] = useState(statusMessage);
    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        setDraft(statusMessage);
    }, [statusMessage]);

    useEffect(() => {
        const onPointerDown = (event: MouseEvent): void => {
            const target = event.target as Node | null;
            if (target && !containerRef.current?.contains(target)) {
                onClose();
            }
        };
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === "Escape") {
                onClose();
            }
        };

        window.addEventListener("mousedown", onPointerDown);
        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("mousedown", onPointerDown);
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [onClose]);

    const commitDraft = (): void => {
        if (draft !== statusMessage) {
            onStatusMessage(draft);
        }
    };

    return (
        <div className="status-menu" ref={containerRef} role="menu" aria-label="Set your status">
            {PRESENCE_CHOICES.map((entry) => (
                <button
                    key={entry.choice}
                    type="button"
                    role="menuitemradio"
                    aria-checked={entry.choice === choice}
                    className={`status-menu-item${entry.choice === choice ? " is-active" : ""}`}
                    onClick={() => {
                        onChoose(entry.choice);
                        onClose();
                    }}
                >
                    <span className={`status-menu-dot is-${entry.choice}`} aria-hidden="true" />
                    <span className="status-menu-text">
                        <span className="status-menu-label">{entry.label}</span>
                        <span className="status-menu-description">{entry.description}</span>
                    </span>
                </button>
            ))}

            <div className="status-menu-separator" role="separator" />

            <label className="status-menu-message">
                <span className="status-menu-message-label">Status message</span>
                <input
                    type="text"
                    value={draft}
                    maxLength={MAX_STATUS_MESSAGE_LENGTH}
                    placeholder="What are you up to?"
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={commitDraft}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            event.preventDefault();
                            commitDraft();
                            onClose();
                        }
                    }}
                />
            </label>
            {draft.length > 0 ? (
                <button
                    type="button"
                    className="status-menu-clear"
                    onClick={() => {
                        setDraft("");
                        onStatusMessage("");
                    }}
                >
                    Clear status message
                </button>
            ) : null}

            {error ? <p className="status-menu-error">{error}</p> : null}
        </div>
    );
}
