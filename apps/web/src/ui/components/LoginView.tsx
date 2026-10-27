import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthType, MatrixError, type MatrixClient } from "matrix-js-sdk/src/matrix";

import {
    type DesktopSsoBridge,
    discoverLoginOptions,
    type LoginOptions,
    signInWithSsoOnDesktop,
    SSOAction,
    ssoButtonLabel,
    type SsoProvider,
    ssoProvidersFromFlows,
    startSsoRedirect,
} from "../../core/auth/sso";
import { clearLoginServer, readLoginServer, saveLoginServer, type LoginServer } from "../../core/config/loginServer";
import type { MatrixCredentials } from "../../core/types/credentials";
import { normalizeHomeserverUrl } from "../adapters/loginAdapter";
import {
    authStepIsRequired,
    authStepIsUsed,
    discoverRegistrationFlow,
    formatRegistrationError,
    looksLikeEmail,
    RegistrationProbeError,
    type RegistrationFlow,
} from "../adapters/registrationAdapter";
import { PasswordResetView } from "./auth/PasswordResetView";
import { RegistrationInteractiveAuth } from "./auth/RegistrationInteractiveAuth";
import { ServerSettingsDialog } from "./auth/ServerSettingsDialog";

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
    /** Desktop single sign-on: signs in with the login token the browser brought back. */
    onLoginWithSsoToken?: (homeserverUrl: string, loginToken: string) => Promise<void>;
}

/** The desktop app's side of single sign-on; null in a browser, where the page itself goes to sign in. */
function desktopSsoBridge(): DesktopSsoBridge | null {
    const bridge = typeof window === "undefined" ? undefined : window.heorotDesktop;
    if (bridge?.ssoBegin && bridge.ssoWait && bridge.ssoCancel && bridge.openExternal) {
        return {
            ssoBegin: bridge.ssoBegin,
            ssoWait: bridge.ssoWait,
            ssoCancel: bridge.ssoCancel,
            openExternal: bridge.openExternal,
        };
    }
    return null;
}

interface SsoButtonsProps {
    providers: SsoProvider[];
    /** The only way in: the buttons look like the main action. */
    primary: boolean;
    disabled: boolean;
    onPick: (provider: SsoProvider) => void;
}

function SsoButtons({ providers, primary, disabled, onPick }: SsoButtonsProps): React.ReactElement {
    return (
        <div className="login-sso">
            {providers.map((provider) => (
                <button
                    key={`${provider.loginType}:${provider.id ?? ""}`}
                    type="button"
                    className={primary ? "login-sso-button" : "login-sso-button login-secondary-button"}
                    disabled={disabled}
                    onClick={() => onPick(provider)}
                >
                    {ssoButtonLabel(provider)}
                </button>
            ))}
        </div>
    );
}

