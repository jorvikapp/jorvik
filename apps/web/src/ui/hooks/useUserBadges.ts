import { useSyncExternalStore } from "react";

import {
    getBadgeSettings,
    getUserBadges,
    subscribeUserBadges,
    type BadgeId,
    type BadgeSettings,
} from "../../core/badges/userBadges";

export function useUserBadges(userId: string | null | undefined): readonly BadgeId[] {
    return useSyncExternalStore(subscribeUserBadges, () => getUserBadges(userId));
}

export function useBadgeSettings(): BadgeSettings {
    return useSyncExternalStore(subscribeUserBadges, getBadgeSettings);
}
