/**
 * Audio Player - Audio player interface
 *
 * Handles audio playback, pause, stop, and other operations
 * Loads pre-generated TTS audio files from IndexedDB
 *
 */

import { db } from '@/lib/utils/database';
import { createLogger } from '@/lib/logger';
import { useSettingsStore } from '@/lib/store/settings';
import { resolveAgentVoice } from '@/lib/audio/agent-voice';

const log = createLogger('AudioPlayer');

export interface BrowserSpeechOptions {
  voice?: string;
  lang?: string;
  rate?: number;
  browserOnly?: boolean;
}

export interface RuntimeSpeechOptions {
  /** Optional discussion speaker. The voice is resolved per provider. */
  agentId?: string;
  /** Explicit voice override; takes precedence over agentId resolution. */
  voice?: string;
}

interface TTSApiResponse {
  success: boolean;
  base64?: string;
  format?: string;
  error?: string;
  details?: string;
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function createRuntimeTTSCacheId(
  providerId: string,
  voice: string,
  speed: number,
  text: string,
): string {
  return `runtime-tts:${providerId}:${hashText(voice)}:${speed.toFixed(2)}:${hashText(text)}`;
}

/**
 * Audio player implementation
 */
export class AudioPlayer {
  private audio: HTMLAudioElement | null = null;
  private speech: SpeechSynthesisUtterance | null = null;
  private currentText: string | null = null;
  private pendingRequest: AbortController | null = null;
  private activeBlobUrl: string | null = null;
  private speechGeneration = 0;
  private restartGeneration = 0;
  private speechBaseRate = 1;
  private currentSpeechOptions: RuntimeSpeechOptions | undefined;
  private onEndedCallback: (() => void) | null = null;
  private muted: boolean = false;
  private volume: number = 1;
  private playbackRate: number = 1;

  /**
   * Play audio (from IndexedDB pre-generated cache)
   * @param audioId Audio ID
   * @returns true if audio started playing, false if no audio (TTS disabled or not generated)
   */
  public async play(
    audioId: string,
    fallbackText?: string,
    browserOptions?: BrowserSpeechOptions,
  ): Promise<boolean> {
    try {
      // Stop any previous HTML audio or browser speech before starting a new line.
      this.stop();

      if (browserOptions?.browserOnly && fallbackText?.trim() && !this.muted) {
        return this.playBrowserSpeech(fallbackText, browserOptions);
      }

      // Get audio from database
      const audioRecord = await db.audioFiles.get(audioId);

      if (!audioRecord) {
        if (fallbackText?.trim() && !this.muted) {
          return this.playBrowserSpeech(fallbackText, browserOptions);
        }
        // Pre-generated audio does not exist (or TTS is disabled).
        return false;
      }

      // Create audio element
      this.audio = new Audio();

      // Set audio source
      const blobUrl = URL.createObjectURL(audioRecord.blob);
      this.audio.src = blobUrl;
      if (this.muted) this.audio.volume = 0;
      else this.audio.volume = this.volume;

      // Apply playback rate
      this.audio.defaultPlaybackRate = this.playbackRate;
      this.audio.playbackRate = this.playbackRate;

      // Set ended callback
      this.audio.addEventListener('ended', () => {
        URL.revokeObjectURL(blobUrl);
        this.onEndedCallback?.();
      });

      // Play
      await this.audio.play();
      // Re-apply after play() — some browsers reset during load
      this.audio.playbackRate = this.playbackRate;
      return true;
    } catch (error) {
      log.error('Failed to play audio:', error);
      throw error;
    }
  }

