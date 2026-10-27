import { useCallback, useEffect, useState } from "react";
import { ClientEvent, ReceiptType, type MatrixClient, type MatrixEvent } from "matrix-js-sdk/src/matrix";

/**
 * Whether the user keeps how far they've read to themselves. It lives in account data, so turning read
 * receipts off on one device turns them off on every device they use Jorvik on.
 */
export const READ_RECEIPTS_EVENT_TYPE = "app.jorvik.read_receipts";

/** Account data is user-writable from any client, so trust none of it: only an explicit true keeps them private. */
export function normalizeKeepPrivate(content: unknown): boolean {
    return Boolean(content && typeof content === "object" && (content as { private?: unknown }).private === true);
}

export function keepsReadReceiptsPrivate(client: MatrixClient): boolean {
    return normalizeKeepPrivate(client.getAccountData(READ_RECEIPTS_EVENT_TYPE as any)?.getContent());
}

/**
 * The receipt for the user's own reading: a public one others see, or a private one only their own
 * devices see. The server counts the room as read either way.
 */
export function ownReadReceiptType(client: MatrixClient): ReceiptType {
    return keepsReadReceiptsPrivate(client) ? ReceiptType.ReadPrivate : ReceiptType.Read;
}

/** Moves the read marker and the user's receipt up to the event, keeping the receipt private if they chose that. */
export async function setReadMarkers(client: MatrixClient, roomId: string, eventId: string, event: MatrixEvent): Promise<void> {
    if (keepsReadReceiptsPrivate(client)) {
        await client.setRoomReadMarkers(roomId, eventId, undefined, event);
    } else {
        await client.setRoomReadMarkers(roomId, eventId, event);
    }
}

/** Private receipts came with Matrix 1.4 (MSC2285 before it). */
export async function serverHasPrivateReceipts(client: MatrixClient): Promise<boolean> {
    return (
        (await client.isVersionSupported("v1.4")) ||
        (await client.doesServerSupportUnstableFeature("org.matrix.msc2285.stable"))
    );
}

export interface ReadReceiptsPrivacyController {
    keepPrivate: boolean;
    /** Whether the server can keep receipts private; null until that's known. */
    supported: boolean | null;
    /** Rejects, and shows the saved choice again, if it can't be saved. */
    setKeepPrivate: (keepPrivate: boolean) => Promise<void>;
}

export function useReadReceiptsPrivacy(client: MatrixClient): ReadReceiptsPrivacyController {
    const [keepPrivate, setKeepPrivateState] = useState(() => keepsReadReceiptsPrivate(client));
    const [supported, setSupported] = useState<boolean | null>(null);

    // Another device, or this one, changed it.
    useEffect(() => {
        setKeepPrivateState(keepsReadReceiptsPrivate(client));
        const onAccountData = (event: MatrixEvent): void => {
            if (event.getType() === READ_RECEIPTS_EVENT_TYPE) {
                setKeepPrivateState(normalizeKeepPrivate(event.getContent()));
            }
        };
        client.on(ClientEvent.AccountData, onAccountData);
        return () => {
            client.removeListener(ClientEvent.AccountData, onAccountData);
        };
    }, [client]);

    useEffect(() => {
        let cancelled = false;
        // If the server can't be asked, it stays unknown rather than looking unsupported.
        void serverHasPrivateReceipts(client).then(
            (result) => {
                if (!cancelled) {
                    setSupported(result);
                }
            },
            () => undefined,
        );
        return () => {
            cancelled = true;
        };
    }, [client]);

    const setKeepPrivate = useCallback(
        async (next: boolean): Promise<void> => {
            setKeepPrivateState(next);
            try {
                await client.setAccountData(READ_RECEIPTS_EVENT_TYPE as any, { private: next } as any);
            } catch (error) {
                setKeepPrivateState(keepsReadReceiptsPrivate(client));
                throw error;
            }
        },
        [client],
    );

    return { keepPrivate, supported, setKeepPrivate };
}
