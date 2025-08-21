import { EventEmitter } from 'events';
import { logger } from '@librechat/data-schemas';
import type * as t from './types';
import { MCPConnection } from './connection';
import { v4 as uuidv4 } from 'uuid';

export class ElicitationManager extends EventEmitter {
    /** Store active elicitation requests */
    private elicitationStates: Map<string, t.ElicitationState> = new Map();
    /** Store elicitation response resolvers */
    private elicitationResolvers: Map<string, (response: t.ElicitationResponse) => void> = new Map();

    constructor() {
        super();
    }

    /**
     * Retrieves all active elicitations for a given tool call ID.
     * @param toolCallId The ID of the tool call.
     * @returns An array of active elicitation states.
     */
    public getActiveElicitationsForToolCall(toolCallId: string): t.ElicitationState[] {
        if (!toolCallId) {
            return [];
        }
        const activeElicitations: t.ElicitationState[] = [];
        for (const elicitation of this.elicitationStates.values()) {
            if (elicitation.tool_call_id === toolCallId) {
                activeElicitations.push(elicitation);
            }
        }
        return activeElicitations;
    }

    public async requestElicitation(connection: MCPConnection, userId?: string): Promise<void> {
        connection.on(
            'elicitationRequest',
            async (data: {
                serverName: string;
                userId?: string;
                request: t.ElicitationCreateRequest;
                resolve: (response: t.ElicitationResponse) => void;
                context?: { tool_call_id?: string };
            }) => {
                logger.info(`[MCP][${data.serverName}] Elicitation request received`);

                // For app-level connections, we can't handle elicitation since there's no specific user
                if (!userId) {
                    logger.warn(`[MCP][${data.serverName}] Cannot handle elicitation for app-level connection`);
                    data.resolve({ action: 'decline' });
                    return;
                }

                const elicitationId = uuidv4();
                const elicitationState: t.ElicitationState = {
                    id: elicitationId,
                    serverName: data.serverName,
                    userId: userId,
                    request: data.request,
                    tool_call_id: data.context?.tool_call_id ?? data.request?.tool_call_id,
                    timestamp: Date.now(),
                };

                this.elicitationStates.set(elicitationId, elicitationState);
                this.elicitationResolvers.set(elicitationId, data.resolve);

                this.emit('elicitationCreated', {
                    userId: userId,
                    elicitationId,
                    tool_call_id: elicitationState.tool_call_id,
                });
                logger.info(`[MCP][${data.serverName}] Elicitation state stored with ID: ${elicitationId}`);
            },
        );
    }

    /** Get active elicitation request by ID */
    public getElicitationState(elicitationId: string): t.ElicitationState | undefined {
        return this.elicitationStates.get(elicitationId);
    }

    /** Get all active elicitation requests for a user */
    public getUserElicitationStates(userId: string): t.ElicitationState[] {
        return Array.from(this.elicitationStates.values()).filter((state) => state.userId === userId);
    }

    /** Respond to an elicitation request */
    public respondToElicitation(elicitationId: string, response: t.ElicitationResponse): boolean {
        const resolver = this.elicitationResolvers.get(elicitationId);
        if (!resolver) {
            logger.warn(`[MCP] No resolver found for elicitation ID: ${elicitationId}`);
            return false;
        }

        // Clean up state
        this.elicitationStates.delete(elicitationId);
        this.elicitationResolvers.delete(elicitationId);

        // Resolve the promise
        resolver(response);
        logger.info(`[MCP] Elicitation ${elicitationId} resolved with action: ${response.action}`);
        return true;
    }
}