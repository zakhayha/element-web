/*
Copyright 2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { MatrixClientPeg } from "../MatrixClientPeg";
import { Action } from "../dispatcher/actions";
import defaultDispatcher from "../dispatcher/dispatcher";
import { ActionPayload } from "../dispatcher/payloads";
import { ViewRoomPayload } from "../dispatcher/payloads/ViewRoomPayload";
import { leaveRoomBehaviour } from "../utils/leave-behaviour";

/**
 * Manages temporary rooms - ensures only one exists at a time and handles auto-deletion
 * when users navigate away from temporary rooms.
 */
export class TemporaryRoomManager {
    private static instance: TemporaryRoomManager;
    private currentTemporaryRoomId: string | null = null;
    private dispatcherRef: string | null = null;

    public static getInstance(): TemporaryRoomManager {
        if (!TemporaryRoomManager.instance) {
            TemporaryRoomManager.instance = new TemporaryRoomManager();
        }
        return TemporaryRoomManager.instance;
    }

    private constructor() {
        this.dispatcherRef = defaultDispatcher.register(this.onAction);
    }

    public destroy(): void {
        if (this.dispatcherRef) {
            defaultDispatcher.unregister(this.dispatcherRef);
            this.dispatcherRef = null;
        }
    }

    /**
     * Registers a room as the current temporary room
     */
    public setCurrentTemporaryRoom(roomId: string): void {
        this.currentTemporaryRoomId = roomId;
    }

    /**
     * Gets the current temporary room ID
     */
    public getCurrentTemporaryRoomId(): string | null {
        return this.currentTemporaryRoomId;
    }

    /**
     * Checks if a room is a temporary room
     */
    public isTemporaryRoom(roomId: string): boolean {
        const client = MatrixClientPeg.get();
        if (!client) return false;

        const room = client.getRoom(roomId);
        if (!room) return false;

        const temporaryState = room.currentState.getStateEvents("m.room.temporary", "");
        return temporaryState && temporaryState.getContent().is_temporary;
    }

    /**
     * Deletes the current temporary room if it exists
     */
    private async deleteCurrentTemporaryRoom(): Promise<void> {
        if (!this.currentTemporaryRoomId) return;

        const client = MatrixClientPeg.get();
        if (!client) return;

        const room = client.getRoom(this.currentTemporaryRoomId);
        if (!room) {
            this.currentTemporaryRoomId = null;
            return;
        }

        // Verify it's actually a temporary room before deleting
        if (!this.isTemporaryRoom(this.currentTemporaryRoomId)) {
            this.currentTemporaryRoomId = null;
            return;
        }

        try {
            // Leave the room (which effectively deletes it for the user)
            await leaveRoomBehaviour(client, this.currentTemporaryRoomId, false, false);
        } catch (error) {
            // Silently handle errors - room leaving will show its own error UI if needed
        } finally {
            this.currentTemporaryRoomId = null;
        }
    }

    private onAction = (payload: ActionPayload): void => {
        if (payload.action === Action.ViewRoom) {
            const viewRoomPayload = payload as ViewRoomPayload;
            const newRoomId = viewRoomPayload.room_id;

            // If we're navigating to a different room and we have a current temporary room
            if (newRoomId && this.currentTemporaryRoomId && newRoomId !== this.currentTemporaryRoomId) {
                // Delete the previous temporary room
                this.deleteCurrentTemporaryRoom();
            }

            // If the new room is a temporary room, set it as current
            if (newRoomId && this.isTemporaryRoom(newRoomId)) {
                this.setCurrentTemporaryRoom(newRoomId);
            }
        }
    };
}

// Initialize the singleton instance
export const temporaryRoomManager = TemporaryRoomManager.getInstance();
