// c:\Project\IDE\src\services\projectContextProvider.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ProjectContextProvider } from './projectContextProvider.js';
import { FileContextProvider } from './fileContextProvider.js';

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        existsSync: vi.fn(),
        readFileSync: vi.fn(),
        readdirSync: vi.fn(),
        statSync: vi.fn(),
    };
});

describe('ProjectContextProvider', () => {
    let fileContextProvider: FileContextProvider;
    let provider: ProjectContextProvider;

    // Absolute paths for testing
    const workspaceRoot = path.resolve('/workspace');
    const srcDir = path.join(workspaceRoot, 'src');
    const indexFile = path.join(srcDir, 'index.ts');

    beforeEach(() => {
        vi.clearAllMocks();
        fileContextProvider = new FileContextProvider();
        vi.spyOn(fileContextProvider, 'getActiveFileSnapshot').mockReturnValue({
            content: 'const a = 1;',
            filename: indexFile,
            language_id: 'typescript',
            line_count: 1,
            byte_size: 12,
        });

        provider = new ProjectContextProvider(fileContextProvider);
    });

    describe('buildProjectContext()', () => {
        it('returns file mode context when no workspace is provided', async () => {
            const context = await provider.buildProjectContext(undefined, {
                mode: 'project',
                tokenBudget: 10000,
            });

            expect(context.mode).toBe('file');
            expect(context.activeFile?.filename).toBe(indexFile);
            expect(context.fileTree).toBe('');
            expect(context.relatedFiles).toHaveLength(0);
        });

        it('returns file mode context when mode is explicitly file', async () => {
            const context = await provider.buildProjectContext(workspaceRoot, {
                mode: 'file',
                tokenBudget: 32000,
            });

            expect(context.mode).toBe('file');
            expect(context.activeFile?.filename).toBe(indexFile);
            expect(context.fileTree).toBe('');
        });

        it('builds full project context with tree and related files', async () => {
            // Mock getActiveFilePath so findRelatedFiles is actually called.
            // In test environments require('vscode') throws, making getActiveFilePath()
            // return null and causing relatedFiles to always be [].
            vi.spyOn(provider as any, 'getActiveFilePath').mockReturnValue(indexFile);

            (fs.existsSync as any).mockImplementation((p: string) => {
                const str = String(p).replace(/\\/g, '/');
                if (str.includes('.gitignore')) return false;
                return str.includes('package.json') || str.includes('index.ts') || str.includes('utils.ts');
            });

            (fs.readFileSync as any).mockImplementation((p: string) => {
                const str = String(p).replace(/\\/g, '/');
                if (str.includes('package.json')) return '{"name":"test"}';
                if (str.includes('index.ts')) return 'import { foo } from "./utils";\nconst a = 1;';
                if (str.includes('utils.ts')) return 'export const foo = 1;';
                return '';
            });

            (fs.readdirSync as any).mockImplementation((p: string) => {
                const str = String(p).replace(/\\/g, '/');
                if (str.endsWith('/src') || str === srcDir.replace(/\\/g, '/')) {
                    return [
                        { name: 'index.ts', isFile: () => true, isDirectory: () => false },
                        { name: 'utils.ts', isFile: () => true, isDirectory: () => false }
                    ];
                }
                return [
                    { name: 'src', isFile: () => false, isDirectory: () => true },
                    { name: 'package.json', isFile: () => true, isDirectory: () => false }
                ];
            });

            (fs.statSync as any).mockReturnValue({
                size: 100,
                isFile: () => true,
                isDirectory: () => false,
            });

            const context = await provider.buildProjectContext(workspaceRoot, {
                mode: 'project',
                tokenBudget: 32000,
            });

            expect(context.mode).toBe('project');
            expect(context.activeFile?.filename).toBe(indexFile);
            expect(context.fileTree).not.toBe('');

            const relPaths = context.relatedFiles.map((f) => f.relativePath.replace(/\\/g, '/'));
            expect(relPaths).toContain('package.json');
            expect(relPaths).toContain('src/utils.ts');
        });
    });
});
