import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetaAIService } from './metaAIService.js';
import * as gatewayModule from '../llm/gateway.js';
import { WorkflowConfig } from '../types/index.js';

const mockChat = vi.fn();
vi.mock('../llm/gateway.js', async () => {
    const actual = await vi.importActual<typeof gatewayModule>('../llm/gateway.js');
    return {
        ...actual,
        getGateway: () => ({
            chat: mockChat,
            abort: vi.fn(),
            estimateTokens: vi.fn(),
        }),
    };
});

describe('MetaAIService', () => {
    let service: MetaAIService;

    const validConfig: WorkflowConfig = {
        agents: [{ id: 'a1', name: 'A', persona: 'P', model: 'gpt-4o' }],
        workflow: [],
    };

    beforeEach(() => {
        vi.clearAllMocks();
        service = new MetaAIService({ openai: 'key', anthropic: '', google: '' });
    });

    describe('generateWorkflow()', () => {
        it('parses valid JSON directly', async () => {
            mockChat.mockResolvedValueOnce({ content: JSON.stringify(validConfig) });
            const result = await service.generateWorkflow('do something', null);
            expect(result).toEqual(validConfig);
        });

        it('parses JSON wrapped in markdown code fences', async () => {
            const markdown = `
Here is your workflow:
\`\`\`json
${JSON.stringify(validConfig)}
\`\`\`
Hope it helps!`;
            mockChat.mockResolvedValueOnce({ content: markdown });
            const result = await service.generateWorkflow('do something', null);
            expect(result).toEqual(validConfig);
        });

        it('throws error for invalid JSON or missing required fields', async () => {
            mockChat.mockResolvedValueOnce({ content: '{"agents": []}' }); // missing workflow
            await expect(service.generateWorkflow('do something', null)).rejects.toThrow(/Invalid WorkflowConfig/);
        });
    });
});
