import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator } from './orchestrator.js';
import { WorkflowConfig, Agent, WorkflowStep, Task } from '../types/index.js';
import * as gatewayModule from '../llm/gateway.js';

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
});
