/*
Copyright 2025 New Vector Ltd.
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type MatrixClient, type Room, RoomStateEvent, type MatrixEvent, EventType } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { logger } from "matrix-js-sdk/src/logger";

import { DefaultTagID } from "./room-list/models";
import RoomListStore from "./room-list/RoomListStore";
import { tagRoom } from "../utils/room/tagRoom";

/**
 * Manages Personal Room privacy behavior:
 * - Personal rooms are private by default (only user + AI)
 * - When someone is invited to a Personal room, it automatically loses the Personal tag
 * - This makes the room visible to others and removes the "personal" privacy
 */
export class PersonalRoomManager {
    private static instance: PersonalRoomManager;
    private matrixClient: MatrixClient | null = null;

    private constructor() {}

    public static getInstance(): PersonalRoomManager {
        if (!PersonalRoomManager.instance) {
            PersonalRoomManager.instance = new PersonalRoomManager();
        }
        return PersonalRoomManager.instance;
    }

    public start(matrixClient: MatrixClient): void {
        if (this.matrixClient) {
            this.stop();
        }

        this.matrixClient = matrixClient;

        // Listen for room state events - this is the primary way to catch membership changes
        this.matrixClient.on(RoomStateEvent.Events, this.onRoomStateChange);

        // Also listen for new member events as backup
        this.matrixClient.on(RoomStateEvent.NewMember, this.onNewMember);

        // Expose to global scope for debugging
        if (typeof window !== 'undefined') {
            (window as any).mxPersonalRoomManager = this;
            (window as any).mxRoomListStore = RoomListStore;
            (window as any).mxMatrixClient = matrixClient;
            (window as any).tagRoom = tagRoom;
        }

        logger.log("PersonalRoomManager started - listening for membership events");
    }

    public stop(): void {
        if (this.matrixClient) {
            this.matrixClient.removeListener(RoomStateEvent.Events, this.onRoomStateChange);
            this.matrixClient.removeListener(RoomStateEvent.NewMember, this.onNewMember);
            this.matrixClient = null;
        }
        logger.log("PersonalRoomManager stopped");
    }

    private onRoomStateChange = (event: MatrixEvent): void => {
        if (!this.matrixClient) return;

        // Only handle room member events
        if (event.getType() !== EventType.RoomMember) return;

        const roomId = event.getRoomId();
        const userId = event.getStateKey();
        const membership = event.getContent().membership;
        const prevMembership = event.getPrevContent()?.membership;

        logger.log(`PersonalRoomManager: Room state change event`, {
            eventType: event.getType(),
            roomId,
            userId,
            membership,
            prevMembership,
            eventId: event.getId()
        });

        if (!roomId || !userId) return;

        const room = this.matrixClient.getRoom(roomId);
        if (!room) {
            logger.log(`PersonalRoomManager: Room not found for ${roomId}`);
            return;
        }

        // Skip if this is the user themselves
        const currentUserId = this.matrixClient.getUserId();
        if (userId === currentUserId) {
            logger.log(`PersonalRoomManager: Ignoring own membership change for ${userId}`);
            return;
        }

        // Get current room tags
        const roomTags = RoomListStore.instance.getTagsForRoom(room);
        const isCurrentlyPersonal = roomTags.includes(DefaultTagID.Personal);

        logger.log(`PersonalRoomManager: Room ${roomId} analysis`, {
            roomName: room.name,
            isCurrentlyPersonal,
            roomTags,
            memberCount: room.getJoinedMembers().length,
            members: room.getJoinedMembers().map(m => ({ userId: m.userId, membership: m.membership }))
        });

        // Handle membership changes
        if (membership === KnownMembership.Invite || membership === KnownMembership.Join) {
            // Someone joined or was invited
            if (isCurrentlyPersonal) {
                logger.log(`Personal room ${roomId} has new member ${userId}, checking if conversion needed`);

                // Check if the room should still be considered personal
                const shouldBePersonal = this.shouldRoomBePersonal(room);
                logger.log(`PersonalRoomManager: Should room ${roomId} remain personal? ${shouldBePersonal}`);

                if (!shouldBePersonal) {
                    logger.log(`Converting personal room ${roomId} to regular room due to new member ${userId}`);
                    this.removePersonalTag(room);
                }
            }
        } else if (membership === KnownMembership.Leave || membership === KnownMembership.Ban) {
            // Someone left or was banned
            if (!isCurrentlyPersonal) {
                // Check if this room should become personal again
                if (this.shouldRoomBePersonal(room)) {
                    logger.log(`Converting regular room ${roomId} back to personal room after member ${userId} left`);
                    this.addPersonalTag(room);
                }
            }
        }
    };

    private onNewMember = (event: MatrixEvent, state: any, member: any): void => {
        if (!this.matrixClient) return;

        logger.log(`PersonalRoomManager: New member event received`, {
            eventType: event?.getType(),
            roomId: member?.roomId,
            userId: member?.userId,
            membership: member?.membership,
            eventId: event?.getId()
        });

        // Delegate to the main handler
        this.onRoomStateChange(event);
    };

