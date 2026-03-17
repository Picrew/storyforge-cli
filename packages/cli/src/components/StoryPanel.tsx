import React from "react";
import { Box, Text } from "ink";
import type { StoryProject, StoryView } from "../story/types.js";
import { themeTokens } from "../theme/tokens.js";
import { truncateEndByWidth, wrapTextByWidth } from "../utils/display-width.js";

interface StoryPanelProps {
  width: number;
  project: StoryProject;
  activeView: StoryView | null;
  projectPathLabel: string;
}

interface TableColumn<Row> {
  key: keyof Row | "row";
  label: string;
  width: number;
}

function padEnd(value: string, width: number): string {
  const truncated = truncateEndByWidth(value, width);
  return truncated.padEnd(width, " ");
}

function buildWorldLines(project: StoryProject, bodyWidth: number): string[] {
  const entries: Array<[string, string]> = [
    ["premise", project.world.premise],
    ["setting", project.world.setting],
    ["tone", project.world.tone],
    ["rules", project.world.rules],
    ["stakes", project.world.stakes],
    ["resolution", project.world.resolutionShape]
  ];
  const labelWidth = Math.max(12, Math.min(18, Math.floor(bodyWidth * 0.25)));
  const valueWidth = Math.max(10, bodyWidth - labelWidth - 3);
  const lines: string[] = [];

  for (const [label, value] of entries) {
    const wrapped = wrapTextByWidth(value || " ", valueWidth);

    wrapped.forEach((line, index) => {
      lines.push(
        `${index === 0 ? padEnd(label, labelWidth) : " ".repeat(labelWidth)} | ${padEnd(line, valueWidth)}`
      );
    });
  }

  return lines;
}

function buildTableLines<Row extends object>(
  columns: readonly TableColumn<Row>[],
  rows: readonly Row[],
  emptyMessage: string
): string[] {
  const divider = columns.map((column) => "-".repeat(column.width)).join("-+-");
  const header = columns.map((column) => padEnd(column.label, column.width)).join(" | ");
  const lines: string[] = [header, divider];

  if (rows.length === 0) {
    lines.push(emptyMessage);
    return lines;
  }

  rows.forEach((row, rowIndex) => {
    const rowRecord = row as Record<string, unknown>;
    const wrappedCells = columns.map((column) => {
      const key = String(column.key);
      const rawValue =
        column.key === "row"
          ? String(rowIndex + 1)
          : key in rowRecord
            ? String(rowRecord[key] ?? "")
            : "";

      return wrapTextByWidth(rawValue || " ", column.width);
    });
    const maxLines = Math.max(...wrappedCells.map((cell) => cell.length));

    for (let lineIndex = 0; lineIndex < maxLines; lineIndex += 1) {
      lines.push(
        columns
          .map((column, columnIndex) => padEnd(wrappedCells[columnIndex][lineIndex] ?? "", column.width))
          .join(" | ")
      );
    }
  });

  return lines;
}

function buildCharacterLines(project: StoryProject, bodyWidth: number): string[] {
  const columns = [
    { key: "row", label: "#", width: 3 },
    { key: "name", label: "Name", width: Math.max(10, Math.floor(bodyWidth * 0.16)) },
    { key: "role", label: "Role", width: Math.max(8, Math.floor(bodyWidth * 0.12)) },
    { key: "motivation", label: "Motivation", width: Math.max(12, Math.floor(bodyWidth * 0.2)) },
    { key: "conflict", label: "Conflict", width: Math.max(12, Math.floor(bodyWidth * 0.2)) },
    { key: "arc", label: "Arc", width: Math.max(12, bodyWidth - 3 - 10 - 8 - 12 - 12 - 15) }
  ] satisfies readonly TableColumn<(typeof project.characters)[number]>[];

  return buildTableLines(columns, project.characters, "No characters yet.");
}

function buildTimelineLines(project: StoryProject, bodyWidth: number): string[] {
  const columns = [
    { key: "row", label: "#", width: 3 },
    { key: "label", label: "Beat", width: Math.max(10, Math.floor(bodyWidth * 0.16)) },
    { key: "summary", label: "Summary", width: Math.max(18, Math.floor(bodyWidth * 0.34)) },
    { key: "chapterRef", label: "Chapter", width: Math.max(9, Math.floor(bodyWidth * 0.12)) },
    { key: "stakes", label: "Stakes", width: Math.max(12, bodyWidth - 3 - 10 - 18 - 9 - 12) }
  ] satisfies readonly TableColumn<(typeof project.timeline)[number]>[];

  return buildTableLines(columns, project.timeline, "No timeline beats yet.");
}

function buildOutlineLines(project: StoryProject, bodyWidth: number): string[] {
  const columns = [
    { key: "row", label: "#", width: 3 },
    { key: "number", label: "No", width: 4 },
    { key: "title", label: "Title", width: Math.max(10, Math.floor(bodyWidth * 0.16)) },
    { key: "purpose", label: "Purpose", width: Math.max(12, Math.floor(bodyWidth * 0.2)) },
    { key: "summary", label: "Summary", width: Math.max(18, Math.floor(bodyWidth * 0.28)) },
    { key: "hook", label: "Hook", width: Math.max(12, bodyWidth - 3 - 4 - 10 - 12 - 18 - 15) }
  ] satisfies readonly TableColumn<(typeof project.outline)[number]>[];

  return buildTableLines(columns, project.outline, "No outline rows yet.");
}

function getBodyLines(project: StoryProject, activeView: StoryView | null, bodyWidth: number): string[] {
  switch (activeView ?? "world") {
    case "world":
      return buildWorldLines(project, bodyWidth);
    case "characters":
      return buildCharacterLines(project, bodyWidth);
    case "timeline":
      return buildTimelineLines(project, bodyWidth);
    case "outline":
      return buildOutlineLines(project, bodyWidth);
  }
}

