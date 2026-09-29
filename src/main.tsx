import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AvatarProvider } from './contexts/AvatarProvider';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AvatarProvider><App /></AvatarProvider>
  </StrictMode>,
);
