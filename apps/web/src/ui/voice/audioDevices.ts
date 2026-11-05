import { useCallback, useEffect, useState } from "react";

/**
 * The microphones and speakers this device has, for the pickers next to the panel's mic and deafen
 * buttons. Which one is used is a voice setting (Settings > Voice and video), kept on this device;
 * these only list them.
 */

export type AudioDeviceKind = "audioinput" | "audiooutput";

export interface AudioDevice {
    id: string;
    label: string;
}

export type AudioDeviceState =
    | { status: "loading" }
    | { status: "ready"; devices: AudioDevice[] }
    /** There are devices, but the browser hides them until the microphone is allowed. */
    | { status: "needs-permission" }
    | { status: "denied" }
    | { status: "none" }
    /** This browser can't list them, or (speakers) can't choose where sound plays. */
    | { status: "unsupported" };

/** "default" stands for whatever the system uses; browsers that list no such device get one. */
export const DEFAULT_DEVICE_ID = "default";

export function canChooseOutput(): boolean {
    return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
}

async function microphonePermission(): Promise<PermissionState | "unknown"> {
    try {
        const status = await navigator.permissions?.query({ name: "microphone" as PermissionName });
        return status?.state ?? "unknown";
    } catch {
        return "unknown";
    }
}

function named(devices: MediaDeviceInfo[], kind: AudioDeviceKind): AudioDevice[] {
    const fallback = kind === "audioinput" ? "Microphone" : "Speaker";
    const list = devices.map((device, index) => ({
        id: device.deviceId || DEFAULT_DEVICE_ID,
        label: device.label || `${fallback} ${index + 1}`,
    }));
    if (!list.some((device) => device.id === DEFAULT_DEVICE_ID)) {
        list.unshift({ id: DEFAULT_DEVICE_ID, label: "System default" });
    }
    return list;
}

export async function listAudioDevices(kind: AudioDeviceKind): Promise<AudioDeviceState> {
    if (kind === "audiooutput" && !canChooseOutput()) {
        return { status: "unsupported" };
    }
    const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (!media?.enumerateDevices) {
        return { status: "unsupported" };
    }
    let all: MediaDeviceInfo[];
    try {
        all = await media.enumerateDevices();
    } catch {
        return { status: "unsupported" };
    }
    const ofKind = all.filter((device) => device.kind === kind);
    if (ofKind.some((device) => device.label)) {
        return { status: "ready", devices: named(ofKind.filter((device) => device.label), kind) };
    }
    // Without the microphone allowed, browsers list devices without names, or not at all.
    const permission = await microphonePermission();
    if (permission === "denied") {
        return { status: "denied" };
    }
    if (ofKind.length === 0) {
        return { status: "none" };
    }
    if (permission === "granted") {
        return { status: "ready", devices: named(ofKind, kind) };
    }
    return { status: "needs-permission" };
}

/** Asks for the microphone, only to learn the devices' names: it's closed again at once. */
export async function requestMicrophoneAccess(): Promise<boolean> {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        for (const track of stream.getTracks()) {
            track.stop();
        }
        return true;
    } catch {
        return false;
    }
}

/** The devices of one kind while `active` (a picker is open), following devices plugged in or out. */
export function useAudioDevices(
    kind: AudioDeviceKind,
    active: boolean,
): { state: AudioDeviceState; requestAccess: () => Promise<void> } {
    const [state, setState] = useState<AudioDeviceState>({ status: "loading" });
    const [revision, setRevision] = useState(0);

    useEffect(() => {
        if (!active) {
            return;
        }
        let current = true;
        void listAudioDevices(kind).then((next) => {
            if (current) {
                setState(next);
            }
        });
        const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
        const onChange = (): void => setRevision((value) => value + 1);
        media?.addEventListener?.("devicechange", onChange);
        return () => {
            current = false;
            media?.removeEventListener?.("devicechange", onChange);
        };
    }, [active, kind, revision]);

    const requestAccess = useCallback(async (): Promise<void> => {
        const allowed = await requestMicrophoneAccess();
        if (!allowed) {
            setState({ status: "denied" });
            return;
        }
        setRevision((value) => value + 1);
    }, []);

    return { state, requestAccess };
}
