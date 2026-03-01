import { describe, it, expect } from 'vitest';
import { OutputValidator } from './outputValidator.js';

describe('OutputValidator', () => {
  const validator = new OutputValidator();

  describe('Markdown validation', () => {
    it('passes for normal text', () => {
      expect(validator.validate('# Hello\nThis is markdown', 'Markdown').pass).toBe(true);
    });

    it('passes for plain text starting with letters', () => {
      expect(validator.validate('This is a plain paragraph.', 'Markdown').pass).toBe(true);
    });

    it('fails for JSON-like output', () => {
      expect(validator.validate('{"key": "value"}', 'Markdown').pass).toBe(false);
    });

    it('fails for XML-like output', () => {
      expect(validator.validate('<root><item/></root>', 'Markdown').pass).toBe(false);
    });
  });

  describe('Mermaid validation', () => {
    it('passes for graph TD', () => {
      expect(validator.validate('graph TD\n  A --> B', 'Mermaid').pass).toBe(true);
    });

    it('passes for flowchart', () => {
      expect(validator.validate('flowchart LR\n  A --> B', 'Mermaid').pass).toBe(true);
    });

    it('passes for sequenceDiagram', () => {
      expect(validator.validate('sequenceDiagram\n  A->>B: Hello', 'Mermaid').pass).toBe(true);
    });

    it('fails for plain text without Mermaid syntax', () => {
      expect(validator.validate('Here is a diagram of the system.', 'Mermaid').pass).toBe(false);
    });
  });

  describe('JSON validation', () => {
    it('passes for valid JSON object', () => {
      expect(validator.validate('{"name":"test","value":42}', 'JSON').pass).toBe(true);
    });

    it('passes for JSON in code fence', () => {
      expect(validator.validate('```json\n{"key":"val"}\n```', 'JSON').pass).toBe(true);
    });

    it('fails for invalid JSON', () => {
      expect(validator.validate('{not valid json}', 'JSON').pass).toBe(false);
    });
  });

  describe('Code validation', () => {
    it('passes for TypeScript code', () => {
      expect(validator.validate('function hello() { return "world"; }', 'Code').pass).toBe(true);
    });

    it('passes for import statement', () => {
      expect(validator.validate('import React from "react";', 'Code').pass).toBe(true);
    });

    it('fails for plain natural language', () => {
      expect(validator.validate('The code should do the following things in order.', 'Code').pass).toBe(false);
    });
  });

  describe('PlainText validation', () => {
    it('always passes', () => {
      expect(validator.validate('anything goes here', 'PlainText').pass).toBe(true);
      expect(validator.validate('', 'PlainText').pass).toBe(true);
    });
  });

  describe('Markdown edge cases', () => {
    it('passes for JSON-like content that also has markdown list markers', () => {
      // Starts with { but has markdown structure elsewhere → not bare JSON
      const content = '{\n- item 1\n- item 2\n}';
      expect(validator.validate(content, 'Markdown').pass).toBe(true);
    });

    it('passes for XML-like content inside a code fence', () => {
      const content = '## Result\n```xml\n<root><item/></root>\n```';
      expect(validator.validate(content, 'Markdown').pass).toBe(true);
    });

    it('fails for bare array JSON', () => {
      expect(validator.validate('[1, 2, 3]', 'Markdown').pass).toBe(false);
    });
  });

  describe('Code edge cases', () => {
    it('passes for content in markdown code fence', () => {
      expect(validator.validate('```python\nprint("hello")\n```', 'Code').pass).toBe(true);
    });

    it('passes for class definition', () => {
      expect(validator.validate('class Foo extends Bar {}', 'Code').pass).toBe(true);
    });

    it('passes for Python function', () => {
      expect(validator.validate('def greet(name):\n  return f"Hello {name}"', 'Code').pass).toBe(true);
    });
  });

  describe('unknown format', () => {
    it('passes for unknown format (permissive default)', () => {
      // TypeScript: OutputFormat is typed but unknown values fall through to default
      expect(validator.validate('anything', 'CustomFormat' as never).pass).toBe(true);
    });
  });

  describe('Handover note extraction', () => {
    it('extracts note after Japanese separator', () => {
      const content = 'Main output here.\n--- 引き継ぎメモ ---\nNote for next agent.';
      const { mainContent, note } = validator.extractHandoverNote(content);
      expect(mainContent).toBe('Main output here.');
      expect(note).toBe('Note for next agent.');
    });

    it('extracts note after English separator', () => {
      const content = 'Main output here.\n--- Handover Note ---\nNote for next agent.';
      const { mainContent, note } = validator.extractHandoverNote(content);
      expect(mainContent).toBe('Main output here.');
      expect(note).toBe('Note for next agent.');
    });

    it('is case-insensitive for English separator', () => {
      const content = 'Output.\n--- handover note ---\nNote.';
      const { mainContent, note } = validator.extractHandoverNote(content);
      expect(mainContent).toBe('Output.');
      expect(note).toBe('Note.');
    });

    it('trims whitespace around separator keyword', () => {
      const content = 'Output.\n---  引き継ぎメモ  ---\nNote.';
      const { mainContent, note } = validator.extractHandoverNote(content);
      expect(mainContent).toBe('Output.');
      expect(note).toBe('Note.');
    });

    it('returns null note if no separator', () => {
      const content = 'Just content, no note.';
      const { mainContent, note } = validator.extractHandoverNote(content);
      expect(mainContent).toBe(content);
      expect(note).toBeNull();
    });

    it('returns null note if separator is present but note section is empty', () => {
      const content = 'Main output.\n--- Handover Note ---\n   ';
      const { note } = validator.extractHandoverNote(content);
      expect(note).toBeNull();
    });
  });
});
