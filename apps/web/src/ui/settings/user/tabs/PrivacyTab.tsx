import React from "react";

import { AUTO_IDLE_MINUTE_CHOICES, type PrivacySettings } from "../settingsStore";

interface PrivacyTabProps {
    settings: PrivacySettings;
    onChange: (settings: PrivacySettings) => void;
}

export function PrivacyTab({ settings, onChange }: PrivacyTabProps): React.ReactElement {
    return (
        <div className="settings-tab">
            <h2 className="settings-tab-title">Privacy & Safety</h2>
            <p className="settings-tab-description">
                Local placeholder settings. Backend privacy rules are TODO.
            </p>

            <label className="settings-toggle">
                <input
                    type="checkbox"
                    checked={settings.showReadReceipts}
                    onChange={(event) => onChange({ ...settings, showReadReceipts: event.target.checked })}
                />
                Show read receipts (stub)
            </label>

            <label className="settings-toggle">
                <input
                    type="checkbox"
                    checked={settings.allowDmsFromServerMembers}
                    onChange={(event) => onChange({ ...settings, allowDmsFromServerMembers: event.target.checked })}
                />
                Allow DMs from server members (stub)
            </label>

            <div className="settings-section-card">
                <h3>Status</h3>
                <label className="settings-field">
                    <span>Show me as Idle after I'm inactive for</span>
                    <select
                        className="room-dialog-input"
                        value={settings.autoIdleMinutes}
                        onChange={(event) => onChange({ ...settings, autoIdleMinutes: Number(event.target.value) })}
                    >
                        {AUTO_IDLE_MINUTE_CHOICES.map((minutes) => (
                            <option key={minutes} value={minutes}>
                                {minutes === 0 ? "Never" : `${minutes} minutes`}
                            </option>
                        ))}
                    </select>
                </label>
                <p className="settings-inline-note">
                    Only applies while your status is Online, and you are back to Online as soon as you are
                    active again. The desktop app also counts activity in other apps where your system reports
                    it; the web app only counts activity in Jorvik.
                </p>
            </div>
        </div>
    );
}

