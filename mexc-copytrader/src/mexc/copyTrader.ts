// src/mexc/copyTrader.ts

import { configStorage } from '../config/storage';
import { clientManager, MexcClientWrapper } from './client';
import { AccountConfig, TradeResult, CopyTradingSettings, Position } from '../config/types';
import { 
  sleep, 
  randomDelay, 
  applyPriceDeviation, 
  randomLeverage, 
  roundToStep,
  log, 
  logError,
  sideToMexcCode 
} from '../utils/helpers';

/**
 * Результат копирования сделки
 */
export interface CopyTradeResult {
  masterResult?: TradeResult;
  slaveResults: TradeResult[];
  symbol: string;
  side: 'long' | 'short';
  basePrice: number;
  baseLeverage: number;
  totalLatencyMs: number;
}

/**
 * Движок копитрейдинга
 */
export class CopyTradingEngine {
  private isRunning: boolean = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastKnownPositions: Map<string, Position[]> = new Map();

  /**
   * Запускает мониторинг мастер-аккаунта
   */
  startMonitoring(intervalMs: number = 2000): void {
    if (this.isRunning) {
      log('[CopyTrader]', 'Мониторинг уже запущен');
      return;
    }

    this.isRunning = true;
    log('[CopyTrader]', `Запуск мониторинга с интервалом ${intervalMs}ms`);

    this.pollInterval = setInterval(async () => {
      await this.checkMasterChanges();
    }, intervalMs);
  }

  /**
   * Останавливает мониторинг
   */
  stopMonitoring(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isRunning = false;
    log('[CopyTrader]', 'Мониторинг остановлен');
  }

  /**
   * Проверяет изменения на мастер-аккаунте
   */
  private async checkMasterChanges(): Promise<void> {
    const masterAccount = configStorage.getMasterAccount();
    if (!masterAccount) return;

    const masterClient = clientManager.getClient(masterAccount.id);
    if (!masterClient) return;

    try {
      const currentPositions = await masterClient.getOpenPositions();
      const previousPositions = this.lastKnownPositions.get(masterAccount.id) || [];

      // Проверяем новые позиции
      for (const pos of currentPositions) {
        const wasOpen = previousPositions.find(
          p => p.symbol === pos.symbol && p.side === pos.side
        );

        if (!wasOpen) {
          // Новая позиция открыта на мастере
          log('[CopyTrader]', `Обнаружена новая позиция: ${pos.symbol} ${pos.side}`);
          await this.copyOpenPosition(pos);
        }
      }

      // Проверяем закрытые позиции
      for (const prev of previousPositions) {
        const stillOpen = currentPositions.find(
          p => p.symbol === prev.symbol && p.side === prev.side
        );

        if (!stillOpen) {
          // Позиция закрыта на мастере
          log('[CopyTrader]', `Позиция закрыта: ${prev.symbol} ${prev.side}`);
          await this.copyClosePosition(prev);
        }
      }

      this.lastKnownPositions.set(masterAccount.id, currentPositions);

    } catch (err) {
      logError('[CopyTrader]', 'Ошибка проверки мастер-аккаунта', err);
    }
  }

  /**
   * Копирует открытие позиции на slave-аккаунты
   */
  private async copyOpenPosition(masterPosition: Position): Promise<void> {
    const settings = configStorage.getSettings();
    if (!settings.copyOpenPositions) return;

    const slaveAccounts = configStorage.getSlaveAccounts();
    if (slaveAccounts.length === 0) return;

    log('[CopyTrader]', `Копирование открытия ${masterPosition.symbol} на ${slaveAccounts.length} аккаунтов`);

    for (const account of slaveAccounts) {
      // Рандомная задержка для каждого аккаунта
      const delay = randomDelay(settings.delayMinMs, settings.delayMaxMs);
      await sleep(delay);

      const client = clientManager.getClient(account.id);
      if (!client) continue;

      try {
        // Рассчитываем параметры с отклонениями
        const price = applyPriceDeviation(
          masterPosition.entryPrice,
          settings.priceDeviationPercent,
          masterPosition.side
        );

        const leverage = randomLeverage(
          Math.max(1, account.leverageMin),
          Math.min(account.leverageMax, masterPosition.leverage)
        );

        // Рассчитываем объём на основе лимита позиции аккаунта
        const positionUsd = Math.min(account.maxPositionUsd, masterPosition.margin * masterPosition.leverage);
        const marginForThisAcc = positionUsd / leverage;
        
        // Получаем info о контракте для расчёта объёма
        const contractInfo = await client.getContractInfo(masterPosition.symbol);
        const contractSize = contractInfo?.contractSize || 1;
        const volume = Math.floor(positionUsd / (price * contractSize));

        if (volume < 1) {
          logError(`[${account.name}]`, 'Объём слишком мал для открытия');
          continue;
        }

        const result = await client.openPosition({
          symbol: masterPosition.symbol,
          side: masterPosition.side,
          price: roundToStep(price, contractInfo?.priceStep || 0.00001),
          volume,
          leverage,
        });

        if (result.success) {
          log(`[${account.name}]`, `Позиция открыта: ${masterPosition.symbol} ${masterPosition.side} vol=${volume} lev=${leverage}`);
        } else {
          logError(`[${account.name}]`, `Ошибка открытия: ${result.message}`);
        }

      } catch (err) {
        logError(`[${account.name}]`, 'Ошибка копирования открытия', err);
      }
    }
  }

