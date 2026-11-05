import { afterEach, describe, expect, it, vi } from "vitest";

import { listAudioDevices, requestMicrophoneAccess } from "../../../../src/ui/voice/audioDevices";
import { loadUserLocalSettings, saveUserLocalSettings } from "../../../../src/ui/settings/user/settingsStore";

const device = (kind: MediaDeviceKind, deviceId: string, label: string): MediaDeviceInfo =>
    ({ kind, deviceId, label, groupId: "g", toJSON: () => ({}) }) as MediaDeviceInfo;

function fakeMedia(devices: MediaDeviceInfo[] | (() => Promise<MediaDeviceInfo[]>), permission?: PermissionState): void {
    vi.stubGlobal("navigator", {
        ...navigator,
        mediaDevices: {
            enumerateDevices: typeof devices === "function" ? devices : async () => devices,
            getUserMedia: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        },
        permissions: permission ? { query: async () => ({ state: permission }) } : undefined,
    });
}

function canChooseSpeaker(can: boolean): void {
    if (can) {
        Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", { configurable: true, value: async () => undefined });
    } else {
        delete (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId;
    }
}

afterEach(() => {
    vi.unstubAllGlobals();
    canChooseSpeaker(false);
    window.localStorage.clear();
});

describe("listing microphones and speakers", () => {
    it("lists them by name, keeping the browser's own default", async () => {
        fakeMedia([
            device("audioinput", "default", "Default - Built-in Microphone"),
            device("audioinput", "usb", "USB Microphone"),
            device("audiooutput", "default", "Default - Speakers"),
        ]);
        expect(await listAudioDevices("audioinput")).toEqual({
            status: "ready",
            devices: [
                { id: "default", label: "Default - Built-in Microphone" },
                { id: "usb", label: "USB Microphone" },
            ],
        });
    });

    it("adds a System default choice where the browser lists no default device", async () => {
        canChooseSpeaker(true);
        fakeMedia([device("audiooutput", "hp", "Headphones")]);
        expect(await listAudioDevices("audiooutput")).toEqual({
            status: "ready",
            devices: [
                { id: "default", label: "System default" },
                { id: "hp", label: "Headphones" },
            ],
        });
    });

    it("asks for the microphone first when the browser hides the names", async () => {
        fakeMedia([device("audioinput", "", "")], "prompt");
        expect(await listAudioDevices("audioinput")).toEqual({ status: "needs-permission" });
    });

    it("says access is blocked when the microphone is denied", async () => {
        fakeMedia([device("audioinput", "", "")], "denied");
        expect(await listAudioDevices("audioinput")).toEqual({ status: "denied" });
    });

    it("names them itself when allowed but the browser gives no names", async () => {
        fakeMedia([device("audioinput", "a1", ""), device("audioinput", "a2", "")], "granted");
        expect(await listAudioDevices("audioinput")).toEqual({
            status: "ready",
            devices: [
                { id: "default", label: "System default" },
                { id: "a1", label: "Microphone 1" },
                { id: "a2", label: "Microphone 2" },
            ],
        });
    });

    it("says when there are none", async () => {
        fakeMedia([], "granted");
        expect(await listAudioDevices("audioinput")).toEqual({ status: "none" });
    });

    it("never fails: no device list, a failing one, or no way to choose the speaker", async () => {
        vi.stubGlobal("navigator", { ...navigator, mediaDevices: undefined });
        expect(await listAudioDevices("audioinput")).toEqual({ status: "unsupported" });

        fakeMedia(async () => {
            throw new Error("NotAllowedError");
        });
        expect(await listAudioDevices("audioinput")).toEqual({ status: "unsupported" });

        canChooseSpeaker(false);
        fakeMedia([device("audiooutput", "hp", "Headphones")]);
        expect(await listAudioDevices("audiooutput")).toEqual({ status: "unsupported" });
    });

    it("asks for the microphone only to learn the names, and closes it at once", async () => {
        const stop = vi.fn();
        fakeMedia([]);
        (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockResolvedValue({ getTracks: () => [{ stop }] });
        expect(await requestMicrophoneAccess()).toBe(true);
        expect(stop).toHaveBeenCalled();

        (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("NotAllowedError"));
        expect(await requestMicrophoneAccess()).toBe(false);
    });
});

describe("the chosen devices", () => {
    it("are kept on this device across a restart", () => {
        const settings = loadUserLocalSettings();
        saveUserLocalSettings({ ...settings, audio: { ...settings.audio, preferredAudioInputId: "usb", preferredAudioOutputId: "hp" } });
        const again = loadUserLocalSettings();
        expect(again.audio.preferredAudioInputId).toBe("usb");
        expect(again.audio.preferredAudioOutputId).toBe("hp");
    });
});
