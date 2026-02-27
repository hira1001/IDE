import { useEffect, useRef } from 'react';

/**
 * Automatically resizes a textarea to fit its content.
 * Returns a ref to attach to the textarea element.
 */
export function useAutoResize(value: string, minRows = 3): React.RefObject<HTMLTextAreaElement> {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Reset height so scrollHeight reflects actual content height
    el.style.height = 'auto';

    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 18;
    const paddingTop = parseFloat(getComputedStyle(el).paddingTop) || 6;
    const paddingBottom = parseFloat(getComputedStyle(el).paddingBottom) || 6;
    const minHeight = lineHeight * minRows + paddingTop + paddingBottom;

    el.style.height = `${Math.max(el.scrollHeight, minHeight)}px`;
  }, [value, minRows]);

  return ref;
}
