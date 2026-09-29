import { describe, expect, it, vi } from "vitest";

import { isUserOnOwnServer, reportMessage, reportUser, serverNameOf } from "../../../../src/core/moderation/reports";

function makeClient() {
    return { getDomain: () => "jorvik.example", http: { authedRequest: vi.fn(async () => ({})) } };
}

describe("reports", () => {
    it("reports a user and a message on the right endpoints", async () => {
        const client = makeClient();
        await reportUser(client as never, "@bad:jorvik.example", "spam");
        await reportMessage(client as never, "!room:jorvik.example", "$event", "harassment");
        expect(client.http.authedRequest.mock.calls).toEqual([
            ["POST", "/users/%40bad%3Ajorvik.example/report", undefined, { reason: "spam" }],
            ["POST", "/rooms/!room%3Ajorvik.example/report/%24event", undefined, { reason: "harassment" }],
        ]);
    });

    it("knows which users its server keeps reports about", () => {
        const client = makeClient();
        expect(isUserOnOwnServer(client as never, "@a:jorvik.example")).toBe(true);
        expect(isUserOnOwnServer(client as never, "@a:matrix.org")).toBe(false);
        expect(isUserOnOwnServer(client as never, "@a:jorvik.example.evil")).toBe(false);
        expect(serverNameOf("@a:host:8448")).toBe("host:8448");
    });
});
