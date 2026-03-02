import { getDiagnostics, DiagnosticItem, VscodeDiagnosticsApi } from '../tools/ideTools.js';
import { StateManager } from './stateManager.js';

/**
 * HealthCheck — Incremental diagnostic verification between workflow steps.
 *
 * After each step completes, the orchestrator calls `checkAfterStep()` to detect
 * whether the step introduced new TypeScript/linter errors. If error count increased,
 * the result includes a diagnostic summary that can be logged or used to warn
 * the next step's agents.
 */

export interface HealthCheckResult {
    /** Whether the step introduced new errors (errorDelta > 0). */
    hasNewErrors: boolean;
    /** Number of errors before the step. */
    errorsBefore: number;
    /** Number of errors after the step. */
    errorsAfter: number;
    /** Net change in error count (positive = more errors). */
    errorDelta: number;
    /** Human-readable summary for logging / prompt injection. */
    summary: string;
    /** New diagnostic items (only errors, not warnings). */
    newErrors: DiagnosticItem[];
}

export class HealthCheck {
    private lastErrorCount = 0;
    private lastDiagnostics: DiagnosticItem[] = [];

    constructor(
        private readonly vscodeApi: VscodeDiagnosticsApi | undefined,
        private readonly workspaceRoot: string,
        private readonly stateManager: StateManager
    ) { }

    /**
     * Take a baseline snapshot of current diagnostics.
     * Should be called once at workflow start.
     */
    captureBaseline(): void {
        if (!this.vscodeApi) return;
        const parsed = this.parseDiagnostics();
        this.lastErrorCount = parsed.errorCount;
        this.lastDiagnostics = parsed.errors;
    }

    /**
     * Check diagnostics after a step and compare against baseline.
     * Updates the baseline for the next step.
     */
    checkAfterStep(stepNumber: number): HealthCheckResult {
        if (!this.vscodeApi) {
            return {
                hasNewErrors: false,
                errorsBefore: 0,
                errorsAfter: 0,
                errorDelta: 0,
                summary: 'Health check skipped (no VS Code API available)',
                newErrors: [],
            };
        }

        const errorsBefore = this.lastErrorCount;
        const diagsBefore = this.lastDiagnostics;

        const parsed = this.parseDiagnostics();
        const errorsAfter = parsed.errorCount;
        const errorDelta = errorsAfter - errorsBefore;

        // Find new errors not present in the baseline
        const newErrors = parsed.errors.filter(
            (e) => !diagsBefore.some(
                (b) => b.file === e.file && b.line === e.line && b.message === e.message
            )
        );

        // Update baseline for next step
        this.lastErrorCount = errorsAfter;
        this.lastDiagnostics = parsed.errors;

        let summary: string;
        if (errorDelta > 0) {
            summary = `⚠️ Step ${stepNumber} introduced ${errorDelta} new error(s) (${errorsBefore} → ${errorsAfter})`;
            if (newErrors.length > 0) {
                const errorList = newErrors
                    .slice(0, 5)
                    .map((e) => `  - ${e.file}:${e.line}: ${e.message}`)
                    .join('\n');
                summary += `:\n${errorList}`;
                if (newErrors.length > 5) {
                    summary += `\n  ... and ${newErrors.length - 5} more`;
                }
            }
        } else if (errorDelta < 0) {
            summary = `✅ Step ${stepNumber} fixed ${-errorDelta} error(s) (${errorsBefore} → ${errorsAfter})`;
        } else {
            summary = `✅ Step ${stepNumber}: no new errors (${errorsAfter} total)`;
        }

        // Log to execution log
        this.stateManager.log(
            stepNumber,
            '__health_check__',
            errorDelta > 0 ? 'validation_fail' : 'validation_pass',
            summary
        );

        return {
            hasNewErrors: errorDelta > 0,
            errorsBefore,
            errorsAfter,
            errorDelta,
            summary,
            newErrors,
        };
    }

    private parseDiagnostics(): { errorCount: number; errors: DiagnosticItem[] } {
        const raw = getDiagnostics(this.vscodeApi!, this.workspaceRoot);
        // Parse the JSON from the diagnostic string
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        if (!jsonMatch) return { errorCount: 0, errors: [] };

        try {
            const items: DiagnosticItem[] = JSON.parse(jsonMatch[0]);
            const errors = items.filter((d) => d.severity === 'Error');
            return { errorCount: errors.length, errors };
        } catch {
            return { errorCount: 0, errors: [] };
        }
    }
}
