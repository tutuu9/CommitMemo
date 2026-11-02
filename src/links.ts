const SEGMENT = '[A-Za-z0-9_.-]+';

function repositoryPath(path: string): string | undefined {
  const normalized = path
    .replace(/^\//u, '')
    .replace(/\/$/u, '')
    .replace(/\.git$/u, '');
  if (!new RegExp(`^${SEGMENT}/${SEGMENT}$`, 'u').test(normalized))
    return undefined;
  if (normalized.split('/').some((part) => part === '.' || part === '..'))
    return undefined;
  return `https://github.com/${normalized}`;
}

export function githubRepository(remote?: string): string | undefined {
  if (!remote) return undefined;
  const scp = /^git@github\.com:(.+)$/u.exec(remote);
  if (scp?.[1]) return repositoryPath(scp[1]);
  try {
    const url = new URL(remote);
    if (
      !['https:', 'ssh:'].includes(url.protocol) ||
      url.hostname !== 'github.com' ||
      url.port ||
      url.search ||
      url.hash
    )
      return undefined;
    return repositoryPath(url.pathname);
  } catch {
    return undefined;
  }
}

export function pullRequestLinks(
  message: string,
  base?: string,
): { number: number; url: string }[] {
  const links = new Map<string, { number: number; url: string }>();
  const explicit = new RegExp(
    `https://github\\.com/(${SEGMENT})/(${SEGMENT})/pull/(\\d+)(?![\\dA-Za-z_-])`,
    'gu',
  );
  for (const match of message.matchAll(explicit)) {
    const number = Number(match[3]);
    const repository = repositoryPath(`${match[1]}/${match[2]}`);
    if (!repository || !Number.isSafeInteger(number) || number < 1) continue;
    const url = `${repository}/pull/${number}`;
    links.set(url, { number, url });
  }
  if (base) {
    for (const match of message.matchAll(/\bMerge pull request #(\d+)\b/gu)) {
      const number = Number(match[1]);
      if (!Number.isSafeInteger(number) || number < 1) continue;
      const url = `${base}/pull/${number}`;
      links.set(url, { number, url });
    }
  }
  return [...links.values()];
}
