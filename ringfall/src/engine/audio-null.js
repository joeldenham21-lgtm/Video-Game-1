// Silent stand-in used only when src/audio.js is absent (keeps the build and tests working).
const noop = () => {};
const handle = { setVolume: noop, setPitch: noop, setPos: noop, stop: noop };
export const audio = {
  init: noop, unlock: noop, get ready() { return false; }, suspend: noop, resume: noop,
  setVolumes: noop, setListener: noop, play: noop, loop: () => handle,
  music: { play: noop, stop: noop, setIntensity: noop, setOverdrive: noop, setLowHealth: noop, stinger: noop, get bpm() { return 120; }, get beatTime() { return 0; } },
};
export default audio;
