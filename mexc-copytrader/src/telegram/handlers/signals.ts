// src/telegram/handlers/signals.ts

import { Context } from 'telegraf';
import { configStorage } from '../../config/storage';
import { clientManager } from '../../mexc/client';
import { TradeResult } from '../../config/types';
import * as keyboards from '../keyboards';
import { 
  sleep, 
  randomDelay, 
  roundToStep, 
  priceStepFromText,
  getSideFromSignal,
  applyPriceDeviation,
  randomLeverage,
  log,
  logError 
} from '../../utils/helpers';

/**
 * Интерфейс распарсенного сигнала
 */
interface ParsedSignal {
  symbol: string;
  fullSymbol: string;
  entryPrice: number;
  takeProfit: number;
  side: 'long' | 'short';
}

/**
 * Интерфейс align-сигнала
 */
interface AlignSignal {
  symbol: string;
  fullSymbol: string;
  mexcPrice: number;
}

/**
 * Парсит торговый сигнал из текста
 */
export function parseTradeSignal(text: string): ParsedSignal | null {
  // Ищем тикер формата #SYMBOL_USDT
  const symbolMatch = text.match(/#([A-Z0-9]+)_USDT/i);
  if (!symbolMatch) return null;

  const symbol = symbolMatch[1].toUpperCase();

  // Ищем цены
  const dexPriceMatch = text.match(/Price\s+DEX\s+\$([\d.]+)/i);
  const mexcPriceMatch = text.match(/Price\s+MEXC\s+\$([\d.]+)/i);

  if (!dexPriceMatch || !mexcPriceMatch) return null;

  const priceDex = parseFloat(dexPriceMatch[1]);
  const priceMexc = parseFloat(mexcPriceMatch[1]);

  if (isNaN(priceDex) || isNaN(priceMexc)) return null;

  // Определяем направление (по умолчанию short, как в оригинале)
  let side: 'long' | 'short' = 'short';
  
  // Проверяем наличие явных указаний на направление
  const upperText = text.toUpperCase();
  if (upperText.includes('DOUBLE LONG') || upperText.includes('LONG')) {
    side = 'long';
  } else if (upperText.includes('DOUBLE SHORT') || upperText.includes('SHORT')) {
    side = 'short';
  }

  return {
    symbol,
    fullSymbol: `${symbol}_USDT`,
    entryPrice: priceMexc,
    takeProfit: priceDex,
    side,
  };
}

/**
 * Парсит align-сигнал
 */
export function parseAlignSignal(text: string): AlignSignal | null {
  // Ищем формат "✅ #TOKEN" с "Aligned"
  const symbolMatch = text.match(/✅\s*#([A-Z0-9]+)/i);
  if (!symbolMatch) return null;

  // Проверяем что это align
  if (!text.toLowerCase().includes('aligned')) return null;

  const symbol = symbolMatch[1].toUpperCase();
  const fullSymbol = `${symbol}_USDT`;

  // Ищем цену MEXC
  const priceMatch = text.match(/Price\s*MEXC\s*\$?\s*([0-9]*\.?[0-9]+)/i);
  if (!priceMatch) return null;

  const mexcPrice = parseFloat(priceMatch[1]);
  if (!isFinite(mexcPrice) || mexcPrice <= 0) return null;

  return {
    symbol,
    fullSymbol,
    mexcPrice,
  };
}

/**
 * Обрабатывает торговый сигнал
 */
export async function handleTradeSignal(ctx: Context, text: string): Promise<boolean> {
  const settings = configStorage.getSettings();
  
  // Проверяем, включена ли обработка сигналов
  if (!settings.signalsEnabled) {
    return false;
  }

  const signal = parseTradeSignal(text);
  if (!signal) return false;

  log('[Signals]', `Обнаружен сигнал: ${signal.fullSymbol} ${signal.side}`);

  const accounts = configStorage.getEnabledAccounts();
  if (accounts.length === 0) {
    await ctx.reply('⚠️ Нет активных аккаунтов для обработки сигнала.');
    return true;
  }

  const startTime = Date.now();
  const priceStep = priceStepFromText(text);
  const results: TradeResult[] = [];

  // Получаем информацию о контракте
  const firstClient = clientManager.getClient(accounts[0].id);
  const contractInfo = firstClient 
    ? await firstClient.getContractInfo(signal.fullSymbol)
    : null;
  const contractSize = contractInfo?.contractSize || 1;

  // Лимит контрактов
  const contractLimits = configStorage.getContractLimits();
  const maxContracts = contractLimits[signal.fullSymbol] || 0;

  const sideEmoji = signal.side === 'long' ? '🟢' : '🔴';
  const sideText = signal.side === 'long' ? 'LONG' : 'SHORT';

  // Отправляем начальное сообщение
  const startMsg = await ctx.reply(
    `${sideEmoji} *Сигнал: ${sideText} ${signal.symbol}*\n\n` +
    `📊 Пара: ${signal.fullSymbol}\n` +
    `💵 Вход: $${signal.entryPrice}\n` +
    `🎯 TP: $${signal.takeProfit}\n\n` +
    `⏳ Обработка на ${accounts.length} аккаунтах...`,
    { parse_mode: 'Markdown' }
  );

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

    // Задержка между аккаунтами
    if (i > 0) {
      const delay = randomDelay(settings.delayMinMs, settings.delayMaxMs);
      await sleep(delay);
    }

    try {
      // Проверяем, нет ли уже позиции
      const hasPosition = await client.hasOpenPosition(signal.fullSymbol);
      if (hasPosition) {
        results.push({
          accountId: account.id,
          accountName: account.name,
          success: false,
          message: 'Уже в позиции',
        });
        continue;
      }

      // Отменяем старые ордера
      await client.cancelAllOrders(signal.fullSymbol);

      // Рассчитываем параметры
      let entryPrice = signal.entryPrice * (1 + settings.signalEntryOffset / 100);
      let takeProfit = signal.takeProfit * (1 + settings.signalTpOffset / 100);

      // Применяем отклонение для защиты от мультиаккаунтинга
      if (!account.isMaster) {
        entryPrice = applyPriceDeviation(
          entryPrice,
          settings.priceDeviationPercent,
          signal.side
        );
        takeProfit = applyPriceDeviation(
          takeProfit,
          settings.priceDeviationPercent,
          signal.side === 'long' ? 'short' : 'long'
        );
      }

      // Плечо
      const leverage = randomLeverage(account.leverageMin, account.leverageMax);

      // Объём
      let positionUsd = account.maxPositionUsd;
      
      // Применяем лимит контрактов если есть
      if (maxContracts > 0) {
        const maxUsd = maxContracts * contractSize * entryPrice;
        positionUsd = Math.min(positionUsd, maxUsd);
      }

      const volume = Math.max(1, Math.floor(positionUsd / (entryPrice * contractSize)));

      const orderStartTime = Date.now();
      const result = await client.openPosition({
        symbol: signal.fullSymbol,
        side: signal.side,
        price: roundToStep(entryPrice, priceStep),
        volume,
        leverage,
        takeProfit: roundToStep(takeProfit, priceStep),
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

      // Устанавливаем таймер отмены ордеров
      if (result.success) {
        const cancelDelay = randomDelay(
          settings.signalCancelTimeMin * 1000,
          settings.signalCancelTimeMax * 1000
        );

        setTimeout(async () => {
          try {
            const hasPos = await client.hasOpenPosition(signal.fullSymbol);
            if (!hasPos) {
              log(`[${account.name}]`, `Таймер: отменяем ордера ${signal.fullSymbol}`);
              await client.cancelAllOrders(signal.fullSymbol);
            }
          } catch (err) {
            logError(`[${account.name}]`, 'Ошибка в таймере отмены', err);
          }
        }, cancelDelay);
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

  // Формируем отчёт
  const totalTime = Date.now() - startTime;
  const successCount = results.filter(r => r.success).length;

  let reportText = `${sideEmoji} *${sideText} ${signal.symbol}*\n\n`;
  reportText += `⏱ Время: ${totalTime}ms\n`;
  reportText += `✅ Успешно: ${successCount}/${results.length}\n\n`;

  for (const r of results) {
    const emoji = r.success ? '✅' : '❌';
    reportText += `${emoji} *${r.accountName}*`;
    
    if (r.success) {
      reportText += ` | $${r.executedPrice?.toFixed(6)} | ${r.leverage}x | ${r.latencyMs}ms\n`;
    } else {
      reportText += ` | ${r.message}\n`;
    }
  }

  try {
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      startMsg.message_id,
      undefined,
      reportText,
      {
        parse_mode: 'Markdown',
        reply_markup: successCount > 0
          ? keyboards.positionOpenedKeyboard(signal.fullSymbol, signal.side).reply_markup
          : undefined,
      }
    );
  } catch {
    await ctx.reply(reportText, {
      parse_mode: 'Markdown',
      reply_markup: successCount > 0
        ? keyboards.positionOpenedKeyboard(signal.fullSymbol, signal.side).reply_markup
        : undefined,
    });
  }

  return true;
}

/**
 * Обрабатывает align-сигнал (закрытие позиции)
 */
export async function handleAlignSignal(ctx: Context, text: string): Promise<boolean> {
  const settings = configStorage.getSettings();
  
  if (!settings.signalsEnabled) {
    return false;
  }

  const align = parseAlignSignal(text);
  if (!align) return false;

  log('[Signals]', `Обнаружен align: ${align.fullSymbol}`);

  const accounts = configStorage.getEnabledAccounts();
  if (accounts.length === 0) {
    return true;
  }

  const priceStep = priceStepFromText(text);
  const messages: string[] = [];

  for (const account of accounts) {
    const client = clientManager.getClient(account.id);
    if (!client) continue;

    try {
      // Отменяем ордера
      await client.cancelAllOrders(align.fullSymbol);

      // Проверяем позицию
      const positions = await client.getOpenPositions(align.fullSymbol);
      const position = positions[0];

      if (!position) {
        messages.push(`${account.name}: нет позиции`);
        continue;
      }

      // Планируем закрытие через случайную задержку
      const delay = randomDelay(5000, 15000);
      messages.push(`${account.name}: закрытие через ${Math.round(delay / 1000)}с`);

      setTimeout(async () => {
        try {
          // Перепроверяем позицию
          const currentPositions = await client.getOpenPositions(align.fullSymbol);
          const currentPos = currentPositions[0];
          
          if (!currentPos) {
            log(`[${account.name}]`, `Align: позиция уже закрыта`);
            return;
          }

          // Цена закрытия с небольшим отклонением
          const deviation = Math.random() * 0.012;
          const closePrice = roundToStep(
            align.mexcPrice * (1 + deviation),
            priceStep
          );

          const result = await client.closePosition({
            symbol: align.fullSymbol,
            side: currentPos.side,
            price: closePrice,
            volume: currentPos.volume,
          });

          if (result.success) {
            log(`[${account.name}]`, `Align: закрыто по ${closePrice}`);
          } else {
            logError(`[${account.name}]`, `Align: ошибка ${result.message}`);
          }

        } catch (err) {
          logError(`[${account.name}]`, 'Ошибка в таймере align', err);
        }
      }, delay);

    } catch (err) {
      logError(`[${account.name}]`, 'Ошибка обработки align', err);
      messages.push(`${account.name}: ошибка`);
    }
  }

  await ctx.reply(
    `♻️ *Align: ${align.symbol}*\n\n` +
    `Price MEXC: $${align.mexcPrice}\n\n` +
    messages.join('\n'),
    {
      parse_mode: 'Markdown',
      disable_notification: true,
    }
  );

  return true;
}

/**
 * Обрабатывает текст как сигнал
 */
export async function processSignalText(ctx: Context, text: string): Promise<boolean> {
  // Сначала пробуем как торговый сигнал
  if (await handleTradeSignal(ctx, text)) {
    return true;
  }

  // Затем как align
  if (await handleAlignSignal(ctx, text)) {
    return true;
  }

  return false;
}
