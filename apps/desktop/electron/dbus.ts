import net from "node:net";
import os from "node:os";

/**
 * Just enough of a D-Bus client to read other programs' properties on the session bus: connect,
 * authenticate, and make method calls with string arguments. Replies are decoded into plain values
 * (dicts become objects, 64-bit integers become numbers). Used to read MPRIS players on Linux.
 */

export type DBusValue = string | number | boolean | DBusValue[] | { [key: string]: DBusValue } | null;

const MESSAGE_METHOD_CALL = 1;
const MESSAGE_METHOD_RETURN = 2;
const MESSAGE_ERROR = 3;
const FIELD_PATH = 1;
const FIELD_INTERFACE = 2;
const FIELD_MEMBER = 3;
const FIELD_ERROR_NAME = 4;
const FIELD_REPLY_SERIAL = 5;
const FIELD_DESTINATION = 6;
const FIELD_SIGNATURE = 8;
/** No message we read is anywhere near this; a bigger one means something is wrong. */
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
const MAX_DEPTH = 32;

/** The session bus's socket path ("\0name" for an abstract socket), from DBUS_SESSION_BUS_ADDRESS. */
export function sessionBusPath(address = process.env.DBUS_SESSION_BUS_ADDRESS): string | null {
    for (const entry of (address ?? "").split(";")) {
        const [transport, rest = ""] = entry.split(/:(.*)/s);
        if (transport !== "unix") {
            continue;
        }
        const params = new Map(rest.split(",").map((pair) => pair.split(/=(.*)/s) as [string, string]));
        const value = params.get("path") ?? params.get("abstract");
        if (value) {
            return params.has("path") ? unescapeAddress(value) : `\0${unescapeAddress(value)}`;
        }
    }
    const uid = typeof process.getuid === "function" ? process.getuid() : null;
    return uid === null || address ? null : `/run/user/${uid}/bus`;
}

