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

    describe('draftAgentInstruction()', () => {
        it('returns the AI response text trimmed', async () => {
            mockChat.mockResolvedValueOnce({ content: '  ## Objective\nDo the thing.\n  ' });
            const result = await service.draftAgentInstruction('do the thing', {
                agentName: 'Reviewer',
                persona: 'Senior engineer',
                taskName: 'Code review',
            });
            expect(result).toBe('## Objective\nDo the thing.');
        });

        it('passes agent context into the user prompt', async () => {
            mockChat.mockResolvedValueOnce({ content: '## Objective\nOK' });
            await service.draftAgentInstruction('brief here', {
                agentName: 'Analyst',
                persona: 'Data scientist',
                taskName: 'Analysis',
                fileName: 'data.py',
            });
            const callArgs = mockChat.mock.calls[0][0] as { user_prompt: string };
            expect(callArgs.user_prompt).toContain('Analyst');
            expect(callArgs.user_prompt).toContain('Data scientist');
            expect(callArgs.user_prompt).toContain('Analysis');
            expect(callArgs.user_prompt).toContain('data.py');
            expect(callArgs.user_prompt).toContain('brief here');
        });

        it('uses temperature 0.4 and max_tokens 2048', async () => {
            mockChat.mockResolvedValueOnce({ content: '## Objective\nOK' });
            await service.draftAgentInstruction('brief', {
                agentName: 'A', persona: '', taskName: 'T',
            });
            const callArgs = mockChat.mock.calls[0][0] as { temperature: number; max_tokens: number };
            expect(callArgs.temperature).toBe(0.4);
            expect(callArgs.max_tokens).toBe(2048);
        });
    });
});
