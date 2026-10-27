// The one-time local address single sign-on comes back to (electron/sso.ts), from the compiled dist/electron/sso.js:
// npm test builds it first.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { beginSso, waitForSso, cancelSso } = require("../dist/electron/sso.js");

function get(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const request = http.get(url, { headers }, (response) => {
            let body = "";
            response.on("data", (chunk) => (body += chunk));
            response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
        });
        request.on("error", reject);
    });
}

test("takes the token that comes back with the state, once, then closes", async () => {
    let arrived = 0;
    const redirect = await beginSso(() => arrived++);
    const url = new URL(redirect);
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.pathname, "/jorvik");
    assert.match(url.searchParams.get("state"), /^[0-9a-f]{32}$/);

    const back = new URL(redirect);
    back.searchParams.set("loginToken", "syl_token123");
    const answer = await get(back.toString());
    assert.equal(answer.status, 200);
    assert.match(answer.body, /You're signed in/);
    assert.equal(answer.headers["cache-control"], "no-store");
    assert.equal(answer.headers["referrer-policy"], "no-referrer");
    assert.deepEqual(await waitForSso(), { loginToken: "syl_token123" });
    assert.equal(arrived, 1);
    // Closed: a second visit finds nothing listening.
    await assert.rejects(get(back.toString()), /ECONNREFUSED|ECONNRESET/);
});

test("ignores a wrong state, another path, another Host, and keeps waiting", async () => {
    const redirect = await beginSso(() => undefined);
    const url = new URL(redirect);
    const wrongState = new URL(redirect);
    wrongState.searchParams.set("state", "0".repeat(32));
    wrongState.searchParams.set("loginToken", "planted");
    assert.equal((await get(wrongState.toString())).status, 400);

    const otherPath = new URL(redirect);
    otherPath.pathname = "/favicon.ico";
    assert.equal((await get(otherPath.toString())).status, 404);

    const rebound = new URL(redirect);
    rebound.searchParams.set("loginToken", "via-rebinding");
    assert.equal((await get(rebound.toString(), { Host: `evil.example:${url.port}` })).status, 404);

    const noToken = await get(redirect);
    assert.equal(noToken.status, 400);
    assert.match(noToken.body, /didn't send a sign-in token/);

    // Still waiting for the real one.
    const pending = waitForSso();
    const real = new URL(redirect);
    real.searchParams.set("loginToken", "real");
    assert.equal((await get(real.toString())).status, 200);
    assert.deepEqual(await pending, { loginToken: "real" });
});

test("cancel ends the wait and closes the address; a new start replaces the old one", async () => {
    const first = await beginSso(() => undefined);
    const firstWait = waitForSso();
    const second = await beginSso(() => undefined);
    assert.deepEqual(await firstWait, { cancelled: true });
    assert.notEqual(new URL(first).port + new URL(first).search, new URL(second).port + new URL(second).search);
    await assert.rejects(get(first), /ECONNREFUSED|ECONNRESET/);

    const secondWait = waitForSso();
    cancelSso();
    assert.deepEqual(await secondWait, { cancelled: true });
    await assert.rejects(get(second), /ECONNREFUSED|ECONNRESET/);
});

test("only listens on 127.0.0.1", async () => {
    const redirect = await beginSso(() => undefined);
    const port = new URL(redirect).port;
    const { networkInterfaces } = await import("node:os");
    const external = Object.values(networkInterfaces()).flat().find((address) => address && address.family === "IPv4" && !address.internal);
    if (external) {
        await assert.rejects(get(`http://${external.address}:${port}/jorvik`), /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH/);
    }
    cancelSso();
});
