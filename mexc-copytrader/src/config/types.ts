// src/config/types.ts

/**
 * Конфигурация одного MEXC аккаунта
 */
export interface AccountConfig {
  id: string;                    // Уникальный ID аккаунта (uuid)
  name: string;                  // Человекочитаемое имя (например "Аккаунт 1")
  authToken: string;             // authToken для MEXC API
  proxyUrl?: string;             // Прокси (опционально)
  enabled: boolean;              // Включен ли аккаунт
  isMaster: boolean;             // Является ли главным (мастер) аккаунтом
  
  // Персональные настройки аккаунта
  maxPositionUsd: number;        // Максимальный размер позиции в USD
  leverageMin: number;           // Минимальное плечо (для разброса)
  leverageMax: number;           // Максимальное плечо (для разброса)
  
  // Статистика (опционально, для отображения)
  lastBalance?: number;
  lastUpdated?: string;
}

/**
 * Глобальные настройки системы копитрейдинга
 */
export interface CopyTradingSettings {
  // Защита от мультиаккаунтинга
  delayMinMs: number;            // Минимальная задержка (мс) - по умолчанию 0
  delayMaxMs: number;            // Максимальная задержка (мс) - по умолчанию 1000
  
  priceDeviationPercent: number; // Разброс цены входа (%) - по умолчанию 1.0
  // Для LONG: от 0 до +priceDeviationPercent
  // Для SHORT: от 0 до -priceDeviationPercent
  
  leverageSpread: number;        // Разброс плеча (от мастера минус 0..leverageSpread)
  
  // Режимы работы
  copyOpenPositions: boolean;    // Копировать открытие позиций
  copyClosePositions: boolean;   // Копировать закрытие позиций
  copyTpSl: boolean;             // Копировать TP/SL
  
  // Настройки для сигналов (пересылаемые сообщения)
  signalsEnabled: boolean;       // Включена ли обработка сигналов
  signalEntryOffset: number;     // Смещение цены входа для сигналов (%)
  signalTpOffset: number;        // Смещение TP для сигналов (%)
  signalCancelTimeMin: number;   // Мин. время отмены ордеров (сек)
  signalCancelTimeMax: number;   // Макс. время отмены ордеров (сек)
}

/**
 * Полная конфигурация бота
 */
export interface BotConfig {
  telegramBotToken: string;
  telegramUserId: number;
  accounts: AccountConfig[];
  settings: CopyTradingSettings;
  contractLimits: Record<string, number>; // Лимиты контрактов по символам
}

/**
 * Информация об открытой позиции
 */
export interface Position {
  symbol: string;
  side: 'long' | 'short';
  volume: number;
  entryPrice: number;
  leverage: number;
  margin: number;
  unrealizedPnl: number;
  liquidationPrice?: number;
}

/**
 * Информация об ордере
 */
export interface Order {
  orderId: string;
  symbol: string;
  side: number;          // 1=OpenLong, 2=CloseShort, 3=OpenShort, 4=CloseLong
  type: number;          // 1=Limit, 2=PostOnly, 3=IOC, 4=FOK, 5=Market, 6=ConvertMarket
  price: number;
  volume: number;
  filledVolume: number;
  status: string;
  leverage: number;
  takeProfit?: number;
  stopLoss?: number;
  createTime: number;
}

/**
 * Событие от мастер-аккаунта для копирования
 */
export interface MasterEvent {
  type: 'order_created' | 'order_filled' | 'order_cancelled' | 'position_opened' | 'position_closed' | 'tp_sl_set';
  timestamp: number;
  data: {
    symbol: string;
    side: number;
    price: number;
    volume: number;
    leverage: number;
    takeProfit?: number;
    stopLoss?: number;
    orderId?: string;
    positionSide?: 'long' | 'short';
  };
}

/**
 * Результат выполнения торговой операции
 */
export interface TradeResult {
  accountId: string;
  accountName: string;
  success: boolean;
  message: string;
  orderId?: string;
  executedPrice?: number;
  executedVolume?: number;
  leverage?: number;
  latencyMs?: number;
}

/**
 * Состояние сессии пользователя в Telegram
 */
export interface UserSession {
  state: SessionState;
  data: Record<string, any>;
  lastActivity: number;
}

export type SessionState = 
  | 'idle'
  | 'adding_account'
  | 'editing_account'
  | 'setting_tp'
  | 'setting_sl'
  | 'configuring_settings'
  | 'waiting_account_name'
  | 'waiting_auth_token'
  | 'waiting_proxy'
  | 'waiting_max_position'
  | 'waiting_leverage_min'
  | 'waiting_leverage_max'
  | 'waiting_tp_price'
  | 'waiting_sl_price'
  | 'waiting_setting_value';

/**
 * Контекст для открытой позиции (для кнопок TP/SL)
 */
export interface PendingTpSlContext {
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  volume: number;
  leverage: number;
  accountResults: TradeResult[];
}

/**
 * Информация о контракте MEXC
 */
export interface ContractInfo {
  symbol: string;
  contractSize: number;
  maxVolume: number;
  priceStep: number;
  volumeStep: number;
  minVolume: number;
}

/**
 * Баланс аккаунта
 */
export interface AccountBalance {
  available: number;
  frozen: number;
  total: number;
  currency: string;
}
