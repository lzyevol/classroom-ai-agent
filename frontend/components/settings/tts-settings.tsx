'use client';

import { useState, useRef, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { TTS_PROVIDERS, DEFAULT_TTS_VOICES } from '@/lib/audio/constants';
import type { TTSProviderId } from '@/lib/audio/types';
import { Volume2, Loader2, CheckCircle2, XCircle, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createLogger } from '@/lib/logger';

const log = createLogger('TTSSettings');

interface TTSSettingsProps {
  selectedProviderId: TTSProviderId;
}

export function TTSSettings({ selectedProviderId }: TTSSettingsProps) {
  const { t } = useI18n();

  const ttsVoice = useSettingsStore((state) => state.ttsVoice);
  const ttsSpeed = useSettingsStore((state) => state.ttsSpeed);
  const ttsProvidersConfig = useSettingsStore((state) => state.ttsProvidersConfig);
  const setTTSProviderConfig = useSettingsStore((state) => state.setTTSProviderConfig);
  const setTTSVoice = useSettingsStore((state) => state.setTTSVoice);
  const ttsEnabled = useSettingsStore((state) => state.ttsEnabled);
  const setTTSEnabled = useSettingsStore((state) => state.setTTSEnabled);
  const discussionTtsEnabled = useSettingsStore((state) => state.discussionTtsEnabled);
  const setDiscussionTTSEnabled = useSettingsStore(
    (state) => state.setDiscussionTTSEnabled,
  );
  const activeProviderId = useSettingsStore((state) => state.ttsProviderId);

  // When testing a non-active provider, use that provider's default voice
  // instead of the active provider's voice (which may be incompatible)
  const effectiveVoice =
    selectedProviderId === activeProviderId
      ? ttsVoice
      : DEFAULT_TTS_VOICES[selectedProviderId] || 'default';

  const ttsProvider = TTS_PROVIDERS[selectedProviderId] ?? TTS_PROVIDERS['openai-tts'];
  const isServerConfigured = !!ttsProvidersConfig[selectedProviderId]?.isServerConfigured;

  const [showApiKey, setShowApiKey] = useState(false);
  const [testingTTS, setTestingTTS] = useState(false);
  const [testText, setTestText] = useState(t('settings.ttsTestTextDefault'));
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const audioRef = useRef<HTMLAudioElement>(null);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const availableVoices =
    selectedProviderId === 'browser-native-tts'
      ? browserVoices.map((voice) => ({
          id: voice.voiceURI || voice.name,
          name: `${voice.name} (${voice.lang})`,
          language: voice.lang,
        }))
      : ttsProvider.voices;
  const activeVoiceName =
    availableVoices.find((voice) => voice.id === effectiveVoice)?.name || effectiveVoice;

  useEffect(() => {
    if (selectedProviderId !== 'browser-native-tts' || !('speechSynthesis' in window)) {
      setBrowserVoices([]);
      return;
    }

    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      setBrowserVoices(voices);

      const currentVoice = useSettingsStore.getState().ttsVoice;
      const currentExists = voices.some(
        (voice) => voice.voiceURI === currentVoice || voice.name === currentVoice,
      );
      if (voices.length > 0 && (currentVoice === 'default' || !currentExists)) {
        const preferredVoice =
          voices.find((voice) => voice.localService && voice.lang.toLowerCase() === 'zh-cn') ||
          voices.find((voice) => voice.lang.toLowerCase() === 'zh-cn') ||
          voices.find((voice) => voice.lang.toLowerCase().startsWith('zh')) ||
          voices.find((voice) => voice.default) ||
          voices[0];
        setTTSVoice(preferredVoice.voiceURI || preferredVoice.name);
      }
    };
    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
  }, [selectedProviderId, setTTSVoice]);

  // Update test text when language changes
  useEffect(() => {
    setTestText(t('settings.ttsTestTextDefault'));
  }, [t]);

  // Reset state when provider changes
  useEffect(() => {
    setShowApiKey(false);
    setTestStatus('idle');
    setTestMessage('');
  }, [selectedProviderId]);

  const handleTestTTS = async () => {
    if (!testText.trim()) return;
    setTestingTTS(true);
    setTestStatus('testing');
    setTestMessage('');

    try {
      if (selectedProviderId === 'browser-native-tts') {
        if (!('speechSynthesis' in window)) {
          setTestStatus('error');
          setTestMessage(t('settings.browserTTSNotSupported'));
          return;
        }

        const utterance = new SpeechSynthesisUtterance(testText);
        utterance.rate = ttsSpeed;
        const voices = window.speechSynthesis.getVoices();
        const selectedVoice =
          voices.find(
            (v) =>
              v.name === effectiveVoice ||
              v.voiceURI === effectiveVoice ||
              v.lang === effectiveVoice,
          ) ||
          voices.find((voice) => voice.localService && voice.lang.toLowerCase() === 'zh-cn') ||
          voices.find((voice) => voice.lang.toLowerCase().startsWith('zh'));
        if (selectedVoice) utterance.voice = selectedVoice;
        utterance.lang = selectedVoice?.lang || 'zh-CN';

        await new Promise<void>((resolve, reject) => {
          utterance.onend = () => resolve();
          utterance.onerror = (event) => reject(new Error(event.error));
          if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
            window.speechSynthesis.cancel();
          }
          window.speechSynthesis.speak(utterance);
        });

        setTestStatus('success');
        setTestMessage(t('settings.ttsTestSuccess'));
        return;
      }

      const requestBody: Record<string, unknown> = {
        text: testText,
        audioId: 'tts-test',
        ttsProviderId: selectedProviderId,
        ttsVoice: effectiveVoice,
        ttsSpeed: ttsSpeed,
      };
      const apiKeyValue = ttsProvidersConfig[selectedProviderId]?.apiKey;
      if (apiKeyValue?.trim()) requestBody.ttsApiKey = apiKeyValue;
      const baseUrlValue = ttsProvidersConfig[selectedProviderId]?.baseUrl;
      if (baseUrlValue?.trim()) requestBody.ttsBaseUrl = baseUrlValue;

      const response = await fetch('/api/generate/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const data = await response
        .json()
        .catch(() => ({ success: false, error: response.statusText }));
      if (response.ok && data.success) {
        const binaryStr = atob(data.base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        const audioBlob = new Blob([bytes], { type: `audio/${data.format}` });
        const audioUrl = URL.createObjectURL(audioBlob);
        if (audioRef.current) {
          audioRef.current.src = audioUrl;
          await audioRef.current.play();
        }
        setTestStatus('success');
        setTestMessage(t('settings.ttsTestSuccess'));
      } else {
        setTestStatus('error');
        setTestMessage(data.error || t('settings.ttsTestFailed'));
      }
    } catch (error) {
      log.error('TTS test failed:', error);
      setTestStatus('error');
      setTestMessage(
        error instanceof Error && error.message
          ? `${t('settings.ttsTestFailed')}: ${error.message}`
          : t('settings.ttsTestFailed'),
      );
    } finally {
      setTestingTTS(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
        <span className="text-muted-foreground">{t('settings.currentlyUsing')}：</span>
        <span className="font-medium">{ttsProvider.name}</span>
        <span className="text-muted-foreground"> · {activeVoiceName}</span>
      </div>

      <div className="flex items-center gap-3 rounded-lg border px-3 py-3">
        <Switch checked={ttsEnabled} onCheckedChange={setTTSEnabled} />
        <div>
          <p className="text-sm font-medium">{t('settings.enableTTS')}</p>
          <p className="text-xs text-muted-foreground">{t('settings.ttsEnabledDescription')}</p>
        </div>
      </div>

      {/* Discussion audio is synthesized live while lecture narration is
          pre-generated, so it gets its own switch. */}
      <div
        className={`flex items-center gap-3 rounded-lg border px-3 py-3 ${
          ttsEnabled ? '' : 'opacity-40 pointer-events-none'
        }`}
      >
        <Switch
          checked={discussionTtsEnabled}
          onCheckedChange={setDiscussionTTSEnabled}
          disabled={!ttsEnabled}
        />
        <div>
          <p className="text-sm font-medium">讨论朗读</p>
          <p className="text-xs text-muted-foreground">
            关闭后课堂讨论只显示文字，节奏更快；AI 老师讲课的朗读不受影响
          </p>
        </div>
      </div>

      {/* Server-configured notice */}
      {isServerConfigured && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 p-3 text-sm text-blue-700 dark:text-blue-300">
          {t('settings.serverConfiguredNotice')}
        </div>
      )}

      {/* API Key & Base URL */}
      {(ttsProvider.requiresApiKey || isServerConfigured) && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm">{t('settings.ttsApiKey')}</Label>
              <div className="relative">
                <Input
                  type={showApiKey ? 'text' : 'password'}
                  placeholder={
                    isServerConfigured ? t('settings.optionalOverride') : t('settings.enterApiKey')
                  }
                  value={ttsProvidersConfig[selectedProviderId]?.apiKey || ''}
                  onChange={(e) =>
                    setTTSProviderConfig(selectedProviderId, {
                      apiKey: e.target.value,
                    })
                  }
                  className="font-mono text-sm pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">{t('settings.ttsBaseUrl')}</Label>
              <Input
                placeholder={ttsProvider.defaultBaseUrl || t('settings.enterCustomBaseUrl')}
                value={ttsProvidersConfig[selectedProviderId]?.baseUrl || ''}
                onChange={(e) =>
                  setTTSProviderConfig(selectedProviderId, {
                    baseUrl: e.target.value,
                  })
                }
                className="text-sm"
              />
            </div>
          </div>
          {/* Request URL Preview */}
          {(() => {
            const effectiveBaseUrl =
              ttsProvidersConfig[selectedProviderId]?.baseUrl || ttsProvider.defaultBaseUrl || '';
            if (!effectiveBaseUrl) return null;
            let endpointPath = '';
            switch (selectedProviderId) {
              case 'openai-tts':
              case 'glm-tts':
                endpointPath = '/audio/speech';
                break;
              case 'azure-tts':
                endpointPath = '/cognitiveservices/v1';
                break;
              case 'qwen-tts':
                endpointPath = '/services/aigc/multimodal-generation/generation';
                break;
            }
            if (!endpointPath) return null;
            return (
              <p className="text-xs text-muted-foreground break-all">
                {t('settings.requestUrl')}: {effectiveBaseUrl + endpointPath}
              </p>
            );
          })()}
        </>
      )}

      <div className="space-y-2">
        <Label className="text-sm">{t('settings.voice')}</Label>
        {selectedProviderId === 'browser-native-tts' && availableVoices.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('settings.browserTTSNotSupported')}
          </p>
        ) : (
          <Select
            value={effectiveVoice}
            onValueChange={setTTSVoice}
            disabled={availableVoices.length === 0}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('settings.voice')} />
            </SelectTrigger>
            <SelectContent>
              {availableVoices.map((voice) => (
                <SelectItem key={voice.id} value={voice.id}>
                  {voice.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Test TTS */}
      <div className="space-y-2">
        <Label className="text-sm">{t('settings.testTTS')}</Label>
        <div className="flex gap-2">
          <Input
            placeholder={t('settings.ttsTestTextPlaceholder')}
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            className="flex-1"
          />
          <Button
            onClick={handleTestTTS}
            disabled={
              testingTTS ||
              !testText.trim() ||
              (ttsProvider.requiresApiKey &&
                !ttsProvidersConfig[selectedProviderId]?.apiKey?.trim() &&
                !isServerConfigured)
            }
            size="default"
            className="gap-2 w-32"
          >
            {testingTTS ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
            {t('settings.testTTS')}
          </Button>
        </div>
      </div>

      {testMessage && (
        <div
          className={cn(
            'rounded-lg p-3 text-sm overflow-hidden',
            testStatus === 'success' &&
              'bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/50 dark:text-green-400 dark:border-green-800',
            testStatus === 'error' &&
              'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-800',
          )}
        >
          <div className="flex items-start gap-2 min-w-0">
            {testStatus === 'success' && <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />}
            {testStatus === 'error' && <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
            <p className="flex-1 min-w-0 break-all">{testMessage}</p>
          </div>
        </div>
      )}

      <audio ref={audioRef} className="hidden" />
    </div>
  );
}
