/*
 * Copyright 2025 New Vector Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { useCallback, useMemo } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";

import { useMatrixClientContext } from "../../../contexts/MatrixClientContext";
import { useEventEmitterState } from "../../../hooks/useEventEmitter";
import { useUnreadNotifications } from "../../../hooks/useUnreadNotifications";
import { hasAccessToNotificationMenu, hasAccessToOptionsMenu } from "./utils";
import DMRoomMap from "../../../utils/DMRoomMap";
import { DefaultTagID } from "../../../stores/room-list/models";
import { NotificationLevel } from "../../../stores/notifications/NotificationLevel";
import { shouldShowComponent } from "../../../customisations/helpers/UIComponents";
import { UIComponent } from "../../../settings/UIFeature";
import dispatcher from "../../../dispatcher/dispatcher";
import RoomListStore, { LISTS_UPDATE_EVENT } from "../../../stores/room-list/RoomListStore";
import { clearRoomNotification, setMarkedUnreadState } from "../../../utils/notifications";
import PosthogTrackers from "../../../PosthogTrackers";
import { tagRoom } from "../../../utils/room/tagRoom";
import { RoomNotifState } from "../../../RoomNotifs";
import { useNotificationState } from "../../../hooks/useRoomNotificationState";

export interface RoomListItemMenuViewState {
    /**
     * Whether the more options menu should be shown.
     */
    showMoreOptionsMenu: boolean;
    /**
     * Whether the notification menu should be shown.
     */
    showNotificationMenu: boolean;
    /**
     * Whether the room is a favourite room.
     */
    isFavourite: boolean;
    /**
     * Whether the room is a personal room.
     */
    isPersonal: boolean;
    /**
     * Whether the personal room option should be shown in the menu.
     */
    showPersonalOption: boolean;
    /**
     * Can invite other user's in the room.
     */
    canInvite: boolean;
    /**
     * Can copy the room link.
     */
    canCopyRoomLink: boolean;
    /**
     * Can mark the room as read.
     */
    canMarkAsRead: boolean;
    /**
     * Can mark the room as unread.
     */
    canMarkAsUnread: boolean;
    /**
     * Whether the notification is set to all messages.
     */
    isNotificationAllMessage: boolean;
    /**
     * Whether the notification is set to all messages loud.
     */
    isNotificationAllMessageLoud: boolean;
    /**
     * Whether the notification is set to mentions and keywords only.
     */
    isNotificationMentionOnly: boolean;
    /**
     * Whether the notification is muted.
     */
    isNotificationMute: boolean;
    /**
     * Mark the room as read.
     * @param evt
     */
    markAsRead: (evt: Event) => void;
    /**
     * Mark the room as unread.
     * @param evt
     */
    markAsUnread: (evt: Event) => void;
    /**
     * Toggle the room as favourite.
     * @param evt
     */
    toggleFavorite: (evt: Event) => void;
    /**
     * Toggle the room as low priority.
     */
    toggleLowPriority: () => void;
    /**
     * Toggle the room as personal.
     */
    togglePersonal: () => void;
    /**
     * Invite other users in the room.
     * @param evt
     */
    invite: (evt: Event) => void;
    /**
     * Copy the room link in the clipboard.
     * @param evt
     */
    copyRoomLink: (evt: Event) => void;
    /**
     * Leave the room.
     * @param evt
     */
    leaveRoom: (evt: Event) => void;
    /**
     * Set the room notification state.
     * @param state
     */
    setRoomNotifState: (state: RoomNotifState) => void;
}

