import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    DeviceVerification,
    type IMyDevice,
    type MatrixClient,
} from "matrix-js-sdk/src/matrix";

import {
    afterPageAuth,
    passwordAuth,
    readReauthChallenge,
    type ReauthChallenge,
    type ReauthPageWay,
    type ReauthWay,
} from "../../../../core/auth/reauth";
import { useReauthPage } from "../../../components/auth/useReauthPage";

interface DevicesTabProps {
    client: MatrixClient;
    verificationNonce: number;
    onOpenOwnVerification: () => void;
    onOpenDeviceVerification: (target: { userId: string; deviceId: string }) => void;
}

interface DeviceRow extends IMyDevice {
    trustedState: "verified" | "blocked" | "unverified" | "unknown";
}

interface SignOutState {
    device: DeviceRow;
    pending: boolean;
    /** Once the server has asked to show it's you: the ways it takes. */
    challenge: ReauthChallenge | null;
    password: string;
    error: string | null;
}

function isPageWay(way: ReauthWay): way is ReauthPageWay {
    return way.kind !== "password";
}

interface RenameState {
    deviceId: string;
    name: string;
    pending: boolean;
    error: string | null;
}

/** Synapse refuses longer session names. */
const MAX_DEVICE_NAME_LENGTH = 100;

interface MatrixErrorLike {
    message?: unknown;
    errcode?: unknown;
    data?: { error?: unknown };
}

function formatLastSeen(timestamp?: number): string {
    if (!timestamp || !Number.isFinite(timestamp)) {
        return "Unknown";
    }

    return new Date(timestamp).toLocaleString();
}

function trustedStateLabel(state: DeviceRow["trustedState"]): string {
    switch (state) {
        case "verified":
            return "Verified";
        case "blocked":
            return "Blocked";
        case "unverified":
            return "Unverified";
        default:
            return "Unknown";
    }
}

function errorMessage(error: unknown): string {
    const fallbackMessage = error instanceof Error ? error.message : String(error);
    if (!error || typeof error !== "object") {
        return fallbackMessage;
    }

    const matrixError = error as MatrixErrorLike;
    const messageFromData = typeof matrixError.data?.error === "string" ? matrixError.data.error : null;
    const messageFromMatrix = typeof matrixError.message === "string" ? matrixError.message : null;
    return messageFromData ?? messageFromMatrix ?? fallbackMessage;
}

