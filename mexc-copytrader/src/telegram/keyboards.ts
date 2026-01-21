// src/telegram/keyboards.ts

import { Markup } from 'telegraf';
import { AccountConfig } from '../config/types';

/**
 * Главное меню бота
 */
export function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📊 Аккаунты', 'menu_accounts'),
      Markup.button.callback('⚙️ Настройки', 'menu_settings'),
    ],
    [
      Markup.button.callback('📈 Позиции', 'menu_positions'),
      Markup.button.callback('📋 Ордера', 'menu_orders'),
    ],
    [
      Markup.button.callback('💰 Баланс', 'menu_balance'),
      Markup.button.callback('📊 Статистика', 'menu_stats'),
    ],
    [
      Markup.button.callback('❓ Помощь', 'menu_help'),
    ],
  ]);
}

/**
 * Меню управления аккаунтами
 */
export function accountsMenuKeyboard(accounts: AccountConfig[]) {
  const buttons: any[][] = [];

  // Кнопки для каждого аккаунта
  for (const acc of accounts) {
    const status = acc.enabled ? '✅' : '❌';
    const master = acc.isMaster ? '👑' : '';
    buttons.push([
      Markup.button.callback(
        `${status}${master} ${acc.name}`,
        `acc_view_${acc.id}`
      ),
    ]);
  }

  // Кнопки управления
  buttons.push([
    Markup.button.callback('➕ Добавить аккаунт', 'acc_add'),
  ]);
  buttons.push([
    Markup.button.callback('🔙 Назад', 'menu_main'),
  ]);

  return Markup.inlineKeyboard(buttons);
}

/**
 * Меню конкретного аккаунта
 */
export function accountViewKeyboard(account: AccountConfig) {
  const enableBtn = account.enabled
    ? Markup.button.callback('❌ Отключить', `acc_disable_${account.id}`)
    : Markup.button.callback('✅ Включить', `acc_enable_${account.id}`);

  const masterBtn = account.isMaster
    ? Markup.button.callback('👑 Главный', `acc_master_${account.id}`)
    : Markup.button.callback('⭐ Сделать главным', `acc_setmaster_${account.id}`);

  return Markup.inlineKeyboard([
    [enableBtn, masterBtn],
    [
      Markup.button.callback('✏️ Редактировать', `acc_edit_${account.id}`),
      Markup.button.callback('🌐 Прокси', `acc_proxy_${account.id}`),
    ],
    [
      Markup.button.callback('💰 Баланс', `acc_balance_${account.id}`),
      Markup.button.callback('📈 Позиции', `acc_positions_${account.id}`),
    ],
    [
      Markup.button.callback('🗑 Удалить', `acc_delete_${account.id}`),
    ],
    [
      Markup.button.callback('🔙 К списку', 'menu_accounts'),
    ],
  ]);
}

/**
 * Подтверждение удаления аккаунта
 */
export function confirmDeleteKeyboard(accountId: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Да, удалить', `acc_confirm_delete_${accountId}`),
      Markup.button.callback('❌ Отмена', `acc_view_${accountId}`),
    ],
  ]);
}

/**
 * Меню редактирования аккаунта
 */
export function accountEditKeyboard(accountId: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📝 Имя', `acc_edit_name_${accountId}`),
      Markup.button.callback('🔑 Токен', `acc_edit_token_${accountId}`),
    ],
    [
      Markup.button.callback('💵 Макс. позиция', `acc_edit_maxpos_${accountId}`),
    ],
    [
      Markup.button.callback('📊 Мин. плечо', `acc_edit_levmin_${accountId}`),
      Markup.button.callback('📊 Макс. плечо', `acc_edit_levmax_${accountId}`),
    ],
    [
      Markup.button.callback('🔙 Назад', `acc_view_${accountId}`),
    ],
  ]);
}

/**
 * Меню настроек
 */
export function settingsMenuKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('⏱ Задержки', 'settings_delays'),
      Markup.button.callback('📊 Отклонение цены', 'settings_price'),
    ],
    [
      Markup.button.callback('📈 Разброс плеча', 'settings_leverage'),
    ],
    [
      Markup.button.callback('🔄 Режимы копирования', 'settings_modes'),
    ],
    [
      Markup.button.callback('📨 Настройки сигналов', 'settings_signals'),
    ],
    [
      Markup.button.callback('🔙 Назад', 'menu_main'),
    ],
  ]);
}

