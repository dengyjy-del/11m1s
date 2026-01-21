// src/telegram/handlers/trading.ts

import { Context } from 'telegraf';
import { configStorage } from '../../config/storage';
import { clientManager } from '../../mexc/client';
import { copyTradingEngine } from '../../mexc/copyTrader';
import { PendingTpSlContext, TradeResult } from '../../config/types';
import * as keyboards from '../keyboards';
import { 
  formatUsd, 
  formatPercent, 
  roundToStep, 
  priceStepFromString,
  isValidNumber 
} from '../../utils/helpers';
import { getSession, resetSession } from './accounts';

// Хранилище контекстов для TP/SL
const pendingTpSl: Map<number, PendingTpSlContext> = new Map();

/**
 * Обрабатывает команду открытия позиции
 * /s или /l TICKER PRICE POSITION_USD LEVERAGE
 * Пример: /s btc 95000 100 20
 */
export async function handleOpenPositionCommand(
  ctx: Context,
  side: 'long' | 'short',
  args: string[]
): Promise<void> {
  if (args.length < 4) {
    const cmd = side === 'short' ? '/s' : '/l';
    await ctx.reply(
      `❌ *Неверный формат команды*\n\n` +
      `Использование: \`${cmd} TICKER PRICE POSITION_USD LEVERAGE\`\n\n` +
      `Примеры:\n` +
      `• \`${cmd} btc 95000 100 20\` — ${side === 'short' ? 'шорт' : 'лонг'} BTC по $95000, позиция $100, плечо 20x\n` +
      `• \`${cmd} eth 3500 50 10\` — ${side === 'short' ? 'шорт' : 'лонг'} ETH по $3500, позиция $50, плечо 10x`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const ticker = args[0].toUpperCase();
  const priceStr = args[1];
  const positionUsdStr = args[2];
  const leverageStr = args[3];

  // Валидация
  if (!isValidNumber(priceStr)) {
    await ctx.reply('❌ Некорректная цена');
    return;
  }
  if (!isValidNumber(positionUsdStr)) {
    await ctx.reply('❌ Некорректный размер позиции');
    return;
  }
  if (!isValidNumber(leverageStr)) {
    await ctx.reply('❌ Некорректное плечо');
    return;
  }

  const price = parseFloat(priceStr);
  const positionUsd = parseFloat(positionUsdStr);
  const leverage = parseInt(leverageStr, 10);

  if (price <= 0 || positionUsd <= 0 || leverage < 1 || leverage > 200) {
    await ctx.reply('❌ Недопустимые значения параметров');
    return;
  }

  const symbol = `${ticker}_USDT`;
  const sideEmoji = side === 'long' ? '🟢' : '🔴';
  const sideText = side === 'long' ? 'LONG' : 'SHORT';

  // Отправляем уведомление о начале
  const startMsg = await ctx.reply(
    `${sideEmoji} *Открытие ${sideText}*\n\n` +
    `📊 Пара: ${symbol}\n` +
    `💵 Цена: $${price}\n` +
    `💰 Позиция: ${formatUsd(positionUsd)}\n` +
    `📈 Плечо: ${leverage}x\n` +
    `💸 Маржа: ${formatUsd(positionUsd / leverage)}\n\n` +
    `⏳ Открытие позиций на всех аккаунтах...`,
    { parse_mode: 'Markdown' }
  );

  // Определяем шаг цены
  const priceStep = priceStepFromString(priceStr);

  // Открываем позицию
  const result = await copyTradingEngine.manualOpenPosition({
    symbol,
    side,
    price,
    positionSizeUsd: positionUsd,
    leverage,
    priceStep,
  });

  // Формируем отчёт
  let reportText = `${sideEmoji} *${sideText} ${ticker}*\n\n`;
  reportText += `⏱ Время выполнения: ${result.totalLatencyMs}ms\n\n`;

  const successCount = result.slaveResults.filter(r => r.success).length;
  const failCount = result.slaveResults.length - successCount;

  reportText += `✅ Успешно: ${successCount}\n`;
  if (failCount > 0) {
    reportText += `❌ Ошибок: ${failCount}\n`;
  }
  reportText += '\n*Детали по аккаунтам:*\n';

  for (const r of result.slaveResults) {
    const emoji = r.success ? '✅' : '❌';
    reportText += `\n${emoji} *${r.accountName}*\n`;
    
    if (r.success) {
      reportText += `├ Цена: $${r.executedPrice?.toFixed(6) || '-'}\n`;
      reportText += `├ Объём: ${r.executedVolume || '-'}\n`;
      reportText += `├ Плечо: ${r.leverage}x\n`;
      reportText += `└ Latency: ${r.latencyMs}ms\n`;
    } else {
      reportText += `└ Ошибка: ${r.message}\n`;
    }
  }

  // Сохраняем контекст для TP/SL
  const userId = ctx.from?.id;
  if (userId && successCount > 0) {
    pendingTpSl.set(userId, {
      symbol,
      side,
      entryPrice: price,
      volume: result.slaveResults[0]?.executedVolume || 0,
      leverage,
      accountResults: result.slaveResults,
    });
  }

  // Редактируем сообщение с результатом
  try {
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      startMsg.message_id,
      undefined,
      reportText,
      {
        parse_mode: 'Markdown',
        reply_markup: successCount > 0 
          ? keyboards.positionOpenedKeyboard(symbol, side).reply_markup 
          : undefined,
      }
    );
  } catch (err) {
    // Если не удалось отредактировать, отправляем новое
    await ctx.reply(reportText, {
      parse_mode: 'Markdown',
      reply_markup: successCount > 0 
        ? keyboards.positionOpenedKeyboard(symbol, side).reply_markup 
        : undefined,
    });
  }
}

/**
 * Обрабатывает команду закрытия позиции
 * /cl TICKER [PRICE]
 */
export async function handleClosePositionCommand(ctx: Context, args: string[]): Promise<void> {
  if (args.length < 1) {
    await ctx.reply(
      '❌ *Неверный формат*\n\n' +
      'Использование: `/cl TICKER [PRICE]`\n\n' +
      'Примеры:\n' +
      '• `/cl btc` — закрыть BTC по рынку\n' +
      '• `/cl btc 96000` — закрыть BTC по цене $96000',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const ticker = args[0].toUpperCase();
  const price = args[1] ? parseFloat(args[1]) : undefined;
  const symbol = `${ticker}_USDT`;

  if (args[1] && (isNaN(price!) || price! <= 0)) {
    await ctx.reply('❌ Некорректная цена');
    return;
  }

  const startMsg = await ctx.reply(
    `❌ *Закрытие позиции*\n\n` +
    `📊 Пара: ${symbol}\n` +
    `💵 Цена: ${price ? `$${price}` : 'по рынку'}\n\n` +
    `⏳ Закрытие на всех аккаунтах...`,
    { parse_mode: 'Markdown' }
  );

  const results = await copyTradingEngine.manualClosePosition({
    symbol,
    price,
  });

  let reportText = `❌ *Закрытие ${ticker}*\n\n`;
  
  const successCount = results.filter(r => r.success).length;
  reportText += `✅ Закрыто: ${successCount}/${results.length}\n\n`;

  for (const r of results) {
    const emoji = r.success ? '✅' : '❌';
    reportText += `${emoji} ${r.accountName}: ${r.message}\n`;
  }

  try {
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      startMsg.message_id,
      undefined,
      reportText,
      { parse_mode: 'Markdown' }
    );
  } catch {
    await ctx.reply(reportText, { parse_mode: 'Markdown' });
  }
}

/**
 * Показывает меню установки TP/SL
 */
export async function showTpSlMenu(ctx: Context, symbol: string, side: string): Promise<void> {
  await ctx.editMessageText(
    `🎯 *Установка TP/SL*\n\n` +
    `📊 Пара: ${symbol}\n` +
    `📍 Сторона: ${side.toUpperCase()}\n\n` +
    `Выберите, что хотите установить:`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboards.tpSlSelectionKeyboard(symbol, side).reply_markup,
    }
  );
}

/**
 * Начинает ввод TP
 */
export async function startTpInput(ctx: Context, symbol: string, side: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const session = getSession(userId);
  session.state = 'waiting_tp_price';
  session.data = { symbol, side };

  await ctx.editMessageText(
    `🎯 *Установка Take Profit*\n\n` +
    `📊 Пара: ${symbol}\n` +
    `📍 Сторона: ${side.toUpperCase()}\n\n` +
    `Введите цену TP или "нет" чтобы пропустить:`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboards.cancelKeyboard(`set_tpsl_${symbol}_${side}`).reply_markup,
    }
  );
}

