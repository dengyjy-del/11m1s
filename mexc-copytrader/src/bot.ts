// src/bot.ts
// Главный файл бота MEXC Copy Trader

import { Telegraf, Context, Markup } from 'telegraf';
import * as dotenv from 'dotenv';
import { configStorage } from './config/storage';
import { clientManager } from './mexc/client';
import {
  mainMenuKeyboard,
  accountsMenuKeyboard,
  settingsMenuKeyboard,
  helpKeyboard,
  backKeyboard,
} from './telegram/keyboards';
import {
  getSession,
  resetSession,
  showAccountsList,
  showAccountDetails,
  startAddAccount,
  handleAccountInput,
  toggleAccountEnabled,
  setMasterAccount,
  showDeleteConfirmation,
  deleteAccount,
  showAccountBalance,
  showAccountPositions,
} from './telegram/handlers/accounts';
import {
  handleOpenPositionCommand,
  handleClosePositionCommand,
  showTpSlMenu,
  startTpInput,
  startSlInput,
  startBothTpSlInput,
  handleTpSlInput,
  showAllPositions,
  handleClosePositionCallback,
  closeAllPositions,
  showAllOrders,
} from './telegram/handlers/trading';
import {
  showSettingsMenu,
  showDelaysSettings,
  showPriceDeviationSettings,
  showLeverageSpreadSettings,
  showCopyModes,
  toggleCopyMode,
  showSignalsSettings,
  handleSettingsInput,
} from './telegram/handlers/settings';
import {
  processSignalText,
} from './telegram/handlers/signals';

dotenv.config();

// ==============================
// ИНИЦИАЛИЗАЦИЯ
// ==============================

const config = configStorage.getConfig();

// Получаем токен из конфига или .env
const BOT_TOKEN = config.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN;
const AUTH_USER_ID = config.telegramUserId || parseInt(process.env.TELEGRAM_USER_ID || '0', 10);

if (!BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN не задан! Укажите в .env или config.json');
  process.exit(1);
}

if (!AUTH_USER_ID) {
  console.error('❌ TELEGRAM_USER_ID не задан! Укажите в .env или config.json');
  process.exit(1);
}

// Сохраняем в конфиг если были из .env
if (!config.telegramBotToken && process.env.TELEGRAM_BOT_TOKEN) {
  configStorage.setTelegramToken(process.env.TELEGRAM_BOT_TOKEN);
}
if (!config.telegramUserId && process.env.TELEGRAM_USER_ID) {
  configStorage.setTelegramUserId(parseInt(process.env.TELEGRAM_USER_ID, 10));
}

const bot = new Telegraf(BOT_TOKEN);

// ==============================
// MIDDLEWARE: ПРОВЕРКА АВТОРИЗАЦИИ
// ==============================

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (userId !== AUTH_USER_ID) {
    console.log(`⚠️ Неавторизованный доступ от user ${userId}`);
    return; // Игнорируем сообщения от других пользователей
  }
  await next();
});

// ==============================
// КОМАНДА /start
// ==============================

bot.start(async (ctx) => {
  const accounts = configStorage.getAccounts();
  const settings = configStorage.getSettings();
  
  let statusText = '📊 *MEXC Copy Trader*\n\n';
  
  if (accounts.length === 0) {
    statusText += '⚠️ Нет добавленных аккаунтов.\n';
    statusText += 'Нажмите "Аккаунты" → "Добавить аккаунт"\n\n';
  } else {
    const enabled = accounts.filter(a => a.enabled).length;
    const master = accounts.find(a => a.isMaster);
    statusText += `✅ Аккаунтов: ${enabled}/${accounts.length}\n`;
    if (master) {
      statusText += `👑 Мастер: ${master.name}\n`;
    }
    statusText += '\n';
  }
  
  statusText += '*Настройки:*\n';
  statusText += `• Задержки: ${settings.delayMinMs}-${settings.delayMaxMs} мс\n`;
  statusText += `• Отклонение цены: ±${settings.priceDeviationPercent}%\n`;
  statusText += `• Разброс плеча: 0-${settings.leverageSpread}\n`;
  statusText += `• Сигналы: ${settings.signalsEnabled ? '✅' : '❌'}\n`;
  
  statusText += '\n*Команды:*\n';
  statusText += '`/s TICKER PRICE USD LEV` - шорт\n';
  statusText += '`/l TICKER PRICE USD LEV` - лонг\n';
  statusText += '`/cl TICKER [PRICE]` - закрыть\n';
  
  await ctx.reply(statusText, {
    parse_mode: 'Markdown',
    ...mainMenuKeyboard(),
  });
});

