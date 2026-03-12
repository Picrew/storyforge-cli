export interface ModelOption {
  id: string;
  title: string;
  subtitle: string;
}

export interface ProviderOption {
  id: string;
  title: string;
  subtitle: string;
  group: "popular" | "other";
  authKind: "api" | "oauth" | "choice";
  authLabel: string;
  credentialLabel: string;
  credentialHelperText: string;
  fallbackModels: readonly ModelOption[];
}

const providerCatalog: readonly ProviderOption[] = [
  {
    id: "opencode",
    title: "OpenCode Zen",
    subtitle: "Recommended",
    group: "popular",
    authKind: "oauth",
    authLabel: "OpenCode Zen OAuth",
    credentialLabel: "OAuth",
    credentialHelperText: "Press Enter to launch opencode auth login.",
    fallbackModels: [
      { id: "opencode/zen", title: "zen", subtitle: "Default OpenCode model" },
      { id: "opencode/zen-mini", title: "zen-mini", subtitle: "Faster OpenCode model" }
    ]
  },
  {
    id: "openai",
    title: "OpenAI",
    subtitle: "ChatGPT Plus/Pro or API key",
    group: "popular",
    authKind: "choice",
    authLabel: "ChatGPT Plus/Pro",
    credentialLabel: "OAuth",
    credentialHelperText: "Choose ChatGPT Plus/Pro or API key.",
    fallbackModels: [
      { id: "openai/gpt-5-codex", title: "gpt-5-codex", subtitle: "Code-first GPT-5" },
      { id: "openai/gpt-5", title: "gpt-5", subtitle: "General-purpose GPT-5" },
      { id: "openai/gpt-4o", title: "gpt-4o", subtitle: "Fast multimodal fallback" }
    ]
  },
  {
    id: "github-copilot",
    title: "GitHub Copilot",
    subtitle: "Copilot account",
    group: "popular",
    authKind: "oauth",
    authLabel: "GitHub Copilot OAuth",
    credentialLabel: "OAuth",
    credentialHelperText: "Press Enter to launch the GitHub Copilot sign-in flow.",
    fallbackModels: [
      { id: "github-copilot/gpt-4.1", title: "gpt-4.1", subtitle: "Copilot default" },
      {
        id: "github-copilot/claude-3.7-sonnet",
        title: "claude-3.7-sonnet",
        subtitle: "Copilot Claude option"
      }
    ]
  },
  {
    id: "google",
    title: "Google",
    subtitle: "Gemini API key",
    group: "popular",
    authKind: "api",
    authLabel: "Saved in .storyforge",
    credentialLabel: "API key",
    credentialHelperText: "Enter saves to .storyforge and opens model picker.",
    fallbackModels: [
      { id: "google/gemini-2.5-pro", title: "gemini-2.5-pro", subtitle: "Reasoning-heavy Gemini" },
      { id: "google/gemini-2.5-flash", title: "gemini-2.5-flash", subtitle: "Fast Gemini default" }
    ]
  },
  {
    id: "deepseek",
    title: "DeepSeek",
    subtitle: "API key",
    group: "other",
    authKind: "api",
    authLabel: "Saved in .storyforge",
    credentialLabel: "API key",
    credentialHelperText: "Enter saves to .storyforge and opens model picker.",
    fallbackModels: [
      { id: "deepseek/deepseek-reasoner", title: "deepseek-reasoner", subtitle: "Reasoning default" },
      { id: "deepseek/deepseek-chat", title: "deepseek-chat", subtitle: "Fast chat model" }
    ]
  },
  {
    id: "openrouter",
    title: "OpenRouter",
    subtitle: "API key",
    group: "popular",
    authKind: "api",
    authLabel: "Saved in .storyforge",
    credentialLabel: "API key",
    credentialHelperText: "Enter saves to .storyforge and opens model picker.",
    fallbackModels: [
      {
        id: "openrouter/stepfun/step-3.5-flash:free",
        title: "stepfun/step-3.5-flash:free",
        subtitle: "Fast free OpenRouter model"
      }
    ]
  },
  {
    id: "siliconflow-cn",
    title: "SiliconFlow (China)",
    subtitle: "API key",
    group: "other",
    authKind: "api",
    authLabel: "Saved in .storyforge",
    credentialLabel: "API key",
    credentialHelperText: "Enter saves to .storyforge and opens model picker.",
    fallbackModels: [
      { id: "siliconflow-cn/deepseek-v3", title: "deepseek-v3", subtitle: "Default SiliconFlow" },
      { id: "siliconflow-cn/qwen-max", title: "qwen-max", subtitle: "Alternate SiliconFlow" }
    ]
  },
  {
    id: "kimi-for-coding",
    title: "Kimi For Coding",
    subtitle: "API key",
    group: "other",
    authKind: "api",
    authLabel: "Saved in .storyforge",
    credentialLabel: "API key",
    credentialHelperText: "Enter saves to .storyforge and opens model picker.",
    fallbackModels: [
      { id: "kimi-for-coding/kimi-k2", title: "kimi-k2", subtitle: "Coding default" },
      { id: "kimi-for-coding/kimi-k1.5", title: "kimi-k1.5", subtitle: "Balanced fallback" }
    ]
  },
  {
    id: "mixapi",
    title: "mixapi",
    subtitle: "API key",
    group: "other",
    authKind: "api",
    authLabel: "Saved in .storyforge",
    credentialLabel: "API key",
    credentialHelperText: "Enter saves to .storyforge and opens model picker.",
    fallbackModels: [
      { id: "mixapi/claude-opus-4.5", title: "claude-opus-4.5", subtitle: "Default mixapi" },
      { id: "mixapi/gpt-5-codex", title: "gpt-5-codex", subtitle: "Coding fallback" }
    ]
  }
] as const;

