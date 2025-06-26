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

// Match @ followed by any word characters
const AGENT_MENTION_REGEX = /\B@(\w*)/;

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
 * This provider shows up when typing "@" followed by any letters in the chat
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
            commandRegex: AGENT_MENTION_REGEX,
            renderingType,
        });

        this.room = room;
        this.renderingType = renderingType || TimelineRenderingType.Room;

        // Initialize with default values until API response is received
        this.aiProviders = [
            {
                id: "loading",
                name: "Loading...",
                description: "Loading agent providers...",
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
        const config = SdkConfig.get();
        return config.ai_providers_api_url || 'http://staging.iluvatar.tech:8050/api/llm/providers';
    }

    /**
     * Try different methods to get authentication token, prioritizing MatrixClientPeg
     */
    private getAuthHeaders(): HeadersInit {
        const headers: HeadersInit = { 'Content-Type': 'application/json' };
        
        // First try to get admin_access_token from localStorage
        let token = localStorage.getItem('admin_access_token');
        
        // If not found in localStorage, try sessionStorage
        if (!token) {
            token = sessionStorage.getItem('admin_access_token');
        }
        
        // If still not found, try to get from MatrixClientPeg
        if (!token) {
            try {
                token = MatrixClientPeg.get()?.getAccessToken();
            } catch (e) {
                console.warn('Could not get access token from MatrixClientPeg', e);
            }
        }
        
        // If we have a token, add it to headers
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        // Add cache control headers
        headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
        headers['Pragma'] = 'no-cache';
        headers['Expires'] = '0';
        
        return headers;
    }

    /**
     * Explicitly removes the loading provider from the providers array
     */
    private removeLoadingProvider(): void {
        this.aiProviders = this.aiProviders.filter(p => p.id !== "loading");
    }

    /**
     * Check if we should show a loading state
     */
    private isLoadingState(): boolean {
        return this.isLoading || 
               (this.aiProviders.length === 1 && this.aiProviders[0].id === "loading");
    }

    /**
     * Fetch AI providers from the backend API
     */
    private async fetchAiProviders(): Promise<void> {
        if (this.isLoading) return;
        
        this.isLoading = true;
        
        try {
            const apiUrl = this.getAiProvidersApiUrl();
            const headers = this.getAuthHeaders();
            
            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: headers,
                credentials: 'same-origin'
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            // Process the response data
            if (data && Array.isArray(data)) {
                // Filter out any invalid or inactive providers
                const validProviders = data.filter(provider => 
                    provider && 
                    typeof provider.id === 'string' && 
                    typeof provider.name === 'string' &&
                    provider.is_active !== false
                );
                
                this.aiProviders = validProviders;
            } else {
                console.warn('Unexpected API response format:', data);
                // Fallback to default providers if API response is unexpected
                this.aiProviders = [];
            }
            
        } catch (error) {
            console.error('Failed to fetch AI providers:', error);
            // Fallback to default providers on error
            this.aiProviders = [];
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Enhanced filtering function to match providers based on query
     */
    private matchesQuery(provider: AiProviderInfo, query: string): boolean {
        if (!query) return true;

        const lowerQuery = query.toLowerCase();

        // Check multiple fields for matches
        return (
            provider.id.toLowerCase().includes(lowerQuery) ||
            provider.name.toLowerCase().includes(lowerQuery) ||
            provider.provider_type.toLowerCase().includes(lowerQuery) ||
            provider.description.toLowerCase().includes(lowerQuery) ||
            // Check if query matches the start of any word in the name
            provider.name.toLowerCase().split(' ').some(word => word.startsWith(lowerQuery)) ||
            // Check if query matches the start of the provider ID
            provider.id.toLowerCase().startsWith(lowerQuery)
        );
    }

    /**
     * Get name for the section header
     */
    getName(): string {
        // Return "Agent" as the section title
        return "Agent";
    }

    /**
     * Get completions for AI providers when typing "@" followed by letters
     */
    async getCompletions(
        rawQuery: string,
        selection: ISelectionRange,
        force = false,
        limit = -1,
    ): Promise<ICompletion[]> {
        const { command, range } = this.getCurrentCommand(rawQuery, selection, force);
        if (!command?.[0]) return [];

        const query = (command[1] || '').toLowerCase();
        const completions: ICompletion[] = [];

        // If we have no providers yet, trigger a fetch
        if (this.aiProviders.length === 0 || 
            (this.aiProviders.length === 1 && this.aiProviders[0].id === "loading")) {
            if (!this.isLoading) {
                this.fetchAiProviders();
            }
            
            // Return a loading indicator with spinner
            return [{
                completion: "Loading...",
                completionId: "loading-ai-providers",
                type: "room",
                suffix: " ",
                component: (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '8px 12px',
                        color: 'var(--primary-content)',
                        fontFamily: 'var(--font-family)'
                    }}>
                        <div style={{
                            width: '16px',
                            height: '16px',
                            border: '2px solid rgba(255, 255, 255, 0.2)',
                            borderTop: '2px solid var(--primary-content)',
                            borderRadius: '50%',
                            animation: 'spin 1s linear infinite',
                            marginRight: '8px',
                            flexShrink: 0
                        }} />
                        <span>Loading AI providers...</span>
                    </div>
                ),
                range: range!,
            }];
        }

        // Process each provider
        for (const provider of this.aiProviders) {
            // Skip loading and inactive providers
            if (provider.id === "loading" || !provider.is_active) {
                continue;
            }

            // Skip if query doesn't match
            if (query && 
                !provider.id.toLowerCase().includes(query) && 
                !provider.name.toLowerCase().includes(query)) {
                continue;
            }

            completions.push({
                completion: `@${provider.id}`,
                completionId: provider.id,
                type: "room",
                suffix: " ",
                component: (
                    <PillCompletion
                        title={provider.name}
                        description={provider.description + (provider.api_key_required ? " (API key required)" : "")}
                    />
                ),
                range: range!,
            });
        }

        // If we have no completions, show a message
        if (completions.length === 0) {
            return [{
                completion: "No providers available",
                completionId: "no_providers",
                type: "room",
                suffix: " ",
                component: (
                    <PillCompletion
                        title="No providers available"
                        description={query ? `No agent providers match "${query}"` : "No agent providers available"}
                    />
                ),
                range: range!,
            }];
        }

        // Apply limit if specified
        if (limit > 0) {
            return completions.slice(0, limit);
        }

        return completions;
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
        // Clean up any resources if needed
    }

    /**
     * This provider should force complete
     */
    shouldForceComplete(): boolean {
        return true;
    }
}
