import os from "node:os";
import path from "node:path";

export function tildeifyPath(targetPath: string): string {
  const homeDirectory = os.homedir();

  if (targetPath === homeDirectory) {
    return "~";
  }

  if (targetPath.startsWith(`${homeDirectory}${path.sep}`)) {
    return `~${targetPath.slice(homeDirectory.length)}`;
  }

  return targetPath;
}

export function shortenPath(targetPath: string, maxLength: number): string {
  if (maxLength <= 0) {
    return "";
  }

  if (targetPath.length <= maxLength) {
    return targetPath;
  }

  if (maxLength <= 3) {
    return targetPath.slice(targetPath.length - maxLength);
  }

  const basename = path.basename(targetPath);
  const suffix = `${path.sep}${basename}`;
  const shortened = `...${suffix}`;

  if (shortened.length <= maxLength) {
    return shortened;
  }

  return `...${basename.slice(basename.length - (maxLength - 3))}`;
}

