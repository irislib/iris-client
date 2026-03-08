import NDK, { type NDKEventId, NDKRelay, NDKSubscription } from "../index.js";
import { beforeEach, describe, expect, it } from "vitest";
import { NDKSubscriptionManager } from "./manager.js";

const ndk = new NDK();

describe("NDKSubscriptionManager", () => {
    let manager: NDKSubscriptionManager;

    beforeEach(() => {
        manager = new NDKSubscriptionManager();
    });

    it("should add a subscription", () => {
        const sub = new NDKSubscription(ndk, {});
        manager.add(sub);
        expect(manager.subscriptions.has(sub.internalId)).toBe(true);
    });

    // it("should remove a subscription on close", () => {
    //     const sub: NDKSubscription = {
    //         internalId: "sub2",
    //         on: jest.fn(),
    //         // Add other necessary properties
    //     };
    //     manager.add(sub);
    //     expect(manager.subscriptions.has("sub2")).toBe(true);

    //     // Simulate the 'close' event
    //     const closeCallback = sub.on.mock.calls.find(call => call[0] === "close")?.[1];
    //     if (closeCallback) {
    //         closeCallback();
    //     }

    //     expect(manager.subscriptions.has("sub2")).toBe(false);
    // });

    it("should record seen events", () => {
        const eventId: NDKEventId = "event1";
        const relay = new NDKRelay("wss://example.com", undefined, ndk);
        manager.seenEvent(eventId, relay);
        const seenData = manager.seenEvents.get(eventId);
        expect(seenData?.relays).toContain(relay);
    });

    it("should not add duplicate relays with the same URL", () => {
        const eventId: NDKEventId = "event2";
        const relay = new NDKRelay("wss://f7z.io/", undefined, ndk);

        // Call seenEvent multiple times with the same relay
        manager.seenEvent(eventId, relay);
        manager.seenEvent(eventId, relay);
        manager.seenEvent(eventId, relay);
        manager.seenEvent(eventId, relay);
        manager.seenEvent(eventId, relay);
        manager.seenEvent(eventId, relay);
        manager.seenEvent(eventId, relay);
        manager.seenEvent(eventId, relay);

        const seenData = manager.seenEvents.get(eventId);
        expect(seenData).toBeDefined();
        expect(seenData?.relays.length).toBe(1);
        expect(seenData?.relays[0]).toBe(relay);
    });
});
