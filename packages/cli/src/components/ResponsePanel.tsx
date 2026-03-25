import React from "react";
import { Box, Text } from "ink";
import type { PendingTask } from "../story/types.js";
import type { TranscriptEntry } from "../types.js";
import { themeTokens } from "../theme/tokens.js";
import { wrapTextByWidth } from "../utils/display-width.js";
import { useSpinner } from "./useSpinner.js";

function stripProviderFromModel(model: string, provider: string | undefined): string {
  if (!provider) {
    return model;
  }

  const prefix = `${provider}/`;

  if (model.toLowerCase().startsWith(prefix.toLowerCase())) {
    return model.slice(prefix.length);
  }

  return model;
}

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
  suffix?: string;
  suffixColor?: string;
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

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1_000);

  if (totalSeconds < 60) {
    const tenths = Math.floor((ms % 1_000) / 100);

    return `${totalSeconds}.${tenths}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}m ${seconds}s`;
}

function buildTranscriptLines(
  turns: readonly TranscriptEntry[],
  width: number,
  pendingTask: PendingTask | null,
  spinnerFrame: string
): readonly TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  const lastIndex = turns.length - 1;

  const storyDivider = `${"─".repeat(Math.max(8, width))}`;

  turns.forEach((turn, index) => {
    if (index > 0) {
      const prevTurn = turns[index - 1];
      const prevIsStory =
        prevTurn.provider === "storyforge" &&
        (prevTurn.model === "story/project" || prevTurn.model === "story/library");
      const currIsStory =
        turn.provider === "storyforge" &&
        (turn.model === "story/project" || turn.model === "story/library");

      if (prevIsStory || currIsStory) {
        // Prominent separator between story entries
        lines.push({
          key: `${turn.id}-gap-top`,
          text: "",
          color: themeTokens.textSecondary
        });
        lines.push({
          key: `${turn.id}-divider`,
          text: storyDivider,
          color: themeTokens.border
        });
        lines.push({
          key: `${turn.id}-gap-bottom`,
          text: "",
          color: themeTokens.textSecondary
        });
      } else {
        lines.push({
          key: `${turn.id}-gap`,
          text: "",
          color: themeTokens.textSecondary
        });
      }
    }

    const lineColor = turn.failed ? themeTokens.notice : themeTokens.textPrimary;
    const isLocalStoryEntry =
      turn.provider === "storyforge" &&
      (turn.model === "story/project" || turn.model === "story/library");

    if (isLocalStoryEntry) {
      const responseRows = (turn.response || "").split("\n");
      const message = responseRows[0] || "";
      const tableContent = responseRows.slice(1).join("\n");

      // Story section header — command + message on one accented line
      pushWrappedLines(
        lines,
        turn.id,
        "▸ Story",
        message ? `${turn.prompt} · ${message}` : turn.prompt,
        themeTokens.accentSecondary,
        width
      );

      if (tableContent) {
        pushPreformattedLines(lines, turn.id, tableContent, lineColor, width);
      }

      return;
    }

    const isLastTurn = index === lastIndex;
    const elapsed = turn.startedAt ? Date.now() - turn.startedAt : 0;
    const elapsedLabel = turn.startedAt && elapsed >= 100 ? ` ${formatElapsed(elapsed)}` : "";
    let statusSuffix = "";
    let statusColor = "";
    if (isLastTurn) {
      if (turn.streaming) {
        statusSuffix = ` ${spinnerFrame} streaming${elapsedLabel}`;
        statusColor = themeTokens.accent;
      } else if (pendingTask) {
        statusSuffix = ` ${spinnerFrame} running${elapsedLabel}`;
        statusColor = themeTokens.accent;
      } else if (turn.failed) {
        statusSuffix = ` ✗ failed${elapsedLabel}`;
        statusColor = themeTokens.notice;
      } else {
        statusSuffix = ` ✓ done${elapsedLabel}`;
        statusColor = themeTokens.success;
      }
    } else if (elapsedLabel) {
      statusSuffix = ` ✓ done${elapsedLabel}`;
      statusColor = themeTokens.textSecondary;
    }

    lines.push({
      key: `${turn.id}-meta`,
      text: `Build ${index + 1} · ${stripProviderFromModel(turn.model, turn.provider)}`,
      color: themeTokens.accentSecondary,
      suffix: statusSuffix || undefined,
      suffixColor: statusColor || undefined
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

function scrollbarChar(
  rowIndex: number,
  thumbStart: number,
  thumbSize: number
): { char: string; color: string } {
  if (rowIndex >= thumbStart && rowIndex < thumbStart + thumbSize) {
    return { char: "█", color: themeTokens.accent };
  }

  return { char: "│", color: themeTokens.border };
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
  const bodyWidth = Math.max(12, width - 6);
  const clampedVisibleLines = Math.max(6, visibleLines);
  const allLines = buildTranscriptLines(turns, bodyWidth, pendingTask, spinnerFrame);
  const hasOverflow = allLines.length > clampedVisibleLines;
  const divider = "-".repeat(Math.max(12, bodyWidth));
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

  // Scrollbar geometry — thumb shows viewport position within total content
  const thumbSize = hasOverflow
    ? Math.max(1, Math.round((clampedVisibleLines / allLines.length) * clampedVisibleLines))
    : 0;
  const thumbStart = hasOverflow && maxOffset > 0
    ? Math.round((startIndex / maxOffset) * (clampedVisibleLines - thumbSize))
    : 0;

  return (
    <Box
      width={width}
      flexDirection="column"
      borderStyle="single"
      borderColor={themeTokens.border}
      paddingLeft={2}
      paddingRight={hasOverflow ? 0 : 2}
    >
      <Box justifyContent="space-between">
        <Text bold color={themeTokens.accent}>
          {title}
        </Text>
        <Text color={themeTokens.accentSecondary}>{badge}</Text>
      </Box>
      <Text color={themeTokens.border}>{divider}</Text>
      {visibleTranscript.map((line, rowIndex) => {
        const sb = hasOverflow ? scrollbarChar(rowIndex, thumbStart, thumbSize) : null;

        return (
          <Box key={line.key}>
            <Box flexGrow={1}>
              <Text color={line.color}>{line.text || " "}</Text>
              {line.suffix ? <Text color={line.suffixColor}>{line.suffix}</Text> : null}
            </Box>
            {sb ? <Text color={sb.color}> {sb.char}</Text> : null}
          </Box>
        );
      })}
      {Array.from({ length: fillerCount }, (_, index) => {
        const rowIndex = visibleTranscript.length + index;
        const sb = hasOverflow ? scrollbarChar(rowIndex, thumbStart, thumbSize) : null;

        return (
          <Box key={`filler-${index}`}>
            <Box flexGrow={1}>
              <Text color={themeTokens.textSecondary}>{" "}</Text>
            </Box>
            {sb ? <Text color={sb.color}> {sb.char}</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}
