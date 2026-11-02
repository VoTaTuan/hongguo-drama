import React, { useState } from 'react';
import { useTranslatedText } from '../services/translator';
import './TranslatedText.css';

/**
 * Component hiển thị tiêu đề phim với bản dịch tiếng Việt và chú thích bản gốc
 */
export function DramaTitle({ title, children, className = '', showOriginal = true, as: Component = 'div', ...props }) {
  const textContent = title || (typeof children === 'string' ? children : '');
  const { translated, original, isTranslated } = useTranslatedText(textContent);

  return (
    <Component className={`drama-title-wrap ${className}`} title={isTranslated ? `Tên gốc: ${original}` : undefined} {...props}>
      <span className="drama-title-main">{translated || textContent}</span>
      {showOriginal && isTranslated && (
        <span className="drama-title-sub" title={original}>
          {original}
        </span>
      )}
    </Component>
  );
}

/**
 * Component hiển thị mô tả tóm tắt nội dung với tùy chọn chuyển đổi bản dịch / bản gốc
 */
export function DramaDescription({ description, children, className = '' }) {
  const textContent = description || (typeof children === 'string' ? children : '');
  const { translated, original, isTranslated } = useTranslatedText(textContent);
  const [viewOriginal, setViewOriginal] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!textContent || !textContent.trim()) return null;

  const currentText = viewOriginal || !isTranslated ? original : translated;

  const handleCopy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(currentText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };

  return (
    <div className={`drama-desc-wrap ${className}`}>
      <div className="drama-desc-content">
        {currentText}
      </div>
      <div className="drama-desc-actions">
        {isTranslated && (
          <button
            type="button"
            className="drama-desc-toggle"
            onClick={() => setViewOriginal(!viewOriginal)}
            title={viewOriginal ? 'Xem bản dịch tiếng Việt' : 'Xem văn bản gốc tiếng Trung'}
          >
            {viewOriginal ? 'Xem tiếng Việt' : 'Xem gốc'}
          </button>
        )}
        <button
          type="button"
          className="drama-desc-toggle"
          onClick={handleCopy}
          title="Sao chép nội dung tóm tắt này"
        >
          {copied ? 'Đã sao chép! ✓' : 'Sao chép mô tả'}
        </button>
      </div>
    </div>
  );
}
