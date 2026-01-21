// src/telegram/handlers/accounts.ts

import { Context } from 'telegraf';
import { configStorage } from '../../config/storage';
import { clientManager } from '../../mexc/client';
import { AccountConfig, UserSession } from '../../config/types';
import * as keyboards from '../keyboards';
import { formatUsd, isValidAuthToken, isValidProxyUrl } from '../../utils/helpers';

// Хранилище сессий пользователей
const sessions: Map<number, UserSession> = new Map();

/**
 * Получает или создаёт сессию пользователя
 */
export function getSession(userId: number): UserSession {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      state: 'idle',
      data: {},
      lastActivity: Date.now(),
    });
  }
  const session = sessions.get(userId)!;
  session.lastActivity = Date.now();
  return session;
}

/**
 * Сбрасывает сессию
 */
export function resetSession(userId: number): void {
  sessions.set(userId, {
    state: 'idle',
    data: {},
    lastActivity: Date.now(),
  });
}

/**
 * Показывает список аккаунтов
 */
export async function showAccountsList(ctx: Context): Promise<void> {
  const accounts = configStorage.getAccounts();
  
  let text = '👥 *Управление аккаунтами*\n\n';
  
  if (accounts.length === 0) {
    text += '_Аккаунты не добавлены_\n\n';
    text += 'Нажмите "➕ Добавить аккаунт" чтобы начать.';
  } else {
    text += `Всего аккаунтов: ${accounts.length}\n`;
    text += `Активных: ${accounts.filter(a => a.enabled).length}\n\n`;
    
    text += '*Обозначения:*\n';
    text += '✅ — включен, ❌ — отключен\n';
    text += '👑 — главный (мастер) аккаунт';
  }

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboards.accountsMenuKeyboard(accounts).reply_markup,
  });
}

/**
 * Показывает детали аккаунта
 */
export async function showAccountDetails(ctx: Context, accountId: string): Promise<void> {
  const account = configStorage.getAccountById(accountId);
  
  if (!account) {
    await ctx.answerCbQuery('Аккаунт не найден');
    return;
  }

  const status = account.enabled ? '✅ Включен' : '❌ Отключен';
  const master = account.isMaster ? '👑 Главный аккаунт' : '📋 Обычный аккаунт';
  const proxy = account.proxyUrl ? `🌐 ${account.proxyUrl.substring(0, 30)}...` : '🌐 Без прокси';

  let text = `*${account.name}*\n\n`;
  text += `${status}\n`;
  text += `${master}\n`;
  text += `${proxy}\n\n`;
  text += `💵 Макс. позиция: ${formatUsd(account.maxPositionUsd)}\n`;
  text += `📊 Плечо: ${account.leverageMin}x - ${account.leverageMax}x\n`;
  text += `🔑 Токен: \`${account.authToken.substring(0, 20)}...\`\n`;

  if (account.lastBalance !== undefined) {
    text += `\n💰 Баланс: ${formatUsd(account.lastBalance)}`;
  }

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboards.accountViewKeyboard(account).reply_markup,
  });
}

/**
 * Начинает процесс добавления аккаунта
 */
export async function startAddAccount(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const session = getSession(userId);
  session.state = 'waiting_account_name';
  session.data = { newAccount: {} };

  await ctx.editMessageText(
    '*➕ Добавление нового аккаунта*\n\n' +
    'Шаг 1 из 5\n\n' +
    '📝 *Введите название аккаунта:*\n' +
    '_Например: "Основной", "Аккаунт 2", "Торговый"_',
    {
      parse_mode: 'Markdown',
      reply_markup: keyboards.cancelKeyboard('menu_accounts').reply_markup,
    }
  );
}

/**
 * Обрабатывает текстовый ввод для добавления/редактирования аккаунта
 */
export async function handleAccountInput(ctx: Context, text: string): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) return false;

  const session = getSession(userId);

  switch (session.state) {
    case 'waiting_account_name':
      return await handleAccountName(ctx, text, session);
    
    case 'waiting_auth_token':
      return await handleAuthToken(ctx, text, session);
    
    case 'waiting_proxy':
      return await handleProxy(ctx, text, session);
    
    case 'waiting_max_position':
      return await handleMaxPosition(ctx, text, session);
    
    case 'waiting_leverage_min':
      return await handleLeverageMin(ctx, text, session);
    
    case 'waiting_leverage_max':
      return await handleLeverageMax(ctx, text, session);

    default:
      return false;
  }
}

async function handleAccountName(ctx: Context, text: string, session: UserSession): Promise<boolean> {
  if (text.length < 1 || text.length > 50) {
    await ctx.reply('❌ Название должно быть от 1 до 50 символов. Попробуйте снова:');
    return true;
  }

  session.data.newAccount.name = text;
  session.state = 'waiting_auth_token';

  await ctx.reply(
    '*Шаг 2 из 5*\n\n' +
    '🔑 *Введите authToken от MEXC:*\n\n' +
    '_Токен начинается с "WEB" и содержит 64+ символов._\n' +
    '_Получить его можно из cookies MEXC после авторизации._',
    {
      parse_mode: 'Markdown',
      reply_markup: keyboards.cancelKeyboard('menu_accounts').reply_markup,
    }
  );

  return true;
}

