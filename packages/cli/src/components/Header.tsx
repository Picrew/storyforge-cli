import React from "react";
import { Box, Text } from "ink";
import { copy } from "../content/copy.js";
import { themeTokens } from "../theme/tokens.js";
import type { HeaderVariantMap, ViewportMode } from "../types.js";
import { GradientText } from "./GradientText.js";

const glyphs: Record<string, readonly string[]> = {
  S: ["▄████▄", "██    ", "▀████▄", "    ██", "▀████▀"],
  T: ["██████", " ▀██▀ ", "  ██  ", "  ██  ", "  ▀▀  "],
  O: ["▄████▄", "██  ██", "██  ██", "██  ██", "▀████▀"],
  R: ["████▄ ", "██  ██", "████▀ ", "██ ██ ", "██  ██"],
  Y: ["██  ██", "▀████▀", " ▀██▀ ", "  ██  ", "  ▀▀  "],
  F: ["██████", "██    ", "████  ", "██    ", "██    "],
  G: ["▄████▄", "██  ▀▀", "██ ███", "██  ██", "▀████▀"],
  E: ["██████", "██    ", "████  ", "██    ", "██████"]
};

function buildWordmarkRows(text: string, gap: string): string[] {
  const rowCount = glyphs[text[0]]?.length ?? 0;
  const rows = Array.from({ length: rowCount }, () => "");
  const letters = text.split("");

  letters.forEach((letter, index) => {
    const glyph = glyphs[letter];

    rows.forEach((_, rowIndex) => {
      rows[rowIndex] += glyph[rowIndex];
      if (index < letters.length - 1) {
        rows[rowIndex] += gap;
      }
    });
  });

  return rows;
}

function wrapRows(rows: readonly string[]): string[] {
  const width = Math.max(...rows.map((row) => row.length));
  return rows.map((row) => `> ${row.padEnd(width)} <`);
}

function buildShadowRow(rows: readonly string[]): string {
  const width = Math.max(...rows.map((row) => row.length));
  let shadow = "";

  for (let column = 0; column < width; column += 1) {
    const isFilled = rows.some((row) => (row[column] ?? " ") !== " ");
    shadow += isFilled ? ":" : " ";
  }

  return `  ${shadow}  `;
}

function buildHeroVariant(): string[] {
  const rows = buildWordmarkRows(copy.brand, "  ");
  const wrappedRows = wrapRows(rows);
  const lineWidth = wrappedRows[0].length;
  const topRule = `/${"=".repeat(lineWidth - 2)}\\`;

  return [topRule, ...wrappedRows, buildShadowRow(rows)];
}

function buildCompactVariant(): string[] {
  const rows = buildWordmarkRows(copy.brand, " ");
  return [...wrapRows(rows), buildShadowRow(rows)];
}

export const headerVariants: HeaderVariantMap = {
  hero: buildHeroVariant(),
  compact: buildCompactVariant(),
  minimal: [":: STORYFORGE ::"]
};

interface HeaderProps {
  mode: ViewportMode;
}

function isShadowRow(mode: ViewportMode, index: number): boolean {
  if (mode === "minimal") {
    return false;
  }

  return index === headerVariants[mode].length - 1;
}

function isFrameRow(mode: ViewportMode, index: number): boolean {
  return mode === "hero" && index === 0;
}

export function Header({ mode }: HeaderProps): React.JSX.Element {
  const ornament = mode === "hero" ? "----------------" : "----------";
  const strapline = mode === "minimal" ? "story workspace" : "chapter zero // story workspace";
  const shellLabel = copy.brand;
  const shellSuffix = " // v0.1.4";

  return (
    <Box flexDirection="column" alignItems="center">
      <Text color={themeTokens.accentSecondary}>{strapline}</Text>
      <Box flexDirection="column" alignItems="center">
        {headerVariants[mode].map((line, index) => {
          if (isFrameRow(mode, index)) {
            return (
              <Text key={`${mode}-${index}-${line}`} color={themeTokens.border}>
                {line}
              </Text>
            );
          }

          if (isShadowRow(mode, index)) {
            return (
              <Text key={`${mode}-${index}-${line}`} color={themeTokens.textSecondary}>
                {line}
              </Text>
            );
          }

          return <GradientText key={`${mode}-${index}-${line}`}>{line}</GradientText>;
        })}
      </Box>
      <Box marginTop={mode === "minimal" ? 0 : 1}>
        <Text color={themeTokens.accent} bold>
          {shellLabel}
        </Text>
        <Text color={themeTokens.textSecondary}>{shellSuffix}</Text>
      </Box>
      <Box marginTop={1}>
        {mode === "minimal" ? null : <Text color={themeTokens.border}>{ornament}</Text>}
        <Text color={themeTokens.textSecondary}> {copy.subtitle} </Text>
        {mode === "minimal" ? null : <Text color={themeTokens.border}>{ornament}</Text>}
      </Box>
    </Box>
  );
}
