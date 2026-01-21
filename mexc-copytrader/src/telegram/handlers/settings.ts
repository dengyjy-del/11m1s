// src/telegram/handlers/settings.ts

import { Context } from 'telegraf';
import { configStorage } from '../../config/storage';
import { CopyTradingSettings } from '../../config/types';
import * as keyboards from '../keyboards';
import { getSession, resetSession } from './accounts';
import { isValidNumber } from '../../utils/helpers';

/**
 * Показывает меню настроек
 */
export async function showSettingsMenu(ctx: Context): Promise<void> {
  const settings = configStorage.getSettings();

  let text = '⚙️ *Настройки системы*\n\n';
  
  text += '*Защита от мультиаккаунтинга:*\n';
  text += `├ ⏱ Задержка: ${settings.delayMinMs}-${settings.delayMaxMs} мс\n`;
  text += `├ 📊 Отклонение цены: ±${settings.priceDeviationPercent}%\n`;
  text += `└ 📈 Разброс плеча: до -${settings.leverageSpread}\n\n`;
  
  text += '*Режимы копирования:*\n';
  text += `├ ${settings.copyOpenPositions ? '✅' : '❌'} Открытие позиций\n`;
  text += `├ ${settings.copyClosePositions ? '✅' : '❌'} Закрытие позиций\n`;
  text += `├ ${settings.copyTpSl ? '✅' : '❌'} TP/SL\n`;
  text += `└ ${settings.signalsEnabled ? '✅' : '❌'} Обработка сигналов\n`;

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboards.settingsMenuKeyboard().reply_markup,
  });
}

/**
 * Показывает настройки задержек
 */
export async function showDelaysSettings(ctx: Context): Promise<void> {
  const settings = configStorage.getSettings();
  const userId = ctx.from?.id;
  if (!userId) return;

  const session = getSession(userId);
  session.state = 'waiting_setting_value';
  session.data = { settingType: 'delays' };

  await ctx.editMessageText(
    '⏱ *Настройка задержек*\n\n' +
    `Текущие значения:\n` +
    `├ Минимум: ${settings.delayMinMs} мс\n` +
    `└ Максимум: ${settings.delayMaxMs} мс\n\n` +
    '*Для чего это нужно:*\n' +
    'Задержка добавляется перед выполнением операций на slave-аккаунтах.\n' +
    'Случайное значение из диапазона выбирается для каждого аккаунта.\n' +
    'Это помогает избежать подозрений на мультиаккаунтинг.\n\n' +
    '📝 *Введите новые значения в формате:*\n' +
    '`МИН МАКС` (в миллисекундах)\n\n' +
    '_Например: `0 1000` или `200 800`_',
    {
      parse_mode: 'Markdown',
      reply_markup: keyboards.cancelKeyboard('menu_settings').reply_markup,
    }
  );
}

/**
 * Показывает настройки отклонения цены
 */
export async function showPriceDeviationSettings(ctx: Context): Promise<void> {
  const settings = configStorage.getSettings();
  const userId = ctx.from?.id;
  if (!userId) return;

  const session = getSession(userId);
  session.state = 'waiting_setting_value';
  session.data = { settingType: 'price_deviation' };

  await ctx.editMessageText(
    '📊 *Настройка отклонения цены*\n\n' +
    `Текущее значение: ±${settings.priceDeviationPercent}%\n\n` +
    '*Как это работает:*\n' +
    '• Для LONG: цена входа увеличивается от 0% до указанного %\n' +
    '• Для SHORT: цена входа уменьшается от 0% до указанного %\n\n' +
    'Это создаёт естественный разброс точек входа между аккаунтами.\n\n' +
    '📝 *Введите новое значение в процентах:*\n' +
    '_Например: `1` или `0.5` или `1.5`_',
    {
      parse_mode: 'Markdown',
      reply_markup: keyboards.cancelKeyboard('menu_settings').reply_markup,
    }
  );
}

/**
 * Показывает настройки разброса плеча
 */
