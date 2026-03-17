import React from "react";
import { Box, Text } from "ink";
import type { StoryLibraryEntry } from "../story/types.js";
import { themeTokens } from "../theme/tokens.js";
import { truncateEndByWidth } from "../utils/display-width.js";

interface ProjectDialogProps {
  width: number;
  projects: readonly StoryLibraryEntry[];
  currentProjectId: string | null;
  selectedIndex: number;
}

export function ProjectDialog({
  width,
  projects,
  currentProjectId,
  selectedIndex
}: ProjectDialogProps): React.JSX.Element {
  const rowWidth = 4;
  const statusWidth = Math.max(8, Math.min(14, Math.floor(width * 0.18)));
  const titleWidth = Math.max(12, Math.min(26, Math.floor(width * 0.26)));
  const fileWidth = Math.max(8, width - rowWidth - statusWidth - titleWidth - 14);
  const windowSize = 10;
  const safeSelectedIndex =
    projects.length > 0 ? Math.min(selectedIndex, projects.length - 1) : 0;
  const maxStartIndex = Math.max(0, projects.length - windowSize);
  const startIndex = Math.min(
    maxStartIndex,
    Math.max(0, safeSelectedIndex - Math.floor(windowSize / 2))
  );
  const visibleProjects = projects.slice(startIndex, startIndex + windowSize);
  const shownEndIndex = visibleProjects.length > 0 ? startIndex + visibleProjects.length : 0;

  return (
    <Box
      width={width}
      flexDirection="column"
      borderStyle="round"
      borderColor={themeTokens.textSecondary}
      paddingX={2}
      paddingY={1}
    >
      <Box justifyContent="space-between">
        <Text bold color={themeTokens.accentSecondary}>
          Open project
        </Text>
        <Text color={themeTokens.textSecondary}>esc</Text>
      </Box>
      <Text color={themeTokens.textSecondary}>
        {projects.length} saved project(s)
      </Text>
      <Box marginTop={1} flexDirection="column">
        {visibleProjects.map((project, index) => {
          const listIndex = startIndex + index;
          const isSelected = listIndex === safeSelectedIndex;
          const rowLabel = `${String(listIndex + 1).padStart(2, "0")}${project.id === currentProjectId ? "*" : " "}`;

          return (
            <Box key={project.id}>
              <Text color={themeTokens.textSecondary}>  </Text>
              <Text
                color={isSelected ? "black" : themeTokens.textPrimary}
                backgroundColor={isSelected ? themeTokens.accentSecondary : undefined}
              >
                {rowLabel.padEnd(rowWidth, " ")}
              </Text>
              <Text color={themeTokens.textSecondary}> </Text>
              <Text
                color={isSelected ? "black" : themeTokens.textPrimary}
                backgroundColor={isSelected ? themeTokens.accentSecondary : undefined}
              >
                {truncateEndByWidth(project.title, titleWidth).padEnd(titleWidth, " ")}
              </Text>
              <Text color={themeTokens.textSecondary}> </Text>
              <Text
                color={isSelected ? "black" : themeTokens.textSecondary}
                backgroundColor={isSelected ? themeTokens.accentSecondary : undefined}
              >
                {truncateEndByWidth(project.status, statusWidth).padEnd(statusWidth, " ")}
              </Text>
              <Text color={themeTokens.textSecondary}> </Text>
              <Text
                color={isSelected ? "black" : themeTokens.textSecondary}
                backgroundColor={isSelected ? themeTokens.accentSecondary : undefined}
              >
                {truncateEndByWidth(project.file, fileWidth)}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color={themeTokens.textSecondary}>
          {visibleProjects.length === 0
            ? "0 projects"
            : `showing ${startIndex + 1}-${shownEndIndex} of ${projects.length}`}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color={themeTokens.accent}>up/down</Text>
        <Text color={themeTokens.textSecondary}> move  </Text>
        <Text color={themeTokens.accent}>enter</Text>
        <Text color={themeTokens.textSecondary}> open</Text>
      </Box>
    </Box>
  );
}