// ==============================
// КОМАНДА /help
// ==============================

bot.command('help', async (ctx) => {
  await showHelpText(ctx);
});

async function showHelpText(ctx: Context) {
  const helpText = `
📖 *MEXC Copy Trader - Справка*

*Команды торговли:*
\`/s TICKER PRICE USD LEVERAGE\` - открыть шорт
\`/l TICKER PRICE USD LEVERAGE\` - открыть лонг
\`/cl TICKER [PRICE]\` - закрыть позицию

*Примеры:*
\`/s BTC 42000 100 20\` - шорт BTC по 42000$, на 100$, плечо 20x
\`/l ETH 2200 50 10\` - лонг ETH по 2200$, на 50$, плечо 10x
\`/cl BTC\` - закрыть BTC по рынку
\`/cl BTC 43000\` - закрыть BTC по 43000$

*Сигналы:*
Просто пересылайте сообщения с сигналами формата:
• DOUBLE LONG/SHORT #TICKER\\_USDT
• Price DEX $X.XX
• Price MEXC $X.XX

*Align-сигналы:*
✅ #TICKER выровнен - автоматически закрывает позицию

*Защита от мультиаккаунтинга:*
• Случайные задержки между аккаунтами
• Разные цены входа (LONG: выше, SHORT: ниже)
• Разное плечо (случайное в диапазоне)
• Один и тот же размер позиции = разная маржа

*Настройки в меню:*
• Задержки - мин/макс задержка между аккаунтами
• Отклонение цены - % разброса цены входа
• Разброс плеча - насколько плечо может отличаться
  `.trim();

  await ctx.reply(helpText, {
    parse_mode: 'Markdown',
    ...helpKeyboard(),
  });
}

// ==============================
// КОМАНДЫ ТОРГОВЛИ
// ==============================

