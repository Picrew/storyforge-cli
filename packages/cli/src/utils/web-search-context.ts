const CJK_REALTIME_TIME_PATTERN =
  /(今天|现在|当前|实时|最新|最近|刚刚|此刻|近期|本周|本月|今年|今日|昨日|明日)/;
const CJK_REALTIME_DOMAIN_PATTERN =
  /(股价|指数|汇率|行情|天气|气温|预报|比分|赛程|排名|新闻|头条|市值|财报|加密货币|比特币|以太坊|黄金|原油|总统|首相|选举|ceo)/i;

const EN_REALTIME_TIME_PATTERN =
  /\b(today|now|current|latest|recent|realtime|real-time|as of|this week|this month|this year|breaking)\b/i;
const EN_REALTIME_DOMAIN_PATTERN =
  /\b(stock|share price|market cap|nasdaq|dow|s&p|index|exchange rate|fx|weather|forecast|score|schedule|standings|news|headline|earnings|crypto|bitcoin|ethereum|gold|oil|president|prime minister|election|ceo)\b/i;

const QUESTION_HINT_PATTERN =
  /[?？]|^(who|what|when|where|how|which)\b|^(谁|什么|何时|哪里|怎么|多少|几点|几号)/i;
const CJK_DATE_TIME_PATTERN =
  /(今天是几号|今天几号|今天日期|今天星期几|今天周几|现在几点|当前时间|现在时间|今天是星期几|今天是周几)/;
const EN_DATE_TIME_PATTERN =
  /\b(what(?:'s| is)? (?:the )?(?:date|time|day)(?: (?:today|now))?|today(?:'s)? date|current date|current time|what day is it)\b/i;

const CONTEXT_MAX_CHARS = 6_000;

function truncateSearchContext(value: string): string {
  const trimmed = value.trim();

  if (trimmed.length <= CONTEXT_MAX_CHARS) {
    return trimmed;
  }

  return `${trimmed.slice(0, CONTEXT_MAX_CHARS)}\n\n[search context truncated]`;
}

export function shouldUseProactiveWebSearch(prompt: string): boolean {
  const text = prompt.trim();

  if (!text) {
    return false;
  }

  if (CJK_DATE_TIME_PATTERN.test(text) || EN_DATE_TIME_PATTERN.test(text)) {
    return true;
  }

  const hasTimeCue = CJK_REALTIME_TIME_PATTERN.test(text) || EN_REALTIME_TIME_PATTERN.test(text);
  const hasDomainCue = CJK_REALTIME_DOMAIN_PATTERN.test(text) || EN_REALTIME_DOMAIN_PATTERN.test(text);

  if (hasTimeCue && hasDomainCue) {
    return true;
  }

  if (hasDomainCue && QUESTION_HINT_PATTERN.test(text)) {
    return true;
  }

  return false;
}

export function buildWebSearchQuery(prompt: string): string {
  const compact = prompt.replace(/\s+/g, " ").trim();

  if (compact.length <= 180) {
    return compact;
  }

  return compact.slice(0, 180);
}

export function shouldAnswerWithLocalDateTime(prompt: string): boolean {
  const text = prompt.trim();

  if (!text) {
    return false;
  }

  return CJK_DATE_TIME_PATTERN.test(text) || EN_DATE_TIME_PATTERN.test(text);
}

export function buildLocalDateTimeAnswer(now: Date = new Date()): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  const dateText = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long"
  }).format(now);
  const timeText = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(now);

  return `当前本地时间（${timeZone}）为 ${dateText} ${timeText}。`;
}

export function injectWebSearchContextIntoPrompt(
  prompt: string,
  query: string,
  searchContext: string
): string {
  const basePrompt = prompt.trim();
  const normalizedContext = truncateSearchContext(searchContext);
  const fetchedAt = new Date().toISOString();

  return [
    basePrompt,
    "",
    "[[WEB_SEARCH_CONTEXT]]",
    `FetchedAt(UTC): ${fetchedAt}`,
    `Query: ${query}`,
    "Use WEB_SEARCH_CONTEXT for time-sensitive facts. If data is uncertain, say so clearly.",
    normalizedContext,
    "[[/WEB_SEARCH_CONTEXT]]"
  ].join("\n");
}
