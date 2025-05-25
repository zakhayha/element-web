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
import SdkConfig from "../SdkConfig";
import { MatrixClientPeg } from "../MatrixClientPeg";

// Match @a, @r, or @ai
const AI_MENTION_REGEX = /\B@(a|r|ai)\S*/g;

interface AiProviderInfo {
    id: string;
    name: string;
    description: string;
    provider_type: string;
    api_key_required: boolean;
    api_base_url: string;
    api_version: string;
    is_active: boolean;
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
    private isLoading: boolean = false;

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

        // Initialize with default values until API response is received
        this.aiProviders = [
            {
                id: "loading",
                name: "Loading...",
                description: "Loading AI providers...",
                provider_type: "",
                api_key_required: false,
                api_base_url: "",
                api_version: "",
                is_active: true
            }
        ];
        
        // Fetch providers from the API
        this.fetchAiProviders();
    }

    /**
     * Get the AI providers API URL from config or use default
     */
    private getAiProvidersApiUrl(): string {
        // Get from config if available, or use specified URL
        const config = SdkConfig.get();
        return config.ai_providers_api_url || "http://staging.iluvatar.tech:8050/api/llm/providers";
    }

    /**
     * Try different methods to get authentication token, prioritizing MatrixClientPeg
     */
    private getAuthHeaders(): HeadersInit {
        const headers: HeadersInit = {
            'Content-Type': 'application/json',
        };

        try {
            // Primary method: MatrixClientPeg
            try {
                const matrixClient = MatrixClientPeg.get();
                if (matrixClient) {
                    const accessToken = matrixClient.getAccessToken();
                    if (accessToken) {
                        headers['Authorization'] = `Bearer ${accessToken}`;
                        return headers;
                    }

                    // If no token, at least try to include user ID
                    const userId = matrixClient.getUserId();
                    if (userId) {
                        headers['X-Matrix-User-ID'] = userId;
                    }
                }
            } catch (e) {
                // Could not access MatrixClientPeg
            }

            // Fallback to localStorage (most common storage method)
            try {
                // Common token storage keys
                const possibleKeys = [
                    'mx_access_token',
                    'accessToken',
                    'matrix_access_token',
                    'access_token',
                    'auth_token',
                    'token'
                ];

                for (const key of possibleKeys) {
                    const token = localStorage.getItem(key);
                    if (token) {
                        headers['Authorization'] = `Bearer ${token}`;
                        return headers;
                    }
                }
            } catch (e) {
                // Could not access localStorage
            }

            // Try sessionStorage next
            try {
                const possibleKeys = [
                    'mx_access_token',
                    'accessToken',
                    'matrix_access_token',
                    'access_token',
                    'auth_token',
                    'token'
                ];

                for (const key of possibleKeys) {
                    const token = sessionStorage.getItem(key);
                    if (token) {
                        headers['Authorization'] = `Bearer ${token}`;
                        return headers;
                    }
                }
            } catch (e) {
                // Could not access sessionStorage
            }

            // Add no-cache headers to prevent caching issues
            headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
            headers['Pragma'] = 'no-cache';
            headers['Expires'] = '0';

        } catch (e) {
            // Error while setting up auth headers
        }

        return headers;
    }

    /**
     * Explicitly removes the loading provider from the providers array
     */
    private removeLoadingProvider(): void {
        // Filter out any loading providers
        this.aiProviders = this.aiProviders.filter(provider => provider.id !== "loading");
    }

    /**
     * Check if we should show a loading state
     */
    private isLoadingState(): boolean {
        // Return true if we're loading or only have the loading provider
        return this.isLoading || 
               (this.aiProviders.length === 1 && this.aiProviders[0].id === "loading") ||
               this.aiProviders.length === 0;
    }

    /**
     * Fetch AI providers from the backend API
     */
    private async fetchAiProviders(): Promise<void> {
        if (this.isLoading) return;

        this.isLoading = true;

        try {
            const apiUrl = this.getAiProvidersApiUrl();
            
            // Get authentication headers
            const headers = this.getAuthHeaders();

            // Add a timestamp to prevent caching
            const urlWithTimestamp = `${apiUrl}${apiUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`;

            const response = await fetch(urlWithTimestamp, {
                method: 'GET',
                headers: headers,
                mode: 'cors', // Ensure CORS is enabled
            });

            if (!response.ok) {
                const errorText = await response.text().catch(() => "Could not read error response");

                if (response.status === 401) {
                    throw new Error('Authentication required to fetch AI providers');
                } else {
                    throw new Error(`Failed to fetch AI providers: ${response.status} - ${errorText}`);
                }
            }

            const data = await response.json();

            // First, remove any loading providers
            this.removeLoadingProvider();

            // Check if data is an array
            if (Array.isArray(data)) {
                // First check if there are any items
                if (data.length === 0) {
                    this.aiProviders = [];
                    return;
                }
                
                // Filter only active providers if the is_active field exists
                if ('is_active' in data[0]) {
                    // Completely replace the aiProviders array with only active providers
                    this.aiProviders = data.filter((provider: AiProviderInfo) => provider.is_active);
                } else {
                    // If no is_active field, use all providers
                    this.aiProviders = [...data]; // Create a new array to ensure replacement
                }
            } else if (data && typeof data === 'object') {
                // Try to extract providers if the response is wrapped in an object
                const possibleArrays = Object.values(data).filter(val => Array.isArray(val));
                if (possibleArrays.length > 0) {
                    // Use the first array found
                    this.aiProviders = possibleArrays[0];
                } else if (data.id && data.name) {
                    // If it looks like a single provider, use it as a single-item array
                    this.aiProviders = [data];
                } else {
                    throw new Error("API response format is not supported");
                }
            } else {
                throw new Error("API response is not a valid format");
            }

            // Double-check to make sure we removed any loading providers
            this.removeLoadingProvider();

        } catch (error) {
            // Fallback to default providers if API fails
            this.aiProviders = [
                {
                    id: "gpt",
                    name: "GPT",
                    description: "OpenAI GPT Assistant",
                    provider_type: "openai",
                    api_key_required: true,
                    api_base_url: "https://api.openai.com/v1",
                    api_version: "1",
                    is_active: true
                },
                {
                    id: "claude",
                    name: "Claude",
                    description: "Anthropic Claude Assistant",
                    provider_type: "anthropic",
                    api_key_required: true,
                    api_base_url: "https://api.anthropic.com",
                    api_version: "1",
                    is_active: true
                },
                {
                    id: "gemini",
                    name: "Gemini",
                    description: "Google Gemini Assistant",
                    provider_type: "google",
                    api_key_required: true,
                    api_base_url: "https://generativelanguage.googleapis.com",
                    api_version: "1",
                    is_active: true
                },
            ];
        } finally {
            this.isLoading = false;
        }
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

            // If we're in a loading state, fetch providers if not already loading
            if (this.isLoadingState() && !this.isLoading) {
                this.fetchAiProviders();
                
                // Return a loading indicator
                return [{
                    completion: "Loading...",
                    completionId: "loading",
                    type: "room",
                    suffix: " ",
                    component: (
                        <PillCompletion
                            title="Loading..."
                            description="Loading AI providers..."
                        />
                    ),
                    range: range!,
                }];
            }

            const completions: ICompletion[] = [];
            
            // Process each provider - skip any with id "loading"
            for (const provider of this.aiProviders) {
                // Skip loading providers completely
                if (provider.id === "loading") {
                    continue;
                }
                
                // Filter by query if any
                if (query && !provider.id.includes(query) &&
                    !provider.name.toLowerCase().includes(query) &&
                    !provider.provider_type.toLowerCase().includes(query)) {
                    continue;
                }

                // Skip inactive providers
                if (!provider.is_active) {
                    continue;
                }

                completions.push({
                    completion: provider.name,
                    completionId: provider.id,
                    type: "room", // Use "room" type for proper pill styling
                    suffix: " ",
                    component: (
                        <PillCompletion
                            title={provider.name}
                            description={provider.description + (provider.api_key_required ? " (API key required)" : "")}
                        >
                            {/* You could add an AI icon here if desired */}
                        </PillCompletion>
                    ),
                    range: range!,
                });
            }
            
            // If we have no completions and we're not in loading state, show a message
            if (completions.length === 0 && !this.isLoadingState()) {
                return [{
                    completion: "No providers available",
                    completionId: "no_providers",
                    type: "room",
                    suffix: " ",
                    component: (
                        <PillCompletion
                            title="No providers available"
                            description="No AI providers match your query"
                        />
                    ),
                    range: range!,
                }];
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
     * This provider should force complete
     */
    shouldForceComplete(): boolean {
        return true;
    }
}
