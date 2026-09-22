import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthType, MatrixError, type MatrixClient } from "matrix-js-sdk/src/matrix";

import type { MatrixCredentials } from "../../core/types/credentials";
import { normalizeHomeserverUrl } from "../adapters/loginAdapter";
import {
    authStepIsRequired,
    authStepIsUsed,
    buildRegistrationSsoUrl,
    discoverRegistrationFlow,
    formatRegistrationError,
    looksLikeEmail,
    RegistrationProbeError,
    type RegistrationFlow,
} from "../adapters/registrationAdapter";
import { PasswordResetView } from "./auth/PasswordResetView";
import { RegistrationInteractiveAuth } from "./auth/RegistrationInteractiveAuth";

type AuthMode = "sign_in" | "register" | "reset";
type RegistrationStep = "form" | "uia";

interface LoginViewProps {
    defaultHomeserver: string;
    defaultIdentityServer?: string;
    disableHomeserverInput: boolean;
    loading: boolean;
    error: string | null;
    onLogin: (homeserverUrl: string, username: string, password: string) => Promise<void>;
    onLoginWithCredentials: (credentials: MatrixCredentials) => Promise<void>;
}

export function LoginView({
    defaultHomeserver,
    defaultIdentityServer,
    disableHomeserverInput,
    loading,
    error,
    onLogin,
    onLoginWithCredentials,
}: LoginViewProps): React.ReactElement {
    const [mode, setMode] = useState<AuthMode>("sign_in");
    const [homeserver, setHomeserver] = useState(defaultHomeserver);

    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);

    const [registerStep, setRegisterStep] = useState<RegistrationStep>("form");
    const [registerClient, setRegisterClient] = useState<MatrixClient | null>(null);
    const [registerFlows, setRegisterFlows] = useState<RegistrationFlow[]>([]);
    const [registerUsername, setRegisterUsername] = useState("");
    const [registerEmail, setRegisterEmail] = useState("");
    const [registerPassword, setRegisterPassword] = useState("");
    const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState("");
    const [registerUsesEmail, setRegisterUsesEmail] = useState(false);
    const [registerRequiresEmail, setRegisterRequiresEmail] = useState(false);
    const [registerBusy, setRegisterBusy] = useState(false);
    const [registerError, setRegisterError] = useState<string | null>(null);
    const [registerSsoUrl, setRegisterSsoUrl] = useState<string | null>(null);
    const [showRegisterPassword, setShowRegisterPassword] = useState(false);

    const switchMode = useCallback((nextMode: AuthMode): void => {
        setMode(nextMode);
        if (nextMode === "sign_in") {
            setRegisterStep("form");
            setRegisterError(null);
        }
    }, []);

    const canSignIn = useMemo(() => {
        return homeserver.trim().length > 0 && username.trim().length > 0 && password.length > 0 && !loading;
    }, [homeserver, loading, password, username]);

    const canStartRegistration = useMemo(() => {
        if (registerStep !== "form" || registerBusy) {
            return false;
        }

        if (homeserver.trim().length === 0 || registerUsername.trim().length === 0) {
            return false;
        }

        if (registerPassword.length === 0 || registerPasswordConfirm.length === 0) {
            return false;
        }

        if (registerEmail.trim().length === 0) {
            return false;
        }

        return true;
    }, [
        homeserver,
        registerBusy,
        registerEmail,
        registerPassword,
        registerPasswordConfirm,
        registerStep,
        registerUsername,
    ]);

    const handleSignInSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        if (!canSignIn) {
            return;
        }

        await onLogin(homeserver.trim(), username.trim(), password);
    };

    const handleRegistrationCompleted = useCallback(
        async (credentials: MatrixCredentials): Promise<void> => {
            setRegisterError(null);
            setRegisterBusy(true);
            try {
                await onLoginWithCredentials(credentials);
            } catch (completionError) {
                setRegisterError(completionError instanceof Error ? completionError.message : String(completionError));
            } finally {
                setRegisterBusy(false);
            }
        },
        [onLoginWithCredentials],
    );

    const handleRegisterSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        if (!canStartRegistration) {
            return;
        }

        const normalizedUsername = registerUsername.trim().toLowerCase();
        const normalizedEmail = registerEmail.trim();

        if (registerPassword.length < 8) {
            setRegisterError("Password must have at least 8 characters.");
            return;
        }

        if (registerPassword !== registerPasswordConfirm) {
            setRegisterError("Passwords do not match.");
            return;
        }

        if (normalizedEmail.length === 0) {
            setRegisterError("An email address is required so you can reset your password later.");
            return;
        }

        if (!looksLikeEmail(normalizedEmail)) {
            setRegisterError("Email format is invalid.");
            return;
        }

        setRegisterBusy(true);
        setRegisterError(null);
        setRegisterSsoUrl(null);

        try {
            const normalizedHomeserver = normalizeHomeserverUrl(homeserver);
            const probe = await discoverRegistrationFlow({
                homeserverUrl: normalizedHomeserver,
                identityServerUrl: defaultIdentityServer,
            });

            if (probe.flows.length === 0) {
                throw new Error("Homeserver did not return supported registration flows.");
            }

            let usernameAvailable = false;
            try {
                usernameAvailable = await probe.client.isUsernameAvailable(normalizedUsername);
            } catch (usernameError) {
                if (usernameError instanceof MatrixError && usernameError.errcode === "M_INVALID_USERNAME") {
                    setRegisterError("Usernames can only contain lowercase letters, numbers, and . _ - = / +");
                    return;
                }
                throw usernameError;
            }

            if (!usernameAvailable) {
                setRegisterError("Username is already in use.");
                return;
            }

            const emailUsed = authStepIsUsed(probe.flows, AuthType.Email);
            const emailRequired = authStepIsRequired(probe.flows, AuthType.Email);
            if (emailRequired && normalizedEmail.length === 0) {
                setRegisterError("This homeserver requires an email address for registration.");
                return;
            }

            setRegisterUsesEmail(emailUsed);
            setRegisterRequiresEmail(emailRequired);
            setRegisterFlows(probe.flows);
            setRegisterClient(probe.client);
            setRegisterStep("uia");
        } catch (registrationFailure) {
            if (registrationFailure instanceof RegistrationProbeError && registrationFailure.code === "registration_disabled_sso") {
                const ssoFlow = registrationFailure.ssoFlow;
                const registrationClient = registrationFailure.client;
                if (ssoFlow && registrationClient) {
                    const loginType = ssoFlow.type === "m.login.cas" ? "cas" : "sso";
                    setRegisterSsoUrl(
                        buildRegistrationSsoUrl({
                            client: registrationClient,
                            loginType,
                        }),
                    );
                }
            }

            setRegisterError(formatRegistrationError(registrationFailure));
        } finally {
            setRegisterBusy(false);
        }
    };

    const providerError = error;
    const displayError =
        mode === "register" ? registerError ?? providerError : mode === "sign_in" ? providerError : null;
    const flowContentRef = useRef<HTMLDivElement | null>(null);
    const [flowHeight, setFlowHeight] = useState<number | null>(null);

    const syncFlowHeight = useCallback((): void => {
        const nextHeight = flowContentRef.current?.getBoundingClientRect().height;
        if (!nextHeight || nextHeight <= 0) {
            return;
        }

        const roundedHeight = Math.ceil(nextHeight);
        setFlowHeight((currentHeight) => (currentHeight === roundedHeight ? currentHeight : roundedHeight));
    }, []);

    useEffect(() => {
        let animationFrameId: number | null = null;

        const scheduleHeightSync = (): void => {
            if (animationFrameId !== null) {
                cancelAnimationFrame(animationFrameId);
            }

            animationFrameId = requestAnimationFrame(() => {
                animationFrameId = null;
                syncFlowHeight();
            });
        };

        scheduleHeightSync();

        const observedElement = flowContentRef.current;
        if (!observedElement || typeof ResizeObserver === "undefined") {
            return () => {
                if (animationFrameId !== null) {
                    cancelAnimationFrame(animationFrameId);
                }
            };
        }

        const observer = new ResizeObserver(() => {
            scheduleHeightSync();
        });
        observer.observe(observedElement);

        return () => {
            observer.disconnect();
            if (animationFrameId !== null) {
                cancelAnimationFrame(animationFrameId);
            }
        };
    }, [syncFlowHeight, mode, registerStep]);

    return (
        <div className="login-view">
            <div className="login-card login-card-wide">
                <div className="login-title">
                    <img src="/branding/jorvik-logo-848bff6b.webp" width="36" height="36" alt="" />
                    <h1>Jorvik</h1>
                </div>
                <div className="login-mode-switch" role="tablist" aria-label="Authentication flow">
                    <button
                        type="button"
                        className={`login-mode-button${mode !== "register" ? " is-active" : ""}`}
                        onClick={() => switchMode("sign_in")}
                    >
                        Sign in
                    </button>
                    <button
                        type="button"
                        className={`login-mode-button${mode === "register" ? " is-active" : ""}`}
                        onClick={() => switchMode("register")}
                    >
                        Register
                    </button>
                </div>
                <div className="login-flow-shell" style={flowHeight === null ? undefined : { height: `${flowHeight}px` }}>
                    <div className="login-flow-content" ref={flowContentRef}>
                        {mode === "sign_in" ? (
                    <form onSubmit={handleSignInSubmit}>
                        <p className="login-subtitle">Sign in to continue</p>

                        {!disableHomeserverInput && (
                            <label>
                                Homeserver
                                <input
                                    type="url"
                                    value={homeserver}
                                    onChange={(event) => setHomeserver(event.target.value)}
                                    placeholder="https://matrix.org"
                                    autoComplete="url"
                                />
                            </label>
                        )}

                        <label>
                            Username or email
                            <input
                                type="text"
                                value={username}
                                onChange={(event) => setUsername(event.target.value)}
                                placeholder="alice"
                                autoComplete="username"
                            />
                        </label>

                        <label>
                            Password
                            <input
                                type={showPassword ? "text" : "password"}
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                placeholder="********"
                                autoComplete="current-password"
                            />
                        </label>

                        <label className="login-checkbox">
                            <input
                                type="checkbox"
                                checked={showPassword}
                                onChange={(event) => setShowPassword(event.target.checked)}
                            />
                            <span>Show password</span>
                        </label>

                        {displayError && <p className="login-error">{displayError}</p>}

                        <button type="submit" disabled={!canSignIn}>
                            {loading ? "Signing in..." : "Sign in"}
                        </button>

                        <div className="login-actions-row">
                            <button type="button" className="login-link-button" onClick={() => switchMode("reset")}>
                                Forgot password?
                            </button>
                        </div>
                    </form>
                ) : mode === "reset" ? (
                    <PasswordResetView
                        homeserver={homeserver}
                        disableHomeserverInput={disableHomeserverInput}
                        onHomeserverChange={setHomeserver}
                        onBack={() => switchMode("sign_in")}
                    />
                ) : registerStep === "form" ? (
                    <form onSubmit={handleRegisterSubmit}>
                        <p className="login-subtitle">Join Jorvik. Create your account and start connecting</p>
                        {!disableHomeserverInput && (
                            <label>
                                Homeserver
                                <input
                                    type="url"
                                    value={homeserver}
                                    onChange={(event) => setHomeserver(event.target.value)}
                                    placeholder="https://matrix.org"
                                    autoComplete="url"
                                    disabled={registerBusy}
                                />
                            </label>
                        )}

                        <label>
                            Username
                            <span className="login-inline-note">Lowercase letters, numbers, dots, underscores, and hyphens only.</span>
                            <input
                                type="text"
                                value={registerUsername}
                                onChange={(event) => setRegisterUsername(event.target.value.toLowerCase())}
                                placeholder="alice"
                                autoComplete="username"
                            />
                        </label>

                        <label>
                            Email
                            <input
                                type="email"
                                value={registerEmail}
                                onChange={(event) => setRegisterEmail(event.target.value)}
                                placeholder="alice@example.com"
                                autoComplete="email"
                            />
                        </label>

                        <label>
                            Password
                            <input
                                type={showRegisterPassword ? "text" : "password"}
                                value={registerPassword}
                                onChange={(event) => setRegisterPassword(event.target.value)}
                                placeholder="At least 8 characters"
                                autoComplete="new-password"
                            />
                        </label>

                        <label>
                            Confirm password
                            <input
                                type={showRegisterPassword ? "text" : "password"}
                                value={registerPasswordConfirm}
                                onChange={(event) => setRegisterPasswordConfirm(event.target.value)}
                                placeholder="Repeat password"
                                autoComplete="new-password"
                            />
                        </label>

                        <label className="login-checkbox">
                            <input
                                type="checkbox"
                                checked={showRegisterPassword}
                                onChange={(event) => setShowRegisterPassword(event.target.checked)}
                            />
                            <span>Show passwords</span>
                        </label>

                        {displayError && <p className="login-error">{displayError}</p>}

                        {registerSsoUrl ? (
                            <button type="button" className="login-secondary-button" onClick={() => (window.location.href = registerSsoUrl)}>
                                Continue with SSO registration
                            </button>
                        ) : null}

                        <button type="submit" disabled={!canStartRegistration}>
                            {registerBusy ? "Preparing registration..." : "Create account"}
                        </button>
                    </form>
                ) : registerClient ? (
                    <RegistrationInteractiveAuth
                        client={registerClient}
                        username={registerUsername}
                        password={registerPassword}
                        emailAddress={registerUsesEmail ? registerEmail.trim() || undefined : undefined}
                        onCompleted={handleRegistrationCompleted}
                        onBack={() => {
                            setRegisterStep("form");
                            setRegisterError(null);
                        }}
                    />
                ) : (
                    <div>
                        <p className="login-error">Registration state was lost. Please restart registration.</p>
                        <button
                            type="button"
                            onClick={() => {
                                setRegisterStep("form");
                                setRegisterError(null);
                            }}
                        >
                            Back to form
                        </button>
                    </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
