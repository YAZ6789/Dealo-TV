import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/orbitron/500.css';
import '@fontsource/orbitron/700.css';
import '@fontsource/orbitron/900.css';
import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import './styles/base.css';
import './styles/components.css';
import './styles/pages.css';
import './styles/designs.css';
import './styles/transitions.css';
import './styles/themes/hud.css';
import './styles/themes/neon.css';
import './styles/themes/aurora.css';
import './styles/themes/terminal.css';
import { applyInitialTheme } from './theme/switch';
import App from './App';

applyInitialTheme();

// Debug/automation hook: `__dealoDemo()` in the console loads the sample library.
(window as unknown as { __dealoDemo: () => Promise<void> }).__dealoDemo = async () => {
  const [{ buildDemoDoc }, { useLibrary }, { useSettings }] = await Promise.all([import('./lib/demo'), import('./store/library'), import('./store/settings')]);
  useLibrary.getState().replaceDoc(buildDemoDoc());
  useSettings.getState().setOnboarded(true);
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
