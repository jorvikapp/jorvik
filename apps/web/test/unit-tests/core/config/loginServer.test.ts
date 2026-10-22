import { describe, expect, it, vi } from "vitest";

import {
    clearLoginServer,
    LoginServerError,
    readLoginServer,
    resolveLoginServer,
    saveLoginServer,
    serverLabel,
} from "../../../../src/core/config/loginServer";

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fakeFetch(routes: Record<string, Response | Error>): typeof fetch {
    return vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const answer = routes[url];
        if (answer instanceof Error) {
            throw answer;
        }
        return answer ?? new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
}

describe("resolveLoginServer", () => {
    it("follows a server name's .well-known to its client API", async () => {
        const fetchImpl = fakeFetch({
            "https://matrix.org/.well-known/matrix/client": json({ "m.homeserver": { base_url: "https://matrix-client.matrix.org/" } }),
            "https://matrix-client.matrix.org/_matrix/client/versions": json({ versions: ["v1.11"] }),
        });
        await expect(resolveLoginServer(" Matrix.org ", fetchImpl)).resolves.toEqual({
            baseUrl: "https://matrix-client.matrix.org",
            serverName: "matrix.org",
        });
    });

    it("uses the name itself when it has no .well-known", async () => {
        const fetchImpl = fakeFetch({
            "https://example.org/_matrix/client/versions": json({ versions: ["v1.11"] }),
        });
        await expect(resolveLoginServer("example.org", fetchImpl)).resolves.toEqual({
            baseUrl: "https://example.org",
            serverName: "example.org",
        });
    });

    it("takes an address typed in full as it is", async () => {
        const fetchImpl = fakeFetch({
            "http://127.0.0.1:8008/_matrix/client/versions": json({ versions: ["v1.11"] }),
        });
        await expect(resolveLoginServer("http://127.0.0.1:8008/", fetchImpl)).resolves.toEqual({
            baseUrl: "http://127.0.0.1:8008",
            serverName: "127.0.0.1:8008",
        });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("refuses what isn't a server name", async () => {
        await expect(resolveLoginServer("not a server", fakeFetch({}))).rejects.toThrow("That isn't a server name");
        await expect(resolveLoginServer("   ", fakeFetch({}))).rejects.toThrow("Enter a server");
        await expect(resolveLoginServer("ftp://example.org", fakeFetch({}))).rejects.toThrow("https://");
    });

    it("says so when the server can't be reached", async () => {
        const fetchImpl = fakeFetch({
            "https://down.example/_matrix/client/versions": new TypeError("Failed to fetch"),
        });
        await expect(resolveLoginServer("down.example", fetchImpl)).rejects.toThrow("Couldn't reach down.example");
    });

    it("says so when the server isn't a Matrix server", async () => {
        const fetchImpl = fakeFetch({
            "https://website.example/_matrix/client/versions": new Response("<html></html>", { status: 200 }),
        });
        const failure = resolveLoginServer("website.example", fetchImpl);
        await expect(failure).rejects.toBeInstanceOf(LoginServerError);
        await expect(failure).rejects.toThrow("doesn't answer like a Matrix server");
    });
});

describe("the chosen server", () => {
    it("stays on this device until it is cleared", () => {
        expect(readLoginServer()).toBeNull();
        saveLoginServer({ baseUrl: "https://matrix-client.matrix.org", serverName: "matrix.org" });
        expect(readLoginServer()).toEqual({ baseUrl: "https://matrix-client.matrix.org", serverName: "matrix.org" });
        clearLoginServer();
        expect(readLoginServer()).toBeNull();
    });

    it("ignores something unreadable in storage", () => {
        localStorage.setItem("jorvik_login_server", "{nope");
        expect(readLoginServer()).toBeNull();
    });

    it("shows a server by its host", () => {
        expect(serverLabel("https://matrix.jorvik.app")).toBe("matrix.jorvik.app");
        expect(serverLabel("http://127.0.0.1:18008/")).toBe("127.0.0.1:18008");
    });
});