  /**
   * Копирует закрытие позиции на slave-аккаунты
   */
  private async copyClosePosition(masterPosition: Position): Promise<void> {
    const settings = configStorage.getSettings();
    if (!settings.copyClosePositions) return;

    const slaveAccounts = configStorage.getSlaveAccounts();
    
    log('[CopyTrader]', `Копирование закрытия ${masterPosition.symbol} на ${slaveAccounts.length} аккаунтов`);

    for (const account of slaveAccounts) {
      const delay = randomDelay(settings.delayMinMs, settings.delayMaxMs);
      await sleep(delay);

      const client = clientManager.getClient(account.id);
      if (!client) continue;

      try {
        // Проверяем, есть ли позиция на этом аккаунте
        const positions = await client.getOpenPositions(masterPosition.symbol);
        const position = positions.find(p => p.side === masterPosition.side);

        if (!position) {
          log(`[${account.name}]`, `Позиция ${masterPosition.symbol} не найдена`);
          continue;
        }

        // Получаем текущую цену
        const currentPrice = await client.getCurrentPrice(masterPosition.symbol);
        if (!currentPrice) continue;

        // Применяем отклонение цены
        const closePrice = applyPriceDeviation(
          currentPrice,
          settings.priceDeviationPercent,
          masterPosition.side === 'long' ? 'short' : 'long' // Для закрытия отклонение в другую сторону
        );

        const result = await client.closePosition({
          symbol: masterPosition.symbol,
          side: position.side,
          price: closePrice,
          volume: position.volume,
        });

        if (result.success) {
          log(`[${account.name}]`, `Позиция закрыта: ${masterPosition.symbol}`);
        } else {
          logError(`[${account.name}]`, `Ошибка закрытия: ${result.message}`);
        }

      } catch (err) {
        logError(`[${account.name}]`, 'Ошибка копирования закрытия', err);
      }
    }
  }

  /**
   * Открывает позицию вручную (из Telegram команды) на всех аккаунтах
   */
  async manualOpenPosition(params: {
    symbol: string;
    side: 'long' | 'short';
    price: number;
    positionSizeUsd: number;
    leverage: number;
    priceStep?: number;
  }): Promise<CopyTradeResult> {
    const startTime = Date.now();
    const settings = configStorage.getSettings();
    const accounts = configStorage.getEnabledAccounts();
    const results: TradeResult[] = [];

    log('[CopyTrader]', `Ручное открытие ${params.symbol} ${params.side} на ${accounts.length} аккаунтах`);

    // Получаем info о контракте
    const masterClient = clientManager.getClient(accounts[0]?.id || '');
    const contractInfo = masterClient 
      ? await masterClient.getContractInfo(params.symbol)
      : null;
    
    const contractSize = contractInfo?.contractSize || 1;
    const priceStep = params.priceStep || contractInfo?.priceStep || 0.00001;

    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      const client = clientManager.getClient(account.id);
      
      if (!client) {
        results.push({
          accountId: account.id,
          accountName: account.name,
          success: false,
          message: 'Клиент не инициализирован',
        });
        continue;
      }

      // Задержка для не-мастер аккаунтов
      if (!account.isMaster && i > 0) {
        const delay = randomDelay(settings.delayMinMs, settings.delayMaxMs);
        await sleep(delay);
      }

      try {
        // Рассчитываем параметры с учётом защиты от мультиаккаунтинга
        let entryPrice = params.price;
        let leverage = params.leverage;

        if (!account.isMaster) {
          // Отклонение цены для slave-аккаунтов
          entryPrice = applyPriceDeviation(
            params.price,
            settings.priceDeviationPercent,
            params.side
          );

          // Разброс плеча
          const minLev = Math.max(1, params.leverage - settings.leverageSpread);
          const maxLev = Math.min(params.leverage, account.leverageMax);
          leverage = randomLeverage(minLev, maxLev);
        }

        // Ограничиваем позицию лимитом аккаунта
        const maxPosUsd = Math.min(params.positionSizeUsd, account.maxPositionUsd);
        const volume = Math.max(1, Math.floor(maxPosUsd / (entryPrice * contractSize)));

        const orderStartTime = Date.now();
        const result = await client.openPosition({
          symbol: params.symbol,
          side: params.side,
          price: roundToStep(entryPrice, priceStep),
          volume,
          leverage,
        });

        results.push({
          accountId: account.id,
          accountName: account.name,
          success: result.success,
          message: result.message || 'OK',
          orderId: result.orderId,
          executedPrice: entryPrice,
          executedVolume: volume,
          leverage,
          latencyMs: Date.now() - orderStartTime,
        });

      } catch (err: any) {
        results.push({
          accountId: account.id,
          accountName: account.name,
          success: false,
          message: err?.message || String(err),
        });
      }
    }

