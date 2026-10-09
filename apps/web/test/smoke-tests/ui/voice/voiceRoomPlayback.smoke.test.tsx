import React, { createRef } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AudioSettings } from "../../../../src/ui/settings/user/settingsStore";

type VoiceRoomComponent = typeof import("../../../../src/ui/components/voice/VoiceRoom").VoiceRoom;
type VoiceRoomHandle = import("../../../../src/ui/components/voice/VoiceRoom").VoiceRoomHandle;

interface FakeTrack {
    kind: string;
    sid: string;
    attach: () => HTMLAudioElement;
    detach: (element?: HTMLAudioElement) => HTMLAudioElement[];
}

interface FakePublication {
    kind: string;
    source: string;
    isSubscribed: boolean;
    trackSid: string;
    track: FakeTrack;
    setSubscribed: ReturnType<typeof vi.fn>;
}

function createAudioSettings(): AudioSettings {
    return {
        preferredAudioInputId: "default",
        preferredAudioOutputId: "default",
        preferredVideoInputId: "default",
        micTestLoopbackEnabled: false,
        autoGainControlEnabled: true,
        echoCancellationEnabled: true,
        noiseSuppressionEnabled: true,
        voiceIsolationEnabled: true,
        micProfile: "speech",
    };
}

function createAudioTrack(trackSid: string): FakeTrack {
    return {
        kind: "audio",
        sid: trackSid,
        attach: () => {
            const element = document.createElement("audio");
            return element;
        },
        detach: (element?: HTMLAudioElement) => (element ? [element] : []),
    };
}

interface FakeVideoTrack {
    kind: string;
    sid: string;
    attached: HTMLMediaElement[];
    attach: (element: HTMLMediaElement) => HTMLMediaElement;
    detach: (element?: HTMLMediaElement) => HTMLMediaElement[];
}

function createVideoTrack(trackSid: string): FakeVideoTrack {
    const track: FakeVideoTrack = {
        kind: "video",
        sid: trackSid,
        attached: [],
        attach: (element: HTMLMediaElement) => {
            track.attached.push(element);
            return element;
        },
        detach: (element?: HTMLMediaElement) => {
            track.attached = track.attached.filter((attached) => attached !== element);
            return element ? [element] : [];
        },
    };
    return track;
}

function createAudioPublication(trackSid: string): FakePublication {
    const publication = {
        kind: "audio",
        source: "microphone",
        isSubscribed: false,
        trackSid,
        track: createAudioTrack(trackSid),
        setSubscribed: vi.fn(),
    } as FakePublication;

    publication.setSubscribed = vi.fn((value: boolean) => {
        publication.isSubscribed = value;
    });

    return publication;
}

