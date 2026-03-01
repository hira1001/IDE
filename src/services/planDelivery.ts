import * as vscode from 'vscode';

/**
 * PlanDelivery — Handles delivering generated workflow plans to AI agents.
 *
 * Three delivery methods:
 * 1. Copy to clipboard
 * 2. Save to workspace file (.agent/workflows/current.md)
 * 3. Both + notification (Send to AI)
 */
export class PlanDelivery {
    /**
     * Copy Markdown plan to the clipboard.
     */
    async copyToClipboard(markdown: string): Promise<void> {
        await vscode.env.clipboard.writeText(markdown);
    }

    /**
     * Save a plan to `.agent/workflows/current.md` in the workspace root.
     * Creates the directory if it doesn't exist.
     * Returns the absolute file path.
     */
    async saveToWorkspace(markdown: string): Promise<string> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!workspaceRoot) {
            throw new Error('No workspace folder is open.');
        }

        const dirUri = vscode.Uri.joinPath(workspaceRoot, '.agent', 'workflows');
        try {
            await vscode.workspace.fs.createDirectory(dirUri);
        } catch {
            // Directory may already exist
        }

        const fileUri = vscode.Uri.joinPath(dirUri, 'current.md');
        const content = new TextEncoder().encode(markdown);
        await vscode.workspace.fs.writeFile(fileUri, content);

        return fileUri.fsPath;
    }

    /**
     * Send to AI — performs all delivery steps:
     * 1. Copy to clipboard
     * 2. Save to workspace file
     * 3. Show notification to user
     */
    async sendToAI(markdown: string): Promise<void> {
        await this.copyToClipboard(markdown);

        let filePath: string | undefined;
        try {
            filePath = await this.saveToWorkspace(markdown);
        } catch {
            // If workspace save fails, clipboard copy is still available
        }

        const fileNote = filePath
            ? ` 📄 ${filePath} にも保存しました。`
            : '';

        vscode.window.showInformationMessage(
            `✅ ワークフロー計画書をクリップボードにコピーしました。AIチャットに貼り付けてください。${fileNote}`
        );
    }
}
