import React, { useEffect, useState } from "react";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import { probeReauthWays, type ReauthWay } from "../../../../core/auth/reauth";
import { SdkConfig } from "../../../../core/config/SdkConfig";

export type TwoFactorState = "checking" | "on" | "off" | "unknown";

/** The page where people manage their codes and passkeys. Only servers that offer two-factor sign-in set it. */
export function accountManagementUrl(): string | null {
    const value = SdkConfig.get("account_management_url");
    return typeof value === "string" && /^https?:\/\//.test(value.trim()) ? value.trim() : null;
}

/**
 * On when the account can only confirm it's you through its Jorvik account (no password left on the Matrix side),
 * off while it still has a password. Anything else can't be told from here.
 */
export function twoFactorStateFromWays(ways: ReauthWay[] | null): TwoFactorState {
    if (!ways) {
        return "unknown";
    }
    if (ways.some((way) => way.kind === "password")) {
        return "off";
    }
    return ways.some((way) => way.kind === "sso") ? "on" : "unknown";
}

/** Settings > My Account: whether this account signs in with two factors, and where to manage them. */
export function TwoFactorSection({ client }: { client: MatrixClient }): React.ReactElement | null {
    const url = accountManagementUrl();
    const [state, setState] = useState<TwoFactorState>("checking");

    useEffect(() => {
        if (!url) {
            return undefined;
        }
        let cancelled = false;
        void probeReauthWays(client).then((ways) => {
            if (!cancelled) {
                setState(twoFactorStateFromWays(ways));
            }
        });
        return () => {
            cancelled = true;
        };
    }, [client, url]);

    if (!url || state === "unknown") {
        return null;
    }

    return (
        <section className="settings-section-card settings-two-factor" aria-busy={state === "checking"}>
            <h3 className="settings-two-factor-title">
                Two-factor sign-in
                {state !== "checking" ? (
                    <span className={`settings-role-badge settings-role-${state === "on" ? "verified" : "unverified"}`}>
                        {state === "on" ? "On" : "Off"}
                    </span>
                ) : null}
            </h3>
            {state === "checking" ? <p className="settings-inline-note">Checking...</p> : null}
            {state === "on" ? (
                <>
                    <p className="settings-inline-note">
                        You sign in with your Jorvik account: your password, then a code from your authenticator app or a
                        passkey. Your password alone can't get anyone into your account.
                    </p>
                    <div className="settings-actions-row">
                        <a className="settings-button settings-button-secondary" href={url} target="_blank" rel="noopener noreferrer">
                            Manage codes and passkeys
                        </a>
                    </div>
                </>
            ) : null}
            {state === "off" ? (
                <p className="settings-inline-note">
                    Your account signs in with just a password. Ask a server admin to turn on two-factor sign-in: you'll then
                    also need a code from an authenticator app or a passkey, so a password alone can't get anyone in.
                </p>
            ) : null}
        </section>
    );
}
