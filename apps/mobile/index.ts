import { registerRootComponent } from 'expo';

import App from './App';
import { deriveLedgerKeyAsync } from './modules/context-ledger-crypto';
import { configureNativeLedgerKeyDeriver } from './src/sync/codec';

configureNativeLedgerKeyDeriver(deriveLedgerKeyAsync);

registerRootComponent(App);