// /s - открыть шорт
bot.command('s', async (ctx) => {
  const text = ctx.message.text.trim();
  const args = text.split(/\s+/).slice(1);
  
  if (args.length < 4) {
    await ctx.reply(
      '❌ Формат: `/s TICKER PRICE USD LEVERAGE`\n' +
      'Пример: `/s BTC 42000 100 20`',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  await handleOpenPositionCommand(ctx, 'short', args);
});

// /l - открыть лонг
bot.command('l', async (ctx) => {
  const text = ctx.message.text.trim();
  const args = text.split(/\s+/).slice(1);
  
  if (args.length < 4) {
    await ctx.reply(
      '❌ Формат: `/l TICKER PRICE USD LEVERAGE`\n' +
      'Пример: `/l ETH 2200 50 10`',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  await handleOpenPositionCommand(ctx, 'long', args);
});

// /cl - закрыть позицию
bot.command('cl', async (ctx) => {
  const text = ctx.message.text.trim();
  const args = text.split(/\s+/).slice(1);
  
  if (args.length < 1) {
    await ctx.reply(
      '❌ Формат: `/cl TICKER [PRICE]`\n' +
      'Пример: `/cl BTC` (по рынку) или `/cl BTC 43000` (лимитом)',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  await handleClosePositionCommand(ctx, args);
});

// ==============================
// CALLBACK QUERIES - ГЛАВНОЕ МЕНЮ
// ==============================

bot.action('menu_main', async (ctx) => {
  resetSession(ctx.from!.id);
  await ctx.editMessageText(
    '📊 *MEXC Copy Trader*\n\nВыберите действие:',
    {
      parse_mode: 'Markdown',
      ...mainMenuKeyboard(),
    }
  );
  await ctx.answerCbQuery();
});

bot.action('menu_accounts', async (ctx) => {
  await showAccountsList(ctx);
  await ctx.answerCbQuery();
});

bot.action('menu_settings', async (ctx) => {
  await showSettingsMenu(ctx);
  await ctx.answerCbQuery();
});

bot.action('menu_positions', async (ctx) => {
  await showAllPositions(ctx);
  await ctx.answerCbQuery();
});

bot.action('menu_orders', async (ctx) => {
  await showAllOrders(ctx);
  await ctx.answerCbQuery();
});

bot.action('menu_balance', async (ctx) => {
  await showAllBalances(ctx);
  await ctx.answerCbQuery();
});

bot.action('menu_stats', async (ctx) => {
  await ctx.editMessageText(
    '📊 *Статистика*\n\n🚧 Раздел в разработке',
    {
      parse_mode: 'Markdown',
      ...backKeyboard('menu_main'),
    }
  );
  await ctx.answerCbQuery();
});

bot.action('menu_help', async (ctx) => {
  await showHelpText(ctx);
  await ctx.answerCbQuery();
});

// ==============================
// CALLBACK QUERIES - АККАУНТЫ
// ==============================

bot.action('acc_add', async (ctx) => {
  await startAddAccount(ctx);
  await ctx.answerCbQuery();
});

// Просмотр аккаунта
bot.action(/^acc_view_(.+)$/, async (ctx) => {
  const accountId = ctx.match[1];
  await showAccountDetails(ctx, accountId);
  await ctx.answerCbQuery();
});

// Включить/отключить аккаунт
bot.action(/^acc_enable_(.+)$/, async (ctx) => {
  const accountId = ctx.match[1];
  await toggleAccountEnabled(ctx, accountId, true);
  await ctx.answerCbQuery('✅ Аккаунт включен');
});

bot.action(/^acc_disable_(.+)$/, async (ctx) => {
  const accountId = ctx.match[1];
  await toggleAccountEnabled(ctx, accountId, false);
  await ctx.answerCbQuery('❌ Аккаунт отключен');
});

// Сделать мастером
bot.action(/^acc_setmaster_(.+)$/, async (ctx) => {
  const accountId = ctx.match[1];
  await setMasterAccount(ctx, accountId);
  await ctx.answerCbQuery('👑 Назначен главным');
});

bot.action(/^acc_master_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery('Уже является главным');
});

// Удаление аккаунта
bot.action(/^acc_delete_(.+)$/, async (ctx) => {
  const accountId = ctx.match[1];
  await showDeleteConfirmation(ctx, accountId);
  await ctx.answerCbQuery();
});

bot.action(/^acc_confirm_delete_(.+)$/, async (ctx) => {
  const accountId = ctx.match[1];
  await deleteAccount(ctx, accountId);
  await ctx.answerCbQuery('🗑 Аккаунт удален');
});

// Баланс и позиции аккаунта
bot.action(/^acc_balance_(.+)$/, async (ctx) => {
  const accountId = ctx.match[1];
  await showAccountBalance(ctx, accountId);
  await ctx.answerCbQuery();
});

bot.action(/^acc_positions_(.+)$/, async (ctx) => {
  const accountId = ctx.match[1];
  await showAccountPositions(ctx, accountId);
  await ctx.answerCbQuery();
});

// Редактирование аккаунта (заглушки)
bot.action(/^acc_edit_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery('🚧 В разработке');
});

bot.action(/^acc_proxy_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery('🚧 В разработке');
});

// ==============================
// CALLBACK QUERIES - НАСТРОЙКИ
// ==============================

bot.action('settings_delays', async (ctx) => {
  await showDelaysSettings(ctx);
  await ctx.answerCbQuery();
});

bot.action('settings_price', async (ctx) => {
  await showPriceDeviationSettings(ctx);
  await ctx.answerCbQuery();
});

bot.action('settings_leverage', async (ctx) => {
  await showLeverageSpreadSettings(ctx);
  await ctx.answerCbQuery();
});

bot.action('settings_modes', async (ctx) => {
  await showCopyModes(ctx);
  await ctx.answerCbQuery();
});

bot.action('settings_signals', async (ctx) => {
  await showSignalsSettings(ctx);
  await ctx.answerCbQuery();
});

// Toggle режимов
bot.action('toggle_copy_open', async (ctx) => {
  await toggleCopyMode(ctx, 'copyOpenPositions');
  await ctx.answerCbQuery();
});

bot.action('toggle_copy_close', async (ctx) => {
  await toggleCopyMode(ctx, 'copyClosePositions');
  await ctx.answerCbQuery();
});

bot.action('toggle_copy_tpsl', async (ctx) => {
  await toggleCopyMode(ctx, 'copyTpSl');
  await ctx.answerCbQuery();
});

bot.action('toggle_signals', async (ctx) => {
  await toggleCopyMode(ctx, 'signalsEnabled');
  await ctx.answerCbQuery();
});

// Установка значений настроек
bot.action(/^set_delay_min_(.+)$/, async (ctx) => {
  const value = parseInt(ctx.match[1], 10);
  configStorage.updateSettings({ delayMinMs: value });
  await showDelaysSettings(ctx);
  await ctx.answerCbQuery(`✅ Мин. задержка: ${value}ms`);
});

bot.action(/^set_delay_max_(.+)$/, async (ctx) => {
  const value = parseInt(ctx.match[1], 10);
  configStorage.updateSettings({ delayMaxMs: value });
  await showDelaysSettings(ctx);
  await ctx.answerCbQuery(`✅ Макс. задержка: ${value}ms`);
});

bot.action(/^set_price_dev_(.+)$/, async (ctx) => {
  const value = parseFloat(ctx.match[1]);
  configStorage.updateSettings({ priceDeviationPercent: value });
  await showPriceDeviationSettings(ctx);
  await ctx.answerCbQuery(`✅ Отклонение: ${value}%`);
});

bot.action(/^set_lev_spread_(.+)$/, async (ctx) => {
  const value = parseInt(ctx.match[1], 10);
  configStorage.updateSettings({ leverageSpread: value });
  await showLeverageSpreadSettings(ctx);
  await ctx.answerCbQuery(`✅ Разброс плеча: ${value}`);
});

// ==============================
// CALLBACK QUERIES - ТОРГОВЛЯ
// ==============================

// TP/SL меню
bot.action(/^set_tpsl_(.+)_(.+)$/, async (ctx) => {
  const symbol = ctx.match[1];
  const side = ctx.match[2];
  await showTpSlMenu(ctx, symbol, side);
  await ctx.answerCbQuery();
});

bot.action(/^input_tp_(.+)_(.+)$/, async (ctx) => {
  const symbol = ctx.match[1];
  const side = ctx.match[2];
  await startTpInput(ctx, symbol, side);
  await ctx.answerCbQuery();
});

bot.action(/^input_sl_(.+)_(.+)$/, async (ctx) => {
  const symbol = ctx.match[1];
  const side = ctx.match[2];
  await startSlInput(ctx, symbol, side);
  await ctx.answerCbQuery();
});

bot.action(/^input_both_(.+)_(.+)$/, async (ctx) => {
  const symbol = ctx.match[1];
  const side = ctx.match[2];
  await startBothTpSlInput(ctx, symbol, side);
  await ctx.answerCbQuery();
});

// Закрытие позиций
bot.action(/^close_pos_(.+)$/, async (ctx) => {
  const symbol = ctx.match[1];
  await handleClosePositionCallback(ctx, symbol);
  await ctx.answerCbQuery();
});

bot.action('close_all_positions', async (ctx) => {
  await closeAllPositions(ctx);
  await ctx.answerCbQuery();
});

// Управление позицией
bot.action(/^pos_manage_(.+)_(.+)$/, async (ctx) => {
  const symbol = ctx.match[1];
  const side = ctx.match[2];
  await showTpSlMenu(ctx, symbol, side);
  await ctx.answerCbQuery();
});

// ==============================
// CALLBACK QUERIES - ПОМОЩЬ
// ==============================

bot.action('help_commands', async (ctx) => {
  const text = `
📖 *Команды*

*Открытие позиций:*
\`/s TICKER PRICE USD LEVERAGE\`
Открыть шорт позицию

\`/l TICKER PRICE USD LEVERAGE\`
Открыть лонг позицию

*Закрытие позиций:*
\`/cl TICKER\`
Закрыть по рынку

\`/cl TICKER PRICE\`
Закрыть лимитным ордером

*Параметры:*
• TICKER - символ монеты (BTC, ETH, и т.д.)
• PRICE - цена входа/выхода
• USD - размер позиции в долларах
• LEVERAGE - плечо (1-125)
  `.trim();

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...helpKeyboard(),
  });
  await ctx.answerCbQuery();
});

bot.action('help_setup', async (ctx) => {
  const text = `
🔧 *Настройка бота*

*1. Добавьте аккаунты:*
• Меню → Аккаунты → Добавить
• Введите имя, authToken, прокси (опционально)
• Установите лимиты позиции и плеча

*2. Настройте защиту:*
• Задержки между аккаунтами
• Отклонение цены входа
• Разброс плеча

*3. Получите authToken:*
• Откройте MEXC Futures в браузере
• DevTools (F12) → Application → Cookies
• Скопируйте значение \`u_token\`

*4. Прокси (опционально):*
Формат: \`http://user:pass@ip:port\`
Рекомендуется для каждого аккаунта
  `.trim();

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...helpKeyboard(),
  });
  await ctx.answerCbQuery();
});