describe("voice room smoke", () => {
    let container: HTMLDivElement;
    let root: Root;
    let VoiceRoom: VoiceRoomComponent;
    let RoomEvent: Record<string, string>;

    let createdRooms: Array<{ emit: (event: string, ...args: unknown[]) => void }>;
    let seededRemotePublications: Array<{
        participantIdentity: string;
        participantSid: string;
        publication: FakePublication;
    }>;
    let playAttempts: string[];
    let cameraCalls: unknown[][];
    let cameraFailure: Error | null;
    let localCameraTrack: FakeVideoTrack | null;

    beforeEach(async () => {
        vi.resetModules();

        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);

        createdRooms = [];
        seededRemotePublications = [];
        playAttempts = [];
        cameraCalls = [];
        cameraFailure = null;
        localCameraTrack = null;

        Object.defineProperty(HTMLMediaElement.prototype, "play", {
            configurable: true,
            value: vi.fn(function play(this: HTMLMediaElement) {
                playAttempts.push(this.dataset.lkTrackSid ?? "unknown");
                return Promise.resolve();
            }),
        });

        vi.doMock("livekit-client", () => {
            const ConnectionState = {
                Disconnected: "disconnected",
                Connecting: "connecting",
                Connected: "connected",
                Reconnecting: "reconnecting",
            };

            const RoomEvent = {
                ConnectionStateChanged: "ConnectionStateChanged",
                ActiveSpeakersChanged: "ActiveSpeakersChanged",
                ParticipantConnected: "ParticipantConnected",
                ParticipantDisconnected: "ParticipantDisconnected",
                TrackPublished: "TrackPublished",
                TrackSubscribed: "TrackSubscribed",
                TrackUnsubscribed: "TrackUnsubscribed",
                TrackSubscriptionFailed: "TrackSubscriptionFailed",
                LocalAudioSilenceDetected: "LocalAudioSilenceDetected",
                LocalTrackPublished: "LocalTrackPublished",
                LocalTrackUnpublished: "LocalTrackUnpublished",
                TrackMuted: "TrackMuted",
                TrackUnmuted: "TrackUnmuted",
                Disconnected: "Disconnected",
                MediaDevicesChanged: "MediaDevicesChanged",
                MediaDevicesError: "MediaDevicesError",
                AudioPlaybackStatusChanged: "AudioPlaybackStatusChanged",
            };

            const Track = {
                Kind: {
                    Audio: "audio",
                    Video: "video",
                },
                Source: {
                    Microphone: "microphone",
                    Camera: "camera",
                    ScreenShare: "screen_share",
                    ScreenShareAudio: "screen_share_audio",
                },
            };

            class Room {
                public static async getLocalDevices(): Promise<MediaDeviceInfo[]> {
                    return [];
                }

                public readonly remoteParticipants = new Map<string, any>();
                public readonly localParticipant: any;
                public activeSpeakers: unknown[] = [];
                public canPlaybackAudio = true;
                public state = ConnectionState.Disconnected;

                private readonly handlers = new Map<string, Set<(...args: unknown[]) => void>>();

                public constructor() {
                    this.localParticipant = {
                        identity: "@self:example.org::local",
                        sid: "local-sid",
                        isSpeaking: false,
                        audioLevel: 0,
                        trackPublications: new Map<string, any>(),
                        getTrackPublication: (source: string) => this.localParticipant.trackPublications.get(source),
                        setMicrophoneEnabled: async (enabled: boolean) => {
                            if (!enabled) {
                                this.localParticipant.trackPublications.delete(Track.Source.Microphone);
                                return;
                            }
                            this.localParticipant.trackPublications.set(Track.Source.Microphone, {
                                kind: Track.Kind.Audio,
                                source: Track.Source.Microphone,
                                track: {
                                    mediaStreamTrack: {
                                        getSettings: () => ({
                                            echoCancellation: true,
                                            noiseSuppression: true,
                                            autoGainControl: true,
                                            voiceIsolation: true,
                                        }),
                                    },
                                },
                            });
                        },
                        setScreenShareEnabled: async () => undefined,
                        // Like LiveKit: turning the camera off mutes its publication.
                        setCameraEnabled: async (enabled: boolean, ...rest: unknown[]) => {
                            cameraCalls.push([enabled, ...rest]);
                            if (cameraFailure) {
                                throw cameraFailure;
                            }
                            const existing = this.localParticipant.trackPublications.get(Track.Source.Camera);
                            if (existing) {
                                existing.isMuted = !enabled;
                                return existing;
                            }
                            localCameraTrack = createVideoTrack("cam-self");
                            const publication = { kind: "video", source: Track.Source.Camera, isMuted: !enabled, track: localCameraTrack };
                            this.localParticipant.trackPublications.set(Track.Source.Camera, publication);
                            return publication;
                        },
                    };

                    for (const seed of seededRemotePublications) {
                        const participant = {
                            identity: seed.participantIdentity,
                            sid: seed.participantSid,
                            isSpeaking: false,
                            audioLevel: 0,
                            trackPublications: new Map<string, FakePublication>([[seed.publication.trackSid, seed.publication]]),
                            getTrackPublication: (source: string) => {
                                for (const publication of participant.trackPublications.values()) {
                                    if (publication.source === source) {
                                        return publication;
                                    }
                                }
                                return undefined;
                            },
                        };
                        this.remoteParticipants.set(seed.participantSid, participant);
                    }

                    createdRooms.push(this);
                }

                public on(event: string, handler: (...args: unknown[]) => void): this {
                    const set = this.handlers.get(event) ?? new Set();
                    set.add(handler);
                    this.handlers.set(event, set);
                    return this;
                }

                public emit(event: string, ...args: unknown[]): void {
                    const handlers = this.handlers.get(event);
                    if (!handlers) {
                        return;
                    }
                    for (const handler of handlers) {
                        handler(...args);
                    }
                }

                public async connect(): Promise<void> {
                    this.state = ConnectionState.Connected;
                    this.emit(RoomEvent.ConnectionStateChanged, ConnectionState.Connected);
                }

                public async startAudio(): Promise<void> {
                    this.canPlaybackAudio = true;
                }

                public async switchActiveDevice(): Promise<void> {
                    return;
                }

                public async disconnect(): Promise<void> {
                    this.state = ConnectionState.Disconnected;
                    this.emit(RoomEvent.Disconnected);
                }
            }

            return {
                Room,
                RoomEvent,
                ConnectionState,
                Track,
                AudioPresets: {
                    speech: "speech",
                    music: "music",
                },
                VideoPresets: {
                    h180: { resolution: { width: 320, height: 180 } },
                    h360: { resolution: { width: 640, height: 360 } },
                    h720: { resolution: { width: 1280, height: 720 }, encoding: { maxBitrate: 1_700_000, maxFramerate: 30 } },
                    h1080: { resolution: { width: 1920, height: 1080 } },
                    h1440: { resolution: { width: 2560, height: 1440 } },
                },
            };
        });

        vi.doMock("../../../../src/ui/adapters/voiceAdapter", () => ({
            fetchLiveKitToken: vi.fn(async () => ({
                token: "token",
                wsUrl: "wss://livekit.example/ws",
                livekitRoom: "voice-room",
                expiresAt: "2026-01-01T00:00:00.000Z",
            })),
            updateVoiceParticipantState: vi.fn(async () => undefined),
        }));

        vi.doMock("../../../../src/ui/providers/MatrixProvider", () => ({
            useMatrix: () => ({ config: null }),
        }));

        vi.doMock("../../../../src/ui/notifications/sound", () => ({
            playVoiceJoinSound: vi.fn(async () => undefined),
            playVoiceLeaveSound: vi.fn(async () => undefined),
            playParticipantJoinSound: vi.fn(async () => undefined),
            playParticipantLeaveSound: vi.fn(async () => undefined),
            playScreenShareStartSound: vi.fn(async () => undefined),
            playScreenShareStopSound: vi.fn(async () => undefined),
        }));

        vi.doMock("../../../../src/ui/components/Avatar", () => ({
            Avatar: ({ name, src }: { name?: string; src?: string | null }) =>
                React.createElement("div", { "data-avatar": "1", "data-src": src ?? "" }, name ?? ""),
        }));

        vi.doMock("../../../../src/ui/components/rooms/RoomDialog", () => ({
            RoomDialog: ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children ?? null),
        }));

        ({ VoiceRoom } = await import("../../../../src/ui/components/voice/VoiceRoom"));
        ({ RoomEvent } = await import("livekit-client"));
    });

    afterEach(async () => {
        await act(async () => {
            root.unmount();
        });
        container.remove();
        vi.restoreAllMocks();
    });

    it("subscribes and plays late remote audio tracks after join completes", async () => {
        const initialPublication = createAudioPublication("aud-initial");
        seededRemotePublications.push({
            participantIdentity: "@alice:example.org::device-a",
            participantSid: "remote-a",
            publication: initialPublication,
        });

        const ref = createRef<VoiceRoomHandle>();

        await act(async () => {
            root.render(
                React.createElement(VoiceRoom, {
                    ref,
                    client: {
                        getUserId: () => "@self:example.org",
                        getUser: () => ({ rawDisplayName: "Self" }),
                        mxcUrlToHttp: () => null,
                    },
                    matrixRoomId: "!voice:example.org",
                    matrixRoom: null,
                    audioSettings: createAudioSettings(),
                    onAudioSettingsChange: () => undefined,
                }),
            );
        });

        await act(async () => {
            await ref.current?.join();
        });

        const room = createdRooms[0];
        expect(room).toBeTruthy();
        expect(initialPublication.setSubscribed).toHaveBeenCalledWith(true);

        const latePublication = createAudioPublication("aud-late");

        await act(async () => {
            room.emit(RoomEvent.TrackPublished, latePublication);
        });

        expect(latePublication.setSubscribed).toHaveBeenCalledWith(true);

        await act(async () => {
            room.emit(RoomEvent.TrackSubscribed, latePublication.track, latePublication);
        });

        const attachedSids = Array.from(container.querySelectorAll("audio[data-lk-track-sid]"))
            .map((node) => node.getAttribute("data-lk-track-sid"))
            .filter((value): value is string => typeof value === "string" && value.length > 0);

        expect(attachedSids).toContain("aud-initial");
        expect(attachedSids).toContain("aud-late");
        expect(playAttempts).toContain("aud-late");
    });

    it("shows an avatar on every participant tile, your own included", async () => {
        seededRemotePublications.push({
            participantIdentity: "@alice:example.org::device-a",
            participantSid: "remote-a",
            publication: createAudioPublication("aud-alice"),
        });
        const avatars: Record<string, string> = {
            "@self:example.org": "mxc://example.org/self-avatar",
            "@alice:example.org": "mxc://example.org/alice-avatar",
        };

        const ref = createRef<VoiceRoomHandle>();

        await act(async () => {
            root.render(
                React.createElement(VoiceRoom, {
                    ref,
                    client: {
                        getUserId: () => "@self:example.org",
                        getUser: () => null,
                        mxcUrlToHttp: (mxc: string) => `https://hs.example/${mxc.slice("mxc://".length)}`,
                    },
                    matrixRoomId: "!dm:example.org",
                    matrixRoom: {
                        getMember: (userId: string) => ({
                            userId,
                            rawDisplayName: userId,
                            getMxcAvatarUrl: () => avatars[userId],
                        }),
                    },
                    audioSettings: createAudioSettings(),
                    onAudioSettingsChange: () => undefined,
                }),
            );
        });

        await act(async () => {
            await ref.current?.join();
        });

        const tileAvatars = Array.from(
            container.querySelectorAll(".voice-room-participants-list > li [data-avatar]"),
        ).map((node) => node.getAttribute("data-src"));

        expect(tileAvatars).toEqual([
            "https://hs.example/example.org/self-avatar",
            "https://hs.example/example.org/alice-avatar",
        ]);
    });

    it("names your own tile without the store's (@id) disambiguation", async () => {
        const ref = createRef<VoiceRoomHandle>();

        await act(async () => {
            root.render(
                React.createElement(VoiceRoom, {
                    ref,
                    client: {
                        getUserId: () => "@self:example.org",
                        // What the SDK store leaves on the User after a room
                        // where someone else is also called "Self".
                        getUser: () => ({
                            userId: "@self:example.org",
                            displayName: "Self (@self:example.org)",
                            rawDisplayName: "Self",
                        }),
                        mxcUrlToHttp: () => null,
                    },
                    matrixRoomId: "!dm:example.org",
                    matrixRoom: null,
                    audioSettings: createAudioSettings(),
                    onAudioSettingsChange: () => undefined,
                }),
            );
        });

        await act(async () => {
            await ref.current?.join();
        });

        const ownTileName = container.querySelector(
            ".voice-room-participants-list > li .voice-room-participant-name",
        )?.textContent;

        expect(ownTileName).toBe("Self");
    });

    async function renderJoined(): Promise<ReturnType<typeof createRef<VoiceRoomHandle>>> {
        const ref = createRef<VoiceRoomHandle>();
        await act(async () => {
            root.render(
                React.createElement(VoiceRoom, {
                    ref,
                    client: {
                        getUserId: () => "@self:example.org",
                        getUser: () => ({ rawDisplayName: "Self" }),
                        mxcUrlToHttp: () => null,
                    },
                    matrixRoomId: "!voice:example.org",
                    matrixRoom: null,
                    audioSettings: createAudioSettings(),
                    onAudioSettingsChange: () => undefined,
                }),
            );
        });
        await act(async () => {
            await ref.current?.join();
        });
        return ref;
    }

    async function clickButton(title: string): Promise<void> {
        const button = container.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
        expect(button, title).not.toBeNull();
        await act(async () => {
            button!.click();
        });
    }

    it("turns your camera on at 720p with smaller copies, and shows it mirrored", async () => {
        await renderJoined();
        await clickButton("Turn camera on");

        expect(cameraCalls[0][0]).toBe(true);
        expect(cameraCalls[0][1]).toMatchObject({ resolution: { width: 1280, height: 720 } });
        expect(cameraCalls[0][2]).toMatchObject({ simulcast: true });
        const video = container.querySelector<HTMLVideoElement>(".voice-room-video-grid video.is-mirrored");
        expect(video).not.toBeNull();
        expect(localCameraTrack?.attached).toContain(video);
        // Your tile moved up into the video grid.
        expect(container.querySelectorAll(".voice-room-participants-list > li")).toHaveLength(0);

        await clickButton("Turn camera off");
        expect(cameraCalls[1][0]).toBe(false);
        expect(container.querySelector(".voice-room-video-grid")).toBeNull();
        expect(localCameraTrack?.attached).toHaveLength(0);
    });

    it("shows someone's camera when it arrives, and their picture again when it goes off", async () => {
        seededRemotePublications.push({
            participantIdentity: "@alice:example.org::device-a",
            participantSid: "remote-a",
            publication: createAudioPublication("aud-alice"),
        });
        await renderJoined();
        const room = createdRooms[0] as unknown as {
            emit: (event: string, ...args: unknown[]) => void;
            remoteParticipants: Map<string, { trackPublications: Map<string, unknown> }>;
        };
        const alice = room.remoteParticipants.get("remote-a")!;
        const track = createVideoTrack("cam-alice");
        const publication = { kind: "video", source: "camera", isMuted: false, isSubscribed: true, trackSid: "cam-alice", track };
        alice.trackPublications.set("cam-alice", publication);

        await act(async () => {
            room.emit(RoomEvent.TrackSubscribed, track, publication, alice);
        });
        const video = container.querySelector<HTMLVideoElement>(".voice-room-video-grid video");
        expect(video).not.toBeNull();
        expect(video?.classList.contains("is-mirrored")).toBe(false);
        expect(track.attached).toContain(video);

        publication.isMuted = true;
        await act(async () => {
            room.emit(RoomEvent.TrackMuted, publication, alice);
        });
        expect(container.querySelector(".voice-room-video-grid")).toBeNull();
        expect(container.querySelectorAll(".voice-room-participants-list > li")).toHaveLength(2);
    });

    it("says so when the camera isn't allowed", async () => {
        cameraFailure = Object.assign(new Error("Permission denied"), { name: "NotAllowedError" });
        await renderJoined();
        await clickButton("Turn camera on");

        expect(container.textContent).toContain("isn't allowed to use your camera");
        expect(container.querySelector('button[title="Turn camera on"]')?.getAttribute("aria-pressed")).toBe("false");
        expect(container.querySelector(".voice-room-video-grid")).toBeNull();
    });
});

