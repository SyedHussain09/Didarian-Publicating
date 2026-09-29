import { useEffect, useRef } from 'react';

export function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const query = window.matchMedia(
      '(pointer: fine) and (hover: hover) and (prefers-reduced-motion: no-preference)',
    );
    let frame = 0;
    let pointer = { x: 0, y: 0 };
    const disable = () => {
      cancelAnimationFrame(frame);
      document.body.classList.remove('custom-cursor-active');
      if (dot.current) dot.current.hidden = true;
      if (ring.current) ring.current.hidden = true;
    };
    const move = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        !query.matches ||
        !target ||
        document.querySelector('dialog:modal') ||
        target.closest('input,textarea,select,label,[contenteditable],.native-cursor')
      ) {
        disable();
        return;
      }
      pointer = { x: event.clientX, y: event.clientY };
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!dot.current || !ring.current) return;
        for (const element of [dot.current, ring.current]) {
          element.style.left = `${pointer.x}px`;
          element.style.top = `${pointer.y}px`;
          element.hidden = false;
        }
        document.body.classList.add('custom-cursor-active');
        ring.current.classList.toggle('cursor-hover', !!target.closest('a,button'));
      });
    };
    window.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerleave', disable);
    window.addEventListener('blur', disable);
    query.addEventListener('change', disable);
    return () => {
      cancelAnimationFrame(frame);
      disable();
      window.removeEventListener('pointermove', move);
      document.removeEventListener('pointerleave', disable);
      window.removeEventListener('blur', disable);
      query.removeEventListener('change', disable);
    };
  }, []);
  return (
    <>
      <div ref={dot} hidden className="cursor-dot" aria-hidden="true" />
      <div ref={ring} hidden className="cursor-outline" aria-hidden="true" />
    </>
  );
}
