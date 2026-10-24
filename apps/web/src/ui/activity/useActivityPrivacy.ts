import { useCallback, useEffect, useState } from "react";
import { ClientEvent, type MatrixClient, type MatrixEvent } from "matrix-js-sdk/src/matrix";

import {
    ACTIVITY_PRIVACY_EVENT,
    migratedActivityPrivacy,
    parseActivityPrivacy,
    type ActivityPrivacySettings,
} from "../../core/activity/activityPrivacy";

export interface ActivityPrivacyController {
    settings: ActivityPrivacySettings;
    save: (next: ActivityPrivacySettings) => Promise<void>;
}

function readSettings(client: MatrixClient | null): ActivityPrivacySettings {
    return parseActivityPrivacy(client?.getAccountData(ACTIVITY_PRIVACY_EVENT as any)?.getContent());
}

/** The user's activity privacy settings, from account data, kept current as any of their devices changes them. */
export function useActivityPrivacy(client: MatrixClient | null): ActivityPrivacyController {
    const [settings, setSettings] = useState<ActivityPrivacySettings>(() => readSettings(client));

    useEffect(() => {
        setSettings(readSettings(client));
        if (!client) {
            return;
        }
        const onAccountData = (event: MatrixEvent): void => {
            if (event.getType() === ACTIVITY_PRIVACY_EVENT) {
                setSettings(parseActivityPrivacy(event.getContent()));
            }
        };
        client.on(ClientEvent.AccountData, onAccountData);
        return () => {
            client.removeListener(ClientEvent.AccountData, onAccountData);
        };
    }, [client]);

    const save = useCallback(
        async (next: ActivityPrivacySettings): Promise<void> => {
            if (!client) {
                return;
            }
            setSettings(next);
            try {
                await client.setAccountData(ACTIVITY_PRIVACY_EVENT as any, next as any);
            } catch (error) {
                setSettings(readSettings(client));
                throw error;
            }
        },
        [client],
    );

    return { settings, save };
}

/**
 * Carries 1.0.27's "Show the game I'm playing" over to activity privacy, once: only when the account
 * has no activity privacy settings yet, so it never undoes a choice made on another device. That
 * isn't known until the first sync is in, so it waits for that.
 */
export function useActivityPrivacyMigration(
    client: MatrixClient | null,
    legacyShareGameActivity: boolean,
    onMigrated: () => void,
): void {
    useEffect(() => {
        if (!client || !legacyShareGameActivity) {
            return;
        }
        let started = false;
        const migrate = (): void => {
            if (started || !client.isInitialSyncComplete()) {
                return;
            }
            started = true;
            client.removeListener(ClientEvent.Sync, migrate);
            if (client.getAccountData(ACTIVITY_PRIVACY_EVENT as any)) {
                onMigrated();
                return;
            }
            // On failure the old switch stays on, so the next start tries again.
            void client
                .setAccountData(ACTIVITY_PRIVACY_EVENT as any, migratedActivityPrivacy() as any)
                .then(onMigrated, () => undefined);
        };
        client.on(ClientEvent.Sync, migrate);
        migrate();
        return () => {
            client.removeListener(ClientEvent.Sync, migrate);
        };
    }, [client, legacyShareGameActivity, onMigrated]);
}