export async function showLeverageSpreadSettings(ctx: Context): Promise<void> {
  const settings = configStorage.getSettings();
  const userId = ctx.from?.id;
  if (!userId) return;

  const session = getSession(userId);
  session.state = 'waiting_setting_value';
  session.data = { settingType: 'leverage_spread' };

  await ctx.editMessageText(
    '📈 *Настройка разброса плеча*\n\n' +
    `Текущее значение: до -${settings.leverageSpread}\n\n` +
    '*Как это работает:*\n' +
    'Если мастер-аккаунт использует плечо 20x,\n' +
    'а разброс = 10, то slave-аккаунты будут\n' +
    'использовать плечо от 10x до 20x.\n\n' +
    'Это означает одинаковый размер позиции\n' +
    'но разную маржу на разных аккаунтах.\n\n' +
    '📝 *Введите максимальное уменьшение плеча:*\n' +
    '_Например: `10` или `5` или `15`_',
    {
      parse_mode: 'Markdown',
      reply_markup: keyboards.cancelKeyboard('menu_settings').reply_markup,
    }
  );
}

/**
 * Показывает настройки режимов копирования
 */
export async function showCopyModes(ctx: Context): Promise<void> {
  const settings = configStorage.getSettings();

  await ctx.editMessageText(
    '🔄 *Режимы копирования*\n\n' +
    '*Выберите, какие действия копировать:*\n\n' +
    '• *Копировать открытие* — автоматически открывать позиции на slave-аккаунтах когда мастер открывает позицию\n\n' +
    '• *Копировать закрытие* — автоматически закрывать позиции когда мастер закрывает\n\n' +
    '• *Копировать TP/SL* — копировать установку Take Profit и Stop Loss\n\n' +
    '• *Обработка сигналов* — реагировать на пересылаемые торговые сигналы',
    {
      parse_mode: 'Markdown',
      reply_markup: keyboards.copyModesKeyboard(settings).reply_markup,
    }
  );
}

/**
 * Переключает режим копирования
 */
export async function toggleCopyMode(
  ctx: Context,
  mode: 'copyOpenPositions' | 'copyClosePositions' | 'copyTpSl' | 'signalsEnabled'
): Promise<void> {
  const settings = configStorage.getSettings();
  const newValue = !settings[mode];
  
  configStorage.updateSettings({ [mode]: newValue });
  
  const modeNames: Record<string, string> = {
    copyOpenPositions: 'Копирование открытия',
    copyClosePositions: 'Копирование закрытия',
    copyTpSl: 'Копирование TP/SL',
    signalsEnabled: 'Обработка сигналов',
  };

  await ctx.answerCbQuery(`${modeNames[mode]}: ${newValue ? 'включено' : 'отключено'}`);
  await showCopyModes(ctx);
}

/**
 * Показывает настройки сигналов
 */
export async function showSignalsSettings(ctx: Context): Promise<void> {
  const settings = configStorage.getSettings();
  const userId = ctx.from?.id;
  if (!userId) return;

  const session = getSession(userId);
  session.state = 'waiting_setting_value';
  session.data = { settingType: 'signals' };

  await ctx.editMessageText(
    '📨 *Настройки обработки сигналов*\n\n' +
    `*Текущие значения:*\n` +
    `├ Смещение входа: ${settings.signalEntryOffset}%\n` +
    `├ Смещение TP: ${settings.signalTpOffset}%\n` +
    `├ Мин. время отмены: ${settings.signalCancelTimeMin} сек\n` +
    `└ Макс. время отмены: ${settings.signalCancelTimeMax} сек\n\n` +
    '*Описание:*\n' +
    '• *Смещение входа* — корректировка цены входа относительно сигнала\n' +
    '• *Смещение TP* — корректировка Take Profit\n' +
    '• *Время отмены* — через сколько отменять неисполненные ордера\n\n' +
    '📝 *Введите новые значения в формате:*\n' +
    '`ENTRY_OFFSET TP_OFFSET CANCEL_MIN CANCEL_MAX`\n\n' +
    '_Например: `-0.5 1.0 60 180`_',
    {
      parse_mode: 'Markdown',
      reply_markup: keyboards.cancelKeyboard('menu_settings').reply_markup,
    }
  );
}

/**
 * Обрабатывает ввод настроек
 */
