import React from "react";

import { RoomNotificationMode } from "../adapters/roomNotificationAdapter";

const OPTIONS: Array<{ mode: RoomNotificationMode; label: string; description: string }> = [
    { mode: RoomNotificationMode.Default, label: "Default", description: "Follows your notification settings." },
    { mode: RoomNotificationMode.AllMessages, label: "All messages", description: "Every new message notifies you." },
    { mode: RoomNotificationMode.MentionsOnly, label: "Mentions only", description: "Only messages that mention you notify you." },
    // A muting rule outranks the one for mentions, so they stay quiet too.
    { mode: RoomNotificationMode.Mute, label: "Mute", description: "Nothing here notifies you, not even mentions." },
];

export function describeRoomNotificationMode(mode: RoomNotificationMode): string {
    return OPTIONS.find((option) => option.mode === mode)?.description ?? "";
}

interface RoomNotificationModePickerProps {
    value: RoomNotificationMode;
    onChange: (mode: RoomNotificationMode) => void;
    disabled?: boolean;
    className?: string;
}

/** How much a chat or channel notifies you: one choice of four. */
export function RoomNotificationModePicker({ value, onChange, disabled = false, className }: RoomNotificationModePickerProps): React.ReactElement {
    return (
        <div className={`rs-notification-modes${className ? ` ${className}` : ""}`} role="radiogroup" aria-label="Notifications">
            {OPTIONS.map((option) => (
                <button
                    key={option.mode}
                    type="button"
                    role="radio"
                    aria-checked={value === option.mode}
                    className={`rs-notification-mode${value === option.mode ? " is-active" : ""}`}
                    onClick={() => onChange(option.mode)}
                    disabled={disabled}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}
