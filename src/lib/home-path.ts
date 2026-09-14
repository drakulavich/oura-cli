import { homedir } from 'os';
import { sep } from 'path';

/**
 * A path for the screen: the home directory as `~`, the way a shell prints it. The full path of
 * the default cache ran to 60-odd columns before the sentence around it began (#130). Display only;
 * never feed the result back to the filesystem.
 */
export function homePath(path: string, home = homedir()): string {
  if (home === '') return path; // an unknown home must not turn every absolute path into ~/...
  if (path === home) return '~';
  return path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path;
}

/** `homePath` for every path quoted inside a sentence, such as an error message that names the file it could not open. */
export function homePathsIn(text: string, home = homedir()): string {
  if (home === '') return text;
  return text.split(home + sep).join('~' + sep);
}