function scoreMatch(query: string, value: string): number {
  if (!query) {
    return 1;
  }

  const normalizedQuery = query.toLowerCase();
  const normalizedValue = value.toLowerCase();

  if (normalizedValue.startsWith(normalizedQuery)) {
    return 100 - (normalizedValue.length - normalizedQuery.length);
  }

  let queryIndex = 0;
  let penalty = 0;

  for (let index = 0; index < normalizedValue.length && queryIndex < normalizedQuery.length; index += 1) {
    if (normalizedValue[index] === normalizedQuery[queryIndex]) {
      queryIndex += 1;
    } else {
      penalty += 1;
    }
  }

  if (queryIndex === normalizedQuery.length) {
    return Math.max(10, 60 - penalty);
  }

  if (normalizedValue.includes(normalizedQuery)) {
    return 20;
  }

  return 0;
}

function getProviderMatchScore(query: string, provider: ProviderOption): number {
  return Math.max(
    scoreMatch(query, provider.id),
    scoreMatch(query, provider.title),
    scoreMatch(query, provider.subtitle)
  );
}

export function getProviderCatalog(): readonly ProviderOption[] {
  return providerCatalog;
}

export function getProviderOption(providerId: string): ProviderOption | null {
  return providerCatalog.find((provider) => provider.id === providerId) ?? null;
}

export function getProviderMatches(searchValue: string): readonly ProviderOption[] {
  const normalizedSearch = searchValue.trim().toLowerCase();

  return providerCatalog
    .map((provider) => ({
      provider,
      score: getProviderMatchScore(normalizedSearch, provider)
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }

      if (left.provider.group !== right.provider.group) {
        return left.provider.group === "popular" ? -1 : 1;
      }

      return left.provider.title.localeCompare(right.provider.title);
    })
    .map(({ provider }) => provider);
}

export function getFallbackModels(providerId: string): readonly ModelOption[] {
  return getProviderOption(providerId)?.fallbackModels ?? [];
}
