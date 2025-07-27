# Personal Rooms Feature

## Overview

The Personal Rooms feature allows users to create private rooms that are automatically converted to normal rooms when someone else is invited.

## How It Works

### Personal Room Creation
- Users can tag any room as "Personal" using the room context menu
- Personal rooms are categorized separately in the room list
- Personal rooms are private by default (only the user and AI can see them)

### Automatic Conversion
When someone is invited to a personal room:
1. The `PersonalRoomManager` detects the invitation event
2. The Personal tag is automatically removed from the room
3. The room becomes a normal room visible to all members
4. This ensures privacy is maintained until the room is shared

## Implementation Details

### PersonalRoomManager
Located in `src/stores/PersonalRoomManager.ts`, this singleton class:
- Listens to multiple Matrix events for comprehensive coverage:
  - `RoomStateEvent.NewMember`
  - `RoomMemberEvent.Membership`
  - `RoomStateEvent.Events`
- Automatically removes Personal tags when non-user members are added
- Includes cleanup functionality to fix any inconsistencies
- Starts automatically when the Matrix client initializes

### Event Handling
The manager handles these membership changes:
- **Invite**: When someone is invited (`KnownMembership.Invite`)
- **Join**: When someone joins (`KnownMembership.Join`)
- **Ignores**: User's own membership changes to avoid self-removal

### Integration Points
- **Initialization**: Started in `src/Lifecycle.ts` during client startup
- **UI Integration**: Room context menu in `src/components/views/context_menus/RoomGeneralContextMenu.tsx`
- **Room Tagging**: Uses existing `tagRoom` utility in `src/utils/room/tagRoom.ts`
- **Room List**: Integrated with `RoomListStore` for tag management

## Usage

### For Users
1. Right-click on any room that has **only you** as a member (1 person total)
2. Select "Personal" to mark it as a personal room
3. The room becomes private and is categorized under "Personal"
4. When you invite someone, the room automatically becomes normal
5. **Important**: The "Personal" option **only appears** when the room has just you in it
6. **Hidden**: The "Personal" option is **hidden** when the room has 2+ people (invited or joined)

### For Developers
The PersonalRoomManager is automatically initialized and requires no manual setup. It provides:
- `isPersonalRoomPrivate(room)`: Check if a room is truly private
- `cleanupPersonalRooms()`: Manual cleanup of inconsistent states

## Privacy Behavior

- **Before Invitation**: Room is private, only visible to the user
- **After Invitation**: Room becomes public/normal, visible to all members
- **Automatic**: No user intervention required for the conversion
- **Immediate**: Conversion happens as soon as invitation is sent
- **UI Restriction**: "Personal" option only appears in context menu for single-user rooms

## Technical Notes

- Uses multiple event listeners for reliability
- Includes defensive programming with double-checks
- Handles edge cases like rapid membership changes
- Provides comprehensive logging for debugging
- Singleton pattern ensures single instance across the application
