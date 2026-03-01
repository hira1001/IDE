import React, { useState, useCallback } from 'react';

interface PlanPreviewProps {
    markdown: string;
    onClose: () => void;
    onCopy: (markdown: string) => void;
    onSendToAI: (markdown: string) => void;
    onSaveTemplate: (markdown: string) => void;
}

type ViewMode = 'preview' | 'edit';

/**
 * PlanPreview — displays a generated Markdown workflow plan with
 * preview/edit tabs and action buttons (Send to AI, Copy, Save Template).
 */
export function PlanPreview({
    markdown,
    onClose,
    onCopy,
    onSendToAI,
    onSaveTemplate,
}: PlanPreviewProps) {
    const [content, setContent] = useState(markdown);
    const [viewMode, setViewMode] = useState<ViewMode>('preview');
    const [copied, setCopied] = useState(false);
    const [sent, setSent] = useState(false);

    const handleCopy = useCallback(() => {
        onCopy(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [content, onCopy]);

    const handleSend = useCallback(() => {
        onSendToAI(content);
        setSent(true);
        setTimeout(() => setSent(false), 3000);
    }, [content, onSendToAI]);

    const handleSave = useCallback(() => {
        onSaveTemplate(content);
    }, [content, onSaveTemplate]);

    const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) onClose();
    };

    return (
        <div className="panel-overlay" onClick={handleOverlayClick}>
            <div className="plan-preview">
                {/* Header */}
                <div className="plan-preview__header">
                    <div className="plan-preview__header-left">
                        <div className="panel-card__icon panel-card__icon--green">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                                <path d="M3 2h10v12H3V2zm2 3h6M5 7h6M5 9h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                            </svg>
                        </div>
                        <h2 className="panel-card__title">ワークフロー計画書</h2>
                    </div>
                    <button className="panel-card__close" onClick={onClose} aria-label="Close">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                    </button>
                </div>

                {/* Tab bar */}
                <div className="plan-preview__tabs">
                    <button
                        className={`plan-preview__tab${viewMode === 'preview' ? ' plan-preview__tab--active' : ''}`}
                        onClick={() => setViewMode('preview')}
                    >
                        👁 プレビュー
                    </button>
                    <button
                        className={`plan-preview__tab${viewMode === 'edit' ? ' plan-preview__tab--active' : ''}`}
                        onClick={() => setViewMode('edit')}
                    >
                        ✏️ 編集
                    </button>
                </div>

                {/* Content */}
                <div className="plan-preview__content">
                    {viewMode === 'preview' ? (
                        <div className="plan-preview__markdown">
                            <pre className="plan-preview__pre">{content}</pre>
                        </div>
                    ) : (
                        <textarea
                            className="plan-preview__editor"
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            spellCheck={false}
                        />
                    )}
                </div>

                {/* Action buttons */}
                <div className="plan-preview__actions">
                    <button className="btn btn--ghost" onClick={onClose}>
                        閉じる
                    </button>
                    <div className="plan-preview__actions-right">
                        <button className="btn btn--ghost" onClick={handleSave} title="テンプレートとして保存">
                            💾 テンプレート保存
                        </button>
                        <button className="btn btn--ghost" onClick={handleCopy}>
                            {copied ? '✅ コピーしました' : '📋 コピー'}
                        </button>
                        <button className="btn btn--primary" onClick={handleSend}>
                            {sent ? '✅ 送信しました' : '✅ Send to AI'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
