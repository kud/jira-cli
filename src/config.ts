import chalk from "chalk"

export interface Config {
  baseUrl: string
  email: string
  token: string
}

export const loadConfig = (): Config => {
  const baseUrl = process.env["ATLASSIAN_BASE_URL"]
  const email = process.env["ATLASSIAN_USER_EMAIL"]
  const token = process.env["ATLASSIAN_API_TOKEN"]

  const missing = (
    [
      ["ATLASSIAN_BASE_URL", baseUrl],
      ["ATLASSIAN_USER_EMAIL", email],
      ["ATLASSIAN_API_TOKEN", token],
    ] as const
  )
    .filter(([, v]) => !v)
    .map(([k]) => k)

  if (missing.length > 0) {
    process.stderr.write(
      `${chalk.red("error:")} missing env vars: ${missing.join(", ")}\n`,
    )
    process.exit(1)
  }

  const rawUrl = baseUrl!.replace(/\/$/, "")
  const normalizedUrl = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`

  return {
    baseUrl: normalizedUrl,
    email: email!,
    token: token!,
  }
}