/**
 * Начинает ввод SL
 */
export async function startSlInput(ctx: Context, symbol: string, side: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const session = getSession(userId);
  session.state = 'waiting_sl_price';
  session.data = { symbol, side };

  await ctx.editMessageText(
    `🛑 *Установка Stop Loss*\n\n` +
    `📊 Пара: ${symbol}\n` +
    `📍 Сторона: ${side.toUpperCase()}\n\n` +
    `Введите цену SL или "нет" чтобы пропустить:`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboards.cancelKeyboard(`set_tpsl_${symbol}_${side}`).reply_markup,
    }
  );
}

/**
 * Начинает ввод обоих TP и SL
 */
export async function startBothTpSlInput(ctx: Context, symbol: string, side: string): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const session = getSession(userId);
  session.state = 'waiting_tp_price';
  session.data = { symbol, side, inputBoth: true };

  await ctx.editMessageText(
    `🎯 *Установка TP и SL*\n\n` +
    `📊 Пара: ${symbol}\n` +
    `📍 Сторона: ${side.toUpperCase()}\n\n` +
    `Сначала введите цену *Take Profit* или "нет":`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboards.cancelKeyboard(`set_tpsl_${symbol}_${side}`).reply_markup,
    }
  );
}

/**
 * Обрабатывает ввод цены TP/SL
 */
