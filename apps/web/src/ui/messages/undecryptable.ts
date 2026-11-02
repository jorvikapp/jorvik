import { DecryptionFailureCode } from "matrix-js-sdk/src/crypto-api";
import type { MatrixEvent } from "matrix-js-sdk/src/matrix";

/**
 * Messages Jorvik couldn't decrypt. The SDK turns each one into a text message whose text is
 * the error ("** Unable to decrypt: ... **"), so without this they'd show that error as if
 * someone had typed it.
 */

/** The msgtype the SDK gives a message it couldn't decrypt. */
export const UNDECRYPTABLE_MSGTYPE = "m.bad.encrypted";

/** A message that can't be read, where it's quoted: replies, pins, search. */
export const UNDECRYPTABLE_PREVIEW = "Encrypted message";

/** In place of all the messages from before you joined, which are shown as one line. */
export const SENT_BEFORE_JOINING_NOTICE = "Messages from before you joined are end-to-end encrypted, so you can't read them.";

type DecryptionState = Pick<MatrixEvent, "isDecryptionFailure" | "decryptionFailureReason">;

/**
 * Sent while you weren't in the room. Only the people who were there got its key, so it can't
 * be read now and never will be.
 */
export function isSentBeforeJoining(event: DecryptionState): boolean {
    return (
        event.isDecryptionFailure() &&
        event.decryptionFailureReason === DecryptionFailureCode.HISTORICAL_MESSAGE_USER_NOT_JOINED
    );
}

/** What a message that couldn't be decrypted shows instead, by why it couldn't be. */
export function undecryptableText(event: DecryptionState): string {
    switch (event.decryptionFailureReason) {
        case DecryptionFailureCode.HISTORICAL_MESSAGE_USER_NOT_JOINED:
            return "Sent before you joined, so you can't read it.";
        case DecryptionFailureCode.MEGOLM_UNKNOWN_INBOUND_SESSION_ID:
        case DecryptionFailureCode.OLM_UNKNOWN_MESSAGE_INDEX:
            return "Waiting for the key to this message. This can take a while.";
        case DecryptionFailureCode.HISTORICAL_MESSAGE_NO_KEY_BACKUP:
            return "Sent before you signed in on this device, and your account has no key backup to read it from.";
        case DecryptionFailureCode.HISTORICAL_MESSAGE_BACKUP_UNCONFIGURED:
            return "Sent before you signed in on this device. To read it, verify this device or enter your security key in Settings > Encryption & Recovery.";
        case DecryptionFailureCode.HISTORICAL_MESSAGE_WORKING_BACKUP:
            return "Sent before you signed in on this device. Its key isn't in your key backup yet.";
        case DecryptionFailureCode.MEGOLM_KEY_WITHHELD_FOR_UNVERIFIED_DEVICE:
            return "The sender only shares keys with verified devices, and this device isn't verified.";
        case DecryptionFailureCode.MEGOLM_KEY_WITHHELD:
            return "The sender's app didn't share the key to this message with you.";
        default:
            return "This message couldn't be decrypted.";
    }
}

/**
 * The messages to show, with each run of messages sent before you joined cut down to its first
 * message, which stands for the whole run. `stillUnreadable` can keep one out of the runs: one
 * whose edit, sent after you joined, can be read.
 */
export function collapseSentBeforeJoining<T extends DecryptionState>(
    events: readonly T[],
    stillUnreadable: (event: T) => boolean = () => true,
): T[] {
    const shown: T[] = [];
    let inRun = false;
    for (const event of events) {
        const beforeJoining = isSentBeforeJoining(event) && stillUnreadable(event);
        if (!beforeJoining || !inRun) {
            shown.push(event);
        }
        inRun = beforeJoining;
    }
    return shown;
}