bot.action('help_examples', async (ctx) => {
  const text = `
💡 *Примеры использования*

*Открыть шорт BTC:*
\`/s BTC 42000 100 20\`
Шорт на $100, цена 42000, плечо 20x

*Открыть лонг ETH:*
\`/l ETH 2200 50 10\`
Лонг на $50, цена 2200, плечо 10x

*Закрыть позицию:*
\`/cl BTC\` - по рынку
\`/cl BTC 43000\` - лимитом по 43000

*Сигналы (пересылка):*
Просто перешлите сообщение с:
- #TICKER\\_USDT
- Price DEX $X.XX
- Price MEXC $X.XX
- DOUBLE LONG/SHORT

Бот автоматически откроет позиции
на всех аккаунтах с защитой
  `.trim();

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...helpKeyboard(),
  });
  await ctx.answerCbQuery();
});

// ==============================
// ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ
// ==============================

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  const userId = ctx.from.id;
  
  // Пропускаем команды
  if (text.startsWith('/')) return;
  
  const session = getSession(userId);
  
  // Проверяем, ждём ли ввода для аккаунта
  if (session.state.startsWith('waiting_')) {
    const handled = await handleAccountInput(ctx, text);
    if (handled) return;
    
    // Проверяем ввод настроек
    const settingsHandled = await handleSettingsInput(ctx, text);
    if (settingsHandled) return;
    
    // Проверяем ввод TP/SL
    const tpslHandled = await handleTpSlInput(ctx, text);
    if (tpslHandled) return;
  }
  
  // Проверяем, включена ли обработка сигналов
  const settings = configStorage.getSettings();
  if (settings.signalsEnabled) {
    const signalHandled = await processSignalText(ctx, text);
    if (signalHandled) return;
  }
  
  // Неизвестное сообщение - игнорируем или показываем меню
  // await ctx.reply('Используйте команды или меню', mainMenuKeyboard());
});

