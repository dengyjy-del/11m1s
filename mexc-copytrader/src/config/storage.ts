// src/config/storage.ts

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { BotConfig, AccountConfig, CopyTradingSettings } from './types';

const CONFIG_FILE = path.join(process.cwd(), 'config.json');

/**
 * Дефолтные настройки системы
 */
const DEFAULT_SETTINGS: CopyTradingSettings = {
  delayMinMs: 0,
  delayMaxMs: 1000,
  priceDeviationPercent: 1.0,
  leverageSpread: 10,
  copyOpenPositions: true,
  copyClosePositions: true,
  copyTpSl: true,
  signalsEnabled: true,
  signalEntryOffset: -0.5,
  signalTpOffset: 1.0,
  signalCancelTimeMin: 60,
  signalCancelTimeMax: 180,
};

/**
 * Дефолтные лимиты контрактов по символам
 */
const DEFAULT_CONTRACT_LIMITS: Record<string, number> = {
  'SUBHUB_USDT': 2100,
  'PING_USDT': 2900,
  'LITKEY_USDT': 200,
  'AT_USDT': 75000,
  'PLANCK_USDT': 360,
  'ARCSOL_USDT': 3700,
  'GUA_USDT': 105,
  'NB_USDT': 850,
  'BLUE_USDT': 2250,
  'TYCOON_USDT': 700,
  'POP_USDT': 500,
  'RION_USDT': 700,
  'DIGI_USDT': 3300,
  'BEST_USDT': 400,
  'ORE_USDT': 70,
  'SEEK_USDT': 360,
  'BIT_USDT': 13000,
  'ESUQIE_USDT': 120,
  'PIPE_USDT': 80,
};

/**
 * Класс для работы с конфигурацией
 */
export class ConfigStorage {
  private config: BotConfig;

  constructor() {
    this.config = this.loadConfig();
  }

