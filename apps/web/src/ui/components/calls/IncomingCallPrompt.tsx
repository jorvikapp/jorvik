import React from "react";
import type { MatrixClient } from "matrix-js-sdk/src/matrix";

import type { CallRing } from "../../../core/calls/callSignals";
import { plainUserDisplayName } from "../../../core/users/userDisplayName";
import { memberAvatarSources } from "../../adapters/avatar";
import { Avatar } from "../Avatar";

interface IncomingCallPromptProps {
    client: MatrixClient;
    call: CallRing;
    onAccept: () => void;
    onDecline: () => void;
}

export function IncomingCallPrompt({ client, call, onAccept, onDecline }: IncomingCallPromptProps): React.ReactElement {
    const member = client.getRoom(call.roomId)?.getMember(call.callerId) ?? null;
    // rawDisplayName, not name: name adds "(@id)" when the room has two people
    // with the same display name.
    const name = member?.rawDisplayName || plainUserDisplayName(client.getUser(call.callerId)) || call.callerId;
    const sources = memberAvatarSources(client, member, 96, "crop");

    return (
        <div className="incoming-call" role="alertdialog" aria-label={`Incoming call from ${name}`}>
            <Avatar
                className="incoming-call-avatar"
                name={name}
                src={sources[0] ?? null}
                sources={sources}
                seed={call.callerId}
                userId={call.callerId}
            />
            <div className="incoming-call-text">
                <span className="incoming-call-name">{name}</span>
                <span className="incoming-call-label">Incoming call...</span>
            </div>
            <div className="incoming-call-actions">
                <button type="button" className="incoming-call-decline" onClick={onDecline}>
                    Decline
                </button>
                <button type="button" className="incoming-call-accept" onClick={onAccept} autoFocus>
                    Accept
                </button>
            </div>
        </div>
    );
}
