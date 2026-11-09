import {MARCH_CYCLES_PER_SECOND} from './march.mjs';

// Legacy order-move and army-stop accents, placed on the shared quarter-step.
export const SIGNAL_STEP_CYCLES = .125;
export const SIGNAL_TAIL_SECONDS = .65;
export const DRUM_SIGNALS = Object.freeze({
  start: Object.freeze([
    Object.freeze({step:0,accent:1,pitch:0}),
    Object.freeze({step:2,accent:.76,pitch:2}),
    Object.freeze({step:3,accent:.68,pitch:3}),
    Object.freeze({step:4,accent:.92,pitch:0}),
  ]),
  stop: Object.freeze([
    Object.freeze({step:0,accent:1,pitch:2}),
    Object.freeze({step:1,accent:.7,pitch:2}),
    Object.freeze({step:3,accent:1.08,pitch:-2}),
  ]),
});
export function signalDurationCycles(key) {
  const pattern=DRUM_SIGNALS[key];
  return pattern ? pattern.at(-1).step*SIGNAL_STEP_CYCLES+SIGNAL_TAIL_SECONDS*MARCH_CYCLES_PER_SECOND : 0;
}
