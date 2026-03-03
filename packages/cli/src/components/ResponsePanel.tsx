import React from "react";
import { Box, Text } from "ink";
import type { TranscriptEntry } from "../types.js";
import { themeTokens } from "../theme/tokens.js";
import { wrapTextByWidth } from "../utils/display-width.js";

interface ResponsePanelProps {
  width: number;
  turns: readonly TranscriptEntry[];
  scrollOffset: number;
  visibleLines?: number;
}

interface TranscriptLine {
  key: string;
  text: string;
  color: string;
}

function pushWrappedLines(
  lines: TranscriptLine[],
  keyPrefix: string,
  label: string,
  value: string,
  color: string,
  width: number
): void {
  const wrapped = wrapTextByWidth(value || " ", width);

  wrapped.forEach((line, index) => {
    lines.push({
      key: `${keyPrefix}-${label}-${index}`,
      text: index === 0 ? `${label}: ${line}` : `   ${line}`,
      color
    });
  });
}

function buildTranscriptLines(turns: readonly TranscriptEntry[], width: number): readonly TranscriptLine[] {
  const lines: TranscriptLine[] = [];

  turns.forEach((turn, index) => {
    if (index > 0) {
      lines.push({
        key: `${turn.id}-gap`,
        text: "",
        color: themeTokens.textSecondary
      });
    }

    lines.push({
      key: `${turn.id}-meta`,
      text: `Build ${index + 1} · ${turn.model}${turn.streaming ? " · streaming" : ""}`,
      color: themeTokens.accentSecondary
    });
    pushWrappedLines(lines, turn.id, "You", turn.prompt, themeTokens.textPrimary, width);
    pushWrappedLines(
      lines,
      turn.id,
      turn.failed ? "Error" : "Assistant",
      turn.response || (turn.streaming ? "..." : ""),
      turn.failed ? themeTokens.notice : themeTokens.textPrimary,
      width
    );
  });

  return lines;
}

export function ResponsePanel({
  width,
  turns,
  scrollOffset,
  visibleLines = 14
}: ResponsePanelProps): React.JSX.Element {
  const divider = "-".repeat(Math.max(12, width - 6));
  const bodyWidth = Math.max(12, width - 6);
  const allLines = buildTranscriptLines(turns, bodyWidth);
  const clampedVisibleLines = Math.max(6, visibleLines);
  const maxOffset = Math.max(0, allLines.length - clampedVisibleLines);
  const safeOffset = Math.min(scrollOffset, maxOffset);
  const endIndex = Math.max(0, allLines.length - safeOffset);
  const startIndex = Math.max(0, endIndex - clampedVisibleLines);
  const visibleTranscript = allLines.slice(startIndex, endIndex);
  const fillerCount = Math.max(0, clampedVisibleLines - visibleTranscript.length);
  const title = turns[turns.length - 1]?.streaming ? "STREAMING TRANSCRIPT" : "TRANSCRIPT";
  const badge = safeOffset > 0 ? `scroll ${safeOffset}/${maxOffset}` : `${turns.length} turns`;

  return (
    <Box
      width={width}
      flexDirection="column"
      borderStyle="single"
      borderColor={themeTokens.border}
      paddingX={2}
    >
      <Box justifyContent="space-between">
        <Text bold color={themeTokens.accent}>
          {title}
        </Text>
        <Text color={themeTokens.accentSecondary}>{badge}</Text>
      </Box>
      <Text color={themeTokens.border}>{divider}</Text>
      {visibleTranscript.map((line) => (
        <Text key={line.key} color={line.color}>
          {line.text || " "}
        </Text>
      ))}
      {Array.from({ length: fillerCount }, (_, index) => (
        <Text key={`filler-${index}`} color={themeTokens.textSecondary}>
          {" "}
        </Text>
      ))}
    </Box>
  );
}
