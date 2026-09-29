import React, { useEffect, useRef, useState } from "react";
import { CryptoEvent, type VerificationRequest } from "matrix-js-sdk/src/crypto-api";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import { type IncomingVerificationRequest, VerificationDialog } from "./VerificationDialog";

const PHASE_CANCELLED = 5;

/**
 * Calls onRequest when another of our own sessions asks to verify, as Element
 * does for "Use another device". Requests from other people are left alone.
 */
export function useIncomingSelfVerification(
    client: MatrixClient | null,
    onRequest: (request: IncomingVerificationRequest) => void,
): void {
    const onRequestRef = useRef(onRequest);
    onRequestRef.current = onRequest;

    useEffect(() => {
        if (!client) {
            return;
        }

        const listener = (request: VerificationRequest): void => {
            if (request.isSelfVerification && !request.initiatedByMe) {
                onRequestRef.current(request as unknown as IncomingVerificationRequest);
            }
        };
        // The client's event map is typed from matrix-js-sdk/lib, the request from src.
        client.on(CryptoEvent.VerificationRequestReceived, listener as any);
        return () => {
            client.off(CryptoEvent.VerificationRequestReceived, listener as any);
        };
    }, [client]);
}

interface IncomingVerificationDialogProps {
    client: MatrixClient;
    onCompleted?: () => void;
}

/** Opens the verification dialog for requests from our other sessions while the app is in use. */
export function IncomingVerificationDialog({ client, onCompleted }: IncomingVerificationDialogProps): React.ReactElement | null {
    const [request, setRequest] = useState<IncomingVerificationRequest | null>(null);
    useIncomingSelfVerification(client, (incoming) => setRequest((current) => current ?? incoming));

    // Element sends the request to every session and cancels it on the rest
    // once one answers: close quietly rather than show "cancelled".
    useEffect(() => {
        if (!request) {
            return;
        }

        const onChange = (): void => {
            if (request.phase === PHASE_CANCELLED && request.cancellationCode === "m.accepted") {
                setRequest(null);
            }
        };
        request.on("change", onChange);
        return () => {
            request.off("change", onChange);
        };
    }, [request]);

    return (
        <VerificationDialog
            client={client}
            open={request !== null}
            incomingRequest={request}
            onClose={() => setRequest(null)}
            onCompleted={onCompleted}
        />
    );
}
