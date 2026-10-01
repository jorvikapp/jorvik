export {
    attemptAutomaticKeyBackupRestore,
    bootstrapSecretStorageSetup,
    completeFirstTimeSetup,
    createSecretStorageSetupKey,
    isRecoveryKeyValid,
    newKeyReplacesKeyBackup,
    restoreKeyBackupWithRecoveryKey,
    restoreKeyBackupWithSecretStorageCredential,
    SetupUnfinishedError,
    triggerRoomHistoryDecryption,
} from "../../core/crypto/securityRecoveryFlow";
export type {
    AutomaticRecoveryResult,
    AutomaticRecoveryStatus,
    RecoveryCredentialType,
    SecurityRecoveryFlow,
} from "../../core/crypto/securityRecoveryFlow";
export {
    completeCrossSigningWithRecoveryKey,
    createKeyBackupWithRecoveryKey,
    finishSetupWithRecoveryKey,
    getCrossSigningSituation,
    requestCrossSigningKeysFromOtherSessions,
    resetCrossSigningIdentity,
    StaleCrossSigningKeysError,
    waitForCrossSigningKeys,
} from "../../core/crypto/crossSigning";
export type { CrossSigningSituation } from "../../core/crypto/crossSigning";
