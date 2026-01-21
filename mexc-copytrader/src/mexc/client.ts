// src/mexc/client.ts

import { MexcFuturesClient, MexcFuturesError } from 'mexc-futures-sdk';
import { HttpsProxyAgent } from 'https-proxy-agent';
import axios from 'axios';
import { AccountConfig, Position, Order, ContractInfo, AccountBalance } from '../config/types';
import { log, logError, sleep, roundToStep } from '../utils/helpers';

/**
 * Обёртка над MEXC Futures клиентом с дополнительной функциональностью
 */
export class MexcClientWrapper {
  public readonly accountId: string;
  public readonly accountName: string;
  private client: MexcFuturesClient;
  private agent?: HttpsProxyAgent<string>;
  private proxyUrl?: string;

  constructor(account: AccountConfig) {
    this.accountId = account.id;
    this.accountName = account.name;
    this.proxyUrl = account.proxyUrl;

    // Создаём proxy agent если нужен
    if (account.proxyUrl && /^https?:\/\//i.test(account.proxyUrl)) {
      try {
        this.agent = new HttpsProxyAgent(account.proxyUrl);
      } catch (err) {
        logError(`[${this.accountName}]`, 'Ошибка создания proxy agent', err);
      }
    }

    // Создаём MEXC клиент
    this.client = new MexcFuturesClient({
      authToken: account.authToken,
      logLevel: 'ERROR',
      httpAgent: this.agent as any,
      httpsAgent: this.agent as any,
    } as any);
  }

  /**
   * Проверяет внешний IP через proxy
   */
  async checkProxyIp(): Promise<string | null> {
    if (!this.proxyUrl || !this.agent) {
      log(`[${this.accountName}]`, 'Proxy не задан');
      return null;
    }

    try {
      const resp = await axios.get('https://api.ipify.org?format=json', {
        httpAgent: this.agent,
        httpsAgent: this.agent,
        timeout: 5000,
      });
      const ip = resp.data?.ip;
      log(`[${this.accountName}]`, `Внешний IP: ${ip}`);
      return ip;
    } catch (err) {
      logError(`[${this.accountName}]`, 'Не удалось получить IP через proxy', err);
      return null;
    }
  }

  /**
   * Получает баланс аккаунта
   */
  async getBalance(): Promise<AccountBalance | null> {
    try {
      const res: any = await (this.client as any).getAccountAssets();
      const assets = res?.data || [];
      
      // Ищем USDT баланс
      const usdt = assets.find((a: any) => a.currency === 'USDT');
      if (!usdt) {
        return { available: 0, frozen: 0, total: 0, currency: 'USDT' };
      }

      return {
        available: parseFloat(usdt.availableBalance || '0'),
        frozen: parseFloat(usdt.frozenBalance || '0'),
        total: parseFloat(usdt.equity || '0'),
        currency: 'USDT',
      };
    } catch (err) {
      logError(`[${this.accountName}]`, 'Ошибка получения баланса', err);
      return null;
    }
  }

  /**
   * Получает открытые позиции
   */
  async getOpenPositions(symbol?: string): Promise<Position[]> {
    try {
      const params = symbol ? { symbol } : {};
      const res: any = await (this.client as any).getOpenPositions(params);
      const list = res?.data || [];

      return list
        .filter((p: any) => parseFloat(p.holdVol) > 0)
        .map((p: any) => ({
          symbol: p.symbol,
          side: p.positionType === 1 ? 'long' : 'short',
          volume: parseFloat(p.holdVol),
          entryPrice: parseFloat(p.openAvgPrice || p.avgPrice || '0'),
          leverage: parseInt(p.leverage || '1', 10),
          margin: parseFloat(p.im || '0'),
          unrealizedPnl: parseFloat(p.unrealisedPnl || '0'),
          liquidationPrice: p.liquidatePrice ? parseFloat(p.liquidatePrice) : undefined,
        }));
    } catch (err) {
      logError(`[${this.accountName}]`, 'Ошибка получения позиций', err);
      return [];
    }
  }

  /**
   * Проверяет, есть ли открытая позиция по символу
   */
  async hasOpenPosition(symbol: string): Promise<boolean> {
    const positions = await this.getOpenPositions(symbol);
    return positions.length > 0;
  }

