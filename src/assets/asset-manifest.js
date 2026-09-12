import { randomUUID } from 'node:crypto';

export const AudioAssetKinds = Object.freeze(['take', 'chapter_master', 'book_master', 'sample', 'waveform', 'alignment']);

export function createAudioAsset({
  projectId,
  kind,
  storageLocator,
  contentHash,
  mediaType,
  durationMs = null,
  bytes = null,
  sourceGenerationRequestId = null
}, { clock = () => new Date() } = {}) {
  if (!projectId) throw new Error('audio asset requires projectId');
  if (!AudioAssetKinds.includes(kind)) throw new Error(`unsupported audio asset kind: ${kind}`);
  if (!storageLocator) throw new Error('audio asset requires storageLocator');
  if (!contentHash) throw new Error('audio asset requires contentHash');
  if (!mediaType) throw new Error('audio asset requires mediaType');

  return Object.freeze({
    id: randomUUID(),
    type: 'audio_asset',
    projectId,
    kind,
    storageLocator,
    contentHash,
    mediaType,
    durationMs,
    bytes,
    sourceGenerationRequestId,
    createdAt: clock().toISOString()
  });
}
