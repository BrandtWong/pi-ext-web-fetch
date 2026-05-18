import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function checkW3mAvailable(): Promise<boolean> {
  try {
    await execFileAsync("w3m", ["-version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function w3mFetch(
  url: string,
  proxyUrl: string | undefined,
  timeout: number,
): Promise<string> {
  const env: Record<string, string> = { ...process.env };

  if (proxyUrl) {
    env.http_proxy = proxyUrl;
    env.https_proxy = proxyUrl;
  }

  const { stdout } = await execFileAsync(
    "w3m",
    ["-dump", "-no-cookie", url],
    {
      timeout,
      encoding: "utf-8",
      maxBuffer: 5 * 1024 * 1024, // 5MB
      env,
    },
  );

  return stdout.trim();
}