  /**
   * Получает открытые ордера
   */
  async getOpenOrders(symbol?: string): Promise<Order[]> {
    try {
      const params = symbol ? { symbol } : {};
      const res: any = await (this.client as any).getOpenOrders(params);
      const list = res?.data || [];

      return list.map((o: any) => ({
        orderId: o.orderId,
        symbol: o.symbol,
        side: parseInt(o.side, 10),
        type: parseInt(o.type || '1', 10),
        price: parseFloat(o.price || '0'),
        volume: parseFloat(o.vol || '0'),
        filledVolume: parseFloat(o.dealVol || '0'),
        status: o.state,
        leverage: parseInt(o.leverage || '1', 10),
        takeProfit: o.takeProfitPrice ? parseFloat(o.takeProfitPrice) : undefined,
        stopLoss: o.stopLossPrice ? parseFloat(o.stopLossPrice) : undefined,
        createTime: parseInt(o.createTime || '0', 10),
      }));
    } catch (err) {
      logError(`[${this.accountName}]`, 'Ошибка получения ордеров', err);
      return [];
    }
  }

  /**
   * Получает информацию о контракте
   */
  async getContractInfo(symbol: string): Promise<ContractInfo | null> {
    try {
      const res: any = await (this.client as any).getContractDetail(symbol);
      const detail = res?.data || res;

      if (!detail) return null;

      // Ищем maxVolume в разных полях
      let maxVolume = 0;
      const candidates = ['maxVolume', 'maxVol', 'maxOrderVolume', 'maxOpenVol', 'maxOpenVolume'];
      for (const key of candidates) {
        const v = (detail as any)[key];
        if (v !== undefined && v !== null && !isNaN(parseFloat(String(v)))) {
          maxVolume = parseFloat(String(v));
          break;
        }
      }

      return {
        symbol,
        contractSize: parseFloat(String(detail.contractSize || '1')),
        maxVolume,
        priceStep: parseFloat(String(detail.priceUnit || '0.00001')),
        volumeStep: parseFloat(String(detail.volUnit || '1')),
        minVolume: parseFloat(String(detail.minVol || '1')),
      };
    } catch (err) {
      logError(`[${this.accountName}]`, `Ошибка получения info для ${symbol}`, err);
      return null;
    }
  }

  /**
   * Отменяет все ордера по символу
   */
  async cancelAllOrders(symbol: string): Promise<boolean> {
    try {
      await (this.client as any).cancelAllOrders({ symbol });
      log(`[${this.accountName}]`, `Отменены все ордера по ${symbol}`);
      return true;
    } catch (err) {
      logError(`[${this.accountName}]`, `Ошибка отмены ордеров по ${symbol}`, err);
      return false;
    }
  }

  /**
   * Отменяет конкретный ордер
   */
  async cancelOrder(symbol: string, orderId: string): Promise<boolean> {
    try {
      await (this.client as any).cancelOrder({ symbol, orderId });
      log(`[${this.accountName}]`, `Отменён ордер ${orderId}`);
      return true;
    } catch (err) {
      logError(`[${this.accountName}]`, `Ошибка отмены ордера ${orderId}`, err);
      return false;
    }
  }

  /**
   * Размещает ордер с автоповтором при rate-limit
   */
  async submitOrder(params: {
    symbol: string;
    price: number;
    vol: number;
    side: number;
    type: number;
    openType: number;
    leverage: number;
    takeProfitPrice?: number;
    stopLossPrice?: number;
  }): Promise<{ success: boolean; orderId?: string; message?: string }> {
    let attempt = 0;

    while (true) {
      try {
        const res: any = await (this.client as any).submitOrder(params);

        if (res && res.success === false) {
          return { success: false, message: res.message || 'Unknown error' };
        }

        const orderId = res?.data?.orderId || res?.orderId;
        log(`[${this.accountName}]`, `Ордер размещён: ${orderId}`);
        return { success: true, orderId };

      } catch (err: any) {
        const msg = err instanceof MexcFuturesError 
          ? err.getUserFriendlyMessage() 
          : String(err?.message || err);

        const isRateLimit = msg.toLowerCase().includes('too frequent') || 
                          msg.toLowerCase().includes('rate limit');

        if (isRateLimit && attempt === 0) {
          const backoff = 500 + Math.random() * 700;
          log(`[${this.accountName}]`, `Rate limit, повтор через ${Math.round(backoff)}ms`);
          await sleep(backoff);
          attempt++;
          continue;
        }

        logError(`[${this.accountName}]`, 'Ошибка размещения ордера', msg);
        return { success: false, message: msg };
      }
    }
  }