    private removePersonalTag(room: Room): void {
        try {
            logger.log(`PersonalRoomManager: About to remove Personal tag from room ${room.roomId}`);

            // Check current tags before removal
            const tagsBefore = RoomListStore.instance.getTagsForRoom(room);
            logger.log(`PersonalRoomManager: Tags before removal:`, tagsBefore);

            // Use the existing tagRoom function to remove the Personal tag
            // This will toggle it off since it's currently on
            tagRoom(room, DefaultTagID.Personal);

            // Check tags after removal (may be async, so this might not show immediate change)
            setTimeout(() => {
                const tagsAfter = RoomListStore.instance.getTagsForRoom(room);
                logger.log(`PersonalRoomManager: Tags after removal:`, tagsAfter);
            }, 100);

            logger.log(`PersonalRoomManager: Successfully triggered removal of Personal tag from room ${room.roomId}`);
        } catch (error) {
            logger.error(`PersonalRoomManager: Failed to remove Personal tag from room ${room.roomId}:`, error);
        }
    }

    private addPersonalTag(room: Room): void {
        try {
            logger.log(`PersonalRoomManager: About to add Personal tag to room ${room.roomId}`);

            // Check current tags before addition
            const tagsBefore = RoomListStore.instance.getTagsForRoom(room);
            logger.log(`PersonalRoomManager: Tags before addition:`, tagsBefore);

            // Use the existing tagRoom function to add the Personal tag
            // This will toggle it on since it's currently off
            tagRoom(room, DefaultTagID.Personal);

            // Check tags after addition (may be async, so this might not show immediate change)
            setTimeout(() => {
                const tagsAfter = RoomListStore.instance.getTagsForRoom(room);
                logger.log(`PersonalRoomManager: Tags after addition:`, tagsAfter);
            }, 100);

            logger.log(`PersonalRoomManager: Successfully triggered addition of Personal tag to room ${room.roomId}`);
        } catch (error) {
            logger.error(`PersonalRoomManager: Failed to add Personal tag to room ${room.roomId}:`, error);
        }
    }

    /**
     * Check if a room should be considered "private" (Personal room with only the user)
     */
    public isPersonalRoomPrivate(room: Room): boolean {
        if (!this.matrixClient) return false;

        // Check if room has Personal tag
        const roomTags = RoomListStore.instance.getTagsForRoom(room);
        if (!roomTags.includes(DefaultTagID.Personal)) {
            return false;
        }

        return this.shouldRoomBePersonal(room);
    }

    /**
     * Determine if a room should remain personal based on its membership
     * Personal rooms should only contain:
     * 1. The main user
     * 2. AI assistants (identified by specific patterns)
     */
    private shouldRoomBePersonal(room: Room): boolean {
        if (!this.matrixClient) return false;

        const members = room.getJoinedMembers();
        const currentUserId = this.matrixClient.getUserId();

        logger.log(`PersonalRoomManager: Analyzing room ${room.roomId} membership`, {
            totalMembers: members.length,
            currentUserId,
            members: members.map(m => ({
                userId: m.userId,
                membership: m.membership,
                isCurrentUser: m.userId === currentUserId,
                isAI: this.isAIAssistant(m.userId)
            }))
        });

        // Count human members (excluding the current user and AI assistants)
        const humanMembers = members.filter(member => {
            if (member.userId === currentUserId) return false;

            // Check if this is an AI assistant
            if (this.isAIAssistant(member.userId)) {
                logger.log(`PersonalRoomManager: Identified AI assistant: ${member.userId}`);
                return false;
            }

            // This is a human member
            logger.log(`PersonalRoomManager: Identified human member: ${member.userId}`);
            return true;
        });

        const shouldBePersonal = humanMembers.length === 0;
        logger.log(`PersonalRoomManager: Room ${room.roomId} should be personal: ${shouldBePersonal} (${humanMembers.length} human members)`);

        // Personal room should have no human members other than the main user
        return shouldBePersonal;
    }

    /**
     * Check if a user ID belongs to an AI assistant
     * This can be customized based on your AI assistant naming conventions
     */
    private isAIAssistant(userId: string): boolean {
        // Common patterns for AI assistants - customize as needed
        const aiPatterns = [
            /^@ai[_-]?assistant/i,
            /^@bot[_-]/i,
            /^@assistant[_-]/i,
            /^@chatbot/i,
            /^@gpt/i,
            /^@claude/i,
            /^@groq_/i,       // More specific: matches @groq_ (with underscore)
            /^@llama/i,       // Added for LLaMA models
            // Add more patterns as needed for your specific AI assistants
        ];

        const isAI = aiPatterns.some(pattern => pattern.test(userId));
        logger.log(`PersonalRoomManager: AI check for ${userId}: ${isAI}`);
        return isAI;
    }

    /**
     * Manually check and convert room types for all personal rooms
     * Useful for debugging and fixing any inconsistencies
     */
    public checkAllPersonalRooms(): void {
        if (!this.matrixClient) {
            logger.warn("PersonalRoomManager: Cannot check rooms - no matrix client");
            return;
        }

        logger.log("PersonalRoomManager: Manually checking all personal rooms");

        const rooms = this.matrixClient.getRooms();
        let checkedCount = 0;
        let convertedCount = 0;

        rooms.forEach(room => {
            const roomTags = RoomListStore.instance.getTagsForRoom(room);
            const isCurrentlyPersonal = roomTags.includes(DefaultTagID.Personal);

            if (isCurrentlyPersonal) {
                checkedCount++;
                logger.log(`PersonalRoomManager: Checking personal room ${room.roomId} (${room.name})`);

                if (!this.shouldRoomBePersonal(room)) {
                    logger.log(`PersonalRoomManager: Converting ${room.roomId} to regular room`);
                    this.removePersonalTag(room);
                    convertedCount++;
                }
            }
        });

        logger.log(`PersonalRoomManager: Manual check complete - checked ${checkedCount} rooms, converted ${convertedCount}`);
    }
}