async function handleAuthToken(ctx: Context, text: string, session: UserSession): Promise<boolean> {
  const token = text.trim();

  if (!isValidAuthToken(token)) {
    await ctx.reply(
      '❌ Некорректный токен.\n\n' +
      'Токен должен начинаться с "WEB" и содержать минимум 60 символов.\n' +
      'Попробуйте снова:'
    );
    return true;
  }

  session.data.newAccount.authToken = token;
  session.state = 'waiting_proxy';

  await ctx.reply(
    '*Шаг 3 из 5*\n\n' +
    '🌐 *Введите URL прокси (или "нет" если не нужен):*\n\n' +
    '_Формат: http://user:pass@ip:port_\n' +
    '_Или просто: http://ip:port_\n\n' +
    '⚠️ Рекомендуется использовать разные прокси для каждого аккаунта.',
    {
      parse_mode: 'Markdown',
      reply_markup: keyboards.cancelKeyboard('menu_accounts').reply_markup,
    }
  );

  return true;
}

async function handleProxy(ctx: Context, text: string, session: UserSession): Promise<boolean> {
  const input = text.trim().toLowerCase();

  if (input === 'нет' || input === 'no' || input === '-' || input === 'skip') {
    session.data.newAccount.proxyUrl = undefined;
  } else {
    if (!isValidProxyUrl(text.trim())) {
      await ctx.reply(
        '❌ Некорректный URL прокси.\n\n' +
        'Используйте формат: http://user:pass@ip:port\n' +
        'Или напишите "нет" чтобы пропустить:'
      );
      return true;
    }
    session.data.newAccount.proxyUrl = text.trim();
  }

  session.state = 'waiting_max_position';

  await ctx.reply(
    '*Шаг 4 из 5*\n\n' +
    '💵 *Введите максимальный размер позиции в USD:*\n\n' +
    '_Это лимит суммы одной позиции для этого аккаунта._\n' +
    '_Например: 100, 50, 200_',
    {
      parse_mode: 'Markdown',
      reply_markup: keyboards.cancelKeyboard('menu_accounts').reply_markup,
    }
  );

  return true;
}

async function handleMaxPosition(ctx: Context, text: string, session: UserSession): Promise<boolean> {
  const value = parseFloat(text.trim());

  if (isNaN(value) || value <= 0 || value > 100000) {
    await ctx.reply('❌ Введите число от 1 до 100000:');
    return true;
  }

  session.data.newAccount.maxPositionUsd = value;
  session.state = 'waiting_leverage_min';

  await ctx.reply(
    '*Шаг 5 из 5*\n\n' +
    '📊 *Введите минимальное плечо:*\n\n' +
    '_Это нижняя граница разброса плеча для защиты от мультиаккаунтинга._\n' +
    '_Например: 5, 10, 15_',
    {
      parse_mode: 'Markdown',
      reply_markup: keyboards.cancelKeyboard('menu_accounts').reply_markup,
    }
  );

  return true;
}

async function handleLeverageMin(ctx: Context, text: string, session: UserSession): Promise<boolean> {
  const value = parseInt(text.trim(), 10);

  if (isNaN(value) || value < 1 || value > 200) {
    await ctx.reply('❌ Введите число от 1 до 200:');
    return true;
  }

  session.data.newAccount.leverageMin = value;
  session.state = 'waiting_leverage_max';

  await ctx.reply(
    '📊 *Теперь введите максимальное плечо:*\n\n' +
    `_Должно быть >= ${value} (минимального)_`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboards.cancelKeyboard('menu_accounts').reply_markup,
    }
  );

  return true;
}

async function handleLeverageMax(ctx: Context, text: string, session: UserSession): Promise<boolean> {
  const value = parseInt(text.trim(), 10);
  const minLev = session.data.newAccount.leverageMin || 1;

  if (isNaN(value) || value < minLev || value > 200) {
    await ctx.reply(`❌ Введите число от ${minLev} до 200:`);
    return true;
  }

  session.data.newAccount.leverageMax = value;

  // Создаём аккаунт
  const newAccount = configStorage.addAccount({
    name: session.data.newAccount.name,
    authToken: session.data.newAccount.authToken,
    proxyUrl: session.data.newAccount.proxyUrl,
    enabled: true,
    isMaster: configStorage.getAccounts().length === 1, // Первый = мастер
    maxPositionUsd: session.data.newAccount.maxPositionUsd,
    leverageMin: session.data.newAccount.leverageMin,
    leverageMax: value,
  });

  // Инициализируем клиент
  clientManager.initClient(newAccount);

  resetSession(ctx.from!.id);

  await ctx.reply(
    '✅ *Аккаунт успешно добавлен!*\n\n' +
    `📝 Название: ${newAccount.name}\n` +
    `💵 Макс. позиция: ${formatUsd(newAccount.maxPositionUsd)}\n` +
    `📊 Плечо: ${newAccount.leverageMin}x - ${newAccount.leverageMax}x\n` +
    `${newAccount.isMaster ? '👑 Назначен главным аккаунтом' : ''}`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboards.accountViewKeyboard(newAccount).reply_markup,
    }
  );

  return true;
}

