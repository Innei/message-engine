import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { createDevtoolsFixture } from './devtools-fixture.js';
import { DevtoolsStudio } from './devtools/DevtoolsStudio.js';
import './styles.css';

const root = document.querySelector('#root');
if (!root) throw new Error('Devtools preview root is unavailable');

const recorder = createDevtoolsFixture();

createRoot(root).render(
  <StrictMode>
    <DevtoolsStudio source={recorder} />
  </StrictMode>,
);
