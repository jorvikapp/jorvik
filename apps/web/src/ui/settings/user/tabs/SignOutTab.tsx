import React, { useState } from "react";

import { useConfirm } from "../../../components/confirm/ConfirmProvider";

interface SignOutTabProps {
    onSignOut: () => Promise<void>;
}

export function SignOutTab({ onSignOut }: SignOutTabProps): React.ReactElement {
    const [pending, setPending] = useState(false);
    const confirmAction = useConfirm();
    const isDesktopRuntime = typeof window !== "undefined" && Boolean(window.heorotDesktop?.quitApp);

    const runSignOut = async (): Promise<void> => {
        const confirmed = await confirmAction({ title: "Sign out of this session?", confirmLabel: "Sign out", danger: true });
        if (!confirmed) {
            return;
        }

        setPending(true);
        try {
            await onSignOut();
        } finally {
            setPending(false);
        }
    };

    return (
        <div className="settings-tab">
            <h2 className="settings-tab-title">Sign out</h2>
            <p className="settings-tab-description">Sign out of Jorvik on this device.</p>

            <div className="settings-danger-card">
                <div>
                    <h3>Sign out of this device</h3>
                    <p>Afterwards, you'll need your security key or another signed-in device to read your encrypted messages here.</p>
                </div>
                <button
                    type="button"
                    className="settings-button settings-button-danger"
                    disabled={pending}
                    onClick={() => void runSignOut()}
                >
                    {pending ? "Signing out..." : "Sign out"}
                </button>
            </div>
            {isDesktopRuntime ? (
                <div className="settings-danger-card">
                    <div>
                        <h3>Quit Jorvik</h3>
                        <p>Close Jorvik completely, so it stops running in the background.</p>
                    </div>
                    <button
                        type="button"
                        className="settings-button settings-button-secondary"
                        onClick={() => {
                            void window.heorotDesktop?.quitApp?.();
                        }}
                    >
                        Quit app
                    </button>
                </div>
            ) : null}
        </div>
    );
}