  /**
   * Открывает позицию (маркет или лимит)
   */
  async openPosition(params: {
    symbol: string;
    side: 'long' | 'short';
    price: number;
    volume: number;
    leverage: number;
    isMarket?: boolean;
    takeProfit?: number;
    stopLoss?: number;
  }): Promise<{ success: boolean; orderId?: string; message?: string }> {
    const sideCode = params.side === 'long' ? 1 : 3; // 1=OpenLong, 3=OpenShort
    const orderType = params.isMarket ? 5 : 1; // 5=Market, 1=Limit

    return this.submitOrder({
      symbol: params.symbol,
      price: params.price,
      vol: params.volume,
      side: sideCode,
      type: orderType,
      openType: 1, // Isolated margin
      leverage: params.leverage,
      takeProfitPrice: params.takeProfit,
      stopLossPrice: params.stopLoss,
    });
  }

  /**
   * Закрывает позицию
   */
  async closePosition(params: {
    symbol: string;
    side: 'long' | 'short';
    price: number;
    volume: number;
    isMarket?: boolean;
  }): Promise<{ success: boolean; orderId?: string; message?: string }> {
    const sideCode = params.side === 'long' ? 4 : 2; // 4=CloseLong, 2=CloseShort
    const orderType = params.isMarket ? 5 : 1;

    return this.submitOrder({
      symbol: params.symbol,
      price: params.price,
      vol: params.volume,
      side: sideCode,
      type: orderType,
      openType: 1,
      leverage: 1, // Для закрытия плечо не важно
    });
  }

  /**
   * Устанавливает TP/SL для позиции
   */
  async setTpSl(params: {
    symbol: string;
    side: 'long' | 'short';
    takeProfit?: number;
    stopLoss?: number;
  }): Promise<{ success: boolean; message?: string }> {
    try {
      // Получаем текущую позицию
      const positions = await this.getOpenPositions(params.symbol);
      const position = positions.find(p => p.side === params.side);
      
      if (!position) {
        return { success: false, message: 'Позиция не найдена' };
      }

      // MEXC API для изменения TP/SL
      const res: any = await (this.client as any).changePositionTpSl({
        symbol: params.symbol,
        positionId: (position as any).positionId,
        takeProfitPrice: params.takeProfit,
        stopLossPrice: params.stopLoss,
      });

      if (res && res.success === false) {
        return { success: false, message: res.message };
      }

      log(`[${this.accountName}]`, `TP/SL установлены для ${params.symbol}`);
      return { success: true };

    } catch (err: any) {
      const msg = err instanceof MexcFuturesError 
        ? err.getUserFriendlyMessage() 
        : String(err?.message || err);
      logError(`[${this.accountName}]`, 'Ошибка установки TP/SL', msg);
      return { success: false, message: msg };
    }
  }

  /**
   * Получает текущую цену по символу
   */
  async getCurrentPrice(symbol: string): Promise<number | null> {
    try {
      const res: any = await (this.client as any).getTicker({ symbol });
      const data = res?.data;
      
      if (data?.lastPrice) {
        return parseFloat(data.lastPrice);
      }
      
      // Альтернативный способ
      const ticker = Array.isArray(data) ? data.find((t: any) => t.symbol === symbol) : data;
      if (ticker?.lastPrice) {
        return parseFloat(ticker.lastPrice);
      }

      return null;
    } catch (err) {
      logError(`[${this.accountName}]`, `Ошибка получения цены ${symbol}`, err);
      return null;
    }
  }

  /**
   * Возвращает оригинальный MEXC клиент (для прямого доступа)
   */
  getRawClient(): MexcFuturesClient {
    return this.client;
  }

  /**
   * Возвращает proxy agent
   */
  getAgent(): HttpsProxyAgent<string> | undefined {
    return this.agent;
  }
}

/**
 * Менеджер клиентов - хранит и управляет всеми MEXC клиентами
 */
export class ClientManager {
  private clients: Map<string, MexcClientWrapper> = new Map();

  /**
   * Инициализирует клиент для аккаунта
   */
  initClient(account: AccountConfig): MexcClientWrapper {
    const client = new MexcClientWrapper(account);
    this.clients.set(account.id, client);
    return client;
  }

  /**
   * Получает клиент по ID аккаунта
   */
  getClient(accountId: string): MexcClientWrapper | undefined {
    return this.clients.get(accountId);
  }

  /**
   * Удаляет клиент
   */
  removeClient(accountId: string): void {
    this.clients.delete(accountId);
  }

  /**
   * Получает все клиенты
   */
  getAllClients(): MexcClientWrapper[] {
    return Array.from(this.clients.values());
  }

  /**
   * Проверяет, инициализирован ли клиент
   */
  hasClient(accountId: string): boolean {
    return this.clients.has(accountId);
  }

  /**
   * Очищает все клиенты
   */
  clearAll(): void {
    this.clients.clear();
  }
}

// Синглтон менеджера клиентов
export const clientManager = new ClientManager();
