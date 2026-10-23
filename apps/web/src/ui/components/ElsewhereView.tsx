import React, { useState } from "react";

interface ElsewhereViewProps {
    onOpenHere: () => Promise<void>;
}

/** Shown in a tab while Jorvik runs in another one (see core/lifecycle/sessionLock.ts). */
export function ElsewhereView({ onOpenHere }: ElsewhereViewProps): React.ReactElement {
    const [opening, setOpening] = useState(false);

    return (
        <div className="login-view">
            <div className="login-card">
                <div className="login-title">
                    <img src="/branding/jorvik-logo-848bff6b.webp" width="36" height="36" alt="" />
                    <h1>Jorvik</h1>
                </div>
                <p className="login-subtitle">Jorvik is open in another tab or window. It runs in one at a time.</p>
                <button
                    type="button"
                    disabled={opening}
                    onClick={() => {
                        setOpening(true);
                        void onOpenHere().finally(() => setOpening(false));
                    }}
                >
                    {opening ? "Opening..." : "Use Jorvik here"}
                </button>
            </div>
        </div>
    );
}