/**
 * Включает/выключает аккаунт
 */
export async function toggleAccountEnabled(ctx: Context, accountId: string, enabled: boolean): Promise<void> {
  const success = configStorage.toggleAccount(accountId, enabled);
  
  if (success) {
    await ctx.answerCbQuery(enabled ? '✅ Аккаунт включен' : '❌ Аккаунт отключен');
    await showAccountDetails(ctx, accountId);
  } else {
    await ctx.answerCbQuery('Ошибка');
  }
}

/**
 * Назначает аккаунт главным
 */
export async function setMasterAccount(ctx: Context, accountId: string): Promise<void> {
  const success = configStorage.setMasterAccount(accountId);
  
  if (success) {
    await ctx.answerCbQuery('👑 Аккаунт назначен главным');
    await showAccountDetails(ctx, accountId);
  } else {
    await ctx.answerCbQuery('Ошибка');
  }
}

/**
 * Показывает подтверждение удаления
 */
export async function showDeleteConfirmation(ctx: Context, accountId: string): Promise<void> {
  const account = configStorage.getAccountById(accountId);
  if (!account) {
    await ctx.answerCbQuery('Аккаунт не найден');
    return;
  }

  await ctx.editMessageText(
    `⚠️ *Удаление аккаунта*\n\n` +
    `Вы уверены, что хотите удалить аккаунт "${account.name}"?\n\n` +
    `_Это действие нельзя отменить._`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboards.confirmDeleteKeyboard(accountId).reply_markup,
    }
  );
}

/**
 * Удаляет аккаунт
 */
export async function deleteAccount(ctx: Context, accountId: string): Promise<void> {
  const account = configStorage.getAccountById(accountId);
  if (!account) {
    await ctx.answerCbQuery('Аккаунт не найден');
    return;
  }

  const name = account.name;
  clientManager.removeClient(accountId);
  configStorage.deleteAccount(accountId);

  await ctx.answerCbQuery('🗑 Аккаунт удалён');
  await ctx.editMessageText(
    `✅ Аккаунт "${name}" удалён.`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboards.backKeyboard('menu_accounts').reply_markup,
    }
  );
}

/**
 * Показывает баланс аккаунта
 */
export async function showAccountBalance(ctx: Context, accountId: string): Promise<void> {
  const account = configStorage.getAccountById(accountId);
  if (!account) {
    await ctx.answerCbQuery('Аккаунт не найден');
    return;
  }

  const client = clientManager.getClient(accountId);
  if (!client) {
    await ctx.answerCbQuery('Клиент не инициализирован');
    return;
  }

  await ctx.answerCbQuery('Загрузка баланса...');

  const balance = await client.getBalance();
  
  if (!balance) {
    await ctx.reply('❌ Не удалось получить баланс');
    return;
  }

  // Обновляем в конфиге
  configStorage.updateAccount(accountId, { lastBalance: balance.total });

  await ctx.reply(
    `💰 *Баланс: ${account.name}*\n\n` +
    `Всего: ${formatUsd(balance.total)}\n` +
    `Доступно: ${formatUsd(balance.available)}\n` +
    `Заморожено: ${formatUsd(balance.frozen)}`,
    { parse_mode: 'Markdown' }
  );
}

/**
 * Показывает позиции аккаунта
 */
export async function showAccountPositions(ctx: Context, accountId: string): Promise<void> {
  const account = configStorage.getAccountById(accountId);
  if (!account) {
    await ctx.answerCbQuery('Аккаунт не найден');
    return;
  }

  const client = clientManager.getClient(accountId);
  if (!client) {
    await ctx.answerCbQuery('Клиент не инициализирован');
    return;
  }

  await ctx.answerCbQuery('Загрузка позиций...');

  const positions = await client.getOpenPositions();
  
  if (positions.length === 0) {
    await ctx.reply(`📈 *${account.name}*\n\nНет открытых позиций.`, {
      parse_mode: 'Markdown',
    });
    return;
  }

  let text = `📈 *Позиции: ${account.name}*\n\n`;
  
  for (const pos of positions) {
    const emoji = pos.side === 'long' ? '🟢' : '🔴';
    const pnlEmoji = pos.unrealizedPnl >= 0 ? '📈' : '📉';
    
    text += `${emoji} *${pos.symbol}*\n`;
    text += `├ Сторона: ${pos.side.toUpperCase()}\n`;
    text += `├ Объём: ${pos.volume}\n`;
    text += `├ Вход: $${pos.entryPrice}\n`;
    text += `├ Плечо: ${pos.leverage}x\n`;
    text += `└ ${pnlEmoji} PnL: ${formatUsd(pos.unrealizedPnl)}\n\n`;
  }

  await ctx.reply(text, { parse_mode: 'Markdown' });
}