export function LoginView({
    defaultHomeserver,
    defaultIdentityServer,
    disableHomeserverInput,
    loading,
    error,
    onLogin,
    onLoginWithCredentials,
    onLoginWithSsoToken,
}: LoginViewProps): React.ReactElement {
    const [mode, setMode] = useState<AuthMode>("sign_in");
    // A server picked in Server settings replaces config.json's until it is changed back.
    const [loginServer, setLoginServer] = useState<LoginServer | null>(() =>
        disableHomeserverInput ? null : readLoginServer(),
    );
    const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
    // An error from signing in to the server just replaced says nothing about the new one.
    const [staleError, setStaleError] = useState<string | null>(null);
    const [homeserver, setHomeserver] = useState(() => loginServer?.baseUrl ?? defaultHomeserver);

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
    const [registerSsoProviders, setRegisterSsoProviders] = useState<SsoProvider[]>([]);
    const [showRegisterPassword, setShowRegisterPassword] = useState(false);

    // How the server lets people in, for its single sign-on buttons. Until it answers (or if it can't
    // say), the password form shows as before.
    const [loginOptions, setLoginOptions] = useState<{ homeserver: string; options: LoginOptions } | null>(null);
    const [ssoBusy, setSsoBusy] = useState(false);
    const [ssoError, setSsoError] = useState<string | null>(null);
    // Desktop: the provider's page is open in the browser; its address, to open it again.
    const [ssoWaitingUrl, setSsoWaitingUrl] = useState<string | null>(null);
    const ssoWaiting = ssoWaitingUrl !== null;

    useEffect(() => {
        let cancelled = false;
        const target = homeserver.trim();
        if (!target) {
            return;
        }
        void (async () => {
            try {
                const options = await discoverLoginOptions(normalizeHomeserverUrl(target));
                if (!cancelled) {
                    setLoginOptions({ homeserver: target, options });
                }
            } catch {
                // Unreachable or not a homeserver: signing in says so.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [homeserver]);

    const currentOptions = loginOptions && loginOptions.homeserver === homeserver.trim() ? loginOptions.options : null;
    const ssoProviders = currentOptions?.sso ?? [];
    // Only hidden once the server has said it takes no passwords.
    const passwordAllowed = !currentOptions || currentOptions.password || ssoProviders.length === 0;

    const chooseServer = useCallback(
        (server: LoginServer | null): void => {
            if (server) {
                saveLoginServer(server);
            } else {
                clearLoginServer();
            }
            setLoginServer(server);
            setHomeserver(server?.baseUrl ?? defaultHomeserver);
            setServerSettingsOpen(false);
            setRegisterError(null);
            setRegisterSsoProviders([]);
            setSsoError(null);
            setStaleError(error);
            // A sign-in still open in the browser was for the old server.
            void desktopSsoBridge()?.ssoCancel();
        },
        [defaultHomeserver, error],
    );

    const startSso = useCallback(
        async (provider: SsoProvider, action: SSOAction): Promise<void> => {
            setSsoError(null);
            setRegisterError(null);
            setStaleError(error);
            setSsoBusy(true);
            let homeserverUrl: string;
            try {
                homeserverUrl = normalizeHomeserverUrl(homeserver);
            } catch (urlError) {
                setSsoError(urlError instanceof Error ? urlError.message : String(urlError));
                setSsoBusy(false);
                return;
            }

            const bridge = desktopSsoBridge();
            if (!bridge) {
                try {
                    // Leaves the page; Jorvik picks up where it left off when the browser comes back.
                    startSsoRedirect(homeserverUrl, provider, action);
                } catch (startError) {
                    setSsoError(
                        startError instanceof Error && startError.name === "SecurityError"
                            ? "Your browser won't let Jorvik remember where you signed in from. Allow site data and try again."
                            : `Couldn't start single sign-on: ${startError instanceof Error ? startError.message : String(startError)}`,
                    );
                    setSsoBusy(false);
                }
                return;
            }

            setSsoWaitingUrl("");
            try {
                const loginToken = await signInWithSsoOnDesktop(bridge, homeserverUrl, provider, action, setSsoWaitingUrl);
                setSsoWaitingUrl(null);
                if (loginToken && onLoginWithSsoToken) {
                    await onLoginWithSsoToken(homeserverUrl, loginToken);
                }
            } catch (ssoFailure) {
                setSsoError(ssoFailure instanceof Error ? ssoFailure.message : String(ssoFailure));
            } finally {
                setSsoWaitingUrl(null);
                setSsoBusy(false);
            }
        },
        [error, homeserver, onLoginWithSsoToken],
    );

    const cancelSso = useCallback((): void => {
        void desktopSsoBridge()?.ssoCancel();
    }, []);

    const reopenSso = useCallback((): void => {
        if (ssoWaitingUrl) {
            void desktopSsoBridge()?.openExternal(ssoWaitingUrl);
        }
    }, [ssoWaitingUrl]);

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

        setStaleError(null);
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
        setRegisterSsoProviders([]);

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
                if (ssoFlow) {
                    setRegisterSsoProviders(ssoProvidersFromFlows([ssoFlow]));
                }
            }

            setRegisterError(formatRegistrationError(registrationFailure));
        } finally {
            setRegisterBusy(false);
        }
    };

    const providerError = error && error !== staleError ? error : null;
    const displayError =
        mode === "register"
            ? registerError ?? ssoError ?? providerError
            : mode === "sign_in"
              ? ssoError ?? providerError
              : null;
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

    const ssoWaitingPanel = (
        <div className="login-sso-waiting" role="status">
            <p className="login-subtitle">Continue in your browser</p>
            <p className="login-inline-note">
                Jorvik opened your server's sign-in page in your browser. Once you've signed in there, Jorvik carries on
                by itself.
            </p>
            <div className="login-actions-row">
                <button type="button" className="login-secondary-button" disabled={!ssoWaitingUrl} onClick={reopenSso}>
                    Open the page again
                </button>
                <button type="button" className="login-secondary-button" onClick={cancelSso}>
                    Cancel
                </button>
            </div>
        </div>
    );

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
                {loginServer ? (
                    <p className="login-server-hint">
                        Server: <strong>{loginServer.serverName}</strong>
                    </p>
                ) : null}
                <div className="login-flow-shell" style={flowHeight === null ? undefined : { height: `${flowHeight}px` }}>
                    <div className="login-flow-content" ref={flowContentRef}>
                        {mode !== "reset" && ssoWaiting ? (
                    ssoWaitingPanel
                ) : mode === "sign_in" ? (
                    <form onSubmit={handleSignInSubmit}>
                        <p className="login-subtitle">Sign in to continue</p>

                        {ssoProviders.length > 0 ? (
                            <SsoButtons
                                providers={ssoProviders}
                                primary={!passwordAllowed}
                                disabled={ssoBusy || loading}
                                onPick={(provider) => void startSso(provider, SSOAction.LOGIN)}
                            />
                        ) : null}
                        {ssoProviders.length > 0 && passwordAllowed ? (
                            <p className="login-divider">
                                <span>or</span>
                            </p>
                        ) : null}

                        {passwordAllowed ? (
                            <>
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
                            </>
                        ) : null}

                        {displayError && <p className="login-error">{displayError}</p>}

                        {passwordAllowed ? (
                            <>
                                <button type="submit" disabled={!canSignIn}>
                                    {loading ? "Signing in..." : "Sign in"}
                                </button>

                                <div className="login-actions-row">
                                    <button type="button" className="login-link-button" onClick={() => switchMode("reset")}>
                                        Forgot password?
                                    </button>
                                </div>
                            </>
                        ) : null}
                    </form>
                ) : mode === "reset" ? (
                    <PasswordResetView
                        homeserver={homeserver}
                        // The server is picked in Server settings.
                        disableHomeserverInput
                        onHomeserverChange={setHomeserver}
                        onBack={() => switchMode("sign_in")}
                    />
                ) : registerStep === "form" && !passwordAllowed ? (
                    <div className="login-sso-register">
                        <p className="login-subtitle">Join Jorvik</p>
                        <p className="login-inline-note">This server makes your account the first time you sign in with it.</p>
                        <SsoButtons
                            providers={ssoProviders}
                            primary
                            disabled={ssoBusy}
                            onPick={(provider) => void startSso(provider, SSOAction.REGISTER)}
                        />
                        {displayError && <p className="login-error">{displayError}</p>}
                    </div>
                ) : registerStep === "form" ? (
                    <form onSubmit={handleRegisterSubmit}>
                        <p className="login-subtitle">Join Jorvik. Create your account and start connecting</p>
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

                        {registerSsoProviders.length > 0 ? (
                            <SsoButtons
                                providers={registerSsoProviders}
                                primary={false}
                                disabled={ssoBusy}
                                onPick={(provider) => void startSso(provider, SSOAction.REGISTER)}
                            />
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
                {/* Last in the card: the desktop app applies window-drag areas in page order, later ones
                    winning, so a gear placed before the full-width title row lost its clicks to a drag. */}
                {!disableHomeserverInput ? (
                    <button
                        type="button"
                        className="login-link-button login-settings-button"
                        onClick={() => setServerSettingsOpen(true)}
                        aria-label="Server settings"
                        title="Server settings"
                    >
                        ⚙
                    </button>
                ) : null}
            </div>
            <ServerSettingsDialog
                open={serverSettingsOpen}
                defaultHomeserver={defaultHomeserver}
                current={loginServer}
                onClose={() => setServerSettingsOpen(false)}
                onSaved={chooseServer}
            />
        </div>
    );
}