  /**
   * Загружает конфигурацию из файла или создаёт дефолтную
   */
  private loadConfig(): BotConfig {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const parsed = JSON.parse(data) as BotConfig;
        
        // Мержим с дефолтными настройками (на случай новых полей)
        return {
          telegramBotToken: parsed.telegramBotToken || '',
          telegramUserId: parsed.telegramUserId || 0,
          accounts: parsed.accounts || [],
          settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
          contractLimits: { ...DEFAULT_CONTRACT_LIMITS, ...parsed.contractLimits },
        };
      }
    } catch (err) {
      console.error('Ошибка загрузки конфигурации:', err);
    }

    // Возвращаем дефолтную конфигурацию
    return {
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
      telegramUserId: parseInt(process.env.TELEGRAM_USER_ID || '0', 10),
      accounts: [],
      settings: { ...DEFAULT_SETTINGS },
      contractLimits: { ...DEFAULT_CONTRACT_LIMITS },
    };
  }

  /**
   * Сохраняет конфигурацию в файл
   */
  save(): void {
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (err) {
      console.error('Ошибка сохранения конфигурации:', err);
      throw err;
    }
  }

  /**
   * Получает полную конфигурацию
   */
  getConfig(): BotConfig {
    return this.config;
  }

  /**
   * Устанавливает Telegram токен
   */
  setTelegramToken(token: string): void {
    this.config.telegramBotToken = token;
    this.save();
  }

  /**
   * Устанавливает Telegram User ID
   */
  setTelegramUserId(userId: number): void {
    this.config.telegramUserId = userId;
    this.save();
  }

  // ==================== АККАУНТЫ ====================

  /**
   * Получает все аккаунты
   */
  getAccounts(): AccountConfig[] {
    return this.config.accounts;
  }

  /**
   * Получает включенные аккаунты
   */
  getEnabledAccounts(): AccountConfig[] {
    return this.config.accounts.filter(a => a.enabled);
  }

  /**
   * Получает мастер-аккаунт
   */
  getMasterAccount(): AccountConfig | undefined {
    return this.config.accounts.find(a => a.isMaster && a.enabled);
  }

  /**
   * Получает slave-аккаунты (не мастер, включенные)
   */
  getSlaveAccounts(): AccountConfig[] {
    return this.config.accounts.filter(a => !a.isMaster && a.enabled);
  }

  /**
   * Получает аккаунт по ID
   */
  getAccountById(id: string): AccountConfig | undefined {
    return this.config.accounts.find(a => a.id === id);
  }

  /**
   * Добавляет новый аккаунт
   */
  addAccount(account: Omit<AccountConfig, 'id'>): AccountConfig {
    const newAccount: AccountConfig = {
      ...account,
      id: uuidv4(),
    };
    
    // Если это первый аккаунт, делаем его мастером
    if (this.config.accounts.length === 0) {
      newAccount.isMaster = true;
    }
    
    this.config.accounts.push(newAccount);
    this.save();
    return newAccount;
  }

  /**
   * Обновляет аккаунт
   */
  updateAccount(id: string, updates: Partial<AccountConfig>): AccountConfig | null {
    const index = this.config.accounts.findIndex(a => a.id === id);
    if (index === -1) return null;
    
    // Если делаем аккаунт мастером, снимаем флаг с других
    if (updates.isMaster === true) {
      this.config.accounts.forEach(a => {
        if (a.id !== id) a.isMaster = false;
      });
    }
    
    this.config.accounts[index] = {
      ...this.config.accounts[index],
      ...updates,
    };
    
    this.save();
    return this.config.accounts[index];
  }

  /**
   * Удаляет аккаунт
   */
  deleteAccount(id: string): boolean {
    const index = this.config.accounts.findIndex(a => a.id === id);
    if (index === -1) return false;
    
    const wasMaster = this.config.accounts[index].isMaster;
    this.config.accounts.splice(index, 1);
    
    // Если удалили мастера, назначаем первый доступный аккаунт мастером
    if (wasMaster && this.config.accounts.length > 0) {
      this.config.accounts[0].isMaster = true;
    }
    
    this.save();
    return true;
  }

  /**
   * Назначает аккаунт мастером
   */
  setMasterAccount(id: string): boolean {
    const account = this.getAccountById(id);
    if (!account) return false;
    
    this.config.accounts.forEach(a => {
      a.isMaster = a.id === id;
    });
    
    this.save();
    return true;
  }

  /**
   * Включает/выключает аккаунт
   */
  toggleAccount(id: string, enabled: boolean): boolean {
    const account = this.getAccountById(id);
    if (!account) return false;
    
    account.enabled = enabled;
    this.save();
    return true;
  }

  // ==================== НАСТРОЙКИ ====================

  /**
   * Получает настройки
   */
  getSettings(): CopyTradingSettings {
    return this.config.settings;
  }

  /**
   * Обновляет настройки
   */
  updateSettings(updates: Partial<CopyTradingSettings>): CopyTradingSettings {
    this.config.settings = {
      ...this.config.settings,
      ...updates,
    };
    this.save();
    return this.config.settings;
  }

  // ==================== ЛИМИТЫ КОНТРАКТОВ ====================

  /**
   * Получает лимит контрактов для символа
   */
  getContractLimit(symbol: string): number | undefined {
    return this.config.contractLimits[symbol];
  }

  /**
   * Устанавливает лимит контрактов для символа
   */
  setContractLimit(symbol: string, limit: number): void {
    this.config.contractLimits[symbol] = limit;
    this.save();
  }

  /**
   * Получает все лимиты контрактов
   */
  getContractLimits(): Record<string, number> {
    return this.config.contractLimits;
  }

  // ==================== МИГРАЦИЯ ИЗ .ENV ====================

  /**
   * Импортирует аккаунты из старого формата MEXC_TOKENS
   */
  importFromEnvFormat(mexcTokensRaw: string): number {
    const parts = mexcTokensRaw.split(',').map(p => p.trim()).filter(Boolean);
    let imported = 0;

    for (const [idx, part] of parts.entries()) {
      const fields = part.split(':').map(f => f.trim());
      
      if (fields.length < 7) continue;

      let authToken: string;
      let maxCapStr: string | null = null;
      let proxyParts: string[] = [];

      if (fields.length === 7) {
        [authToken] = fields;
      } else {
        [authToken, , , , , maxCapStr, , , ...proxyParts] = fields;
      }

      const proxyUrl = proxyParts.length ? proxyParts.join(':').trim() : undefined;
      const maxPositionUsd = maxCapStr ? parseFloat(maxCapStr) : 100;

      this.addAccount({
        name: `Аккаунт ${this.config.accounts.length + 1}`,
        authToken,
        proxyUrl: proxyUrl || undefined,
        enabled: true,
        isMaster: this.config.accounts.length === 0,
        maxPositionUsd: isNaN(maxPositionUsd) ? 100 : maxPositionUsd,
        leverageMin: 10,
        leverageMax: 20,
      });

      imported++;
    }

    return imported;
  }
}

// Синглтон для использования во всём приложении
export const configStorage = new ConfigStorage();
