import React, { useEffect, useRef } from "react";

import { useAudioDevices, type AudioDeviceKind, type AudioDeviceState } from "../../voice/audioDevices";

export interface DeviceMenuProps {
    kind: AudioDeviceKind;
    /** The device in use: its ID, or "default". */
    selectedId: string;
    onSelect: (deviceId: string) => void;
    onOpenSettings: () => void;
    /** `returnFocus`: closed from the keyboard, so focus goes back to the button that opened it. */
    onClose: (returnFocus: boolean) => void;
}

const TITLES: Record<AudioDeviceKind, string> = { audioinput: "Input device", audiooutput: "Output device" };

function note(kind: AudioDeviceKind, state: AudioDeviceState): string | null {
    const things = kind === "audioinput" ? "microphones" : "speakers";
    switch (state.status) {
        case "loading":
            return "Looking for devices...";
        case "needs-permission":
            return `Allow the microphone to see your ${things}' names.`;
        case "denied":
            return `Microphone access is blocked, so your ${things} can't be listed. You can allow it in your browser or system settings.`;
        case "none":
            return `No ${things} found.`;
        case "unsupported":
            return kind === "audioinput"
                ? "This browser can't list your microphones."
                : "This browser can't choose where sound plays: it uses your system's speaker.";
        case "ready":
            return null;
    }
}

/**
 * The microphones or speakers to choose from, above the panel. Choosing one only changes the device:
 * mute and deafen stay as they are.
 */
export function DeviceMenu({ kind, selectedId, onSelect, onOpenSettings, onClose }: DeviceMenuProps): React.ReactElement {
    const { state, requestAccess } = useAudioDevices(kind, true);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const selected = selectedId || "default";

    useEffect(() => {
        const onPointerDown = (event: MouseEvent): void => {
            const target = event.target as Node | null;
            if (target && !menuRef.current?.contains(target)) {
                onClose(false);
            }
        };
        window.addEventListener("mousedown", onPointerDown);
        return () => window.removeEventListener("mousedown", onPointerDown);
    }, [onClose]);

    // Focus lands on the device in use (or the first choice), so the keyboard can carry on from there.
    useEffect(() => {
        const menu = menuRef.current;
        // Not before the list is there: focus would land on the settings link and stay.
        if (!menu || state.status === "loading" || menu.contains(document.activeElement)) {
            return;
        }
        const target =
            menu.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]') ??
            menu.querySelector<HTMLButtonElement>('[role^="menuitem"]');
        target?.focus();
    }, [state]);

    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose(true);
            return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") {
            return;
        }
        const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? [])];
        if (items.length === 0) {
            return;
        }
        event.preventDefault();
        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        const next =
            event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : (at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next].focus();
    };

    const message = note(kind, state);
    return (
        <div className="device-menu" role="menu" aria-label={TITLES[kind]} ref={menuRef} onKeyDown={onKeyDown}>
            <div className="device-menu-title" role="presentation">
                {TITLES[kind]}
            </div>
            {state.status === "ready"
                ? state.devices.map((device) => (
                      <button
                          key={device.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={device.id === selected}
                          className="device-menu-item"
                          title={device.label}
                          onClick={() => {
                              onSelect(device.id);
                              onClose(true);
                          }}
                      >
                          <span className="device-menu-check" aria-hidden="true">
                              {device.id === selected ? "✓" : ""}
                          </span>
                          <span className="device-menu-label">{device.label}</span>
                      </button>
                  ))
                : null}
            {message ? (
                <p className="device-menu-note" role="presentation">
                    {message}
                </p>
            ) : null}
            {state.status === "needs-permission" ? (
                <button type="button" role="menuitem" className="device-menu-item" onClick={() => void requestAccess()}>
                    <span className="device-menu-check" aria-hidden="true" />
                    <span className="device-menu-label">Allow the microphone</span>
                </button>
            ) : null}
            <div className="device-menu-separator" role="separator" />
            <button
                type="button"
                role="menuitem"
                className="device-menu-item"
                onClick={() => {
                    onOpenSettings();
                    onClose(false);
                }}
            >
                <span className="device-menu-check" aria-hidden="true" />
                <span className="device-menu-label">Voice and video settings</span>
            </button>
        </div>
    );
}
