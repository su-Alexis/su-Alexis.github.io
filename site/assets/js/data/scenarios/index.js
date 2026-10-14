// Layer 2: every machine with shared scenario state (features/scenario.js reads only this
// list). One data file per machine, beside data/missions/.

import { WEB01 } from './web01.js';

export const SCENARIOS = Object.freeze([WEB01]);
