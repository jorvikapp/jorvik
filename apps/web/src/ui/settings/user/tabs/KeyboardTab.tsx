import React from "react";

import { commandShortcutLabel } from "../../../utils/keyboard";

interface Shortcut {
    // Each entry is one way to do it; "+" joins keys pressed together.
    keys: string[];
    action: string;
}

function shortcuts(): Shortcut[] {
    return [
        { keys: [commandShortcutLabel("K")], action: "Jump to a channel, DM or space" },
        { keys: ["Enter"], action: "Send your message" },
        { keys: ["Shift+Enter"], action: "Start a new line" },
        { keys: ["↑"], action: "Edit your last message, from an empty message box" },
        { keys: ["Esc"], action: "Stop editing or replying, or close a dialog" },
        { keys: ["Tab", "Enter"], action: "Pick the highlighted @mention or :emoji: suggestion" },
        { keys: [commandShortcutLabel("Shift+I")], action: "Open developer tools, in the desktop app when turned on in Appearance" },
    ];
}

/** Every keyboard shortcut in one list. */
export function KeyboardTab(): React.ReactElement {
    return (
        <div className="settings-tab">
            <h2 className="settings-tab-title">Keyboard shortcuts</h2>
            <p className="settings-tab-description">Ways to get around Jorvik without the mouse.</p>
            <div className="settings-table-wrap">
                <table className="settings-table">
                    <thead>
                        <tr>
                            <th scope="col">Keys</th>
                            <th scope="col">What it does</th>
                        </tr>
                    </thead>
                    <tbody>
                        {shortcuts().map((shortcut) => (
                            <tr key={shortcut.action}>
                                <td className="settings-shortcut-keys">
                                    {shortcut.keys.map((key, index) => (
                                        <React.Fragment key={key}>
                                            {index > 0 ? " or " : null}
                                            <kbd className="settings-kbd">{key}</kbd>
                                        </React.Fragment>
                                    ))}
                                </td>
                                <td>{shortcut.action}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
