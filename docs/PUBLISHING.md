# Publishing checklist (Phase 3)

glyphdust を公開するための手順。**★印は不可逆 = 実行直前に必ず承認を取る。**

## 0. 公開前に決めること

- [x] **リポジトリ置き場所**: **LINNO org = `github.com/linno`** に決定（2026-06-22）。
      `package.json`（repository/homepage/bugs）と README の GIF raw URL は `linno/glyphdust` に設定済み。
- [ ] ★ GitHub org `linno` を作成（**未作成**・凜さんがアカウント操作で実施）。slug `linno` が空きかは作成時に確認。
- [ ] npm の公開アカウント。現状は無スコープ `glyphdust`（名前は空き確認済み 2026-06-22）。

## 1. 事前チェック（可逆・何度でも）

- [x] npm 名 `glyphdust` 空き（`npm view glyphdust` → 404）
- [x] `pnpm install --frozen-lockfile` 緑
- [x] `pnpm run typecheck` 緑
- [x] `pnpm run build` 緑
- [x] `npm pack --dry-run` 内容確認（LICENSE / README / dist のみ、9 files / ~86kB）
- [x] README の GIF は絶対 raw URL（npm ページでも表示される）
- [ ] `package.json` の `version` が正しい（初回 `0.1.0`）
- [ ] `LICENSE` の著作者表記（MIT © LINNO / NOGUCHILin）

## 2. GitHub 公開 ★

- [ ] ★ GitHub に公開リポジトリ作成（上で決めた置き場所）
- [ ] リモート追加 → `main` を push（`git push -u origin main`）
- [ ] push 後、README の GIF が GitHub 上で表示されることを確認
- [ ] CI（`.github/workflows/ci.yml`）が緑になることを確認

## 3. npm publish ★

- [ ] `npm login`（公開アカウント）
- [ ] `npm pack` で最終 tarball を目視
- [ ] ★ `npm publish --access public`（`prepublishOnly` が typecheck+build を自動実行）
- [ ] 公開後 `npm view glyphdust` で確認、別ディレクトリで `npm i glyphdust` 動作確認

## 4. 公開後

- [ ] LINNO サイトの依存を `file:../../../glyphdust` → `glyphdust@^0.1.0` へ差し替え（検証ページ `/lab/glyphdust`）
- [ ] 必要なら本番ヒーロー（`src/pages/index.astro`）の glyphdust 化を別途判断
- [ ] GitHub リリースタグ `v0.1.0`