export function useRoomListItemMenuViewModel(room: Room): RoomListItemMenuViewState {
    const matrixClient = useMatrixClientContext();
    // Listen to RoomListStore for tag changes instead of room.tags
    const roomTagsArray = useEventEmitterState(RoomListStore.instance, LISTS_UPDATE_EVENT, () =>
        RoomListStore.instance.getTagsForRoom(room),
    );
    const { level: notificationLevel } = useUnreadNotifications(room);

    const isDm = Boolean(DMRoomMap.shared().getUserIdForRoomId(room.roomId));
    const isFavourite = roomTagsArray.includes(DefaultTagID.Favourite);
    const isPersonal = roomTagsArray.includes(DefaultTagID.Personal);
    const isArchived = roomTagsArray.includes(DefaultTagID.Archived);

    // Determine if the Personal room option should be shown
    // Show it only when the room could potentially be personal (0 human members)
    const showPersonalOption = useMemo(() => {
        const joinedMembers = room.getJoinedMembers();
        const currentUserId = matrixClient.getUserId();

        // Count human members (excluding current user and AI assistants)
        const humanMembers = joinedMembers.filter(member => {
            if (member.userId === currentUserId) return false;

            // Simple AI detection patterns (matching PersonalRoomManager logic)
            const userId = member.userId;
            const aiPatterns = [
                /^@ai[_-]?assistant/i,
                /^@bot[_-]/i,
                /^@assistant[_-]/i,
                /^@chatbot/i,
                /^@gpt/i,
                /^@claude/i,
                /^@groq_/i,
                /^@llama/i,
            ];

            const isAI = aiPatterns.some(pattern => pattern.test(userId));
            return !isAI; // Return true for human members
        });

        // Only show personal option if there are 0 human members
        // This means the room could be personal (user + AI only)
        return humanMembers.length === 0;
    }, [room, matrixClient]);

    const showMoreOptionsMenu = hasAccessToOptionsMenu(room);
    const showNotificationMenu = hasAccessToNotificationMenu(room, matrixClient.isGuest(), isArchived);

    const canMarkAsRead = notificationLevel > NotificationLevel.None;
    const canMarkAsUnread = !canMarkAsRead && !isArchived;

    const canInvite =
        room.canInvite(matrixClient.getUserId()!) && !isDm && shouldShowComponent(UIComponent.InviteUsers);
    const canCopyRoomLink = !isDm;

    const [roomNotifState, setRoomNotifState] = useNotificationState(room);
    const isNotificationAllMessage = roomNotifState === RoomNotifState.AllMessages;
    const isNotificationAllMessageLoud = roomNotifState === RoomNotifState.AllMessagesLoud;
    const isNotificationMentionOnly = roomNotifState === RoomNotifState.MentionsOnly;
    const isNotificationMute = roomNotifState === RoomNotifState.Mute;

    // Actions

    const markAsRead = useCallback(
        async (evt: Event): Promise<void> => {
            await clearRoomNotification(room, matrixClient);
            PosthogTrackers.trackInteraction("WebRoomListRoomTileContextMenuMarkRead", evt);
        },
        [room, matrixClient],
    );

    const markAsUnread = useCallback(
        async (evt: Event): Promise<void> => {
            await setMarkedUnreadState(room, matrixClient, true);
            PosthogTrackers.trackInteraction("WebRoomListRoomTileContextMenuMarkUnread", evt);
        },
        [room, matrixClient],
    );

    const toggleFavorite = useCallback(
        (evt: Event): void => {
            tagRoom(room, DefaultTagID.Favourite);
            PosthogTrackers.trackInteraction("WebRoomListRoomTileContextMenuFavouriteToggle", evt);
        },
        [room],
    );

    const toggleLowPriority = useCallback((): void => tagRoom(room, DefaultTagID.LowPriority), [room]);

    const togglePersonal = useCallback((): void => tagRoom(room, DefaultTagID.Personal), [room]);

    const invite = useCallback(
        (evt: Event): void => {
            dispatcher.dispatch({
                action: "view_invite",
                roomId: room.roomId,
            });
            PosthogTrackers.trackInteraction("WebRoomListRoomTileContextMenuInviteItem", evt);
        },
        [room],
    );

    const copyRoomLink = useCallback(
        (evt: Event): void => {
            dispatcher.dispatch({
                action: "copy_room",
                room_id: room.roomId,
            });
            PosthogTrackers.trackInteraction("WebRoomListRoomTileContextMenuFavouriteToggle", evt);
        },
        [room],
    );

    const leaveRoom = useCallback(
        (evt: Event): void => {
            dispatcher.dispatch({
                action: isArchived ? "forget_room" : "leave_room",
                room_id: room.roomId,
            });
            PosthogTrackers.trackInteraction("WebRoomListRoomTileContextMenuLeaveItem", evt);
        },
        [room, isArchived],
    );

    return {
        showMoreOptionsMenu,
        showNotificationMenu,
        isFavourite,
        isPersonal,
        showPersonalOption,
        canInvite,
        canCopyRoomLink,
        canMarkAsRead,
        canMarkAsUnread,
        isNotificationAllMessage,
        isNotificationAllMessageLoud,
        isNotificationMentionOnly,
        isNotificationMute,
        markAsRead,
        markAsUnread,
        toggleFavorite,
        toggleLowPriority,
        togglePersonal,
        invite,
        copyRoomLink,
        leaveRoom,
        setRoomNotifState,
    };
}