// ==============================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ==============================

async function showAllBalances(ctx: Context) {
  const accounts = configStorage.getEnabledAccounts();
  
  if (accounts.length === 0) {
    await ctx.editMessageText(
      '⚠️ Нет активных аккаунтов',
      { ...backKeyboard('menu_main') }
    );
    return;
  }
  
  let text = '💰 *Баланс аккаунтов*\n\n';
  
  for (const acc of accounts) {
    const client = clientManager.getClient(acc.id);
    if (!client) {
      text += `❌ ${acc.name}: не инициализирован\n`;
      continue;
    }
    
    const balance = await client.getBalance();
    if (!balance) {
      text += `❌ ${acc.name}: ошибка\n`;
      continue;
    }
    
    const masterMark = acc.isMaster ? ' 👑' : '';
    text += `${acc.name}${masterMark}:\n`;
    text += `  💵 Доступно: $${balance.available.toFixed(2)}\n`;
    text += `  🔒 Заморожено: $${balance.frozen.toFixed(2)}\n`;
    text += `  📊 Всего: $${balance.total.toFixed(2)}\n\n`;
  }
  
  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...backKeyboard('menu_main'),
  });
}

// ==============================
// ИНИЦИАЛИЗАЦИЯ КЛИЕНТОВ
// ==============================

