// Node loader shim: resolves the bare 'three' specifier to the vendored module so
// the ES modules under range/src can be unit-tested outside the browser.
import { register } from 'node:module';
register('./hooks.mjs', import.meta.url);
