import React from "react";
import { Box, Text } from "ink";
import { copy } from "../content/copy.js";
import { shouldUseCompactFooter } from "../layout/viewport.js";
import type { PendingTask } from "../story/types.js";
import { themeTokens } from "../theme/tokens.js";
import { shortenPath, tildeifyPath } from "../utils/path.js";
import { useSpinner } from "./useSpinner.js";

interface FooterProps {
  cwd: string;
  width: number;
  pendingTask?: PendingTask | null;
}

function formatTaskLabel(task: PendingTask): string {
  const kindLabels: Record<string, string> = {
    chat: "chat",
    "story-bootstrap": "bootstrap",
    "story-refresh": "refresh",
    "story-commit": "commit",
    "story-ci": "ci",
    "story-render": "render",
    "story-compile": "compile"
  };
  return kindLabels[task.kind] ?? task.kind;
}

function formatTaskProgress(task: PendingTask): string {
  const stage = task.totalStages && task.stageIndex
    ? ` stage ${task.stageIndex}/${task.totalStages}`
    : "";
  const elapsedMs = task.startedAt ? Math.max(0, Date.now() - task.startedAt) : 0;
  const elapsed = elapsedMs >= 1_000 ? ` ${Math.floor(elapsedMs / 1_000)}s` : "";
  const retries = task.retryCount ? ` retry ${task.retryCount}` : "";
  const checkpoint = task.checkpointPath ? " checkpoint ✓" : "";
  return ` running${stage}${elapsed}${retries}${checkpoint}`;
}

export function Footer({ cwd, width, pendingTask }: FooterProps): React.JSX.Element {
  const spinnerFrame = useSpinner(Boolean(pendingTask));

  if (shouldUseCompactFooter(width)) {
    if (pendingTask) {
      return (
        <Text color={themeTokens.accent}>
          {spinnerFrame} {formatTaskLabel(pendingTask)}{formatTaskProgress(pendingTask)}
        </Text>
      );
    }
    return (
      <Box>
        <Text color={themeTokens.success}>✓ </Text>
        <Text color={themeTokens.textSecondary}>{copy.footer.compact}</Text>
      </Box>
    );
  }

  const rightLabel = copy.footer.right;
  const statusIcon = pendingTask ? spinnerFrame : "✓";
  const statusText = pendingTask
    ? `${formatTaskLabel(pendingTask)}${formatTaskProgress(pendingTask)}`
    : copy.footer.center;
  const statusColor = pendingTask ? themeTokens.accent : themeTokens.success;
  const reservedWidth = statusText.length + rightLabel.length + 10;
  const pathWidth = Math.max(10, width - reservedWidth);
  const displayPath = shortenPath(tildeifyPath(cwd), pathWidth);

  return (
    <Box width={width}>
      <Text color={themeTokens.accentSecondary}>{displayPath}</Text>
      <Box flexGrow={1} />
      <Text color={statusColor}>{statusIcon} {statusText}</Text>
      <Text color={themeTokens.textSecondary}>{"  "}{rightLabel}</Text>
    </Box>
  );
}
