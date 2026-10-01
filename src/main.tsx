import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AvatarProvider } from './contexts/AvatarProvider';
import { DatasetProvider } from './contexts/DatasetProvider';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DatasetProvider><AvatarProvider><App /></AvatarProvider></DatasetProvider>
  </StrictMode>,
);
