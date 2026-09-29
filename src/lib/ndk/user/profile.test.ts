import { describe, expect, it } from "vitest";
import type { NDKEvent } from "../events/index";
import { profileFromEvent, serializeProfile, type NDKUserProfile } from "./profile";

describe("serializeProfile picture compatibility", () => {
    it.each<[string, NDKUserProfile, string | undefined]>([
        ["new picture with an undefined legacy alias", { picture: "https://example.com/new.png", image: undefined }, "https://example.com/new.png"],
        ["new picture before a stale legacy alias", { picture: "https://example.com/new.png", image: "https://example.com/old.png" }, "https://example.com/new.png"],
        ["new picture after a stale legacy alias", { image: "https://example.com/old.png", picture: "https://example.com/new.png" }, "https://example.com/new.png"],
        ["explicitly cleared picture", { picture: "", image: "https://example.com/old.png" }, ""],
        ["legacy image only", { image: "https://example.com/legacy.png" }, "https://example.com/legacy.png"],
        ["legacy image with undefined picture", { image: "https://example.com/legacy.png", picture: undefined }, "https://example.com/legacy.png"],
        ["no image", {}, undefined],
    ])("preserves %s", (_name, profile, picture) => {
        const payload = JSON.parse(serializeProfile({ ...profile, about: "Unchanged bio" }));
        expect(payload.picture).toBe(picture);
        expect(payload).not.toHaveProperty("image");
        expect(payload.about).toBe("Unchanged bio");
        const event = {
            content: JSON.stringify(profile),
            created_at: 1,
            rawEvent: () => ({ kind: 0, content: JSON.stringify(profile) }),
        } as NDKEvent;
        const parsed = profileFromEvent(event);
        expect(parsed.picture).toBe(picture);
        expect(parsed.image).toBe(picture);
    });
});

describe("serializeProfile canonical metadata", () => {
    it.each([
        ["name", "username"],
        ["display_name", "displayName"],
        ["about", "bio"],
    ])("preserves %s when the legacy %s alias is present", (canonical, alias) => {
        for (const staleValue of [undefined, "Old value"]) {
            for (const value of ["Current value", ""]) {
                for (const profile of [
                    { [canonical]: value, [alias]: staleValue },
                    { [alias]: staleValue, [canonical]: value },
                ]) {
                    const payload = JSON.parse(serializeProfile(profile));
                    expect(payload).toEqual({ [canonical]: value });
                }
            }
        }
        expect(JSON.parse(serializeProfile({ [alias]: "Legacy value" })))
            .toEqual({ [canonical]: "Legacy value" });
    });
});
