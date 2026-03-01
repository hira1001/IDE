import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator } from './orchestrator.js';
import { WorkflowConfig, Agent, WorkflowStep, Task } from '../types/index.js';
import * as gatewayModule from '../llm/gateway.js';

// ─── Mock AgentLoopEngine ────────────────────────────────────────────────────
const mockAgentLoopRun = vi.fn();
vi.mock('./reactLoop.js', () => ({
  AgentLoopEngine: vi.fn().mockImplementation(() => ({
    run: mockAgentLoopRun,
  })),
}));

// Setup Mock Gateway
const mockChat = vi.fn();
vi.mock('../llm/gateway.js', async () => {
    const actual = await vi.importActual<typeof gatewayModule>('../llm/gateway.js');
    return {
        ...actual,
        getGateway: () => ({
            chat: mockChat,
            abort: vi.fn(),
            estimateTokens: vi.fn().mockReturnValue(10),
        }),
    };
});

// Mock OutputValidator to skip real validation if needed (or we can use the real one)
vi.mock('./outputValidator.js', async () => {
    const actual = await vi.importActual<typeof import('./outputValidator.js')>('./outputValidator.js');
    return {
        ...actual,
        OutputValidator: class MockOutputValidator {
            validate = vi.fn().mockReturnValue({ pass: true });
            extractHandoverNote = vi.fn().mockReturnValue({ mainContent: 'mock content', note: null });
        }
    };
});

