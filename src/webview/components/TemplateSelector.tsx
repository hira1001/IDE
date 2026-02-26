import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WorkflowTemplate } from '../../types/index.js';

interface TemplateSelectorProps {
  templates: WorkflowTemplate[];
  onSelect: (template: WorkflowTemplate) => void;
  onClose: () => void;
}

export function TemplateSelector({ templates, onSelect, onClose }: TemplateSelectorProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');

  const filtered = templates.filter(
    (tpl) =>
      tpl.name.toLowerCase().includes(filter.toLowerCase()) ||
      tpl.description.toLowerCase().includes(filter.toLowerCase()) ||
      tpl.tags.some((tag) => tag.toLowerCase().includes(filter.toLowerCase()))
  );

  return (
    <div className="panel-overlay">
      <div className="template-selector">
        <h2>📂 {t('app.loadTemplate')}</h2>

        <input
          className="field-input"
          placeholder="Search templates..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />

        {filtered.length === 0 ? (
          <p className="template-selector__empty">{t('template.noTemplates')}</p>
        ) : (
          <div className="template-selector__list">
            {filtered.map((tpl) => (
              <div key={tpl.template_id} className="template-selector__item">
                <div className="template-selector__item-name">{tpl.name}</div>
                <div className="template-selector__item-desc">{tpl.description}</div>
                <div className="template-selector__item-tags">
                  {tpl.tags.map((tag) => (
                    <span key={tag} className="template-selector__tag">{tag}</span>
                  ))}
                </div>
                <div className="template-selector__item-meta">
                  {tpl.config.agents.length} agents · {tpl.config.workflow.length} steps
                </div>
                <button className="btn btn--primary btn--sm" onClick={() => onSelect(tpl)}>
                  {t('template.load')}
                </button>
              </div>
            ))}
          </div>
        )}

        <button className="btn btn--secondary" onClick={onClose}>{t('template.cancel')}</button>
      </div>
    </div>
  );
}