  /**
   * Generate and play speech with the provider selected at playback time.
   * The runtime cache is isolated by provider, voice, speed and text.
   */
  public async playText(text: string, options: RuntimeSpeechOptions = {}): Promise<boolean> {
    const normalizedText = text.trim();
    if (!normalizedText) return false;

    this.stopPlayback();
    const generation = this.speechGeneration;
    const settings = useSettingsStore.getState();
    this.currentText = normalizedText;
    this.currentSpeechOptions = options;

    if (!settings.ttsEnabled || this.muted) {
      this.currentText = null;
      return false;
    }

    const effectiveVoice =
      options.voice ||
      (options.agentId
        ? resolveAgentVoice(
            settings.ttsProviderId,
            settings.ttsVoice,
            options.agentId,
            typeof window !== 'undefined' && 'speechSynthesis' in window
              ? window.speechSynthesis.getVoices()
              : [],
          )
        : settings.ttsVoice);

    if (settings.ttsProviderId === 'browser-native-tts') {
      return this.playBrowserSpeech(normalizedText, {
        voice: effectiveVoice,
        rate: settings.ttsSpeed,
        browserOnly: true,
      });
    }

    const providerConfig = settings.ttsProvidersConfig[settings.ttsProviderId];
    const cacheId = createRuntimeTTSCacheId(
      settings.ttsProviderId,
      effectiveVoice,
      settings.ttsSpeed,
      normalizedText,
    );
    let audioRecord = await db.audioFiles.get(cacheId);

    if (generation !== this.speechGeneration) return true;

    if (!audioRecord) {
      const controller = new AbortController();
      this.pendingRequest = controller;

      try {
        const response = await fetch('/api/generate/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: normalizedText,
            audioId: cacheId,
            ttsProviderId: settings.ttsProviderId,
            ttsVoice: effectiveVoice,
            ttsSpeed: settings.ttsSpeed,
            ttsApiKey: providerConfig?.apiKey?.trim() || undefined,
            ttsBaseUrl: providerConfig?.baseUrl?.trim() || undefined,
          }),
          signal: controller.signal,
        });
        const data = (await response
          .json()
          .catch(() => ({ success: false, error: response.statusText }))) as TTSApiResponse;

        if (!response.ok || !data.success || !data.base64 || !data.format) {
          throw new Error(
            data.details || data.error || `TTS request failed: HTTP ${response.status}`,
          );
        }

