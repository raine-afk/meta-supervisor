/**
 * LLM-Based Analysis — Uses Gemini (via OpenClaw gateway) or Modal for
 * natural-language reasoning about code quality, architecture, and fixes.
 *
 * Falls back gracefully to a template-based analysis when no LLM is available.
 */

import { readFile } from "fs/promises";
import { join } from "path";

export interface LLMAnalysis {
  summary: string;
  issues: LLMIssue[];
  suggestions: string[];
  architecturalNotes: string[];
}

export interface LLMIssue {
  severity: "critical" | "warning" | "info";
  description: string;
  location?: string;
  fix?: string;
}

interface LLMConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  provider: "openai-compat" | "google-generative-ai";
}

/**
 * Attempt to load LLM config from openclaw config or environment.
 */
async function loadConfig(): Promise<LLMConfig | null> {
  // Try Modal API (OpenAI-compatible)
  const modalKey = process.env.MODAL_API_KEY;
  if (modalKey) {
    return {
      baseUrl: "https://api.us-west-2.modal.direct/v1",
      model: "zai-org/GLM-5-FP8",
      apiKey: modalKey,
      provider: "openai-compat",
    };
  }

  // Try Google Generative AI from openclaw config
  try {
    const configPath = join(
      process.env.HOME || "/home/ubuntu",
      ".openclaw",
      "openclaw.json"
    );
    const config = JSON.parse(await readFile(configPath, "utf-8"));
    const google = config?.models?.providers?.google;
    if (google?.baseUrl) {
      return {
        baseUrl: google.baseUrl,
        model: google.models?.[0]?.id || "gemini-2.5-flash-lite",
        provider: "google-generative-ai",
      };
    }
  } catch {
    // Config not found
  }

  return null;
}

/**
 * Call an OpenAI-compatible chat completions API.
 */
async function callOpenAICompat(
  config: LLMConfig,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs: number = 30000
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const resp = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey
          ? { Authorization: `Bearer ${config.apiKey}` }
          : {}),
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 2048,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!resp.ok) return null;
    const data = (await resp.json()) as any;
    return data?.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

/**
 * Call Google Generative AI API.
 */
async function callGemini(
  config: LLMConfig,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs: number = 30000
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const url = `${config.baseUrl}/models/${config.model}:generateContent`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey
          ? { "x-goog-api-key": config.apiKey }
          : {}),
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          maxOutputTokens: 2048,
          temperature: 0.3,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!resp.ok) return null;
    const data = (await resp.json()) as any;
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch {
    return null;
  }
}

/**
 * Call LLM with automatic backend detection.
 */
async function callLLM(
  systemPrompt: string,
  userPrompt: string
): Promise<string | null> {
  const config = await loadConfig();
  if (!config) return null;

  if (config.provider === "openai-compat") {
    return callOpenAICompat(config, systemPrompt, userPrompt);
  } else {
    return callGemini(config, systemPrompt, userPrompt);
  }
}

const SYSTEM_PROMPT = `You are a senior code reviewer and architecture advisor. You analyze code changes for:
1. Security vulnerabilities
2. Performance issues
3. Code quality and maintainability
4. Architectural concerns
5. Best practices violations

Be concise and actionable. Format your response as JSON with this structure:
{
  "summary": "Brief overall assessment",
  "issues": [{"severity": "critical|warning|info", "description": "...", "location": "line or section", "fix": "suggested fix"}],
  "suggestions": ["improvement suggestion 1", "..."],
  "architecturalNotes": ["architectural observation 1", "..."]
}`;

/**
 * Analyze code using LLM reasoning.
 * Falls back to template-based analysis if LLM is unavailable.
 */