// ── Card-format builders for transcript (no column tables) ──────────

function buildWorldCards(project: StoryProject): string[] {
  const entries: Array<[string, string]> = [
    ["premise", project.world.premise],
    ["setting", project.world.setting],
    ["tone", project.world.tone],
    ["rules", project.world.rules],
    ["stakes", project.world.stakes],
    ["resolution", project.world.resolutionShape]
  ];
  const lines: string[] = [];

  for (const [label, value] of entries) {
    if (!value) {
      continue;
    }

    lines.push(`${label}: ${value}`);
  }

  return lines.length > 0 ? lines : ["No world details yet."];
}

function buildCharacterCards(project: StoryProject): string[] {
  if (project.characters.length === 0) {
    return ["No characters yet."];
  }

  const lines: string[] = [];

  project.characters.forEach((char, index) => {
    if (index > 0) {
      lines.push("");
    }

    const roleLabel = char.role ? ` · ${char.role}` : "";
    lines.push(`[${index + 1}] ${char.name}${roleLabel}`);

    if (char.motivation) {
      lines.push(`    Motivation: ${char.motivation}`);
    }

    if (char.conflict) {
      lines.push(`    Conflict: ${char.conflict}`);
    }

    if (char.arc) {
      lines.push(`    Arc: ${char.arc}`);
    }
  });

  return lines;
}

function buildTimelineCards(project: StoryProject): string[] {
  if (project.timeline.length === 0) {
    return ["No timeline beats yet."];
  }

  const lines: string[] = [];

  project.timeline.forEach((beat, index) => {
    if (index > 0) {
      lines.push("");
    }

    const chapterLabel = beat.chapterRef ? ` → Ch.${beat.chapterRef}` : "";
    lines.push(`[${index + 1}] ${beat.label}${chapterLabel}`);

    if (beat.summary) {
      lines.push(`    ${beat.summary}`);
    }

    if (beat.stakes) {
      lines.push(`    Stakes: ${beat.stakes}`);
    }
  });

  return lines;
}

function buildOutlineCards(project: StoryProject): string[] {
  if (project.outline.length === 0) {
    return ["No outline rows yet."];
  }

  const lines: string[] = [];

  project.outline.forEach((chapter, index) => {
    if (index > 0) {
      lines.push("");
    }

    const wordLabel = chapter.targetWords ? ` · ${chapter.targetWords}w` : "";
    lines.push(`[Ch.${chapter.number}] ${chapter.title}${wordLabel}`);

    if (chapter.purpose) {
      lines.push(`    Purpose: ${chapter.purpose}`);
    }

    if (chapter.summary) {
      lines.push(`    Summary: ${chapter.summary}`);
    }

    if (chapter.hook) {
      lines.push(`    Hook: ${chapter.hook}`);
    }
  });

  return lines;
}

function getCardLines(project: StoryProject, activeView: StoryView | null): string[] {
  switch (activeView ?? "world") {
    case "world":
      return buildWorldCards(project);
    case "characters":
      return buildCharacterCards(project);
    case "timeline":
      return buildTimelineCards(project);
    case "outline":
      return buildOutlineCards(project);
  }
}

export function buildStorySnapshot(
  project: StoryProject,
  activeView: StoryView | null,
  projectPathLabel: string,
  width: number,
  options?: {
    maxBodyLines?: number;
  }
): string {
  const bodyWidth = Math.max(24, width);
  const currentView = activeView ?? "world";
  const header = truncateEndByWidth(`STORY PROJECT | ${project.meta.title}`, bodyWidth);
  const meta = truncateEndByWidth(
    `status ${project.meta.status}  view ${currentView}  ${projectPathLabel}`,
    bodyWidth
  );
  const divider = "-".repeat(bodyWidth);
  const bodyLines = getBodyLines(project, activeView, bodyWidth);
  const maxBodyLines = options?.maxBodyLines;
  const visibleBodyLines =
    maxBodyLines && bodyLines.length > maxBodyLines
      ? [...bodyLines.slice(0, maxBodyLines), "..."]
      : bodyLines;

  return [header, meta, divider, ...visibleBodyLines].join("\n");
}

export function buildStoryTranscriptSnapshot(
  project: StoryProject,
  activeView: StoryView | null,
  projectPathLabel: string,
  width: number
): string {
  const bodyWidth = Math.max(24, width);
  const currentView = activeView ?? "world";
  const header = truncateEndByWidth(`STORY PROJECT | ${project.meta.title}`, bodyWidth);
  const meta = truncateEndByWidth(
    `status ${project.meta.status}  view ${currentView}  ${projectPathLabel}`,
    bodyWidth
  );
  const divider = "-".repeat(bodyWidth);
  const bodyLines = getCardLines(project, activeView);

  return [header, meta, divider, ...bodyLines].join("\n");
}

export function StoryPanel({
  width,
  project,
  activeView,
  projectPathLabel
}: StoryPanelProps): React.JSX.Element {
  const innerWidth = Math.max(24, width - 4);
  const lines = buildStorySnapshot(project, activeView, projectPathLabel, innerWidth).split("\n");

  return (
    <Box
      width={width}
      flexDirection="column"
      borderStyle="single"
      borderColor={themeTokens.border}
      paddingX={1}
    >
      {lines.map((line, index) => (
        <Text
          key={`${activeView ?? "world"}-${index}`}
          color={
            index === 0
              ? themeTokens.accent
              : index === 1
                ? themeTokens.textSecondary
                : index === 2
                  ? themeTokens.border
                  : themeTokens.textPrimary
          }
          bold={index === 0}
        >
          {line}
        </Text>
      ))}
    </Box>
  );
}
