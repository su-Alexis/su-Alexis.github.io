// Layer 2: every mission, in the order the lab offers them (Skeleton: data/missions/, one
// data file per mission). features/mission-engine.js reads only this list.
//
// Red 1 and Red 2 are owner-written (Alexis, October 11, 2026); their shape is described
// at the top of features/mission-engine.js. Blue 1 (blue-1.js, October 11, 2026) follows
// them on ubuntu-blue and reads their trail through web01's shared scenario state.

import { WS01_BASELINE } from './ws01-baseline.js';
import { RED_1 } from './red-1.js';
import { RED_2 } from './red-2.js';
import { BLUE_1 } from './blue-1.js';

export const MISSIONS = Object.freeze([WS01_BASELINE, RED_1, RED_2, BLUE_1]);
