import { MatrixError } from "matrix-js-sdk/src/matrix";

const STORAGE_KEY = "jorvik.directory.servers";
const MAX_REMEMBERED = 8;

export function normalizeDirectoryServer(input: string): string {
    let value = input.trim().toLowerCase();
    if (value.length === 0) {
        return "";
    }

    value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");

    const pathStart = value.search(/[/?#]/);
    if (value.startsWith("#") || value.startsWith("@")) {
        const sigilless = value.slice(1);
        const separator = sigilless.indexOf(":");
        value = separator === -1 ? sigilless : sigilless.slice(separator + 1);
    } else if (pathStart !== -1) {
        value = value.slice(0, pathStart);
    }

    return value.replace(/\.$/, "");
}

export function isValidDirectoryServer(value: string): boolean {
    const parts = value.split(":");
    if (parts.length > 2) {
        return false;
    }

    const [host, port] = parts;
    if (port !== undefined && !/^\d{1,5}$/.test(port)) {
        return false;
    }

    if (host === "localhost") {
        return true;
    }

    // Every dot-separated label has to be a valid hostname label on its own:
    // checking only the whole host lets "bad-.com" through.
    const labels = host.split(".");
    if (labels.length < 2) {
        return false;
    }

    return labels.every((label) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label));
}

export function loadRememberedServers(): string[] {
    try {
        const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
        if (!raw) {
            return [];
        }

        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => normalizeDirectoryServer(entry))
            .filter((entry) => isValidDirectoryServer(entry))
            .slice(0, MAX_REMEMBERED);
    } catch {
        return [];
    }
}

export function rememberServer(value: string, existing?: string[]): string[] {
    const normalized = normalizeDirectoryServer(value);
    if (!isValidDirectoryServer(normalized)) {
        return existing ?? loadRememberedServers();
    }

    const current = existing ?? loadRememberedServers();
    const next = [normalized, ...current.filter((entry) => entry !== normalized)].slice(0, MAX_REMEMBERED);

    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // A private window or blocked site data must not break directory browsing.
    }

    return next;
}

export function forgetServer(value: string): string[] {
    const normalized = normalizeDirectoryServer(value);
    const next = loadRememberedServers().filter((entry) => entry !== normalized);

    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // Ignored for the same reason as rememberServer.
    }

    return next;
}

export function describeDirectoryError(error: unknown, server: string): string {
    const where = server.length > 0 ? server : "this homeserver";

    if (error instanceof MatrixError) {
        const errcode = typeof error.errcode === "string" ? error.errcode : "";

        if (errcode === "M_FORBIDDEN") {
            return `${where} does not allow browsing its directory from other servers.`;
        }

        if (errcode === "M_LIMIT_EXCEEDED") {
            return `${where} is rate limiting these requests. Wait a moment and try again.`;
        }

        if (error.httpStatus === 404) {
            return `${where} did not return a room directory. It may not federate, or the name may be wrong.`;
        }

        const message = typeof error.data?.error === "string" ? error.data.error : error.message;
        return `${where} refused the request: ${message}`;
    }

    if (error instanceof Error) {
        return `Could not reach ${where}: ${error.message}`;
    }

    return `Could not reach ${where}.`;
}
