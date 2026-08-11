import type { ExternalPathDisclosure } from "#src/denial-messages";

function wrap(label: string, value: string): string {
  const termWidth = (process.stdout.columns as number | undefined) ?? 80;
  const inline = `${label}${value}`;
  return inline.length > termWidth ? `${label}\n    ${value}` : inline;
}

export function formatExternalDirectoryAskPrompt(
  toolName: string,
  pathValue: string,
  resolvedPath: string | undefined,
  cwd: string,
  agentName?: string,
): string {
  const agentInfo = agentName ? `agent     : ${agentName}\n` : "";
  const resolved =
    resolvedPath && resolvedPath !== pathValue
      ? `\n${wrap("resolves : ", resolvedPath)}`
      : "";
  return `${agentInfo}  ${wrap("tool     : ", toolName)}\n  ${wrap("path     : ", pathValue)}${resolved}\n  ${wrap("cwd      : ", cwd)}\n\n⚠️  EXTERNAL DIRECTORY — allow access?`;
}

export function formatBashExternalDirectoryAskPrompt(
  command: string,
  externalPaths: ExternalPathDisclosure[],
  cwd: string,
  agentName?: string,
): string {
  const agentInfo = agentName ? `agent     : ${agentName}\n` : "";
  const pathLines = externalPaths
    .map(({ path, resolvedPath }) =>
      resolvedPath && resolvedPath !== path
        ? `${wrap("path     : ", path)}\n${wrap("resolves : ", resolvedPath)}`
        : wrap("path     : ", path),
    )
    .join("\n");
  return `${agentInfo}  ${wrap("bash     : ", command)}\n  ${pathLines}\n  ${wrap("cwd      : ", cwd)}\n\n⚠️  EXTERNAL DIRECTORY — allow access?`;
}
