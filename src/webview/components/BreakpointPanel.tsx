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

  return (
    <div className="panel-overlay">
      <div className="breakpoint-panel">
        <h2>⏸ {t('breakpoint.title')}</h2>
        <p className="breakpoint-panel__desc">{t('breakpoint.description')}</p>

        {Object.entries(editedOutputs).map(([key, value]) => (
          <div key={key} className="breakpoint-panel__output">
            <label className="field-label">📄 {key}</label>
            <textarea
              className="field-textarea field-textarea--output"
              rows={10}
              value={value}
              onChange={(e) => handleChange(key, e.target.value)}
            />
          </div>
        ))}

        <div className="breakpoint-panel__actions">
          <button className="btn btn--danger" onClick={onAbort}>
            ⏹ {t('breakpoint.stop')}
          </button>
          <button className="btn btn--primary" onClick={() => onContinue(editedOutputs)}>
            ▶ {t('breakpoint.continue')}
          </button>
        </div>
      </div>
    </div>
  );
}