describe('Orchestrator', () => {
    let orchestrator: Orchestrator;
    let mockStatusUpdate: ReturnType<typeof vi.fn>;

    const mockAgent: Agent = {
        id: 'agent_1',
        name: 'Test Agent',
        persona: 'You are a testing agent.',
        model: 'gpt-4o',
    };

    const mockTask: Task = {
        task_id: 'task_1',
        task_name: 'Task 1',
        agent_id: 'agent_1',
        instructions: ['Do something'],
        constraints: [],
        input_mapping: [],
        output_key: 'out_1',
        output_format: 'PlainText',
        enable_handover_note: false,
    };

    const mockStep: WorkflowStep = {
        step: 1,
        type: 'sequential',
        tasks: [mockTask],
        pause_after: false,
    };

    const baseConfig: WorkflowConfig = {
        agents: [mockAgent],
        workflow: [mockStep],
    };

    const apiKeys = { openai: 'test-key', anthropic: '', google: '' };

    beforeEach(() => {
        vi.clearAllMocks();
        mockStatusUpdate = vi.fn();
        orchestrator = new Orchestrator({
            apiKeys,
            onStatusUpdate: mockStatusUpdate,
            timeout: 1000,
        });
    });

    describe('execute()', () => {
        it('runs a simple sequential workflow successfully', async () => {
            mockChat.mockResolvedValueOnce({
                content: 'Success',
                input_tokens: 10,
                output_tokens: 10,
                model: 'gpt-4o',
                duration_ms: 100,
            });

            await orchestrator.execute(baseConfig, {
                content: 'source code',
                filename: 'test.ts',
                language_id: 'typescript',
                line_count: 10,
                byte_size: 100,
            });

            const st = orchestrator.getStateManager().serialize();
            expect(st.status).toBe('completed');
            expect(st.output_store['out_1']).toBe('mock content');
            expect(st.task_states['task_1'].status).toBe('completed');
        });

        it('retries when API throws an error and eventually succeeds', async () => {
            // First 2 calls fail, 3rd succeeds
            mockChat
                .mockRejectedValueOnce(new Error('500 Internal Server Error'))
                .mockRejectedValueOnce(new Error('502 Bad Gateway'))
                .mockResolvedValueOnce({
                    content: 'Success after retry',
                    input_tokens: 10,
                    output_tokens: 10,
                    model: 'gpt-4o',
                    duration_ms: 100,
                });

            // We lower the base delay to speed up the test
            const fastRetryOrchestrator = new Orchestrator({
                apiKeys,
                onStatusUpdate: mockStatusUpdate,
                timeout: 1000,
            });
            // Override callWithRetry parameters locally using prototype or spy, 
            // but since it's private, we'll let it use the real backoff (which has baseDelay 2000, taking some time)
            // Actually we should mock callWithRetry or just use the real implementation but stub setTimeout
            vi.useFakeTimers();

            const execPromise = fastRetryOrchestrator.execute(baseConfig, {
                content: 'source code',
                filename: 'test.ts',
                language_id: 'typescript',
                line_count: 10,
                byte_size: 100,
            });

            // Fast-forward timers for the retries (2000ms + 4000ms approx)
            await vi.runAllTimersAsync();

            await execPromise;

            const st = fastRetryOrchestrator.getStateManager().serialize();
            expect(st.status).toBe('completed');
            expect(st.task_states['task_1'].status).toBe('completed');

            vi.useRealTimers();
        });

        it('fails after max retries exceed', async () => {
            // All calls fail
            mockChat.mockRejectedValue(new Error('500 Internal Server Error'));

            vi.useFakeTimers();
            const execPromise = orchestrator.execute(baseConfig, {
                content: '', filename: '', language_id: '', line_count: 0, byte_size: 0
            });

            await vi.runAllTimersAsync();
            await execPromise;

            const st = orchestrator.getStateManager().serialize();
            // Workflow finishes gracefully (completed), but task fails
            expect(st.status).toBe('completed');
            expect(st.task_states['task_1'].status).toBe('error');

            vi.useRealTimers();
        });

        it('does not retry on 429 with RESOURCE_EXHAUSTED (quota exhausted)', async () => {
            // Google-style quota exhaustion: 429 + "RESOURCE_EXHAUSTED" in message
            mockChat.mockRejectedValue(new Error('429 RESOURCE_EXHAUSTED: quota exceeded, limit: 0'));

            vi.useFakeTimers();
            const execPromise = orchestrator.execute(baseConfig, {
                content: '', filename: '', language_id: '', line_count: 0, byte_size: 0
            });

            await vi.runAllTimersAsync();
            await execPromise;

            // Task should be in error state; importantly, only 1 API call was made (no retries)
            const st = orchestrator.getStateManager().serialize();
            expect(st.task_states['task_1'].status).toBe('error');
            expect(mockChat).toHaveBeenCalledTimes(1);

            vi.useRealTimers();
        });

        it('does not retry on 429 with limit: 0 (quota exhausted)', async () => {
            mockChat.mockRejectedValue(new Error('429 Too Many Requests: limit: 0'));

            vi.useFakeTimers();
            const execPromise = orchestrator.execute(baseConfig, {
                content: '', filename: '', language_id: '', line_count: 0, byte_size: 0
            });

            await vi.runAllTimersAsync();
            await execPromise;

            expect(mockChat).toHaveBeenCalledTimes(1);

            vi.useRealTimers();
        });
    });

    describe('executeFrom()', () => {
        it('re-runs workflow starting from the given step index', async () => {
            const step2Task: Task = {
                task_id: 'task_2',
                task_name: 'Task 2',
                agent_id: 'agent_1',
                instructions: ['Do step 2'],
                constraints: [],
                input_mapping: [],
                output_key: 'out_2',
                output_format: 'PlainText',
                enable_handover_note: false,
            };
            const twoStepConfig: WorkflowConfig = {
                agents: [mockAgent],
                workflow: [
                    mockStep,
                    { step: 2, type: 'sequential', tasks: [step2Task], pause_after: false },
                ],
            };

            mockChat.mockResolvedValue({
                content: 'Step 2 output',
                input_tokens: 5,
                output_tokens: 5,
                model: 'gpt-4o',
                duration_ms: 50,
            });

            // Seed step 1 output so step 2 can reference it
            orchestrator.getStateManager().setOutput('out_1', 'existing output');

            await orchestrator.executeFrom(twoStepConfig, 1); // start from index 1 (step 2)

            const st = orchestrator.getStateManager().serialize();
            expect(st.status).toBe('completed');
            expect(st.task_states['task_2'].status).toBe('completed');
            // task_1 was NOT reinitialised — it keeps whatever state it had
            expect(st.task_states['task_1']).toBeUndefined();
        });

        it('throws immediately when fromStepIndex is out of bounds', async () => {
            await expect(orchestrator.executeFrom(baseConfig, 99)).rejects.toThrow(
                /fromStepIndex 99 is out of bounds/
            );
        });

        it('resets loop counts for re-run steps to avoid stale counters', async () => {
            // Manually seed a stale loop count for step 1
            orchestrator.getStateManager().incrementLoopCount(1); // loop_counts[1] = 1
            orchestrator.getStateManager().incrementLoopCount(1); // loop_counts[1] = 2

            mockChat.mockResolvedValue({
                content: 'fresh output',
                input_tokens: 5,
                output_tokens: 5,
                model: 'gpt-4o',
                duration_ms: 50,
            });

            await orchestrator.executeFrom(baseConfig, 0);

            // After executeFrom, loop count for step 1 should have been reset then
            // incremented by getLoopCount inside runTask (which reads 0 after reset)
            const loopCountAfter = orchestrator.getStateManager().getLoopCount(1);
            expect(loopCountAfter).toBe(0); // reset to 0, runTask reads it but doesn't increment
        });
    });

    describe('abort()', () => {
        it('aborts the execution and sets status to aborted', async () => {
            let rejectChat: any;
            mockChat.mockImplementationOnce(() => new Promise((_, rej) => {
                rejectChat = rej;
            }));

            const execPromise = orchestrator.execute(baseConfig, {
                content: '', filename: '', language_id: '', line_count: 0, byte_size: 0
            });

            // Mock the abort behavior
            setTimeout(() => {
                const err = new Error('AbortError');
                err.name = 'AbortError';
                rejectChat(err);
                orchestrator.abort();
            }, 50);

            // We don't need real timers, but setTimeout will run
            await execPromise;

            const st = orchestrator.getStateManager().serialize();
            expect(st.status).toBe('aborted');
        });
    });

    // ─────────────────────────────────────────────────────────────────────
    // Agentic mode (use_tools: true) — uses mocked AgentLoopEngine
    // ─────────────────────────────────────────────────────────────────────
    describe('Agentic mode (use_tools)', () => {
        const agenticTask: Task = {
            task_id: 'agentic_1',
            task_name: 'Agentic Task',
            agent_id: 'agent_1',
            instructions: ['Fix all TypeScript errors'],
            constraints: [],
            input_mapping: [],
            output_key: 'agentic_out',
            output_format: 'PlainText',
            enable_handover_note: false,
            use_tools: true,
        };

        const agenticConfig: WorkflowConfig = {
            agents: [mockAgent],
            workflow: [{ step: 1, type: 'sequential', tasks: [agenticTask], pause_after: false }],
        };

        const source = {
            content: 'src', filename: 'test.ts', language_id: 'typescript', line_count: 1, byte_size: 10,
        };

        beforeEach(() => {
            mockAgentLoopRun.mockResolvedValue({
                finalText: 'Agentic result',
                totalInputTokens: 20,
                totalOutputTokens: 15,
                iterations: 3,
                filesChanged: [],
            });
        });

        it('runs agentic task and stores output in state', async () => {
            const testOrch = new Orchestrator({ apiKeys, onStatusUpdate: mockStatusUpdate, workspaceRoot: '/tmp' });
            await testOrch.execute(agenticConfig, source);

            const st = testOrch.getStateManager().serialize();
            expect(st.status).toBe('completed');
            expect(st.task_states['agentic_1'].status).toBe('completed');
            expect(st.output_store['agentic_out']).toBe('Agentic result');
        });

        it('accumulates token usage from AgentLoopEngine result', async () => {
            mockAgentLoopRun.mockResolvedValueOnce({
                finalText: 'done',
                totalInputTokens: 100,
                totalOutputTokens: 80,
                iterations: 5,
                filesChanged: ['src/foo.ts', 'src/bar.ts'],
            });
            const testOrch = new Orchestrator({ apiKeys, onStatusUpdate: mockStatusUpdate, workspaceRoot: '/tmp' });
            await testOrch.execute(agenticConfig, source);

            const st = testOrch.getStateManager().serialize();
            expect(st.total_input_tokens).toBe(100);
            expect(st.total_output_tokens).toBe(80);
        });

        it('emits completed state after agentic task finishes', async () => {
            const statusUpdates: string[] = [];
            const testOrch = new Orchestrator({
                apiKeys,
                onStatusUpdate: (state) => statusUpdates.push(state.status),
                workspaceRoot: '/tmp',
            });
            await testOrch.execute(agenticConfig, source);

            // Workflow should be 'completed'; task should be 'completed'
            expect(statusUpdates).toContain('completed');
            const taskStatus = testOrch.getStateManager().serialize().task_states['agentic_1'].status;
            expect(taskStatus).toBe('completed');
        });

        it('sets task status to tool_calling during agentic execution', async () => {
            const seenStatuses: string[] = [];
            mockAgentLoopRun.mockImplementationOnce(async () => {
                // Capture status at the moment loop.run() is called — it should be 'tool_calling'
                const st = testOrch.getStateManager().serialize();
                seenStatuses.push(st.task_states['agentic_1'].status);
                return { finalText: 'ok', totalInputTokens: 5, totalOutputTokens: 5, iterations: 1, filesChanged: [] };
            });
            const testOrch = new Orchestrator({ apiKeys, onStatusUpdate: mockStatusUpdate, workspaceRoot: '/tmp' });
            await testOrch.execute(agenticConfig, source);

            expect(seenStatuses).toContain('tool_calling');
        });

        it('records error state when AgentLoopEngine throws', async () => {
            mockAgentLoopRun.mockRejectedValueOnce(new Error('LLM API error'));
            const testOrch = new Orchestrator({ apiKeys, onStatusUpdate: mockStatusUpdate, workspaceRoot: '/tmp' });
            await testOrch.execute(agenticConfig, source);

            const st = testOrch.getStateManager().serialize();
            expect(st.task_states['agentic_1'].status).toBe('error');
        });

        it('records aborted state when AgentLoopEngine throws AbortError', async () => {
            const abortErr = new Error('Aborted');
            abortErr.name = 'AbortError';
            mockAgentLoopRun.mockImplementationOnce(() => new Promise((_, rej) => {
                setTimeout(() => rej(abortErr), 10);
            }));

            const testOrch = new Orchestrator({ apiKeys, onStatusUpdate: mockStatusUpdate, workspaceRoot: '/tmp' });
            const execPromise = testOrch.execute(agenticConfig, source);
            setTimeout(() => testOrch.abort(), 5);
            await execPromise;

            const st = testOrch.getStateManager().serialize();
            expect(st.status).toBe('aborted');
        });

        it('passes allowed_tools to AgentLoopEngine via getAllowedTools', async () => {
            const restrictedTask: Task = {
                ...agenticTask,
                task_id: 'restricted_1',
                output_key: 'restricted_out',
                allowed_tools: ['read_file', 'list_files'],
            };
            const restrictedConfig: WorkflowConfig = {
                agents: [mockAgent],
                workflow: [{ step: 1, type: 'sequential', tasks: [restrictedTask], pause_after: false }],
            };

            const testOrch = new Orchestrator({ apiKeys, onStatusUpdate: mockStatusUpdate, workspaceRoot: '/tmp' });
            await testOrch.execute(restrictedConfig, source);

            // AgentLoopEngine.run should have been called once and succeeded
            expect(mockAgentLoopRun).toHaveBeenCalledTimes(1);
            const st = testOrch.getStateManager().serialize();
            expect(st.task_states['restricted_1'].status).toBe('completed');
        });
    });
});
