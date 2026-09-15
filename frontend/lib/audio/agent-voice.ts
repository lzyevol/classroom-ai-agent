import { TTS_PROVIDERS } from './constants';
import type { TTSProviderId } from './types';

type BrowserVoice = Pick<SpeechSynthesisVoice, 'name' | 'voiceURI' | 'lang' | 'localService'>;

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function matchesVoiceId(voice: BrowserVoice, selectedVoice: string): boolean {
  return (
    voice.voiceURI === selectedVoice ||
    voice.name === selectedVoice ||
    voice.lang === selectedVoice
  );
}

function getAgentSlot(agentId: string): number | null {
  const defaultAgentMatch = /^default-(\d+)$/.exec(agentId);
  if (!defaultAgentMatch) return null;
  return Math.max(0, Number(defaultAgentMatch[1]) - 1);
}

/**
 * Resolve a stable discussion voice for an agent without changing the user's
 * main voice setting. The default teacher keeps the configured voice;
 * subsequent default agents receive different voices whenever available.
 */
export function resolveAgentVoice(
  providerId: TTSProviderId,
  selectedVoice: string,
  agentId: string,
  browserVoices: readonly BrowserVoice[] = [],
): string {
  if (providerId === 'browser-native-tts') {
    const selected = browserVoices.find((voice) => matchesVoiceId(voice, selectedVoice));
    const chineseVoices = browserVoices.filter((voice) =>
      voice.lang.toLowerCase().startsWith('zh'),
    );
    const voices = chineseVoices.length > 0 ? chineseVoices : browserVoices;
    if (voices.length === 0) return selectedVoice;

    const ordered = [
      ...(selected ? [selected] : []),
      ...voices.filter((voice) => !selected || voice.voiceURI !== selected.voiceURI),
    ];
    const slot = getAgentSlot(agentId);
    const index = slot ?? stableHash(agentId);
    const voice = ordered[index % ordered.length];
    return voice.voiceURI || voice.name;
  }

  const configuredVoices = TTS_PROVIDERS[providerId]?.voices ?? [];
  if (configuredVoices.length === 0) return selectedVoice;

  // Prefer Chinese voices so a Chinese classroom does not accidentally switch
  // to an English-only voice just to create variety.
  const chineseVoices = configuredVoices.filter((voice) =>
    voice.language.toLowerCase().startsWith('zh'),
  );
  const voices = chineseVoices.length > 0 ? chineseVoices : configuredVoices;
  const selected = configuredVoices.find((voice) => voice.id === selectedVoice);
  const ordered = [
    ...(selected ? [selected] : []),
    ...voices.filter((voice) => voice.id !== selected?.id),
  ];
  const slot = getAgentSlot(agentId);
  const index = slot ?? stableHash(agentId);
  return ordered[index % ordered.length]?.id ?? selectedVoice;
}
