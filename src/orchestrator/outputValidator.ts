import { OutputFormat } from '../types/index.js';

export interface ValidationOutcome {
  pass: boolean;
  reason?: string;
}

/**
 * Output Validator — Checks LLM output against the expected format.
 * Design: fail fast, retry once with a correction prompt.
 */
export class OutputValidator {
  validate(content: string, format: OutputFormat): ValidationOutcome {
    const trimmed = content.trim();

    switch (format) {
      case 'Markdown':
        return this.validateMarkdown(trimmed);
      case 'Mermaid':
        return this.validateMermaid(trimmed);
      case 'JSON':
        return this.validateJSON(trimmed);
      case 'Code':
        return this.validateCode(trimmed);
      case 'PlainText':
        return { pass: true };
      default:
        return { pass: true };
    }
  }

  private validateMarkdown(content: string): ValidationOutcome {
    // Fail if it looks like raw JSON or XML
    if (content.startsWith('{') || content.startsWith('[') || content.startsWith('<')) {
      return {
        pass: false,
        reason: 'Output appears to be JSON/XML, expected Markdown text.',
      };
    }
    return { pass: true };
  }

  private validateMermaid(content: string): ValidationOutcome {
    const mermaidKeywords = [
      'graph ',
      'flowchart ',
      'sequenceDiagram',
      'classDiagram',
      'stateDiagram',
      'erDiagram',
      'gantt',
      'pie',
      'gitGraph',
      'mindmap',
      'timeline',
    ];
    const lower = content.toLowerCase();
    const hasMermaid = mermaidKeywords.some((kw) => lower.includes(kw.toLowerCase()));
    if (!hasMermaid) {
      return {
        pass: false,
        reason: 'Output does not contain valid Mermaid diagram syntax.',
      };
    }
    return { pass: true };
  }

  private validateJSON(content: string): ValidationOutcome {
    // Strip markdown code fences if present
    let stripped = content;
    const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      stripped = fenceMatch[1].trim();
    }
    try {
      JSON.parse(stripped);
      return { pass: true };
    } catch {
      return { pass: false, reason: 'Output is not valid JSON.' };
    }
  }

  private validateCode(content: string): ValidationOutcome {
    // Accept content with at least one recognizable code pattern
    const codePatterns = [
      /import\s+/,
      /export\s+/,
      /function\s+\w+/,
      /const\s+\w+\s*=/,
      /let\s+\w+\s*=/,
      /var\s+\w+\s*=/,
      /class\s+\w+/,
      /def\s+\w+/,
      /public\s+\w+/,
      /private\s+\w+/,
      /#include/,
      /package\s+main/,
    ];

    const hasCode = codePatterns.some((p) => p.test(content));
    if (!hasCode) {
      return {
        pass: false,
        reason: 'Output does not appear to contain code.',
      };
    }
    return { pass: true };
  }

  /** Extract handover note from output, returning { mainContent, note }.
   *  Supports Japanese (--- 引き継ぎメモ ---) and English (--- Handover Note ---) separators.
   */
  extractHandoverNote(content: string): { mainContent: string; note: string | null } {
    const separator = /^---\s*(?:引き継ぎメモ|Handover Note)\s*---$/im;
    const match = content.match(separator);
    if (!match || match.index === undefined) {
      return { mainContent: content, note: null };
    }
    const mainContent = content.slice(0, match.index).trimEnd();
    const note = content.slice(match.index + match[0].length).trim();
    return { mainContent, note: note || null };
  }
}
