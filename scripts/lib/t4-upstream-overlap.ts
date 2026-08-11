export function parseGitPathList(output: string): ReadonlyArray<string> {
  return output.split("\0").filter((path) => path.length > 0);
}

export function findT4UpstreamOverlaps(
  t4Paths: ReadonlyArray<string>,
  upstreamPaths: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const upstream = new Set(upstreamPaths);
  return [...new Set(t4Paths.filter((path) => upstream.has(path)))].toSorted();
}
