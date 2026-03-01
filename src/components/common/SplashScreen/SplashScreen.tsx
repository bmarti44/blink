import type { FC, ReactNode } from 'react';
import { useState, useEffect } from 'react';
import './SplashScreen.css';
import { BlinkLogo } from '../BlinkLogo/BlinkLogo';
import { LoadingSpinner } from '../LoadingSpinner/LoadingSpinner';

/**
 * Props for the SplashScreen component
 */
interface SplashScreenProps {
  /** Callback fired when the splash screen animation completes after loading finishes */
  onDismissComplete?: () => void;
  /** Custom app name to display */
  appName?: string;
  /** Custom tagline to display */
  tagline?: string;
  /** Loading message to display */
  loadingMessage?: string;
  /** Whether to show the animated loading spinner */
  showSpinner?: boolean;
  /** Custom logo component (overrides default Blink logo) */
  customLogo?: ReactNode;
  /** Minimum display time in milliseconds before auto-dismiss */
  minDisplayTime?: number;
}

/**
 * Animated splash screen with Blink dark theme for Blink.
 *
 * @param root0 - Props object
 * @param root0.onDismissComplete - Callback fired after the exit animation completes
 * @param root0.appName - Application name to display
 * @param root0.tagline - Tagline to display beneath the application name
 * @param root0.loadingMessage - Message shown during loading
 * @param root0.showSpinner - Whether to render the animated spinner
 * @param root0.customLogo - Optional custom logo component
 * @param root0.minDisplayTime - Minimum time to display splash screen
 * @returns The rendered splash screen overlay, or null after it dismisses
 */
export const SplashScreen: FC<SplashScreenProps> = ({
  onDismissComplete,
  appName = 'Blink',
  tagline = 'AI-powered document editing',
  loadingMessage = 'Initializing...',
  showSpinner = true,
  customLogo,
  minDisplayTime = 1500,
}) => {
  const [shouldRender, setShouldRender] = useState(true);
  const [visible, setVisible] = useState(true);
  const [progress, setProgress] = useState(0);
  const [currentMessage, setCurrentMessage] = useState<string>(loadingMessage);

  useEffect(() => {
    const body = document.querySelector('body');

    const initializeApp = async () => {
      if (body) {
        body.classList.add('nav-collapsed');
      }

      // Simulate loading stages
      setCurrentMessage('Loading application...');
      setProgress(25);

      await new Promise((resolve) => setTimeout(resolve, minDisplayTime * 0.3));

      setCurrentMessage('Preparing workspace...');
      setProgress(50);

      await new Promise((resolve) => setTimeout(resolve, minDisplayTime * 0.3));

      setCurrentMessage('Almost ready...');
      setProgress(75);

      await new Promise((resolve) => setTimeout(resolve, minDisplayTime * 0.2));

      setCurrentMessage('Ready!');
      setProgress(100);

      await new Promise((resolve) => setTimeout(resolve, minDisplayTime * 0.2));

      // Cleanup and dismiss
      if (body) {
        body.classList.remove('nav-collapsed');
      }

      setVisible(false);

      // Wait for fade animation to complete
      setTimeout(() => {
        setShouldRender(false);
        onDismissComplete?.();
      }, 300);
    };

    initializeApp();
  }, [minDisplayTime, onDismissComplete]);

  if (!shouldRender) {
    return null;
  }

  // Map progress to nearest 5% bucket for CSS width classes
  const widthBucket = Math.max(0, Math.min(100, Math.round(progress / 5) * 5));
  const progressWidthClass = `w-${widthBucket}`;

  return (
    <div className={`splash-overlay${visible ? '' : ' is-hidden'}`}>
      {/* Background Gradient */}
      <div className="splash-gradient" />

      <div className="splash-content">
        {/* Logo and Title Section */}
        <div className="splash-header">
          {/* Logo */}
          <div className="splash-logo">{customLogo || <BlinkLogo />}</div>

          {/* Vertical Divider */}
          <div className="splash-divider" />

          {/* App Name and Tagline */}
          <div className="splash-text">
            <h1 className="splash-title">{appName}</h1>
            <p className="splash-tagline">{tagline}</p>
          </div>
        </div>

        {/* Loading Section */}
        <div className="splash-loading">
          {/* Spinner */}
          {showSpinner && <LoadingSpinner />}

          {/* Progress Bar */}
          <div className="splash-progress">
            <div className={`splash-progress-value ${progressWidthClass}`} />
          </div>

          {/* Loading Message */}
          <p className="loading-message">{currentMessage}</p>
        </div>
      </div>
    </div>
  );
};

export default SplashScreen;
