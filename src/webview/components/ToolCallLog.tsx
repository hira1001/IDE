import React, { useRef, useEffect } from 'react';

export interface ToolEvent {
  event_type: 'tool_call' | 'tool_result' | 'iteration' | string;
  tool_name?: string;
  content?: string;
  iteration?: number;
}

interface ToolCallLogProps {
  events: ToolEvent[];
}

const TOOL_ICONS: Record<string, string> = {
  read_file: '📄',
  write_file: '✏️',
  edit_file: '✏️',
  list_files: '📁',
  search_code: '🔍',
  get_diagnostics: '🩺',
  get_definition: '🔗',
  find_references: '🔗',
  run_terminal: '💻',
};

export function ToolCallLog({ events }: ToolCallLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  if (events.length === 0) return null;

  return (
    <div className="tool-call-log">
      <div className="tool-call-log__header">🔧 Agent Loop</div>
      <div className="tool-call-log__body">
        {events.map((ev, i) => {
          if (ev.event_type === 'iteration') {
            return (
              <div key={i} className="tool-call-log__iteration">
                ── Iteration {ev.iteration} ──
              </div>
            );
          }
          const isCall = ev.event_type === 'tool_call';
          const icon = TOOL_ICONS[ev.tool_name ?? ''] ?? (isCall ? '⚙️' : '↩️');
          return (
            <div key={i} className={`tool-call-log__entry tool-call-log__entry--${isCall ? 'call' : 'result'}`}>
              <span className="tool-call-log__icon">{icon}</span>
              <span className="tool-call-log__name">{ev.tool_name}</span>
              {ev.content && (
                <span className="tool-call-log__content" title={ev.content}>
                  {ev.content.slice(0, 80)}{ev.content.length > 80 ? '…' : ''}
                </span>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
