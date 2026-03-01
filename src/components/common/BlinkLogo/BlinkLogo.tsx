import type { FC } from 'react';

/**
 * Blink Logo SVG component.
 *
 * @returns Blink brand logo SVG element
 */
export const BlinkLogo: FC = () => {
  return (
    <svg role="img" className="blink-logo" aria-labelledby="m-Header-logoText" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">
      <title id="m-Header-logoText">Blink</title>
      {/* Eye / blink shape */}
      <ellipse cx="18" cy="18" rx="17" ry="10" fill="none" stroke="currentColor" strokeWidth="2.5"/>
      <circle cx="18" cy="18" r="5" />
      <line x1="18" y1="1" x2="18" y2="6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  );
};

export default BlinkLogo;
