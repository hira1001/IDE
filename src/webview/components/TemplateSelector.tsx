import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WorkflowTemplate } from '../../types/index.js';
import { useVSCode } from '../hooks/useVSCode.js';

interface TemplateSelectorProps {
  templates: WorkflowTemplate[];
  onSelect: (template: WorkflowTemplate) => void;
  onClose: () => void;
}

export function TemplateSelector({ templates, onSelect, onClose }: TemplateSelectorProps) {
  const { postMessage } = useVSCode();
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const filtered = templates.filter(
    (tpl) =>
      tpl.name.toLowerCase().includes(filter.toLowerCase()) ||
      tpl.description.toLowerCase().includes(filter.toLowerCase()) ||
      tpl.tags.some((tag) => tag.toLowerCase().includes(filter.toLowerCase()))
  );

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="panel-overlay" onClick={handleOverlayClick}>
      <div className="panel-card template-selector">
        {/* Header */}
        <div className="panel-card__header">
          <div className="panel-card__header-left">
            <div className="panel-card__icon panel-card__icon--green">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M2 3.5C2 2.67 2.67 2 3.5 2h3l2 2H13c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5h-9.5C2.67 14 2 13.33 2 12.5v-9z" stroke="currentColor" strokeWidth="1.4"/>
              </svg>
            </div>
            <div>
              <h2 className="panel-card__title">{t('app.loadTemplate')}</h2>
              <p className="panel-card__subtitle">{templates.length} template{templates.length !== 1 ? 's' : ''} available</p>
            </div>
          </div>
          <button className="panel-card__close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="template-selector__search">
          <div className="template-selector__search-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M9.5 9.5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </div>
          <input
            className="field-input template-selector__search-input"
            placeholder={t('template.searchPlaceholder') || 'Search templates…'}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
          />
          {filter && (
            <button className="template-selector__search-clear" onClick={() => setFilter('')} aria-label="Clear">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>

        {/* List */}
        <div className="template-list">
          {filtered.length === 0 ? (
            <div className="template-list__empty">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.5" opacity="0.3"/>
                <path d="M11 13h10M11 17h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
              </svg>
              <span>{t('template.noTemplates')}</span>
            </div>
          ) : (
            filtered.map((tpl) => (
              <div
                key={tpl.template_id}
                className={`template-item${hoveredId === tpl.template_id ? ' template-item--hovered' : ''}`}
                onMouseEnter={() => setHoveredId(tpl.template_id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <div className="template-item__body">
                  <div className="template-item__name">{tpl.name}</div>
                  {tpl.description && (
                    <div className="template-item__desc">{tpl.description}</div>
                  )}
                  <div className="template-item__meta">
                    <span className="template-item__stat">
                      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                        <circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" strokeWidth="1.2"/>
                        <circle cx="5.5" cy="4" r="1.5" fill="currentColor"/>
                        <path d="M2.5 8c0-1.66 1.34-3 3-3s3 1.34 3 3" stroke="currentColor" strokeWidth="1.2"/>
                      </svg>
                      {tpl.config.agents.length} agent{tpl.config.agents.length !== 1 ? 's' : ''}
                    </span>
                    <span className="template-item__stat">
                      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                        <rect x="1.5" y="1.5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                        <path d="M1.5 4.5h8" stroke="currentColor" strokeWidth="1.2"/>
                      </svg>
                      {tpl.config.workflow.length} step{tpl.config.workflow.length !== 1 ? 's' : ''}
                    </span>
                    {tpl.tags.length > 0 && (
                      <div className="template-item__tags">
                        {tpl.tags.slice(0, 4).map((tag) => (
                          <span key={tag} className="template-tag">{tag}</span>
                        ))}
                        {tpl.tags.length > 4 && (
                          <span className="template-tag template-tag--more">+{tpl.tags.length - 4}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => postMessage({ type: 'template:export', payload: { template_id: tpl.template_id } })}
                  title="Export template as JSON"
                  aria-label="Export template"
                >
                  ↓
                </button>
                <button
                  className="btn btn--ghost btn--sm btn--danger-hover"
                  onClick={() => postMessage({ type: 'template:delete', payload: { template_id: tpl.template_id, name: tpl.name } })}
                  title={t('template.delete')}
                  aria-label={`${t('template.delete')} ${tpl.name}`}
                >
                  🗑
                </button>
                <button className="btn btn--primary btn--sm template-item__load" onClick={() => onSelect(tpl)}>
                  {t('template.load')}
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="panel-card__footer" style={{ justifyContent: 'space-between' }}>
          <button
            className="btn btn--secondary btn--sm"
            onClick={() => postMessage({ type: 'template:import' })}
            title="Import template from JSON file"
          >
            ↑ Import
          </button>
          <button className="btn btn--ghost" onClick={onClose}>{t('template.cancel')}</button>
        </div>
      </div>
    </div>
  );
}
