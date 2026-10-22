import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoginView } from "../../../../src/ui/components/LoginView";

const DEFAULT = "https://matrix.jorvik.app";
let container: HTMLDivElement;
let root: Root;
let onLogin: ReturnType<typeof vi.fn>;

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    onLogin = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url === "https://example.org/.well-known/matrix/client") {
                return new Response(JSON.stringify({ "m.homeserver": { base_url: "https://matrix.example.org" } }), { status: 200 });
            }
            if (url === "https://matrix.example.org/_matrix/client/versions") {
                return new Response(JSON.stringify({ versions: ["v1.11"] }), { status: 200 });
            }
            return new Response("not found", { status: 404 });
        }),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
});

async function render(disableHomeserverInput = false, error: string | null = null, key = String(Math.random())): Promise<void> {
    await act(async () => {
        root.render(
            <LoginView
                key={key}
                defaultHomeserver={DEFAULT}
                disableHomeserverInput={disableHomeserverInput}
                loading={false}
                error={error}
                onLogin={onLogin}
                onLoginWithCredentials={async () => undefined}
            />,
        );
    });
}

function setInput(input: HTMLInputElement, value: string): void {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonNamed(text: string): HTMLButtonElement | undefined {
    return Array.from(document.body.querySelectorAll("button")).find((button) => button.textContent?.trim() === text);
}

async function signIn(): Promise<void> {
    await act(async () => {
        setInput(container.querySelector('input[placeholder="alice"]') as HTMLInputElement, "alice");
        setInput(container.querySelector('input[placeholder="********"]') as HTMLInputElement, "secret");
    });
    await act(async () => {
        (container.querySelector("form") as HTMLFormElement).requestSubmit();
    });
}

async function pickServer(value: string): Promise<void> {
    await act(async () => {
        (container.querySelector('button[aria-label="Server settings"]') as HTMLButtonElement).click();
    });
    await act(async () => {
        setInput(document.body.querySelector(".server-settings-dialog input") as HTMLInputElement, value);
    });
    await act(async () => {
        buttonNamed("Save")?.click();
    });
}

describe("LoginView server settings", () => {
    it("signs in to the default server until another is picked", async () => {
        await render();
        expect(container.querySelector(".login-server-hint")).toBeNull();
        await signIn();
        expect(onLogin).toHaveBeenCalledWith(DEFAULT, "alice", "secret");
    });

    it("uses a server picked in its settings, and keeps it for next time", async () => {
        await render();
        await pickServer("example.org");

        expect(document.body.querySelector(".server-settings-dialog")).toBeNull();
        expect(container.querySelector(".login-server-hint")?.textContent).toBe("Server: example.org");
        await signIn();
        expect(onLogin).toHaveBeenLastCalledWith("https://matrix.example.org", "alice", "secret");

        await render();
        expect(container.querySelector(".login-server-hint")?.textContent).toBe("Server: example.org");
        await signIn();
        expect(onLogin).toHaveBeenLastCalledWith("https://matrix.example.org", "alice", "secret");
    });

    it("goes back to the default server", async () => {
        await render();
        await pickServer("example.org");
        await act(async () => {
            (container.querySelector('button[aria-label="Server settings"]') as HTMLButtonElement).click();
        });
        await act(async () => {
            buttonNamed("Use matrix.jorvik.app")?.click();
        });

        expect(container.querySelector(".login-server-hint")).toBeNull();
        await signIn();
        expect(onLogin).toHaveBeenLastCalledWith(DEFAULT, "alice", "secret");
    });

    it("keeps the dialog open and explains when a server can't be used", async () => {
        await render();
        await pickServer("nowhere.example");

        expect(document.body.querySelector(".server-settings-dialog")?.textContent).toContain("doesn't answer like a Matrix server");
        expect(container.querySelector(".login-server-hint")).toBeNull();
    });

    it("drops the old server's error once another server is picked", async () => {
        await render(false, "Couldn't reach the server. Check your connection and try again.", "same");
        expect(container.textContent).toContain("Couldn't reach the server");
        await pickServer("example.org");
        await render(false, "Couldn't reach the server. Check your connection and try again.", "same");
        expect(container.textContent).not.toContain("Couldn't reach the server");
    });

    it("offers no server choice where config.json turns custom servers off", async () => {
        localStorage.setItem("jorvik_login_server", JSON.stringify({ baseUrl: "https://matrix.example.org", serverName: "example.org" }));
        await render(true);

        expect(container.querySelector('button[aria-label="Server settings"]')).toBeNull();
        await signIn();
        expect(onLogin).toHaveBeenLastCalledWith(DEFAULT, "alice", "secret");
    });
});