/**
 * Меню режимов копирования
 */
export function copyModesKeyboard(settings: {
  copyOpenPositions: boolean;
  copyClosePositions: boolean;
  copyTpSl: boolean;
  signalsEnabled: boolean;
}) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        `${settings.copyOpenPositions ? '✅' : '❌'} Копировать открытие`,
        'toggle_copy_open'
      ),
    ],
    [
      Markup.button.callback(
        `${settings.copyClosePositions ? '✅' : '❌'} Копировать закрытие`,
        'toggle_copy_close'
      ),
    ],
    [
      Markup.button.callback(
        `${settings.copyTpSl ? '✅' : '❌'} Копировать TP/SL`,
        'toggle_copy_tpsl'
      ),
    ],
    [
      Markup.button.callback(
        `${settings.signalsEnabled ? '✅' : '❌'} Обработка сигналов`,
        'toggle_signals'
      ),
    ],
    [
      Markup.button.callback('🔙 Назад', 'menu_settings'),
    ],
  ]);
}

/**
 * Клавиатура после открытия позиции
 */
export function positionOpenedKeyboard(symbol: string, side: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🎯 Задать TP и SL', `set_tpsl_${symbol}_${side}`),
    ],
    [
      Markup.button.callback('❌ Закрыть позицию', `close_pos_${symbol}`),
    ],
    [
      Markup.button.callback('📋 Детали', `pos_details_${symbol}`),
    ],
  ]);
}

/**
 * Клавиатура выбора TP/SL
 */
export function tpSlSelectionKeyboard(symbol: string, side: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🎯 Установить TP', `input_tp_${symbol}_${side}`),
    ],
    [
      Markup.button.callback('🛑 Установить SL', `input_sl_${symbol}_${side}`),
    ],
    [
      Markup.button.callback('✅ Установить оба', `input_both_${symbol}_${side}`),
    ],
    [
      Markup.button.callback('⏭ Пропустить', 'menu_main'),
    ],
  ]);
}

/**
 * Клавиатура подтверждения
 */
export function confirmKeyboard(confirmAction: string, cancelAction: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Подтвердить', confirmAction),
      Markup.button.callback('❌ Отмена', cancelAction),
    ],
  ]);
}

/**
 * Клавиатура отмены
 */
export function cancelKeyboard(action: string = 'menu_main') {
  return Markup.inlineKeyboard([
    [Markup.button.callback('❌ Отмена', action)],
  ]);
}

/**
 * Клавиатура "Назад"
 */
export function backKeyboard(action: string = 'menu_main') {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔙 Назад', action)],
  ]);
}

/**
 * Клавиатура списка позиций
 */
export function positionsListKeyboard(positions: Array<{ symbol: string; side: string }>) {
  const buttons: any[][] = [];

  for (const pos of positions) {
    buttons.push([
      Markup.button.callback(
        `${pos.side === 'long' ? '🟢' : '🔴'} ${pos.symbol}`,
        `pos_manage_${pos.symbol}_${pos.side}`
      ),
    ]);
  }

  buttons.push([
    Markup.button.callback('❌ Закрыть все', 'close_all_positions'),
  ]);
  buttons.push([
    Markup.button.callback('🔙 Назад', 'menu_main'),
  ]);

  return Markup.inlineKeyboard(buttons);
}

/**
 * Клавиатура управления позицией
 */
export function positionManageKeyboard(symbol: string, side: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🎯 TP/SL', `set_tpsl_${symbol}_${side}`),
    ],
    [
      Markup.button.callback('❌ Закрыть', `close_pos_${symbol}`),
      Markup.button.callback('📝 Добавить', `add_to_pos_${symbol}_${side}`),
    ],
    [
      Markup.button.callback('🔙 К позициям', 'menu_positions'),
    ],
  ]);
}

/**
 * Клавиатура помощи
 */
export function helpKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📖 Команды', 'help_commands'),
      Markup.button.callback('🔧 Настройка', 'help_setup'),
    ],
    [
      Markup.button.callback('💡 Примеры', 'help_examples'),
    ],
    [
      Markup.button.callback('🔙 Назад', 'menu_main'),
    ],
  ]);
}

/**
 * Убирает клавиатуру
 */
export function removeKeyboard() {
  return Markup.removeKeyboard();
}
