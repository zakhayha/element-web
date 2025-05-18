/*
Copyright 2024 New Vector Ltd.
Copyright 2021, 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { EventType, RoomType, JoinRule, Preset, type Room, RoomEvent } from "matrix-js-sdk/src/matrix";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { logger } from "matrix-js-sdk/src/logger";
import React, { type JSX, useCallback, useContext, useRef, useState, useMemo, useEffect } from "react";

import MatrixClientContext from "../../contexts/MatrixClientContext";
import createRoom, { type IOpts } from "../../createRoom";
import { shouldShowComponent } from "../../customisations/helpers/UIComponents";
import { Action } from "../../dispatcher/actions";
import defaultDispatcher from "../../dispatcher/dispatcher";
import { type ActionPayload } from "../../dispatcher/payloads";
import { type ViewRoomPayload } from "../../dispatcher/payloads/ViewRoomPayload";
import * as Email from "../../email";
import { useEventEmitterState } from "../../hooks/useEventEmitter";
import { useMyRoomMembership } from "../../hooks/useRoomMembers";
import { useFeatureEnabled } from "../../hooks/useSettings";
import { useStateArray } from "../../hooks/useStateArray";
import { _t } from "../../languageHandler";
import PosthogTrackers from "../../PosthogTrackers";
import { inviteMultipleToRoom, showRoomInviteDialog } from "../../RoomInvite";
import { UIComponent } from "../../settings/UIFeature";
import { UPDATE_EVENT } from "../../stores/AsyncStore";
import RightPanelStore from "../../stores/right-panel/RightPanelStore";
import { RightPanelPhases } from "../../stores/right-panel/RightPanelStorePhases";
import ResizeNotifier from "../../utils/ResizeNotifier";
import {
    shouldShowSpaceInvite,
    shouldShowSpaceSettings,
    showAddExistingRooms,
    showCreateNewRoom,
    showCreateNewSubspace,
    showSpaceInvite,
    showSpaceSettings,
} from "../../utils/space";
import RoomAvatar from "../views/avatars/RoomAvatar";
import { BetaPill } from "../views/beta/BetaCard";
import IconizedContextMenu, {
    IconizedContextMenuOption,
    IconizedContextMenuOptionList,
} from "../views/context_menus/IconizedContextMenu";
import {
    AddExistingToSpace,
    defaultDmsRenderer,
    defaultRoomsRenderer,
} from "../views/dialogs/AddExistingToSpaceDialog";
import AccessibleButton, { type ButtonEvent } from "../views/elements/AccessibleButton";
import ErrorBoundary from "../views/elements/ErrorBoundary";
import Field from "../views/elements/Field";
import RoomFacePile from "../views/elements/RoomFacePile";
import RoomName from "../views/elements/RoomName";
import RoomTopic from "../views/elements/RoomTopic";
import withValidation from "../views/elements/Validation";
import RoomInfoLine from "../views/rooms/RoomInfoLine";
import RoomPreviewCard from "../views/rooms/RoomPreviewCard";
import SpacePublicShare from "../views/spaces/SpacePublicShare";
import { ChevronFace, ContextMenuButton, useContextMenu } from "./ContextMenu";
import MainSplit from "./MainSplit";
import RightPanel from "./RightPanel";
import SpaceHierarchy, { showRoom } from "./SpaceHierarchy";
import { type RoomPermalinkCreator } from "../../utils/permalinks/Permalinks";
import MessageComposer from "../views/rooms/MessageComposer";
import RoomContext, { TimelineRenderingType, MainSplitContentType } from "../../contexts/RoomContext";
import { Layout } from "../../settings/enums/Layout";
import Spinner from "../views/elements/Spinner";

interface IProps {
    space: Room;
    justCreatedOpts?: IOpts;
    resizeNotifier: ResizeNotifier;
    permalinkCreator: RoomPermalinkCreator;
    onJoinButtonClicked(): void;
    onRejectButtonClicked(): void;
}

interface IState {
    phase: Phase;
    firstRoomId?: string; // internal state for the creation wizard
    showRightPanel: boolean;
    myMembership: string;
}

enum Phase {
    Landing,
    PublicCreateRooms,
    PublicShare,
    PrivateScope,
    PrivateInvite,
    PrivateCreateRooms,
    PrivateExistingRooms,
}

const SpaceLandingAddButton: React.FC<{ space: Room }> = ({ space }) => {
    const [menuDisplayed, handle, openMenu, closeMenu] = useContextMenu();
    const canCreateRoom = shouldShowComponent(UIComponent.CreateRooms);
    const canCreateSpace = shouldShowComponent(UIComponent.CreateSpaces);
    const videoRoomsEnabled = useFeatureEnabled("feature_video_rooms");
    const elementCallVideoRoomsEnabled = useFeatureEnabled("feature_element_call_video_rooms");

    let contextMenu: JSX.Element | null = null;
    if (menuDisplayed) {
        const rect = handle.current!.getBoundingClientRect();
        contextMenu = (
            <IconizedContextMenu
                left={rect.left + window.scrollX + 0}
                top={rect.bottom + window.scrollY + 8}
                chevronFace={ChevronFace.None}
                onFinished={closeMenu}
                className="mx_RoomTile_contextMenu"
                compact
            >
                <IconizedContextMenuOptionList first>
                    {canCreateRoom && (
                        <>
                            <IconizedContextMenuOption
                                label={_t("action|new_room")}
                                iconClassName="mx_LegacyRoomList_iconNewRoom"
                                onClick={async (e): Promise<void> => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    closeMenu();

                                    PosthogTrackers.trackInteraction("WebSpaceHomeCreateRoomButton", e);
                                    if (await showCreateNewRoom(space)) {
                                        defaultDispatcher.fire(Action.UpdateSpaceHierarchy);
                                    }
                                }}
                            />
                            {videoRoomsEnabled && (
                                <IconizedContextMenuOption
                                    label={_t("action|new_video_room")}
                                    iconClassName="mx_LegacyRoomList_iconNewVideoRoom"
                                    onClick={async (e): Promise<void> => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        closeMenu();

                                        if (
                                            await showCreateNewRoom(
                                                space,
                                                elementCallVideoRoomsEnabled
                                                    ? RoomType.UnstableCall
                                                    : RoomType.ElementVideo,
                                            )
                                        ) {
                                            defaultDispatcher.fire(Action.UpdateSpaceHierarchy);
                                        }
                                    }}
                                >
                                    <BetaPill />
                                </IconizedContextMenuOption>
                            )}
                        </>
                    )}
                    <IconizedContextMenuOption
                        label={_t("action|add_existing_room")}
                        iconClassName="mx_LegacyRoomList_iconAddExistingRoom"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            closeMenu();
                            showAddExistingRooms(space);
                        }}
                    />
                    {canCreateSpace && (
                        <IconizedContextMenuOption
                            label={_t("room_list|add_space_label")}
                            iconClassName="mx_LegacyRoomList_iconPlus"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                closeMenu();
                                showCreateNewSubspace(space);
                            }}
                        >
                            <BetaPill />
                        </IconizedContextMenuOption>
                    )}
                </IconizedContextMenuOptionList>
            </IconizedContextMenu>
        );
    }

    return (
        <>
            <ContextMenuButton
                kind="primary"
                ref={handle}
                onClick={openMenu}
                isExpanded={menuDisplayed}
                label={_t("action|add")}
            >
                {_t("action|add")}
            </ContextMenuButton>
            {contextMenu}
        </>
    );
};

// Custom MessageComposer for spaces that creates a private room when a message is submitted
const SpaceMessageComposer: React.FC<{room: Room, resizeNotifier: ResizeNotifier}> = ({room, resizeNotifier}) => {
    const cli = useContext(MatrixClientContext);
    const [isCreatingRoom, setIsCreatingRoom] = useState(false);

    // Create a context value that allows sending messages
    const contextValue = useMemo(() => ({
        roomLoading: false,
        peekLoading: false,
        shouldPeek: false,
        membersLoaded: true,
        numUnreadMessages: 0,
        canPeek: false,
        showApps: false,
        isPeeking: false,
        showRightPanel: false,
        joining: false,
        showTopUnreadMessagesBar: false,
        statusBarVisible: false,
        canReact: true,
        canSelfRedact: true,
        canSendMessages: true, // This is the key property we're overriding
        resizing: false,
        layout: Layout.Group,
        lowBandwidth: false,
        alwaysShowTimestamps: false,
        showTwelveHourTimestamps: false,
        userTimezone: undefined,
        readMarkerInViewThresholdMs: 3000,
        readMarkerOutOfViewThresholdMs: 30000,
        showHiddenEvents: false,
        showReadReceipts: true,
        showRedactions: true,
        showJoinLeaves: true,
        showAvatarChanges: true,
        showDisplaynameChanges: true,
        matrixClientIsReady: true,
        showUrlPreview: false,
        timelineRenderingType: TimelineRenderingType.Room,
        mainSplitContentType: MainSplitContentType.Timeline,
        liveTimeline: undefined,
        narrow: false,
        msc3946ProcessDynamicPredecessor: false,
        canAskToJoin: false,
        promptAskToJoin: false,
        viewRoomOpts: { buttons: [] },
        isRoomEncrypted: null,
        tombstone: undefined
    }), []);

    // Helper to get the message text from the composer
    const getMessageText = (): string => {
        // Find the message input
        const composerInput = document.querySelector('.mx_SendMessageComposer .mx_BasicMessageComposer_input');
        if (composerInput) {
            // Get text content from the input
            return composerInput.textContent || '';
        }
        return '';
    };

    // Function to inject the loading overlay into the send button
    const applySendButtonLoadingState = useCallback((loading: boolean) => {
        // Find the button element
        const button = document.querySelector('.mx_MessageComposer_sendMessage');
        if (!button) return;

        // Clear any existing loading state
        button.classList.remove('mx_SpaceRoomView_sendButton_loading');
        const existingOverlay = document.querySelector('.mx_SpaceRoomView_sendButton_loadingOverlay');
        if (existingOverlay) {
            existingOverlay.remove();
        }

        // If loading, add the loading state
        if (loading) {
            button.classList.add('mx_SpaceRoomView_sendButton_loading');

            // Create loading overlay
            const overlay = document.createElement('div');
            overlay.className = 'mx_SpaceRoomView_sendButton_loadingOverlay';

            // Create spinner element
            const spinner = document.createElement('div');
            spinner.className = 'mx_SpaceRoomView_sendButton_spinner';
            overlay.appendChild(spinner);

            // Add the overlay to the button
            button.appendChild(overlay);
        }
    }, []);

    // Create a private room when the send button is clicked
    const createPrivateRoom = useCallback(async (): Promise<void> => {
        // Don't do anything if already creating a room
        if (isCreatingRoom) return;

        try {
            // Get message text before starting creation
            const messageText = getMessageText();
            const words = messageText.trim().split(/\s+/);
            const firstWord = words[0] || '';

            // Apply loading state immediately using DOM manipulation for instant feedback
            applySendButtonLoadingState(true);

            // Then update React state (this might be delayed)
            setIsCreatingRoom(true);
            console.log("Creating private room in space with name from message:", firstWord);

            // Use first word as room name, fallback to timestamp if empty
            let roomName;
            if (firstWord) {
                roomName = firstWord;
            } else {
                // Create a timestamp for the room name as fallback
                const timestamp = new Date().toLocaleTimeString();
                roomName = `Private Room (${timestamp})`;
            }

            // Create a new private room in the space
            const roomId = await createRoom(cli, {
                createOpts: {
                    preset: Preset.PrivateChat,
                    name: roomName,
                    initial_state: [
                        {
                            type: EventType.RoomEncryption,
                            state_key: "",
                            content: {
                                algorithm: "m.megolm.v1.aes-sha2",
                            },
                        },
                    ],
                },
                spinner: false, // We have our own loading indicator
                encryption: true,
                andView: false,
                inlineErrors: true,
                parentSpace: room, // Add to the current space
                joinRule: JoinRule.Restricted,
            });

            // Navigate to the new room if we have a valid roomId
            if (roomId && typeof roomId === 'string') {
                // If there's a message, send it to the new room
                if (messageText.trim()) {
                    await cli.sendTextMessage(roomId, messageText);
                }

                // Clear the composer after sending
                const composerInput = document.querySelector('.mx_SendMessageComposer .mx_BasicMessageComposer_input');
                if (composerInput) {
                    composerInput.textContent = '';
                }

                // Navigate to the new room
                defaultDispatcher.dispatch<ViewRoomPayload>({
                    action: Action.ViewRoom,
                    room_id: roomId,
                    metricsTrigger: undefined,
                });
            } else {
                console.error("Failed to create room: Invalid room ID returned");
                logger.error("Failed to create room: Invalid room ID returned");
            }

        } catch (error) {
            console.error("Failed to create private room:", error);
            logger.error("Failed to create private room:", error);
        } finally {
            // Remove the loading state
            applySendButtonLoadingState(false);
            setIsCreatingRoom(false);
        }
    }, [cli, room, isCreatingRoom, applySendButtonLoadingState]);

    // Initialize the UI and apply CSS modifications
    useEffect(() => {
        // Create and apply CSS styles
        const style = document.createElement('style');
        style.innerHTML = `
            /* Loading button style */
            .mx_SpaceRoomView_sendButton_loading {
                opacity: 0.7 !important;
                cursor: wait !important;
                position: relative;
            }

            .mx_SpaceRoomView_sendButton_loadingOverlay {
                position: absolute !important;
                top: 0 !important;
                left: 0 !important;
                right: 0 !important;
                bottom: 0 !important;
                background-color: rgba(0, 0, 0, 0.1) !important;
                border-radius: 50% !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                z-index: 9999 !important;
            }

            .mx_SpaceRoomView_sendButton_spinner {
                width: 16px !important;
                height: 16px !important;
                border: 2px solid rgba(0, 0, 0, 0.1) !important;
                border-top-color: #00CC6A !important;
                border-radius: 50% !important;
                animation: spinner 1s linear infinite !important;
            }

            @keyframes spinner {
                to {transform: rotate(360deg);}
            }

            /* Force show send button even when input is empty */
            .mx_MessageComposer_sendMessage {
                opacity: 1 !important;
                visibility: visible !important;
                pointer-events: auto !important;
            }

            /* COMPLETELY remove all placeholders */
            .mx_BasicMessageComposer_inputEmpty span,
            .mx_SendMessageComposer span[data-text="Send a message..."],
            .mx_BasicMessageComposer span[data-text="Send a message..."],
            .mx_BasicMessageComposer_inputWrapper span:not(.mx_BasicMessageComposer_input),
            [data-placeholder="Send a message..."] {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
                height: 0 !important;
                width: 0 !important;
                overflow: hidden !important;
                position: absolute !important;
            }

            /* Add our custom placeholder via ::before */
            .mx_BasicMessageComposer_inputEmpty::before {
                content: '' !important;
                position: absolute !important;
                top: 0 !important;
                left: 0 !important;
                right: 0 !important;
                opacity: 0.5 !important;
                pointer-events: none !important;
                padding: 11px 14px !important;
                display: block !important;
                z-index: 1 !important;
            }
        `;
        document.head.appendChild(style);

        // Function to update the UI components
        const updateUI = () => {
            // 1. Make send button visible
            const sendButton = document.querySelector('.mx_MessageComposer_sendMessage');
            if (sendButton) {
                sendButton.setAttribute('style', 'opacity: 1 !important; visibility: visible !important; pointer-events: auto !important;');
            }

            // 2. Find and remove ALL original placeholder elements - extremely aggressive approach
            const possiblePlaceholders = [
                '.mx_BasicMessageComposer_inputEmpty > span',
                '.mx_SendMessageComposer span[data-text="Send a message..."]',
                '.mx_BasicMessageComposer span[data-text="Send a message..."]',
                '.mx_BasicMessageComposer_inputWrapper > span',
                '[data-placeholder="Send a message..."]',
                '.mx_BasicMessageComposer_inputEmpty > *:not(.mx_BasicMessageComposer_input)',
                '[placeholder]',
                '[aria-placeholder]',
                '[data-placeholder]'
            ];

            possiblePlaceholders.forEach(selector => {
                document.querySelectorAll(selector).forEach(el => {
                    // Check if it's a placeholder element
                    if (el.classList.contains('mx_BasicMessageComposer_input')) {
                        return; // Skip the actual input
                    }

                    // Check if the element contains placeholder text
                    const text = el.textContent || el.getAttribute('data-text') ||
                                 el.getAttribute('placeholder') || el.getAttribute('data-placeholder');

                    if (text && (
                        text.includes('Send a message') ||
                        text.includes('start messaging') ||
                        text.includes('Start messaging')
                    )) {
                        // Remove the element completely if possible
                        if (el.parentNode) {
                            el.parentNode.removeChild(el);
                        } else {
                            // If can't remove, hide it as aggressively as possible
                            el.setAttribute('style', `
                                display: none !important;
                                visibility: hidden !important;
                                opacity: 0 !important;
                                height: 0 !important;
                                width: 0 !important;
                                overflow: hidden !important;
                                position: absolute !important;
                                pointer-events: none !important;
                            `);
                        }
                    }
                });
            });

            // 3. Override any data-placeholder attributes
            document.querySelectorAll('[data-placeholder]').forEach(el => {
                if (el.getAttribute('data-placeholder')?.includes('Send a message')) {
                    el.setAttribute('data-placeholder', '');
                }
            });

            // 4. Set proper attributes on the input field
            const inputField = document.querySelector('.mx_BasicMessageComposer_inputField, .mx_BasicMessageComposer_input');
            if (inputField) {
                inputField.setAttribute('data-placeholder', '');
                inputField.setAttribute('aria-label', '');
                inputField.setAttribute('placeholder', '');
            }
        };

        // Set up a function to clear all text nodes that might contain "Send a message..."
        const clearUnwantedTextNodes = () => {
            // Find the composer wrapper
            const wrapper = document.querySelector('.mx_BasicMessageComposer_inputWrapper');
            if (!wrapper) return;

            // Use a simpler approach - find all text nodes recursively
            const textNodesToRemove: Node[] = [];

            function findTextNodes(node: Node) {
                if (node.nodeType === Node.TEXT_NODE) {
                    const text = node.nodeValue || '';
                    if (text.includes('Send a message') || text.includes('send a message')) {
                        textNodesToRemove.push(node);
                    }
                } else {
                    // Recursively process child nodes
                    for (let i = 0; i < node.childNodes.length; i++) {
                        findTextNodes(node.childNodes[i]);
                    }
                }
            }

            // Start the recursive search
            findTextNodes(wrapper);

            // Remove all found text nodes
            textNodesToRemove.forEach(node => {
                if (node.parentNode) {
                    node.parentNode.removeChild(node);
                }
            });
        };

        // Run all update functions
        const runAllUpdates = () => {
            updateUI();
            clearUnwantedTextNodes();
        };

        // Run once immediately
        runAllUpdates();

        // Run again after short delays to ensure it takes effect after React updates
        const timeouts = [
            setTimeout(runAllUpdates, 50),
            setTimeout(runAllUpdates, 100),
            setTimeout(runAllUpdates, 300),
            setTimeout(runAllUpdates, 500),
            setTimeout(runAllUpdates, 1000),
            setTimeout(runAllUpdates, 2000)
        ];

        // Set up interval to continuously ensure UI is correct
        const interval = setInterval(runAllUpdates, 200);

        // Set up mutation observer to detect DOM changes and update UI immediately
        const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                // Check if any added nodes might be placeholders
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    const hasTextNode = Array.from(mutation.addedNodes).some(node =>
                        node.nodeType === 3 || // Text node
                        (node.nodeType === 1 &&
                         (node as Element).tagName === 'SPAN' ||
                         (node as Element).hasAttribute('data-placeholder'))
                    );

                    if (hasTextNode) {
                        runAllUpdates();
                        return;
                    }
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['data-placeholder', 'placeholder']
        });

        // Cleanup function
        return () => {
            document.head.removeChild(style);
            timeouts.forEach(clearTimeout);
            clearInterval(interval);
            observer.disconnect();
        };
    }, []);

    // Set up click handler for the send button
    useEffect(() => {
        const handleClick = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            const button = target.closest('.mx_MessageComposer_sendMessage');
            if (button) {
                event.preventDefault();
                event.stopPropagation();

                // Apply loading state immediately for instant feedback
                applySendButtonLoadingState(true);

                // Start the room creation process (in the next event loop tick)
                setTimeout(() => createPrivateRoom(), 0);
                return false;
            }
            return true;
        };

        // Add event listener
        document.addEventListener('click', handleClick, true);

        // Cleanup
        return () => {
            document.removeEventListener('click', handleClick, true);
        };
    }, [createPrivateRoom, applySendButtonLoadingState]);

    return (
        <RoomContext.Provider value={contextValue}>
            <MessageComposer
                room={room}
                resizeNotifier={resizeNotifier}
            />
        </RoomContext.Provider>
    );
};

const SpaceLanding: React.FC<{ space: Room }> = ({ space }) => {
    // eslint-disable-next-line react-compiler/react-compiler
    const resizeNotifier = useRef<ResizeNotifier>(new ResizeNotifier()).current;

    return (
        <div className="mx_SpaceRoomView_landing">
            {/* Blank panel as requested by user */}
            <div className="mx_SpaceRoomView_blank" />
            <div className="mx_SpaceRoomView_messageComposer">
                <SpaceMessageComposer
                        room={space}
                    resizeNotifier={resizeNotifier}
                    />
                </div>
        </div>
    );
};

const SpaceSetupFirstRooms: React.FC<{
    space: Room;
    title: string;
    description: JSX.Element;
    onFinished(firstRoomId?: string): void;
}> = ({ space, title, description, onFinished }) => {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const numFields = 3;
    const placeholders = [_t("common|general"), _t("common|random"), _t("common|support")];
    const [roomNames, setRoomName] = useStateArray(numFields, [_t("common|general"), _t("common|random"), ""]);
    const fields = new Array(numFields).fill(0).map((x, i) => {
        const name = "roomName" + i;
        return (
            <Field
                key={name}
                name={name}
                type="text"
                label={_t("common|room_name")}
                placeholder={placeholders[i]}
                value={roomNames[i]}
                onChange={(ev: React.ChangeEvent<HTMLInputElement>) => setRoomName(i, ev.target.value)}
                autoFocus={i === 2}
                disabled={busy}
                autoComplete="off"
            />
        );
    });

    const onNextClick = async (ev: ButtonEvent): Promise<void> => {
        ev.preventDefault();
        if (busy) return;
        setError("");
        setBusy(true);
        try {
            const isPublic = space.getJoinRule() === JoinRule.Public;
            const filteredRoomNames = roomNames.map((name) => name.trim()).filter(Boolean);
            const roomIds = await Promise.all(
                filteredRoomNames.map((name) => {
                    return createRoom(space.client, {
                        createOpts: {
                            preset: isPublic ? Preset.PublicChat : Preset.PrivateChat,
                            name,
                        },
                        spinner: false,
                        encryption: false,
                        andView: false,
                        inlineErrors: true,
                        parentSpace: space,
                        joinRule: !isPublic ? JoinRule.Restricted : undefined,
                        suggested: true,
                    });
                }),
            );
            onFinished(roomIds[0] ?? undefined);
        } catch (e) {
            logger.error("Failed to create initial space rooms", e);
            setError(_t("create_space|failed_create_initial_rooms"));
        }
        setBusy(false);
    };

    let onClick = (ev: ButtonEvent): void => {
        ev.preventDefault();
        onFinished();
    };
    let buttonLabel = _t("create_space|skip_action");
    if (roomNames.some((name) => name.trim())) {
        onClick = onNextClick;
        buttonLabel = busy ? _t("create_space|creating_rooms") : _t("action|continue");
    }

    return (
        <div>
            <h1>{title}</h1>
            <div className="mx_SpaceRoomView_description">{description}</div>

            {error && <div className="mx_SpaceRoomView_errorText">{error}</div>}
            <form onSubmit={onClick} id="mx_SpaceSetupFirstRooms">
                {fields}
            </form>

            <div className="mx_SpaceRoomView_buttons">
                <AccessibleButton
                    kind="primary"
                    disabled={busy}
                    onClick={onClick}
                    element="input"
                    type="submit"
                    form="mx_SpaceSetupFirstRooms"
                    value={buttonLabel}
                />
            </div>
        </div>
    );
};

const SpaceAddExistingRooms: React.FC<{
    space: Room;
    onFinished(): void;
}> = ({ space, onFinished }) => {
    return (
        <div>
            <h1>{_t("create_space|add_existing_rooms_heading")}</h1>
            <div className="mx_SpaceRoomView_description">{_t("create_space|add_existing_rooms_description")}</div>

            <AddExistingToSpace
                space={space}
                emptySelectionButton={
                    <AccessibleButton kind="primary" onClick={onFinished}>
                        {_t("create_space|skip_action")}
                    </AccessibleButton>
                }
                filterPlaceholder={_t("space|room_filter_placeholder")}
                onFinished={onFinished}
                roomsRenderer={defaultRoomsRenderer}
                dmsRenderer={defaultDmsRenderer}
            />
        </div>
    );
};

interface ISpaceSetupPublicShareProps extends Pick<IProps & IState, "justCreatedOpts" | "space" | "firstRoomId"> {
    onFinished(): void;
}

const SpaceSetupPublicShare: React.FC<ISpaceSetupPublicShareProps> = ({
                                                                          justCreatedOpts,
                                                                          space,
                                                                          onFinished,
                                                                          firstRoomId,
                                                                      }) => {
    return (
        <div className="mx_SpaceRoomView_publicShare">
            <h1>
                {_t("create_space|share_heading", {
                    name: justCreatedOpts?.createOpts?.name || space.name,
                })}
            </h1>
            <div className="mx_SpaceRoomView_description">{_t("create_space|share_description")}</div>

            <SpacePublicShare space={space} />

            <div className="mx_SpaceRoomView_buttons">
                <AccessibleButton kind="primary" onClick={onFinished}>
                    {firstRoomId ? _t("create_space|done_action_first_room") : _t("create_space|done_action")}
                </AccessibleButton>
            </div>
        </div>
    );
};

const SpaceSetupPrivateScope: React.FC<{
    space: Room;
    justCreatedOpts?: IOpts;
    onFinished(createRooms: boolean): void;
}> = ({ space, justCreatedOpts, onFinished }) => {
    return (
        <div className="mx_SpaceRoomView_privateScope">
            <h1>{_t("create_space|private_personal_heading")}</h1>
            <div className="mx_SpaceRoomView_description">
                {_t("create_space|private_personal_description", {
                    name: justCreatedOpts?.createOpts?.name || space.name,
                })}
            </div>

            <AccessibleButton
                className="mx_SpaceRoomView_privateScope_justMeButton"
                onClick={() => {
                    onFinished(false);
                }}
            >
                {_t("create_space|personal_space")}
                <div>{_t("create_space|personal_space_description")}</div>
            </AccessibleButton>
            <AccessibleButton
                className="mx_SpaceRoomView_privateScope_meAndMyTeammatesButton"
                onClick={() => {
                    onFinished(true);
                }}
            >
                {_t("create_space|private_space")}
                <div>{_t("create_space|private_space_description")}</div>
            </AccessibleButton>
        </div>
    );
};

const validateEmailRules = withValidation({
    rules: [
        {
            key: "email",
            test: ({ value }) => !value || Email.looksValid(value),
            invalid: () => _t("auth|email_field_label_invalid"),
        },
    ],
});

const SpaceSetupPrivateInvite: React.FC<{
    space: Room;
    onFinished(): void;
}> = ({ space, onFinished }) => {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const numFields = 3;
    const fieldRefs = [useRef<Field>(null), useRef<Field>(null), useRef<Field>(null)];
    const [emailAddresses, setEmailAddress] = useStateArray(numFields, "");
    const fields = new Array(numFields).fill(0).map((x, i) => {
        const name = "emailAddress" + i;
        return (
            <Field
                key={name}
                name={name}
                type="text"
                label={_t("common|email_address")}
                placeholder={_t("auth|email_field_label")}
                value={emailAddresses[i]}
                onChange={(ev: React.ChangeEvent<HTMLInputElement>) => setEmailAddress(i, ev.target.value)}
                ref={fieldRefs[i]}
                onValidate={validateEmailRules}
                autoFocus={i === 0}
                disabled={busy}
            />
        );
    });

    const onNextClick = async (ev: ButtonEvent): Promise<void> => {
        ev.preventDefault();
        if (busy) return;
        setError("");
        for (const fieldRef of fieldRefs) {
            const valid = await fieldRef.current?.validate({ allowEmpty: true });

            if (valid === false) {
                // true/null are allowed
                fieldRef.current!.focus();
                fieldRef.current!.validate({ allowEmpty: true, focused: true });
                return;
            }
        }

        setBusy(true);
        const targetIds = emailAddresses.map((name) => name.trim()).filter(Boolean);
        try {
            const result = await inviteMultipleToRoom(space.client, space.roomId, targetIds);

            const failedUsers = Object.keys(result.states).filter((a) => result.states[a] === "error");
            if (failedUsers.length > 0) {
                logger.log("Failed to invite users to space: ", result);
                setError(
                    _t("create_space|failed_invite_users", {
                        csvUsers: failedUsers.join(", "),
                    }),
                );
            } else {
                onFinished();
            }
        } catch (err) {
            logger.error("Failed to invite users to space: ", err);
            setError(_t("invite|error_invite"));
        }
        setBusy(false);
    };

    let onClick = (ev: ButtonEvent): void => {
        ev.preventDefault();
        onFinished();
    };
    let buttonLabel = _t("create_space|skip_action");
    if (emailAddresses.some((name) => name.trim())) {
        onClick = onNextClick;
        buttonLabel = busy ? _t("create_space|inviting_users") : _t("action|continue");
    }

    return (
        <div className="mx_SpaceRoomView_inviteTeammates">
            <h1>{_t("create_space|invite_teammates_heading")}</h1>
            <div className="mx_SpaceRoomView_description">{_t("create_space|invite_teammates_description")}</div>

            {error && <div className="mx_SpaceRoomView_errorText">{error}</div>}
            <form onSubmit={onClick} id="mx_SpaceSetupPrivateInvite">
                {fields}
            </form>

            <div className="mx_SpaceRoomView_inviteTeammates_buttons">
                <AccessibleButton
                    className="mx_SpaceRoomView_inviteTeammates_inviteDialogButton"
                    onClick={() => showRoomInviteDialog(space.roomId)}
                >
                    {_t("create_space|invite_teammates_by_username")}
                </AccessibleButton>
            </div>

            <div className="mx_SpaceRoomView_buttons">
                <AccessibleButton
                    kind="primary"
                    disabled={busy}
                    onClick={onClick}
                    element="input"
                    type="submit"
                    form="mx_SpaceSetupPrivateInvite"
                    value={buttonLabel}
                />
            </div>
        </div>
    );
};

export default class SpaceRoomView extends React.PureComponent<IProps, IState> {
    public static contextType = MatrixClientContext;
    declare public context: React.ContextType<typeof MatrixClientContext>;

    private dispatcherRef?: string;
    // private mutationObserver: MutationObserver | null = null;
    private onGlobalSpaceClick?: (event: MouseEvent) => void;
    private dispatchOverride?: string;

    public constructor(props: IProps, context: React.ContextType<typeof MatrixClientContext>) {
        super(props, context);

        let phase = Phase.Landing;

        const creator = this.props.space.currentState.getStateEvents(EventType.RoomCreate, "")?.getSender();
        const showSetup = this.props.justCreatedOpts && context.getSafeUserId() === creator;

        if (showSetup) {
            phase =
                this.props.justCreatedOpts!.createOpts?.preset === Preset.PublicChat
                    ? Phase.PublicCreateRooms
                    : Phase.PrivateScope;
        }

        this.state = {
            phase,
            showRightPanel: RightPanelStore.instance.isOpenForRoom(this.props.space.roomId),
            myMembership: this.props.space.getMyMembership(),
        };

        // Create a global space click handler
        this.setupGlobalSpaceClickHandler();
    }

    public componentDidMount(): void {
        this.dispatcherRef = defaultDispatcher.register(this.onAction);
        RightPanelStore.instance.on(UPDATE_EVENT, this.onRightPanelStoreUpdate);
        this.context.on(RoomEvent.MyMembership, this.onMyMembership);

        // Ensure we're in Landing phase when mounting
        this.setState({ phase: Phase.Landing });
    }

    public componentWillUnmount(): void {
        defaultDispatcher.unregister(this.dispatcherRef);
        RightPanelStore.instance.off(UPDATE_EVENT, this.onRightPanelStoreUpdate);
        this.context.off(RoomEvent.MyMembership, this.onMyMembership);

        // Clean up our global handler
        this.cleanupGlobalSpaceClickHandler();
    }

    // Set up a global event handler for space clicks
    private setupGlobalSpaceClickHandler(): void {
        // Create the event handler
        this.onGlobalSpaceClick = (event: MouseEvent): void => {
            const target = event.target as HTMLElement;

            // Check if a space button was clicked
            const spaceButton = target.closest('.mx_SpaceButton');
            if (spaceButton) {
                // Get the space ID from attributes
                const spaceId = spaceButton.getAttribute('data-room-id') || '';

                // Check if it's our space
                if (spaceId === this.props.space.roomId) {
                    console.log("Our space was clicked, ensuring Landing phase");

                    // Use a delay to let the default handlers run first
                    setTimeout(() => {
                        this.setState({ phase: Phase.Landing });
                    }, 100);
                }
            }
        };

        // Attach the handler
        document.addEventListener('click', this.onGlobalSpaceClick, true);

        // Create an additional override for the dispatcher
        this.dispatchOverride = defaultDispatcher.register((payload: ActionPayload) => {
            // Check for a ViewRoom action for our space
            if (payload.action === Action.ViewRoom &&
                payload.room_id === this.props.space.roomId) {

                console.log("ViewRoom action for our space detected");

                // Force to Landing phase
                setTimeout(() => this.setState({ phase: Phase.Landing }), 50);
            }
        });
    }

    // Clean up our global handlers
    private cleanupGlobalSpaceClickHandler(): void {
        if (this.onGlobalSpaceClick) {
            document.removeEventListener('click', this.onGlobalSpaceClick, true);
            this.onGlobalSpaceClick = undefined;
        }

        if (this.dispatchOverride) {
            defaultDispatcher.unregister(this.dispatchOverride);
            this.dispatchOverride = undefined;
        }
    }

    private onMyMembership = (room: Room, myMembership: string): void => {
        if (room.roomId === this.props.space.roomId) {
            this.setState({ myMembership });
        }
    };

    private onRightPanelStoreUpdate = (): void => {
        this.setState({
            showRightPanel: RightPanelStore.instance.isOpenForRoom(this.props.space.roomId),
        });
    };

    private onAction = (payload: ActionPayload): void => {
        // If the payload is for viewing ANY room while we're looking at our space
        if (payload.action === Action.ViewRoom) {
            // Check if we're currently viewing our space room
            const currentUrl = window.location.href;
            const isViewingSpace = currentUrl.includes(this.props.space.roomId);

            // If we're viewing our space
            if (isViewingSpace) {
                // Force to landing phase
                console.log("Intercepted room selection while in space view, forcing Landing phase");
            this.setState({ phase: Phase.Landing });

                // If this is specifically our space being viewed, force landing
                if (payload.room_id === this.props.space.roomId) {
                    console.log("ViewRoom action for our space, resetting to landing phase");
                    this.setState({ phase: Phase.Landing });
                }
            }
        }
    };

    private goToFirstRoom = async (): Promise<void> => {
        if (this.state.firstRoomId) {
            defaultDispatcher.dispatch<ViewRoomPayload>({
                action: Action.ViewRoom,
                room_id: this.state.firstRoomId,
                metricsTrigger: undefined, // other
            });
            return;
        }

        this.setState({ phase: Phase.Landing });
    };

    private renderBody(): JSX.Element {
        // Always force Landing phase when this function is called for a space view
        if (window.location.href.includes(this.props.space.roomId)) {
            if (this.state.phase !== Phase.Landing) {
                console.log("Force setting phase to Landing in renderBody");
                this.setState({ phase: Phase.Landing });
            }
        }

        switch (this.state.phase) {
            case Phase.Landing:
                if (this.state.myMembership === KnownMembership.Join) {
                    return <SpaceLanding space={this.props.space} />;
                } else {
                    return (
                        <RoomPreviewCard
                            room={this.props.space}
                            onJoinButtonClicked={this.props.onJoinButtonClicked}
                            onRejectButtonClicked={this.props.onRejectButtonClicked}
                        />
                    );
                }
            case Phase.PublicCreateRooms:
                return (
                    <SpaceSetupFirstRooms
                        space={this.props.space}
                        title={_t("create_space|setup_rooms_community_heading", {
                            spaceName: this.props.justCreatedOpts?.createOpts?.name || this.props.space.name,
                        })}
                        description={
                            <>
                                {_t("create_space|setup_rooms_community_description")}
                                <br />
                                {_t("create_space|setup_rooms_description")}
                            </>
                        }
                        onFinished={(firstRoomId: string) => this.setState({ phase: Phase.PublicShare, firstRoomId })}
                    />
                );
            case Phase.PublicShare:
                return (
                    <SpaceSetupPublicShare
                        justCreatedOpts={this.props.justCreatedOpts}
                        space={this.props.space}
                        onFinished={this.goToFirstRoom}
                        firstRoomId={this.state.firstRoomId}
                    />
                );

            case Phase.PrivateScope:
                return (
                    <SpaceSetupPrivateScope
                        space={this.props.space}
                        justCreatedOpts={this.props.justCreatedOpts}
                        onFinished={(invite: boolean) => {
                            this.setState({ phase: invite ? Phase.PrivateCreateRooms : Phase.PrivateExistingRooms });
                        }}
                    />
                );
            case Phase.PrivateInvite:
                return (
                    <SpaceSetupPrivateInvite
                        space={this.props.space}
                        onFinished={() => this.setState({ phase: Phase.Landing })}
                    />
                );
            case Phase.PrivateCreateRooms:
                return (
                    <SpaceSetupFirstRooms
                        space={this.props.space}
                        title={_t("create_space|setup_rooms_private_heading")}
                        description={
                            <>
                                {_t("create_space|setup_rooms_private_description")}
                                <br />
                                {_t("create_space|setup_rooms_description")}
                            </>
                        }
                        onFinished={(firstRoomId: string) => this.setState({ phase: Phase.PrivateInvite, firstRoomId })}
                    />
                );
            case Phase.PrivateExistingRooms:
                return (
                    <SpaceAddExistingRooms
                        space={this.props.space}
                        onFinished={() => this.setState({ phase: Phase.Landing })}
                    />
                );
        }
    }

    // Override component updates to ensure we stay in landing phase when viewing a space
    public componentDidUpdate(prevProps: IProps, prevState: IState): void {
        // Check if we're viewing our space
        if (window.location.href.includes(this.props.space.roomId)) {
            // If we're not in landing phase, reset to it
            if (this.state.phase !== Phase.Landing) {
                console.log("Force setting phase to Landing in componentDidUpdate");
                this.setState({ phase: Phase.Landing });
            }
        }
    }

    // Override the render method to inject additional checks
    public render(): React.ReactNode {
        // Check if the URL contains our space ID but we're not in landing phase
        if (window.location.href.includes(this.props.space.roomId) &&
            this.state.phase !== Phase.Landing) {
            // Force reset to landing phase
            setTimeout(() => {
                this.setState({ phase: Phase.Landing });
            }, 0);
        }

        const rightPanel =
            this.state.showRightPanel && this.state.phase === Phase.Landing ? (
                <RightPanel
                    room={this.props.space}
                    resizeNotifier={this.props.resizeNotifier}
                    permalinkCreator={this.props.permalinkCreator}
                />
            ) : undefined;

        return (
            <main className="mx_SpaceRoomView">
                <ErrorBoundary>
                    <MainSplit panel={rightPanel} resizeNotifier={this.props.resizeNotifier} analyticsRoomType="space">
                        {this.renderBody()}
                    </MainSplit>
                </ErrorBoundary>
            </main>
        );
    }
}
