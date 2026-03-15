import React from "react";
import { Box, Text } from "ink";
import type { PendingTask } from "../story/types.js";
import type { TranscriptEntry } from "../types.js";
import { themeTokens } from "../theme/tokens.js";
import { wrapTextByWidth } from "../utils/display-width.js";
import { useSpinner } from "./useSpinner.js";

interface ResponsePanelProps {
  width: number;
  turns: readonly TranscriptEntry[];
  scrollOffset: number;
  visibleLines?: number;
  pendingTask: PendingTask | null;
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

function pushPreformattedLines(
  lines: TranscriptLine[],
  keyPrefix: string,
  value: string,
  color: string,
  width: number
): void {
  const availableWidth = Math.max(1, width - 3);
  const rows = value ? value.split("\n") : [" "];

  rows.forEach((row, rowIndex) => {
    const wrapped = wrapTextByWidth(row || " ", availableWidth);

    wrapped.forEach((line, lineIndex) => {
      lines.push({
        key: `${keyPrefix}-pre-${rowIndex}-${lineIndex}`,
        text: `   ${line}`,
        color
      });
    });
  });
}

function buildTranscriptLines(
  turns: readonly TranscriptEntry[],
  width: number,
  pendingTask: PendingTask | null,
  spinnerFrame: string
): readonly TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  const lastIndex = turns.length - 1;

  turns.forEach((turn, index) => {
    if (index > 0) {
      lines.push({
        key: `${turn.id}-gap`,
        text: "",
        color: themeTokens.textSecondary
      });
    }

    const lineColor = turn.failed ? themeTokens.notice : themeTokens.textPrimary;
    const isLocalStoryEntry =
      turn.provider === "storyforge" &&
      (turn.model === "story/project" || turn.model === "story/library");

    if (isLocalStoryEntry) {
      const responseRows = (turn.response || "").split("\n");
      const headline = responseRows[0] || "";
      const detail = responseRows.slice(1).join("\n");

      pushWrappedLines(
        lines,
        turn.id,
        "Story",
        headline ? `${turn.prompt} · ${headline}` : turn.prompt,
        lineColor,
        width
      );

      if (detail) {
        pushPreformattedLines(lines, turn.id, detail, lineColor, width);
      }

      return;
    }

    const isLastTurn = index === lastIndex;
    let statusSuffix = "";
    if (isLastTurn) {
      if (turn.streaming) {
        statusSuffix = ` ${spinnerFrame} streaming`;
      } else if (pendingTask) {
        statusSuffix = ` ${spinnerFrame} running`;
      } else if (turn.failed) {
        statusSuffix = " ✗ failed";
      } else {
        statusSuffix = " ✓ done";
      }
    }

    lines.push({
      key: `${turn.id}-meta`,
      text: `Build ${index + 1} · ${turn.model}${statusSuffix}`,
      color: themeTokens.accentSecondary
    });
    pushWrappedLines(lines, turn.id, "You", turn.prompt, themeTokens.textPrimary, width);
    pushWrappedLines(
      lines,
      turn.id,
      turn.failed ? "Error" : "Assistant",
      turn.response || (turn.streaming || (isLastTurn && pendingTask) ? "..." : ""),
      lineColor,
      width
    );
  });

  return lines;
}

export function ResponsePanel({
  width,
  turns,
  scrollOffset,
  visibleLines = 14,
  pendingTask
}: ResponsePanelProps): React.JSX.Element {
  const isRunning = Boolean(pendingTask) || Boolean(turns[turns.length - 1]?.streaming);
  const spinnerFrame = useSpinner(isRunning);
  const divider = "-".repeat(Math.max(12, width - 6));
  const bodyWidth = Math.max(12, width - 6);
  const allLines = buildTranscriptLines(turns, bodyWidth, pendingTask, spinnerFrame);
  const clampedVisibleLines = Math.max(6, visibleLines);
  const maxOffset = Math.max(0, allLines.length - clampedVisibleLines);
  const safeOffset = Math.min(scrollOffset, maxOffset);
  const endIndex = Math.max(0, allLines.length - safeOffset);
  const startIndex = Math.max(0, endIndex - clampedVisibleLines);
  const visibleTranscript = allLines.slice(startIndex, endIndex);
  const fillerCount = Math.max(0, clampedVisibleLines - visibleTranscript.length);
  const lastTurn = turns[turns.length - 1];
  const title = lastTurn?.streaming
    ? "STREAMING TRANSCRIPT"
    : pendingTask
      ? "RUNNING TRANSCRIPT"
      : "TRANSCRIPT";
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
