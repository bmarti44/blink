import type { FC } from 'react';
import './LoadingSpinner.css';

/**
 * Animated loading spinner with Blink branding.
 *
 * @returns Loading spinner SVG element
 */
export const LoadingSpinner: FC = () => {
  return (
    <div className="splash-spinner">
      <svg className="splash-spinner-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="31.4 31.4"
          opacity="0.25"
        />
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="31.4 31.4"
          strokeDashoffset="62.8"
        />
      </svg>
    </div>
  );
};

export default LoadingSpinner;
