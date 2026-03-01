import React, { useState } from 'react';
import { VSCodeWorkbench } from './vscode/VSCodeWorkbench';
import { SplashScreen } from './common/SplashScreen';

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  return (
    <>
      {showSplash && (
        <SplashScreen
          appName="Blink"
          tagline="AI-powered document editing"
          onDismissComplete={() => setShowSplash(false)}
        />
      )}
      <VSCodeWorkbench />
    </>
  );
}