        const binary = atob(data.base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) {
          bytes[index] = binary.charCodeAt(index);
        }
        const blob = new Blob([bytes], { type: `audio/${data.format}` });
        audioRecord = {
          id: cacheId,
          blob,
          format: data.format,
          text: normalizedText,
          voice: effectiveVoice,
          createdAt: Date.now(),
        };
        await db.audioFiles.put(audioRecord);
      } catch (error) {
        // A newer play/restart/stop operation owns playback now.
        if (controller.signal.aborted || generation !== this.speechGeneration) {
          return true;
        }
        throw error;
      } finally {
        if (this.pendingRequest === controller) {
          this.pendingRequest = null;
        }
      }
    }

    if (generation !== this.speechGeneration) return true;
    await this.playAudioBlob(audioRecord.blob, generation);
    log.info('Runtime TTS started', {
      provider: settings.ttsProviderId,
      voice: effectiveVoice,
      textLength: normalizedText.length,
    });
    return true;
  }

  /**
   * Replay the active sentence with the latest provider/voice settings.
   */
  public async restartCurrentSpeech(keepPaused = false): Promise<void> {
    const text = this.currentText;
    if (!text) return;

    const restartGeneration = ++this.restartGeneration;
    try {
      const started = await this.playText(text, this.currentSpeechOptions);
      if (restartGeneration !== this.restartGeneration) return;
      if (started && keepPaused) {
        this.pause();
      }
      if (!started) {
        this.currentText = null;
        this.onEndedCallback?.();
      }
    } catch (error) {
      if (restartGeneration !== this.restartGeneration) return;
      log.error('Failed to restart speech with current TTS settings:', error);
      this.currentText = null;
      this.onEndedCallback?.();
    }
  }

  /**
   * Pause playback
   */
  public pause(): void {
    if (this.audio && !this.audio.paused) {
      this.audio.pause();
    }
    if (this.speech && 'speechSynthesis' in window) {
      window.speechSynthesis.pause();
    }
  }

  /**
   * Stop playback
   */
  public stop(): void {
    this.restartGeneration += 1;
    this.stopPlayback();
    this.currentText = null;
    this.currentSpeechOptions = undefined;
  }

  private stopPlayback(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio = null;
    }
    if (this.activeBlobUrl) {
      URL.revokeObjectURL(this.activeBlobUrl);
      this.activeBlobUrl = null;
    }
    this.pendingRequest?.abort();
    this.pendingRequest = null;
    this.speechGeneration += 1;
    if (this.speech && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.speech = null;
    // Note: onEndedCallback intentionally NOT cleared here because play()
    // calls stop() internally — clearing would break the callback chain.
    // Stale callbacks are harmless: engine mode check prevents processNext().
  }

  private async playAudioBlob(blob: Blob, generation: number): Promise<void> {
    this.audio = new Audio();
    const blobUrl = URL.createObjectURL(blob);
    this.activeBlobUrl = blobUrl;
    this.audio.src = blobUrl;
    this.audio.volume = this.muted ? 0 : this.volume;
    this.audio.defaultPlaybackRate = this.playbackRate;
    this.audio.playbackRate = this.playbackRate;

    this.audio.addEventListener(
      'ended',
      () => {
        if (generation !== this.speechGeneration) return;
        URL.revokeObjectURL(blobUrl);
        if (this.activeBlobUrl === blobUrl) this.activeBlobUrl = null;
        this.audio = null;
        this.currentText = null;
        this.onEndedCallback?.();
      },
      { once: true },
    );

    await this.audio.play();
    this.audio.playbackRate = this.playbackRate;
  }

  /**
   * Resume playback
   */
  public resume(): void {
    if (this.audio?.paused) {
      this.audio.playbackRate = this.playbackRate;
      this.audio.play().catch((error) => {
        log.error('Failed to resume audio:', error);
      });
    }
    if (this.speech && 'speechSynthesis' in window) {
      window.speechSynthesis.resume();
    }
  }

  /**
   * Get current playback status (actively playing, not paused)
   */
  public isPlaying(): boolean {
    if (this.audio !== null && !this.audio.paused) return true;
    return this.speech !== null && 'speechSynthesis' in window && !window.speechSynthesis.paused;
  }

  /**
   * Whether there is active audio (playing or paused, but not ended)
   * Used to decide whether to resume playback or skip to the next line
   */
  public hasActiveAudio(): boolean {
    return this.audio !== null || this.speech !== null;
  }

  /**
   * Get current playback time (milliseconds)
   */
  public getCurrentTime(): number {
    return this.audio ? this.audio.currentTime * 1000 : 0;
  }

  /**
   * Get audio duration (milliseconds)
   */
  public getDuration(): number {
    return this.audio && !isNaN(this.audio.duration) ? this.audio.duration * 1000 : 0;
  }

  private playBrowserSpeech(text: string, options: BrowserSpeechOptions = {}): boolean {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      log.warn('Browser speech synthesis is not supported');
      return false;
    }

    const generation = ++this.speechGeneration;
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const selectedVoice =
      (options.voice
        ? voices.find(
            (voice) =>
              voice.name === options.voice ||
              voice.voiceURI === options.voice ||
              voice.lang === options.voice,
          )
        : undefined) ||
      voices.find((voice) => voice.localService && voice.lang.toLowerCase() === 'zh-cn') ||
      voices.find((voice) => voice.lang.toLowerCase() === 'zh-cn') ||
      voices.find((voice) => voice.lang.toLowerCase().startsWith('zh'));

    utterance.voice = selectedVoice ?? null;
    utterance.lang = selectedVoice?.lang || options.lang || 'zh-CN';
    this.speechBaseRate = options.rate ?? 1;
    utterance.rate = Math.max(0.1, Math.min(10, this.speechBaseRate * this.playbackRate));
    utterance.onstart = () => {
      log.info('Browser speech started', {
        voice: selectedVoice?.name || 'browser-default',
        lang: utterance.lang,
        textLength: text.length,
      });
    };
    utterance.onend = () => {
      if (generation !== this.speechGeneration) return;
      this.speech = null;
      this.currentText = null;
      this.onEndedCallback?.();
    };
    utterance.onerror = (event) => {
      if (generation !== this.speechGeneration) return;
      log.error('Browser speech failed:', event.error);
      this.speech = null;
      this.currentText = null;
      this.onEndedCallback?.();
    };
    this.speech = utterance;
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      window.speechSynthesis.cancel();
    }
    window.speechSynthesis.speak(utterance);
    return true;
  }

  /**
   * Set playback ended callback
   */
  public onEnded(callback: () => void): void {
    this.onEndedCallback = callback;
  }

  /**
   * Set mute state (takes effect immediately on currently playing audio)
   */
  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.audio) {
      this.audio.volume = muted ? 0 : this.volume;
    }
  }

  /**
   * Set volume (0-1)
   */
  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.audio && !this.muted) {
      this.audio.volume = this.volume;
    }
  }

  /**
   * Set playback speed (takes effect immediately on currently playing audio)
   */
  public setPlaybackRate(rate: number): void {
    this.playbackRate = Math.max(0.5, Math.min(2, rate));
    if (this.audio) {
      this.audio.playbackRate = this.playbackRate;
    }
    if (this.speech) {
      this.speech.rate = Math.max(0.1, Math.min(10, this.speechBaseRate * this.playbackRate));
    }
  }

  /**
   * Destroy the player
   */
  public destroy(): void {
    this.stop();
    this.onEndedCallback = null;
  }
}

/**
 * Create an audio player instance
 */
export function createAudioPlayer(): AudioPlayer {
  return new AudioPlayer();
}
