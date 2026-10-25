import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import type { WearInboxItem } from './protocol';

type Subscription = { remove(): void };
export type WearNativeStatus = { enabled: boolean; connectedNodeCount: number; pendingCount: number; error?: string };
export type WearNativeModule = {
  setEnabledAsync(enabled: boolean): Promise<void>;
  scanPendingAsync(): Promise<void>;
  drainInboxAsync(): Promise<WearInboxItem[]>;
  acknowledgeInboxAsync(id: string): Promise<void>;
  publishDayAsync(json: string): Promise<void>;
  publishAckAsync(json: string): Promise<void>;
  getStatusAsync(): Promise<WearNativeStatus>;
  addListener(name: 'onInboxChanged', listener: (event?: { pendingCount?: number }) => void): Subscription;
};

export const wearNative = Platform.OS === 'android'
  ? requireOptionalNativeModule<WearNativeModule>('ContextWear') : null;
