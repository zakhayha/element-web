/*
Copyright 2025 New Vector Ltd.
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { MatrixClient, Room, RoomMember, RoomStateEvent, RoomMemberEvent } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";

import { PersonalRoomManager } from "../../../src/stores/PersonalRoomManager";
import { DefaultTagID } from "../../../src/stores/room-list/models";
import RoomListStore from "../../../src/stores/room-list/RoomListStore";
import { tagRoom } from "../../../src/utils/room/tagRoom";
import { stubClient } from "../../test-utils";

// Mock the dependencies
jest.mock("../../../src/stores/room-list/RoomListStore");
jest.mock("../../../src/utils/room/tagRoom");

describe("PersonalRoomManager", () => {
    let mockClient: MatrixClient;
    let mockRoom: Room;
    let personalRoomManager: PersonalRoomManager;
    let mockRoomListStore: jest.Mocked<typeof RoomListStore>;
    let mockTagRoom: jest.MockedFunction<typeof tagRoom>;

    beforeEach(() => {
        mockClient = stubClient();
        mockRoom = new Room("!room:example.com", mockClient, "@user:example.com");
        personalRoomManager = PersonalRoomManager.getInstance();

        // Reset mocks
        mockRoomListStore = RoomListStore as jest.Mocked<typeof RoomListStore>;
        mockTagRoom = tagRoom as jest.MockedFunction<typeof tagRoom>;

        // Setup default mock implementations
        mockRoomListStore.instance = {
            getTagsForRoom: jest.fn(),
        } as any;

        mockTagRoom.mockClear();

        // Mock client methods
        mockClient.getUserId = jest.fn().mockReturnValue("@user:example.com");
        mockClient.getRoom = jest.fn().mockReturnValue(mockRoom);
        mockClient.on = jest.fn();
        mockClient.removeListener = jest.fn();
    });

    afterEach(() => {
        personalRoomManager.stop();
        jest.clearAllMocks();
    });

    describe("start and stop", () => {
        it("should register event listeners when started", () => {
            personalRoomManager.start(mockClient);

            expect(mockClient.on).toHaveBeenCalledWith(RoomStateEvent.NewMember, expect.any(Function));
            expect(mockClient.on).toHaveBeenCalledWith(RoomMemberEvent.Membership, expect.any(Function));
        });

        it("should remove event listeners when stopped", () => {
            personalRoomManager.start(mockClient);
            personalRoomManager.stop();

            expect(mockClient.removeListener).toHaveBeenCalledWith(RoomStateEvent.NewMember, expect.any(Function));
            expect(mockClient.removeListener).toHaveBeenCalledWith(RoomMemberEvent.Membership, expect.any(Function));
        });
    });

    describe("room type conversion", () => {
        beforeEach(() => {
            personalRoomManager.start(mockClient);
        });

        it("should convert personal room to regular when human user joins", () => {
            // Setup: Room is currently personal
            mockRoomListStore.instance.getTagsForRoom.mockReturnValue([DefaultTagID.Personal]);

            // Mock room members: user + AI assistant
            const userMember = { userId: "@user:example.com" } as RoomMember;
            const aiMember = { userId: "@ai_assistant:example.com" } as RoomMember;
            const humanMember = { userId: "@human:example.com" } as RoomMember;

            mockRoom.getJoinedMembers = jest.fn().mockReturnValue([userMember, aiMember]);

            // Simulate human user joining
            const membershipEvent = {
                roomId: "!room:example.com",
                userId: "@human:example.com",
                membership: KnownMembership.Join,
            };

            // Get the event handler that was registered
            const eventHandler = (mockClient.on as jest.Mock).mock.calls.find(
                call => call[0] === RoomMemberEvent.Membership
            )[1];

            // Update room members to include the new human member
            mockRoom.getJoinedMembers = jest.fn().mockReturnValue([userMember, aiMember, humanMember]);

            // Trigger the event
            eventHandler({}, {}, membershipEvent);

            // Should remove personal tag
            expect(mockTagRoom).toHaveBeenCalledWith(mockRoom, DefaultTagID.Personal);
        });

        it("should not convert personal room when AI assistant joins", () => {
            // Setup: Room is currently personal
            mockRoomListStore.instance.getTagsForRoom.mockReturnValue([DefaultTagID.Personal]);

            // Mock room members: user only
            const userMember = { userId: "@user:example.com" } as RoomMember;
            mockRoom.getJoinedMembers = jest.fn().mockReturnValue([userMember]);

            // Simulate AI assistant joining
            const membershipEvent = {
                roomId: "!room:example.com",
                userId: "@ai_assistant:example.com",
                membership: KnownMembership.Join,
            };

            // Get the event handler
            const eventHandler = (mockClient.on as jest.Mock).mock.calls.find(
                call => call[0] === RoomMemberEvent.Membership
            )[1];

            // Update room members to include AI
            const aiMember = { userId: "@ai_assistant:example.com" } as RoomMember;
            mockRoom.getJoinedMembers = jest.fn().mockReturnValue([userMember, aiMember]);

            // Trigger the event
            eventHandler({}, {}, membershipEvent);

            // Should NOT remove personal tag
            expect(mockTagRoom).not.toHaveBeenCalled();
        });

        it("should convert regular room back to personal when all humans leave", () => {
            // Setup: Room is currently regular (not personal)
            mockRoomListStore.instance.getTagsForRoom.mockReturnValue([]);

            // Mock room members: user + AI + human
            const userMember = { userId: "@user:example.com" } as RoomMember;
            const aiMember = { userId: "@ai_assistant:example.com" } as RoomMember;

            // Simulate human user leaving
            const membershipEvent = {
                roomId: "!room:example.com",
                userId: "@human:example.com",
                membership: KnownMembership.Leave,
            };

            // Get the event handler
            const eventHandler = (mockClient.on as jest.Mock).mock.calls.find(
                call => call[0] === RoomMemberEvent.Membership
            )[1];

            // Update room members after human leaves
            mockRoom.getJoinedMembers = jest.fn().mockReturnValue([userMember, aiMember]);

            // Trigger the event
            eventHandler({}, {}, membershipEvent);

            // Should add personal tag back
            expect(mockTagRoom).toHaveBeenCalledWith(mockRoom, DefaultTagID.Personal);
        });
    });

    describe("AI assistant detection", () => {
        beforeEach(() => {
            personalRoomManager.start(mockClient);
        });

        it("should identify AI assistants by common patterns", () => {
            const aiUserIds = [
                "@ai_assistant:example.com",
                "@bot_helper:example.com",
                "@assistant-gpt:example.com",
                "@chatbot:example.com",
                "@gpt4:example.com",
                "@claude:example.com",
            ];

            // Setup personal room
            mockRoomListStore.instance.getTagsForRoom.mockReturnValue([DefaultTagID.Personal]);

            const userMember = { userId: "@user:example.com" } as RoomMember;

            aiUserIds.forEach(aiUserId => {
                const aiMember = { userId: aiUserId } as RoomMember;
                mockRoom.getJoinedMembers = jest.fn().mockReturnValue([userMember, aiMember]);

                // Room should still be considered personal
                expect(personalRoomManager.isPersonalRoomPrivate(mockRoom)).toBe(true);
            });
        });

        it("should not identify regular users as AI assistants", () => {
            const humanUserIds = [
                "@john:example.com",
                "@alice.smith:example.com",
                "@user123:example.com",
            ];

            // Setup personal room
            mockRoomListStore.instance.getTagsForRoom.mockReturnValue([DefaultTagID.Personal]);

            const userMember = { userId: "@user:example.com" } as RoomMember;

            humanUserIds.forEach(humanUserId => {
                const humanMember = { userId: humanUserId } as RoomMember;
                mockRoom.getJoinedMembers = jest.fn().mockReturnValue([userMember, humanMember]);

                // Room should NOT be considered personal anymore
                expect(personalRoomManager.isPersonalRoomPrivate(mockRoom)).toBe(false);
            });
        });
    });

    describe("isPersonalRoomPrivate", () => {
        beforeEach(() => {
            personalRoomManager.start(mockClient);
        });

        it("should return false for rooms without personal tag", () => {
            mockRoomListStore.instance.getTagsForRoom.mockReturnValue([]);

            expect(personalRoomManager.isPersonalRoomPrivate(mockRoom)).toBe(false);
        });

        it("should return true for personal rooms with only user and AI", () => {
            mockRoomListStore.instance.getTagsForRoom.mockReturnValue([DefaultTagID.Personal]);

            const userMember = { userId: "@user:example.com" } as RoomMember;
            const aiMember = { userId: "@ai_assistant:example.com" } as RoomMember;
            mockRoom.getJoinedMembers = jest.fn().mockReturnValue([userMember, aiMember]);

            expect(personalRoomManager.isPersonalRoomPrivate(mockRoom)).toBe(true);
        });

        it("should return false for personal rooms with human members", () => {
            mockRoomListStore.instance.getTagsForRoom.mockReturnValue([DefaultTagID.Personal]);

            const userMember = { userId: "@user:example.com" } as RoomMember;
            const humanMember = { userId: "@human:example.com" } as RoomMember;
            mockRoom.getJoinedMembers = jest.fn().mockReturnValue([userMember, humanMember]);

            expect(personalRoomManager.isPersonalRoomPrivate(mockRoom)).toBe(false);
        });
    });
});
