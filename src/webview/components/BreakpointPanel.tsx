import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface BreakpointPanelProps {
  stepNumber: number;
  outputs: Record<string, string>;
  onContinue: (editedOutputs: Record<string, string>) => void;
  onAbort: () => void;
}

export function BreakpointPanel({ stepNumber, outputs, onContinue, onAbort }: BreakpointPanelProps) {
  const { t } = useTranslation();
  const [editedOutputs, setEditedOutputs] = useState<Record<string, string>>({ ...outputs });

  const handleChange = (key: string, value: string) => {
    setEditedOutputs((prev) => ({ ...prev, [key]: value }));
  };

  const outputCount = Object.keys(editedOutputs).length;

  return (
    <div className="panel-overlay">
      <div className="panel-card breakpoint-panel">
        {/* Header */}
        <div className="panel-card__header">
          <div className="panel-card__header-left">
            <div className="panel-card__icon panel-card__icon--amber">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="5.5" y="2" width="5" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 12v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <h2 className="panel-card__title">{t('breakpoint.title')}</h2>
              <p className="panel-card__subtitle">
                After step {stepNumber} · {outputCount} output{outputCount !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <div className="breakpoint-panel__badge">PAUSED</div>
        </div>

        <p className="breakpoint-panel__notice">{t('breakpoint.description')}</p>

        {/* Output editors */}
        <div className="breakpoint-panel__outputs">
          {Object.entries(editedOutputs).map(([key, value]) => (
            <div key={key} className="breakpoint-output">
              <div className="breakpoint-output__header">
                <span className="breakpoint-output__key">{key}</span>
                <span className="breakpoint-output__chars">{value.length.toLocaleString()} chars</span>
              </div>
              <textarea
                className="field-textarea field-textarea--output breakpoint-output__textarea"
                rows={8}
                value={value}
                onChange={(e) => handleChange(key, e.target.value)}
                spellCheck={false}
              />
            </div>
          ))}
        </div>

        {/* Footer actions */}
        <div className="panel-card__footer">
          <button className="btn btn--danger" onClick={onAbort}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor" />
            </svg>
            {t('breakpoint.stop')}
          </button>
          <button className="btn btn--primary" onClick={() => onContinue(editedOutputs)}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M3 2l8 4-8 4V2z" fill="currentColor" />
            </svg>
            {t('breakpoint.continue')}
          </button>
        </div>
      </div>
    </div>
  );
}