export async function smartAnalyze(
  code: string,
  filePath: string,
  context?: { recentChanges?: string; projectPatterns?: string }
): Promise<LLMAnalysis> {
  const userPrompt = buildPrompt(code, filePath, context);

  const llmResponse = await callLLM(SYSTEM_PROMPT, userPrompt);

  if (llmResponse) {
    try {
      // Try to extract JSON from the response
      const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          summary: parsed.summary || "LLM analysis complete",
          issues: (parsed.issues || []).map((i: any) => ({
            severity: i.severity || "info",
            description: i.description || "",
            location: i.location,
            fix: i.fix,
          })),
          suggestions: parsed.suggestions || [],
          architecturalNotes: parsed.architecturalNotes || [],
        };
      }
    } catch {
      // JSON parsing failed, return raw analysis
      return {
        summary: llmResponse.slice(0, 200),
        issues: [],
        suggestions: [llmResponse],
        architecturalNotes: [],
      };
    }
  }

  // Fallback: template-based analysis
  return templateAnalysis(code, filePath);
}

function buildPrompt(
  code: string,
  filePath: string,
  context?: { recentChanges?: string; projectPatterns?: string }
): string {
  let prompt = `Analyze this code file:\n\nFile: ${filePath}\n\n\`\`\`\n${code.slice(0, 8000)}\n\`\`\`\n`;

  if (context?.projectPatterns) {
    prompt += `\nProject patterns:\n${context.projectPatterns}\n`;
  }
  if (context?.recentChanges) {
    prompt += `\nRecent changes:\n${context.recentChanges}\n`;
  }

  return prompt;
}

/**
 * Template-based fallback when LLM is unavailable.
 * Still provides useful heuristic analysis.
 */
function templateAnalysis(code: string, filePath: string): LLMAnalysis {
  const lines = code.split("\n");
  const issues: LLMIssue[] = [];
  const suggestions: string[] = [];
  const architecturalNotes: string[] = [];

  // Complexity check
  const functionCount = (code.match(/(?:function\s+\w+|=>\s*\{|\w+\s*\([^)]*\)\s*\{)/g) || []).length;
  if (functionCount > 10) {
    suggestions.push(
      `File has ${functionCount} functions — consider splitting into smaller modules`
    );
  }

  // Deep nesting check
  let maxIndent = 0;
  for (const line of lines) {
    const indent = line.match(/^(\s*)/)?.[1].length || 0;
    if (indent > maxIndent) maxIndent = indent;
  }
  if (maxIndent > 16) {
    issues.push({
      severity: "warning",
      description: `Deep nesting detected (${Math.floor(maxIndent / 2)} levels) — consider extracting helper functions`,
    });
  }

  // Large function detection
  let inFunction = false;
  let functionStart = 0;
  let braceCount = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/(?:function\s|=>)/.test(lines[i]) && !inFunction) {
      inFunction = true;
      functionStart = i;
      braceCount = 0;
    }
    if (inFunction) {
      for (const ch of lines[i]) {
        if (ch === "{") braceCount++;
        if (ch === "}") braceCount--;
      }
      if (braceCount <= 0 && inFunction && i > functionStart) {
        const funcLength = i - functionStart;
        if (funcLength > 50) {
          issues.push({
            severity: "info",
            description: `Long function (~${funcLength} lines) starting at line ${functionStart + 1}`,
            location: `line ${functionStart + 1}`,
          });
        }
        inFunction = false;
      }
    }
  }

  // Import analysis
  const imports = lines.filter((l) => l.trim().startsWith("import "));
  if (imports.length > 15) {
    architecturalNotes.push(
      `File imports from ${imports.length} modules — high coupling, consider if all are needed`
    );
  }

  // Type safety
  const anyCount = (code.match(/:\s*any\b/g) || []).length;
  if (anyCount > 0) {
    suggestions.push(
      `Found ${anyCount} uses of 'any' type — add specific types for better safety`
    );
  }

  const summary =
    issues.length === 0 && suggestions.length === 0
      ? `${filePath} looks clean — no significant issues detected`
      : `Found ${issues.length} issue(s) and ${suggestions.length} suggestion(s) in ${filePath}`;

  return { summary, issues, suggestions, architecturalNotes };
}

/**
 * Check if LLM backend is available.
 */
export async function isLLMAvailable(): Promise<boolean> {
  const config = await loadConfig();
  return config !== null;
}
