import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { MessageEngineDevtools } from '../../src/devtools-react.js';
import { createDevtoolsFixture } from './devtools-fixture.js';

const root = document.querySelector('#root');
if (!root) throw new Error('Devtools preview root is unavailable');

const recorder = createDevtoolsFixture();

createRoot(root).render(
  <StrictMode>
    <MessageEngineDevtools
      cachePolicy={{ minimumCacheTokens: 1024 }}
      source={recorder}
      theme="dark"
    />
  </StrictMode>,
);
