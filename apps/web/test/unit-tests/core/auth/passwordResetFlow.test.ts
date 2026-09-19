import { MatrixError } from "matrix-js-sdk/src/matrix";
import { describe, expect, it } from "vitest";

import {
    completePasswordReset,
    formatPasswordResetError,
    generateClientSecret,
    PasswordResetError,
    requestPasswordResetEmail,
    type PasswordResetTicket,
} from "../../../../src/core/auth/passwordResetFlow";

const ticket: PasswordResetTicket = {
    sid: "sid-1",
    clientSecret: "secret-1",
    email: "alice@example.com",
    sendAttempt: 1,
};

function matrixError(errcode: string, message: string, httpStatus: number): MatrixError {
    return new MatrixError({ errcode, error: message }, httpStatus);
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
    try {
        await run();
    } catch (error) {
        return error instanceof PasswordResetError ? error.code : `unexpected:${String(error)}`;
    }

    return "no_error_thrown";
}

describe("generateClientSecret", () => {
    it("returns a long lowercase hex string", () => {
        expect(generateClientSecret()).toMatch(/^[0-9a-f]{48}$/);
    });

    it("does not repeat itself", () => {
        expect(generateClientSecret()).not.toBe(generateClientSecret());
    });
});

describe("input guards", () => {
    it("rejects a blank email before contacting the homeserver", async () => {
        await expect(
            codeOf(() => requestPasswordResetEmail({ homeserverUrl: "https://example.org", email: "   " })),
        ).resolves.toBe("email_required");
    });

    it("rejects an empty new password before contacting the homeserver", async () => {
        await expect(
            codeOf(() =>
                completePasswordReset({
                    homeserverUrl: "https://example.org",
                    ticket,
                    newPassword: "",
                    logoutDevices: true,
                }),
            ),
        ).resolves.toBe("password_rejected");
    });
});

describe("formatPasswordResetError", () => {
    it("explains an address the homeserver does not know", () => {
        const message = formatPasswordResetError(matrixError("M_THREEPID_NOT_FOUND", "Email not found", 400));
        expect(message).toContain("No account");
    });

    it("tells the user to open the emailed link when the address is unconfirmed", () => {
        const message = formatPasswordResetError(matrixError("M_UNAUTHORIZED", "Unauthorized", 401));
        expect(message).toContain("Open the link");
    });

    it("explains rate limiting", () => {
        const message = formatPasswordResetError(matrixError("M_LIMIT_EXCEEDED", "Too many requests", 429));
        expect(message).toContain("Too many attempts");
    });

    it("passes through the homeserver's own password policy message", () => {
        const message = formatPasswordResetError(
            matrixError("M_PASSWORD_TOO_SHORT", "Password is too short", 400),
        );
        expect(message).toBe("Password is too short");
    });

    it("passes through an unrecognised matrix error message", () => {
        const message = formatPasswordResetError(matrixError("M_UNKNOWN", "Something broke", 500));
        expect(message).toBe("Something broke");
    });

    it("handles a plain error", () => {
        expect(formatPasswordResetError(new Error("network down"))).toBe("network down");
    });
});