function initializeClients() {
  const accounts = configStorage.getAccounts();
  
  if (accounts.length === 0) {
    console.log('⚠️ Нет аккаунтов для инициализации');
    return;
  }
  
  console.log(`🔄 Инициализация ${accounts.length} аккаунтов...`);
  
  for (const account of accounts) {
    if (!account.enabled) {
      console.log(`⏭ ${account.name}: отключен`);
      continue;
    }
    
    try {
      const client = clientManager.initClient(account);
      console.log(`✅ ${account.name}: инициализирован`);
      
      // Проверяем прокси в фоне
      client.checkProxyIp().catch(() => {});
    } catch (err) {
      console.error(`❌ ${account.name}: ошибка инициализации`, err);
    }
  }
  
  console.log(`✅ Инициализировано клиентов: ${clientManager.getAllClients().length}`);
}

// ==============================
// ИМПОРТ ИЗ СТАРОГО ФОРМАТА
// ==============================

function migrateFromOldFormat() {
  const mexcTokensRaw = process.env.MEXC_TOKENS;
  
  if (!mexcTokensRaw) return;
  
  const accounts = configStorage.getAccounts();
  if (accounts.length > 0) {
    console.log('ℹ️ Аккаунты уже существуют, пропускаем миграцию из MEXC_TOKENS');
    return;
  }
  
  console.log('🔄 Обнаружен MEXC_TOKENS, импортируем аккаунты...');
  
  const imported = configStorage.importFromEnvFormat(mexcTokensRaw);
  console.log(`✅ Импортировано аккаунтов: ${imported}`);
}

// ==============================
// ЗАПУСК БОТА
// ==============================

(async () => {
  try {
    // Миграция из старого формата (если есть)
    migrateFromOldFormat();
    
    // Инициализация клиентов MEXC
    initializeClients();
    
    // Запуск бота
    await bot.launch();
    console.log('✅ Бот запущен и слушает сообщения');
    console.log(`👤 Авторизован пользователь: ${AUTH_USER_ID}`);
    
  } catch (err) {
    console.error('❌ Ошибка запуска бота:', err);
    process.exit(1);
  }
})();

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('🛑 Получен SIGINT, останавливаем бота...');
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  console.log('🛑 Получен SIGTERM, останавливаем бота...');
  bot.stop('SIGTERM');
});
