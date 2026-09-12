export class AudioProvider {
  constructor(name) {
    if (!name) throw new Error('AudioProvider requires a name');
    this.name = name;
  }

  async healthCheck() { throw new Error('healthCheck not implemented'); }
  async searchVoices() { throw new Error('searchVoices not implemented'); }
  async estimateCost() { throw new Error('estimateCost not implemented'); }
  async render() { throw new Error('render not implemented'); }
  async align() { throw new Error('align not implemented'); }
  async transcribe() { throw new Error('transcribe not implemented'); }
}

export function assertAudioProvider(provider) {
  const required = ['healthCheck', 'searchVoices', 'estimateCost', 'render', 'align', 'transcribe'];
  for (const method of required) {
    if (typeof provider?.[method] !== 'function') throw new Error(`provider missing ${method}()`);
  }
  return provider;
}
