import { MatrixError } from "matrix-js-sdk/src/matrix";
import { beforeEach, describe, expect, it } from "vitest";

import {
    describeDirectoryError,
    forgetServer,
    isValidDirectoryServer,
    loadRememberedServers,
    normalizeDirectoryServer,
    rememberServer,
} from "../../../../src/core/directory/directoryServers";

describe("normalizeDirectoryServer", () => {
    it("accepts a bare server name", () => {
        expect(normalizeDirectoryServer("  Matrix.ORG ")).toBe("matrix.org");
    });

    it("strips a pasted URL down to the host", () => {
        expect(normalizeDirectoryServer("https://matrix.org/#/welcome")).toBe("matrix.org");
    });

    it("keeps an explicit port", () => {
        expect(normalizeDirectoryServer("example.com:8448")).toBe("example.com:8448");
    });

    it("takes the server out of a room alias", () => {
        expect(normalizeDirectoryServer("#space:example.com")).toBe("example.com");
    });

    it("takes the server out of a user id", () => {
        expect(normalizeDirectoryServer("@alice:example.com")).toBe("example.com");
    });

    it("drops a trailing dot", () => {
        expect(normalizeDirectoryServer("example.com.")).toBe("example.com");
    });

    it("returns empty for blank input", () => {
        expect(normalizeDirectoryServer("   ")).toBe("");
    });
});

describe("isValidDirectoryServer", () => {
    it.each(["matrix.org", "example.com:8448", "localhost", "a.b.c.d"])("accepts %s", (value) => {
        expect(isValidDirectoryServer(value)).toBe(true);
    });

    it.each(["", "nodot", "-bad.com", "bad-.com", ".example.com", "example.com:", "has space.com", "sp@ce.com"])(
        "rejects %s",
        (value) => {
            expect(isValidDirectoryServer(value)).toBe(false);
        },
    );
});

describe("remembered servers", () => {
    beforeEach(() => {
        globalThis.localStorage.clear();
    });

    it("starts empty", () => {
        expect(loadRememberedServers()).toEqual([]);
    });

    it("stores a server and reads it back", () => {
        expect(rememberServer("matrix.org")).toEqual(["matrix.org"]);
        expect(loadRememberedServers()).toEqual(["matrix.org"]);
    });

    it("moves a repeat to the front without duplicating", () => {
        rememberServer("a.example");
        rememberServer("b.example");
        expect(rememberServer("a.example")).toEqual(["a.example", "b.example"]);
    });

    it("ignores an invalid server", () => {
        rememberServer("matrix.org");
        expect(rememberServer("nonsense")).toEqual(["matrix.org"]);
    });

    it("caps the list at eight", () => {
        for (let index = 0; index < 12; index++) {
            rememberServer(`s${index}.example`);
        }
        expect(loadRememberedServers()).toHaveLength(8);
    });

    it("forgets a server", () => {
        rememberServer("a.example");
        rememberServer("b.example");
        expect(forgetServer("a.example")).toEqual(["b.example"]);
    });

    it("survives corrupt stored data", () => {
        globalThis.localStorage.setItem("jorvik.directory.servers", "{not json");
        expect(loadRememberedServers()).toEqual([]);
    });

    it("discards non-string and invalid entries that were stored somehow", () => {
        globalThis.localStorage.setItem("jorvik.directory.servers", JSON.stringify(["ok.example", 7, "nodot"]));
        expect(loadRememberedServers()).toEqual(["ok.example"]);
    });
});

describe("describeDirectoryError", () => {
    it("explains a server that refuses federated browsing", () => {
        const message = describeDirectoryError(new MatrixError({ errcode: "M_FORBIDDEN" }, 403), "example.com");
        expect(message).toContain("example.com");
        expect(message).toContain("does not allow browsing");
    });

    it("explains a 404 as possibly not federating", () => {
        const message = describeDirectoryError(new MatrixError({ errcode: "M_NOT_FOUND" }, 404), "example.com");
        expect(message).toContain("did not return a room directory");
    });

    it("explains rate limiting", () => {
        const message = describeDirectoryError(new MatrixError({ errcode: "M_LIMIT_EXCEEDED" }, 429), "example.com");
        expect(message).toContain("rate limiting");
    });

    it("names our own server when none was given", () => {
        expect(describeDirectoryError(new Error("offline"), "")).toContain("this homeserver");
    });
});
