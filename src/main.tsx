import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AvatarProvider } from './contexts/AvatarProvider';
import { DatasetProvider } from './contexts/DatasetProvider';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DatasetProvider forceDemo={import.meta.env.DEV ? true : undefined}><AvatarProvider><App /></AvatarProvider></DatasetProvider>
  </StrictMode>,
);
