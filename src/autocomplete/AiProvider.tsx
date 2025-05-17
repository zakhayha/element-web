/*
Copyright 2023 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { Room } from "matrix-js-sdk/src/matrix";

import AutocompleteProvider from "./AutocompleteProvider";
import { PillCompletion } from "./Components";
import { _t } from "../languageHandler";
import { TimelineRenderingType } from "../contexts/RoomContext";
import { ICompletion, ISelectionRange } from "./Autocompleter";

// Match @a, @r, or @ai
const AI_MENTION_REGEX = /\B@(a|r|ai)\S*/g;

interface AiProviderInfo {
    id: string;
    name: string;
    description: string;
}

/**
 * AI Provider for autocomplete
 * This provider shows up when typing "@a", "@r", or "@ai" in the chat
 */
export default class AiProvider extends AutocompleteProvider {
    private room: Room;
    // Using protected instead of private to match the base class
    protected renderingType: TimelineRenderingType;
    private aiProviders: AiProviderInfo[];

    /**
     * Constructor for the AI Provider
     * @param room - Matrix room context
     * @param renderingType - Timeline rendering type
     */
    constructor(room: Room, renderingType?: TimelineRenderingType) {
        super({
            commandRegex: AI_MENTION_REGEX,
            renderingType,
        });

        this.room = room;
        this.renderingType = renderingType || TimelineRenderingType.Room;

        // Define available AI providers
        this.aiProviders = [
            {
                id: "gpt",
                name: "GPT",
                description: "OpenAI GPT Assistant",
            },
            {
                id: "claude",
                name: "Claude",
                description: "Anthropic Claude Assistant",
            },
            {
                id: "gemini",
                name: "Gemini",
                description: "Google Gemini Assistant",
            },
            {
                id: "ollama",
                name: "Ollama",
                description: "Local AI assistant",
            },
            {
                id: "llama",
                name: "Llama",
                description: "Meta Llama Assistant",
            },
        ];
    }

    /**
     * Get name for the section header
     */
    getName(): string {
        // Return "AI" as the section title
        return "AI";
    }

    /**
     * Get completions for AI providers when typing "@a", "@r", or "@ai"
     * @param rawQuery - Raw query text
     * @param selection - Selection range in the input
     * @param force - Whether to force completions
     * @param limit - Limit number of completions
     */
    async getCompletions(
        rawQuery: string,
        selection: ISelectionRange,
        force = false,
        limit = -1,
    ): Promise<ICompletion[]> {
        const { command, range } = this.getCurrentCommand(rawQuery, selection, force);

        // Get the full matched text
        const fullMatch = command?.[0];
        
        // Check if the match starts with one of our trigger patterns
        if (fullMatch && (
            fullMatch.toLowerCase().startsWith("@a") ||
            fullMatch.toLowerCase().startsWith("@r") ||
            fullMatch.toLowerCase().startsWith("@ai")
        )) {
            // Extract query after the trigger
            let query = "";
            
            if (fullMatch.toLowerCase().startsWith("@ai")) {
                query = fullMatch.substring(3).toLowerCase();
            } else {
                query = fullMatch.substring(2).toLowerCase();
            }
            
            const completions: ICompletion[] = [];
            
            for (const provider of this.aiProviders) {
                // Filter by query if any
                if (query && !provider.id.includes(query) && 
                    !provider.name.toLowerCase().includes(query)) {
                    continue;
                }
                
                completions.push({
                    completion: provider.id,
                    completionId: provider.id,
                    type: "room", // Use "room" type for proper pill styling
                    suffix: " ",
                    component: (
                        <PillCompletion title={provider.name} description={provider.description}>
                            {/* You could add an AI icon here if desired */}
                        </PillCompletion>
                    ),
                    range: range!,
                });
            }
            
            // Apply limit if specified
            if (limit > 0 && completions.length > limit) {
                return completions.slice(0, limit);
            }
            
            return completions;
        }
        
        return [];
    }

    /**
     * Render completions in a container
     */
    renderCompletions(completions: React.ReactNode[]): React.ReactNode {
        return (
            <div 
                className="mx_Autocomplete_Completion_container_pill"
                role="presentation"
                aria-label={_t("composer|autocomplete|user_a11y")}
            >
                {completions}
            </div>
        );
    }

    /**
     * Clean up resources
     */
    destroy(): void {
        // No cleanup needed
    }

    /**
     * This provider should force completion
     */
    shouldForceComplete(): boolean {
        return true;
    }
} 