    return {
      slaveResults: results,
      symbol: params.symbol,
      side: params.side,
      basePrice: params.price,
      baseLeverage: params.leverage,
      totalLatencyMs: Date.now() - startTime,
    };
  }

  /**
   * Закрывает позицию на всех аккаунтах
   */
  async manualClosePosition(params: {
    symbol: string;
    price?: number;
  }): Promise<TradeResult[]> {
    const settings = configStorage.getSettings();
    const accounts = configStorage.getEnabledAccounts();
    const results: TradeResult[] = [];

    log('[CopyTrader]', `Ручное закрытие ${params.symbol} на ${accounts.length} аккаунтах`);

    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      const client = clientManager.getClient(account.id);
      
      if (!client) continue;

      // Задержка для не-первого аккаунта
      if (i > 0) {
        const delay = randomDelay(settings.delayMinMs, settings.delayMaxMs);
        await sleep(delay);
      }

      try {
        // Получаем позицию
        const positions = await client.getOpenPositions(params.symbol);
        if (positions.length === 0) {
          results.push({
            accountId: account.id,
            accountName: account.name,
            success: false,
            message: 'Позиция не найдена',
          });
          continue;
        }

        for (const position of positions) {
          // Определяем цену закрытия
          let closePrice = params.price;
          if (!closePrice) {
            const currentPrice = await client.getCurrentPrice(params.symbol);
            closePrice = currentPrice || position.entryPrice;
          }

          // Отклонение цены для не-мастер аккаунтов
          if (!account.isMaster) {
            closePrice = applyPriceDeviation(
              closePrice,
              settings.priceDeviationPercent,
              position.side === 'long' ? 'short' : 'long'
            );
          }

          const result = await client.closePosition({
            symbol: params.symbol,
            side: position.side,
            price: closePrice,
            volume: position.volume,
          });

          results.push({
            accountId: account.id,
            accountName: account.name,
            success: result.success,
            message: result.message || 'OK',
            orderId: result.orderId,
            executedPrice: closePrice,
            executedVolume: position.volume,
          });
        }

      } catch (err: any) {
        results.push({
          accountId: account.id,
          accountName: account.name,
          success: false,
          message: err?.message || String(err),
        });
      }
    }

    return results;
  }

  /**
   * Устанавливает TP/SL на всех аккаунтах
   */
  async setTpSlOnAll(params: {
    symbol: string;
    side: 'long' | 'short';
    takeProfit?: number;
    stopLoss?: number;
  }): Promise<TradeResult[]> {
    const settings = configStorage.getSettings();
    const accounts = configStorage.getEnabledAccounts();
    const results: TradeResult[] = [];

    log('[CopyTrader]', `Установка TP/SL для ${params.symbol} на ${accounts.length} аккаунтах`);

    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      const client = clientManager.getClient(account.id);
      
      if (!client) continue;

      if (i > 0) {
        const delay = randomDelay(settings.delayMinMs, settings.delayMaxMs);
        await sleep(delay);
      }

      try {
        // Применяем отклонение для не-мастер аккаунтов
        let tp = params.takeProfit;
        let sl = params.stopLoss;

        if (!account.isMaster) {
          if (tp) {
            tp = applyPriceDeviation(
              tp,
              settings.priceDeviationPercent,
              params.side === 'long' ? 'short' : 'long' // TP в противоположную сторону
            );
          }
          if (sl) {
            sl = applyPriceDeviation(
              sl,
              settings.priceDeviationPercent,
              params.side // SL в ту же сторону
            );
          }
        }

        const result = await client.setTpSl({
          symbol: params.symbol,
          side: params.side,
          takeProfit: tp,
          stopLoss: sl,
        });

        results.push({
          accountId: account.id,
          accountName: account.name,
          success: result.success,
          message: result.message || 'OK',
        });

      } catch (err: any) {
        results.push({
          accountId: account.id,
          accountName: account.name,
          success: false,
          message: err?.message || String(err),
        });
      }
    }

    return results;
  }

  /**
   * Отменяет все ордера по символу на всех аккаунтах
   */
  async cancelAllOrdersOnAll(symbol: string): Promise<TradeResult[]> {
    const accounts = configStorage.getEnabledAccounts();
    const results: TradeResult[] = [];

    for (const account of accounts) {
      const client = clientManager.getClient(account.id);
      if (!client) continue;

      const success = await client.cancelAllOrders(symbol);
      results.push({
        accountId: account.id,
        accountName: account.name,
        success,
        message: success ? 'Ордера отменены' : 'Ошибка отмены',
      });
    }

    return results;
  }
}

// Синглтон движка
export const copyTradingEngine = new CopyTradingEngine();
