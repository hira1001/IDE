import { execSync } from 'child_process';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 8_000;

/**
 * Execute a shell command in the workspace root.
 * Returns combined stdout + stderr, truncated if too long.
 *
 * @param command        - Shell command to execute
 * @param workspaceRoot  - Absolute path to the workspace root (cwd for execution)
 * @param autoApprove    - Skip confirmation dialog (autonomy mode)
 * @param confirmFn      - Called when autoApprove is false; returns true if approved
 * @param timeoutMs      - Max execution time in ms (default: 30 000)
 */
export async function runTerminal(
  command: string,
  workspaceRoot: string,
  autoApprove: boolean,
  confirmFn: (command: string) => Promise<boolean>,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<string> {
  if (!autoApprove) {
    const approved = await confirmFn(command);
    if (!approved) {
      return `Command cancelled by user: ${command}`;
    }
  }

  try {
    const output = execSync(command, {
      cwd: workspaceRoot,
      timeout: timeoutMs,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return truncate(output || '(no output)', MAX_OUTPUT_CHARS);
  } catch (err: unknown) {
    // execSync throws when exit code != 0 — but we still want to capture output
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const combined = [e.stdout, e.stderr].filter(Boolean).join('\n') || e.message || String(err);
    return truncate(`Command failed:\n${combined}`, MAX_OUTPUT_CHARS);
  }
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + `\n...(output truncated at ${maxChars} chars)`;
}
