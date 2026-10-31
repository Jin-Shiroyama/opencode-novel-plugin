/**
 * テスト用のコンパイル出力（test-out/）を、プラグインのルートと同じ形にそろえる。
 *
 * src/index.ts は自分の位置から見た `../commands` と `../skills` を読む。
 * テストでは本体が test-out/src/ に出力されるため、test-out/ の直下に
 * 実物の commands/ と skills/ を写しておく（本体側をテストに合わせて変えないため）。
 */
import { cpSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const out = join(root, "test-out")

for (const dir of ["commands", "skills"]) {
  rmSync(join(out, dir), { recursive: true, force: true })
  cpSync(join(root, dir), join(out, dir), { recursive: true })
}
