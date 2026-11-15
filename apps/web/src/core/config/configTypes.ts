import type { IClientWellKnown } from "matrix-js-sdk/src/matrix";

export interface CoreConfig {
    default_server_config?: IClientWellKnown;
    default_server_name?: string;
    default_hs_url?: string;
    default_is_url?: string;
    disable_custom_urls?: boolean;
    disable_guests?: boolean;
    brand?: string;
    setting_defaults?: Record<string, unknown>;
    features?: Record<string, boolean>;
    sync_timeline_limit?: number;
    voice_enabled?: boolean;
    voice_service_url?: string;
    /** Where people manage their sign-in codes and passkeys, on servers that offer two-factor sign-in (Settings > My Account). */
    account_management_url?: string;
    /** Where Settings asks the server to email a two-factor setup link (account.jorvik.app/jorvik/two-factor). */
    two_factor_request_url?: string;
    livekit_ws_url?: string;
    // The push gateway for notifications (see core/push/webPush.ts).
    web_push?: {
        gateway_url?: string;
        app_id?: string;
        vapid_public_key?: string;
    };
    [key: string]: unknown;
}
