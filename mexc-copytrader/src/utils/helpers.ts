// src/utils/helpers.ts

/**
 * Задержка выполнения
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Генерирует случайную задержку в заданном диапазоне
 */
export function randomDelay(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

/**
 * Генерирует случайное отклонение цены
 * @param basePrice - базовая цена
 * @param maxDeviationPercent - максимальное отклонение в процентах
 * @param direction - направление ('long' или 'short')
 * @returns цена с отклонением
 */
export function applyPriceDeviation(
  basePrice: number,
  maxDeviationPercent: number,
  direction: 'long' | 'short'
): number {
  // Для LONG: от 0 до +maxDeviationPercent (цена входа выше)
  // Для SHORT: от 0 до -maxDeviationPercent (цена входа ниже)
  const deviation = Math.random() * maxDeviationPercent;
  
  if (direction === 'long') {
    return basePrice * (1 + deviation / 100);
  } else {
    return basePrice * (1 - deviation / 100);
  }
}

/**
 * Генерирует случайное плечо в диапазоне
 */
export function randomLeverage(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Округляет число до заданного шага
 */
export function roundToStep(value: number, step: number): number {
  if (!step || step <= 0) return value;

  const decimals = (() => {
    const s = step.toString();
    if (!s.includes('.')) return 0;
    return Math.min(10, s.split('.')[1].length);
  })();

  const rounded = Math.round(value / step) * step;
  return parseFloat(rounded.toFixed(decimals));
}

/**
 * Получает количество десятичных знаков из числа
 */
export function getDecimals(value: number): number {
  const str = value.toString();
  if (!str.includes('.')) return 0;
  return str.split('.')[1].length;
}

/**
 * Получает шаг цены из строки цены
 */
export function priceStepFromString(priceStr: string): number {
  const num = parseFloat(priceStr);
  if (isNaN(num)) return 0.00001;
  
  const decimals = getDecimals(num);
  if (decimals === 0) return 1;
  if (decimals > 10) return 0.00001;
  
  return Math.pow(10, -decimals);
}

/**
 * Форматирует число для отображения
 */
export function formatNumber(value: number, decimals: number = 2): string {
  return value.toFixed(decimals);
}

/**
 * Форматирует USD значение
 */
export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * Форматирует процент
 */
export function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * Проверяет, является ли строка валидным числом
 */
export function isValidNumber(str: string): boolean {
  const num = parseFloat(str);
  return !isNaN(num) && isFinite(num);
}

/**
 * Парсит цену из текста (например "Price MEXC $0.00952")
 */
export function parsePriceFromText(text: string, prefix: string = 'Price MEXC'): number | null {
  const regex = new RegExp(`${prefix}\\s*\\$?\\s*([0-9]*\\.?[0-9]+)`, 'i');
  const match = text.match(regex);
  if (!match) return null;
  
  const price = parseFloat(match[1]);
  return isNaN(price) ? null : price;
}

/**
 * Получает шаг цены из текста
 */
export function priceStepFromText(text: string, fallback: number = 0.00001): number {
  const match = text.match(/Price\s*MEXC\s*\$?\s*([0-9]*\.?[0-9]+)/i);
  if (!match) return fallback;
  
  const numStr = match[1].trim();
  const dotIdx = numStr.indexOf('.');
  if (dotIdx === -1) return 1;
  
  const decimals = numStr.length - dotIdx - 1;
  if (decimals <= 0 || decimals > 10) return fallback;
  
  return Math.pow(10, -decimals);
}

/**
 * Определяет сторону сделки (short/long) из сигнала
 */
export function getSideFromSignal(signal: any): 'long' | 'short' {
  if (signal?.isShort === true || signal?.short === true) return 'short';
  if (signal?.isLong === true || signal?.long === true) return 'long';
  
  if (typeof signal?.direction === 'string') {
    const dir = signal.direction.toUpperCase();
    if (dir.includes('SHORT')) return 'short';
    if (dir.includes('LONG')) return 'long';
  }
  
  if (typeof signal?.side === 'string') {
    const side = signal.side.toUpperCase();
    if (side.includes('SHORT')) return 'short';
    if (side.includes('LONG')) return 'long';
  }
  
  // По умолчанию short (как в оригинальном боте)
  return 'short';
}

/**
 * Конвертирует строку side в числовой код MEXC
 * 1 = Open Long
 * 2 = Close Short  
 * 3 = Open Short
 * 4 = Close Long
 */
export function sideToMexcCode(side: 'long' | 'short', action: 'open' | 'close'): number {
  if (side === 'long') {
    return action === 'open' ? 1 : 4;
  } else {
    return action === 'open' ? 3 : 2;
  }
}

/**
 * Конвертирует числовой код MEXC в строку
 */
export function mexcCodeToSide(code: number): { side: 'long' | 'short'; action: 'open' | 'close' } {
  switch (code) {
    case 1: return { side: 'long', action: 'open' };
    case 2: return { side: 'short', action: 'close' };
    case 3: return { side: 'short', action: 'open' };
    case 4: return { side: 'long', action: 'close' };
    default: return { side: 'long', action: 'open' };
  }
}

/**
 * Эскейпит Markdown символы для Telegram
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

/**
 * Форматирует время в читаемый вид
 */
export function formatTime(date: Date | number): string {
  const d = typeof date === 'number' ? new Date(date) : date;
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Сокращает строку до максимальной длины
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Генерирует уникальный ID для сессии/операции
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Проверяет валидность authToken MEXC
 */
export function isValidAuthToken(token: string): boolean {
  // MEXC authToken обычно начинается с "WEB" и имеет определённую длину
  return token.startsWith('WEB') && token.length >= 60;
}

/**
 * Проверяет валидность URL прокси
 */
export function isValidProxyUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:', 'socks4:', 'socks5:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Рассчитывает размер позиции
 */
export function calculatePositionSize(
  marginUsd: number,
  leverage: number,
  price: number,
  contractSize: number = 1
): { positionUsd: number; contracts: number } {
  const positionUsd = marginUsd * leverage;
  const contracts = Math.floor(positionUsd / (price * contractSize));
  return { positionUsd, contracts };
}

/**
 * Рассчитывает маржу для позиции
 */
export function calculateMargin(
  positionUsd: number,
  leverage: number
): number {
  return positionUsd / leverage;
}

/**
 * Логирует с временной меткой
 */
export function log(prefix: string, message: string, ...args: any[]): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${prefix} ${message}`, ...args);
}

/**
 * Логирует ошибку с временной меткой
 */
export function logError(prefix: string, message: string, error?: any): void {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ${prefix} ❌ ${message}`, error || '');
}
