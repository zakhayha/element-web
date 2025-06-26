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

// Match @ followed by any letters (more flexible than the original regex)
const AGENT_MENTION_REGEX = /\B@([a-zA-Z]\w*)/g;

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
    public enabled: boolean = true; // Declare enabled property to ensure AI autocomplete is always active for debugging
    private useApiFallback: boolean;

    // Add debounce properties
    private lastFetchTime: number = 0;
    private minFetchInterval: number = 1000; // Debounce interval in milliseconds (1 second)

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
        console.log('AiProvider initialized and enabled');
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

        // Check if we should use API fallback
        this.useApiFallback = localStorage.getItem('ai_provider_api_fallback') === 'true';

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
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        };

        // First, try to get admin_access_token from localStorage
        let token = localStorage.getItem('admin_access_token');
        if (token) {
            console.log('Using admin_access_token from localStorage');
            return { ...headers, 'Authorization': `Bearer ${token}` };
        }

        // If not in localStorage, try sessionStorage
        token = sessionStorage.getItem('admin_access_token');
        if (token) {
            console.log('Using admin_access_token from sessionStorage');
            return { ...headers, 'Authorization': `Bearer ${token}` };
        }

        // Fallback to MatrixClientPeg if available
        try {
            const matrixToken = MatrixClientPeg.get().getAccessToken();
            if (matrixToken) {
                console.log('Using MatrixClientPeg access token');
                return { ...headers, 'Authorization': `Bearer ${matrixToken}` };
            } else {
                console.log('MatrixClientPeg token not available');
            }
        } catch (e) {
            console.error('Failed to get MatrixClientPeg token:', e);
        }

        // Fallback to other common token keys in localStorage/sessionStorage
        const possibleTokenKeys = [
            'access_token',
            'token',
            'auth_token',
            'mx_access_token'
        ];

        for (const key of possibleTokenKeys) {
            token = localStorage.getItem(key) || sessionStorage.getItem(key);
            if (token) {
                console.log(`Using fallback token with key: ${key}`);
                return { ...headers, 'Authorization': `Bearer ${token}` };
            }
        }

        console.log('No authentication token found');
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
     * Test port connectivity before making a request
     */
    private async testPortConnectivity(host: string, port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const socket = new WebSocket(`ws://${host}:${port}`);

            socket.onopen = () => {
                socket.close();
                resolve(true);
            };

            socket.onerror = () => {
                resolve(false);
            };

            // Set a timeout in case the connection hangs
            setTimeout(() => {
                resolve(false);
            }, 5000);
        });
    }

    /**
     * Fetch AI providers from the backend API
     */
    private async fetchAiProviders(): Promise<void> {
        if (this.useApiFallback) {
            console.log('Skipping API fetch due to fallback setting');
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
            ];
            console.log('AI providers set:', this.aiProviders);
            return;
        }

        const now = Date.now();
        if (now - this.lastFetchTime < this.minFetchInterval) {
            console.log('Fetch debounced, too soon since last fetch');
            return;
        }
        this.lastFetchTime = now;

        // Avoid fetching if already in progress
        if (this.isLoading) {
            console.log('Fetch already in progress, skipping');
            return;
        }

        this.isLoading = true;
        console.log('Starting fetch of AI providers');
        try {
            const apiUrl = this.getAiProvidersApiUrl();
            const url = new URL(apiUrl);

            // Temporarily bypass port check for debugging
            // const isPortReachable = await this.testPortConnectivity(url.hostname, parseInt(url.port) || 80);
            // if (!isPortReachable) {
            //     throw new Error(`Port ${url.port} on ${url.hostname} is not reachable`);
            // }

            const headers = this.getAuthHeaders();
            // Log a masked version of the Authorization header for debugging
            if (headers['Authorization']) {
                const tokenParts = headers['Authorization'].split(' ');
                if (tokenParts.length === 2 && tokenParts[0] === 'Bearer') {
                    const token = tokenParts[1];
                    const maskedToken = token.length > 10 ? token.substring(0, 5) + '...' + token.substring(token.length - 5) : '***';
                    console.log(`Using Authorization: Bearer ${maskedToken}`);
                } else {
                    console.log('Using Authorization header with non-Bearer format');
                }
            } else {
                console.log('No Authorization header set');
            }

            const urlWithTimestamp = `${apiUrl}${apiUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`;
            console.log('Fetching AI providers from:', urlWithTimestamp);
            console.log('Request headers:', headers);
            console.log('Request method:', 'GET');
            console.log('Request mode:', 'cors');
            console.log('Credentials mode:', 'include');
            // Increase timeout to 10 seconds
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Fetch timed out after 10 seconds')), 10000)
            );
            const fetchPromise = fetch(urlWithTimestamp, {
                method: 'GET',
                headers,
                mode: 'cors',
                credentials: 'include'  // Send cookies for same-origin requests
            });
            console.log('Initiating fetch request...');
            const response = await Promise.race([fetchPromise, timeoutPromise]);

            // Log response details
            console.log('Response status:', response.status);
            console.log('Response status text:', response.statusText);
            console.log('Response headers:', Object.fromEntries([...response.headers.entries()]));
            console.log('Response body length:', (await response.clone().text()).length);
            console.log('Full response body:', await response.clone().text());

            if (!response.ok) {
                const statusText = response.statusText || 'Unknown error';
                const responseBody = await response.text().catch(() => 'Failed to read response body');
                console.error('Full error response:', responseBody);
                throw new Error(`HTTP error! status: ${response.status} ${statusText}, body: ${responseBody}`);
            }
            const data = await response.json();
            console.log('API response data:', data);

            // Remove loading indicator
            this.removeLoadingProvider();

            // Check if data is an array of providers
            if (Array.isArray(data)) {
                this.aiProviders = data.filter(p => p.is_active);
            } else if (data && data.providers && Array.isArray(data.providers)) {
                // Handle case where providers are nested under a 'providers' key
                this.aiProviders = data.providers.filter(p => p.is_active);
            } else if (Object.keys(data).some(key => Array.isArray(data[key]))) {
                // Find first array property in response
                const possibleArrays = Object.values(data).filter(val => Array.isArray(val));
                // Use the first array found
                this.aiProviders = possibleArrays[0];
            } else if (data.id && data.name) {
                // If it looks like a single provider, use it as a single-item array
                this.aiProviders = [data];
            } else {
                throw new Error("API response format is not supported");
            }
            console.log('AI providers set:', this.aiProviders);
            console.log(`Successfully fetched ${this.aiProviders.length} providers`);
        } catch (error) {
            console.error('Fetch error details:', error.message);
            if (error.response) { // Check if response object exists in error
                console.error('API response status:', error.response.status);
            } else if (error.name === 'AbortError') {
                console.error('Fetch aborted due to timeout');
            }
            // Fallback to default providers if API fails
            console.log('Fell back to default providers due to error:', error.message);
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
            ];
            console.log('AI providers set:', this.aiProviders);
        } finally {
            this.isLoading = false;
            console.log('Setting isLoading to false in finally block');
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
        console.log(`getCompletions called with rawQuery: ${rawQuery}, force: ${force}, isLoadingState: ${this.isLoadingState()}`);
        const { command, range } = this.getCurrentCommand(rawQuery, selection, force);
        if (!command) {
            console.log('No command matched, returning empty');
            return [];
        }

        const query = command[1].toLowerCase();
        console.log(`Detected query after @: ${query}`);

        if (this.isLoadingState()) {
            console.log('Loading state active, showing loading indicator');
            return [{
                completion: "Loading AI providers...",
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
                range: range,
            }];
        }

        // Providers are loaded, filter based on query
        const filteredProviders = this.aiProviders.filter(provider =>
            provider.is_active && this.matchesQuery(provider, query)
        );

        console.log(`Filtered providers count for query '${query}': ${filteredProviders.length}`);

        if (filteredProviders.length === 0) {
            console.log('No matching providers found');
            return [];
        }

        // Map filtered providers to completion objects
        return filteredProviders.map(provider => ({
            completion: provider.name,
            completionId: provider.id,
            type: "room",
            suffix: " ",
            component: (
                <PillCompletion
                    title={provider.name}
                    description={provider.description}
                />
            ),
            range: range,
        })).slice(0, limit > 0 ? limit : undefined);
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
