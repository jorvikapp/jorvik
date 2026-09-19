import { AuthType, createClient, MatrixError, type AuthDict } from "matrix-js-sdk/src/matrix";

export interface PasswordResetTicket {
    sid: string;
    clientSecret: string;
    email: string;
    sendAttempt: number;
}

export type PasswordResetErrorCode =
    | "email_required"
    | "email_unknown"
    | "email_unverified"
    | "rate_limited"
    | "password_rejected"
    | "request_failed";

export class PasswordResetError extends Error {
    public readonly code: PasswordResetErrorCode;
    public readonly cause: unknown;

    public constructor(message: string, code: PasswordResetErrorCode, cause?: unknown) {
        super(message);
        this.code = code;
        this.cause = cause;
    }
}

export function generateClientSecret(): string {
    const bytes = new Uint8Array(24);
    globalThis.crypto.getRandomValues(bytes);

    let secret = "";
    for (const byte of bytes) {
        secret += byte.toString(16).padStart(2, "0");
    }

    return secret;
}

function httpStatusOf(error: unknown): number | null {
    if (!(error instanceof MatrixError)) {
        return null;
    }

    return typeof error.httpStatus === "number" ? error.httpStatus : null;
}

function serverMessageOf(error: MatrixError): string {
    return typeof error.data?.error === "string" && error.data.error.length > 0 ? error.data.error : error.message;
}

function toPasswordResetError(error: unknown): PasswordResetError {
    if (error instanceof PasswordResetError) {
        return error;
    }

    if (!(error instanceof MatrixError)) {
        const message = error instanceof Error ? error.message : String(error);
        return new PasswordResetError(message, "request_failed", error);
    }

    const errcode = typeof error.errcode === "string" ? error.errcode : "";

    if (errcode === "M_THREEPID_NOT_FOUND") {
        return new PasswordResetError(
            "No account on this homeserver uses that email address.",
            "email_unknown",
            error,
        );
    }

    if (httpStatusOf(error) === 401) {
        return new PasswordResetError(
            "That email address has not been confirmed yet. Open the link we sent you, then continue.",
            "email_unverified",
            error,
        );
    }

    if (errcode === "M_LIMIT_EXCEEDED") {
        return new PasswordResetError(
            "Too many attempts. Wait a moment before trying again.",
            "rate_limited",
            error,
        );
    }

    if (errcode === "M_WEAK_PASSWORD" || errcode.startsWith("M_PASSWORD_")) {
        return new PasswordResetError(serverMessageOf(error), "password_rejected", error);
    }

    return new PasswordResetError(serverMessageOf(error), "request_failed", error);
}

interface RequestPasswordResetOptions {
    homeserverUrl: string;
    email: string;
    clientSecret?: string;
    sendAttempt?: number;
}

export async function requestPasswordResetEmail(options: RequestPasswordResetOptions): Promise<PasswordResetTicket> {
    const email = options.email.trim();
    if (email.length === 0) {
        throw new PasswordResetError("Enter the email address for your account.", "email_required");
    }

    const clientSecret = options.clientSecret ?? generateClientSecret();
    const sendAttempt = options.sendAttempt ?? 1;
    const client = createClient({ baseUrl: options.homeserverUrl });

    try {
        const response = await client.requestPasswordEmailToken(email, clientSecret, sendAttempt);
        return { sid: response.sid, clientSecret, email, sendAttempt };
    } catch (error) {
        throw toPasswordResetError(error);
    }
}

interface CompletePasswordResetOptions {
    homeserverUrl: string;
    ticket: PasswordResetTicket;
    newPassword: string;
    logoutDevices: boolean;
}

export async function completePasswordReset(options: CompletePasswordResetOptions): Promise<void> {
    if (options.newPassword.length === 0) {
        throw new PasswordResetError("Enter a new password.", "password_rejected");
    }

    const client = createClient({ baseUrl: options.homeserverUrl });

    const authDict = {
        type: AuthType.Email,
        threepid_creds: {
            sid: options.ticket.sid,
            client_secret: options.ticket.clientSecret,
        },
    } as unknown as AuthDict;

    try {
        await client.setPassword(authDict, options.newPassword, options.logoutDevices);
    } catch (error) {
        throw toPasswordResetError(error);
    }
}

export function formatPasswordResetError(error: unknown): string {
    return toPasswordResetError(error).message;
}