export function DevicesTab({
    client,
    verificationNonce,
    onOpenOwnVerification,
    onOpenDeviceVerification,
}: DevicesTabProps): React.ReactElement {
    const [devices, setDevices] = useState<DeviceRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [signOutState, setSignOutState] = useState<SignOutState | null>(null);
    const [renameState, setRenameState] = useState<RenameState | null>(null);
    const signOutBoxRef = useRef<HTMLFormElement | null>(null);

    const loadDevices = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError(null);
        try {
            const response = await client.getDevices();
            const userId = client.getUserId();
            const trustedByDeviceId = new Map<string, DeviceRow["trustedState"]>();

            if (userId) {
                const crypto = client.getCrypto();
                if (crypto) {
                    const userDevices = await crypto.getUserDeviceInfo([userId], false);
                    const knownDevices = userDevices.get(userId);
                    if (knownDevices) {
                        for (const [deviceId, device] of knownDevices.entries()) {
                            if (device.verified === DeviceVerification.Verified) {
                                trustedByDeviceId.set(deviceId, "verified");
                            } else if (device.verified === DeviceVerification.Blocked) {
                                trustedByDeviceId.set(deviceId, "blocked");
                            } else {
                                trustedByDeviceId.set(deviceId, "unverified");
                            }
                        }
                    }
                }
            }

            const merged = response.devices
                .map((device) => ({
                    ...device,
                    trustedState: trustedByDeviceId.get(device.device_id) ?? "unknown",
                }))
                .sort((left, right) => {
                    const leftTs = left.last_seen_ts ?? 0;
                    const rightTs = right.last_seen_ts ?? 0;
                    return rightTs - leftTs;
                });

            setDevices(merged);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "Failed to load devices.");
        } finally {
            setLoading(false);
        }
    }, [client]);

    useEffect(() => {
        void loadDevices();
    }, [loadDevices, verificationNonce]);

    const currentDeviceId = client.getDeviceId() ?? "";
    const currentUserId = client.getUserId() ?? "";
    const hasDevices = devices.length > 0;
    const knownTrustedCount = useMemo(
        () => devices.filter((device) => device.trustedState === "verified").length,
        [devices],
    );

    const openRename = useCallback((device: DeviceRow): void => {
        setSignOutState(null);
        setRenameState({ deviceId: device.device_id, name: device.display_name ?? "", pending: false, error: null });
    }, []);

    const submitRename = useCallback(async (): Promise<void> => {
        if (!renameState) {
            return;
        }
        const { deviceId } = renameState;
        const name = renameState.name.trim();
        if (!name) {
            return;
        }
        setRenameState((previous) => (previous ? { ...previous, pending: true, error: null } : previous));
        try {
            await client.setDeviceDetails(deviceId, { display_name: name });
            setRenameState(null);
            await loadDevices();
        } catch (renameError) {
            setRenameState((previous) =>
                previous?.deviceId === deviceId
                    ? {
                          ...previous,
                          pending: false,
                          error: renameError instanceof Error ? renameError.message : "Couldn't rename the session.",
                      }
                    : previous,
            );
        }
    }, [client, loadDevices, renameState]);

    const openSignOut = useCallback((device: DeviceRow): void => {
        setRenameState(null);
        setSignOutState({
            device,
            pending: false,
            challenge: null,
            password: "",
            error: null,
        });
    }, []);

    const challenge = signOutState?.challenge ?? null;
    const canUsePassword = challenge?.ways.some((way) => way.kind === "password") ?? false;
    const pageWay = challenge?.ways.find(isPageWay) ?? null;
    // When the server's page says it's done, sign out without another click.
    const reauthPage = useReauthPage(pageWay, () => void submitSignOut());

    const submitSignOut = useCallback(async (): Promise<void> => {
        if (!signOutState) {
            return;
        }

        const currentState = signOutState;
        setSignOutState((previous) => (previous ? { ...previous, pending: true, error: null } : previous));

        try {
            if (!currentUserId) {
                throw new Error("Missing user id for interactive authentication.");
            }

            const asked = currentState.challenge;
            if (!asked) {
                await client.deleteDevice(currentState.device.device_id);
            } else {
                const askedPageWay = asked.ways.find(isPageWay) ?? null;
                let auth: Record<string, unknown> | null;
                if (asked.ways.some((way) => way.kind === "password") && currentState.password.trim().length > 0) {
                    auth = passwordAuth(currentUserId, currentState.password, asked.session);
                } else if (askedPageWay && reauthPage.opened) {
                    auth = afterPageAuth(askedPageWay, asked.session);
                } else {
                    throw new Error(askedPageWay ? "Confirm it's you on your server's page first." : "Account password is required.");
                }
                await client.deleteDevice(currentState.device.device_id, (auth ?? undefined) as any);
            }

            setSignOutState(null);
            await loadDevices();
        } catch (removeError) {
            const asked = readReauthChallenge(client, removeError);

            if (!currentState.challenge && asked) {
                setSignOutState((previous) => {
                    if (!previous || previous.device.device_id !== currentState.device.device_id) {
                        return previous;
                    }

                    return {
                        ...previous,
                        pending: false,
                        challenge: asked,
                        error: asked.ways.length > 0 ? null : "Your server asks for a check Jorvik can't do here.",
                    };
                });
                return;
            }

            // Asked again after the page: the server hasn't seen it finished.
            const message =
                asked && !currentState.password && !(removeError as MatrixErrorLike).data?.error
                    ? "Your server hasn't seen the confirmation yet. Finish it on its page, then try again."
                    : errorMessage(removeError);
            setSignOutState((previous) => {
                if (!previous || previous.device.device_id !== currentState.device.device_id) {
                    return previous;
                }

                return {
                    ...previous,
                    pending: false,
                    error: message,
                };
            });
        }
    }, [client, currentUserId, loadDevices, reauthPage.opened, signOutState]);

    // The box opens under the session that was clicked, which can be far down a long list,
    // so bring it into view, and again once it asks to show it's you.
    const signOutDeviceId = signOutState?.device.device_id ?? null;
    const signOutAsked = challenge !== null;
    useEffect(() => {
        if (signOutDeviceId) {
            signOutBoxRef.current?.scrollIntoView({ block: "nearest" });
        }
    }, [signOutDeviceId, signOutAsked]);

    const renderRenameBox = (state: RenameState): React.ReactElement => (
        <form
            className="settings-section-card settings-devices-rename"
            onSubmit={(event) => {
                event.preventDefault();
                void submitRename();
            }}
        >
            <label className="settings-field">
                Session name
                <input
                    type="text"
                    value={state.name}
                    maxLength={MAX_DEVICE_NAME_LENGTH}
                    onChange={(event) =>
                        setRenameState((previous) => (previous ? { ...previous, name: event.target.value } : previous))
                    }
                    autoFocus
                />
            </label>
            <p className="settings-inline-note">Other people can see session names, so keep it general.</p>
            {state.error ? <p className="settings-inline-error">{state.error}</p> : null}
            <div className="settings-actions-row">
                <button type="submit" className="settings-button" disabled={state.pending || state.name.trim().length === 0}>
                    {state.pending ? "Saving..." : "Save"}
                </button>
                <button
                    type="button"
                    className="settings-button settings-button-secondary"
                    onClick={() => setRenameState(null)}
                    disabled={state.pending}
                >
                    Cancel
                </button>
            </div>
        </form>
    );

    const renderSignOutBox = (state: SignOutState): React.ReactElement => (
        <form
            ref={signOutBoxRef}
            className="settings-section-card settings-devices-signout"
            onSubmit={(event) => {
                event.preventDefault();
                void submitSignOut();
            }}
        >
            <h3>Sign out device</h3>
            <p className="settings-inline-note">
                {state.device.display_name || "Unnamed device"} ({state.device.device_id})
            </p>
            {!state.challenge ? (
                <p className="settings-inline-note">This signs that device out of your account.</p>
            ) : null}
            {canUsePassword ? (
                <label className="settings-field">
                    Account password
                    <input
                        type="password"
                        value={state.password}
                        onChange={(event) =>
                            setSignOutState((previous) =>
                                previous
                                    ? {
                                          ...previous,
                                          password: event.target.value,
                                      }
                                    : previous,
                            )
                        }
                        autoComplete="current-password"
                        autoFocus
                    />
                </label>
            ) : null}
            {pageWay ? (
                <div className="settings-reauth-page">
                    <p className="settings-inline-note">
                        {pageWay.kind === "sso"
                            ? `${canUsePassword ? "Or confirm" : "Confirm"} it's you with single sign-on, on your server's page.`
                            : "Your server wants this approved on its account page first."}
                        {reauthPage.opened ? " Once that's done, confirm here." : ""}
                    </p>
                    <div className="settings-actions-row">
                        <button type="button" className="settings-button settings-button-secondary" onClick={reauthPage.open}>
                            {pageWay.kind === "sso" ? "Continue with single sign-on" : "Open the account page"}
                        </button>
                    </div>
                </div>
            ) : null}
            {state.error ? <p className="settings-inline-error">{state.error}</p> : null}
            <div className="settings-actions-row">
                <button
                    type="submit"
                    className="settings-button settings-button-danger"
                    disabled={state.pending || (state.challenge !== null && !canUsePassword && !reauthPage.opened)}
                >
                    {state.pending ? "Processing..." : "Confirm sign out"}
                </button>
                <button
                    type="button"
                    className="settings-button settings-button-secondary"
                    onClick={() => setSignOutState(null)}
                    disabled={state.pending}
                >
                    Cancel
                </button>
            </div>
        </form>
    );

    return (
        <div className="settings-tab">
            <h2 className="settings-tab-title">Devices</h2>
            <p className="settings-tab-description">Everywhere you're signed in. Sign out of any you don't recognize.</p>

            <div className="settings-actions-row">
                <button type="button" className="settings-button settings-button-secondary" onClick={onOpenOwnVerification}>
                    Verify this device
                </button>
            </div>

            <p className="settings-inline-note">
                Verified sessions: {knownTrustedCount} / {devices.length}
            </p>

            {loading ? <p className="settings-inline-note">Loading devices...</p> : null}
            {error ? <p className="settings-inline-error">{error}</p> : null}

            <div className="settings-devices-list">
                {hasDevices ? (
                    devices.map((device) => {
                        const isCurrent = device.device_id === currentDeviceId;
                        const disableActions = signOutState?.pending ?? false;
                        return (
                            <React.Fragment key={device.device_id}>
                                <div className="settings-devices-item">
                                    <div className="settings-devices-main">
                                        <span className="settings-devices-title">
                                            {device.display_name || "Unnamed device"} {isCurrent ? "(This device)" : ""}
                                        </span>
                                        <span className="settings-devices-meta">Device ID: {device.device_id}</span>
                                        <span className="settings-devices-meta">Last seen: {formatLastSeen(device.last_seen_ts)}</span>
                                        {device.last_seen_ip ? <span className="settings-devices-meta">IP: {device.last_seen_ip}</span> : null}
                                    </div>
                                    <div className="settings-devices-actions">
                                        <span className={`settings-role-badge settings-role-${device.trustedState}`}>
                                            {trustedStateLabel(device.trustedState)}
                                        </span>
                                        <button
                                            type="button"
                                            className="settings-button settings-button-secondary"
                                            disabled={disableActions || !currentUserId}
                                            onClick={() =>
                                                isCurrent
                                                    ? onOpenOwnVerification()
                                                    : onOpenDeviceVerification({
                                                          userId: currentUserId,
                                                          deviceId: device.device_id,
                                                      })
                                            }
                                        >
                                            Verify
                                        </button>
                                        <button
                                            type="button"
                                            className="settings-button settings-button-secondary"
                                            disabled={disableActions || renameState?.pending === true}
                                            onClick={() => openRename(device)}
                                        >
                                            Rename
                                        </button>
                                        <button
                                            type="button"
                                            className="settings-button settings-button-danger"
                                            disabled={disableActions || isCurrent}
                                            title={isCurrent ? "To sign out of this device, use Sign out in Settings." : undefined}
                                            onClick={() => openSignOut(device)}
                                        >
                                            Sign out
                                        </button>
                                    </div>
                                </div>
                                {renameState?.deviceId === device.device_id ? renderRenameBox(renameState) : null}
                                {signOutState?.device.device_id === device.device_id ? renderSignOutBox(signOutState) : null}
                            </React.Fragment>
                        );
                    })
                ) : (
                    <div className="settings-empty">No devices found.</div>
                )}
            </div>
        </div>
    );
}