export async function handleSettingsInput(ctx: Context, text: string): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) return false;

  const session = getSession(userId);
  
  if (session.state !== 'waiting_setting_value') return false;

  const { settingType } = session.data;

  switch (settingType) {
    case 'delays':
      return await handleDelaysInput(ctx, text);
    
    case 'price_deviation':
      return await handlePriceDeviationInput(ctx, text);
    
    case 'leverage_spread':
      return await handleLeverageSpreadInput(ctx, text);
    
    case 'signals':
      return await handleSignalsInput(ctx, text);
    
    default:
      return false;
  }
}

async function handleDelaysInput(ctx: Context, text: string): Promise<boolean> {
  const parts = text.trim().split(/\s+/);
  
  if (parts.length !== 2) {
    await ctx.reply('❌ Введите два числа: минимум и максимум');
    return true;
  }

  const min = parseInt(parts[0], 10);
  const max = parseInt(parts[1], 10);

  if (isNaN(min) || isNaN(max) || min < 0 || max < min || max > 10000) {
    await ctx.reply('❌ Некорректные значения. Мин >= 0, Макс >= Мин, Макс <= 10000');
    return true;
  }

  configStorage.updateSettings({
    delayMinMs: min,
    delayMaxMs: max,
  });

  resetSession(ctx.from!.id);

  await ctx.reply(
    `✅ *Задержки обновлены*\n\n` +
    `├ Минимум: ${min} мс\n` +
    `└ Максимум: ${max} мс`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboards.backKeyboard('menu_settings').reply_markup,
    }
  );

  return true;
}

async function handlePriceDeviationInput(ctx: Context, text: string): Promise<boolean> {
  const value = parseFloat(text.trim());

  if (isNaN(value) || value < 0 || value > 10) {
    await ctx.reply('❌ Введите число от 0 до 10');
    return true;
  }

  configStorage.updateSettings({
    priceDeviationPercent: value,
  });

  resetSession(ctx.from!.id);

  await ctx.reply(
    `✅ *Отклонение цены обновлено*\n\n` +
    `Новое значение: ±${value}%`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboards.backKeyboard('menu_settings').reply_markup,
    }
  );

  return true;
}

async function handleLeverageSpreadInput(ctx: Context, text: string): Promise<boolean> {
  const value = parseInt(text.trim(), 10);

  if (isNaN(value) || value < 0 || value > 100) {
    await ctx.reply('❌ Введите число от 0 до 100');
    return true;
  }

  configStorage.updateSettings({
    leverageSpread: value,
  });

  resetSession(ctx.from!.id);

  await ctx.reply(
    `✅ *Разброс плеча обновлён*\n\n` +
    `Новое значение: до -${value}`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboards.backKeyboard('menu_settings').reply_markup,
    }
  );

  return true;
}

async function handleSignalsInput(ctx: Context, text: string): Promise<boolean> {
  const parts = text.trim().split(/\s+/);
  
  if (parts.length !== 4) {
    await ctx.reply('❌ Введите 4 числа: ENTRY_OFFSET TP_OFFSET CANCEL_MIN CANCEL_MAX');
    return true;
  }

  const entryOffset = parseFloat(parts[0]);
  const tpOffset = parseFloat(parts[1]);
  const cancelMin = parseInt(parts[2], 10);
  const cancelMax = parseInt(parts[3], 10);

  if (
    isNaN(entryOffset) || isNaN(tpOffset) || 
    isNaN(cancelMin) || isNaN(cancelMax) ||
    cancelMin < 0 || cancelMax < cancelMin
  ) {
    await ctx.reply('❌ Некорректные значения');
    return true;
  }

  configStorage.updateSettings({
    signalEntryOffset: entryOffset,
    signalTpOffset: tpOffset,
    signalCancelTimeMin: cancelMin,
    signalCancelTimeMax: cancelMax,
  });

  resetSession(ctx.from!.id);

  await ctx.reply(
    `✅ *Настройки сигналов обновлены*\n\n` +
    `├ Смещение входа: ${entryOffset}%\n` +
    `├ Смещение TP: ${tpOffset}%\n` +
    `├ Мин. время отмены: ${cancelMin} сек\n` +
    `└ Макс. время отмены: ${cancelMax} сек`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboards.backKeyboard('menu_settings').reply_markup,
    }
  );

  return true;
}