export async function handleTpSlInput(ctx: Context, text: string): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) return false;

  const session = getSession(userId);
  const { symbol, side, inputBoth, tp } = session.data;

  if (!symbol || !side) return false;

  const input = text.trim().toLowerCase();
  const isSkip = ['нет', 'no', '-', 'skip'].includes(input);

  if (session.state === 'waiting_tp_price') {
    if (!isSkip) {
      const price = parseFloat(text);
      if (isNaN(price) || price <= 0) {
        await ctx.reply('❌ Некорректная цена. Введите число или "нет":');
        return true;
      }
      session.data.tp = price;
    }

    if (inputBoth) {
      // Переходим к вводу SL
      session.state = 'waiting_sl_price';
      await ctx.reply(
        `Теперь введите цену *Stop Loss* или "нет":`,
        { parse_mode: 'Markdown' }
      );
      return true;
    } else {
      // Устанавливаем только TP
      return await applyTpSl(ctx, symbol, side as 'long' | 'short', session.data.tp, undefined);
    }
  }

  if (session.state === 'waiting_sl_price') {
    let sl: number | undefined;
    if (!isSkip) {
      sl = parseFloat(text);
      if (isNaN(sl) || sl <= 0) {
        await ctx.reply('❌ Некорректная цена. Введите число или "нет":');
        return true;
      }
    }

    return await applyTpSl(ctx, symbol, side as 'long' | 'short', tp, sl);
  }

  return false;
}

/**
 * Применяет TP/SL на все аккаунты
 */
async function applyTpSl(
  ctx: Context,
  symbol: string,
  side: 'long' | 'short',
  takeProfit?: number,
  stopLoss?: number
): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) return false;

  resetSession(userId);

  if (!takeProfit && !stopLoss) {
    await ctx.reply('⏭ TP/SL не установлены');
    return true;
  }

  const startMsg = await ctx.reply(
    `⏳ *Установка TP/SL*\n\n` +
    `📊 ${symbol}\n` +
    `${takeProfit ? `🎯 TP: $${takeProfit}\n` : ''}` +
    `${stopLoss ? `🛑 SL: $${stopLoss}\n` : ''}\n` +
    `Применяю на все аккаунты...`,
    { parse_mode: 'Markdown' }
  );

  const results = await copyTradingEngine.setTpSlOnAll({
    symbol,
    side,
    takeProfit,
    stopLoss,
  });

  let reportText = `✅ *TP/SL установлены*\n\n`;
  reportText += `📊 ${symbol}\n`;
  if (takeProfit) reportText += `🎯 TP: $${takeProfit}\n`;
  if (stopLoss) reportText += `🛑 SL: $${stopLoss}\n`;
  reportText += '\n';

  const successCount = results.filter(r => r.success).length;
  reportText += `Успешно: ${successCount}/${results.length}\n`;

  for (const r of results) {
    if (!r.success) {
      reportText += `❌ ${r.accountName}: ${r.message}\n`;
    }
  }

  try {
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      startMsg.message_id,
      undefined,
      reportText,
      { parse_mode: 'Markdown' }
    );
  } catch {
    await ctx.reply(reportText, { parse_mode: 'Markdown' });
  }

  return true;
}

/**
 * Показывает все позиции на всех аккаунтах
 */
