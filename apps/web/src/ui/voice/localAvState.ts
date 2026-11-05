import { useSyncExternalStore } from "react";

/**
 * Your own microphone, sound and camera, shared by everything that shows or changes them: the panel
 * under the channel list, the call's own buttons and the call bar on phones. Change one, and the others
 * follow.
 *
 * Muting the mic and deafening work outside a call too, and carry into the next one: they're kept on
 * this device across restarts. Deafening mutes the mic as well; undeafening puts the mic back the way it
 * was. The camera is only ever on during a call, so it isn't kept.
 */
export interface LocalAvState {
    micMuted: boolean;
    deafened: boolean;
    cameraOn: boolean;
}

interface Saved {
    micMuted: boolean;
    deafened: boolean;
    /** The mic as it was when deafen went on, for when it goes off. */
    micMutedBeforeDeafen: boolean;
}

export const LOCAL_AV_STORAGE_KEY = "heorot.voice.localAv";

const DEFAULT_SAVED: Saved = { micMuted: false, deafened: false, micMutedBeforeDeafen: false };

function readSaved(): Saved {
    try {
        const raw = window.localStorage.getItem(LOCAL_AV_STORAGE_KEY);
        if (!raw) {
            return DEFAULT_SAVED;
        }
        const parsed = JSON.parse(raw) as Partial<Record<keyof Saved, unknown>>;
        const deafened = parsed.deafened === true;
        return {
            // Deafened means the mic is muted, whatever was saved.
            micMuted: deafened || parsed.micMuted === true,
            deafened,
            micMutedBeforeDeafen: parsed.micMutedBeforeDeafen === true,
        };
    } catch {
        return DEFAULT_SAVED;
    }
}

let saved: Saved = readSaved();
let state: LocalAvState = { micMuted: saved.micMuted, deafened: saved.deafened, cameraOn: false };
const listeners = new Set<() => void>();

function commit(next: LocalAvState, nextSaved: Saved = saved): void {
    const savedChanged =
        nextSaved.micMuted !== saved.micMuted ||
        nextSaved.deafened !== saved.deafened ||
        nextSaved.micMutedBeforeDeafen !== saved.micMutedBeforeDeafen;
    saved = nextSaved;
    if (savedChanged) {
        try {
            window.localStorage.setItem(LOCAL_AV_STORAGE_KEY, JSON.stringify(saved));
        } catch {
            // Private browsing or a full disk: it still works until the app closes.
        }
    }
    if (next.micMuted === state.micMuted && next.deafened === state.deafened && next.cameraOn === state.cameraOn) {
        return;
    }
    state = next;
    for (const listener of [...listeners]) {
        listener();
    }
}

export function getLocalAvState(): LocalAvState {
    return state;
}

export function subscribeLocalAvState(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Turning the mic on while deafened ends deafen too: you can't talk without hearing. */
export function setMicMuted(muted: boolean): void {
    if (!muted && state.deafened) {
        commit({ ...state, micMuted: false, deafened: false }, { micMuted: false, deafened: false, micMutedBeforeDeafen: false });
        return;
    }
    commit({ ...state, micMuted: muted }, { ...saved, micMuted: muted });
}

export function toggleMicMuted(): void {
    setMicMuted(!state.micMuted);
}

/** Deafening mutes the mic as well; undeafening puts it back the way it was before. */
export function setDeafened(deafened: boolean): void {
    if (deafened === state.deafened) {
        return;
    }
    if (deafened) {
        commit(
            { ...state, deafened: true, micMuted: true },
            { micMuted: true, deafened: true, micMutedBeforeDeafen: state.micMuted },
        );
        return;
    }
    const micMuted = saved.micMutedBeforeDeafen;
    commit({ ...state, deafened: false, micMuted }, { micMuted, deafened: false, micMutedBeforeDeafen: false });
}

export function toggleDeafened(): void {
    setDeafened(!state.deafened);
}

/** Set by the call as its camera goes on and off; off whenever there's no call. */
export function setCameraOn(on: boolean): void {
    commit({ ...state, cameraOn: on });
}

/** Another window of the app changed them: follow it. */
function followOtherWindows(event: StorageEvent): void {
    if (event.key !== LOCAL_AV_STORAGE_KEY) {
        return;
    }
    const next = readSaved();
    saved = next;
    commit({ ...state, micMuted: next.micMuted, deafened: next.deafened }, next);
}

if (typeof window !== "undefined") {
    window.addEventListener("storage", followOtherWindows);
}

export function useLocalAvState(): LocalAvState {
    return useSyncExternalStore(subscribeLocalAvState, getLocalAvState, getLocalAvState);
}