function unescapeAddress(value: string): string {
    return value.replace(/%([0-9a-fA-F]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function alignment(code: string): number {
    switch (code) {
        case "y":
        case "g":
        case "v":
            return 1;
        case "n":
        case "q":
            return 2;
        case "x":
        case "t":
        case "d":
        case "(":
        case "{":
            return 8;
        default:
            return 4;
    }
}

/** The length of the single complete type at the start of `signature`. */
function completeTypeLength(signature: string, start: number): number {
    const code = signature[start];
    if (code === "a") {
        return 1 + completeTypeLength(signature, start + 1);
    }
    if (code === "(" || code === "{") {
        const close = code === "(" ? ")" : "}";
        let depth = 0;
        for (let index = start; index < signature.length; index += 1) {
            if (signature[index] === code) depth += 1;
            if (signature[index] === close) depth -= 1;
            if (depth === 0) {
                return index - start + 1;
            }
        }
        throw new Error("Unbalanced D-Bus signature");
    }
    if (!code) {
        throw new Error("Truncated D-Bus signature");
    }
    return 1;
}

export function splitSignature(signature: string): string[] {
    const types: string[] = [];
    for (let index = 0; index < signature.length; ) {
        const length = completeTypeLength(signature, index);
        types.push(signature.slice(index, index + length));
        index += length;
    }
    return types;
}

class Reader {
    private offset: number;

    public constructor(
        private readonly buffer: Buffer,
        private readonly little: boolean,
        offset = 0,
    ) {
        this.offset = offset;
    }

    public get position(): number {
        return this.offset;
    }

    private align(size: number): void {
        this.offset = Math.ceil(this.offset / size) * size;
        if (this.offset > this.buffer.length) {
            throw new Error("D-Bus message ended early");
        }
    }

    private need(size: number): void {
        if (this.offset + size > this.buffer.length) {
            throw new Error("D-Bus message ended early");
        }
    }

    private u32(): number {
        this.align(4);
        this.need(4);
        const value = this.little ? this.buffer.readUInt32LE(this.offset) : this.buffer.readUInt32BE(this.offset);
        this.offset += 4;
        return value;
    }

    private text(length: number): string {
        this.need(length + 1);
        const value = this.buffer.toString("utf8", this.offset, this.offset + length);
        this.offset += length + 1;
        return value;
    }

    public read(type: string, depth = 0): DBusValue {
        if (depth > MAX_DEPTH) {
            throw new Error("D-Bus value nested too deeply");
        }
        const code = type[0];
        this.align(alignment(code));
        switch (code) {
            case "y":
                this.need(1);
                return this.buffer[this.offset++];
            case "b":
                return this.u32() !== 0;
            case "n":
            case "q": {
                this.need(2);
                const value =
                    code === "n"
                        ? this.little ? this.buffer.readInt16LE(this.offset) : this.buffer.readInt16BE(this.offset)
                        : this.little ? this.buffer.readUInt16LE(this.offset) : this.buffer.readUInt16BE(this.offset);
                this.offset += 2;
                return value;
            }
            case "i": {
                this.need(4);
                const value = this.little ? this.buffer.readInt32LE(this.offset) : this.buffer.readInt32BE(this.offset);
                this.offset += 4;
                return value;
            }
            case "u":
            case "h":
                return this.u32();
            case "x":
            case "t": {
                this.need(8);
                const value =
                    code === "x"
                        ? this.little ? this.buffer.readBigInt64LE(this.offset) : this.buffer.readBigInt64BE(this.offset)
                        : this.little ? this.buffer.readBigUInt64LE(this.offset) : this.buffer.readBigUInt64BE(this.offset);
                this.offset += 8;
                return Number(value);
            }
            case "d": {
                this.need(8);
                const value = this.little ? this.buffer.readDoubleLE(this.offset) : this.buffer.readDoubleBE(this.offset);
                this.offset += 8;
                return value;
            }
            case "s":
            case "o":
                return this.text(this.u32());
            case "g": {
                this.need(1);
                return this.text(this.buffer[this.offset++]);
            }
            case "v": {
                this.need(1);
                const signature = this.text(this.buffer[this.offset++]);
                if (splitSignature(signature).length !== 1) {
                    throw new Error("A D-Bus variant holds exactly one value");
                }
                return this.read(signature, depth + 1);
            }
            case "a": {
                const length = this.u32();
                const element = type.slice(1);
                this.align(alignment(element[0]));
                const end = this.offset + length;
                if (length > MAX_MESSAGE_BYTES || end > this.buffer.length) {
                    throw new Error("D-Bus array runs past the message");
                }
                if (element[0] === "{") {
                    const [keyType, valueType] = splitSignature(element.slice(1, -1));
                    const dict: { [key: string]: DBusValue } = {};
                    while (this.offset < end) {
                        this.align(8);
                        const key = this.read(keyType, depth + 1);
                        dict[String(key)] = this.read(valueType, depth + 1);
                    }
                    return dict;
                }
                const items: DBusValue[] = [];
                while (this.offset < end) {
                    items.push(this.read(element, depth + 1));
                }
                return items;
            }
            case "(": {
                return splitSignature(type.slice(1, -1)).map((member) => this.read(member, depth + 1));
            }
            default:
                throw new Error(`Unsupported D-Bus type ${code}`);
        }
    }
}

/** Builds a method call with string arguments. */
export function encodeMethodCall(
    serial: number,
    call: { destination: string; path: string; interface: string; member: string; args?: string[] },
): Buffer {
    const args = call.args ?? [];
    const parts: number[] = [];
    const pad = (size: number): void => {
        while (parts.length % size !== 0) parts.push(0);
    };
    const u32 = (value: number): void => {
        pad(4);
        parts.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
    };
    const string = (value: string): void => {
        const bytes = Buffer.from(value, "utf8");
        u32(bytes.length);
        parts.push(...bytes, 0);
    };
    const signature = (value: string): void => {
        parts.push(value.length, ...Buffer.from(value, "ascii"), 0);
    };
    const field = (code: number, type: "s" | "o" | "g", value: string): void => {
        pad(8);
        parts.push(code);
        signature(type);
        if (type === "g") {
            signature(value);
        } else {
            string(value);
        }
    };

    const body: number[] = [];
    for (const arg of args) {
        while (body.length % 4 !== 0) body.push(0);
        const bytes = Buffer.from(arg, "utf8");
        const length = bytes.length;
        body.push(length & 0xff, (length >>> 8) & 0xff, (length >>> 16) & 0xff, (length >>> 24) & 0xff, ...bytes, 0);
    }

    parts.push("l".charCodeAt(0), MESSAGE_METHOD_CALL, 0, 1);
    u32(body.length);
    u32(serial);
    const lengthAt = parts.length;
    u32(0);
    const fieldsStart = parts.length;
    field(FIELD_PATH, "o", call.path);
    field(FIELD_INTERFACE, "s", call.interface);
    field(FIELD_MEMBER, "s", call.member);
    field(FIELD_DESTINATION, "s", call.destination);
    if (args.length > 0) {
        field(FIELD_SIGNATURE, "g", "s".repeat(args.length));
    }
    const fieldsLength = parts.length - fieldsStart;
    parts[lengthAt] = fieldsLength & 0xff;
    parts[lengthAt + 1] = (fieldsLength >>> 8) & 0xff;
    parts[lengthAt + 2] = (fieldsLength >>> 16) & 0xff;
    parts[lengthAt + 3] = (fieldsLength >>> 24) & 0xff;
    pad(8);
    return Buffer.from([...parts, ...body]);
}

export interface DecodedMessage {
    type: number;
    replySerial: number | null;
    errorName: string | null;
    body: DBusValue[];
}

/** The length of the first whole message in `buffer`, or null until all of it has arrived. */
export function messageLength(buffer: Buffer): number | null {
    if (buffer.length < 16) {
        return null;
    }
    const little = buffer[0] === "l".charCodeAt(0);
    const bodyLength = little ? buffer.readUInt32LE(4) : buffer.readUInt32BE(4);
    const fieldsLength = little ? buffer.readUInt32LE(12) : buffer.readUInt32BE(12);
    const total = Math.ceil((16 + fieldsLength) / 8) * 8 + bodyLength;
    if (total > MAX_MESSAGE_BYTES) {
        throw new Error("D-Bus message too large");
    }
    return buffer.length >= total ? total : null;
}

export function decodeMessage(buffer: Buffer): DecodedMessage {
    const little = buffer[0] === "l".charCodeAt(0);
    if (!little && buffer[0] !== "B".charCodeAt(0)) {
        throw new Error("Not a D-Bus message");
    }
    const header = new Reader(buffer, little, 12);
    const fields = header.read("a(yv)") as [number, DBusValue][];
    let replySerial: number | null = null;
    let errorName: string | null = null;
    let signature = "";
    for (const [code, value] of fields) {
        if (code === FIELD_REPLY_SERIAL && typeof value === "number") replySerial = value;
        if (code === FIELD_ERROR_NAME && typeof value === "string") errorName = value;
        if (code === FIELD_SIGNATURE && typeof value === "string") signature = value;
    }
    const bodyStart = Math.ceil(header.position / 8) * 8;
    // Alignment in the body counts from the start of the message, which bodyStart keeps.
    const body = new Reader(buffer, little, bodyStart);
    const values = splitSignature(signature).map((type) => body.read(type));
    return { type: buffer[1], replySerial, errorName, body: values };
}

interface Pending {
    resolve: (body: DBusValue[]) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
}

export class DBusConnection {
    private serial = 0;
    private readonly pending = new Map<number, Pending>();
    private received = Buffer.alloc(0);
    private closed = false;

    private constructor(private readonly socket: net.Socket) {
        socket.on("data", (chunk: Buffer) => this.onData(chunk));
        socket.on("close", () => this.fail(new Error("D-Bus connection closed")));
        socket.on("error", (error) => this.fail(error));
    }

    /** Connects to the session bus and says hello; rejects when there is no bus to reach. */
    public static async connectSession(timeoutMs = 3_000): Promise<DBusConnection> {
        const path = sessionBusPath();
        if (!path) {
            throw new Error("No D-Bus session bus");
        }
        const socket = await new Promise<net.Socket>((resolve, reject) => {
            const connection = net.createConnection({ path });
            const timer = setTimeout(() => {
                connection.destroy();
                reject(new Error("D-Bus connection timed out"));
            }, timeoutMs);
            connection.once("connect", () => {
                clearTimeout(timer);
                resolve(connection);
            });
            connection.once("error", (error) => {
                clearTimeout(timer);
                reject(error);
            });
        });
        await authenticate(socket, timeoutMs);
        const connection = new DBusConnection(socket);
        await connection.call({
            destination: "org.freedesktop.DBus",
            path: "/org/freedesktop/DBus",
            interface: "org.freedesktop.DBus",
            member: "Hello",
        });
        return connection;
    }

    public get isClosed(): boolean {
        return this.closed;
    }

    public call(
        message: { destination: string; path: string; interface: string; member: string; args?: string[] },
        timeoutMs = 2_000,
    ): Promise<DBusValue[]> {
        if (this.closed) {
            return Promise.reject(new Error("D-Bus connection closed"));
        }
        this.serial = (this.serial % 0x7fffffff) + 1;
        const serial = this.serial;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(serial);
                reject(new Error(`D-Bus call ${message.member} timed out`));
            }, timeoutMs);
            this.pending.set(serial, { resolve, reject, timer });
            this.socket.write(encodeMethodCall(serial, message));
        });
    }

    public close(): void {
        this.closed = true;
        this.socket.destroy();
        this.fail(new Error("D-Bus connection closed"));
    }

    private onData(chunk: Buffer): void {
        this.received = Buffer.concat([this.received, chunk]);
        try {
            for (let length = messageLength(this.received); length !== null; length = messageLength(this.received)) {
                const message = this.received.subarray(0, length);
                this.received = this.received.subarray(length);
                this.dispatch(message);
            }
        } catch (error) {
            this.socket.destroy();
            this.fail(error instanceof Error ? error : new Error(String(error)));
        }
    }

    private dispatch(raw: Buffer): void {
        const type = raw[1];
        if (type !== MESSAGE_METHOD_RETURN && type !== MESSAGE_ERROR) {
            return; // Signals, such as NameAcquired.
        }
        const message = decodeMessage(raw);
        const pending = message.replySerial === null ? undefined : this.pending.get(message.replySerial);
        if (!pending || message.replySerial === null) {
            return;
        }
        this.pending.delete(message.replySerial);
        clearTimeout(pending.timer);
        if (message.type === MESSAGE_ERROR) {
            pending.reject(new Error(message.errorName ?? "D-Bus error"));
        } else {
            pending.resolve(message.body);
        }
    }

    private fail(error: Error): void {
        this.closed = true;
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pending.clear();
    }
}

/** SASL EXTERNAL: the bus knows who we are from the socket; we only say our uid. */
function authenticate(socket: net.Socket, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const uid = typeof process.getuid === "function" ? process.getuid() : Number(os.userInfo().uid);
        let reply = "";
        const timer = setTimeout(() => finish(new Error("D-Bus authentication timed out")), timeoutMs);
        const finish = (error?: Error): void => {
            clearTimeout(timer);
            socket.removeListener("data", onData);
            if (error) {
                socket.destroy();
                reject(error);
            } else {
                resolve();
            }
        };
        const onData = (chunk: Buffer): void => {
            reply += chunk.toString("latin1");
            if (!reply.includes("\r\n")) {
                return;
            }
            if (reply.startsWith("OK ")) {
                socket.write("BEGIN\r\n");
                finish();
            } else {
                finish(new Error(`D-Bus authentication refused: ${reply.trim()}`));
            }
        };
        socket.on("data", onData);
        socket.write(Buffer.concat([Buffer.from([0]), Buffer.from(`AUTH EXTERNAL ${Buffer.from(String(uid)).toString("hex")}\r\n`)]));
    });
}
