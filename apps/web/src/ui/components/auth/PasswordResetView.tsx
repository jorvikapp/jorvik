import React, { useCallback, useMemo, useState } from "react";

import { normalizeHomeserverUrl } from "../../adapters/loginAdapter";
import {
    completePasswordReset,
    formatPasswordResetError,
    requestPasswordResetEmail,
    type PasswordResetTicket,
} from "../../adapters/passwordResetAdapter";
import { looksLikeEmail } from "../../adapters/registrationAdapter";

type PasswordResetStep = "request" | "password" | "verify" | "done";

interface PasswordResetViewProps {
    homeserver: string;
    disableHomeserverInput: boolean;
    onHomeserverChange: (value: string) => void;
    onBack: () => void;
}

export function PasswordResetView({
    homeserver,
    disableHomeserverInput,
    onHomeserverChange,
    onBack,
}: PasswordResetViewProps): React.ReactElement {
    const [step, setStep] = useState<PasswordResetStep>("request");
    const [email, setEmail] = useState("");
    const [ticket, setTicket] = useState<PasswordResetTicket | null>(null);
    const [password, setPassword] = useState("");
    const [passwordConfirm, setPasswordConfirm] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [logoutDevices, setLogoutDevices] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const canRequest = useMemo(() => {
        return !busy && homeserver.trim().length > 0 && email.trim().length > 0;
    }, [busy, email, homeserver]);

    const canChoosePassword = useMemo(() => {
        return !busy && password.length > 0 && passwordConfirm.length > 0;
    }, [busy, password, passwordConfirm]);

    const sendResetEmail = useCallback(
        async (sendAttempt: number, existing: PasswordResetTicket | null): Promise<boolean> => {
            const normalizedEmail = email.trim();
            if (!looksLikeEmail(normalizedEmail)) {
                setError("Email format is invalid.");
                return false;
            }

            setBusy(true);
            setError(null);

            try {
                const nextTicket = await requestPasswordResetEmail({
                    homeserverUrl: normalizeHomeserverUrl(homeserver),
                    email: normalizedEmail,
                    clientSecret: existing?.clientSecret,
                    sendAttempt,
                });
                setTicket(nextTicket);
                return true;
            } catch (requestFailure) {
                setError(formatPasswordResetError(requestFailure));
                return false;
            } finally {
                setBusy(false);
            }
        },
        [email, homeserver],
    );

    const handleRequestSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        if (!canRequest) {
            return;
        }

        if (await sendResetEmail(1, null)) {
            setStep("password");
        }
    };

    const handleResend = async (): Promise<void> => {
        if (busy || !ticket) {
            return;
        }

        if (await sendResetEmail(ticket.sendAttempt + 1, ticket)) {
            setError("Sent again. Open the newest link, then continue.");
        }
    };

    const handlePasswordSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        if (!canChoosePassword) {
            return;
        }

        if (password.length < 8) {
            setError("Password must have at least 8 characters.");
            return;
        }

        if (password !== passwordConfirm) {
            setError("Passwords do not match.");
            return;
        }

        setError(null);
        setStep("verify");
    };

    const handleFinish = async (): Promise<void> => {
        if (busy || !ticket) {
            return;
        }

        setBusy(true);
        setError(null);

        try {
            await completePasswordReset({
                homeserverUrl: normalizeHomeserverUrl(homeserver),
                ticket,
                newPassword: password,
                logoutDevices,
            });
            setPassword("");
            setPasswordConfirm("");
            setStep("done");
        } catch (resetFailure) {
            setError(formatPasswordResetError(resetFailure));
        } finally {
            setBusy(false);
        }
    };

    if (step === "done") {
        return (
            <div className="login-uia">
                <p className="login-subtitle">Password changed</p>
                <p className="login-inline-note">
                    Your password has been updated. Sign in with the new one.
                    {logoutDevices ? " Your other devices have been signed out." : ""}
                </p>
                <button type="button" onClick={onBack}>
                    Back to sign in
                </button>
            </div>
        );
    }

    if (step === "request") {
        return (
            <form onSubmit={handleRequestSubmit}>
                <p className="login-subtitle">Enter your account email and we will send you a reset link.</p>

                {!disableHomeserverInput && (
                    <label>
                        Homeserver
                        <input
                            type="url"
                            value={homeserver}
                            onChange={(event) => onHomeserverChange(event.target.value)}
                            placeholder="https://matrix.org"
                            autoComplete="url"
                            disabled={busy}
                        />
                    </label>
                )}

                <label>
                    Email
                    <input
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="alice@example.com"
                        autoComplete="email"
                    />
                </label>

                {error && <p className="login-error">{error}</p>}

                <button type="submit" disabled={!canRequest}>
                    {busy ? "Sending..." : "Send reset link"}
                </button>

                <div className="login-actions-row">
                    <button type="button" className="login-link-button" onClick={onBack}>
                        Back to sign in
                    </button>
                </div>
            </form>
        );
    }

    if (step === "password") {
        return (
            <form onSubmit={handlePasswordSubmit}>
                <p className="login-subtitle">Choose a new password</p>
                <p className="login-inline-note">
                    If an account uses {ticket?.email ?? email}, we have emailed it a link. Pick your new password here
                    -- it is not applied until you confirm that link on the next step.
                </p>

                <label>
                    New password
                    <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="At least 8 characters"
                        autoComplete="new-password"
                    />
                </label>

                <label>
                    Confirm new password
                    <input
                        type={showPassword ? "text" : "password"}
                        value={passwordConfirm}
                        onChange={(event) => setPasswordConfirm(event.target.value)}
                        placeholder="Repeat password"
                        autoComplete="new-password"
                    />
                </label>

                <label className="login-checkbox">
                    <input
                        type="checkbox"
                        checked={showPassword}
                        onChange={(event) => setShowPassword(event.target.checked)}
                    />
                    <span>Show passwords</span>
                </label>

                <label className="login-checkbox">
                    <input
                        type="checkbox"
                        checked={logoutDevices}
                        onChange={(event) => setLogoutDevices(event.target.checked)}
                    />
                    <span>Sign out my other devices</span>
                </label>
                <span className="login-inline-note">
                    Recommended if someone else may know your old password. You will need your recovery key to read
                    encrypted history on those devices again.
                </span>

                {error && <p className="login-error">{error}</p>}

                <button type="submit" disabled={!canChoosePassword}>
                    Continue
                </button>

                <div className="login-actions-row">
                    <button type="button" className="login-link-button" onClick={onBack}>
                        Cancel
                    </button>
                </div>
            </form>
        );
    }

    return (
        <div className="login-uia">
            <p className="login-subtitle">Confirm the email link</p>
            <p className="login-inline-note">
                Open the link we emailed to {ticket?.email ?? email}, then press Apply. The homeserver checks the link
                itself -- until it has been opened, this will be refused.
            </p>

            {error && <p className="login-error">{error}</p>}

            <button type="button" onClick={handleFinish} disabled={busy}>
                {busy ? "Applying..." : "Apply new password"}
            </button>

            <div className="login-actions-row">
                <button type="button" className="login-link-button" onClick={() => setStep("password")} disabled={busy}>
                    Back
                </button>
                <button type="button" className="login-link-button" onClick={handleResend} disabled={busy}>
                    Resend email
                </button>
                <button type="button" className="login-link-button" onClick={onBack} disabled={busy}>
                    Cancel
                </button>
            </div>
        </div>
    );
}
