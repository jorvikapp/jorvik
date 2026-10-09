// End-to-end encryption for calls. LiveKit encrypts every audio and video frame in
// the browser; the keys never reach the call server. Each participant makes a random
// key of its own and sends it, Olm-encrypted, straight to the Matrix device of every
// other participant; a key is only used if it arrived encrypted from the very device
// its sender joined with. When someone leaves, everyone makes a new key, so whatever
// follows can't be decrypted with what the leaver had. Calls are encrypted when their
// Matrix room is: its members' devices are then known to the crypto store.
import { ClientEvent, type MatrixClient } from "matrix-js-sdk/src/matrix";
import type { ReceivedToDeviceMessage } from "matrix-js-sdk/src/sync-accumulator";
import {
    BaseKeyProvider,
    RoomEvent,
    createKeyMaterialFromBuffer,
    type RemoteParticipant,
    type Room,
} from "livekit-client";

export const CALL_KEY_EVENT_TYPE = "org.jorvik.call.encryption_key";
export const CALL_KEYRING_SIZE = 256;
const KEY_BYTES = 32;
// A rotated key is sent first and used after this, so the others have it by then.
const USE_NEW_KEY_AFTER_MS = 2_000;
// Several people leaving at once give one new key.
const ROTATE_AFTER_LEAVE_MS = 1_000;
// A key is sent again at these times, for anyone whose devices were not known yet.
const RESEND_AFTER_MS = [5_000, 15_000];

export interface CallIdentity {
    userId: string;
    deviceId: string;
}

/** "@user:server::DEVICE::abcd1234" (as the voice relay names participants) into user and device. */
export function parseCallIdentity(identity: string): CallIdentity | null {
    const parts = identity.split("::");
    if (parts.length !== 3) {
        return null;
    }
    const [userId, deviceId] = parts;
    if (!userId.startsWith("@") || !userId.includes(":") || deviceId.length === 0) {
        return null;
    }
    return { userId, deviceId };
}

export interface CallKeyContent {
    room_id: string;
    /** The sender's LiveKit identity, whose media this key decrypts. */
    identity: string;
    index: number;
    /** Base64. */
    key: string;
    sent_ts: number;
}

export interface ReceivedCallKey {
    identity: string;
    index: number;
    key: Uint8Array;
}

function base64FromBytes(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

function bytesFromBase64(value: unknown): Uint8Array | null {
    if (typeof value !== "string" || value.length === 0 || value.length > 128) {
        return null;
    }
    try {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        return bytes;
    } catch {
        return null;
    }
}

/**
 * A call key from a to-device message, or null unless it is one for this room that came
 * Olm-encrypted from the device its identity names. A key sent in clear could have been
 * written by anyone, the server included.
 */
export function readCallKeyMessage(payload: ReceivedToDeviceMessage, matrixRoomId: string): ReceivedCallKey | null {
    const { message, encryptionInfo } = payload;
    if (message.type !== CALL_KEY_EVENT_TYPE || !encryptionInfo) {
        return null;
    }
    const content = (message.content ?? {}) as Partial<CallKeyContent>;
    if (content.room_id !== matrixRoomId || typeof content.identity !== "string") {
        return null;
    }
    const identity = parseCallIdentity(content.identity);
    if (!identity || encryptionInfo.sender !== identity.userId || encryptionInfo.senderDevice !== identity.deviceId) {
        return null;
    }
    const index = content.index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= CALL_KEYRING_SIZE) {
        return null;
    }
    const key = bytesFromBase64(content.key);
    if (!key || key.length < 16 || key.length > 64) {
        return null;
    }
    return { identity: content.identity, index, key };
}

function randomKey(): Uint8Array {
    const key = new Uint8Array(KEY_BYTES);
    crypto.getRandomValues(key);
    return key;
}

/** Keys per participant, set from raw key bytes. */
export class CallKeyProvider extends BaseKeyProvider {
    public constructor() {
        super({ sharedKey: false, ratchetWindowSize: 0, keyringSize: CALL_KEYRING_SIZE });
    }

    public async setKey(identity: string, index: number, key: Uint8Array): Promise<void> {
        const material = await createKeyMaterialFromBuffer(key.slice().buffer);
        this.onSetEncryptionKey(material, identity, index);
    }
}

interface PendingKey {
    key: Uint8Array;
    index: number;
}

/** Hands out this device's call key and takes in everyone else's, for one connection to a call. */
export class CallKeyManager {
    private ownKey: Uint8Array = randomKey();
    private ownIndex = 0;
    private pending: PendingKey | null = null;
    private rotateTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly timers = new Set<ReturnType<typeof setTimeout>>();
    private stopped = false;

    public constructor(
        private readonly client: MatrixClient,
        private readonly matrixRoomId: string,
        private readonly room: Room,
        private readonly keyProvider: CallKeyProvider,
        private readonly callbacks: {
            onKeyReceived?: (identity: string) => void;
            onError?: (error: unknown) => void;
        } = {},
    ) {}

