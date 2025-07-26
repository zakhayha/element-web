/*
Copyright 2025 New Vector Ltd.
SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type MatrixClient, type Room, RoomStateEvent, type MatrixEvent } from "matrix-js-sdk/src/matrix";
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
        this.matrixClient.on(RoomStateEvent.NewMember, this.onNewMember);
        logger.log("PersonalRoomManager started");
    }

    public stop(): void {
        if (this.matrixClient) {
            this.matrixClient.removeListener(RoomStateEvent.NewMember, this.onNewMember);
            this.matrixClient = null;
        }
        logger.log("PersonalRoomManager stopped");
    }

    private onNewMember = (event: MatrixEvent, state: any, member: any): void => {
        if (!this.matrixClient) return;

        const room = this.matrixClient.getRoom(member.roomId);
        if (!room) return;

        // Check if this room has the Personal tag
        const roomTags = RoomListStore.instance.getTagsForRoom(room);
        if (!roomTags.includes(DefaultTagID.Personal)) {
            return; // Not a personal room, ignore
        }

        // Check if this is an invitation (not the user themselves)
        const currentUserId = this.matrixClient.getUserId();
        if (member.userId === currentUserId) {
            return; // This is the user themselves, ignore
        }

        // Check if this is actually an invite or join
        if (member.membership === KnownMembership.Invite || member.membership === KnownMembership.Join) {
            logger.log(`Personal room ${room.roomId} has new member ${member.userId}, removing Personal tag`);
            
            // Remove the Personal tag since the room is no longer private
            this.removePersonalTag(room);
        }
    };

    private removePersonalTag(room: Room): void {
        try {
            // Use the existing tagRoom function to remove the Personal tag
            // This will toggle it off since it's currently on
            tagRoom(room, DefaultTagID.Personal);
            logger.log(`Removed Personal tag from room ${room.roomId} due to new member`);
        } catch (error) {
            logger.error(`Failed to remove Personal tag from room ${room.roomId}:`, error);
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

        // Check member count - should only be the user (and potentially AI bots)
        const members = room.getJoinedMembers();
        const currentUserId = this.matrixClient.getUserId();
        
        // Count non-bot members (excluding the current user)
        const humanMembers = members.filter(member => {
            if (member.userId === currentUserId) return false;
            // You might want to add logic here to identify AI bots
            // For now, we'll consider any other member as making it non-private
            return true;
        });

        return humanMembers.length === 0;
    }
}
