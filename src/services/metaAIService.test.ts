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

        it('uses temperature 0.2 for deterministic JSON output', async () => {
            mockChat.mockResolvedValueOnce({ content: JSON.stringify(validConfig) });
            await service.generateWorkflow('do something', null);
            const callArgs = mockChat.mock.calls[0][0] as { temperature: number };
            expect(callArgs.temperature).toBe(0.2);
        });

        it('interpolates source context into system prompt', async () => {
            mockChat.mockResolvedValueOnce({ content: JSON.stringify(validConfig) });
            await service.generateWorkflow('do something', {
                filename: 'app.ts',
                language_id: 'typescript',
                line_count: 42,
                byte_size: 0,
                content: '',
            });
            const callArgs = mockChat.mock.calls[0][0] as { system_prompt: string };
            expect(callArgs.system_prompt).toContain('app.ts');
            expect(callArgs.system_prompt).toContain('typescript');
            expect(callArgs.system_prompt).toContain('42');
        });
    });

    describe('validateConfig() — enhanced semantic checks', () => {
        const makeConfig = (overrides: Partial<WorkflowConfig>): WorkflowConfig => ({
            agents: [{ id: 'agent_001', name: 'A', persona: 'P', model: 'gpt-4o' }],
            workflow: [
                {
                    step: 1, type: 'sequential', pause_after: false,
                    tasks: [{
                        task_id: 'task_001', agent_id: 'agent_001', task_name: 'T',
                        instructions: ['Do X'], constraints: [], output_format: 'Markdown',
                        output_key: 'result', input_mapping: [], enable_handover_note: false,
                    }],
                },
            ],
            ...overrides,
        });

        it('accepts a fully valid config', async () => {
            mockChat.mockResolvedValueOnce({ content: JSON.stringify(makeConfig({})) });
            await expect(service.generateWorkflow('x', null)).resolves.toBeDefined();
        });

        it('rejects a task referencing an unknown agent_id', async () => {
            const cfg = makeConfig({});
            cfg.workflow[0].tasks[0].agent_id = 'agent_999';
            mockChat.mockResolvedValueOnce({ content: JSON.stringify(cfg) });
            await expect(service.generateWorkflow('x', null)).rejects.toThrow(/unknown agent_id/);
        });

        it('rejects duplicate output_key across tasks', async () => {
            const cfg = makeConfig({});
            cfg.workflow[0].tasks.push({
                task_id: 'task_002', agent_id: 'agent_001', task_name: 'T2',
                instructions: ['Do Y'], constraints: [], output_format: 'Markdown',
                output_key: 'result', // same as task_001
                input_mapping: [], enable_handover_note: false,
            });
            mockChat.mockResolvedValueOnce({ content: JSON.stringify(cfg) });
            await expect(service.generateWorkflow('x', null)).rejects.toThrow(/Duplicate output_key/);
        });

        it('rejects input_mapping referencing a non-existent step', async () => {
            const cfg = makeConfig({});
            cfg.workflow[0].tasks[0].input_mapping = [
                { from_step: 99, from_agent_id: 'agent_001', label: 'ghost step' },
            ];
            mockChat.mockResolvedValueOnce({ content: JSON.stringify(cfg) });
            await expect(service.generateWorkflow('x', null)).rejects.toThrow(/non-existent step 99/);
        });

        it('allows input_mapping from_step: 0 (source file) without error', async () => {
            const cfg = makeConfig({});
            cfg.workflow[0].tasks[0].input_mapping = [
                { from_step: 0, from_agent_id: '__source__', label: 'Source' },
            ];
            mockChat.mockResolvedValueOnce({ content: JSON.stringify(cfg) });
            await expect(service.generateWorkflow('x', null)).resolves.toBeDefined();
        });

        it('rejects a task with an empty instructions array', async () => {
            const cfg = makeConfig({});
            cfg.workflow[0].tasks[0].instructions = [];
            mockChat.mockResolvedValueOnce({ content: JSON.stringify(cfg) });
            await expect(service.generateWorkflow('x', null)).rejects.toThrow(/no instructions/);
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
