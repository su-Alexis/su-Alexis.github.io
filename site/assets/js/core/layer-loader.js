// Fixed loader for the optional layers (doctrine section 6; Skeleton "Layer 2 guest engine").
// Used by ui/terminal-ui.js when "vm start" asks for the workstation layer.
//
// Layer ids are checked against LAYER_IDS and an own-property lookup before anything
// loads; module and stylesheet paths are literals here, never built from input or storage.
// Loads are deduplicated: asking twice while a load is in flight returns the same promise.
// A failed load forgets itself so a later attempt can retry. Only layers that exist are
// mapped (Layer 1 is the page itself; Layer 3 is not built).

import { knownId } from '../utils/validate.js';
import { LAYER_IDS } from './constants.js';

const layerLoaders = Object.freeze({
  workstation: () => import('../layers/layer2.js'),
});

// Each layer's stylesheet, resolved from this file's own URL (same origin, fixed path).
const layerStyles = Object.freeze({
  workstation: new URL('../../css/layer2.css', import.meta.url).href,
});

const inFlight = new Map();

function loadStyle(id) {
  if (!Object.hasOwn(layerStyles, id)) return Promise.resolve();
  const href = layerStyles[id];
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((link) => link.href === href)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => {
      link.remove();
      reject(new Error('layer stylesheet failed to load'));
    }, { once: true });
    document.head.appendChild(link);
  });
}

// Resolves with the layer's module, or rejects (unknown id, or a failed load).
export function loadLayer(id) {
  if (!knownId(id, LAYER_IDS).ok || !Object.hasOwn(layerLoaders, id)) return Promise.reject(new Error('unknown layer'));
  if (inFlight.has(id)) return inFlight.get(id);
  const job = Promise.all([layerLoaders[id](), loadStyle(id)])
    .then(([module]) => module)
    .catch((error) => {
      inFlight.delete(id);
      throw error;
    });
  inFlight.set(id, job);
  return job;
}