    /** Call once connected, so the participants already there get the key. */
    public async start(): Promise<void> {
        this.client.on(ClientEvent.ReceivedToDeviceMessage, this.onToDeviceMessage);
        this.room.on(RoomEvent.ParticipantConnected, this.onParticipantConnected);
        this.room.on(RoomEvent.ParticipantDisconnected, this.onParticipantDisconnected);
        await this.keyProvider.setKey(this.localIdentity, this.ownIndex, this.ownKey);
        this.prepareEncryption();
        // Not waited for: the call goes ahead while the keys go out, and they go again shortly.
        const sendToEveryone = (): Promise<void> =>
            this.send([...this.room.remoteParticipants.values()], this.ownKey, this.ownIndex);
        void sendToEveryone().catch((error) => this.callbacks.onError?.(error));
        for (const delayMs of RESEND_AFTER_MS) {
            this.later(delayMs, sendToEveryone);
        }
    }

    public stop(): void {
        this.stopped = true;
        this.client.off(ClientEvent.ReceivedToDeviceMessage, this.onToDeviceMessage);
        this.room.off(RoomEvent.ParticipantConnected, this.onParticipantConnected);
        this.room.off(RoomEvent.ParticipantDisconnected, this.onParticipantDisconnected);
        if (this.rotateTimer) {
            clearTimeout(this.rotateTimer);
        }
        for (const timer of this.timers) {
            clearTimeout(timer);
        }
        this.timers.clear();
    }

    private get localIdentity(): string {
        return this.room.localParticipant.identity;
    }

    // Keys only reach devices the crypto layer knows about. Until a room's members are all
    // loaded it may not know everyone's, so have it load them and fetch their devices.
    private prepareEncryption(): void {
        const matrixRoom = this.client.getRoom(this.matrixRoomId);
        if (matrixRoom) {
            this.client.getCrypto()?.prepareToEncrypt(matrixRoom);
        }
    }

    private later(delayMs: number, task: () => Promise<void>): void {
        const timer = setTimeout(() => {
            this.timers.delete(timer);
            if (!this.stopped) {
                void task().catch((error) => this.callbacks.onError?.(error));
            }
        }, delayMs);
        this.timers.add(timer);
    }

    private async send(participants: RemoteParticipant[], key: Uint8Array, index: number): Promise<void> {
        const own = parseCallIdentity(this.localIdentity);
        const targets = new Map<string, CallIdentity>();
        for (const participant of participants) {
            const target = parseCallIdentity(participant.identity);
            if (!target || (own && target.userId === own.userId && target.deviceId === own.deviceId)) {
                continue;
            }
            targets.set(`${target.userId}|${target.deviceId}`, target);
        }
        if (targets.size === 0 || this.stopped) {
            return;
        }
        const content: CallKeyContent = {
            room_id: this.matrixRoomId,
            identity: this.localIdentity,
            index,
            key: base64FromBytes(key),
            sent_ts: Date.now(),
        };
        await this.client.encryptAndSendToDevice(CALL_KEY_EVENT_TYPE, [...targets.values()], content);
    }

    private readonly onParticipantConnected = (participant: RemoteParticipant): void => {
        const sendCurrent = async (): Promise<void> => {
            await this.send([participant], this.ownKey, this.ownIndex);
            // A key about to replace this one goes along, so they don't miss the switch.
            if (this.pending) {
                await this.send([participant], this.pending.key, this.pending.index);
            }
        };
        this.prepareEncryption();
        void sendCurrent().catch((error) => this.callbacks.onError?.(error));
        for (const delayMs of RESEND_AFTER_MS) {
            this.later(delayMs, sendCurrent);
        }
    };

    private readonly onParticipantDisconnected = (): void => {
        if (this.rotateTimer) {
            clearTimeout(this.rotateTimer);
        }
        this.rotateTimer = setTimeout(() => {
            this.rotateTimer = null;
            if (!this.stopped) {
                void this.rotate().catch((error) => this.callbacks.onError?.(error));
            }
        }, ROTATE_AFTER_LEAVE_MS);
    };

    private async rotate(): Promise<void> {
        const next: PendingKey = { key: randomKey(), index: (this.ownIndex + 1) % CALL_KEYRING_SIZE };
        this.pending = next;
        await this.send([...this.room.remoteParticipants.values()], next.key, next.index);
        this.later(USE_NEW_KEY_AFTER_MS, async () => {
            if (this.pending !== next) {
                return;
            }
            this.ownKey = next.key;
            this.ownIndex = next.index;
            this.pending = null;
            await this.keyProvider.setKey(this.localIdentity, next.index, next.key);
        });
    }

    private readonly onToDeviceMessage = (payload: ReceivedToDeviceMessage): void => {
        const received = readCallKeyMessage(payload, this.matrixRoomId);
        if (!received || received.identity === this.localIdentity) {
            return;
        }
        void this.keyProvider
            .setKey(received.identity, received.index, received.key)
            .then(() => this.callbacks.onKeyReceived?.(received.identity))
            .catch((error) => this.callbacks.onError?.(error));
    };
}
