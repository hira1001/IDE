import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WorkflowConfig } from '../../types/index.js';
import { useVSCode } from '../hooks/useVSCode.js';

interface TemplateSaveDialogProps {
  config: WorkflowConfig;
  onClose: () => void;
  onSaved?: () => void;
}

export function TemplateSaveDialog({ config, onClose, onSaved }: TemplateSaveDialogProps) {
  const { t } = useTranslation();
  const { postMessage } = useVSCode();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [location, setLocation] = useState<'workspace' | 'global'>('workspace');

  const handleSave = () => {
    if (!name.trim()) return;
    postMessage({
      type: 'template:save',
      payload: {
        name: name.trim(),
        description: description.trim(),
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        config,
        location,
      },
    });
    onSaved ? onSaved() : onClose();
  };

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="panel-overlay" onClick={handleOverlayClick}>
      <div className="panel-card save-dialog">
        {/* Header */}
        <div className="panel-card__header">
          <div className="panel-card__header-left">
            <div className="panel-card__icon panel-card__icon--purple">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M3 3h8l2 2v8H3V3zm3 7V7m-1.5 1.5L6 10l1.5-1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                <rect x="5" y="3" width="4" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.2"/>
              </svg>
            </div>
            <h2 className="panel-card__title">{t('template.title')}</h2>
          </div>
          <button className="panel-card__close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Form */}
        <div className="save-form">
          <div className="save-form__field">
            <label className="field-label">
              {t('template.name')}
              <span className="field-label__required">*</span>
            </label>
            <input
              className="field-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Workflow Template"
              autoFocus
            />
          </div>

          <div className="save-form__field">
            <label className="field-label">{t('template.description')}</label>
            <textarea
              className="field-textarea"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('template.descriptionPlaceholder') || 'What does this workflow do?'}
            />
          </div>

          <div className="save-form__field">
            <label className="field-label">{t('template.tags')}</label>
            <input
              className="field-input"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="review, parallel, 3-agents"
            />
            <span className="field-hint">Comma-separated</span>
          </div>

          <div className="save-form__field">
            <label className="field-label">{t('template.scope')}</label>
            <div className="radio-group">
              <label className={`radio-opt${location === 'workspace' ? ' radio-opt--selected' : ''}`}>
                <input
                  type="radio"
                  value="workspace"
                  checked={location === 'workspace'}
                  onChange={() => setLocation('workspace')}
                  className="radio-opt__input"
                />
                <span className="radio-opt__circle" />
                <span className="radio-opt__body">
                  <span className="radio-opt__label">{t('template.workspace')}</span>
                  <span className="radio-opt__desc">.vscode/aao-templates/</span>
                </span>
              </label>
              <label className={`radio-opt${location === 'global' ? ' radio-opt--selected' : ''}`}>
                <input
                  type="radio"
                  value="global"
                  checked={location === 'global'}
                  onChange={() => setLocation('global')}
                  className="radio-opt__input"
                />
                <span className="radio-opt__circle" />
                <span className="radio-opt__body">
                  <span className="radio-opt__label">{t('template.global')}</span>
                  <span className="radio-opt__desc">~/.aao-templates/</span>
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="panel-card__footer">
          <button className="btn btn--ghost" onClick={onClose}>{t('template.cancel')}</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={!name.trim()}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
              <path d="M2 2h7l2 2v7H2V2zm2 5l2 2 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {t('template.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