export async function showAllPositions(ctx: Context): Promise<void> {
  const accounts = configStorage.getEnabledAccounts();
  
  if (accounts.length === 0) {
    await ctx.editMessageText(
      '📈 *Позиции*\n\nНет активных аккаунтов.',
      {
        parse_mode: 'Markdown',
        reply_markup: keyboards.backKeyboard('menu_main').reply_markup,
      }
    );
    return;
  }

  let text = '📈 *Открытые позиции*\n\n';
  const allPositions: Array<{ symbol: string; side: string }> = [];

  for (const acc of accounts) {
    const client = clientManager.getClient(acc.id);
    if (!client) continue;

    const positions = await client.getOpenPositions();
    
    if (positions.length > 0) {
      text += `*${acc.name}*${acc.isMaster ? ' 👑' : ''}\n`;
      
      for (const pos of positions) {
        const emoji = pos.side === 'long' ? '🟢' : '🔴';
        const pnlEmoji = pos.unrealizedPnl >= 0 ? '+' : '';
        
        text += `${emoji} ${pos.symbol}: ${formatUsd(pos.unrealizedPnl >= 0 ? pos.unrealizedPnl : -pos.unrealizedPnl)} (${pnlEmoji}${formatPercent(pos.unrealizedPnl / pos.margin * 100)})\n`;
        
        // Добавляем в общий список для клавиатуры
        if (!allPositions.find(p => p.symbol === pos.symbol && p.side === pos.side)) {
          allPositions.push({ symbol: pos.symbol, side: pos.side });
        }
      }
      text += '\n';
    }
  }

  if (allPositions.length === 0) {
    text += '_Нет открытых позиций_';
  }

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: allPositions.length > 0
      ? keyboards.positionsListKeyboard(allPositions).reply_markup
      : keyboards.backKeyboard('menu_main').reply_markup,
  });
}

/**
 * Закрывает позицию через callback
 */
export async function handleClosePositionCallback(ctx: Context, symbol: string): Promise<void> {
  await ctx.answerCbQuery('Закрытие позиции...');

  const results = await copyTradingEngine.manualClosePosition({ symbol });

  let text = `❌ *Закрытие ${symbol}*\n\n`;
  const successCount = results.filter(r => r.success).length;
  text += `Закрыто: ${successCount}/${results.length}\n\n`;

  for (const r of results) {
    const emoji = r.success ? '✅' : '❌';
    text += `${emoji} ${r.accountName}: ${r.message}\n`;
  }

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboards.backKeyboard('menu_positions').reply_markup,
  });
}

/**
 * Закрывает все позиции
 */
export async function closeAllPositions(ctx: Context): Promise<void> {
  await ctx.answerCbQuery('Закрытие всех позиций...');

  const accounts = configStorage.getEnabledAccounts();
  let totalClosed = 0;
  let totalErrors = 0;

  for (const acc of accounts) {
    const client = clientManager.getClient(acc.id);
    if (!client) continue;

    const positions = await client.getOpenPositions();
    
    for (const pos of positions) {
      const currentPrice = await client.getCurrentPrice(pos.symbol);
      if (!currentPrice) continue;

      const result = await client.closePosition({
        symbol: pos.symbol,
        side: pos.side,
        price: currentPrice,
        volume: pos.volume,
      });

      if (result.success) {
        totalClosed++;
      } else {
        totalErrors++;
      }
    }
  }

  await ctx.editMessageText(
    `❌ *Все позиции закрыты*\n\n` +
    `✅ Закрыто: ${totalClosed}\n` +
    `❌ Ошибок: ${totalErrors}`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboards.backKeyboard('menu_main').reply_markup,
    }
  );
}

/**
 * Показывает все ордера
 */
export async function showAllOrders(ctx: Context): Promise<void> {
  const accounts = configStorage.getEnabledAccounts();
  
  let text = '📋 *Открытые ордера*\n\n';
  let hasOrders = false;

  for (const acc of accounts) {
    const client = clientManager.getClient(acc.id);
    if (!client) continue;

    const orders = await client.getOpenOrders();
    
    if (orders.length > 0) {
      hasOrders = true;
      text += `*${acc.name}*${acc.isMaster ? ' 👑' : ''}\n`;
      
      for (const ord of orders.slice(0, 5)) { // Показываем максимум 5 ордеров
        const sideText = ord.side === 1 || ord.side === 3 ? 'открытие' : 'закрытие';
        const dirText = ord.side === 1 || ord.side === 4 ? 'LONG' : 'SHORT';
        
        text += `• ${ord.symbol}: ${dirText} ${sideText} @ $${ord.price}\n`;
      }
      
      if (orders.length > 5) {
        text += `_...и ещё ${orders.length - 5} ордеров_\n`;
      }
      text += '\n';
    }
  }

  if (!hasOrders) {
    text += '_Нет открытых ордеров_';
  }

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboards.backKeyboard('menu_main').reply_markup,
  });
}
