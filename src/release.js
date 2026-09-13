export const YASREADY_AUDIOBOOKS_VERSION = '0.14.3.18.2';
export const BOOK_ONE_AUDIO_BIBLE_PREP_ENGINE_RELEASE = '0.11.8';

export function productionProvenance({
  artifact = 'yasready-audiobooks',
  prepEngineRelease = BOOK_ONE_AUDIO_BIBLE_PREP_ENGINE_RELEASE,
  supermanEngineRelease = null,
  sourceHash = null
} = {}) {
  return Object.freeze({
    application: 'YasReady Audiobooks',
    applicationRelease: YASREADY_AUDIOBOOKS_VERSION,
    artifact,
    artifactRelease: YASREADY_AUDIOBOOKS_VERSION,
    prepEngineRelease,
    supermanEngineRelease,
    sourceHash
  });
}
