/**
 * opencode-novel-plugin - agent 設定の重ね合わせ
 *
 * プラグインが用意する agent の既定に、opencode.json 側の設定を重ねる。
 * プラグインの入口（index.ts）から関数を export すると、OpenCode がそれを
 * プラグインとして呼ぶことがあるため、この処理は別のモジュールに置く。
 */

/**
 * 中身ごと重ねるキー。
 *
 * OpenCode は config フックに渡す前に、利用者の agent 設定を正規化して
 * `options: {}` と `permission: {}` を足す（利用者が model しか書いていなくても）。
 * キー単位で利用者の値を勝たせるだけだと、この空のオブジェクトがプラグインの
 * 既定を消す。実際に、opencode.json で novel-writer の model を指定すると
 * `webfetch: "deny"` などの権限が消え、OpenCode の既定（すべて許可）で動いていた。
 */
const NESTED_KEYS = new Set(["permission", "options", "tools"])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * プラグインの agent 既定に、利用者の設定を重ねる。
 *
 *   - permission / options / tools は、両方がオブジェクトなら中身を重ねる
 *     （利用者が書いたキーだけが勝ち、書いていないキーはプラグインの既定が残る）
 *   - それ以外のキーは、利用者が値を書いていれば利用者が勝つ
 *
 * permission の中の1つのキー（bash など）の値は丸ごと入れ替える。
 * 利用者が `bash: { "git *": "allow" }` と書けば、プラグインの `bash: "deny"` は使わない。
 */
export function mergeAgentConfig(
  plugin: Record<string, unknown>,
  user: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!user) return { ...plugin }
  const merged: Record<string, unknown> = { ...plugin }
  for (const [key, value] of Object.entries(user)) {
    if (value === undefined) continue
    const base = plugin[key]
    merged[key] = NESTED_KEYS.has(key) && isPlainObject(base) && isPlainObject(value) ? { ...base, ...value } : value
  }
  return merged
}
