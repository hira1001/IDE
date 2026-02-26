import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WorkflowConfig } from '../../types/index.js';
import { useVSCode } from '../hooks/useVSCode.js';

interface TemplateSaveDialogProps {
  config: WorkflowConfig;
  onClose: () => void;
}

export function TemplateSaveDialog({ config, onClose }: TemplateSaveDialogProps) {
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
    onClose();
  };

  return (
    <div className="panel-overlay">
      <div className="template-dialog">
        <h2>💾 {t('template.title')}</h2>

        <label className="field-label">{t('template.name')} *</label>
        <input
          className="field-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Workflow Template"
        />

        <label className="field-label">{t('template.description')}</label>
        <textarea
          className="field-textarea"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <label className="field-label">{t('template.tags')}</label>
        <input
          className="field-input"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="review, parallel, 3-agents"
        />

        <label className="field-label">{t('template.scope')}</label>
        <div className="field-radio-group">
          <label>
            <input
              type="radio"
              value="workspace"
              checked={location === 'workspace'}
              onChange={() => setLocation('workspace')}
            />
            {' '}{t('template.workspace')}
          </label>
          <label>
            <input
              type="radio"
              value="global"
              checked={location === 'global'}
              onChange={() => setLocation('global')}
            />
            {' '}{t('template.global')}
          </label>
        </div>

        <div className="template-dialog__actions">
          <button className="btn btn--secondary" onClick={onClose}>{t('template.cancel')}</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={!name.trim()}>
            {t('template.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
