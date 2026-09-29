import type { NDKEvent } from "../events/index.js";

/**
 * NDKUserProfile represents a user's kind 0 profile metadata
 */
export interface NDKUserProfile {
    [key: string]: string | number | undefined; // allows custom fields
    created_at?: number;
    name?: string;
    displayName?: string;

    /**
     * @deprecated Use picture instead
     */
    image?: string;
    picture?: string;
    banner?: string;
    bio?: string;
    nip05?: string;
    lud06?: string;
    lud16?: string;
    about?: string;
    website?: string;
    profileEvent?: string;
}

export function profileFromEvent(event: NDKEvent): NDKUserProfile {
    const profile: NDKUserProfile = {};
    let payload: NDKUserProfile;

    try {
        payload = JSON.parse(event.content);
    } catch (error) {
        throw new Error(`Failed to parse profile event: ${error}`);
    }

    for (const key of Object.keys(payload)) {
        switch (key) {
            case "name":
                profile.name = payload.name;
                break;
            case "display_name":
                profile.displayName = payload.display_name as string;
                break;
            case "image":
            case "picture":
                profile.picture = (payload.picture ?? payload.image) as string;
                profile.image = profile.picture;
                break;
            case "banner":
                profile.banner = payload.banner;
                break;
            case "bio":
                profile.bio = payload.bio;
                break;
            case "nip05":
                profile.nip05 = payload.nip05;
                break;
            case "lud06":
                profile.lud06 = payload.lud06;
                break;
            case "lud16":
                profile.lud16 = payload.lud16;
                break;
            case "about":
                profile.about = payload.about;
                break;
            case "website":
                profile.website = payload.website;
                break;
            default:
                profile[key] = payload[key];
                break;
        }
    }

    // Keep the source envelope even when its content has a custom profileEvent field.
    profile.profileEvent = JSON.stringify(event.rawEvent());
    profile.created_at = event.created_at;

    return profile;
}

export function serializeProfile(profile: NDKUserProfile): string {
    const payload: NDKUserProfile = {};

    // Normalize legacy aliases without overwriting canonical fields or explicit clears.
    for (const [key, val] of Object.entries(profile)) {
        switch (key) {
            case "username":
            case "name":
                payload.name = (profile.name ?? profile.username) as string;
                break;
            case "display_name":
            case "displayName":
                payload.display_name = profile.display_name ?? profile.displayName;
                break;
            case "image":
            case "picture":
                payload.picture = profile.picture ?? profile.image;
                break;
            case "bio":
            case "about":
                payload.about = profile.about ?? profile.bio;
                break;
            default:
                payload[key] = val;
                break;
        }
    }

    return JSON.stringify(payload);
}
